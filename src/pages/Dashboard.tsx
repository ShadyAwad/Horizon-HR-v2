import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Fingerprint, LogOut, MapPin, Map, Navigation, 
  Calendar, CheckCircle2, AlertTriangle, User, Settings2 , Sun, Moon
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useLanguage } from '../lib/LanguageContext';

// Helper hook for Geolocation fetching
function useGeolocation() {
  const [coords, setCoords] = useState<{lat: number, lng: number} | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const requestCoordinates = () => {
    setLoading(true);
    setError(null);
    if (!navigator.geolocation) {
      setError("Geolocation is not supported by your browser");
      setLoading(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        });
        setLoading(false);
      },
      (err) => {
        setError(`Location access denied. Please allow permissions.`);
        setLoading(false);
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  };

  return { coords, error, loading, requestCoordinates };
}

export function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [activeTab, setActiveTab] = useState<'geofence' | 'roster' | 'profile'>('geofence');
  const [clockInState, setClockInState] = useState<'idle' | 'locating' | 'verifying' | 'success' | 'failed'>('idle');
  const [clockMessage, setClockMessage] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [isDark, setIsDark] = useState(() =>
  document.documentElement.classList.contains('dark')
);

const toggleTheme = () => {
  const next = !isDark;
  setIsDark(next);
  document.documentElement.classList.toggle('dark', next);
};

  const geo = useGeolocation();

  const { t, lang, setLang, isRtl } = useLanguage();

  const handleClockIn = async () => {
    setClockInState('locating');
    geo.requestCoordinates();
  };

  // When coords change after request, verify with backend
  useEffect(() => {
    if (geo.coords && clockInState === 'locating') {
      verifyClockIn(geo.coords.lat, geo.coords.lng);
    } else if (geo.error && clockInState === 'locating') {
      setClockInState('failed');
      setClockMessage(geo.error);
    }
  }, [geo.coords, geo.error]);

  const verifyClockIn = async (lat: number, lng: number) => {
    setClockInState('verifying');
    try {
        const res = await fetch('/api/clock-in', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ latitude: lat, longitude: lng })
        });
        const data = await res.json();
        
        if (data.locationValid) {
            setClockInState('success');
            setClockMessage(data.message);
        } else {
            setClockInState('failed');
            setClockMessage(data.message);
        }
    } catch(err) {
        setClockInState('failed');
        setClockMessage('Server disconnection. Unable to verify location.');
    }
    
    // Reset state after 4 seconds
    setTimeout(() => {
      setClockInState('idle');
      setClockMessage('');
    }, 4000);
  };

  // Mock schedule data
  const schedule = [
    { day: 'Mon', date: '24', shift: '09:00 - 17:00', type: 'Office HQ' },
    { day: 'Tue', date: '25', shift: '09:00 - 17:00', type: 'Office HQ' },
    { day: 'Wed', date: '26', shift: '09:00 - 17:00', type: 'Remote' },
    { day: 'Thu', date: '27', shift: 'Leave', type: 'Annual' },
    { day: 'Fri', date: '28', shift: '09:00 - 14:00', type: 'Office HQ' },
  ];

  return (
    <div className="min-h-[100dvh] bg-slate-50 dark:bg-[#020617] text-slate-900 dark:text-slate-200 font-sans flex flex-col md:flex-row overflow-hidden relative transition-colors duration-300">
      
      {/* Background Rings */}
      <div className="absolute inset-0 opacity-10 pointer-events-none z-0 overflow-hidden hidden md:block">
        <svg className="w-full h-full object-cover" viewBox="0 0 1024 768" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">
          <path className="stroke-emerald-500" d="M512 100C300 100 100 300 100 512M512 150C340 150 180 310 180 482M512 200C380 200 260 320 260 452" strokeWidth="1.5" strokeDasharray="10 5" />
          <circle cx="512" cy="512" r="400" className="stroke-emerald-300 dark:stroke-emerald-900" strokeWidth="0.5" />
          <circle cx="512" cy="512" r="350" className="stroke-emerald-300 dark:stroke-emerald-900" strokeWidth="0.5" />
          <circle cx="512" cy="512" r="300" className="stroke-emerald-300 dark:stroke-emerald-900" strokeWidth="0.5" />
        </svg>
      </div>

      {/* Sidebar Navigation */}
      <aside className={cn("w-full md:w-20 md:h-full bg-white/80 dark:bg-[#061411]/80 backdrop-blur-md border-b md:border-b-0 md:border-r border-slate-200 dark:border-emerald-900/40 flex md:flex-col items-center py-4 md:py-8 px-6 md:px-0 gap-6 md:gap-10 z-20 shrink-0", isRtl ? "md:border-l md:border-r-0" : "md:border-r")}>
        <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-[0_0_20px_rgba(16,185,129,0.3)]">
          <Fingerprint className="w-6 h-6 md:w-8 md:h-8 text-white dark:text-[#020617]" />
        </div>
        <nav className="flex md:flex-col gap-4 md:gap-6 w-full items-center justify-center md:justify-start">
          <button 
            onClick={() => setActiveTab('geofence')}
            className={cn("w-10 h-10 rounded-lg flex items-center justify-center transition-colors cursor-pointer", activeTab === 'geofence' ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20" : "hover:bg-emerald-500/5 text-slate-500")}
          >
             <Map className="w-5 h-5" />
          </button>
          <button 
            onClick={() => setActiveTab('roster')}
            className={cn("w-10 h-10 rounded-lg flex items-center justify-center transition-colors cursor-pointer", activeTab === 'roster' ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20" : "hover:bg-emerald-500/5 text-slate-500")}
          >
             <Calendar className="w-5 h-5" />
          </button>
          <button 
            onClick={() => setActiveTab('profile')}
            className={cn("w-10 h-10 rounded-lg flex items-center justify-center transition-colors cursor-pointer", activeTab === 'profile' ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20" : "hover:bg-emerald-500/5 text-slate-500")}
          >
             <User className="w-5 h-5" />
          </button>
        </nav>
      </aside>

      <main className="flex-1 flex flex-col p-4 md:p-8 z-10 overflow-y-auto">
        
        {/* Header Pipeline */}
        <header className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center">
               {t('login.title')} <span className={cn("text-emerald-600 dark:text-emerald-500 bg-emerald-500/10 font-mono text-xs px-2 py-0.5 border border-emerald-500/30 rounded uppercase hidden sm:inline-block", isRtl ? "mr-3" : "ml-3")}>{t('dash.elitePortal')}</span>
            </h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">{t('dash.auth')}: Cyberdyne-Node-082 • Tenant ID: CY-X8922</p>
          </div>
          
          <div className="flex items-center gap-4">
            {/* Locale Toggle & Theme Toggle */}
            <div className="flex items-center gap-2 px-3 py-1.5 md:px-4 md:py-2 bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-lg shrink-0 shadow-sm">
              <span className={cn("hidden md:inline-block text-xs font-semibold text-slate-500 uppercase tracking-widest", isRtl ? "ml-2" : "mr-2")}>{t('dash.core')}</span>

              <button
  onClick={toggleTheme}
  className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-emerald-500 dark:hover:text-emerald-300 transition-all duration-150 active:scale-90 hover:scale-105"
  title="Toggle Light/Dark Mode"
>
  {isDark ? (
    <Moon className="w-4 h-4" />
  ) : (
    <Sun className="w-4 h-4" />
  )}
</button>
<button 
  type="button"
  onClick={() => setLang('en')} 
  className={cn(
    "text-xs font-bold transition-colors",
    lang === 'en'
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-300"
  )}
>
  EN-US
</button>

<div className="w-px h-3 bg-slate-200 dark:bg-slate-700"></div>

<button 
  type="button"
  onClick={() => setLang('ar')} 
  className={cn(
    "text-xs font-bold transition-colors",
    lang === 'ar'
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-300"
  )}
>
  AR-AE
</button>
            </div>

            {/* Profile Element */}
            <div className="flex items-center gap-3">
              <div className={cn("hidden sm:block", isRtl ? "text-left" : "text-right")}>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-200">Sarah Connor</p>
                <button onClick={onLogout} className={cn("text-[10px] text-emerald-600 dark:text-emerald-500 font-mono hover:text-emerald-700 dark:hover:text-emerald-400 uppercase flex items-center gap-1 transition-colors", isRtl ? "justify-start" : "justify-end")}>
                  <LogOut className="w-3 h-3" /> {t('dash.terminate')}
                </button>
              </div>
              <div className="w-10 h-10 rounded-full border-2 border-emerald-500 p-0.5 shrink-0 bg-white dark:bg-[#020617]">
                <div className="w-full h-full rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-700 dark:text-white tracking-widest">SC</div>
              </div>
            </div>
          </div>
        </header>

        {/* Dashboard Grid Container */}
        <div className="flex flex-col xl:flex-row gap-6 flex-1 max-w-[1400px] mx-auto w-full">
            
            {/* Main Action Area (Left / Center) */}
            <div className="flex-1 space-y-6 max-w-full">
                
                {/* Tabs styled like immersive pills (Hidden on small screens, duplicated from sidebar for context) */}
                <div className="hidden md:flex items-center gap-2 mb-2 border-b border-slate-200 dark:border-emerald-900/40 pb-4">
                    <button 
                       onClick={() => setActiveTab('geofence')}
                       className={cn("px-4 py-2 text-xs font-bold uppercase tracking-widest rounded transition-all flex items-center gap-2 border", activeTab === 'geofence' ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20" : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300")}
                    >
                       <MapPin className="w-4 h-4 hidden sm:block" />
                       {t('dash.geoOp')}
                    </button>
                    <button 
                       onClick={() => setActiveTab('roster')}
                       className={cn("px-4 py-2 text-xs font-bold uppercase tracking-widest rounded transition-all flex items-center gap-2 border", activeTab === 'roster' ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20" : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300")}
                    >
                       <Calendar className="w-4 h-4 hidden sm:block" />
                       {t('dash.roster')}
                    </button>
                    <button 
                       onClick={() => setActiveTab('profile')}
                       className={cn("px-4 py-2 text-xs font-bold uppercase tracking-widest rounded transition-all flex items-center gap-2 border", activeTab === 'profile' ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20" : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300")}
                    >
                       <User className="w-4 h-4 hidden sm:block" />
                       {t('dash.profile')}
                    </button>
                </div>

                {/* Tab Contents */}
                {activeTab === 'geofence' && (
                    <motion.div initial={{opacity:0, y:5}} animate={{opacity:1, y:0}} className="bg-white dark:bg-[#0a1a17]/90 border border-slate-200 dark:border-emerald-500/20 rounded-2xl p-6 flex flex-col items-center justify-center text-center backdrop-blur-sm relative overflow-hidden group shadow-xl">
                       <div className="absolute inset-0 bg-slate-50/50 dark:bg-emerald-500/5 group-hover:bg-slate-100/50 dark:group-hover:bg-emerald-500/10 transition-colors pointer-events-none"></div>
                       <div className="w-full flex items-start justify-between mb-6 z-10 relative">
                           <div className={cn("flex flex-col gap-1", isRtl ? "items-end text-right" : "items-start text-left")}>
                               <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                <MapPin className="w-5 h-5 text-emerald-500" />
                                {t('dash.perimeter')}
                               </h2>
                               <p className="text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-transparent font-mono border border-emerald-200 dark:border-emerald-500/30 px-2 py-0.5 rounded uppercase tracking-widest">{t('dash.hqSecure')}</p>
                           </div>
                       </div>
                       
                       <div className="relative z-10 w-full flex flex-col items-center justify-center py-12 px-8 bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/50 rounded-2xl min-h-[400px]">
                           <div className="w-40 h-40 rounded-full border-4 border-dashed border-emerald-900 flex items-center justify-center mb-6 relative">
                             {clockInState === 'success' && <div className="absolute inset-0 rounded-full shadow-[0_0_50px_rgba(16,185,129,0.3)] animate-pulse"></div>}
                             <button 
                               onClick={handleClockIn}
                               disabled={clockInState !== 'idle'}
                               className={cn(
                                   "w-32 h-32 rounded-full flex flex-col items-center justify-center gap-1 transition-all duration-300 font-black tracking-tighter hover:scale-105 active:scale-95 z-10 relative",
                                   clockInState === 'idle' ? "bg-gradient-to-tr from-emerald-600 to-emerald-400 text-slate-950 shadow-[0_0_30px_rgba(16,185,129,0.4)] hover:shadow-[0_0_40px_rgba(16,185,129,0.6)]" :
                                   clockInState === 'locating' || clockInState === 'verifying' ? "bg-slate-800 text-slate-400 animate-pulse border border-slate-700 shadow-none" :
                                   clockInState === 'success' ? "bg-emerald-500 text-slate-900 shadow-[0_0_40px_rgba(16,185,129,0.6)]" :
                                   "bg-red-500 text-white shadow-[0_0_40px_rgba(239,68,68,0.6)]"
                               )}
                             >
                              <AnimatePresence mode="popLayout">
                                 {clockInState === 'idle' && (
                                     <motion.div key="idle" initial={{scale:0}} animate={{scale:1}} exit={{scale:0}} className="flex flex-col items-center">
                                         <span className="text-[10px] sm:text-xs tracking-widest">{t('dash.clockIn')}</span>
                                     </motion.div>
                                 )}
                                 {(clockInState === 'locating' || clockInState === 'verifying') && (
                                     <motion.div key="loading" initial={{scale:0}} animate={{scale:1}} exit={{scale:0}} className="flex flex-col items-center">
                                         <Navigation className="w-8 h-8 mb-2 animate-spin-slow" />
                                         <span className="font-bold text-[10px] uppercase tracking-widest">{clockInState === 'locating' ? t('dash.locating') : t('dash.verifying')}</span>
                                     </motion.div>
                                 )}
                                 {clockInState === 'success' && (
                                     <motion.div key="success" initial={{scale:0}} animate={{scale:1}} exit={{scale:0}} className="flex flex-col items-center">
                                         <CheckCircle2 className="w-10 h-10 mb-1 opacity-90" />
                                         <span className="font-bold text-[10px] uppercase tracking-widest leading-none">{t('dash.verified')}</span>
                                     </motion.div>
                                 )}
                                 {clockInState === 'failed' && (
                                     <motion.div key="failed" initial={{scale:0}} animate={{scale:1}} exit={{scale:0}} className="flex flex-col items-center">
                                         <AlertTriangle className="w-10 h-10 mb-1" />
                                         <span className="font-bold text-[10px] uppercase tracking-widest leading-none">{t('dash.breach')}</span>
                                     </motion.div>
                                 )}
                              </AnimatePresence>
                             </button>
                           </div>

                           {/* Dynamic Status Display */}
                           <div className="h-6 flex items-center justify-center gap-2 mt-4">
                            <AnimatePresence mode="wait">
                                {clockMessage ? (
                                    <motion.div 
                                        key="msg"
                                        initial={{opacity: 0, scale: 0.9}} 
                                        animate={{opacity: 1, scale: 1}}
                                        exit={{opacity: 0, scale: 0.9}}
                                        className="flex items-center gap-2"
                                    >
                                        <span className={cn("flex h-2 w-2 rounded-full", clockInState === 'success' ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,1)]" : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,1)]")}></span>
                                        <span className={cn("text-[10px] uppercase font-bold tracking-widest", clockInState === 'success' ? "text-emerald-400" : "text-red-400")}>
                                            {t('dash.sysMsg')} {clockMessage}
                                        </span>
                                    </motion.div>
                                ) : (
                                    <motion.div 
                                        key="idle"
                                        initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}}
                                        className="flex items-center gap-2 text-slate-500"
                                    >
                                        <span className="flex h-2 w-2 rounded-full bg-slate-600 animate-pulse"></span>
                                        <span className="text-[10px] uppercase tracking-widest">{t('dash.awaitingInput')}</span>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                           </div>
                       </div>
                    </motion.div>
                )}                

                {activeTab === 'roster' && (
                    <motion.div initial={{opacity:0, y:5}} animate={{opacity:1, y:0}} className="bg-white dark:bg-[#0a1a17]/40 border border-slate-200 dark:border-emerald-500/10 rounded-2xl flex flex-col overflow-hidden backdrop-blur-sm shadow-xl min-h-[400px]">
                       <div className="p-5 border-b border-slate-200 dark:border-emerald-500/10 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                           <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                             <Calendar className="w-5 h-5 text-emerald-600 dark:text-emerald-500" />
                             {t('dash.rosterHub')}
                           </h3>
                           <div className="flex gap-2">
                             <button className="px-3 py-1 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs rounded border border-emerald-200 dark:border-emerald-500/20 font-bold uppercase">{t('dash.weekView')}</button>
                             <button className="px-3 py-1 text-slate-500 dark:text-slate-400 text-xs hover:text-slate-800 dark:hover:text-slate-300 font-bold uppercase transition-colors">{t('dash.applyLeave')}</button>
                           </div>
                       </div>
                       
                       <div className="w-full overflow-x-auto flex-1">
                         <table className={cn("w-full min-w-[500px]", isRtl ? "text-right" : "text-left")}>
                           <thead>
                             <tr className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-bold border-b border-slate-200 dark:border-slate-800/50 bg-slate-50 dark:bg-slate-900/20">
                               <th className="p-4">{t('dash.dayDate')}</th>
                               <th className="p-4">{t('dash.shiftFrame')}</th>
                               <th className="p-4">{t('dash.locationRole')}</th>
                               <th className={cn("p-4", isRtl ? "text-left" : "text-right")}>{t('dash.status')}</th>
                             </tr>
                           </thead>
                           <tbody className="text-sm">
                             {schedule.map((s, i) => (
                               <tr key={i} className="border-b border-slate-100 dark:border-slate-800/50 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 transition-colors group">
                                 <td className="p-4">
                                   <div className="font-bold text-slate-800 dark:text-slate-200 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">{s.day}, {s.date}</div>
                                 </td>
                                 <td className="p-4 font-mono text-xs text-slate-500 dark:text-slate-400">
                                   {s.shift}
                                 </td>
                                 <td className="p-4 text-xs text-slate-600 dark:text-slate-300">
                                   <span className="opacity-80">{s.type}</span>
                                 </td>
                                 <td className={cn("p-4", isRtl ? "text-left" : "text-right")}>
                                   <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider", s.shift === 'Leave' ? "bg-slate-100 dark:bg-slate-800 text-slate-500" : "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30")}>
                                     {s.shift === 'Leave' ? t('dash.abstained') : t('dash.scheduled')}
                                   </span>
                                 </td>
                               </tr>
                             ))}
                           </tbody>
                         </table>
                       </div>
                    </motion.div>
                )}

                {activeTab === 'profile' && (
                   <motion.div initial={{opacity:0, y:5}} animate={{opacity:1, y:0}} className="bg-white dark:bg-[#0a1a17]/90 border border-slate-200 dark:border-emerald-500/20 rounded-2xl p-6 shadow-xl backdrop-blur-sm min-h-[400px]">
                      <div className="flex items-center gap-4 mb-8">
                          <User className="w-8 h-8 text-emerald-600 dark:text-emerald-500" />
                          <div>
                            <h2 className="text-lg font-bold text-slate-900 dark:text-white">{t('profile.title')}</h2>
                            <p className="text-xs text-emerald-600 dark:text-emerald-400 font-mono uppercase tracking-widest">{t('profile.subtitle')}</p>
                          </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                         <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/50 p-5 rounded-xl flex flex-col justify-between">
                            <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">{t('profile.leaveName')}</p>
                            <p className="text-3xl font-bold text-slate-800 dark:text-white">24.5 <span className="text-sm text-slate-500 font-normal">{t('profile.leaveDays')}</span></p>
                            <div className="w-full h-1 bg-slate-200 dark:bg-slate-800 mt-3 rounded-full overflow-hidden">
                              <div className="w-[70%] h-full bg-emerald-500"></div>
                            </div>
                         </div>
                         <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/50 p-5 rounded-xl flex flex-col justify-between">
                            <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">{t('profile.loan')}</p>
                            <p className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                               <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-500" />
                               Cleared
                            </p>
                            <p className="text-[10px] text-emerald-600 dark:text-emerald-500 mt-1 font-mono uppercase tracking-widest">No active liabilities</p>
                         </div>
                         <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/50 p-5 rounded-xl flex items-center justify-between cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                            <p className="font-bold text-slate-700 dark:text-slate-300">{t('profile.payroll')}</p>
                            <Settings2 className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                         </div>
                         <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/50 p-5 rounded-xl flex items-center justify-between cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                            <p className="font-bold text-slate-700 dark:text-slate-300">{t('profile.grievance')}</p>
                            <Settings2 className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                         </div>
                      </div>
                   </motion.div>
                )}

            </div>

            {/* Sidebar (Right) / Stats & Insights */}
            <div className="w-full xl:w-80 flex flex-col gap-6 shrink-0 z-10">
                 {/* Replaced Org CTE Box with something more fitting or just Advanced Params */}
                 <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/50 rounded-2xl p-6 backdrop-blur-sm shadow-xl flex-1 max-h-[300px]">
                    <button 
                        onClick={() => setShowAdvanced(!showAdvanced)}
                        className="flex items-center justify-between w-full group"
                    >
                        <span className="flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-widest group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                           <Settings2 className="w-5 h-5"/> {t('dash.advParams')}
                        </span>
                        <span className="text-lg font-mono text-slate-500 group-hover:text-emerald-600 dark:group-hover:text-emerald-400">{showAdvanced ? '-' : '+'}</span>
                    </button>
                    
                    <div className="mt-8 border-t border-slate-200 dark:border-slate-800 pt-6">
                        <p className="text-[10px] text-slate-500 font-mono mb-2 uppercase tracking-widest">System Architecture Info</p>
                        <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-3 font-mono">
                           <li className="flex justify-between border-b border-slate-100 dark:border-slate-800 pb-2"><span>Network Node</span> <span className="text-emerald-600 dark:text-emerald-400">#X-901</span></li>
                           <li className="flex justify-between border-b border-slate-100 dark:border-slate-800 pb-2"><span>Query Performance</span> <span className="text-emerald-600 dark:text-emerald-400">2.4ms</span></li>
                           <li className="flex justify-between pb-2"><span>RDS Status</span> <span className="text-emerald-600 dark:text-emerald-400">Sync Optimal</span></li>
                        </ul>
                    </div>

                    <AnimatePresence>
                        {showAdvanced && (
                            <motion.div 
                                initial={{height:0, opacity:0}} animate={{height:'auto', opacity:1}} exit={{height:0, opacity:0}}
                                className="overflow-hidden mt-6"
                            >
                                <div className="p-4 bg-slate-50 dark:bg-[#0a1a17]/50 border border-slate-200 dark:border-emerald-900/50 rounded-lg text-xs text-emerald-700 dark:text-emerald-400 font-mono space-y-2 opacity-80">
                                    <p>&gt; GiST_INDEX: <span className="text-emerald-600 dark:text-emerald-300">ONLINE</span></p>
                                    <p>&gt; RLS_BOUND: <span className="text-emerald-600 dark:text-emerald-300">tenant_sys_49</span></p>
                                    <p>&gt; JWT_TTL: <span className="text-emerald-600 dark:text-emerald-300">3600s</span></p>
                                    <p>&gt; LOC: <span className="text-emerald-600 dark:text-emerald-300">[{geo.coords?.lat?.toFixed(3) || '0.000'}, {geo.coords?.lng?.toFixed(3) || '0.000'}]</span></p>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                 </div>

                 {/* Active Managers Pill (Bottom) */}
                 <div className="hidden xl:flex bg-emerald-50 dark:bg-emerald-500/5 border border-emerald-200 dark:border-emerald-500/10 backdrop-blur-xl px-4 py-3 rounded-full items-center gap-3 shadow-xl w-fit">
                    <div className="flex -space-x-2">
                        <div className="w-6 h-6 rounded-full bg-emerald-300 dark:bg-emerald-900 border border-emerald-400 dark:border-emerald-500/30 shadow-md"></div>
                        <div className="w-6 h-6 rounded-full bg-emerald-200 dark:bg-emerald-800 border border-emerald-400 dark:border-emerald-500/30 shadow-md"></div>
                    </div>
                    <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-bold uppercase tracking-widest">{t('dash.adminsOnline')}</span>
                 </div>
            </div>

        </div>
      </main>
    </div>
  );
}