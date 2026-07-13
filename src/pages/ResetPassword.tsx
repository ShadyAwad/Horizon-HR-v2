import { FormEvent, useEffect, useState } from 'react';
import { apiUrl } from '../lib/api';
import type { AuthVisualState } from '../components/AuthShell';
import { BrandWordmark } from '../components/BrandWordmark';
import { useLanguage } from '../lib/LanguageContext';
import { validatePasswordStrength } from '../lib/validation';
import { StanzaFingerprintLoader } from '../components/StanzaFingerprintLoader';

export function ResetPassword({ onNavigateLogin, onPulseStateChange }: {
  onNavigateLogin: () => void;
  onPulseStateChange?: (pulseState: AuthVisualState) => void;
}) {
  const { t, isRtl } = useLanguage();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [token] = useState(() => {
    const url = new URL(window.location.href);
    const value = url.searchParams.get('token') || '';
    if (value) {
      url.searchParams.delete('token');
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }
    return value;
  });

  useEffect(() => {
    onPulseStateChange?.(isSubmitting ? 'loading' : 'idle');
  }, [isSubmitting, onPulseStateChange]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!token) return setMessage(t('reset.invalidLink'));
    if (!validatePasswordStrength(password).valid) return setMessage(t('reset.passwordRequirements'));
    if (password !== confirmPassword) return setMessage(t('validation.confirmPassword'));

    setIsSubmitting(true);
    setMessage('');
    try {
      const response = await fetch(apiUrl('/api/auth/reset-password'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const data = await response.json();
      setMessage(data.success ? t('reset.success') : data.error || t('reset.failed'));
    } catch {
      setMessage(t('reset.failed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-[100dvh] items-center justify-center px-4 py-8 text-emerald-50">
      <form onSubmit={submit} className={`w-full max-w-sm rounded-2xl border border-emerald-500/15 bg-black/55 p-6 shadow-xl backdrop-blur-xl ${isRtl ? 'text-right' : ''}`}>
        <h1 className="text-center text-2xl font-semibold"><BrandWordmark /></h1>
        <h2 className="mt-6 text-sm font-bold uppercase tracking-widest text-emerald-300">{t('reset.title')}</h2>
        <p className="mt-2 text-xs leading-5 text-emerald-100/55">{t('reset.subtitle')}</p>
        <div className="mt-5 space-y-3">
          <div className="relative">
            <input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t('reset.newPassword')} className="w-full rounded-lg border border-emerald-500/15 bg-black/35 px-3 py-3 pr-12 text-sm outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500" required />
            <button type="button" aria-label={showPassword ? t('login.hidePassword') : t('login.showPassword')} aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)} className="absolute inset-y-0 right-0 px-3 text-[10px] font-bold text-emerald-200/60 hover:text-emerald-300">{showPassword ? t('login.hidePassword') : t('login.showPassword')}</button>
          </div>
          <div className="relative">
            <input type={showConfirmPassword ? 'text' : 'password'} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder={t('reset.confirmPassword')} className="w-full rounded-lg border border-emerald-500/15 bg-black/35 px-3 py-3 pr-12 text-sm outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500" required />
            <button type="button" aria-label={showConfirmPassword ? t('login.hidePassword') : t('login.showPassword')} aria-pressed={showConfirmPassword} onClick={() => setShowConfirmPassword((value) => !value)} className="absolute inset-y-0 right-0 px-3 text-[10px] font-bold text-emerald-200/60 hover:text-emerald-300">{showConfirmPassword ? t('login.hidePassword') : t('login.showPassword')}</button>
          </div>
          <button type="submit" disabled={isSubmitting} className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-3 text-xs font-bold uppercase tracking-widest text-black transition hover:bg-emerald-400 disabled:opacity-60">{isSubmitting && <StanzaFingerprintLoader size="sm" />}{isSubmitting ? t('reset.updatingPassword') : t('reset.submit')}</button>
        </div>
        {message && <p className="mt-4 rounded-lg border border-emerald-500/15 bg-black/25 px-3 py-2 text-xs text-emerald-100/70">{message}</p>}
        <button type="button" onClick={onNavigateLogin} className="mt-5 text-xs font-semibold text-emerald-300 hover:text-emerald-200">{t('reset.backToLogin')}</button>
      </form>
    </main>
  );
}
