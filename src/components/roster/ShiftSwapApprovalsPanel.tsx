import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ClipboardCheck, RefreshCw, X } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { useLanguage } from '../../lib/LanguageContext';

type Swap = {
  swapId: string;
  requester: { name: string };
  target: { name: string };
  requesterShift: { start: string; end: string };
  targetShift: { start: string; end: string };
  status: string;
  approver?: { name: string } | null;
  approvalSource?: string | null;
  version: number;
};

export function ShiftSwapApprovalsPanel() {
  const { lang, isRtl } = useLanguage();
  const isArabic = lang === 'ar';
  const text = (en: string, arabic: string) => isArabic ? arabic : en;
  const reviewButtonRef = useRef<HTMLButtonElement>(null);
  const [items, setItems] = useState<Swap[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<Swap | null>(null);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await apiFetch('/api/hr/shift-swaps?actionableOnly=true&page=1&pageSize=50');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || text('Unable to load approvals.', 'تعذر تحميل الموافقات.'));
      setItems(data.swaps || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text('Unable to load approvals.', 'تعذر تحميل الموافقات.'));
    } finally {
      setLoading(false);
    }
  }, [isArabic]);

  const closeReview = useCallback(() => {
    setSelected(null); setNote('');
    window.setTimeout(() => reviewButtonRef.current?.focus(), 0);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) closeReview(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, closeReview, selected]);

  const act = async (decision: 'approve' | 'reject') => {
    if (!selected) return;
    setBusy(decision);
    try {
      const response = await apiFetch(`/api/hr/shift-swaps/${selected.swapId}/${decision}`, { method: 'POST', body: JSON.stringify({ expectedVersion: selected.version, note }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || text('This request changed. Refresh and try again.', 'تم تغيير الطلب. حدّث الصفحة وحاول مجدداً.'));
      closeReview();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text('Unable to save decision.', 'تعذر حفظ القرار.'));
    } finally {
      setBusy(null);
    }
  };

  const date = (value: string) => new Intl.DateTimeFormat(isArabic ? 'ar-EG' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

  return (
    <section dir={isRtl ? 'rtl' : 'ltr'} className="w-full p-3 sm:p-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-emerald-50"><ClipboardCheck className="h-5 w-5 text-emerald-500" />{text('Shift Swap Approvals', 'موافقات تبديل المناوبات')}</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500 dark:text-emerald-100/55">{text('Only requests in your current authorised scope are shown here.', 'تظهر هنا فقط الطلبات الواقعة ضمن نطاق صلاحيتك الحالي.')}</p>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex min-h-10 items-center justify-center rounded-md border border-emerald-500/20 px-3 text-emerald-700 hover:bg-emerald-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 dark:text-emerald-200" aria-label={text('Refresh approvals', 'تحديث الموافقات')}><RefreshCw className="h-4 w-4" /></button>
      </header>

      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <article className="rounded-lg border border-emerald-500/15 bg-white/75 p-3 shadow-sm dark:bg-black/25"><p className="text-xl font-bold text-slate-900 dark:text-emerald-50">{items.length}</p><p className="mt-1 text-[11px] text-slate-500 dark:text-emerald-100/50">{text('Actionable', 'قابلة للإجراء')}</p></article>
        <article className="rounded-lg border border-emerald-500/15 bg-white/75 p-3 shadow-sm dark:bg-black/25"><p className="text-xl font-bold text-slate-900 dark:text-emerald-50">{items.filter((item) => item.approvalSource).length}</p><p className="mt-1 text-[11px] text-slate-500 dark:text-emerald-100/50">{text('Scoped authority', 'صلاحية محددة النطاق')}</p></article>
        <article className="col-span-2 rounded-lg border border-emerald-500/15 bg-white/75 p-3 shadow-sm dark:bg-black/25 sm:col-span-1"><p className="text-[11px] leading-4 text-slate-600 dark:text-emerald-100/60">{text('Approval applies the roster change immediately after all current checks pass.', 'تُطبّق الموافقة تغيير الجدول فوراً بعد اجتياز جميع الفحوص الحالية.')}</p></article>
      </div>

      {error && <div role="alert" className="mt-4 flex flex-col gap-3 rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-200 sm:flex-row sm:items-center sm:justify-between"><span>{error}</span><button type="button" onClick={() => void load()} className="min-h-9 rounded border border-current px-3 font-bold">{text('Retry', 'إعادة المحاولة')}</button></div>}
      {loading ? <p className="py-12 text-center text-xs text-slate-500 dark:text-emerald-100/50">{text('Loading approvals...', 'جارٍ تحميل الموافقات...')}</p> : items.length === 0 ? (
        <div className="mt-4 flex min-h-52 flex-col items-center justify-center rounded-lg border border-dashed border-emerald-500/20 p-5 text-center"><Check className="h-8 w-8 text-emerald-500/70" /><p className="mt-3 text-sm font-bold text-slate-800 dark:text-emerald-50">{text('No actionable approvals.', 'لا توجد موافقات قابلة للإجراء.')}</p><p className="mt-2 max-w-md text-xs leading-5 text-slate-500 dark:text-emerald-100/50">{text('New requests will appear only when they are within your current authority scope.', 'تظهر الطلبات الجديدة فقط عندما تكون ضمن نطاق صلاحيتك الحالي.')}</p></div>
      ) : <div className="mt-4 grid gap-3 md:grid-cols-2">{items.map((swap, index) => <article key={swap.swapId} className="min-w-0 rounded-lg border border-emerald-500/15 bg-white/75 p-4 shadow-sm dark:bg-black/25"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-900 dark:text-emerald-50">{swap.requester.name} <span className="text-slate-400">↔</span> {swap.target.name}</p><span className="mt-2 inline-flex rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-200">{swap.approvalSource || text('Authorised approver', 'مخوّل بالموافقة')}</span></div></div><dl className="mt-4 grid gap-2 text-xs text-slate-600 dark:text-emerald-100/60"><div className="flex justify-between gap-3"><dt>{swap.requester.name}</dt><dd dir="ltr" className="text-end">{date(swap.requesterShift.start)}</dd></div><div className="flex justify-between gap-3"><dt>{swap.target.name}</dt><dd dir="ltr" className="text-end">{date(swap.targetShift.start)}</dd></div></dl><button ref={index === 0 ? reviewButtonRef : undefined} type="button" onClick={() => setSelected(swap)} className="mt-4 min-h-10 rounded-md bg-emerald-600 px-3 py-2 text-xs font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">{text('Review request', 'مراجعة الطلب')}</button></article>)}</div>}

      {selected && <div role="dialog" aria-modal="true" aria-labelledby="shift-swap-review-title" className="fixed inset-0 z-50 flex items-end bg-black/60 p-3 sm:items-center sm:justify-center"><div className="max-h-[calc(100dvh-1.5rem)] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl dark:bg-[#07150f]"><div className="flex items-start justify-between gap-3"><div><h3 id="shift-swap-review-title" className="text-base font-bold text-slate-900 dark:text-emerald-50">{text('Review shift swap', 'مراجعة تبديل المناوبة')}</h3><p className="mt-1 text-xs text-slate-500 dark:text-emerald-100/50">{selected.approvalSource || text('Authorised approver', 'مخوّل بالموافقة')}</p></div><button type="button" disabled={Boolean(busy)} onClick={closeReview} aria-label={text('Close', 'إغلاق')} className="min-h-10 min-w-10 rounded-md text-slate-600 hover:bg-emerald-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 dark:text-emerald-100"><X className="mx-auto h-5 w-5" /></button></div><div className="mt-5 rounded-lg border border-emerald-500/15 bg-emerald-500/5 p-4 text-xs text-slate-700 dark:text-emerald-100/70"><p><strong>{selected.requester.name}</strong> <span dir="ltr">{date(selected.requesterShift.start)} – {date(selected.requesterShift.end)}</span></p><p className="mt-3"><strong>{selected.target.name}</strong> <span dir="ltr">{date(selected.targetShift.start)} – {date(selected.targetShift.end)}</span></p></div><label className="mt-4 block text-xs font-bold text-slate-700 dark:text-emerald-100/70">{text('Note (optional)', 'ملاحظة (اختيارية)')}<textarea value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} className="mt-1 w-full resize-y rounded-md border border-emerald-500/20 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-400 dark:bg-black/35 dark:text-emerald-50" /></label><div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" disabled={Boolean(busy)} onClick={() => void act('reject')} className="min-h-11 rounded-lg border border-red-400/30 px-4 py-2 text-xs font-bold text-red-700 disabled:opacity-55 dark:text-red-200">{busy === 'reject' ? text('Saving...', 'جارٍ الحفظ...') : text('Reject', 'رفض')}</button><button type="button" disabled={Boolean(busy)} onClick={() => void act('approve')} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-55"><Check className="h-4 w-4" />{busy === 'approve' ? text('Saving...', 'جارٍ الحفظ...') : text('Approve and apply', 'موافقة وتطبيق')}</button></div></div></div>}
    </section>
  );
}
