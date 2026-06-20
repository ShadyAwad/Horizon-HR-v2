import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Fingerprint, CheckCircle2, ArrowRight, ArrowLeft, MapPin, Building2, Wallet, Settings2, Globe } from 'lucide-react';
import { cn } from '../lib/utils';
import { useLanguage } from '../lib/LanguageContext';
import { FingerprintCanvas } from '../components/FingerprintCanvas';

// For map demonstration purposes
const InteractiveMap = ({ lat, lng, radius, setLat, setLng, setRadius }: any) => {
  return (
    <div className="relative w-full h-[250px] bg-slate-100 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col items-center justify-center font-mono text-xs">
      {/* Mock Map Grid */}
      <div className="absolute inset-0 opacity-20 dark:opacity-10 pointer-events-none" style={{ backgroundImage: 'linear-gradient(to right, #888 1px, transparent 1px), linear-gradient(to bottom, #888 1px, transparent 1px)', backgroundSize: '20px 20px' }}></div>
      
      <Globe className="w-16 h-16 text-slate-300 dark:text-slate-700 mb-2" />
      <span className="text-slate-500 dark:text-slate-400 mb-4 tracking-widest uppercase font-bold">Interactive Geo-Fence Configurator</span>
      
      <div className="z-10 flex gap-2">
         <div className="flex flex-col gap-1 items-center bg-white/80 dark:bg-slate-950/80 p-2 rounded border border-slate-200 dark:border-slate-800 shadow-sm backdrop-blur-sm">
           <span className="text-emerald-500 uppercase">Latitude</span>
           <input type="number" step="0.001" value={lat} onChange={e => setLat(Number(e.target.value))} className="w-20 bg-transparent text-center focus:outline-none dark:text-slate-200 font-bold" />
         </div>
         <div className="flex flex-col gap-1 items-center bg-white/80 dark:bg-slate-950/80 p-2 rounded border border-slate-200 dark:border-slate-800 shadow-sm backdrop-blur-sm">
           <span className="text-emerald-500 uppercase">Longitude</span>
           <input type="number" step="0.001" value={lng} onChange={e => setLng(Number(e.target.value))} className="w-20 bg-transparent text-center focus:outline-none dark:text-slate-200 font-bold" />
         </div>
         <div className="flex flex-col gap-1 items-center bg-emerald-500/10 p-2 rounded border border-emerald-500/20 shadow-sm backdrop-blur-sm text-emerald-600 dark:text-emerald-400">
           <span className="uppercase">Radius (m)</span>
           <input type="number" value={radius} onChange={e => setRadius(Number(e.target.value))} className="w-20 bg-transparent text-center focus:outline-none font-bold" />
         </div>
      </div>

      {/* Target Reticle */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[160px] h-[160px] rounded-full border-2 border-emerald-500/50 bg-emerald-500/10 pointer-events-none flex items-center justify-center">
        <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
      </div>
    </div>
  );
};

export function Signup({ onNavigateLogin, onSignupComplete }: { onNavigateLogin: () => void, onSignupComplete: () => void }) {
  const { t, isRtl } = useLanguage();
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    companyName: '',
    tenantSlug: '',
    adminEmail: '',
    adminPassword: '',
    currency: 'USD',
    capacity: '100-500',
    allowsLoans: false,
    lat: 25.197,
    lng: 55.274,
    radius: 100
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const val = type === 'checkbox' ? (e.target as HTMLInputElement).checked : value;
    setFormData(prev => ({ ...prev, [name]: val }));
  };

  const nextStep = () => setStep(prev => Math.min(prev + 1, 3));
  const prevStep = () => setStep(prev => Math.max(prev - 1, 1));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step < 3) {
      nextStep();
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      const res = await fetch('/api/auth/register-tenant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      const data = await res.json();
      
      if (data.success) {
        onSignupComplete();
      } else {
        alert(data.error || 'Registration failed');
        setIsSubmitting(false);
      }
    } catch(err) {
      alert('Network anomaly detected.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center bg-slate-50 dark:bg-[#020617] overflow-hidden font-sans transition-colors duration-300">
      
      <FingerprintCanvas pulseState={isSubmitting ? 'success' : 'idle'} onPulseComplete={() => { if(isSubmitting) onSignupComplete(); }} />

      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 w-full max-w-2xl px-6 py-10 md:p-10 bg-white/80 dark:bg-[#0a1a17]/80 backdrop-blur-xl border border-slate-200 dark:border-emerald-900/50 rounded-2xl shadow-2xl"
      >
        <div className="flex flex-col md:flex-row items-center justify-between mb-8 gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-950 border border-emerald-500/30 rounded-xl flex items-center justify-center text-emerald-600 dark:text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.2)]">
              <Building2 className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{t('signup.title')}</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">{t('signup.subtitle')}</p>
            </div>
          </div>
          
          <div className="flex gap-2">
            {[1, 2, 3].map(i => (
              <div key={i} className={cn("w-3 h-3 rounded-full transition-all", step >= i ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-slate-200 dark:bg-slate-800")} />
            ))}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                <h2 className="text-sm font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400 mb-4 border-b border-emerald-500/20 pb-2">{t('signup.step1')}</h2>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase px-1">{t('signup.companyName')}</label>
                    <input required name="companyName" value={formData.companyName} onChange={handleChange} className={cn("w-full bg-slate-50 dark:bg-[#020617]/50 border border-slate-200 dark:border-slate-800 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-emerald-500 font-bold dark:text-white", isRtl && "text-right")} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase px-1">{t('signup.tenantSlug')}</label>
                    <input required name="tenantSlug" value={formData.tenantSlug} onChange={handleChange} className={cn("w-full bg-slate-50 dark:bg-[#020617]/50 border border-slate-200 dark:border-slate-800 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-emerald-500 font-mono text-emerald-600 dark:text-emerald-400", isRtl && "text-right")} />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase px-1">{t('signup.adminEmail')}</label>
                    <input type="email" required name="adminEmail" value={formData.adminEmail} onChange={handleChange} className={cn("w-full bg-slate-50 dark:bg-[#020617]/50 border border-slate-200 dark:border-slate-800 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-emerald-500 font-mono dark:text-white", isRtl && "text-right")} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase px-1">{t('signup.adminPass')}</label>
                    <input type="password" required name="adminPassword" value={formData.adminPassword} onChange={handleChange} className={cn("w-full bg-slate-50 dark:bg-[#020617]/50 border border-slate-200 dark:border-slate-800 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-emerald-500 font-mono dark:text-white", isRtl && "text-right")} />
                  </div>
                </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                <h2 className="text-sm font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400 mb-4 border-b border-emerald-500/20 pb-2">{t('signup.step2')}</h2>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase px-1 flex items-center gap-2"><Wallet className="w-4 h-4"/>{t('signup.currency')}</label>
                    <select name="currency" value={formData.currency} onChange={handleChange} className={cn("w-full bg-slate-50 dark:bg-[#020617]/50 border border-slate-200 dark:border-slate-800 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-emerald-500 font-mono font-bold dark:text-white", isRtl && "text-right")}>
                      <option value="USD">USD ($)</option>
                      <option value="EUR">EUR (€)</option>
                      <option value="GBP">GBP (£)</option>
                      <option value="AED">AED (د.إ)</option>
                      <option value="SAR">SAR (ر.س)</option>
                      <option value="EGP">EGP (ج.م)</option>
                    </select>
                  </div>
                  
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase px-1">{t('signup.capacity')}</label>
                    <select name="capacity" value={formData.capacity} onChange={handleChange} className={cn("w-full bg-slate-50 dark:bg-[#020617]/50 border border-slate-200 dark:border-slate-800 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-emerald-500 font-mono dark:text-white", isRtl && "text-right")}>
                      <option value="1-50">1 - 50</option>
                      <option value="50-100">50 - 100</option>
                      <option value="100-500">100 - 500</option>
                      <option value="500+">500+</option>
                    </select>
                  </div>
                </div>

                <div className="pt-4">
                  <label className="flex items-center gap-3 p-4 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50 dark:bg-[#020617]/30 cursor-pointer hover:border-emerald-500/50 transition-colors">
                    <div className="relative flex items-center justify-center">
                      <input type="checkbox" name="allowsLoans" checked={formData.allowsLoans} onChange={handleChange} className="sr-only" />
                      <div className={cn("w-6 h-6 rounded border flex items-center justify-center transition-colors", formData.allowsLoans ? "bg-emerald-500 border-emerald-500" : "bg-transparent border-slate-300 dark:border-slate-600")}>
                        {formData.allowsLoans && <CheckCircle2 className="w-4 h-4 text-white" />}
                      </div>
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-slate-900 dark:text-white">{t('signup.loans')}</h3>
                      <p className="text-xs text-slate-500">Enable advanced payroll deductions and standard corporate loan requests.</p>
                    </div>
                  </label>
                </div>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                <h2 className="text-sm font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400 mb-4 border-b border-emerald-500/20 pb-2">{t('signup.step3')}</h2>
                
                <InteractiveMap 
                  lat={formData.lat} lng={formData.lng} radius={formData.radius}
                  setLat={(val: number) => setFormData(p => ({ ...p, lat: val }))}
                  setLng={(val: number) => setFormData(p => ({ ...p, lng: val }))}
                  setRadius={(val: number) => setFormData(p => ({ ...p, radius: val }))}
                />

                <div className="mt-4 p-4 bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-xl">
                  <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} className="flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest hover:text-emerald-500 transition-colors">
                    <Settings2 className="w-4 h-4"/> Advanced Spatial Parameters
                  </button>
                  <AnimatePresence>
                    {showAdvanced && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden mt-3">
                        <div className="p-3 bg-white dark:bg-[#020617] rounded border border-slate-200 dark:border-emerald-900/40 text-[10px] font-mono text-emerald-600 dark:text-emerald-400 space-y-1">
                          <p>ST_MakePoint({formData.lng}, {formData.lat})</p>
                          <p>ST_Buffer(geom, {formData.radius})</p>
                          <p>CREATE INDEX geom_idx ON tenants USING GIST (boundary);</p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

              </motion.div>
            )}
          </AnimatePresence>

          {/* Navigation Buttons */}
          <div className="flex items-center justify-between pt-6 border-t border-slate-200 dark:border-slate-800">
             <button 
               type="button" 
               onClick={prevStep}
               className={cn("px-4 py-2 font-bold text-sm text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors flex items-center gap-2 uppercase tracking-widest", step === 1 && "invisible")}
             >
               <ArrowLeft className="w-4 h-4" /> {t('signup.back')}
             </button>

             <button 
               type="submit"
               disabled={isSubmitting}
               className={cn("px-6 py-2.5 rounded-lg font-bold text-sm transition-all focus:outline-none flex items-center gap-2 uppercase tracking-widest shadow-lg", 
                 isSubmitting ? "bg-emerald-600 opacity-80 text-white" : 
                 "bg-gradient-to-tr from-emerald-600 to-emerald-400 text-slate-950 hover:scale-105 hover:shadow-[0_0_20px_rgba(16,185,129,0.4)]"
               )}
             >
               {isSubmitting ? (
                 <span className="flex items-center gap-2">
                   <span className="w-4 h-4 border-2 border-slate-900 border-t-transparent rounded-full animate-spin"></span>
                   {t('signup.complete')}
                 </span>
               ) : step < 3 ? (
                 <>
                   {t('signup.next')} <ArrowRight className="w-4 h-4" />
                 </>
               ) : (
                 <>
                   <CheckCircle2 className="w-4 h-4" /> {t('signup.complete')}
                 </>
               )}
             </button>
          </div>
        </form>

        <div className="mt-6 text-center">
            <button onClick={onNavigateLogin} className="text-[10px] font-bold text-slate-400 hover:text-emerald-500 tracking-widest uppercase transition-colors">
              {t('signup.login')}
            </button>
        </div>

      </motion.div>
    </div>
  );
}
