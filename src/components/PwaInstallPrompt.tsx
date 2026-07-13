import { useEffect, useMemo, useState } from 'react';

import { useLanguage } from '../lib/LanguageContext';
import { StanzaFingerprintMark } from './StanzaFingerprintMark';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

type NavigatorWithStandalone = Navigator & { standalone?: boolean };
type InstallPlatform = 'android' | 'ios' | 'desktop';

const isStandaloneMode = () => (
  window.matchMedia('(display-mode: standalone)').matches ||
  Boolean((navigator as NavigatorWithStandalone).standalone)
);

const detectPlatform = (): InstallPlatform | null => {
  const userAgent = navigator.userAgent;
  const isIos = /iphone|ipad|ipod/i.test(userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIos) return 'ios';
  if (/android/i.test(userAgent)) return 'android';
  if (/(chrome|chromium|edg)\//i.test(userAgent)) return 'desktop';
  return null;
};

export function PwaInstallPrompt() {
  const { t, isRtl } = useLanguage();
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(isStandaloneMode);
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState('');
  const platform = useMemo(detectPlatform, []);

  useEffect(() => {
    const displayMode = window.matchMedia('(display-mode: standalone)');
    const updateStandalone = () => setIsStandalone(isStandaloneMode());
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setInstallPrompt(null);
      setIsStandalone(true);
      setIsOpen(false);
    };

    window.addEventListener('beforeinstallprompt', handleInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);
    displayMode.addEventListener('change', updateStandalone);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
      displayMode.removeEventListener('change', updateStandalone);
    };
  }, []);

  if (isStandalone || (!installPrompt && !platform)) return null;

  const steps = platform === 'ios'
    ? [t('login.installIosStep1'), t('login.installIosStep2'), t('login.installIosStep3'), t('login.installIosStep4')]
    : platform === 'android'
      ? [t('login.installAndroidStep1'), t('login.installAndroidStep2'), t('login.installAndroidStep3'), t('login.installAndroidStep4')]
      : [t('login.installDesktopStep1'), t('login.installDesktopStep2')];

  const requestInstall = async () => {
    if (!installPrompt) return;
    setMessage('');
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      setInstallPrompt(null);
      if (choice.outcome === 'accepted') {
        setMessage(t('login.installAccepted'));
      } else {
        setMessage(t('login.installDismissed'));
      }
    } catch {
      setMessage(t('login.installUnavailable'));
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => { setMessage(''); setIsOpen(true); }}
        className="inline-flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-widest text-emerald-600 transition hover:text-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 dark:text-emerald-300"
      >
        <StanzaFingerprintMark size={14} />
        {t('login.installStanza')}
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-[80] flex items-end bg-black/65 p-3 backdrop-blur-sm sm:items-center sm:justify-center" onMouseDown={() => setIsOpen(false)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="stanza-install-title"
            dir={isRtl ? 'rtl' : 'ltr'}
            onMouseDown={(event) => event.stopPropagation()}
            className="w-full max-w-sm rounded-2xl border border-emerald-500/20 bg-[#030b08] p-5 text-emerald-50 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <img src="/icons/stanza-192.png" width="52" height="52" alt="" className="h-13 w-13 rounded-xl" draggable={false} />
                <div>
                  <h2 id="stanza-install-title" className="text-base font-black">{t('login.installStanza')}</h2>
                  <p className="mt-1 text-xs leading-5 text-emerald-100/55">{t('login.installDescription')}</p>
                </div>
              </div>
              <button type="button" onClick={() => setIsOpen(false)} aria-label={t('login.installClose')} className="rounded-lg px-2 py-1 text-lg text-emerald-100/45 hover:bg-emerald-500/10 hover:text-emerald-200">×</button>
            </div>

            <div className="mt-5 rounded-xl border border-emerald-500/15 bg-black/30 p-4">
              <h3 className="text-xs font-black uppercase tracking-widest text-emerald-300">{platform === 'ios' ? t('login.installIosTitle') : platform === 'android' ? t('login.installAndroidTitle') : t('login.installDesktopTitle')}</h3>
              <ol className="mt-3 space-y-2 text-xs leading-5 text-emerald-100/70">
                {steps.map((step, index) => <li key={step} className="flex gap-3"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 font-mono text-[10px] text-emerald-300">{index + 1}</span><span>{step}</span></li>)}
              </ol>
            </div>

            {message && <p className="mt-3 rounded-lg border border-emerald-500/15 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-100/70">{message}</p>}

            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              {installPrompt && <button type="button" onClick={requestInstall} className="flex-1 rounded-lg bg-emerald-500 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-[#02110b] hover:bg-emerald-400">{t('login.installNow')}</button>}
              <button type="button" onClick={() => setIsOpen(false)} className="flex-1 rounded-lg border border-emerald-500/20 px-4 py-2.5 text-xs font-bold uppercase tracking-widest text-emerald-200 hover:bg-emerald-500/10">{t('login.installClose')}</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
