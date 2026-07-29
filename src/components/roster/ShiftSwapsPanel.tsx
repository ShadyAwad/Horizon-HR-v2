import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRightLeft, Check, RefreshCw, X } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { useLanguage } from '../../lib/LanguageContext';

type Shift = { id: string; startTime: string; endTime: string; teamName?: string; locationName?: string };
type Person = { id: string; fullName: string; teamName?: string };
type Swap = { swapId: string; requesterEmployeeId: string; targetEmployeeId: string; status: string; submittedAt: string; targetRespondedAt?: string; version: number };

const labels: Record<string, [string, string]> = {
  pending_target: ['Waiting for coworker', 'بانتظار الزميل'],
  target_declined: ['Coworker declined', 'رفض الزميل'],
  pending_approval: ['Waiting for approval', 'بانتظار الموافقة'],
  applied: ['Approved and applied', 'تمت الموافقة والتطبيق'],
  rejected: ['Rejected', 'مرفوض'],
  cancelled: ['Cancelled', 'ملغى'],
  expired: ['Expired', 'منتهي'],
};

const format = (value: string, lang: string) => new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

export function ShiftSwapsPanel({ employeeId }: { employeeId: string }) {
  const { lang, isRtl } = useLanguage();
  const isArabic = lang === 'ar';
  const text = (en: string, arabic: string) => isArabic ? arabic : en;
  const requestButtonRef = useRef<HTMLButtonElement>(null);
  const [swaps, setSwaps] = useState<Swap[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [role, setRole] = useState<'all' | 'requester' | 'target'>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [own, setOwn] = useState<Shift[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [targets, setTargets] = useState<Shift[]>([]);
  const [ownId, setOwnId] = useState('');
  const [personId, setPersonId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    window.setTimeout(() => requestButtonRef.current?.focus(), 0);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const query = role === 'all' ? '' : `?role=${role}`;
      const response = await apiFetch(`/api/me/shift-swaps${query}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || text('Unable to load shift swaps.', 'تعذر تحميل طلبات تبديل المناوبات.'));
      setSwaps(data.swaps || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text('Unable to load shift swaps.', 'تعذر تحميل طلبات تبديل المناوبات.'));
    } finally {
      setLoading(false);
    }
  }, [isArabic, role]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!dialogOpen) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && busy !== 'create') closeDialog(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, closeDialog, dialogOpen]);
  useEffect(() => {
    if (!dialogOpen) return;
    void apiFetch('/api/me/shift-swaps/eligible-shifts')
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setOwn(data.shifts || []);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : text('Unable to load eligible shifts.', 'تعذر تحميل المناوبات المتاحة.')));
  }, [dialogOpen, isArabic]);
  useEffect(() => {
    if (!ownId) return;
    void apiFetch(`/api/me/shift-swaps/${ownId}/eligible-employees`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setPeople(data.employees || []);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : text('Unable to load coworkers.', 'تعذر تحميل الزملاء.')));
  }, [isArabic, ownId]);
  useEffect(() => {
    if (!ownId || !personId) return;
    void apiFetch(`/api/me/shift-swaps/eligible-target-shifts?employeeId=${personId}&requesterShiftId=${ownId}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setTargets(data.shifts || []);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : text('Unable to load coworker shifts.', 'تعذر تحميل مناوبات الزميل.')));
  }, [isArabic, ownId, personId]);

  const act = async (swap: Swap, action: 'accept' | 'decline' | 'cancel') => {
    setBusy(swap.swapId);
    try {
      const url = action === 'cancel' ? `/api/me/shift-swaps/${swap.swapId}/cancel` : `/api/me/shift-swaps/${swap.swapId}/respond`;
      const response = await apiFetch(url, { method: 'POST', body: action === 'cancel' ? undefined : JSON.stringify({ decision: action }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text('Unable to update request.', 'تعذر تحديث الطلب.'));
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    if (!ownId || !personId || !targetId) return;
    setBusy('create');
    try {
      const response = await apiFetch('/api/me/shift-swaps', { method: 'POST', body: JSON.stringify({ requesterShiftId: ownId, targetEmployeeId: personId, targetShiftId: targetId, reason }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setOwnId(''); setPersonId(''); setTargetId(''); setReason('');
      closeDialog();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text('Unable to request swap.', 'تعذر طلب التبديل.'));
    } finally {
      setBusy(null);
    }
  };

  const incoming = swaps.filter((swap) => swap.targetEmployeeId === employeeId).length;
  const outgoing = swaps.filter((swap) => swap.requesterEmployeeId === employeeId).length;
  const pendingApproval = swaps.filter((swap) => swap.status === 'pending_approval').length;
  const completed = swaps.filter((swap) => ['applied', 'rejected', 'cancelled', 'target_declined', 'expired'].includes(swap.status)).length;

  return (
    <section dir={isRtl ? 'rtl' : 'ltr'} className="w-full p-3 sm:p-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-emerald-50"><ArrowRightLeft className="h-5 w-5 text-emerald-500" />{text('My Shift Swaps', 'تبديل مناوباتي')}</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500 dark:text-emerald-100/55">{text('Request, accept, or follow the approval of exchanges with eligible coworkers.', 'اطلب تبديل المناوبات مع الزملاء المؤهلين أو اقبل الطلبات وتابع الموافقات.')}</p>
        </div>
        <button ref={requestButtonRef} type="button" onClick={() => setDialogOpen(true)} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">
          <ArrowRightLeft className="h-4 w-4" />{text('Request swap', 'طلب تبديل')}
        </button>
      </header>

      <div className="mt-5 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {[
          [text('Incoming', 'الواردة'), incoming], [text('Outgoing', 'الصادرة'), outgoing],
          [text('Pending approval', 'بانتظار الموافقة'), pendingApproval], [text('Completed', 'المكتملة'), completed],
        ].map(([label, count]) => <article key={String(label)} className="min-w-0 rounded-lg border border-emerald-500/15 bg-white/75 p-3 shadow-sm dark:bg-black/25"><p className="text-xl font-bold text-slate-900 dark:text-emerald-50">{count}</p><p className="mt-1 text-[11px] text-slate-500 dark:text-emerald-100/50">{label}</p></article>)}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2" aria-label={text('Shift swap filters', 'عوامل تصفية تبديل المناوبات')}>
        {(['all', 'target', 'requester'] as const).map((value) => <button key={value} type="button" aria-pressed={role === value} onClick={() => setRole(value)} className={`min-h-10 rounded-md border px-3 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${role === value ? 'border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200' : 'border-emerald-500/20 text-slate-600 hover:bg-emerald-500/10 dark:text-emerald-100/60'}`}>{text(value === 'all' ? 'All' : value === 'target' ? 'Incoming' : 'Outgoing', value === 'all' ? 'الكل' : value === 'target' ? 'الواردة' : 'الصادرة')}</button>)}
        <button type="button" onClick={() => void load()} className="inline-flex min-h-10 items-center justify-center rounded-md border border-emerald-500/20 px-3 text-emerald-700 transition hover:bg-emerald-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 dark:text-emerald-200" aria-label={text('Refresh shift swaps', 'تحديث طلبات التبديل')}><RefreshCw className="h-4 w-4" /></button>
      </div>

      {error && <div role="alert" className="mt-4 flex flex-col gap-3 rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-200 sm:flex-row sm:items-center sm:justify-between"><span>{error}</span><button type="button" onClick={() => void load()} className="min-h-9 rounded border border-current px-3 font-bold">{text('Retry', 'إعادة المحاولة')}</button></div>}
      {loading ? <p className="py-12 text-center text-xs text-slate-500 dark:text-emerald-100/50">{text('Loading shift swaps...', 'جارٍ تحميل طلبات التبديل...')}</p> : swaps.length === 0 ? (
        <div className="mt-4 flex min-h-52 flex-col items-center justify-center rounded-lg border border-dashed border-emerald-500/20 p-5 text-center">
          <ArrowRightLeft className="h-8 w-8 text-emerald-500/70" />
          <p className="mt-3 text-sm font-bold text-slate-800 dark:text-emerald-50">{text('No shift swaps yet.', 'لا توجد طلبات تبديل بعد.')}</p>
          <p className="mt-2 max-w-md text-xs leading-5 text-slate-500 dark:text-emerald-100/50">{text('Choose one of your future shifts, then select an eligible coworker and their shift to start a request.', 'اختر إحدى مناوباتك القادمة، ثم اختر زميلاً مؤهلاً ومناوبته لبدء الطلب.')}</p>
          <button type="button" onClick={() => setDialogOpen(true)} className="mt-4 min-h-10 rounded-md border border-emerald-500/25 px-3 text-xs font-bold text-emerald-700 hover:bg-emerald-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 dark:text-emerald-200">{text('Request swap', 'طلب تبديل')}</button>
        </div>
      ) : <div className="mt-4 grid gap-3 md:grid-cols-2">{swaps.map((swap) => <article key={swap.swapId} className="min-w-0 rounded-lg border border-emerald-500/15 bg-white/75 p-4 shadow-sm dark:bg-black/25"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold text-slate-900 dark:text-emerald-50">{labels[swap.status]?.[isArabic ? 1 : 0] || swap.status}</p><p className="mt-1 text-xs text-slate-500 dark:text-emerald-100/50">{swap.requesterEmployeeId === employeeId ? text('Outgoing request', 'طلب صادر') : text('Incoming request', 'طلب وارد')}</p></div><span className="shrink-0 text-[11px] text-slate-500 dark:text-emerald-100/45">{format(swap.submittedAt, lang)}</span></div><div className="mt-4 flex flex-wrap gap-2">{swap.targetEmployeeId === employeeId && swap.status === 'pending_target' && <><button type="button" disabled={busy === swap.swapId} onClick={() => void act(swap, 'accept')} className="min-h-10 rounded-md bg-emerald-600 px-3 text-xs font-bold text-white disabled:opacity-55"><Check className="me-1 inline h-3 w-3" />{text('Accept', 'قبول')}</button><button type="button" disabled={busy === swap.swapId} onClick={() => void act(swap, 'decline')} className="min-h-10 rounded-md border border-red-400/30 px-3 text-xs font-bold text-red-700 dark:text-red-200">{text('Decline', 'رفض')}</button></>}{swap.requesterEmployeeId === employeeId && ['pending_target', 'pending_approval'].includes(swap.status) && <button type="button" disabled={busy === swap.swapId} onClick={() => void act(swap, 'cancel')} className="min-h-10 rounded-md border border-red-400/30 px-3 text-xs font-bold text-red-700 disabled:opacity-55 dark:text-red-200">{text('Cancel request', 'إلغاء الطلب')}</button>}</div></article>)}</div>}

      {dialogOpen && <div role="dialog" aria-modal="true" aria-labelledby="shift-swap-dialog-title" className="fixed inset-0 z-50 flex items-end bg-black/60 p-3 sm:items-center sm:justify-center"><div className="max-h-[calc(100dvh-1.5rem)] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl dark:bg-[#07150f]"><div className="flex items-start justify-between gap-3"><div><h3 id="shift-swap-dialog-title" className="text-base font-bold text-slate-900 dark:text-emerald-50">{text('Request shift swap', 'طلب تبديل مناوبة')}</h3><p className="mt-1 text-xs text-slate-500 dark:text-emerald-100/50">{text('Your shift remains unchanged until the request is accepted and approved.', 'تبقى مناوبتك دون تغيير إلى أن يُقبل الطلب ويُعتمد.')}</p></div><button type="button" onClick={closeDialog} disabled={busy === 'create'} aria-label={text('Close', 'إغلاق')} className="min-h-10 min-w-10 rounded-md text-slate-600 hover:bg-emerald-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 dark:text-emerald-100"><X className="mx-auto h-5 w-5" /></button></div><div className="mt-5 space-y-4"><label className="block text-xs font-bold text-slate-700 dark:text-emerald-100/70">{text('Your future shift', 'مناوبتك القادمة')}<select value={ownId} onChange={(event) => { setOwnId(event.target.value); setPersonId(''); setTargetId(''); }} className="stanza-select mt-1 w-full"><option value="">{text('Select a shift', 'اختر مناوبة')}</option>{own.map((shift) => <option key={shift.id} value={shift.id}>{format(shift.startTime, lang)}</option>)}</select></label><label className="block text-xs font-bold text-slate-700 dark:text-emerald-100/70">{text('Coworker', 'الزميل')}<select value={personId} disabled={!ownId} onChange={(event) => { setPersonId(event.target.value); setTargetId(''); }} className="stanza-select mt-1 w-full"><option value="">{text('Select coworker', 'اختر زميلاً')}</option>{people.map((person) => <option key={person.id} value={person.id}>{person.fullName}</option>)}</select></label><label className="block text-xs font-bold text-slate-700 dark:text-emerald-100/70">{text('Coworker shift', 'مناوبة الزميل')}<select value={targetId} disabled={!personId} onChange={(event) => setTargetId(event.target.value)} className="stanza-select mt-1 w-full"><option value="">{text('Select a shift', 'اختر مناوبة')}</option>{targets.map((shift) => <option key={shift.id} value={shift.id}>{format(shift.startTime, lang)}</option>)}</select></label><label className="block text-xs font-bold text-slate-700 dark:text-emerald-100/70">{text('Reason (optional)', 'السبب (اختياري)')}<textarea value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} className="mt-1 w-full resize-y rounded-md border border-emerald-500/20 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-400 dark:bg-black/35 dark:text-emerald-50" /></label><button type="button" disabled={!ownId || !personId || !targetId || busy === 'create'} onClick={() => void submit()} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">{busy === 'create' ? text('Sending request...', 'جارٍ إرسال الطلب...') : text('Send request', 'إرسال الطلب')}</button></div></div></div>}
    </section>
  );
}
