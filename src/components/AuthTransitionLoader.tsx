import { useLanguage } from '../lib/LanguageContext';

export type AuthTransition =
  | 'opening-signup'
  | 'returning-login'
  | 'logging-in'
  | 'logging-out';

const transitionMessageKeys = {
  'opening-signup': 'authTransition.preparingSignup',
  'returning-login': 'authTransition.returningLogin',
  'logging-in': 'authTransition.openingWorkspace',
  'logging-out': 'authTransition.signingOut',
} as const;

function FingerprintMark() {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden="true" className="h-7 w-7">
      <path d="M15 20a9 9 0 0 1 18 0c0 8-2.2 14-6.5 18M11 20a13 13 0 0 1 26 0c0 8.6-2.2 15.4-6.6 20M19 20a5 5 0 0 1 10 0c0 6.4-1.5 11.4-4.5 15M15.5 29.5c.8 3.5 2.1 6.3 4 8.5M11.8 27.8c.8 5.8 2.8 10.7 6 14.5M24 12a8 8 0 0 0-8 8c0 1.6.1 3.1.4 4.6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function AuthTransitionLoader({ transition, overlay = false }: { transition: AuthTransition; overlay?: boolean }) {
  const { t, isRtl } = useLanguage();

  return (
    <div className={overlay
      ? 'fixed inset-0 z-[80] flex min-h-[100dvh] items-center justify-center bg-[#020604]/88 px-4 text-emerald-50'
      : 'flex min-h-[100dvh] items-center justify-center px-4 text-emerald-50'}
    >
      <div
        role="status"
        aria-live="polite"
        dir={isRtl ? 'rtl' : 'ltr'}
        className="flex w-full max-w-sm flex-col items-center rounded-2xl border border-emerald-500/15 bg-[#030b08]/88 px-6 py-9 text-center shadow-xl shadow-black/35 backdrop-blur-xl"
      >
        <span className="relative mb-5 flex h-14 w-14 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 shadow-[0_0_24px_rgba(16,185,129,0.14)]">
          <span className="absolute inset-1 rounded-lg border border-emerald-400/50 border-t-transparent animate-spin motion-reduce:animate-none" />
          <FingerprintMark />
        </span>
        <p className="text-xs font-bold uppercase tracking-widest text-emerald-100/80">
          {t(transitionMessageKeys[transition])}
        </p>
      </div>
    </div>
  );
}
