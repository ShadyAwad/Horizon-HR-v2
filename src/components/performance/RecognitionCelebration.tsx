import { useEffect } from 'react';
import { Award, X } from 'lucide-react';
import { useLanguage } from '../../lib/LanguageContext';

export type RecognitionCelebrationPayload = {
  recognitionId: string;
  title: string;
  message: string | null;
  recognitionMonth: string | null;
};

export function RecognitionCelebration({ recognition, onClose }: { recognition: RecognitionCelebrationPayload; onClose: () => void }) {
  const { lang, isRtl } = useLanguage();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
  const month = recognition.recognitionMonth ? new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-US', { month: 'long', year: 'numeric' }).format(new Date(`${recognition.recognitionMonth}T00:00:00Z`)) : '';
  return <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="presentation">
    <div className="absolute inset-0 bg-black/55" onClick={onClose} />
    <section role="dialog" aria-modal="true" aria-labelledby="recognition-title" dir={isRtl ? 'rtl' : 'ltr'} className="relative w-full max-w-md overflow-hidden rounded-xl border border-emerald-400/30 bg-neutral-950 p-6 text-center shadow-2xl shadow-emerald-950/40">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-emerald-500/10" />
      <div className="performance-confetti pointer-events-none absolute inset-0" aria-hidden="true">{Array.from({ length: 18 }, (_, index) => <i key={index} style={{ '--piece': index } as React.CSSProperties} />)}</div>
      <button type="button" onClick={onClose} aria-label="Close" className="absolute end-3 top-3 rounded-md p-1 text-emerald-100/60 hover:bg-emerald-500/10 hover:text-emerald-50"><X className="h-4 w-4" /></button>
      <Award className="relative mx-auto h-10 w-10 text-emerald-400" />
      <h2 id="recognition-title" className="relative mt-4 text-xl font-bold text-emerald-50">{recognition.title}</h2>
      <p className="relative mt-2 text-sm text-emerald-100/75">{lang === 'ar' ? 'تهانينا! تم اختيارك موظف الشهر.' : "Congratulations! You've been recognised as Employee of the Month."}</p>
      {month && <p className="relative mt-2 text-xs font-semibold uppercase tracking-wide text-emerald-300/70">{month}</p>}
      {recognition.message && <p className="relative mt-4 text-sm leading-6 text-emerald-50/85">{recognition.message}</p>}
      <button type="button" onClick={onClose} className="relative mt-6 rounded-md bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500">{lang === 'ar' ? 'متابعة' : 'Continue'}</button>
    </section>
  </div>;
}
