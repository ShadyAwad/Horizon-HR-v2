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
            <label className="text-xs font-medium text-slate-600 dark:text-slate-300 tracking-wide uppercase px-1">{t('login.biometricKey')}</label>
            <input 
              type="password" 
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
className={cn(
  "w-full bg-[#04110d]/80 border border-emerald-500/15 rounded-lg px-4 py-3 text-sm text-emerald-50 placeholder:text-emerald-900/70 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-400 transition-all font-mono",
  isRtl && "text-right"
)}            />
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
    </div>
  );
}
