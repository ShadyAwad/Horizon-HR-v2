import { useLanguage } from '../lib/LanguageContext';
import { StanzaFingerprintLoader } from './StanzaFingerprintLoader';

export type AuthTransition =
  | 'opening-signup'
  | 'returning-login'
  | 'logging-in'
  | 'logging-out'
  | 'creating-workspace';

const transitionMessageKeys = {
  'opening-signup': 'authTransition.preparingSignup',
  'returning-login': 'authTransition.returningLogin',
  'logging-in': 'authTransition.openingWorkspace',
  'logging-out': 'authTransition.signingOut',
  'creating-workspace': 'authTransition.creatingWorkspace',
} as const;

export function AuthTransitionLoader({ transition, overlay = false, contained = false }: { transition: AuthTransition; overlay?: boolean; contained?: boolean }) {
  const { t, isRtl } = useLanguage();
  const state = transition === 'logging-in' ? 'success' : 'loading';

  return (
    <div className={overlay
      ? 'fixed inset-0 z-[80] flex min-h-[100dvh] items-center justify-center bg-[#020604]/88 px-4 text-emerald-50'
      : contained
        ? 'absolute inset-0 z-30 flex items-center justify-center rounded-2xl bg-[#030b08]/82 px-4 text-emerald-50'
        : 'flex min-h-[100dvh] items-center justify-center px-4 text-emerald-50'}
    >
      <div
        role="status"
        aria-live="polite"
        dir={isRtl ? 'rtl' : 'ltr'}
        className="flex w-full max-w-sm flex-col items-center rounded-2xl border border-emerald-500/15 bg-[#030b08]/88 px-6 py-9 text-center shadow-xl shadow-black/35 backdrop-blur-xl"
      >
        <StanzaFingerprintLoader size="lg" state={state} className="mb-5" />
        <p className="text-xs font-bold uppercase tracking-widest text-emerald-100/80">
          {t(transitionMessageKeys[transition])}
        </p>
      </div>
    </div>
  );
}
