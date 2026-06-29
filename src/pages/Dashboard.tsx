import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Fingerprint, LogOut, MapPin, Map, Navigation, 
  Calendar, CheckCircle2, AlertTriangle, User, Settings2 , Sun, Moon, Bell, Coffee, Save, DollarSign
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useLanguage } from '../lib/LanguageContext';
import { useTheme } from '../lib/ThemeContext';
import type { AuthUser } from '../App';

type ClockActionState = 'idle' | 'locating' | 'verifying' | 'success' | 'failed';

type ShiftRow = {
  day: string;
  date: string;
  shiftStart: string;
  shiftEnd: string;
  breakStart: string;
  breakEnd: string;
  type: string;
};

type NotificationSettings = {
  breakStart: boolean;
  breakEnd: boolean;
};

type PayrollRecord = {
  id: string;
  employee_id: string;
  full_name?: string;
  email?: string;
  pay_period_start: string;
  pay_period_end: string;
  base_salary: string | number;
  bonuses: string | number;
  deductions: string | number;
  net_pay: string | number;
  currency: string;
  status: string;
  generated_at: string;
  paid_at?: string | null;
};

type PayrollFormState = {
  payPeriodStart: string;
  payPeriodEnd: string;
  defaultBaseSalary: string;
  bonuses: string;
  deductions: string;
};

const defaultSchedule: ShiftRow[] = [
  { day: 'Mon', date: '24', shiftStart: '09:00', shiftEnd: '17:00', breakStart: '13:00', breakEnd: '13:30', type: 'Office HQ' },
  { day: 'Tue', date: '25', shiftStart: '09:00', shiftEnd: '17:00', breakStart: '13:00', breakEnd: '13:30', type: 'Office HQ' },
  { day: 'Wed', date: '26', shiftStart: '09:00', shiftEnd: '17:00', breakStart: '12:30', breakEnd: '13:00', type: 'Remote' },
  { day: 'Thu', date: '27', shiftStart: '', shiftEnd: '', breakStart: '', breakEnd: '', type: 'Annual Leave' },
  { day: 'Fri', date: '28', shiftStart: '09:00', shiftEnd: '14:00', breakStart: '11:30', breakEnd: '12:00', type: 'Office HQ' },
];

const defaultNotificationSettings: NotificationSettings = {
  breakStart: true,
  breakEnd: true,
};

const defaultPayrollForm: PayrollFormState = {
  payPeriodStart: '',
  payPeriodEnd: '',
  defaultBaseSalary: '',
  bonuses: '0',
  deductions: '0',
};

function readStoredSchedule() {
  if (typeof window === 'undefined') return defaultSchedule;

  try {
    const storedSchedule = window.localStorage.getItem('horizon-roster');
    return storedSchedule ? JSON.parse(storedSchedule) as ShiftRow[] : defaultSchedule;
  } catch {
    return defaultSchedule;
  }
}

function readStoredNotifications() {
  if (typeof window === 'undefined') return defaultNotificationSettings;

  try {
    const storedSettings = window.localStorage.getItem('horizon-notifications');
    return storedSettings ? JSON.parse(storedSettings) as NotificationSettings : defaultNotificationSettings;
  } catch {
    return defaultNotificationSettings;
  }
}

function getShiftFrame(shift: ShiftRow) {
  return shift.shiftStart && shift.shiftEnd ? `${shift.shiftStart} - ${shift.shiftEnd}` : 'Leave';
}

function formatRole(role: AuthUser['role']) {
  return role === 'hr_admin' ? 'HR Admin' : role === 'manager' ? 'Manager' : 'Employee';
}

function formatPayrollAmount(value: string | number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
  }).format(Number(value));
}

function formatPayrollDate(value: string) {
  return new Date(value).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function notifyEmployee(title: string, body: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  new Notification(title, { body });
}

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

export function Dashboard({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const [activeTab, setActiveTab] = useState<'geofence' | 'roster' | 'profile'>('geofence');
  const [clockInState, setClockInState] = useState<ClockActionState>('idle');
  const [clockMessage, setClockMessage] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isClockedIn, setIsClockedIn] = useState(false);
  const [activeTimeLogId, setActiveTimeLogId] = useState<string | null>(null);
  const [lastClockEvent, setLastClockEvent] = useState<string>('No active shift recorded.');
  const [schedule, setSchedule] = useState<ShiftRow[]>(readStoredSchedule);
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(readStoredNotifications);
  const [showPayrollPanel, setShowPayrollPanel] = useState(false);
  const [payrollRecords, setPayrollRecords] = useState<PayrollRecord[]>([]);
  const [payrollLoading, setPayrollLoading] = useState(false);
  const [payrollMessage, setPayrollMessage] = useState('');
  const [payrollForm, setPayrollForm] = useState<PayrollFormState>(defaultPayrollForm);

  const geo = useGeolocation();

  const { t, lang, setLang, isRtl } = useLanguage();
  const { isDark, toggleTheme } = useTheme();
  const canManageRoster = user.role === 'hr_admin' || user.role === 'manager';

  const requestNotificationPermission = async () => {
    if (!('Notification' in window) || Notification.permission !== 'default') return;
    await Notification.requestPermission();
  };

  const updateNotificationSetting = async (key: keyof NotificationSettings, value: boolean) => {
    if (value) {
      await requestNotificationPermission();
    }

    setNotificationSettings((current) => ({ ...current, [key]: value }));
  };

  const handleClockAction = async () => {
    if (isClockedIn) {
      await verifyClockOut();
      return;
    }

    setClockInState('locating');
    geo.requestCoordinates();
  };

  useEffect(() => {
    if (geo.coords && clockInState === 'locating') {
      verifyClockIn(geo.coords.lat, geo.coords.lng);
    } else if (geo.error && clockInState === 'locating') {
      setClockInState('failed');
      setClockMessage(geo.error);
    }
  }, [geo.coords, geo.error]);

  useEffect(() => {
    window.localStorage.setItem('horizon-roster', JSON.stringify(schedule));
  }, [schedule]);

  useEffect(() => {
    window.localStorage.setItem('horizon-notifications', JSON.stringify(notificationSettings));
  }, [notificationSettings]);

  useEffect(() => {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    const todayCode = new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(new Date());
    const todaysShift = schedule.find((shift) => shift.day === todayCode);
    const timers: number[] = [];

    const scheduleBreakReminder = (
      enabled: boolean,
      time: string,
      title: string,
      body: string,
    ) => {
      if (!enabled || !time) return;

      const [hours, minutes] = time.split(':').map(Number);
      const reminderAt = new Date();
      reminderAt.setHours(hours, minutes, 0, 0);

      const delay = reminderAt.getTime() - Date.now();
      if (delay <= 0) return;

      timers.push(window.setTimeout(() => notifyEmployee(title, body), delay));
    };

    if (todaysShift) {
      scheduleBreakReminder(
        notificationSettings.breakStart,
        todaysShift.breakStart,
        'Break starting',
        `Your break starts at ${todaysShift.breakStart}.`,
      );
      scheduleBreakReminder(
        notificationSettings.breakEnd,
        todaysShift.breakEnd,
        'Break ending',
        `Your break ends at ${todaysShift.breakEnd}.`,
      );
    }

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [notificationSettings, schedule]);

  const verifyClockIn = async (lat: number, lng: number) => {
    setClockInState('verifying');
    try {
        const res = await fetch('/api/clock-in', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
              tenantId: user.tenantId,
              employeeId: user.id,
              latitude: lat,
              longitude: lng,
            })
        });
        const data = await res.json();
        
        if (res.ok && data.success) {
            setClockInState('success');
            setIsClockedIn(true);
            setActiveTimeLogId(data.timeLogId || null);
            setLastClockEvent(`Clocked in at ${new Date(data.clockedIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
            setClockMessage(data.message);
        } else {
            setClockInState('failed');
            setClockMessage(data.error || data.message || 'Unable to record clock-in.');
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

  const verifyClockOut = async () => {
    setClockInState('verifying');

    try {
      const res = await fetch('/api/clock-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: user.tenantId,
          employeeId: user.id,
          timeLogId: activeTimeLogId,
        }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setClockInState('success');
        setIsClockedIn(false);
        setActiveTimeLogId(null);
        setLastClockEvent(`Clocked out at ${new Date(data.clockedOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
        setClockMessage(data.message || 'Clock-out recorded successfully.');
      } else {
        setClockInState('failed');
        setClockMessage(data.error || 'Unable to record clock-out.');
      }
    } catch {
      setClockInState('failed');
      setClockMessage('Server disconnection. Unable to record clock-out.');
    }

    setTimeout(() => {
      setClockInState('idle');
      setClockMessage('');
    }, 4000);
  };

  const updateShift = (index: number, field: keyof ShiftRow, value: string) => {
    setSchedule((current) => current.map((shift, shiftIndex) => (
      shiftIndex === index ? { ...shift, [field]: value } : shift
    )));
  };

  const payrollHeaders = {
    'Content-Type': 'application/json',
    'x-employee-id': user.id,
    'x-tenant-id': user.tenantId,
  };

  const loadPayrollRecords = async () => {
    setPayrollLoading(true);
    setPayrollMessage('');

    try {
      const endpoint = user.role === 'hr_admin' ? '/api/payroll' : '/api/payroll/me';
      const res = await fetch(endpoint, { headers: payrollHeaders });
      const data = await res.json();

      if (res.ok && data.success) {
        setPayrollRecords(data.payroll || []);
      } else {
        setPayrollMessage(data.error || 'Unable to load payroll records.');
      }
    } catch {
      setPayrollMessage('Server disconnection. Unable to load payroll records.');
    } finally {
      setPayrollLoading(false);
    }
  };

  const updatePayrollForm = (field: keyof PayrollFormState, value: string) => {
    setPayrollForm((current) => ({ ...current, [field]: value }));
  };

  const runPayroll = async () => {
    setPayrollLoading(true);
    setPayrollMessage('');

    try {
      const res = await fetch('/api/payroll/run', {
        method: 'POST',
        headers: payrollHeaders,
        body: JSON.stringify({
          payPeriodStart: payrollForm.payPeriodStart,
          payPeriodEnd: payrollForm.payPeriodEnd,
          defaultBaseSalary: Number(payrollForm.defaultBaseSalary),
          bonuses: Number(payrollForm.bonuses || 0),
          deductions: Number(payrollForm.deductions || 0),
        }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setPayrollMessage(`${data.message} Records: ${data.recordsGenerated}`);
        await loadPayrollRecords();
      } else {
        setPayrollMessage(data.error || 'Unable to run payroll.');
      }
    } catch {
      setPayrollMessage('Server disconnection. Unable to run payroll.');
    } finally {
      setPayrollLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'profile' && showPayrollPanel) {
      loadPayrollRecords();
    }
  }, [activeTab, showPayrollPanel, user.id, user.role, user.tenantId]);

  return (
<div className="min-h-[100dvh] bg-[#020403] text-slate-100 font-sans flex flex-col md:flex-row overflow-hidden relative transition-colors duration-300">
{/* Background Atmosphere */}
<div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
  {/* Light mode base */}
  <div className="absolute inset-0 bg-[linear-gradient(180deg,#f8fafc_0%,#ecfdf5_45%,#f8fafc_100%)] dark:hidden" />

  {/* Dark mode base */}
  <div className="absolute inset-0 hidden dark:block bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.14),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.08),transparent_38%),linear-gradient(180deg,#020403_0%,#03100b_52%,#020403_100%)]" />

  {/* Light mode topography */}
  <div
    className="absolute inset-0 bg-emerald-700/10 opacity-50 dark:hidden"
    style={{
      WebkitMaskImage: "url('/topography.svg')",
      maskImage: "url('/topography.svg')",
      WebkitMaskRepeat: 'repeat',
      maskRepeat: 'repeat',
      WebkitMaskSize: '520px 520px',
      maskSize: '520px 520px',
      WebkitMaskPosition: 'center',
      maskPosition: 'center',
    }}
  />

  {/* Dark mode topography */}
  <div
    className="absolute inset-0 hidden bg-emerald-400/20 opacity-35 dark:block"
    style={{
      WebkitMaskImage: "url('/topography.svg')",
      maskImage: "url('/topography.svg')",
      WebkitMaskRepeat: 'repeat',
      maskRepeat: 'repeat',
      WebkitMaskSize: '520px 520px',
      maskSize: '520px 520px',
      WebkitMaskPosition: 'center',
      maskPosition: 'center',
    }}
  />

  {/* Light mode soft glows */}
  <div className="absolute right-[-160px] top-[-120px] h-[420px] w-[420px] rounded-full bg-emerald-300/20 blur-3xl dark:hidden" />
  <div className="absolute left-[18%] bottom-[-220px] h-[520px] w-[520px] rounded-full bg-emerald-200/25 blur-3xl dark:hidden" />

  {/* Dark mode soft glows */}
  <div className="absolute right-[-160px] top-[-120px] hidden h-[420px] w-[420px] rounded-full bg-emerald-500/10 blur-3xl dark:block" />
  <div className="absolute left-[18%] bottom-[-220px] hidden h-[520px] w-[520px] rounded-full bg-emerald-400/5 blur-3xl dark:block" />

  {/* Dark mode vignette only */}
  <div className="absolute inset-0 hidden bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,0.20)_72%,rgba(0,0,0,0.62)_100%)] dark:block" />
</div>

      {/* Sidebar Navigation */}
<aside
  className={cn(
    "w-[calc(100%-2rem)] md:w-20 max-w-full",
    "bg-white/80 dark:bg-[#061411]/80 backdrop-blur-md",
    "border border-slate-200 dark:border-emerald-900/40",
    "flex md:flex-col items-center",
    "py-4 md:py-8 px-6 md:px-0 gap-6 md:gap-10",
    "z-20 shrink-0",
    "my-4 mx-auto md:mx-4",
    "rounded-3xl",
    "shadow-xl",
    "transition-all duration-300",
    "self-start",
    isRtl ? "md:border-l" : "md:border-r"
  )}
>       <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-[0_0_20px_rgba(16,185,129,0.3)]">
          <Fingerprint className="w-6 h-6 md:w-8 md:h-8 text-white dark:text-[#020617]" />
        </div>
        <nav className="flex md:flex-col gap-4 md:gap-6 w-full items-center justify-center md:justify-start">
          <button 
            onClick={() => {
              setActiveTab('geofence');
              setShowPayrollPanel(false);
            }}
            className={cn("w-10 h-10 rounded-lg flex items-center justify-center transition-colors cursor-pointer", activeTab === 'geofence' ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20" : "hover:bg-emerald-500/5 text-slate-500")}
          >
             <Map className="w-5 h-5" />
          </button>
          <button 
            onClick={() => {
              setActiveTab('roster');
              setShowPayrollPanel(false);
            }}
            className={cn("w-10 h-10 rounded-lg flex items-center justify-center transition-colors cursor-pointer", activeTab === 'roster' ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20" : "hover:bg-emerald-500/5 text-slate-500")}
          >
             <Calendar className="w-5 h-5" />
          </button>
          <button 
            onClick={() => {
              setActiveTab('profile');
              setShowPayrollPanel(false);
            }}
            className={cn("w-10 h-10 rounded-lg flex items-center justify-center transition-colors cursor-pointer", activeTab === 'profile' && !showPayrollPanel ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20" : "hover:bg-emerald-500/5 text-slate-500")}
          >
             <User className="w-5 h-5" />
          </button>
          <button 
            onClick={() => {
              setActiveTab('profile');
              setShowPayrollPanel(true);
            }}
            className={cn("w-10 h-10 rounded-lg flex items-center justify-center transition-colors cursor-pointer", activeTab === 'profile' && showPayrollPanel ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20" : "hover:bg-emerald-500/5 text-slate-500")}
            title="Payroll"
          >
             <DollarSign className="w-5 h-5" />
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
            <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">{t('dash.auth')}: {user.name} • Tenant ID: {user.tenantId} • {formatRole(user.role)}</p>
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
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-200">{user.name}</p>
                <button onClick={onLogout} className={cn("text-[10px] text-emerald-600 dark:text-emerald-500 font-mono hover:text-emerald-700 dark:hover:text-emerald-400 uppercase flex items-center gap-1 transition-colors", isRtl ? "justify-start" : "justify-end")}>
                  <LogOut className="w-3 h-3" /> {t('dash.terminate')}
                </button>
              </div>
              <div className="w-10 h-10 rounded-full border-2 border-emerald-500 p-0.5 shrink-0 bg-white dark:bg-[#020617]">
                <div className="w-full h-full rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-700 dark:text-white tracking-widest">{user.name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</div>
              </div>
            </div>
          </div>
        </header>

        {/* Dashboard Grid Container */}
        <div className="flex flex-col xl:flex-row gap-6 flex-1 max-w-[1400px] mx-auto w-full">
            
            {/* Main Action Area (Left / Center) */}
            <div className="flex-1 space-y-6 max-w-full">
                
                {/* Tabs styled like immersive pills (Hidden on small screens, duplicated from sidebar for context) */}
                <div className="hidden md:flex items-center gap-2 mb-2">
                    <button 
                       onClick={() => {
                         setActiveTab('geofence');
                         setShowPayrollPanel(false);
                       }}
                       className={cn("px-4 py-2 text-xs font-bold uppercase tracking-widest rounded transition-all flex items-center gap-2 border", activeTab === 'geofence' ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20" : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300")}
                    >
                       <MapPin className="w-4 h-4 hidden sm:block" />
                       {t('dash.geoOp')}
                    </button>
                    <button 
                       onClick={() => {
                         setActiveTab('roster');
                         setShowPayrollPanel(false);
                       }}
                       className={cn("px-4 py-2 text-xs font-bold uppercase tracking-widest rounded transition-all flex items-center gap-2 border", activeTab === 'roster' ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20" : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300")}
                    >
                       <Calendar className="w-4 h-4 hidden sm:block" />
                       {t('dash.roster')}
                    </button>
                    <button 
                       onClick={() => {
                         setActiveTab('profile');
                         setShowPayrollPanel(false);
                       }}
                       className={cn("px-4 py-2 text-xs font-bold uppercase tracking-widest rounded transition-all flex items-center gap-2 border", activeTab === 'profile' && !showPayrollPanel ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20" : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300")}
                    >
                       <User className="w-4 h-4 hidden sm:block" />
                       {t('dash.profile')}
                    </button>
                    <button 
                       onClick={() => {
                         setActiveTab('profile');
                         setShowPayrollPanel(true);
                       }}
                       className={cn("px-4 py-2 text-xs font-bold uppercase tracking-widest rounded transition-all flex items-center gap-2 border", activeTab === 'profile' && showPayrollPanel ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20" : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300")}
                    >
                       <DollarSign className="w-4 h-4 hidden sm:block" />
                       Payroll
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
                               onClick={handleClockAction}
                               disabled={clockInState === 'locating' || clockInState === 'verifying'}
                               className={cn(
                                   "w-32 h-32 rounded-full flex flex-col items-center justify-center gap-1 transition-all duration-300 font-black tracking-tighter hover:scale-105 active:scale-95 z-10 relative",
                                   clockInState === 'idle' && isClockedIn ? "bg-gradient-to-tr from-amber-500 to-orange-400 text-slate-950 shadow-[0_0_30px_rgba(245,158,11,0.35)] hover:shadow-[0_0_40px_rgba(245,158,11,0.5)]" :
                                   clockInState === 'idle' ? "bg-gradient-to-tr from-emerald-600 to-emerald-400 text-slate-950 shadow-[0_0_30px_rgba(16,185,129,0.4)] hover:shadow-[0_0_40px_rgba(16,185,129,0.6)]" :
                                   clockInState === 'locating' || clockInState === 'verifying' ? "bg-slate-800 text-slate-400 animate-pulse border border-slate-700 shadow-none" :
                                   clockInState === 'success' ? "bg-emerald-500 text-slate-900 shadow-[0_0_40px_rgba(16,185,129,0.6)]" :
                                   "bg-red-500 text-white shadow-[0_0_40px_rgba(239,68,68,0.6)]"
                               )}
                             >
                              <AnimatePresence mode="popLayout">
                                 {clockInState === 'idle' && (
                                     <motion.div key="idle" initial={{scale:0}} animate={{scale:1}} exit={{scale:0}} className="flex flex-col items-center">
                                         <span className="text-[10px] sm:text-xs tracking-widest">{isClockedIn ? 'CLOCK OUT' : t('dash.clockIn')}</span>
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
                                        <span className="text-[10px] uppercase tracking-widest">{isClockedIn ? 'Active shift open' : t('dash.awaitingInput')}</span>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                           </div>

                           <p className="mt-3 text-[10px] font-mono uppercase tracking-widest text-slate-500">
                             {lastClockEvent}
                           </p>
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
                             {canManageRoster && (
                               <span className="inline-flex items-center gap-1 px-3 py-1 text-emerald-600 dark:text-emerald-400 text-xs rounded border border-emerald-200 dark:border-emerald-500/20 font-bold uppercase">
                                 <Save className="h-3 w-3" />
                                 Auto Saved
                               </span>
                             )}
                             <button className="px-3 py-1 text-slate-500 dark:text-slate-400 text-xs hover:text-slate-800 dark:hover:text-slate-300 font-bold uppercase transition-colors">{t('dash.applyLeave')}</button>
                           </div>
                       </div>
                       
                       <div className="w-full overflow-x-auto flex-1">
                         <table className={cn("w-full min-w-[760px]", isRtl ? "text-right" : "text-left")}>
                           <thead>
                             <tr className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-bold border-b border-slate-200 dark:border-slate-800/50 bg-slate-50 dark:bg-slate-900/20">
                               <th className="p-4">{t('dash.dayDate')}</th>
                               <th className="p-4">{t('dash.shiftFrame')}</th>
                               <th className="p-4">Break Time</th>
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
                                   {canManageRoster ? (
                                     <div className="flex items-center gap-2">
                                       <input
                                         type="time"
                                         value={s.shiftStart}
                                         onChange={(event) => updateShift(i, 'shiftStart', event.target.value)}
                                         className="w-24 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                                       />
                                       <span>-</span>
                                       <input
                                         type="time"
                                         value={s.shiftEnd}
                                         onChange={(event) => updateShift(i, 'shiftEnd', event.target.value)}
                                         className="w-24 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                                       />
                                     </div>
                                   ) : getShiftFrame(s)}
                                 </td>
                                 <td className="p-4 font-mono text-xs text-slate-500 dark:text-slate-400">
                                   {canManageRoster ? (
                                     <div className="flex items-center gap-2">
                                       <Coffee className="h-4 w-4 text-emerald-500" />
                                       <input
                                         type="time"
                                         value={s.breakStart}
                                         onChange={(event) => updateShift(i, 'breakStart', event.target.value)}
                                         className="w-24 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                                       />
                                       <span>-</span>
                                       <input
                                         type="time"
                                         value={s.breakEnd}
                                         onChange={(event) => updateShift(i, 'breakEnd', event.target.value)}
                                         className="w-24 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                                       />
                                     </div>
                                   ) : s.breakStart && s.breakEnd ? `${s.breakStart} - ${s.breakEnd}` : 'No break'}
                                 </td>
                                 <td className="p-4 text-xs text-slate-600 dark:text-slate-300">
                                   {canManageRoster ? (
                                     <input
                                       value={s.type}
                                       onChange={(event) => updateShift(i, 'type', event.target.value)}
                                       className="w-36 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                                     />
                                   ) : (
                                     <span className="opacity-80">{s.type}</span>
                                   )}
                                 </td>
                                 <td className={cn("p-4", isRtl ? "text-left" : "text-right")}>
                                   <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider", !s.shiftStart || !s.shiftEnd ? "bg-slate-100 dark:bg-slate-800 text-slate-500" : "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30")}>
                                     {!s.shiftStart || !s.shiftEnd ? t('dash.abstained') : t('dash.scheduled')}
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

                      {showPayrollPanel ? (
                        <div className="space-y-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <h3 className="text-sm font-bold uppercase tracking-widest text-slate-800 dark:text-slate-200">Payroll</h3>
                              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                {user.role === 'hr_admin' ? 'Tenant payroll records and run controls.' : 'Your recent payroll records.'}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => setShowPayrollPanel(false)}
                              className="rounded-lg border border-slate-200 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-600 transition hover:border-emerald-300 hover:text-emerald-700 dark:border-slate-800 dark:text-slate-300"
                            >
                              Back
                            </button>
                          </div>

                          {user.role === 'hr_admin' && (
                            <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/40 md:grid-cols-5">
                              <input
                                type="date"
                                aria-label="Pay period start"
                                value={payrollForm.payPeriodStart}
                                onChange={(event) => updatePayrollForm('payPeriodStart', event.target.value)}
                                className="rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                              />
                              <input
                                type="date"
                                aria-label="Pay period end"
                                value={payrollForm.payPeriodEnd}
                                onChange={(event) => updatePayrollForm('payPeriodEnd', event.target.value)}
                                className="rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                              />
                              <input
                                type="number"
                                aria-label="Default base salary"
                                min="0"
                                step="0.01"
                                placeholder="Base salary"
                                value={payrollForm.defaultBaseSalary}
                                onChange={(event) => updatePayrollForm('defaultBaseSalary', event.target.value)}
                                className="rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                              />
                              <div className="grid grid-cols-2 gap-2">
                                <input
                                  type="number"
                                  aria-label="Bonuses"
                                  min="0"
                                  step="0.01"
                                  placeholder="Bonuses"
                                  value={payrollForm.bonuses}
                                  onChange={(event) => updatePayrollForm('bonuses', event.target.value)}
                                  className="min-w-0 rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                                />
                                <input
                                  type="number"
                                  aria-label="Deductions"
                                  min="0"
                                  step="0.01"
                                  placeholder="Deductions"
                                  value={payrollForm.deductions}
                                  onChange={(event) => updatePayrollForm('deductions', event.target.value)}
                                  className="min-w-0 rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                                />
                              </div>
                              <button
                                type="button"
                                onClick={runPayroll}
                                disabled={payrollLoading}
                                className="rounded bg-emerald-500 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-950 transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60"
                              >
                                Run Payroll
                              </button>
                            </div>
                          )}

                          {payrollMessage && (
                            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300">
                              {payrollMessage}
                            </p>
                          )}

                          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                            <table className={cn("w-full min-w-[760px]", isRtl ? "text-right" : "text-left")}>
                              <thead>
                                <tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:border-slate-800 dark:bg-slate-900/40">
                                  <th className="p-3">Employee</th>
                                  <th className="p-3">Period</th>
                                  <th className="p-3">Base</th>
                                  <th className="p-3">Bonus</th>
                                  <th className="p-3">Deductions</th>
                                  <th className="p-3">Net</th>
                                  <th className="p-3">Status</th>
                                </tr>
                              </thead>
                              <tbody className="text-xs">
                                {payrollRecords.map((record) => (
                                  <tr key={record.id} className="border-b border-slate-100 text-slate-700 last:border-0 dark:border-slate-800 dark:text-slate-300">
                                    <td className="p-3 font-semibold">
                                      {record.full_name || user.name}
                                      <span className="block text-[10px] font-normal text-slate-500">{record.email || user.email}</span>
                                    </td>
                                    <td className="p-3 font-mono text-[11px]">
                                      {formatPayrollDate(record.pay_period_start)} - {formatPayrollDate(record.pay_period_end)}
                                    </td>
                                    <td className="p-3">{formatPayrollAmount(record.base_salary, record.currency)}</td>
                                    <td className="p-3">{formatPayrollAmount(record.bonuses, record.currency)}</td>
                                    <td className="p-3">{formatPayrollAmount(record.deductions, record.currency)}</td>
                                    <td className="p-3 font-bold text-emerald-700 dark:text-emerald-300">{formatPayrollAmount(record.net_pay, record.currency)}</td>
                                    <td className="p-3">
                                      <span className="rounded-full border border-emerald-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:border-emerald-500/20 dark:text-emerald-300">
                                        {record.status}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                                {!payrollLoading && payrollRecords.length === 0 && (
                                  <tr>
                                    <td colSpan={7} className="p-6 text-center text-xs text-slate-500">
                                      No payroll records yet.
                                    </td>
                                  </tr>
                                )}
                                {payrollLoading && (
                                  <tr>
                                    <td colSpan={7} className="p-6 text-center text-xs text-slate-500">
                                      Loading payroll records...
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                         <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/50 p-5 rounded-xl md:col-span-2">
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-slate-800 dark:text-slate-200">
                                  <Bell className="h-4 w-4 text-emerald-500" />
                                  Notification Settings
                                </p>
                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                  Optional reminders for your scheduled break window.
                                </p>
                              </div>

                              <button
                                type="button"
                                onClick={async () => {
                                  await requestNotificationPermission();
                                  notifyEmployee('Horizon HR', 'Break reminder notifications are ready.');
                                }}
                                className="rounded-lg border border-emerald-200 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-emerald-700 transition hover:border-emerald-400 dark:border-emerald-500/20 dark:text-emerald-300"
                              >
                                Test
                              </button>
                            </div>

                            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                              <label className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-3 py-3 dark:border-slate-800 dark:bg-slate-950/40">
                                <span>
                                  <span className="block text-xs font-bold text-slate-800 dark:text-slate-200">Break starts</span>
                                  <span className="block text-[10px] text-slate-500">Notify when break time begins.</span>
                                </span>
                                <input
                                  type="checkbox"
                                  checked={notificationSettings.breakStart}
                                  onChange={(event) => updateNotificationSetting('breakStart', event.target.checked)}
                                  className="h-4 w-4 accent-emerald-500"
                                />
                              </label>

                              <label className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-3 py-3 dark:border-slate-800 dark:bg-slate-950/40">
                                <span>
                                  <span className="block text-xs font-bold text-slate-800 dark:text-slate-200">Break ends</span>
                                  <span className="block text-[10px] text-slate-500">Notify before returning to shift.</span>
                                </span>
                                <input
                                  type="checkbox"
                                  checked={notificationSettings.breakEnd}
                                  onChange={(event) => updateNotificationSetting('breakEnd', event.target.checked)}
                                  className="h-4 w-4 accent-emerald-500"
                                />
                              </label>
                            </div>
                         </div>

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
                         <button
                            type="button"
                            onClick={() => setShowPayrollPanel(true)}
                            className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/50 p-5 rounded-xl flex items-center justify-between cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-left"
                         >
                            <p className="font-bold text-slate-700 dark:text-slate-300">{t('profile.payroll')}</p>
                            <Settings2 className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                         </button>
                         <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/50 p-5 rounded-xl flex items-center justify-between cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                            <p className="font-bold text-slate-700 dark:text-slate-300">{t('profile.grievance')}</p>
                            <Settings2 className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                         </div>
                      </div>
                      )}
                   </motion.div>
                )}

            </div>

            {/* Sidebar (Right) / Stats & Insights */}
            <div className="w-full xl:w-80 flex flex-col gap-6 shrink-0 z-10">
                 {/* Replaced Org CTE Box with something more fitting or just Advanced Params */}
<div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/50 rounded-2xl p-6 backdrop-blur-sm shadow-xl h-fit overflow-hidden">                    <button 
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
<div className="hidden xl:flex relative z-20 bg-emerald-50 dark:bg-emerald-500/5 border border-emerald-200 dark:border-emerald-500/10 backdrop-blur-xl px-4 py-3 rounded-full items-center gap-3 shadow-xl w-fit">                    <div className="flex -space-x-2">
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
