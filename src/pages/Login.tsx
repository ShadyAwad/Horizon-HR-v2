import { useState, FormEvent } from 'react';
import { FingerprintCanvas } from '../components/FingerprintCanvas';
import { Fingerprint, CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../lib/LanguageContext';

interface LoginProps {
  onLoginSuccess: () => void;
  onNavigateSignup: () => void;
}

export function Login({ onLoginSuccess, onNavigateSignup }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [pulseState, setPulseState] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryMethod, setRecoveryMethod] = useState<'email' | 'admin' | 'security'>('email');
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [isRecovering, setIsRecovering] = useState(false);
  const { t, isRtl } = useLanguage();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMsg('');
    setPulseState('idle');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      
      const data = await res.json();
      
      if (data.success) {
        setPulseState('success');
        // Will transition to dashboard after pulse finishes via onPulseComplete
      } else {
        setPulseState('error');
        setErrorMsg(data.error || 'Authentication Failed');
        setIsLoading(false);
      }
    } catch (err) {
      setPulseState('error');
      setErrorMsg('Network anomaly detected.');
      setIsLoading(false);
    }
  };

  const handleRecoveryRequest = async () => {
  setIsRecovering(true);
  setRecoveryMessage('');

  try {
    const res = await fetch('/api/auth/request-password-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: recoveryEmail || email,
        method: recoveryMethod,
      }),
    });

    const data = await res.json();

    if (data.success) {
      setRecoveryMessage(data.message || 'Recovery instructions generated successfully.');
    } else {
      setRecoveryMessage(data.error || 'Unable to start recovery flow.');
    }
  } catch (error) {
    setRecoveryMessage('Server disconnection. Unable to start recovery flow.');
  } finally {
    setIsRecovering(false);
  }
};
  return (
<div className="relative min-h-screen w-full flex items-center justify-center bg-[#020403] overflow-hidden font-sans transition-colors duration-300">      {/* Dynamic Biometric Background */}
      <FingerprintCanvas 
        pulseState={pulseState} 
        onPulseComplete={() => {
          if (pulseState === 'success') onLoginSuccess();
          if (pulseState === 'error') setPulseState('idle'); // Reset after error pulse
        }} 
      />

      {/* Main Login Panel */}
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        layout={false}
className="relative z-10 w-full max-w-sm px-8 py-10 bg-black/55 backdrop-blur-xl border border-emerald-500/15 rounded-2xl shadow-[0_0_45px_rgba(16,185,129,0.08)]"      >
        <div className="flex flex-col items-center mb-8">
<div className="w-14 h-14 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center justify-center mb-4 text-emerald-400 shadow-[0_0_25px_rgba(16,185,129,0.18)]">            <Fingerprint className="w-8 h-8" />
          </div>
<h1 className="text-2xl font-semibold tracking-tight text-white">{t('login.title')}</h1>
<p className="text-sm text-emerald-100/55 mt-1">{t('login.subtitle')}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-medium text-emerald-100/70 tracking-wide uppercase px-1">{t('login.corporateId')}</label>
            <input 
              type="text" 
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@horizon.com"
className={cn(
  "w-full bg-[#04110d]/80 border border-emerald-500/15 rounded-lg px-4 py-3 text-sm text-emerald-50 placeholder:text-emerald-900/70 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-400 transition-all font-mono",
  isRtl && "text-right"
)}            />
          </div>

         <div className="space-y-2">
  <label className="text-xs font-medium text-emerald-100/70 tracking-wide uppercase px-1">
    {t('login.biometricKey')}
  </label>

  <input 
    type="password" 
    required
    value={password}
    onChange={(e) => setPassword(e.target.value)}
    placeholder="••••••••"
    className={cn(
      "w-full bg-[#04110d]/80 border border-emerald-500/15 rounded-lg px-4 py-3 text-sm text-emerald-50 placeholder:text-emerald-900/70 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-400 transition-all font-mono",
      isRtl && "text-right"
    )}
  />
</div>

<div className={cn("flex", isRtl ? "justify-start" : "justify-end")}>
  <button
    type="button"
    onClick={() => setShowRecovery(true)}
    className="text-[10px] font-bold text-emerald-100/45 hover:text-emerald-400 uppercase tracking-widest transition-colors"
  >
    Forgot Password?
  </button>
</div>

          <AnimatePresence>
            {errorMsg && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-start gap-2 text-red-400 text-xs mt-2 bg-red-950/30 p-3 rounded-lg border border-red-900/50"
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </motion.div>
            )}
          </AnimatePresence>

          <button 
            type="submit"
            disabled={isLoading || pulseState === 'success'}
            className={cn(
              "relative w-full overflow-hidden flex items-center justify-center gap-2 mt-4 px-4 py-3 rounded-lg font-medium text-sm transition-all duration-300",
              pulseState === 'success' ? "bg-emerald-600 text-white" : 
              pulseState === 'error' ? "bg-red-600/90 text-white" :
             "bg-emerald-500 text-black hover:bg-emerald-400 hover:scale-[1.02] shadow-[0_0_25px_rgba(16,185,129,0.18)]" 
            )}
          >
            {isLoading && pulseState === 'idle' ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-slate-900 border-t-transparent rounded-full animate-spin"></span>
                {t('login.authenticating')}
              </span>
            ) : pulseState === 'success' ? (
              <>
                <CheckCircle2 className="w-4 h-4" />
                {t('login.accessGranted')}
              </>
            ) : (
              <>
                {t('login.enterSector')}
                <ArrowRight className={cn("w-4 h-4", isRtl && "rotate-180")} />
              </>
            )}
          </button>
        </form>

<div className="mt-8 pt-6 border-t border-emerald-500/10 text-center flex flex-col space-y-4">           <div className="flex flex-col space-y-2">
             <span className="text-xs text-slate-500">Hint: admin@horizon.com / admin</span>
<span className="text-[10px] text-slate-600 font-mono tracking-widest uppercase">System Operational • V2.4</span>
           </div>
           
           <button 
             onClick={onNavigateSignup}
             type="button"
             className="text-xs font-semibold text-emerald-500 hover:text-emerald-400 uppercase tracking-widest transition-colors"
           >
             Register New Corporate Tenant
           </button>
        </div>
      </motion.div>

      <AnimatePresence>
        {showRecovery && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 z-30 flex items-center justify-center bg-black/35 backdrop-blur-[2px] px-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="w-full max-w-sm rounded-2xl border border-emerald-500/15 bg-[#04110d]/95 p-5 shadow-[0_0_45px_rgba(16,185,129,0.12)]"
            >
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-widest text-emerald-300">
                    Recovery Protocol
                  </h3>
                  <p className="mt-1 text-[11px] text-emerald-100/45">
                    Choose how this corporate account should recover access.
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
                  Close
                </button>
              </div>

              <div className="space-y-3">
                <input
                  type="email"
                  value={recoveryEmail}
                  onChange={(e) => setRecoveryEmail(e.target.value)}
                  placeholder={email || 'admin@horizon.com'}
                  className={cn(
                    "w-full bg-black/35 border border-emerald-500/15 rounded-lg px-3 py-2.5 text-xs text-emerald-50 placeholder:text-emerald-900/70 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-400 transition-all font-mono",
                    isRtl && "text-right"
                  )}
                />

                <button
                  type="button"
                  onClick={() => setRecoveryMethod('email')}
                  className={cn(
                    "w-full text-left rounded-lg border px-3 py-2.5 transition-all",
                    recoveryMethod === 'email'
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                      : "border-emerald-500/10 bg-black/20 text-emerald-100/45 hover:border-emerald-500/30 hover:text-emerald-200"
                  )}
                >
                  <span className="block text-[11px] font-bold uppercase tracking-widest">
                    Email reset link
                  </span>
                  <span className="block text-[10px] opacity-70 mt-0.5">
                    Generate a secure recovery token for the account email.
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setRecoveryMethod('admin')}
                  className={cn(
                    "w-full text-left rounded-lg border px-3 py-2.5 transition-all",
                    recoveryMethod === 'admin'
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                      : "border-emerald-500/10 bg-black/20 text-emerald-100/45 hover:border-emerald-500/30 hover:text-emerald-200"
                  )}
                >
                  <span className="block text-[11px] font-bold uppercase tracking-widest">
                    Tenant admin reset
                  </span>
                  <span className="block text-[10px] opacity-70 mt-0.5">
                    Route recovery through the company owner or HR administrator.
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setRecoveryMethod('security')}
                  className={cn(
                    "w-full text-left rounded-lg border px-3 py-2.5 transition-all",
                    recoveryMethod === 'security'
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                      : "border-emerald-500/10 bg-black/20 text-emerald-100/45 hover:border-emerald-500/30 hover:text-emerald-200"
                  )}
                >
                  <span className="block text-[11px] font-bold uppercase tracking-widest">
                    Security verification
                  </span>
                  <span className="block text-[10px] opacity-70 mt-0.5">
                    Use internal identity verification before password reset.
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleRecoveryRequest}
                  disabled={isRecovering}
                  className="w-full rounded-lg bg-emerald-500 px-4 py-2.5 text-xs font-bold uppercase tracking-widest text-black transition-all hover:bg-emerald-400 disabled:opacity-60"
                >
                  {isRecovering ? 'Generating Recovery...' : 'Start Recovery'}
                </button>

                {recoveryMessage && (
                  <p className="rounded-lg border border-emerald-500/15 bg-black/25 px-3 py-2 text-[11px] text-emerald-100/60">
                    {recoveryMessage}
                  </p>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
