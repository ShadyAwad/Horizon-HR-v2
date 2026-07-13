import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, BriefcaseBusiness, ChevronLeft, ChevronRight, FilePlus2, Forward, Loader2, MessageSquarePlus, Pencil, RefreshCw, ShieldAlert, UserCheck, X } from 'lucide-react';
import type { AuthUser } from '../../App';
import {
  HIRING_NOTE_TYPES, HIRING_STAGES, HiringApiError, type HiringApplicantDetails, type HiringApplicantFilters,
  type HiringApplicantInput, type HiringApplicantListItem, type HiringHandoff, type HiringNoteType,
  type HiringNoteVisibility, type HiringReviewer, type HiringStage, type HiringStatus,
  acknowledgeHiringHandoff, addHiringNote, archiveHiringApplicant, changeHiringStage, createHiringApplicant,
  createHiringHandoff, getHiringApplicant, listHiringApplicants, listHiringReviewers, updateHiringApplicant, updateHiringNote,
} from '../../api/hiring';
import { cn } from '../../lib/utils';
import { useLanguage } from '../../lib/LanguageContext';

type ModalKind = 'create' | 'edit' | 'note' | 'stage' | 'handoff' | 'archive' | null;
type PanelProps = { user: AuthUser; onRefreshAttentionCounts: () => void };
const PAGE_SIZE = 20;
const EMPTY_APPLICANT: HiringApplicantInput = { fullName: '', email: '', phone: '', positionTitle: '', department: '', source: '', appliedAt: '' };
const stageColors: Record<HiringStage, string> = {
  new: 'border-neutral-400/25 bg-neutral-500/10 text-neutral-600 dark:text-neutral-200',
  screening: 'border-teal-500/25 bg-teal-500/10 text-teal-700 dark:text-teal-200',
  hr_review: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-200',
  hiring_manager_review: 'border-cyan-500/25 bg-cyan-500/10 text-cyan-700 dark:text-cyan-200',
  interview: 'border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-200',
  final_review: 'border-amber-500/35 bg-amber-500/15 text-amber-800 dark:text-amber-100',
  offer: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-200',
  hired: 'border-green-500/30 bg-green-500/15 text-green-700 dark:text-green-200',
  rejected: 'border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-200',
  withdrawn: 'border-neutral-500/25 bg-neutral-500/10 text-neutral-600 dark:text-neutral-300',
};
const transitions: Record<HiringStage, HiringStage[]> = {
  new: ['screening', 'rejected', 'withdrawn'], screening: ['hr_review', 'rejected', 'withdrawn'],
  hr_review: ['hiring_manager_review', 'rejected', 'withdrawn'], hiring_manager_review: ['interview', 'rejected', 'withdrawn'],
  interview: ['final_review', 'rejected', 'withdrawn'], final_review: ['offer', 'rejected', 'withdrawn'],
  offer: ['hired', 'rejected', 'withdrawn'], hired: [], rejected: [], withdrawn: [],
};

function hasPermission(user: AuthUser, permission: string) {
  return user.role === 'hr_admin' || Boolean(user.permissions?.includes(permission));
}

function dateLabel(value?: string | null, locale = 'en-US') {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: value.includes('T') ? 'short' : undefined }).format(date);
}

function ErrorMessage({ error }: { error: string }) {
  return error ? <p role="alert" className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-200">{error}</p> : null;
}

export function HiringPanel({ user, onRefreshAttentionCounts }: PanelProps) {
  const { t, isRtl, lang } = useLanguage();
  const locale = lang === 'ar' ? 'ar-EG' : 'en-US';
  const can = useCallback((permission: string) => hasPermission(user, permission), [user]);
  const [filters, setFilters] = useState<HiringApplicantFilters>({ page: 1, pageSize: PAGE_SIZE, status: 'active' });
  const [searchDraft, setSearchDraft] = useState('');
  const [applicants, setApplicants] = useState<HiringApplicantListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<HiringApplicantDetails | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [modal, setModal] = useState<ModalKind>(null);
  const [form, setForm] = useState<HiringApplicantInput>(EMPTY_APPLICANT);
  const [noteText, setNoteText] = useState('');
  const [noteType, setNoteType] = useState<HiringNoteType>('general');
  const [noteVisibility, setNoteVisibility] = useState<HiringNoteVisibility>('hiring_team');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [stageTarget, setStageTarget] = useState<HiringStage | ''>('');
  const [stageReason, setStageReason] = useState('');
  const [reviewers, setReviewers] = useState<HiringReviewer[]>([]);
  const [duplicateApplicantId, setDuplicateApplicantId] = useState<string | null>(null);
  const [reviewerId, setReviewerId] = useState('');
  const [handoffStage, setHandoffStage] = useState<HiringStage | ''>('');
  const [handoffMessage, setHandoffMessage] = useState('');
  const [mutationLoading, setMutationLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const requestRef = useRef(0);

  const stageLabel = useCallback((stage: HiringStage) => t(`hiring.stage.${stage}` as never), [t]);
  const visibleNextStages = useMemo(() => detail ? transitions[detail.stage].filter((stage) => !(['offer', 'hired'] as HiringStage[]).includes(stage) || can('hiring.make_final_decision')) : [], [can, detail]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const displayError = (caught: unknown) => {
    const apiError = caught as HiringApiError;
    const messages: Record<string, string> = {
      HIRING_APPLICANT_NOT_FOUND: t('hiring.errorNotFound'), HIRING_INVALID_STAGE: t('hiring.errorInvalidStage'),
      HIRING_INVALID_TRANSITION: t('hiring.errorInvalidTransition'), HIRING_REVIEWER_INELIGIBLE: t('hiring.errorReviewer'),
      HIRING_HANDOFF_ALREADY_PENDING: t('hiring.errorDuplicateHandoff'), HIRING_HANDOFF_NOT_ASSIGNED_TO_USER: t('hiring.errorHandoffAccess'),
      HIRING_NOTE_NOT_EDITABLE: t('hiring.errorNoteEdit'), HIRING_PERMISSION_DENIED: t('hiring.errorPermission'),
      HIRING_NETWORK_ERROR: t('hiring.errorNetwork'),
    };
    setError(messages[apiError.code || ''] || apiError.message || t('hiring.errorGeneric'));
    return apiError;
  };

  const loadList = useCallback(async () => {
    setListLoading(true); setListError('');
    try {
      const response = await listHiringApplicants(user, filters);
      setApplicants(response.applicants); setTotal(response.total);
      setSelectedId((current) => current && response.applicants.some((applicant) => applicant.id === current) ? current : response.applicants[0]?.id || null);
    } catch (caught) {
      const apiError = caught as HiringApiError;
      setListError(apiError.code === 'HIRING_PERMISSION_DENIED' ? t('hiring.errorPermission') : t('hiring.listError'));
    } finally { setListLoading(false); }
  }, [filters, t, user]);

  const loadDetail = useCallback(async (id: string) => {
    const requestId = ++requestRef.current;
    setDetailLoading(true); setDetailError('');
    try {
      const response = await getHiringApplicant(user, id);
      if (requestRef.current !== requestId) return;
      setDetail({ ...response.applicant, notes: response.notes, handoffs: response.handoffs, stageHistory: response.stageHistory });
    } catch (caught) {
      if (requestRef.current !== requestId) return;
      const apiError = caught as HiringApiError;
      setDetail(null); setDetailError(apiError.status === 404 ? t('hiring.errorNotFound') : t('hiring.detailError'));
    } finally { if (requestRef.current === requestId) setDetailLoading(false); }
  }, [t, user]);

  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => { if (selectedId) void loadDetail(selectedId); else setDetail(null); }, [loadDetail, selectedId]);
  useEffect(() => {
    if (!can('hiring.assign')) return;
    void listHiringReviewers(user).then((response) => setReviewers(response.reviewers)).catch(() => setReviewers([]));
  }, [can, user]);
  useEffect(() => {
    const timeout = window.setTimeout(() => setFilters((current) => ({ ...current, page: 1, search: searchDraft.trim() })), 300);
    return () => window.clearTimeout(timeout);
  }, [searchDraft]);

  const refresh = async (id = selectedId) => { await loadList(); if (id) await loadDetail(id); };
  const closeModal = () => { setModal(null); setError(''); setMessage(''); setMutationLoading(false); };
  const openCreate = () => { setForm(EMPTY_APPLICANT); setDuplicateApplicantId(null); setModal('create'); setError(''); if (can('hiring.assign')) void listHiringReviewers(user).then((response) => setReviewers(response.reviewers)).catch(() => setReviewers([])); };
  const openEdit = () => {
    if (!detail) return;
    setForm({ fullName: detail.fullName, email: detail.email || '', phone: detail.phone || '', positionTitle: detail.positionTitle, department: detail.department || '', source: detail.source || '', appliedAt: detail.appliedAt?.slice(0, 10) || '' });
    setModal('edit'); setError('');
  };

  const submitApplicant = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.fullName.trim() || !form.positionTitle.trim()) { setError(t('hiring.validationRequired')); return; }
    setMutationLoading(true); setError('');
    let hasDuplicate = false;
    try {
      if (modal === 'create') {
        const response = await createHiringApplicant(user, form);
        const warning = response.warnings[0];
        if (warning) { hasDuplicate = true; setMessage(`${t('hiring.duplicateWarning')}: ${warning.message}`); setDuplicateApplicantId(warning.applicantId); }
        setSelectedId(response.applicant.id); setFilters((current) => ({ ...current, page: 1 }));
        await refresh(response.applicant.id); onRefreshAttentionCounts();
      } else if (detail) {
        await updateHiringApplicant(user, detail.id, form);
        await refresh(detail.id);
      }
      if (!hasDuplicate) closeModal();
    } catch (caught) { displayError(caught); } finally { setMutationLoading(false); }
  };

  const submitNote = async (event: React.FormEvent) => {
    event.preventDefault(); if (!detail || !noteText.trim()) { setError(t('hiring.validationNote')); return; }
    setMutationLoading(true); setError('');
    try {
      if (editingNoteId) await updateHiringNote(user, editingNoteId, noteText); else await addHiringNote(user, detail.id, { noteText, noteType, visibility: noteVisibility });
      await loadDetail(detail.id); closeModal();
    } catch (caught) { displayError(caught); } finally { setMutationLoading(false); }
  };

  const submitStage = async (event: React.FormEvent) => {
    event.preventDefault(); if (!detail || !stageTarget) return;
    setMutationLoading(true); setError('');
    try {
      await changeHiringStage(user, detail.id, { targetStage: stageTarget, reason: stageReason || undefined, expectedCurrentStage: detail.stage });
      await refresh(detail.id); onRefreshAttentionCounts(); closeModal();
    } catch (caught) {
      const apiError = displayError(caught);
      if (apiError.code === 'HIRING_STALE_STAGE') { setMessage(t('hiring.staleRefresh')); await loadDetail(detail.id); }
    } finally { setMutationLoading(false); }
  };

  const openHandoff = async () => {
    if (!detail) return; setModal('handoff'); setError(''); setReviewers([]); setReviewerId(''); setHandoffStage(''); setHandoffMessage('');
    try { const response = await listHiringReviewers(user); setReviewers(response.reviewers); } catch (caught) { displayError(caught); }
  };
  const submitHandoff = async (event: React.FormEvent) => {
    event.preventDefault(); if (!detail || !reviewerId) { setError(t('hiring.validationReviewer')); return; }
    setMutationLoading(true); setError('');
    try { await createHiringHandoff(user, detail.id, { reviewerId, targetStage: handoffStage || undefined, message: handoffMessage || undefined }); await refresh(detail.id); onRefreshAttentionCounts(); closeModal(); }
    catch (caught) { displayError(caught); } finally { setMutationLoading(false); }
  };
  const acknowledge = async (handoff: HiringHandoff) => {
    setMutationLoading(true); setError('');
    try { await acknowledgeHiringHandoff(user, handoff.id); if (detail) await loadDetail(detail.id); onRefreshAttentionCounts(); }
    catch (caught) { displayError(caught); } finally { setMutationLoading(false); }
  };
  const archive = async () => {
    if (!detail) return; setMutationLoading(true); setError('');
    try { await archiveHiringApplicant(user, detail.id); setSelectedId(null); await loadList(); onRefreshAttentionCounts(); closeModal(); }
    catch (caught) { displayError(caught); } finally { setMutationLoading(false); }
  };
  const clearFilters = () => { setSearchDraft(''); setFilters({ page: 1, pageSize: PAGE_SIZE, status: 'active' }); };

  const stageBadge = (stage: HiringStage) => <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider', stageColors[stage])}>{stageLabel(stage)}</span>;
  const openNote = (note?: { id: string; noteText: string; noteType: HiringNoteType; visibility: HiringNoteVisibility }) => { setEditingNoteId(note?.id || null); setNoteText(note?.noteText || ''); setNoteType(note?.noteType || 'general'); setNoteVisibility(note?.visibility || 'hiring_team'); setModal('note'); setError(''); };
  const canEditNote = (note: HiringApplicantDetails['notes'][number]) => note.authorName === user.name || user.role === 'hr_admin';

  return (
    <section className={cn('min-w-0 rounded-xl border border-emerald-500/15 bg-white/90 p-3 shadow-xl backdrop-blur-sm dark:bg-[#061411]/90 md:p-4', isRtl && 'text-right')}>
      <div className="mb-4 flex flex-col gap-3 border-b border-emerald-500/15 pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div><div className="flex items-center gap-2"><BriefcaseBusiness className="h-5 w-5 text-emerald-500" /><h2 className="text-lg font-black text-slate-900 dark:text-emerald-50">{t('hiring.title')}</h2></div><p className="mt-1 text-sm text-neutral-600 dark:text-emerald-100/55">{t('hiring.subtitle')}</p></div>
        <div className="flex flex-wrap gap-2">{(['new', 'hr_review', 'final_review'] as HiringStage[]).map((stage) => <span key={stage} className="rounded-full border border-emerald-500/15 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-200">{stageLabel(stage)} <span dir="ltr">{applicants.filter((item) => item.stage === stage).length}</span></span>)}{can('hiring.create') && <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-black uppercase tracking-wider text-[#02110b] transition hover:bg-emerald-400"><FilePlus2 className="h-4 w-4" />{t('hiring.addApplicant')}</button>}</div>
      </div>

      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-7">
        <input aria-label={t('hiring.search')} value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder={t('hiring.search')} className="min-w-0 rounded-lg border border-emerald-500/20 bg-black/5 px-3 py-2 text-base text-slate-900 outline-none focus:border-emerald-500 dark:bg-black/35 dark:text-emerald-50 sm:col-span-2 xl:col-span-2" />
        <select aria-label={t('hiring.stage')} value={filters.stage || ''} onChange={(event) => setFilters((current) => ({ ...current, page: 1, stage: event.target.value as HiringStage | '' }))} className="rounded-lg border border-emerald-500/20 bg-black/5 px-3 py-2 text-sm dark:bg-black/35"><option value="">{t('hiring.allStages')}</option>{HIRING_STAGES.map((stage) => <option value={stage} key={stage}>{stageLabel(stage)}</option>)}</select>
        <select aria-label={t('hiring.status')} value={filters.status || 'active'} onChange={(event) => setFilters((current) => ({ ...current, page: 1, status: event.target.value as HiringStatus }))} className="rounded-lg border border-emerald-500/20 bg-black/5 px-3 py-2 text-sm dark:bg-black/35"><option value="active">{t('enum.active')}</option><option value="archived">{t('enum.archived')}</option></select>
        <input aria-label={t('hiring.position')} value={filters.position || ''} onChange={(event) => setFilters((current) => ({ ...current, page: 1, position: event.target.value }))} placeholder={t('hiring.position')} className="rounded-lg border border-emerald-500/20 bg-black/5 px-3 py-2 text-base dark:bg-black/35" />
        <input aria-label={t('hiring.department')} value={filters.department || ''} onChange={(event) => setFilters((current) => ({ ...current, page: 1, department: event.target.value }))} placeholder={t('hiring.department')} className="rounded-lg border border-emerald-500/20 bg-black/5 px-3 py-2 text-base dark:bg-black/35" />
        {can('hiring.assign') && <select aria-label={t('hiring.assignedReviewer')} value={filters.ownerId || ''} onChange={(event) => setFilters((current) => ({ ...current, page: 1, ownerId: event.target.value }))} className="rounded-lg border border-emerald-500/20 bg-black/5 px-3 py-2 text-sm dark:bg-black/35"><option value="">{t('hiring.allReviewers')}</option>{reviewers.map((reviewer) => <option key={reviewer.id} value={reviewer.id}>{reviewer.displayName}</option>)}</select>}
        <div className="flex gap-2"><button type="button" onClick={() => setFilters((current) => ({ ...current, page: 1, assignedToMe: !current.assignedToMe }))} className={cn('flex-1 rounded-lg border px-3 py-2 text-xs font-bold', filters.assignedToMe ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200' : 'border-emerald-500/20 text-neutral-600 dark:text-emerald-100/60')}>{t('hiring.assignedToMe')}</button><button type="button" onClick={clearFilters} title={t('hiring.clearFilters')} className="rounded-lg border border-emerald-500/20 px-3 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300"><RefreshCw className="h-4 w-4" /></button></div>
      </div>
      <ErrorMessage error={listError || error} />
      <div className="grid min-h-[520px] grid-cols-1 overflow-hidden rounded-xl border border-emerald-500/15 lg:grid-cols-[minmax(300px,42%)_1fr]">
        <div className={cn('min-w-0 border-b border-emerald-500/15 bg-emerald-50/25 dark:bg-black/15 lg:border-b-0', isRtl ? 'lg:border-l' : 'lg:border-r')}>
          <div className="max-h-[520px] overflow-y-auto p-2">{listLoading ? <div className="space-y-2 p-2">{Array.from({ length: 6 }).map((_, index) => <div className="h-20 animate-pulse rounded-lg bg-emerald-500/10" key={index} />)}</div> : applicants.length ? applicants.map((applicant) => <button type="button" key={applicant.id} onClick={() => setSelectedId(applicant.id)} className={cn('mb-1 w-full rounded-lg border p-3 text-start transition', selectedId === applicant.id ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-transparent hover:border-emerald-500/20 hover:bg-emerald-500/5')}><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate font-bold text-slate-900 dark:text-emerald-50">{applicant.fullName}</p><p className="truncate text-xs text-neutral-500 dark:text-emerald-100/50">{applicant.positionTitle}{applicant.department ? ` · ${applicant.department}` : ''}</p></div>{stageBadge(applicant.stage)}</div><div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-neutral-500 dark:text-emerald-100/45"><span>{applicant.currentOwnerName || t('hiring.unassigned')}</span><span>{dateLabel(applicant.appliedAt || applicant.createdAt, locale)}</span>{applicant.pendingHandoffs > 0 && <span className="font-bold text-amber-700 dark:text-amber-200">{t('hiring.pendingHandoff')}</span>}</div></button>) : <div className="p-8 text-center"><p className="font-bold text-neutral-600 dark:text-emerald-100/70">{t('hiring.empty')}</p>{can('hiring.create') && <button type="button" onClick={openCreate} className="mt-3 text-sm font-bold text-emerald-700 hover:text-emerald-500 dark:text-emerald-300">{t('hiring.addApplicant')}</button>}</div>}</div>
          <div className="flex items-center justify-between border-t border-emerald-500/15 px-3 py-2 text-xs text-neutral-500 dark:text-emerald-100/50"><span><span dir="ltr">{total}</span> {t('hiring.candidates')}</span><div className="flex items-center gap-2"><button type="button" disabled={(filters.page || 1) <= 1} onClick={() => setFilters((current) => ({ ...current, page: Math.max(1, (current.page || 1) - 1) }))} className="rounded p-1 disabled:opacity-35"><ChevronLeft className="h-4 w-4" /></button><span dir="ltr">{filters.page || 1} / {pages}</span><button type="button" disabled={(filters.page || 1) >= pages} onClick={() => setFilters((current) => ({ ...current, page: Math.min(pages, (current.page || 1) + 1) }))} className="rounded p-1 disabled:opacity-35"><ChevronRight className="h-4 w-4" /></button></div></div>
        </div>
        <div className="min-w-0 bg-white/40 p-3 dark:bg-[#04100d]/55 md:p-4">{detailLoading ? <div className="space-y-3"><div className="h-8 w-2/5 animate-pulse rounded bg-emerald-500/10" />{Array.from({ length: 5 }).map((_, index) => <div className="h-14 animate-pulse rounded bg-emerald-500/10" key={index} />)}</div> : detail ? <ApplicantDetail detail={detail} user={user} locale={locale} can={can} stageLabel={stageLabel} stageBadge={stageBadge} onEdit={openEdit} onNote={openNote} onStage={() => { setStageTarget(''); setStageReason(''); setModal('stage'); }} onHandoff={openHandoff} onArchive={() => setModal('archive')} onAcknowledge={acknowledge} mutationLoading={mutationLoading} /> : <div className="flex h-full min-h-[330px] items-center justify-center text-center text-sm text-neutral-500 dark:text-emerald-100/45">{detailError || t('hiring.selectApplicant')}</div>}</div>
      </div>

      {modal && <Modal title={modal === 'create' ? t('hiring.addApplicant') : modal === 'edit' ? t('hiring.editApplicant') : modal === 'note' ? (editingNoteId ? t('hiring.editNote') : t('hiring.addNote')) : modal === 'stage' ? t('hiring.advanceStage') : modal === 'handoff' ? t('hiring.passToReviewer') : t('hiring.archiveApplicant')} onClose={closeModal} isRtl={isRtl}><ErrorMessage error={error} />{message && <p className="mb-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-100">{message}{duplicateApplicantId && <button type="button" onClick={() => { setSelectedId(duplicateApplicantId); closeModal(); }} className="ms-2 font-black underline">{t('hiring.openExisting')}</button>}</p>}{(modal === 'create' || modal === 'edit') && <ApplicantForm form={form} onChange={setForm} onSubmit={submitApplicant} loading={mutationLoading} submitLabel={modal === 'create' ? t('hiring.addApplicant') : t('hiring.save')} reviewers={modal === 'create' && can('hiring.assign') ? reviewers : []} />}{modal === 'note' && <form onSubmit={submitNote} className="space-y-3"><label className="block text-sm font-bold">{t('hiring.noteText')}<textarea value={noteText} maxLength={5000} onChange={(event) => setNoteText(event.target.value)} className="mt-1 min-h-32 w-full rounded-lg border border-emerald-500/20 bg-black/5 p-3 text-base outline-none focus:border-emerald-500 dark:bg-black/35" /></label>{!editingNoteId && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Select label={t('hiring.noteType')} value={noteType} onChange={(value) => setNoteType(value as HiringNoteType)} options={HIRING_NOTE_TYPES.map((type) => [type, t(`hiring.note.${type}` as never)])} /><Select label={t('hiring.visibility')} value={noteVisibility} onChange={(value) => setNoteVisibility(value as HiringNoteVisibility)} options={[['hiring_team', t('hiring.team')], ...(can('hiring.edit') ? [['hr_only', t('hiring.hrOnly')]] : [])]} /></div>}<Submit loading={mutationLoading} label={editingNoteId ? t('hiring.save') : t('hiring.addNote')} /></form>}{modal === 'stage' && <form onSubmit={submitStage} className="space-y-3"><Select label={t('hiring.targetStage')} value={stageTarget} onChange={(value) => setStageTarget(value as HiringStage)} options={[['', t('hiring.selectStage')], ...visibleNextStages.map((stage) => [stage, stageLabel(stage)])]} /><label className="block text-sm font-bold">{t('hiring.reason')}<textarea value={stageReason} maxLength={2000} onChange={(event) => setStageReason(event.target.value)} className="mt-1 min-h-24 w-full rounded-lg border border-emerald-500/20 bg-black/5 p-3 text-base dark:bg-black/35" /></label><Submit loading={mutationLoading} label={t('hiring.advanceStage')} /></form>}{modal === 'handoff' && <form onSubmit={submitHandoff} className="space-y-3"><Select label={t('hiring.assignedReviewer')} value={reviewerId} onChange={setReviewerId} options={[['', t('hiring.selectReviewer')], ...reviewers.map((reviewer) => [reviewer.id, `${reviewer.displayName} · ${reviewer.roleLabel || reviewer.role}`])]} /><Select label={t('hiring.targetStage')} value={handoffStage} onChange={(value) => setHandoffStage(value as HiringStage)} options={[['', t('hiring.noStageChange')], ...visibleNextStages.map((stage) => [stage, stageLabel(stage)])]} /><label className="block text-sm font-bold">{t('hiring.handoffMessage')}<textarea value={handoffMessage} maxLength={2000} onChange={(event) => setHandoffMessage(event.target.value)} className="mt-1 min-h-24 w-full rounded-lg border border-emerald-500/20 bg-black/5 p-3 text-base dark:bg-black/35" /></label><Submit loading={mutationLoading} label={t('hiring.passToReviewer')} /></form>}{modal === 'archive' && <div className="space-y-4"><p className="text-sm text-neutral-600 dark:text-emerald-100/65">{t('hiring.archiveExplanation')}</p><button type="button" disabled={mutationLoading} onClick={() => void archive()} className="w-full rounded-lg bg-red-600 px-4 py-3 text-sm font-black uppercase tracking-wider text-white disabled:opacity-50">{mutationLoading ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : t('hiring.confirmArchive')}</button></div>}</Modal>}
    </section>
  );
}

function ApplicantDetail({ detail, user, locale, can, stageLabel, stageBadge, onEdit, onNote, onStage, onHandoff, onArchive, onAcknowledge, mutationLoading }: { detail: HiringApplicantDetails; user: AuthUser; locale: string; can: (permission: string) => boolean; stageLabel: (stage: HiringStage) => string; stageBadge: (stage: HiringStage) => ReactNode; onEdit: () => void; onNote: (note?: HiringApplicantDetails['notes'][number]) => void; onStage: () => void; onHandoff: () => void; onArchive: () => void; onAcknowledge: (handoff: HiringHandoff) => void; mutationLoading: boolean }) {
  const { t } = useLanguage();
  const pendingForUser = detail.handoffs.find((handoff) => handoff.status === 'pending' && handoff.toUserId === user.id);
  return <div className="space-y-5"><div className="flex flex-col gap-3 border-b border-emerald-500/15 pb-4 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h3 className="text-xl font-black text-slate-900 dark:text-emerald-50">{detail.fullName}</h3>{stageBadge(detail.stage)}</div><p className="mt-1 text-sm text-neutral-600 dark:text-emerald-100/55">{detail.positionTitle}{detail.department ? ` · ${detail.department}` : ''}</p></div><div className="flex flex-wrap gap-2">{can('hiring.edit') && <Action label={t('hiring.editApplicant')} icon={<Pencil className="h-4 w-4" />} onClick={onEdit} />}{can('hiring.add_notes') && <Action label={t('hiring.addNote')} icon={<MessageSquarePlus className="h-4 w-4" />} onClick={() => onNote()} />}{can('hiring.advance_stage') && transitions[detail.stage].length > 0 && <Action label={t('hiring.advanceStage')} icon={<Forward className="h-4 w-4" />} onClick={onStage} />}{can('hiring.assign') && <Action label={t('hiring.passToReviewer')} icon={<UserCheck className="h-4 w-4" />} onClick={onHandoff} />}{can('hiring.archive') && detail.status === 'active' && <Action label={t('hiring.archiveApplicant')} icon={<ShieldAlert className="h-4 w-4" />} onClick={onArchive} danger />}</div></div>
    {pendingForUser && <div className="flex flex-col gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-bold text-amber-800 dark:text-amber-100">{t('hiring.pendingHandoff')}</p><p className="text-sm text-amber-700/80 dark:text-amber-100/70">{pendingForUser.message || t('hiring.handoffAwaiting')}</p></div><button type="button" disabled={mutationLoading} onClick={() => onAcknowledge(pendingForUser)} className="rounded-lg bg-amber-400 px-3 py-2 text-xs font-black uppercase tracking-wider text-[#211600] disabled:opacity-50">{t('hiring.acknowledge')}</button></div>}
    <dl className="grid grid-cols-1 gap-x-5 gap-y-3 rounded-lg border border-emerald-500/15 bg-emerald-50/30 p-3 text-sm dark:bg-black/20 sm:grid-cols-2"><Detail label={t('hiring.status')} value={detail.status === 'archived' ? t('enum.archived') : t('enum.active')} /><Detail label={t('hiring.email')} value={detail.email || '—'} /><Detail label={t('hiring.phone')} value={detail.phone || '—'} /><Detail label={t('hiring.source')} value={detail.source || '—'} /><Detail label={t('hiring.assignedReviewer')} value={detail.currentOwnerName || t('hiring.unassigned')} /><Detail label={t('hiring.applicationDate')} value={dateLabel(detail.appliedAt, locale)} /><Detail label={t('hiring.updated')} value={dateLabel(detail.updatedAt, locale)} /></dl>
    <section><div className="mb-2 flex items-center justify-between"><h4 className="font-black text-slate-900 dark:text-emerald-50">{t('hiring.notes')}</h4>{detail.notes.length > 0 && <span className="text-xs text-neutral-500 dark:text-emerald-100/45" dir="ltr">{detail.notes.length}</span>}</div>{detail.notes.length ? <div className="space-y-2">{detail.notes.map((note) => <article key={note.id} className="rounded-lg border border-emerald-500/15 bg-white/50 p-3 dark:bg-black/20"><div className="flex flex-wrap items-center justify-between gap-2"><div className="text-xs font-bold text-emerald-800 dark:text-emerald-200">{note.authorName} <span className="font-normal text-neutral-500 dark:text-emerald-100/45">· {note.authorRole}</span></div><div className="flex items-center gap-2 text-[10px] text-neutral-500 dark:text-emerald-100/45"><span>{note.noteType}</span><span>{note.visibility === 'hr_only' ? t('hiring.hrOnly') : t('hiring.team')}</span><span>{dateLabel(note.createdAt, locale)}</span>{note.updatedAt && <span>{t('hiring.edited')}</span>}{(note.authorName === user.name || user.role === 'hr_admin') && can('hiring.add_notes') && <button type="button" onClick={() => onNote(note)} className="font-bold text-emerald-700 hover:text-emerald-500 dark:text-emerald-300">{t('hiring.editNote')}</button>}</div></div><p className="mt-2 whitespace-pre-wrap text-sm text-slate-700 dark:text-emerald-50/85">{note.noteText}</p></article>)}</div> : <p className="text-sm text-neutral-500 dark:text-emerald-100/45">{t('hiring.noNotes')}</p>}</section>
    <section className="grid grid-cols-1 gap-4 xl:grid-cols-2"><History title={t('hiring.stageHistory')}>{detail.stageHistory.map((item) => <li key={item.id} className="border-b border-emerald-500/10 py-2 last:border-0"><p className="text-sm font-bold">{item.previousStage ? `${stageLabel(item.previousStage)} → ` : ''}{stageLabel(item.newStage)}</p><p className="text-xs text-neutral-500 dark:text-emerald-100/45">{item.actorName} · {dateLabel(item.createdAt, locale)}{item.reason ? ` · ${item.reason}` : ''}</p></li>)}</History><History title={t('hiring.handoffHistory')}>{detail.handoffs.map((handoff) => <li key={handoff.id} className="border-b border-emerald-500/10 py-2 last:border-0"><p className="text-sm font-bold">{handoff.fromUserName || t('hiring.unassigned')} → {handoff.toUserName}</p><p className="text-xs text-neutral-500 dark:text-emerald-100/45">{handoff.status} · {dateLabel(handoff.createdAt, locale)}{handoff.message ? ` · ${handoff.message}` : ''}</p></li>)}</History></section>
  </div>;
}
function History({ title, children }: { title: string; children: ReactNode }) { return <section><h4 className="mb-2 font-black text-slate-900 dark:text-emerald-50">{title}</h4><ul className="rounded-lg border border-emerald-500/15 bg-emerald-50/20 px-3 dark:bg-black/15">{children || <li className="py-3 text-sm text-neutral-500">—</li>}</ul></section>; }
function Detail({ label, value }: { label: string; value: string }) { return <div><dt className="text-[10px] font-black uppercase tracking-wider text-neutral-500 dark:text-emerald-100/45">{label}</dt><dd className="mt-0.5 break-words text-slate-800 dark:text-emerald-50">{value}</dd></div>; }
function Action({ label, icon, onClick, danger }: { label: string; icon: ReactNode; onClick: () => void; danger?: boolean }) { return <button type="button" title={label} onClick={onClick} className={cn('inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-bold transition', danger ? 'border-red-500/25 text-red-700 hover:bg-red-500/10 dark:text-red-200' : 'border-emerald-500/20 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300')}>{icon}<span className="hidden xl:inline">{label}</span></button>; }
function Modal({ title, children, onClose, isRtl }: { title: string; children: ReactNode; onClose: () => void; isRtl: boolean }) { return <div className="fixed inset-0 z-[70] flex items-end bg-black/60 p-3 backdrop-blur-sm sm:items-center sm:justify-center" role="presentation" onMouseDown={onClose}><section role="dialog" aria-modal="true" aria-label={title} dir={isRtl ? 'rtl' : 'ltr'} onMouseDown={(event) => event.stopPropagation()} className="max-h-[calc(100dvh-1.5rem)] w-full max-w-lg overflow-y-auto rounded-xl border border-emerald-500/25 bg-white p-4 shadow-2xl dark:bg-[#061411] sm:p-5"><div className="mb-4 flex items-center justify-between"><h3 className="text-base font-black text-slate-900 dark:text-emerald-50">{title}</h3><button type="button" aria-label="Close" onClick={onClose} className="rounded-lg p-2 text-neutral-500 hover:bg-emerald-500/10 hover:text-emerald-600"><X className="h-4 w-4" /></button></div>{children}</section></div>; }
function ApplicantForm({ form, onChange, onSubmit, loading, submitLabel, reviewers }: { form: HiringApplicantInput; onChange: (value: HiringApplicantInput) => void; onSubmit: (event: React.FormEvent) => void; loading: boolean; submitLabel: string; reviewers: HiringReviewer[] }) { const { t } = useLanguage(); const field = (key: keyof HiringApplicantInput, label: string, type = 'text') => <label className="block text-sm font-bold">{label}<input type={type} value={form[key] || ''} onChange={(event) => onChange({ ...form, [key]: event.target.value })} className="mt-1 w-full rounded-lg border border-emerald-500/20 bg-black/5 px-3 py-2 text-base outline-none focus:border-emerald-500 dark:bg-black/35" /></label>; return <form onSubmit={onSubmit} className="space-y-3"><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{field('fullName', t('hiring.fullName'))}{field('positionTitle', t('hiring.position'))}{field('email', t('hiring.email'), 'email')}{field('phone', t('hiring.phone'))}{field('department', t('hiring.department'))}{field('source', t('hiring.source'))}{field('appliedAt', t('hiring.applicationDate'), 'date')}{reviewers.length > 0 && <Select label={t('hiring.assignedReviewer')} value={form.currentOwnerId || ''} onChange={(currentOwnerId) => onChange({ ...form, currentOwnerId: currentOwnerId || undefined })} options={[['', t('hiring.unassigned')], ...reviewers.map((reviewer) => [reviewer.id, reviewer.displayName])]} />}</div><Submit loading={loading} label={submitLabel} /></form>; }
function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[][] }) { return <label className="block text-sm font-bold">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-lg border border-emerald-500/20 bg-black/5 px-3 py-2 text-base dark:bg-black/35">{options.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>; }
function Submit({ loading, label }: { loading: boolean; label: string }) { return <button type="submit" disabled={loading} className="flex w-full items-center justify-center rounded-lg bg-emerald-500 px-4 py-3 text-sm font-black uppercase tracking-wider text-[#02110b] transition hover:bg-emerald-400 disabled:opacity-50">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : label}</button>; }
