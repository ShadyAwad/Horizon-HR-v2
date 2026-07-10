import { lazy, Suspense, useEffect, useState, FormEvent } from 'react';
import { useLanguage } from '../lib/LanguageContext';
import { useTheme } from '../lib/ThemeContext';
import { apiUrl } from '../lib/api';
import { BrandWordmark } from '../components/BrandWordmark';
import type { AuthUser } from '../App';
import { validateEmail } from '../lib/validation';

const FingerprintCanvas = lazy(() => import('../components/FingerprintCanvas').then((module) => ({ default: module.FingerprintCanvas })));

interface LoginProps {
  onLoginSuccess: (user?: AuthUser) => void;
  onNavigateSignup: () => void;
}

function FingerprintIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" />
      <path d="M14 13.12c0 2.38 0 6.38-1 8.88" />
      <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02" />
      <path d="M2 12a10 10 0 0 1 18-6" />
      <path d="M2 16h.01" />
      <path d="M21.8 16c.2-2 .131-5.354 0-6" />
      <path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2" />
      <path d="M8.65 22c.21-.66.45-1.32.57-2" />
      <path d="M9 6.8a6 6 0 0 1 9 5.2v2" />
    </svg>
  );
}

function CheckCircleIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 11.1V12a10 10 0 1 1-5.9-9.1" />
      <path d="m9 11 3 3L22 4" />
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

export function Login({ onLoginSuccess, onNavigateSignup }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [recoveryEmailTouched, setRecoveryEmailTouched] = useState(false);
  const [loginSubmitted, setLoginSubmitted] = useState(false);
  const [recoverySubmitted, setRecoverySubmitted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [pulseState, setPulseState] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryMethod, setRecoveryMethod] = useState<'email' | 'admin' | 'security'>('email');
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [isRecovering, setIsRecovering] = useState(false);
  const [pendingUser, setPendingUser] = useState<AuthUser | undefined>();
  const [showDecorativeCanvas, setShowDecorativeCanvas] = useState(false);
  const [isOffline, setIsOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine);
  const [passkeyMessage, setPasskeyMessage] = useState('');
  const [isPasskeyLoading, setIsPasskeyLoading] = useState(false);
  const { t, lang, setLang, isRtl } = useLanguage();
  const { isDark, toggleTheme } = useTheme();
  const emailValidation = validateEmail(email);
  const recoveryEmailValidation = validateEmail(recoveryEmail || email);
  const showEmailError = (emailTouched || loginSubmitted || Boolean(email.trim())) && !emailValidation.valid;
  const showPasswordError = passwordTouched && !password;
  const showRecoveryEmailError = (recoveryEmailTouched || recoverySubmitted || Boolean((recoveryEmail || email).trim())) && !recoveryEmailValidation.valid;

  useEffect(() => {
    const loadCanvas = window.setTimeout(() => setShowDecorativeCanvas(true), 0);
    return () => window.clearTimeout(loadCanvas);
  }, []);

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
    setPulseState('idle');

    try {
      const res = await fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailValidation.value, password })
      });
      
      const data = await res.json();
      
      if (data.success) {
        setPendingUser(data.user);
        setPulseState('success');
        window.localStorage.setItem('horizon-auth-user', JSON.stringify(data.user));
        // Will transition to dashboard after pulse finishes via onPulseComplete
      } else {
        setPulseState('error');
        setErrorMsg(data.error || 'Authentication Failed');
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
      setRecoveryMessage(data.message || t('login.recoveryGeneric'));
    } else {
      setRecoveryMessage(data.error || t('login.recoveryStartError'));
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
    setPulseState('idle');

    try {
      const { startAuthentication } = await import('@simplewebauthn/browser');
      const optionsResponse = await fetch(apiUrl('/api/auth/passkeys/login/options'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailValidation.value }),
      });
      const optionsData = await optionsResponse.json();

      if (!optionsResponse.ok || !optionsData.success) {
        throw new Error(optionsData.error || 'Unable to start passkey sign in.');
      }

      const credential = await startAuthentication({ optionsJSON: optionsData.options });
      const verifyResponse = await fetch(apiUrl('/api/auth/passkeys/login/verify'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailValidation.value, credential }),
      });
      const verifyData = await verifyResponse.json();

      if (!verifyResponse.ok || !verifyData.success) {
        throw new Error(verifyData.error || 'Unable to sign in with passkey.');
      }

      window.localStorage.setItem('horizon-auth-user', JSON.stringify(verifyData.user));
      setPendingUser(verifyData.user);
      setPulseState('success');
    } catch (error) {
      setPulseState('error');
      setPasskeyMessage(error instanceof Error ? error.message : 'Unable to sign in with passkey.');
      setIsPasskeyLoading(false);
    }
  };

  return (
<div className="relative min-h-screen w-full flex items-center justify-center bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.05),transparent_50%),#f7fbf8] dark:bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.035),transparent_52%),#020604] overflow-hidden font-sans transition-colors duration-300">      {/* Dynamic Biometric Background */}
      {showDecorativeCanvas && (
        <Suspense fallback={null}>
          <FingerprintCanvas 
            pulseState={pulseState} 
            onPulseComplete={() => {
              if (pulseState === 'success') onLoginSuccess(pendingUser);
              if (pulseState === 'error') setPulseState('idle');
            }} 
          />
        </Suspense>
      )}

      <div className={`absolute top-4 z-20 flex items-center gap-2 rounded-lg border border-slate-200 bg-white/80 px-3 py-2 shadow-sm backdrop-blur-md dark:border-emerald-500/15 dark:bg-black/35 ${isRtl ? "left-4" : "right-4"}`}>
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
      <div className="relative z-10 w-full max-w-sm px-8 py-10 bg-white/85 dark:bg-black/55 backdrop-blur-xl border border-slate-200 dark:border-emerald-500/15 rounded-2xl shadow-xl dark:shadow-[0_0_45px_rgba(16,185,129,0.08)] animate-[loginCardIn_180ms_ease-out]">
        <div className="flex flex-col items-center mb-8">
<div className="w-14 h-14 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center justify-center mb-4 text-emerald-600 dark:text-emerald-400 shadow-[0_0_25px_rgba(16,185,129,0.18)]">            <FingerprintIcon className="w-8 h-8" />
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
              type="email" 
              required
              aria-invalid={showEmailError}
              aria-describedby={showEmailError ? 'login-email-error' : undefined}
              aria-label={t('login.corporateId')}
              value={email}
              onBlur={() => setEmailTouched(true)}
              onChange={(e) => {
                setEmail(e.target.value);
                if (errorMsg) setErrorMsg('');
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

  <input 
    type="password" 
    required
    aria-invalid={showPasswordError}
    aria-describedby={showPasswordError ? 'login-password-error' : undefined}
    aria-label={t('login.biometricKey')}
    value={password}
    onBlur={() => setPasswordTouched(true)}
    onChange={(e) => {
      setPassword(e.target.value);
      if (errorMsg) setErrorMsg('');
    }}
    placeholder="••••••••"
    className={`w-full bg-white/80 dark:bg-[#04110d]/80 border border-emerald-500/15 rounded-lg px-4 py-3 text-sm text-slate-900 dark:text-emerald-50 placeholder:text-emerald-900/70 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-400 transition-all font-mono ${isRtl ? "text-right" : ""}`}
  />
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
            {isLoading && pulseState === 'idle' ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-slate-900 border-t-transparent rounded-full animate-spin"></span>
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
        </form>

        <div className="mt-8 flex flex-col space-y-4 border-t border-emerald-500/10 pt-6 text-center">
          <div className="flex flex-col space-y-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-slate-600">{t('login.systemOperational')}</span>
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
        </div>
      </div>

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
