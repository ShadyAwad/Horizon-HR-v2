import { useEffect } from 'react';
import { Info, X } from 'lucide-react';
import { useLanguage } from '../lib/LanguageContext';

export function DemoNoticeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, isRtl } = useLanguage();

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open, onClose]);

  if (!open) return null;
  return <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
    <section role="dialog" aria-modal="true" aria-labelledby="demo-notice-title" dir={isRtl ? 'rtl' : 'ltr'} className="w-full max-w-md rounded-xl border border-emerald-500/20 bg-[#061411] p-5 shadow-2xl shadow-black/50" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-start justify-between gap-3"><div className="flex items-center gap-2 text-emerald-300"><Info className="h-5 w-5" /><h2 id="demo-notice-title" className="text-sm font-black uppercase tracking-widest">{t('demo.title')}</h2></div><button type="button" onClick={onClose} aria-label={t('demo.dismiss')} className="text-emerald-100/60 hover:text-emerald-200"><X className="h-4 w-4" /></button></div>
      <p className="mt-3 text-sm leading-6 text-emerald-50/75">{t('demo.body')}</p>
      <button type="button" onClick={onClose} className="mt-5 rounded-lg bg-emerald-500 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-black hover:bg-emerald-400">{t('demo.dismiss')}</button>
    </section>
  </div>;
}
