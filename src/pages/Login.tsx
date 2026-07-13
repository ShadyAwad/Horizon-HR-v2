import { useEffect, useRef, useState, FormEvent } from 'react';
import { useLanguage } from '../lib/LanguageContext';
import { useTheme } from '../lib/ThemeContext';
import { apiUrl } from '../lib/api';
import { BrandWordmark } from '../components/BrandWordmark';
import { PrivacyPolicyModal } from '../components/PrivacyPolicyModal';
import { StanzaFingerprintLoader } from '../components/StanzaFingerprintLoader';
import { StanzaFingerprintMark } from '../components/StanzaFingerprintMark';
import type { AuthUser } from '../App';
import type { AuthVisualState } from '../components/AuthShell';
import { validateEmail } from '../lib/validation';

interface LoginProps {
  onLoginSuccess: (user?: AuthUser) => void;
  onNavigateSignup: () => void;
  onPulseStateChange?: (pulseState: AuthVisualState) => void;
  focusEmailOnMount?: boolean;
}

function CheckCircleIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 11.1V12a10 10 0 1 1-5.9-9.1" />
      <path d="m9 11 3 3L22 4" />
    </svg>
  );
}

function PasswordVisibilityIcon({ visible, className = '' }: { visible: boolean; className?: string }) {
  return visible ? (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m3 3 18 18" />
      <path d="M10.6 10.7a2 2 0 0 0 2.7 2.7" />
      <path d="M9.9 4.2A10.8 10.8 0 0 1 12 4c5.5 0 9.4 4.4 10 8-0.3 1.7-1.4 3.5-3.1 4.9" />
      <path d="M6.6 6.6C4.7 8 3.4 10.1 2 12c1.1 3.4 5 8 10 8 1.3 0 2.5-.3 3.6-.8" />
    </svg>
  ) : (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function AlertCircleIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  );
}

function ArrowRightIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

function SunIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3a6 6 0 0 0 9 7.5A9 9 0 1 1 12 3Z" />
    </svg>
  );
}

export function Login({ onLoginSuccess, onNavigateSignup, onPulseStateChange, focusEmailOnMount = false }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [recoveryEmailTouched, setRecoveryEmailTouched] = useState(false);
  const [loginSubmitted, setLoginSubmitted] = useState(false);
  const [recoverySubmitted, setRecoverySubmitted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [pulseState, setPulseState] = useState<AuthVisualState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryMethod, setRecoveryMethod] = useState<'email' | 'admin' | 'security'>('email');
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [isRecovering, setIsRecovering] = useState(false);
  const [isOffline, setIsOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine);
  const [passkeyMessage, setPasskeyMessage] = useState('');
  const [isPasskeyLoading, setIsPasskeyLoading] = useState(false);
  const [showPrivacyPolicy, setShowPrivacyPolicy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showDemoAccounts, setShowDemoAccounts] = useState(false);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const { t, lang, setLang, isRtl } = useLanguage();
  const { isDark, toggleTheme } = useTheme();
  const emailValidation = validateEmail(email);
  const recoveryEmailValidation = validateEmail(recoveryEmail || email);
  const showEmailError = (emailTouched || loginSubmitted || Boolean(email.trim())) && !emailValidation.valid;
  const showPasswordError = passwordTouched && !password;
  const showRecoveryEmailError = (recoveryEmailTouched || recoverySubmitted || Boolean((recoveryEmail || email).trim())) && !recoveryEmailValidation.valid;
  const demoLoginEnabled = import.meta.env.VITE_ENABLE_DEMO_LOGIN !== 'false';

  const fillDemoCredentials = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword('StrongPass!123');
    setEmailTouched(false);
    setPasswordTouched(false);
    setLoginSubmitted(false);
    setErrorMsg('');
    setPulseState('idle');
  };

  useEffect(() => {
    if (pulseState === 'success') return;
    onPulseStateChange?.(pulseState);
  }, [onPulseStateChange, pulseState]);

  useEffect(() => {
    if (focusEmailOnMount) emailInputRef.current?.focus();
  }, [focusEmailOnMount]);

  useEffect(() => {
    const updateOnlineState = () => setIsOffline(!navigator.onLine);

    window.addEventListener('online', updateOnlineState);
    window.addEventListener('offline', updateOnlineState);

    return () => {
      window.removeEventListener('online', updateOnlineState);
      window.removeEventListener('offline', updateOnlineState);
    };
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoginSubmitted(true);

    if (isOffline) {
      setPulseState('error');
      setErrorMsg(t('login.offline'));
      return;
    }

    setEmailTouched(true);
    setPasswordTouched(true);

    if (!emailValidation.valid || !password) {
      setPulseState('error');
      setErrorMsg(!emailValidation.valid ? t('validation.email') : t('validation.passwordRequired'));
      return;
    }

    setIsLoading(true);
    setErrorMsg('');
    setPulseState('loading');

    try {
      const res = await fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailValidation.value, password })
      });
      
      const data = await res.json();
      
      if (data.success) {
        setPulseState('success');
        window.localStorage.setItem('horizon-auth-user', JSON.stringify(data.user));
        onLoginSuccess(data.user);
      } else {
        setPulseState('error');
        setErrorMsg(data.code === 'RATE_LIMITED'
          ? t('login.rateLimited')
          : data.error || t('login.invalidCredentials'));
        setIsLoading(false);
      }
    } catch (err) {
      setPulseState('error');
      setErrorMsg(
        !navigator.onLine
          ? t('login.offlineSignIn')
          : t('login.apiUnavailable')
      );
      setIsLoading(false);
    }
  };

  const handleRecoveryRequest = async () => {
  setRecoverySubmitted(true);

  if (isOffline) {
    setRecoveryMessage(t('login.offline'));
    return;
  }

  setRecoveryEmailTouched(true);

  if (!recoveryEmailValidation.valid) {
    setRecoveryMessage(t('validation.email'));
    return;
  }

  setIsRecovering(true);
  setRecoveryMessage('');

  try {
    const res = await fetch(apiUrl('/api/auth/request-password-reset'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: recoveryEmailValidation.value,
        method: recoveryMethod,
      }),
    });

    const data = await res.json();

    if (data.success) {
      setRecoveryMessage(data.developmentFallback
        ? `${data.message || t('login.recoveryGeneric')} ${t('login.recoveryDevFallback')}`
        : data.message || t('login.recoveryGeneric'));
    } else {
      setRecoveryMessage(data.code === 'RATE_LIMITED'
        ? t('login.rateLimited')
        : data.error || t('login.recoveryStartError'));
    }
  } catch (error) {
    setRecoveryMessage(
      !navigator.onLine
        ? t('login.offlineSignIn')
        : t('login.recoveryServerError')
    );
  } finally {
    setIsRecovering(false);
  }
};

  const handlePasskeySignIn = async () => {
    if (isOffline) {
      setPasskeyMessage(t('login.offlineSignIn'));
      return;
    }

    if (!window.PublicKeyCredential) {
      setPasskeyMessage(t('login.passkeyUnsupported'));
      return;
    }

    setEmailTouched(true);

    if (!emailValidation.valid) {
      setPasskeyMessage(t('login.passkeyEmailRequired'));
      return;
    }

    setIsPasskeyLoading(true);
    setPasskeyMessage('');
    setErrorMsg('');
    setPulseState('loading');

    try {
      const { startAuthentication } = await import('@simplewebauthn/browser');
      const optionsResponse = await fetch(apiUrl('/api/auth/passkeys/login/options'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailValidation.value }),
      });
      const optionsData = await optionsResponse.json();

      if (!optionsResponse.ok || !optionsData.success) {
        throw new Error(optionsData.code === 'RATE_LIMITED'
          ? t('login.rateLimited')
          : optionsData.error || t('login.passkeyStartError'));
      }

      const credential = await startAuthentication({ optionsJSON: optionsData.options });
      const verifyResponse = await fetch(apiUrl('/api/auth/passkeys/login/verify'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailValidation.value, credential }),
      });
      const verifyData = await verifyResponse.json();

      if (!verifyResponse.ok || !verifyData.success) {
        throw new Error(verifyData.code === 'RATE_LIMITED'
          ? t('login.rateLimited')
          : verifyData.error || t('login.passkeySignIn'));
      }

      window.localStorage.setItem('horizon-auth-user', JSON.stringify(verifyData.user));
      setPulseState('success');
      onLoginSuccess(verifyData.user);
    } catch (error) {
      setPulseState('error');
      setPasskeyMessage(error instanceof Error ? error.message : 'Unable to sign in with passkey.');
      setIsPasskeyLoading(false);
    }
  };

  return (
<div className="relative flex min-h-[100dvh] w-full flex-col items-center overflow-x-hidden px-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-[calc(env(safe-area-inset-top)+1rem)] font-sans md:min-h-screen md:justify-center md:px-4 md:py-8">

      <div className={`relative z-20 mb-4 flex w-full max-w-sm items-center justify-center gap-2 self-center rounded-lg border border-slate-200 bg-white/80 px-3 py-2 shadow-sm backdrop-blur-md dark:border-emerald-500/15 dark:bg-black/35 md:absolute md:top-4 md:mb-0 md:w-auto md:max-w-none ${isRtl ? "md:left-4" : "md:right-4"}`}>
        <button
          type="button"
          onClick={toggleTheme}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-all duration-150 hover:scale-105 hover:text-emerald-600 active:scale-90 dark:text-slate-400 dark:hover:text-emerald-300"
          title="Toggle Light/Dark Mode"
          aria-label="Toggle Light/Dark Mode"
        >
          {isDark ? <MoonIcon className="h-4 w-4" /> : <SunIcon className="h-4 w-4" />}
        </button>

        <div className="h-3 w-px bg-slate-200 dark:bg-emerald-500/20"></div>

        <button
          type="button"
          onClick={() => setLang('en')}
          className={`text-xs font-bold transition-colors ${
            lang === 'en'
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-slate-500 hover:text-emerald-600 dark:text-slate-400 dark:hover:text-emerald-300"
          }`}
        >
          EN-US
        </button>

        <div className="h-3 w-px bg-slate-200 dark:bg-emerald-500/20"></div>

        <button
          type="button"
          onClick={() => setLang('ar')}
          className={`text-xs font-bold transition-colors ${
            lang === 'ar'
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-slate-500 hover:text-emerald-600 dark:text-slate-400 dark:hover:text-emerald-300"
          }`}
        >
          AR-AE
        </button>
      </div>

      {/* Main Login Panel */}
      <div className="relative z-10 w-full max-w-sm px-5 py-8 bg-white/85 dark:bg-[#030b08]/70 backdrop-blur-xl border border-slate-200 dark:border-emerald-500/12 rounded-2xl shadow-xl dark:shadow-[0_0_42px_rgba(16,185,129,0.055)] animate-[loginCardIn_180ms_ease-out] sm:px-8 sm:py-10">
        <div className="flex flex-col items-center mb-8">
<div className="w-14 h-14 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center justify-center mb-4 text-emerald-600 dark:text-emerald-400 shadow-[0_0_25px_rgba(16,185,129,0.18)]">            <StanzaFingerprintMark size={32} />
          </div>
<h1 className="text-2xl font-semibold tracking-tight">
  <BrandWordmark />
</h1>
<p className="text-sm text-emerald-700/70 dark:text-emerald-100/55 mt-1">{t('login.subtitle')}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-medium text-emerald-700/80 dark:text-emerald-100/70 tracking-wide uppercase px-1">{t('login.corporateId')}</label>
            <input 
              ref={emailInputRef}
              type="email" 
              required
              aria-invalid={showEmailError}
              aria-describedby={showEmailError ? 'login-email-error' : undefined}
              aria-label={t('login.corporateId')}
              value={email}
              onBlur={() => setEmailTouched(true)}
              onChange={(e) => {
                setEmail(e.target.value);
                if (errorMsg) {
                  setErrorMsg('');
                  setPulseState('idle');
                }
              }}
              placeholder="admin@stanza.com"
className={`w-full bg-white/80 dark:bg-[#04110d]/80 border border-emerald-500/15 rounded-lg px-4 py-3 text-sm text-slate-900 dark:text-emerald-50 placeholder:text-emerald-900/70 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-400 transition-all font-mono ${isRtl ? "text-right" : ""}`}            />
            {showEmailError && (
              <p id="login-email-error" className="px-1 text-xs font-medium text-red-500">{t('validation.email')}</p>
            )}
          </div>

         <div className="space-y-2">
  <label className="text-xs font-medium text-emerald-700/80 dark:text-emerald-100/70 tracking-wide uppercase px-1">
    {t('login.biometricKey')}
  </label>

  <div className="relative">
  <input 
    type={showPassword ? 'text' : 'password'}
    required
    aria-invalid={showPasswordError}
    aria-describedby={showPasswordError ? 'login-password-error' : undefined}
    aria-label={t('login.biometricKey')}
    value={password}
    onBlur={() => setPasswordTouched(true)}
    onChange={(e) => {
      setPassword(e.target.value);
      if (errorMsg) {
        setErrorMsg('');
        setPulseState('idle');
      }
    }}
    placeholder="••••••••"
    className={`w-full bg-white/80 dark:bg-[#04110d]/80 border border-emerald-500/15 rounded-lg px-4 py-3 text-sm text-slate-900 dark:text-emerald-50 placeholder:text-emerald-900/70 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-400 transition-all font-mono ${isRtl ? "pl-12 text-right" : "pr-12"}`}
  />
  <button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? t('login.hidePassword') : t('login.showPassword')} title={showPassword ? t('login.hidePassword') : t('login.showPassword')} aria-pressed={showPassword} className={`absolute top-1/2 -translate-y-1/2 rounded p-1.5 text-emerald-700/70 transition hover:text-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 dark:text-emerald-100/55 ${isRtl ? 'left-2' : 'right-2'}`}>
    <PasswordVisibilityIcon visible={showPassword} className="h-4 w-4" />
  </button>
  </div>
  {showPasswordError && (
    <p id="login-password-error" className="px-1 text-xs font-medium text-red-500">{t('validation.passwordRequired')}</p>
  )}
</div>

<div className={`flex ${isRtl ? "justify-start" : "justify-end"}`}>
  <button
    type="button"
    onClick={() => setShowRecovery(true)}
    className="text-[10px] font-bold text-emerald-700/70 hover:text-emerald-600 dark:text-emerald-100/45 dark:hover:text-emerald-400 uppercase tracking-widest transition-colors"
  >
    {t('login.forgotPassword')}
  </button>
</div>

            {errorMsg && (
              <div className="flex items-start gap-2 text-red-400 text-xs mt-2 bg-red-950/30 p-3 rounded-lg border border-red-900/50">
                <AlertCircleIcon className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

          {isOffline && !errorMsg && (
            <p className="rounded-lg border border-amber-300/20 bg-amber-500/10 p-3 text-xs text-amber-100">
              {t('login.offline')}
            </p>
          )}

          <button 
            type="submit"
            disabled={isLoading || isPasskeyLoading || pulseState === 'success' || isOffline}
            className={`relative w-full overflow-hidden flex items-center justify-center gap-2 mt-4 px-4 py-3 rounded-lg font-medium text-sm transition-all duration-300 ${
              pulseState === 'success' ? "bg-emerald-600 text-white" : 
              pulseState === 'error' ? "bg-red-600/90 text-white" :
             "bg-emerald-500 text-black hover:bg-emerald-400 hover:scale-[1.02] shadow-[0_0_25px_rgba(16,185,129,0.18)]" 
            }`}
          >
            {isLoading && pulseState === 'loading' ? (
              <span className="flex items-center gap-2">
                <StanzaFingerprintLoader size="sm" />
                {t('login.authenticating')}
              </span>
            ) : pulseState === 'success' ? (
              <>
                <CheckCircleIcon className="w-4 h-4" />
                {t('login.accessGranted')}
              </>
            ) : (
              <>
                {t('login.enterSector')}
                <ArrowRightIcon className={`w-4 h-4 ${isRtl ? "rotate-180" : ""}`} />
              </>
            )}
          </button>

          <div className="space-y-2">
            <button
              type="button"
              onClick={handlePasskeySignIn}
              disabled={isLoading || isPasskeyLoading || pulseState === 'success' || isOffline}
              className="w-full rounded-lg border border-emerald-500/20 bg-black/20 px-4 py-3 text-xs font-bold uppercase tracking-widest text-emerald-700 transition hover:border-emerald-400 hover:text-emerald-500 disabled:cursor-not-allowed disabled:opacity-60 dark:text-emerald-300 dark:hover:text-emerald-200"
            >
              {isPasskeyLoading ? t('login.passkeyOpening') : t('login.passkeySignIn')}
            </button>
            <p className="px-1 text-center text-[10px] leading-4 text-neutral-500 dark:text-emerald-100/45">
              {t('login.passkeyDescription')}
            </p>
            {passkeyMessage && (
              <p className="rounded-lg border border-emerald-500/15 bg-black/20 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-100/65">
                {passkeyMessage}
              </p>
            )}
          </div>

          {demoLoginEnabled && (
            <div className="rounded-lg border border-emerald-500/15 bg-black/15 p-3">
              <button
                type="button"
                onClick={() => setShowDemoAccounts((current) => !current)}
                aria-expanded={showDemoAccounts}
                className={`w-full text-[10px] font-black uppercase tracking-widest text-emerald-700 transition hover:text-emerald-500 dark:text-emerald-300 ${isRtl ? 'text-right' : 'text-left'}`}
              >
                {t('login.useDemoAccount')}
              </button>
              {showDemoAccounts && (
                <div className="mt-3 space-y-2">
                  {[
                    ['admin@stanza-demo.com', t('login.hrAdminDemo')],
                    ['manager@stanza-demo.com', t('login.managerDemo')],
                    ['employee@stanza-demo.com', t('login.employeeDemo')],
                  ].map(([demoEmail, label]) => (
                    <button key={demoEmail} type="button" title={t('login.fillDemoCredentials')} onClick={() => fillDemoCredentials(demoEmail)} className={`w-full rounded border border-emerald-500/15 px-3 py-2 text-xs font-bold text-neutral-700 transition hover:border-emerald-400 dark:text-emerald-100/75 ${isRtl ? 'text-right' : 'text-left'}`}>
                      {label}
                    </button>
                  ))}
                  <p className="text-[10px] leading-4 text-neutral-500 dark:text-emerald-100/45">{t('login.demoCredentialsNote')}</p>
                </div>
              )}
            </div>
          )}
        </form>

        <div className="mt-8 flex flex-col space-y-4 border-t border-emerald-500/10 pt-6 text-center">
          <div className="flex flex-col space-y-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-slate-600">{t('login.systemOperational')}</span>
            <span className="text-[10px] leading-4 text-neutral-500 dark:text-emerald-100/40">{t('demo.footer')}</span>
          </div>

          <button
            onClick={onNavigateSignup}
            type="button"
            className="text-xs font-semibold uppercase tracking-widest text-emerald-500 transition-colors hover:text-emerald-400"
          >
            {t('login.registerTenant')}
          </button>

          <a
            href="https://shadyawad.github.io/portfolio/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] font-medium text-neutral-500 transition hover:text-emerald-500 hover:underline dark:text-emerald-100/40 dark:hover:text-emerald-300"
          >
            {t('login.creatorCredit')}
          </a>
          <button
            type="button"
            onClick={() => setShowPrivacyPolicy(true)}
            className="text-[10px] font-medium text-neutral-500 transition hover:text-emerald-500 hover:underline dark:text-emerald-100/40 dark:hover:text-emerald-300"
          >
            {t('privacy.link')}
          </button>
        </div>
      </div>

      <PrivacyPolicyModal open={showPrivacyPolicy} onClose={() => setShowPrivacyPolicy(false)} />

      {showRecovery && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/35 backdrop-blur-[2px] px-4 animate-[loginFadeIn_120ms_ease-out]">
            <div className="w-full max-w-sm rounded-2xl border border-emerald-500/15 bg-[#04110d]/95 p-5 shadow-[0_0_45px_rgba(16,185,129,0.12)] animate-[loginCardIn_160ms_ease-out]">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-widest text-emerald-300">
                    {t('login.recoveryTitle')}
                  </h3>
                  <p className="mt-1 text-[11px] text-emerald-100/45">
                    {t('login.recoverySubtitle')}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setShowRecovery(false);
                    setRecoveryMessage('');
                  }}
                  className="text-[10px] font-bold uppercase tracking-widest text-emerald-100/35 hover:text-emerald-300 transition-colors"
                >
                  {t('login.recoveryClose')}
                </button>
              </div>

              <div className="space-y-3">
                <input
                  type="email"
                  aria-label={t('login.recoveryEmail')}
                  aria-invalid={showRecoveryEmailError}
                  value={recoveryEmail}
                  onBlur={() => setRecoveryEmailTouched(true)}
                  onChange={(e) => {
                    setRecoveryEmail(e.target.value);
                    if (recoveryMessage) setRecoveryMessage('');
                  }}
                  placeholder={email || 'admin@stanza.com'}
                  className={`w-full bg-black/35 border border-emerald-500/15 rounded-lg px-3 py-2.5 text-xs text-emerald-50 placeholder:text-emerald-900/70 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-400 transition-all font-mono ${isRtl ? "text-right" : ""}`}
                />
                {showRecoveryEmailError && (
                  <p className="px-1 text-xs font-medium text-red-400">{t('validation.email')}</p>
                )}

                <button
                  type="button"
                  onClick={() => setRecoveryMethod('email')}
                  className={`w-full rounded-lg border px-3 py-2.5 transition-all ${isRtl ? "text-right" : "text-left"} ${
                    recoveryMethod === 'email'
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                      : "border-emerald-500/10 bg-black/20 text-emerald-100/45 hover:border-emerald-500/30 hover:text-emerald-200"
                  }`}
                >
                  <span className="block text-[11px] font-bold uppercase tracking-widest">
                    {t('login.recoveryEmailTitle')}
                  </span>
                  <span className="block text-[10px] opacity-70 mt-0.5">
                    {t('login.recoveryEmailDescription')}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setRecoveryMethod('admin')}
                  className={`w-full rounded-lg border px-3 py-2.5 transition-all ${isRtl ? "text-right" : "text-left"} ${
                    recoveryMethod === 'admin'
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                      : "border-emerald-500/10 bg-black/20 text-emerald-100/45 hover:border-emerald-500/30 hover:text-emerald-200"
                  }`}
                >
                  <span className="block text-[11px] font-bold uppercase tracking-widest">
                    {t('login.recoveryAdminTitle')}
                  </span>
                  <span className="block text-[10px] opacity-70 mt-0.5">
                    {t('login.recoveryAdminDescription')}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setRecoveryMethod('security')}
                  className={`w-full rounded-lg border px-3 py-2.5 transition-all ${isRtl ? "text-right" : "text-left"} ${
                    recoveryMethod === 'security'
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                      : "border-emerald-500/10 bg-black/20 text-emerald-100/45 hover:border-emerald-500/30 hover:text-emerald-200"
                  }`}
                >
                  <span className="block text-[11px] font-bold uppercase tracking-widest">
                    {t('login.recoverySecurityTitle')}
                  </span>
                  <span className="block text-[10px] opacity-70 mt-0.5">
                    {t('login.recoverySecurityDescription')}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleRecoveryRequest}
                  disabled={isRecovering || isOffline}
                  className="w-full rounded-lg bg-emerald-500 px-4 py-2.5 text-xs font-bold uppercase tracking-widest text-black transition-all hover:bg-emerald-400 disabled:opacity-60"
                >
                  {isRecovering ? t('login.recoveryGenerating') : t('login.recoveryStart')}
                </button>

                {recoveryMessage && (
                  <p className="rounded-lg border border-emerald-500/15 bg-black/25 px-3 py-2 text-[11px] text-emerald-100/60">
                    {recoveryMessage}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
    </div>
  );
}
