import { useEffect, useMemo, useState } from 'react';

import { useLanguage } from '../lib/LanguageContext';
import { detectPwaInstallPlatform, getPwaInstallMode } from '../lib/pwa-install';
import { StanzaFingerprintMark } from './StanzaFingerprintMark';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

type NavigatorWithStandalone = Navigator & { standalone?: boolean };
const isStandaloneMode = () => (
  window.matchMedia('(display-mode: standalone)').matches ||
  Boolean((navigator as NavigatorWithStandalone).standalone)
);

export function PwaInstallPrompt() {
  const { t, isRtl } = useLanguage();
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(isStandaloneMode);
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [message, setMessage] = useState('');
  const platform = useMemo(() => detectPwaInstallPlatform(navigator), []);

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

  const installMode = getPwaInstallMode({
    platform,
    hasDeferredPrompt: Boolean(installPrompt),
    isStandalone,
  });

  const steps = installMode === 'ios-manual'
    ? [t('login.installIosStep1'), t('login.installIosStep2'), t('login.installIosStep3'), t('login.installIosStep4')]
    : platform === 'android'
      ? [t('login.installAndroidStep1'), t('login.installAndroidStep2'), t('login.installAndroidStep3'), t('login.installAndroidStep4')]
      : platform === 'edge'
        ? [t('login.installEdgeStep1'), t('login.installEdgeStep2')]
      : installMode === 'firefox-manual'
        ? [t('login.installFirefoxStep1'), t('login.installFirefoxStep2')]
        : platform === 'other'
          ? [t('login.installUnsupportedStep1'), t('login.installUnsupportedStep2')]
          : [t('login.installDesktopStep1'), t('login.installDesktopStep2')];

  const guideTitle = installMode === 'ios-manual'
    ? t('login.installIosTitle')
    : platform === 'android'
      ? t('login.installAndroidTitle')
    : platform === 'edge'
      ? t('login.installEdgeTitle')
    : installMode === 'firefox-manual'
      ? t('login.installFirefoxTitle')
        : platform === 'other' ? t('login.installUnsupportedTitle') : t('login.installDesktopTitle');
  const removalGuidance = platform === 'android'
    ? t('login.installRemoveAndroid')
    : platform === 'ios'
      ? t('login.installRemoveIos')
      : platform === 'firefox'
        ? t('login.installRemoveFirefox')
        : t('login.installRemoveDesktop');
  const removalSteps = platform === 'chromium'
    ? [t('login.installRemoveChromeStep1'), t('login.installRemoveChromeStep2')]
    : platform === 'edge'
      ? [t('login.installRemoveEdgeStep1'), t('login.installRemoveEdgeStep2')]
      : platform === 'android'
        ? [t('login.installRemoveAndroid')]
        : platform === 'ios'
          ? [t('login.installRemoveIos')]
          : platform === 'firefox'
            ? [t('login.installRemoveFirefox')]
            : [t('login.installRemoveDesktop')];

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
      <div className="flex w-full flex-col items-center text-center">
        <button
          type="button"
          aria-expanded={isExpanded}
          aria-controls="stanza-pwa-summary"
          onClick={() => setIsExpanded((value) => !value)}
          className="inline-flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-widest text-emerald-600 transition hover:text-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 dark:text-emerald-300"
        >
          <StanzaFingerprintMark size={14} />
          {installMode === 'installed' ? t('login.installInstalled') : t('login.installStanza')}
        </button>
        <div id="stanza-pwa-summary" className={`grid transition-[grid-template-rows,opacity] duration-200 motion-reduce:transition-none ${isExpanded ? 'mt-2 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
          <div className="min-h-0 overflow-hidden">
            <p className="text-[11px] leading-5 text-neutral-500 dark:text-emerald-100/50">{t('login.installExplanation')}</p>
            {installMode !== 'installed' && <button type="button" onClick={() => { setMessage(''); setIsOpen(true); }} className="mt-2 text-[10px] font-bold uppercase tracking-widest text-emerald-600 hover:text-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 dark:text-emerald-300">{installMode === 'direct' ? t('login.installNow') : t('login.installGuide')}</button>}
          </div>
        </div>
      </div>

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
              <h3 className="text-xs font-black uppercase tracking-widest text-emerald-300">{guideTitle}</h3>
              <ol className="mt-3 space-y-2 text-xs leading-5 text-emerald-100/70">
                {steps.map((step, index) => <li key={step} className="flex gap-3"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 font-mono text-[10px] text-emerald-300">{index + 1}</span><span>{step}</span></li>)}
              </ol>
            </div>

            <div className="mt-3 rounded-xl border border-emerald-500/15 bg-black/20 p-3">
              <h3 className="text-[11px] font-black uppercase tracking-widest text-emerald-300">{t('login.installRemoveTitle')}</h3>
              <p className="mt-1 text-xs leading-5 text-emerald-100/65">{removalGuidance}</p>
              <ol className="mt-2 space-y-1.5 text-xs leading-5 text-emerald-100/65">
                {removalSteps.map((step, index) => (
                  <li key={step} className="flex gap-2">
                    <span className="font-mono text-emerald-300">{index + 1}.</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-2 text-[11px] leading-4 text-emerald-100/45">{t('login.installAccountNote')}</p>
            </div>

            {message && <p aria-live="polite" className="mt-3 rounded-lg border border-emerald-500/15 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-100/70">{message}</p>}

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
