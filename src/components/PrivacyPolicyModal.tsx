import { useEffect } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import { useLanguage } from '../lib/LanguageContext';

export function PrivacyPolicyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, isRtl } = useLanguage();

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open, onClose]);

  if (!open) return null;

  const sections = [
    [t('privacy.overview'), t('privacy.overviewText')],
    [t('privacy.data'), t('privacy.dataText')],
    [t('privacy.location'), t('privacy.locationText')],
    [t('privacy.passkeys'), t('privacy.passkeysText')],
    [t('privacy.demoData'), t('privacy.demoDataText')],
    [t('privacy.recovery'), t('privacy.recoveryText')],
    [t('privacy.thirdParties'), t('privacy.thirdPartiesText')],
    [t('privacy.security'), t('privacy.securityText')],
  ];

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm" onClick={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="privacy-policy-title" dir={isRtl ? 'rtl' : 'ltr'} className={`max-h-[85dvh] w-full max-w-2xl overflow-y-auto rounded-xl border border-emerald-500/20 bg-[#061411] p-5 shadow-2xl shadow-black/50 ${isRtl ? 'text-right' : 'text-left'}`} onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2 text-emerald-300">
            <ShieldCheck className="h-5 w-5" />
            <h2 id="privacy-policy-title" className="text-sm font-black uppercase tracking-widest">{t('privacy.title')}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label={t('privacy.close')} className="rounded-lg border border-emerald-500/20 p-2 text-emerald-200 transition hover:border-emerald-400 focus-visible:ring-2 focus-visible:ring-emerald-400"><X className="h-4 w-4" /></button>
        </div>
        <p className="mt-3 rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100/90">{t('privacy.notLegalAdvice')}</p>
        <div className="mt-5 space-y-5 text-sm leading-6 text-emerald-50/75">
          {sections.map(([heading, body]) => <div key={heading}><h3 className="font-bold text-emerald-200">{heading}</h3><p className="mt-1">{body}</p></div>)}
          <div><h3 className="font-bold text-emerald-200">{t('privacy.contact')}</h3><p className="mt-1">{t('privacy.createdBy')} <a className="text-emerald-300 underline hover:text-emerald-200" href="https://shadyawad.github.io/portfolio/" target="_blank" rel="noreferrer">Shady Awad</a>.</p></div>
        </div>
      </section>
    </div>
  );
}
