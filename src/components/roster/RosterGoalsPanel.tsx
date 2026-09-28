import { GoalDialog } from './GoalDialog';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleDot, ClipboardCheck, LoaderCircle, Pencil, Plus, RefreshCw, X } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { useLanguage } from '../../lib/LanguageContext';
import { cn } from '../../lib/utils';

type GoalPriority = 'low' | 'normal' | 'high';
type GoalStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
type Goal = {
  id: string;
  employeeId: string;
  employeeName: string;
  assignedBy: { employeeId: string; displayName: string };
  team: { id: string; name: string } | null;
  weekStart: string;
  dueDate: string | null;
  title: string;
  description: string | null;
  priority: GoalPriority;
  status: GoalStatus;
  completionNote: string | null;
  completedAt: string | null;
};
type Assignee = {
  id: string;
  fullName: string;
  departmentId: string | null;
  departmentName: string | null;
  teamId: string | null;
  teamName: string | null;
};
type Capabilities = { canView: boolean; canManage: boolean; canComplete: boolean };
type GoalForm = {
  employeeId: string;
  teamId: string;
  weekStart: string;
  dueDate: string;
  title: string;
  description: string;
  priority: GoalPriority;
};

type Props = {
  employeeId: string;
  weekStart: string;
  compact?: boolean;
  onOpenFull?: () => void;
};

const EMPTY_CAPABILITIES: Capabilities = { canView: false, canManage: false, canComplete: false };

async function responseJson(response: Response) {
  const payload = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(payload.error || 'Request failed.');
  return payload as any;
}

function priorityClass(priority: GoalPriority) {
  if (priority === 'high') return 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200';
  if (priority === 'low') return 'border-slate-400/25 bg-slate-500/10 text-slate-600 dark:text-slate-300';
  return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
}

function statusClass(status: GoalStatus) {
  if (status === 'completed') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (status === 'cancelled') return 'border-slate-400/25 bg-slate-500/10 text-slate-500 dark:text-slate-300';
  if (status === 'in_progress') return 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-200';
  return 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200';
}

export function RosterGoalsPanel({ employeeId, weekStart, compact = false, onOpenFull }: Props) {
  const { t, isRtl, lang } = useLanguage();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [overdueGoals, setOverdueGoals] = useState<Goal[]>([]);
  const [capabilities, setCapabilities] = useState<Capabilities>(EMPTY_CAPABILITIES);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [assigneesLoading, setAssigneesLoading] = useState(false);
  const [assigneesLoaded, setAssigneesLoaded] = useState(false);
  const [assigneesError, setAssigneesError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [editing, setEditing] = useState<Goal | 'new' | null>(null);
  const [completionGoal, setCompletionGoal] = useState<Goal | null>(null);
  const [completionNote, setCompletionNote] = useState('');
  const [cancelGoal, setCancelGoal] = useState<Goal | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [form, setForm] = useState<GoalForm>({ employeeId, teamId: '', weekStart, dueDate: '', title: '', description: '', priority: 'normal' });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ employeeId, weekStart, includeOverdue: 'true' });
      const payload = await responseJson(await apiFetch(`/api/roster/goals?${query.toString()}`));
      setGoals(Array.isArray(payload.goals) ? payload.goals : []);
      setOverdueGoals(Array.isArray(payload.overdueGoals) ? payload.overdueGoals : []);
      setCapabilities(payload.capabilities || EMPTY_CAPABILITIES);
    } catch (loadError) {
      setGoals([]);
      setOverdueGoals([]);
      setCapabilities(EMPTY_CAPABILITIES);
      setError(loadError instanceof Error ? loadError.message : t('rosterGoals.loadError'));
    } finally {
      setLoading(false);
    }
  }, [employeeId, t, weekStart]);

  useEffect(() => { void load(); }, [load]);

  const loadAssignees = useCallback(async () => {
    if (assigneesLoaded || assigneesLoading) return;
    setAssigneesLoading(true);
    setAssigneesError('');
    try {
      const payload = await responseJson(await apiFetch('/api/roster/goals/assignees'));
      setAssignees(Array.isArray(payload.assignees) ? payload.assignees : []);
      setAssigneesLoaded(true);
    } catch (loadError) {
      setAssigneesError(loadError instanceof Error ? loadError.message : t('rosterGoals.assigneesError'));
    } finally {
      setAssigneesLoading(false);
    }
  }, [assigneesLoaded, assigneesLoading, t]);

  const selectedAssignee = useMemo(
    () => assignees.find((assignee) => assignee.id === form.employeeId) || null,
    [assignees, form.employeeId],
  );

  const openCreate = (event: React.MouseEvent<HTMLButtonElement>) => {
    returnFocusRef.current = event.currentTarget;
    const target = assignees.find((assignee) => assignee.id === employeeId) || assignees[0];
    setForm({ employeeId: target?.id || employeeId, teamId: target?.teamId || '', weekStart, dueDate: '', title: '', description: '', priority: 'normal' });
    setError('');
    setEditing('new');
    void loadAssignees();
  };

  const openEdit = (goal: Goal, event: React.MouseEvent<HTMLButtonElement>) => {
    returnFocusRef.current = event.currentTarget;
    setForm({ employeeId: goal.employeeId, teamId: goal.team?.id || '', weekStart: goal.weekStart, dueDate: goal.dueDate || '', title: goal.title, description: goal.description || '', priority: goal.priority });
    setError('');
    setEditing(goal);
    void loadAssignees();
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing || !form.title.trim()) return;
    const requestId = editing === 'new' ? 'new' : editing.id;
    setBusyId(requestId);
    setError('');
    setSuccess('');
    try {
      const payload = {
        employeeId: form.employeeId,
        teamId: form.teamId || null,
        weekStart: form.weekStart,
        dueDate: form.dueDate || null,
        title: form.title,
        description: form.description || null,
        priority: form.priority,
      };
      await responseJson(await apiFetch(editing === 'new' ? '/api/roster/goals' : `/api/roster/goals/${editing.id}`, {
        method: editing === 'new' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }));
      setEditing(null);
      setSuccess(editing === 'new' ? t('rosterGoals.created') : t('rosterGoals.updated'));
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('rosterGoals.saveError'));
    } finally {
      setBusyId(null);
    }
  };

  const updateStatus = async (goal: Goal, status: 'in_progress' | 'completed', note = '') => {
    setBusyId(goal.id);
    setError('');
    setSuccess('');
    try {
      await responseJson(await apiFetch(`/api/roster/goals/${goal.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, ...(status === 'completed' ? { completionNote: note || null } : {}) }),
      }));
      setCompletionGoal(null);
      setCompletionNote('');
      setSuccess(status === 'completed' ? t('rosterGoals.completed') : t('rosterGoals.inProgressSaved'));
      await load();
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : t('rosterGoals.statusError'));
    } finally {
      setBusyId(null);
    }
  };

  const cancel = async () => {
    if (!cancelGoal) return;
    setBusyId(cancelGoal.id);
    setError('');
    try {
      await responseJson(await apiFetch(`/api/roster/goals/${cancelGoal.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }));
      setCancelGoal(null);
      setSuccess(t('rosterGoals.cancelled'));
      await load();
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : t('rosterGoals.cancelError'));
    } finally {
      setBusyId(null);
    }
  };

  const renderGoal = (goal: Goal, overdue = false) => (
    <article key={goal.id} className="stanza-roster-goal-card min-w-0 rounded-lg border border-[var(--stanza-border-subtle)] bg-[var(--stanza-surface-raised)] p-3" data-goal-status={goal.status}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="break-words text-sm font-bold text-[color:var(--stanza-text-primary)]">{goal.title}</h4>
            {overdue && <span className="rounded border border-red-500/25 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-bold text-red-700 dark:text-red-200">{t('rosterGoals.overdue')}</span>}
          </div>
          {goal.description && <p className="mt-1 line-clamp-2 break-words text-xs leading-5 text-[color:var(--stanza-text-muted)]">{goal.description}</p>}
        </div>
        <span className={cn('shrink-0 rounded border px-2 py-1 text-[10px] font-bold', priorityClass(goal.priority))}>{t(`rosterGoals.priority.${goal.priority}` as never)}</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-[color:var(--stanza-text-muted)]">
        <span className={cn('rounded border px-2 py-1 font-bold', statusClass(goal.status))}>{t(`rosterGoals.status.${goal.status}` as never)}</span>
        <span>{goal.dueDate ? new Date(`${goal.dueDate}T00:00:00`).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US') : t('rosterGoals.weekly')}</span>
        {goal.team && <span>{goal.team.name}</span>}
        <span>{t('rosterGoals.assignedBy')} {goal.assignedBy.displayName}</span>
      </div>
      {goal.completionNote && <p className="mt-2 rounded border border-emerald-500/15 bg-emerald-500/5 px-2 py-1.5 text-[11px] text-[color:var(--stanza-text-muted)]">{goal.completionNote}</p>}
      {(capabilities.canComplete || capabilities.canManage) && goal.status !== 'completed' && goal.status !== 'cancelled' && (
        <div className="mt-3 flex flex-wrap gap-2">
          {goal.status === 'pending' && <button type="button" disabled={busyId === goal.id} onClick={() => void updateStatus(goal, 'in_progress')} className="stanza-secondary-action min-h-9 rounded-md border border-sky-500/25 px-3 text-xs font-bold text-sky-700 disabled:opacity-50 dark:text-sky-200"><CircleDot className="me-1 inline h-3.5 w-3.5" />{t('rosterGoals.start')}</button>}
          <button type="button" disabled={busyId === goal.id} onClick={(event) => { returnFocusRef.current = event.currentTarget; setCompletionGoal(goal); setCompletionNote(''); }} className="stanza-primary-action min-h-9 rounded-md bg-emerald-500 px-3 text-xs font-bold text-[#02110b] disabled:opacity-50"><CheckCircle2 className="me-1 inline h-3.5 w-3.5" />{t('rosterGoals.complete')}</button>
          {!compact && capabilities.canManage && <button type="button" onClick={(event) => openEdit(goal, event)} className="stanza-secondary-action min-h-9 rounded-md border border-[var(--stanza-border-subtle)] px-3 text-xs font-bold"><Pencil className="me-1 inline h-3.5 w-3.5" />{t('rosterGoals.edit')}</button>}
          {!compact && capabilities.canManage && <button type="button" onClick={(event) => { returnFocusRef.current = event.currentTarget; setCancelGoal(goal); }} className="stanza-destructive-action min-h-9 rounded-md border border-red-500/25 px-3 text-xs font-bold text-red-700 dark:text-red-200">{t('rosterGoals.cancel')}</button>}
        </div>
      )}
    </article>
  );

  const visibleGoals = compact ? goals.slice(0, 3) : goals;
  const visibleOverdue = compact ? overdueGoals.slice(0, 2) : overdueGoals;

  return <section className={cn('min-w-0', compact ? 'mt-4 border-t border-[var(--stanza-border-subtle)] pt-4' : 'p-3 sm:p-4')} dir={isRtl ? 'rtl' : 'ltr'} data-roster-goals={compact ? 'summary' : 'workspace'} data-tutorial-target={compact ? 'roster-goals' : undefined}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="flex items-center gap-2 text-base font-bold text-[color:var(--stanza-text-primary)]"><ClipboardCheck className="h-5 w-5 text-emerald-500" />{t('rosterGoals.title')}</h3>
        <p className="mt-1 text-xs text-[color:var(--stanza-text-muted)]">{t('rosterGoals.description')}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void load()} disabled={loading} className="stanza-icon-action grid h-10 w-10 place-items-center rounded-md border border-[var(--stanza-border-subtle)] disabled:opacity-50" aria-label={t('rosterGoals.refresh')}><RefreshCw className={cn('h-4 w-4', loading && 'animate-spin motion-reduce:animate-none')} /></button>
        {compact && onOpenFull && <button type="button" onClick={onOpenFull} className="stanza-secondary-action min-h-10 rounded-md border border-[var(--stanza-border-subtle)] px-3 text-xs font-bold">{t('rosterGoals.open')}</button>}
        {!compact && capabilities.canManage && <button type="button" onClick={openCreate} className="stanza-primary-action inline-flex min-h-10 items-center gap-2 rounded-md bg-emerald-500 px-3 text-xs font-bold text-[#02110b]"><Plus className="h-4 w-4" />{t('rosterGoals.assign')}</button>}
      </div>
    </div>
    {error && <div role="alert" className="mt-3 flex items-start gap-2 rounded-md border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}
    {success && <p role="status" className="mt-3 rounded-md border border-emerald-500/25 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-200">{success}</p>}
    {loading ? <div className="flex min-h-32 items-center justify-center gap-2 text-xs text-[color:var(--stanza-text-muted)]"><LoaderCircle className="h-5 w-5 animate-spin motion-reduce:animate-none text-emerald-500" />{t('rosterGoals.loading')}</div> : goals.length === 0 && overdueGoals.length === 0 ? <div className="mt-4 rounded-lg border border-dashed border-[var(--stanza-border-subtle)] p-6 text-center"><ClipboardCheck className="mx-auto h-7 w-7 text-emerald-500/60" /><p className="mt-2 text-sm font-bold text-[color:var(--stanza-text-primary)]">{t('rosterGoals.empty')}</p><p className="mt-1 text-xs text-[color:var(--stanza-text-muted)]">{t('rosterGoals.emptyHelp')}</p></div> : <div className="mt-4 space-y-4">
      {visibleGoals.length > 0 && <div className="grid min-w-0 gap-2 lg:grid-cols-2">{visibleGoals.map((goal) => renderGoal(goal))}</div>}
      {visibleOverdue.length > 0 && <section><h4 className="mb-2 text-xs font-black uppercase tracking-widest text-red-700 dark:text-red-200">{t('rosterGoals.overdueTitle')}</h4><div className="grid min-w-0 gap-2 lg:grid-cols-2">{visibleOverdue.map((goal) => renderGoal(goal, true))}</div></section>}
    </div>}

    {editing && <GoalDialog labelledBy="roster-goal-form-title" dir={isRtl ? 'rtl' : 'ltr'} busy={Boolean(busyId)} onClose={() => setEditing(null)}>
      <section aria-labelledby="roster-goal-form-title" className="w-full max-w-lg rounded-xl border border-emerald-500/25 bg-white p-4 shadow-2xl dark:bg-[#061411]">
        <div className="flex items-start justify-between gap-3"><div><h3 id="roster-goal-form-title" className="text-base font-bold">{editing === 'new' ? t('rosterGoals.assign') : t('rosterGoals.edit')}</h3><p className="mt-1 text-xs text-[color:var(--stanza-text-muted)]">{t('rosterGoals.formHelp')}</p></div><button ref={closeButtonRef} type="button" disabled={Boolean(busyId)} onClick={() => setEditing(null)} className="stanza-icon-action grid h-10 w-10 place-items-center rounded-md" aria-label={t('rosterGoals.close')}><X className="h-4 w-4" /></button></div>
        <form onSubmit={save} className="mt-4 space-y-3">
          <label className="block text-xs font-bold">{t('rosterGoals.employee')}<select value={form.employeeId} onChange={(event) => { const assignee = assignees.find((item) => item.id === event.target.value); setForm((current) => ({ ...current, employeeId: event.target.value, teamId: assignee?.teamId || '' })); }} disabled={assigneesLoading || !assigneesLoaded} className="stanza-select mt-1 w-full rounded-md border px-3 py-2.5 text-sm">{!assignees.some((assignee) => assignee.id === form.employeeId) && <option value={form.employeeId}>{editing === 'new' ? t('rosterGoals.selectedEmployee') : (editing as Goal).employeeName}</option>}{assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.fullName}{assignee.teamName ? ` - ${assignee.teamName}` : ''}</option>)}</select></label>
          {assigneesLoading && <p role="status" className="text-xs text-[color:var(--stanza-text-muted)]">{t('rosterGoals.loading')}</p>}
          {assigneesError && <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-red-500/25 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-200"><span>{assigneesError}</span><button type="button" onClick={() => void loadAssignees()} className="stanza-secondary-action min-h-9 rounded-md border border-red-500/25 px-3 font-bold">{t('rosterGoals.refresh')}</button></div>}
          <label className="block text-xs font-bold">{t('rosterGoals.team')}<select value={form.teamId} onChange={(event) => setForm((current) => ({ ...current, teamId: event.target.value }))} className="stanza-select mt-1 w-full rounded-md border px-3 py-2.5 text-sm"><option value="">{t('rosterGoals.noTeam')}</option>{selectedAssignee?.teamId && <option value={selectedAssignee.teamId}>{selectedAssignee.teamName || t('rosterGoals.team')}</option>}</select></label>
          <label className="block text-xs font-bold">{t('rosterGoals.goalTitle')}<input required maxLength={240} value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} className="mt-1 w-full rounded-md border border-[var(--stanza-border-subtle)] bg-[var(--stanza-input-bg)] px-3 py-2.5 text-sm text-[color:var(--stanza-text-primary)] outline-none focus:border-[var(--stanza-border-accent)]" /></label>
          <label className="block text-xs font-bold">{t('rosterGoals.goalDescription')}<textarea maxLength={2000} rows={3} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} className="mt-1 w-full resize-y rounded-md border border-[var(--stanza-border-subtle)] bg-[var(--stanza-input-bg)] px-3 py-2.5 text-sm text-[color:var(--stanza-text-primary)] outline-none focus:border-[var(--stanza-border-accent)]" /></label>
          <div className="grid gap-3 sm:grid-cols-3"><label className="block text-xs font-bold">{t('rosterGoals.weekStart')}<input type="date" value={form.weekStart} onChange={(event) => setForm((current) => ({ ...current, weekStart: event.target.value }))} className="mt-1 w-full rounded-md border border-[var(--stanza-border-subtle)] bg-[var(--stanza-input-bg)] px-3 py-2.5 text-sm" /></label><label className="block text-xs font-bold">{t('rosterGoals.dueDate')}<input type="date" min={form.weekStart} value={form.dueDate} onChange={(event) => setForm((current) => ({ ...current, dueDate: event.target.value }))} className="mt-1 w-full rounded-md border border-[var(--stanza-border-subtle)] bg-[var(--stanza-input-bg)] px-3 py-2.5 text-sm" /></label><label className="block text-xs font-bold">{t('rosterGoals.priority')}<select value={form.priority} onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value as GoalPriority }))} className="stanza-select mt-1 w-full rounded-md border px-3 py-2.5 text-sm"><option value="low">{t('rosterGoals.priority.low')}</option><option value="normal">{t('rosterGoals.priority.normal')}</option><option value="high">{t('rosterGoals.priority.high')}</option></select></label></div>
          {error && <p role="alert" className="rounded-md border border-red-500/25 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-200">{error}</p>}
          <button type="submit" disabled={Boolean(busyId) || !form.title.trim()} className="stanza-primary-action inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-emerald-500 px-4 text-sm font-bold text-[#02110b] disabled:opacity-50">{busyId && <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" />}{t('rosterGoals.save')}</button>
        </form>
      </section>
    </GoalDialog>}

    {completionGoal && <GoalDialog labelledBy="roster-goal-complete-title" dir={isRtl ? 'rtl' : 'ltr'} busy={Boolean(busyId)} onClose={() => setCompletionGoal(null)}><section aria-labelledby="roster-goal-complete-title" className="w-full max-w-md rounded-xl border border-emerald-500/25 bg-white p-4 shadow-2xl dark:bg-[#061411]"><div className="flex items-start justify-between gap-3"><h3 id="roster-goal-complete-title" className="text-base font-bold">{t('rosterGoals.complete')}</h3><button ref={closeButtonRef} type="button" disabled={Boolean(busyId)} onClick={() => setCompletionGoal(null)} className="stanza-icon-action grid h-10 w-10 place-items-center rounded-md" aria-label={t('rosterGoals.close')}><X className="h-4 w-4" /></button></div><p className="mt-2 text-xs text-[color:var(--stanza-text-muted)]">{completionGoal.title}</p><label className="mt-3 block text-xs font-bold">{t('rosterGoals.completionNote')}<textarea maxLength={1000} rows={3} value={completionNote} onChange={(event) => setCompletionNote(event.target.value)} className="mt-1 w-full rounded-md border border-[var(--stanza-border-subtle)] bg-[var(--stanza-input-bg)] p-3 text-sm" /></label><button type="button" disabled={Boolean(busyId)} onClick={() => void updateStatus(completionGoal, 'completed', completionNote)} className="stanza-primary-action mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-emerald-500 px-4 text-sm font-bold text-[#02110b] disabled:opacity-50">{busyId && <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" />}{t('rosterGoals.confirmComplete')}</button></section></GoalDialog>}

    {cancelGoal && <GoalDialog alert labelledBy="roster-goal-cancel-title" dir={isRtl ? 'rtl' : 'ltr'} busy={Boolean(busyId)} onClose={() => setCancelGoal(null)}><section aria-labelledby="roster-goal-cancel-title" className="w-full max-w-md rounded-xl border border-red-500/25 bg-white p-4 shadow-2xl dark:bg-[#061411]"><div className="flex items-start justify-between gap-3"><h3 id="roster-goal-cancel-title" className="text-base font-bold">{t('rosterGoals.cancel')}</h3><button ref={closeButtonRef} type="button" disabled={Boolean(busyId)} onClick={() => setCancelGoal(null)} className="stanza-icon-action grid h-10 w-10 place-items-center rounded-md" aria-label={t('rosterGoals.close')}><X className="h-4 w-4" /></button></div><p className="mt-2 text-sm text-[color:var(--stanza-text-muted)]">{t('rosterGoals.cancelConfirm')}</p><div className="mt-4 flex gap-2"><button type="button" disabled={Boolean(busyId)} onClick={() => setCancelGoal(null)} className="stanza-secondary-action min-h-11 flex-1 rounded-md border border-[var(--stanza-border-subtle)] px-3 text-sm font-bold">{t('rosterGoals.keep')}</button><button type="button" disabled={Boolean(busyId)} onClick={() => void cancel()} className="stanza-destructive-action inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md bg-red-600 px-3 text-sm font-bold text-white disabled:opacity-50">{busyId && <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" />}{t('rosterGoals.cancel')}</button></div></section></GoalDialog>}
  </section>;
}
