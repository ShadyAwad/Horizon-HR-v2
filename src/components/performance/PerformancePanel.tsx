import { useCallback, useEffect, useState } from 'react';
import { Award, BarChart3, CheckCircle2, ClipboardCheck, Goal, LoaderCircle, Plus, RefreshCw, Users } from 'lucide-react';
import type { AuthUser } from '../../App';
import { apiFetch } from '../../lib/api';
import { useLanguage } from '../../lib/LanguageContext';

type Review = { id: string; employeeId?: string; employeeName?: string; cycleName: string; status: string; overallScore?: number | null; assignmentId?: string; reviewerType?: string; assignmentStatus?: string; dueAt?: string | null };
type GoalRow = { id: string; employeeId?: string; employeeName?: string; title: string; description?: string | null; goalType: string; progressPercent: number; status: string; dueAt?: string | null };
type Recognition = { id: string; employeeId?: string; employeeName?: string; recognitionMonth: string; title: string; message?: string | null; finalisedReviewScore?: number | null; completedGoals?: number | null };
type Cycle = { id: string; name: string; status: string; reviewPeriodStart: string; reviewPeriodEnd: string; reviewCount: number; completedCount: number };

const dateLabel = (value: string | null | undefined, lang: string) => value ? new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-US', { dateStyle: 'medium' }).format(new Date(value)) : '-';
const has = (user: AuthUser, permission: string) => user.role === 'hr_admin' || Boolean(user.permissions?.includes(permission));

export function PerformancePanel({ user }: { user: AuthUser }) {
  const { t, lang, isRtl } = useLanguage();
  const canManageCycles = has(user, 'performance.manage_cycles');
  const canManageGoals = has(user, 'performance.manage_goals');
  const canRecognition = has(user, 'performance.manage_recognition');
  const [view, setView] = useState<'overview' | 'reviews' | 'goals' | 'recognition'>(canManageCycles ? 'overview' : 'reviews');
  const [reviews, setReviews] = useState<Review[]>([]);
  const [goals, setGoals] = useState<GoalRow[]>([]);
  const [recognitions, setRecognitions] = useState<Recognition[]>([]);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [goalForm, setGoalForm] = useState({ employeeId: user.id, title: '', description: '', goalType: 'goal', dueAt: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const endpoints = canManageCycles
        ? ['/api/hr/performance/cycles', '/api/hr/performance/reviews', '/api/hr/performance/goals', canRecognition ? '/api/hr/performance/recognitions' : '/api/me/performance/recognitions']
        : ['/api/me/performance/reviews', '/api/me/performance/goals', '/api/me/performance/recognitions'];
      const responses = await Promise.all(endpoints.map((path) => apiFetch(path)));
      const payloads = await Promise.all(responses.map(async (response) => {
        const payload = await response.json(); if (!response.ok) throw new Error(payload.error || t('performance.loadError')); return payload;
      }));
      if (canManageCycles) { setCycles(payloads[0].cycles || []); setReviews(payloads[1].reviews || []); setGoals(payloads[2].goals || []); setRecognitions(payloads[3].recognitions || []); }
      else { setReviews(payloads[0].reviews || []); setGoals(payloads[1].goals || []); setRecognitions(payloads[2].recognitions || []); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('performance.loadError')); }
    finally { setLoading(false); }
  }, [canManageCycles, canRecognition, t]);

  useEffect(() => { void load(); }, [load]);

  const createGoal = async () => {
    setSaving(true); setError('');
    try {
      const response = await apiFetch('/api/hr/performance/goals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(goalForm) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || t('performance.saveError'));
      setShowGoalForm(false); setGoalForm({ employeeId: user.id, title: '', description: '', goalType: 'goal', dueAt: '' }); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('performance.saveError')); }
    finally { setSaving(false); }
  };

  const updateOwnGoal = async (goal: GoalRow, progressPercent: number) => {
    try {
      const response = await apiFetch(`/api/me/performance/goals/${goal.id}/progress`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ progressPercent }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || t('performance.saveError')); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('performance.saveError')); }
  };

  const tabs = [
    ['overview', t('performance.overview'), canManageCycles],
    ['reviews', t('performance.reviews'), true],
    ['goals', t('performance.goals'), true],
    ['recognition', t('performance.recognition'), true],
  ] as const;
  const overviewCards: Array<{ label: string; value: string | number; Icon: typeof BarChart3 }> = [
    { label: t('performance.activeCycles'), value: cycles.filter((cycle) => cycle.status === 'active').length, Icon: ClipboardCheck },
    { label: t('performance.pendingReviews'), value: reviews.filter((review) => review.status !== 'completed').length, Icon: Users },
    { label: t('performance.goalsAtRisk'), value: goals.filter((goal) => goal.status === 'at_risk').length, Icon: Goal },
    { label: t('performance.employeeOfMonth'), value: recognitions.find((recognition) => !('revokedAt' in recognition))?.employeeName || t('performance.none'), Icon: Award },
  ];

  return <section className="w-full" dir={isRtl ? 'rtl' : 'ltr'}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-emerald-50"><BarChart3 className="h-5 w-5 text-emerald-500" />{t('performance.title')}</h2><p className="mt-1 text-xs text-slate-500 dark:text-emerald-100/55">{t('performance.subtitle')}</p></div><button type="button" onClick={() => void load()} className="rounded-md border border-emerald-500/20 p-2 text-emerald-600 hover:bg-emerald-500/10" aria-label={t('performance.retry')}><RefreshCw className="h-4 w-4" /></button></div>
    <div className="mt-4 flex gap-2 overflow-x-auto border-b border-emerald-500/15">{tabs.filter(([, , visible]) => visible).map(([key, label]) => <button key={key} type="button" onClick={() => setView(key)} className={`shrink-0 border-b-2 px-3 py-2 text-xs font-bold ${view === key ? 'border-emerald-500 text-emerald-600 dark:text-emerald-300' : 'border-transparent text-slate-500 dark:text-emerald-100/45'}`}>{label}</button>)}</div>
    {error && <div className="mt-4 flex items-center justify-between gap-3 rounded-md border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-200"><span>{error}</span><button type="button" onClick={() => void load()} className="font-bold underline">{t('performance.retry')}</button></div>}
    {loading ? <div className="flex min-h-72 items-center justify-center"><LoaderCircle className="h-7 w-7 animate-spin text-emerald-500" /></div> : <>
      {view === 'overview' && <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{overviewCards.map(({ label, value, Icon }) => <article key={label} className="rounded-lg border border-emerald-500/15 bg-black/5 p-4 dark:bg-black/25"><Icon className="h-4 w-4 text-emerald-500" /><p className="mt-3 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-emerald-100/45">{label}</p><p className="mt-1 text-xl font-bold text-slate-900 dark:text-emerald-50">{value}</p></article>)}</div>}
      {view === 'overview' && <div className="mt-5 space-y-2">{cycles.map((cycle) => <article key={cycle.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-500/15 bg-black/5 p-3 text-xs dark:bg-black/20"><div><strong className="text-slate-900 dark:text-emerald-50">{cycle.name}</strong><p className="mt-1 text-slate-500 dark:text-emerald-100/45">{dateLabel(cycle.reviewPeriodStart, lang)} - {dateLabel(cycle.reviewPeriodEnd, lang)}</p></div><span className="rounded-full bg-emerald-500/10 px-2 py-1 font-bold capitalize text-emerald-700 dark:text-emerald-300">{cycle.status} · {cycle.completedCount}/{cycle.reviewCount}</span></article>)}{cycles.length === 0 && <Empty icon={ClipboardCheck} message={t('performance.emptyCycles')} />}</div>}
      {view === 'reviews' && <div className="mt-5 space-y-3">{reviews.map((review) => <article key={review.id} className="rounded-lg border border-emerald-500/15 bg-black/5 p-4 dark:bg-black/20"><div className="flex flex-wrap items-start justify-between gap-2"><div><strong className="text-sm text-slate-900 dark:text-emerald-50">{review.cycleName}</strong><p className="mt-1 text-xs text-slate-500 dark:text-emerald-100/45">{review.employeeName || t('performance.myReview')} {review.reviewerType ? `· ${review.reviewerType}` : ''}</p></div><span className="rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-bold capitalize text-emerald-700 dark:text-emerald-300">{review.assignmentStatus || review.status}</span></div>{review.assignmentId && review.assignmentStatus !== 'submitted' && <p className="mt-3 text-xs text-amber-700 dark:text-amber-200">{t('performance.assignmentReady')}</p>}{review.overallScore !== null && review.overallScore !== undefined && <p className="mt-3 text-sm font-bold text-emerald-700 dark:text-emerald-300">{t('performance.finalScore')}: {Number(review.overallScore).toFixed(2)}</p>}</article>)}{reviews.length === 0 && <Empty icon={ClipboardCheck} message={t('performance.emptyReviews')} />}</div>}
      {view === 'goals' && <div className="mt-5"><div className="mb-3 flex justify-end">{canManageGoals && <button type="button" onClick={() => setShowGoalForm((value) => !value)} className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-500"><Plus className="h-4 w-4" />{t('performance.createGoal')}</button>}</div>{showGoalForm && <div className="mb-4 grid gap-3 rounded-lg border border-emerald-500/20 bg-black/5 p-4 dark:bg-black/25 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-700 dark:text-emerald-100">{t('performance.goalTitle')}<input value={goalForm.title} onChange={(event) => setGoalForm((current) => ({ ...current, title: event.target.value }))} className="mt-1 w-full rounded border border-emerald-500/20 bg-white/70 px-3 py-2 text-sm dark:bg-black/40 dark:text-emerald-50" /></label><label className="text-xs font-semibold text-slate-700 dark:text-emerald-100">{t('performance.goalDueDate')}<input type="date" value={goalForm.dueAt} onChange={(event) => setGoalForm((current) => ({ ...current, dueAt: event.target.value }))} className="mt-1 w-full rounded border border-emerald-500/20 bg-white/70 px-3 py-2 text-sm dark:bg-black/40 dark:text-emerald-50" /></label><label className="sm:col-span-2 text-xs font-semibold text-slate-700 dark:text-emerald-100">{t('performance.goalDescription')}<textarea value={goalForm.description} onChange={(event) => setGoalForm((current) => ({ ...current, description: event.target.value }))} className="mt-1 min-h-20 w-full rounded border border-emerald-500/20 bg-white/70 px-3 py-2 text-sm dark:bg-black/40 dark:text-emerald-50" /></label><div className="flex gap-2"><button type="button" disabled={saving} onClick={() => void createGoal()} className="rounded bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{t('performance.save')}</button><button type="button" onClick={() => setShowGoalForm(false)} className="rounded border border-emerald-500/20 px-3 py-2 text-xs">{t('performance.cancel')}</button></div></div>}<div className="space-y-3">{goals.map((goal) => <article key={goal.id} className="rounded-lg border border-emerald-500/15 bg-black/5 p-4 dark:bg-black/20"><div className="flex flex-wrap items-start justify-between gap-2"><div><strong className="text-sm text-slate-900 dark:text-emerald-50">{goal.title}</strong><p className="mt-1 text-xs text-slate-500 dark:text-emerald-100/45">{goal.employeeName || t('performance.myGoal')} · {goal.goalType}{goal.dueAt ? ` · ${dateLabel(goal.dueAt, lang)}` : ''}</p></div><span className="capitalize text-xs font-bold text-emerald-700 dark:text-emerald-300">{goal.status}</span></div><div className="mt-3 flex items-center gap-3"><input aria-label={`${goal.title} progress`} type="range" min="0" max="100" step="1" value={goal.progressPercent} disabled={goal.employeeId !== undefined && goal.employeeId !== user.id && !canManageGoals} onChange={(event) => void updateOwnGoal(goal, Number(event.target.value))} className="accent-emerald-500" /><output className="min-w-10 text-xs font-bold text-emerald-700 dark:text-emerald-300">{goal.progressPercent}%</output></div></article>)}{goals.length === 0 && <Empty icon={Goal} message={t('performance.emptyGoals')} />}</div></div>}
      {view === 'recognition' && <div className="mt-5 space-y-3">{recognitions.map((recognition) => <article key={recognition.id} className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4"><div className="flex items-start gap-3"><Award className="h-5 w-5 shrink-0 text-emerald-500" /><div><strong className="text-sm text-slate-900 dark:text-emerald-50">{recognition.title}</strong><p className="mt-1 text-xs text-slate-500 dark:text-emerald-100/55">{recognition.employeeName || t('performance.you')} · {dateLabel(recognition.recognitionMonth, lang)}</p>{recognition.message && <p className="mt-2 text-sm text-slate-700 dark:text-emerald-100/80">{recognition.message}</p>}</div></div></article>)}{recognitions.length === 0 && <Empty icon={Award} message={t('performance.emptyRecognition')} />}</div>}
    </>}
  </section>;
}

function Empty({ icon: Icon, message }: { icon: typeof Goal; message: string }) { return <div className="py-12 text-center text-sm text-slate-500 dark:text-emerald-100/50"><Icon className="mx-auto mb-2 h-7 w-7 text-emerald-500" />{message}</div>; }
