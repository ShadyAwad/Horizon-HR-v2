import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Fingerprint, LogOut, MapPin, Map, Navigation, 
  Calendar, CheckCircle2, AlertTriangle, User, Settings2 , Sun, Moon, Bell, Coffee, Save, DollarSign, MessageSquare, Newspaper
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useLanguage } from '../lib/LanguageContext';
import { useTheme } from '../lib/ThemeContext';
import { apiUrl } from '../lib/api';
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

type GrievancePriority = 'low' | 'normal' | 'high' | 'urgent';
type GrievanceStatus = 'open' | 'under_review' | 'resolved' | 'rejected' | 'closed';

type GrievanceRecord = {
  id: string;
  employee_id: string;
  full_name?: string;
  email?: string;
  assigned_to?: string | null;
  assigned_to_name?: string | null;
  assigned_to_email?: string | null;
  title: string;
  description: string;
  category: string;
  priority: GrievancePriority;
  status: GrievanceStatus;
  created_at: string;
  updated_at: string;
  resolved_at?: string | null;
};

type GrievanceFormState = {
  title: string;
  category: string;
  priority: GrievancePriority;
  description: string;
};

type CompanyLocationRecord = {
  id: string;
  name: string;
  location_type: string;
  address?: string | null;
  latitude: string | number;
  longitude: string | number;
  radius_meters: number;
  is_primary: boolean;
  is_active: boolean;
};

type FeedPostType = 'announcement' | 'event' | 'policy_update' | 'general';
type FeedPostStatus = 'draft' | 'published' | 'archived';
type FeedVisibilityValue = 'all' | 'role:employee' | 'role:manager' | 'role:hr_admin' | `location:${string}`;

type FeedPost = {
  id: string;
  author_employee_id: string;
  author_name?: string;
  author_email?: string;
  title: string;
  post_type: FeedPostType;
  content_text: string;
  event_starts_at?: string | null;
  event_ends_at?: string | null;
  status: FeedPostStatus;
  created_at: string;
  updated_at: string;
  published_at: string;
  archived_at?: string | null;
  visibility?: Array<{
    type: 'all' | 'role' | 'location';
    role?: AuthUser['role'] | null;
    locationId?: string | null;
  }>;
};

type FeedFormState = {
  title: string;
  postType: FeedPostType;
  contentText: string;
  status: 'draft' | 'published';
  visibility: FeedVisibilityValue;
};

const defaultSchedule: ShiftRow[] = [
  { day: 'Monday', date: '24', shiftStart: '09:00', shiftEnd: '17:00', breakStart: '13:00', breakEnd: '13:30', type: 'Office HQ' },
  { day: 'Tuesday', date: '25', shiftStart: '09:00', shiftEnd: '17:00', breakStart: '13:00', breakEnd: '13:30', type: 'Office HQ' },
  { day: 'Wednesday', date: '26', shiftStart: '09:00', shiftEnd: '17:00', breakStart: '12:30', breakEnd: '13:00', type: 'Remote' },
  { day: 'Thursday', date: '27', shiftStart: '', shiftEnd: '', breakStart: '', breakEnd: '', type: 'Annual Leave' },
  { day: 'Friday', date: '28', shiftStart: '09:00', shiftEnd: '14:00', breakStart: '11:30', breakEnd: '12:00', type: 'Office HQ' },
  { day: 'Saturday', date: '29', shiftStart: '', shiftEnd: '', breakStart: '', breakEnd: '', type: 'Unscheduled' },
  { day: 'Sunday', date: '30', shiftStart: '', shiftEnd: '', breakStart: '', breakEnd: '', type: 'Unscheduled' },
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

const defaultGrievanceForm: GrievanceFormState = {
  title: '',
  category: 'general',
  priority: 'normal',
  description: '',
};

const defaultFeedForm: FeedFormState = {
  title: '',
  postType: 'announcement',
  contentText: '',
  status: 'published',
  visibility: 'all',
};

const grievanceStatuses: GrievanceStatus[] = ['open', 'under_review', 'resolved', 'rejected', 'closed'];

function readStoredSchedule() {
  if (typeof window === 'undefined') return defaultSchedule;

  try {
    const storedSchedule = window.localStorage.getItem('horizon-roster');
    if (!storedSchedule) return defaultSchedule;

    const parsedSchedule = JSON.parse(storedSchedule) as ShiftRow[];
    const normalizedSchedule = defaultSchedule.map((defaultShift) => {
      const storedShift = parsedSchedule.find((shift) => (
        shift.day === defaultShift.day ||
        shift.day.slice(0, 3) === defaultShift.day.slice(0, 3)
      ));

      return storedShift ? { ...defaultShift, ...storedShift, day: defaultShift.day } : defaultShift;
    });

    return normalizedSchedule;
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

function getTenantName(user: AuthUser) {
  if (!user.tenant) return 'Company workspace';
  return typeof user.tenant === 'string' ? user.tenant : user.tenant.companyName;
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

function formatShortDateTime(value: string) {
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatLabel(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
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
  const [activeTab, setActiveTab] = useState<'geofence' | 'roster' | 'feed' | 'profile'>('geofence');
  const [clockInState, setClockInState] = useState<ClockActionState>('idle');
  const [clockMessage, setClockMessage] = useState('');
  const [showAccountDetails, setShowAccountDetails] = useState(false);
  const [isClockedIn, setIsClockedIn] = useState(false);
  const [activeTimeLogId, setActiveTimeLogId] = useState<string | null>(null);
  const [lastClockEvent, setLastClockEvent] = useState<string>('No active shift recorded.');
  const [schedule, setSchedule] = useState<ShiftRow[]>(readStoredSchedule);
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(readStoredNotifications);
  const [showPayrollPanel, setShowPayrollPanel] = useState(false);
  const [payrollRecords, setPayrollRecords] = useState<PayrollRecord[]>([]);
  const [payrollLoading, setPayrollLoading] = useState(false);
  const [payrollSubmitting, setPayrollSubmitting] = useState(false);
  const [payrollMessage, setPayrollMessage] = useState('');
  const [payrollMessageType, setPayrollMessageType] = useState<'success' | 'error'>('success');
  const [payrollForm, setPayrollForm] = useState<PayrollFormState>(defaultPayrollForm);
  const [showGrievancesPanel, setShowGrievancesPanel] = useState(false);
  const [myGrievances, setMyGrievances] = useState<GrievanceRecord[]>([]);
  const [tenantGrievances, setTenantGrievances] = useState<GrievanceRecord[]>([]);
  const [grievanceLoading, setGrievanceLoading] = useState(false);
  const [tenantGrievanceLoading, setTenantGrievanceLoading] = useState(false);
  const [grievanceSubmitting, setGrievanceSubmitting] = useState(false);
  const [grievanceUpdatingId, setGrievanceUpdatingId] = useState<string | null>(null);
  const [grievanceMessage, setGrievanceMessage] = useState('');
  const [grievanceMessageType, setGrievanceMessageType] = useState<'success' | 'error'>('success');
  const [grievanceForm, setGrievanceForm] = useState<GrievanceFormState>(defaultGrievanceForm);
  const [feedPosts, setFeedPosts] = useState<FeedPost[]>([]);
  const [adminFeedPosts, setAdminFeedPosts] = useState<FeedPost[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [adminFeedLoading, setAdminFeedLoading] = useState(false);
  const [feedSubmitting, setFeedSubmitting] = useState(false);
  const [feedUpdatingId, setFeedUpdatingId] = useState<string | null>(null);
  const [feedMessage, setFeedMessage] = useState('');
  const [feedMessageType, setFeedMessageType] = useState<'success' | 'error'>('success');
  const [feedForm, setFeedForm] = useState<FeedFormState>(defaultFeedForm);
  const [companyLocations, setCompanyLocations] = useState<CompanyLocationRecord[]>([]);
  const [locationsMessage, setLocationsMessage] = useState('');

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
    const todaysShift = schedule.find((shift) => shift.day.slice(0, 3) === todayCode);
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
        const res = await fetch(apiUrl('/api/clock-in'), {
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
      const res = await fetch(apiUrl('/api/clock-out'), {
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
  const canManageGrievances = user.role === 'hr_admin' || user.role === 'manager';

  const loadPayrollRecords = async (clearMessage = true) => {
    setPayrollLoading(true);
    if (clearMessage) {
      setPayrollMessage('');
    }

    try {
      const endpoint = user.role === 'hr_admin' ? '/api/payroll' : '/api/payroll/me';
      const res = await fetch(apiUrl(endpoint), { headers: payrollHeaders });
      const data = await res.json();

      if (res.ok && data.success) {
        setPayrollRecords(data.payroll || []);
      } else {
        setPayrollMessageType('error');
        setPayrollMessage(data.error || 'Unable to load payroll records.');
      }
    } catch {
      setPayrollMessageType('error');
      setPayrollMessage('Server disconnection. Unable to load payroll records.');
    } finally {
      setPayrollLoading(false);
    }
  };

  const updatePayrollForm = (field: keyof PayrollFormState, value: string) => {
    setPayrollForm((current) => ({ ...current, [field]: value }));
  };

  const runPayroll = async () => {
    if (payrollSubmitting) return;

    setPayrollSubmitting(true);
    setPayrollMessage('');

    try {
      const res = await fetch(apiUrl('/api/payroll/run'), {
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
        await loadPayrollRecords(false);
        setPayrollMessageType('success');
        setPayrollMessage(`${data.message} Records: ${data.recordsGenerated}`);
      } else {
        setPayrollMessageType('error');
        setPayrollMessage(data.error || 'Unable to run payroll.');
      }
    } catch {
      setPayrollMessageType('error');
      setPayrollMessage('Server disconnection. Unable to run payroll.');
    } finally {
      setPayrollSubmitting(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'profile' && showPayrollPanel) {
      loadPayrollRecords();
    }
  }, [activeTab, showPayrollPanel, user.id, user.role, user.tenantId]);

  const loadGrievances = async (clearMessage = true) => {
    setGrievanceLoading(true);
    setTenantGrievanceLoading(false);
    if (clearMessage) {
      setGrievanceMessage('');
    }

    try {
      const myResponse = await fetch(apiUrl('/api/grievances/me'), { headers: payrollHeaders });
      const myData = await myResponse.json();

      if (!myResponse.ok || !myData.success) {
        setGrievanceMessageType('error');
        setGrievanceMessage(myData.error || 'Unable to load grievances.');
        return;
      }

      setMyGrievances(myData.grievances || []);
      setGrievanceLoading(false);

      if (canManageGrievances) {
        setTenantGrievanceLoading(true);
        const tenantResponse = await fetch(apiUrl('/api/grievances'), { headers: payrollHeaders });
        const tenantData = await tenantResponse.json();

        if (!tenantResponse.ok || !tenantData.success) {
          setGrievanceMessageType('error');
          setGrievanceMessage(tenantData.error || 'Unable to load tenant grievances.');
          return;
        }

        setTenantGrievances(tenantData.grievances || []);
      } else {
        setTenantGrievances([]);
      }
    } catch {
      setGrievanceMessageType('error');
      setGrievanceMessage('Server disconnection. Unable to load grievances.');
    } finally {
      setGrievanceLoading(false);
      setTenantGrievanceLoading(false);
    }
  };

  const updateGrievanceForm = (field: keyof GrievanceFormState, value: string) => {
    setGrievanceForm((current) => ({ ...current, [field]: value as GrievancePriority }));
  };

  const submitGrievance = async () => {
    if (grievanceSubmitting) return;

    setGrievanceSubmitting(true);
    setGrievanceMessage('');

    try {
      const res = await fetch(apiUrl('/api/grievances'), {
        method: 'POST',
        headers: payrollHeaders,
        body: JSON.stringify(grievanceForm),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setGrievanceForm(defaultGrievanceForm);
        await loadGrievances(false);
        setGrievanceMessageType('success');
        setGrievanceMessage('Grievance filed successfully.');
      } else {
        setGrievanceMessageType('error');
        setGrievanceMessage(data.error || 'Unable to file grievance.');
      }
    } catch {
      setGrievanceMessageType('error');
      setGrievanceMessage('Server disconnection. Unable to file grievance.');
    } finally {
      setGrievanceSubmitting(false);
    }
  };

  const updateGrievanceStatus = async (grievanceId: string, status: GrievanceStatus) => {
    if (grievanceUpdatingId) return;

    setGrievanceUpdatingId(grievanceId);
    setGrievanceMessage('');

    try {
      const res = await fetch(apiUrl(`/api/grievances/${grievanceId}/status`), {
        method: 'PATCH',
        headers: payrollHeaders,
        body: JSON.stringify({ status }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        await loadGrievances(false);
        setGrievanceMessageType('success');
        setGrievanceMessage('Grievance status updated.');
      } else {
        setGrievanceMessageType('error');
        setGrievanceMessage(data.error || 'Unable to update grievance status.');
      }
    } catch {
      setGrievanceMessageType('error');
      setGrievanceMessage('Server disconnection. Unable to update grievance status.');
    } finally {
      setGrievanceUpdatingId(null);
    }
  };

  const loadFeed = async (clearMessage = true) => {
    setFeedLoading(true);
    if (clearMessage) {
      setFeedMessage('');
    }

    try {
      const res = await fetch(apiUrl('/api/company-feed'), { headers: payrollHeaders });
      const data = await res.json();

      if (res.ok && data.success) {
        setFeedPosts(data.posts || []);
      } else {
        setFeedMessageType('error');
        setFeedMessage(data.error || 'Unable to load company feed.');
      }
    } catch {
      setFeedMessageType('error');
      setFeedMessage('Server disconnection. Unable to load company feed.');
    } finally {
      setFeedLoading(false);
    }
  };

  const loadAdminFeed = async () => {
    if (user.role !== 'hr_admin') return;

    setAdminFeedLoading(true);

    try {
      const res = await fetch(apiUrl('/api/company-feed/admin'), { headers: payrollHeaders });
      const data = await res.json();

      if (res.ok && data.success) {
        setAdminFeedPosts(data.posts || []);
      }
    } finally {
      setAdminFeedLoading(false);
    }
  };

  const updateFeedForm = (field: keyof FeedFormState, value: string) => {
    setFeedForm((current) => ({ ...current, [field]: value }));
  };

  const getFeedVisibilityPayload = () => {
    if (feedForm.visibility === 'all') {
      return [{ type: 'all' }];
    }

    if (feedForm.visibility.startsWith('role:')) {
      return [{ type: 'role', role: feedForm.visibility.replace('role:', '') }];
    }

    if (feedForm.visibility.startsWith('location:')) {
      return [{ type: 'location', locationId: feedForm.visibility.replace('location:', '') }];
    }

    return [{ type: 'all' }];
  };

  const submitFeedPost = async () => {
    if (feedSubmitting) return;

    setFeedSubmitting(true);
    setFeedMessage('');

    try {
      const res = await fetch(apiUrl('/api/company-feed/posts'), {
        method: 'POST',
        headers: payrollHeaders,
        body: JSON.stringify({
          title: feedForm.title,
          postType: feedForm.postType,
          contentText: feedForm.contentText,
          status: feedForm.status,
          visibility: getFeedVisibilityPayload(),
        }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setFeedForm(defaultFeedForm);
        await Promise.all([loadFeed(false), loadAdminFeed()]);
        setFeedMessageType('success');
        setFeedMessage(feedForm.status === 'published' ? 'Post published.' : 'Draft saved.');
      } else {
        setFeedMessageType('error');
        setFeedMessage(data.error || 'Unable to save feed post.');
      }
    } catch {
      setFeedMessageType('error');
      setFeedMessage('Server disconnection. Unable to save feed post.');
    } finally {
      setFeedSubmitting(false);
    }
  };

  const updateFeedStatus = async (postId: string, status: FeedPostStatus) => {
    if (feedUpdatingId) return;

    setFeedUpdatingId(postId);
    setFeedMessage('');

    try {
      const res = await fetch(apiUrl(`/api/company-feed/posts/${postId}/status`), {
        method: 'PATCH',
        headers: payrollHeaders,
        body: JSON.stringify({ status }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        await Promise.all([loadFeed(false), loadAdminFeed()]);
        setFeedMessageType('success');
        setFeedMessage('Post status updated.');
      } else {
        setFeedMessageType('error');
        setFeedMessage(data.error || 'Unable to update post status.');
      }
    } catch {
      setFeedMessageType('error');
      setFeedMessage('Server disconnection. Unable to update post status.');
    } finally {
      setFeedUpdatingId(null);
    }
  };

  useEffect(() => {
    if (activeTab === 'feed') {
      loadFeed();
      loadAdminFeed();
    }
  }, [activeTab, user.id, user.role, user.tenantId]);

  useEffect(() => {
    if (activeTab === 'profile' && showGrievancesPanel) {
      loadGrievances();
    }
  }, [activeTab, showGrievancesPanel, user.id, user.role, user.tenantId]);

  useEffect(() => {
    const loadCompanyLocations = async () => {
      try {
        const res = await fetch(apiUrl('/api/company-locations'), { headers: payrollHeaders });
        const data = await res.json();

        if (res.ok && data.success) {
          setCompanyLocations(data.locations || []);
          setLocationsMessage('');
        } else {
          setLocationsMessage(data.error || 'Unable to load locations.');
        }
      } catch {
        setLocationsMessage('Unable to load locations.');
      }
    };

    loadCompanyLocations();
  }, [user.id, user.tenantId]);

  return (
<div className="h-[100dvh] bg-[#020403] text-slate-100 font-sans flex flex-col md:flex-row overflow-hidden relative transition-colors duration-300">
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
    "w-[calc(100%-1rem)] md:w-16 lg:w-[72px] max-w-full",
    "bg-white/80 dark:bg-[#061411]/80 backdrop-blur-md",
    "border border-slate-200 dark:border-emerald-900/40",
    "flex md:flex-col items-center",
    "py-3 md:py-5 px-4 md:px-0 gap-4 md:gap-6",
    "z-20 shrink-0",
    "my-2 mx-auto md:mx-2 lg:mx-3",
    "rounded-2xl",
    "shadow-xl",
    "transition-all duration-300",
    "self-start",
    isRtl ? "md:border-l" : "md:border-r"
  )}
>       <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-[0_0_20px_rgba(16,185,129,0.3)]">
          <Fingerprint className="w-6 h-6 text-white dark:text-[#020617]" />
        </div>
        <nav className="flex md:flex-col gap-3 md:gap-4 w-full items-center justify-center md:justify-start">
          <button 
            onClick={() => {
              setActiveTab('geofence');
              setShowPayrollPanel(false);
              setShowGrievancesPanel(false);
            }}
            className={cn("w-10 h-10 rounded-lg flex items-center justify-center transition-colors cursor-pointer", activeTab === 'geofence' ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20" : "hover:bg-emerald-500/5 text-slate-500")}
          >
             <Map className="w-5 h-5" />
          </button>
          <button 
            onClick={() => {
              setActiveTab('roster');
              setShowPayrollPanel(false);
              setShowGrievancesPanel(false);
            }}
            className={cn("w-10 h-10 rounded-lg flex items-center justify-center transition-colors cursor-pointer", activeTab === 'roster' ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20" : "hover:bg-emerald-500/5 text-slate-500")}
          >
             <Calendar className="w-5 h-5" />
          </button>
          <button
            onClick={() => {
              setActiveTab('feed');
              setShowPayrollPanel(false);
              setShowGrievancesPanel(false);
            }}
            className={cn("w-10 h-10 rounded-lg flex items-center justify-center transition-colors cursor-pointer", activeTab === 'feed' ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20" : "hover:bg-emerald-500/5 text-slate-500")}
            title="Company Feed"
          >
             <Newspaper className="w-5 h-5" />
          </button>
          <button 
            onClick={() => {
              setActiveTab('profile');
              setShowPayrollPanel(false);
              setShowGrievancesPanel(false);
            }}
            className={cn("w-10 h-10 rounded-lg flex items-center justify-center transition-colors cursor-pointer", activeTab === 'profile' && !showPayrollPanel && !showGrievancesPanel ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20" : "hover:bg-emerald-500/5 text-slate-500")}
          >
             <User className="w-5 h-5" />
          </button>
          <button 
            onClick={() => {
              setActiveTab('profile');
              setShowPayrollPanel(true);
              setShowGrievancesPanel(false);
            }}
            className={cn("w-10 h-10 rounded-lg flex items-center justify-center transition-colors cursor-pointer", activeTab === 'profile' && showPayrollPanel ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20" : "hover:bg-emerald-500/5 text-slate-500")}
            title="Payroll"
          >
             <DollarSign className="w-5 h-5" />
          </button>
          <button 
            onClick={() => {
              setActiveTab('profile');
              setShowPayrollPanel(false);
              setShowGrievancesPanel(true);
            }}
            className={cn("w-10 h-10 rounded-lg flex items-center justify-center transition-colors cursor-pointer", activeTab === 'profile' && showGrievancesPanel ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20" : "hover:bg-emerald-500/5 text-slate-500")}
            title="Grievances"
          >
             <MessageSquare className="w-5 h-5" />
          </button>
        </nav>
      </aside>

      <main className="min-w-0 flex-1 flex flex-col p-3 md:p-4 lg:p-5 z-10 overflow-y-auto">
        
        {/* Header Pipeline */}
        <header className="flex flex-col lg:flex-row lg:items-start justify-between mb-4 gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center">
               {t('login.title')} <span className={cn("text-emerald-600 dark:text-emerald-500 bg-emerald-500/10 font-mono text-xs px-2 py-0.5 border border-emerald-500/30 rounded uppercase hidden sm:inline-block", isRtl ? "mr-3" : "ml-3")}>{t('dash.elitePortal')}</span>
            </h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">{t('dash.auth')}: {user.name} • {formatRole(user.role)}</p>

            <div className="mt-3 flex w-full max-w-[520px] flex-col gap-3 rounded-xl border border-slate-200 bg-white/80 p-3 shadow-sm backdrop-blur-xl dark:border-emerald-500/15 dark:bg-slate-950/70 sm:flex-row sm:items-center">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-full border-2 border-emerald-500 p-0.5 shrink-0 bg-white dark:bg-[#020617]">
                  <div className="w-full h-full rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-700 dark:text-white tracking-widest">{user.name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</div>
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-200">{user.name}</p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">{getTenantName(user)} • {formatRole(user.role)}</p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-3 sm:ml-auto">
                <button
                  type="button"
                  onClick={() => setShowAccountDetails((current) => !current)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-600 transition hover:border-emerald-300 hover:text-emerald-700 dark:border-slate-700 dark:text-slate-300 dark:hover:text-emerald-300"
                >
                  Details
                </button>
                <button onClick={onLogout} className="text-[10px] text-emerald-600 dark:text-emerald-500 font-bold hover:text-emerald-700 dark:hover:text-emerald-400 uppercase flex items-center gap-1 transition-colors">
                  <LogOut className="w-3 h-3" /> {t('dash.terminate')}
                </button>
              </div>
            </div>

            {showAccountDetails && (
              <div className="mt-2 grid w-full max-w-[520px] grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950/35 dark:text-slate-300 sm:grid-cols-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Tenant</p>
                  <p className="mt-1 truncate">{getTenantName(user)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Role</p>
                  <p className="mt-1">{formatRole(user.role)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Tenant ID</p>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard?.writeText(user.tenantId)}
                    className="mt-1 max-w-full truncate font-mono text-[11px] text-emerald-700 hover:text-emerald-500 dark:text-emerald-300"
                    title="Click to copy tenant ID"
                  >
                    {user.tenantId}
                  </button>
                </div>
              </div>
            )}
          </div>
          
          <div className="flex items-center gap-3 lg:justify-end">
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
          </div>
        </header>

        {/* Dashboard Grid Container */}
        <div className="flex flex-col xl:flex-row gap-4 flex-1 w-full items-start">
            
            {/* Main Action Area (Left / Center) */}
            <div className="flex-1 space-y-4 max-w-full min-w-0">
                
                {/* Tabs styled like immersive pills (Hidden on small screens, duplicated from sidebar for context) */}
                <div className="hidden md:flex items-center gap-2">
                    <button 
                       onClick={() => {
                         setActiveTab('geofence');
                         setShowPayrollPanel(false);
                         setShowGrievancesPanel(false);
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
                         setShowGrievancesPanel(false);
                       }}
                       className={cn("px-4 py-2 text-xs font-bold uppercase tracking-widest rounded transition-all flex items-center gap-2 border", activeTab === 'roster' ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20" : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300")}
                    >
                       <Calendar className="w-4 h-4 hidden sm:block" />
                       {t('dash.roster')}
                    </button>
                    <button
                       onClick={() => {
                         setActiveTab('feed');
                         setShowPayrollPanel(false);
                         setShowGrievancesPanel(false);
                       }}
                       className={cn("px-4 py-2 text-xs font-bold uppercase tracking-widest rounded transition-all flex items-center gap-2 border", activeTab === 'feed' ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20" : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300")}
                    >
                       <Newspaper className="w-4 h-4 hidden sm:block" />
                       Company Feed
                    </button>
                    <button 
                       onClick={() => {
                         setActiveTab('profile');
                         setShowPayrollPanel(false);
                         setShowGrievancesPanel(false);
                       }}
                       className={cn("px-4 py-2 text-xs font-bold uppercase tracking-widest rounded transition-all flex items-center gap-2 border", activeTab === 'profile' && !showPayrollPanel && !showGrievancesPanel ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20" : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300")}
                    >
                       <User className="w-4 h-4 hidden sm:block" />
                       {t('dash.profile')}
                    </button>
                    <button 
                       onClick={() => {
                         setActiveTab('profile');
                         setShowPayrollPanel(true);
                         setShowGrievancesPanel(false);
                       }}
                       className={cn("px-4 py-2 text-xs font-bold uppercase tracking-widest rounded transition-all flex items-center gap-2 border", activeTab === 'profile' && showPayrollPanel ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20" : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300")}
                    >
                       <DollarSign className="w-4 h-4 hidden sm:block" />
                       Payroll
                    </button>
                    <button 
                       onClick={() => {
                         setActiveTab('profile');
                         setShowPayrollPanel(false);
                         setShowGrievancesPanel(true);
                       }}
                       className={cn("px-4 py-2 text-xs font-bold uppercase tracking-widest rounded transition-all flex items-center gap-2 border", activeTab === 'profile' && showGrievancesPanel ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20" : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300")}
                    >
                       <MessageSquare className="w-4 h-4 hidden sm:block" />
                       Grievances
                    </button>
                </div>

                {/* Tab Contents */}
                {activeTab === 'geofence' && (
                    <motion.div initial={{opacity:0, y:5}} animate={{opacity:1, y:0}} className="bg-white dark:bg-[#0a1a17]/90 border border-slate-200 dark:border-emerald-500/20 rounded-2xl p-4 flex flex-col items-center justify-center text-center backdrop-blur-sm relative overflow-hidden group shadow-xl">
                       <div className="absolute inset-0 bg-slate-50/50 dark:bg-emerald-500/5 group-hover:bg-slate-100/50 dark:group-hover:bg-emerald-500/10 transition-colors pointer-events-none"></div>
                       <div className="w-full flex items-start justify-between mb-4 z-10 relative">
                           <div className={cn("flex flex-col gap-1", isRtl ? "items-end text-right" : "items-start text-left")}>
                               <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                <MapPin className="w-5 h-5 text-emerald-500" />
                                {t('dash.perimeter')}
                               </h2>
                               <p className="text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-transparent font-mono border border-emerald-200 dark:border-emerald-500/30 px-2 py-0.5 rounded uppercase tracking-widest">{t('dash.hqSecure')}</p>
                           </div>
                       </div>
                       
                       <div className="relative z-10 w-full flex flex-col items-center justify-center py-8 px-6 bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/50 rounded-2xl min-h-[320px]">
                           <div className="w-36 h-36 rounded-full border-4 border-dashed border-emerald-900 flex items-center justify-center mb-4 relative">
                             {clockInState === 'success' && <div className="absolute inset-0 rounded-full shadow-[0_0_50px_rgba(16,185,129,0.3)] animate-pulse"></div>}
                             <button 
                               onClick={handleClockAction}
                               disabled={clockInState === 'locating' || clockInState === 'verifying'}
                               className={cn(
                                   "w-28 h-28 rounded-full flex flex-col items-center justify-center gap-1 transition-all duration-300 font-black tracking-tighter hover:scale-105 active:scale-95 z-10 relative",
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

                       <div className="relative z-10 mt-4 w-full rounded-2xl border border-slate-200 bg-white/70 p-4 text-left dark:border-slate-800/50 dark:bg-slate-900/30">
                         <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                           <div>
                             <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-800 dark:text-slate-200">
                               <MapPin className="h-4 w-4 text-emerald-500" />
                               Company Locations
                             </h3>
                             <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                               Clock-in is valid inside any active company location.
                             </p>
                           </div>
                           <span className="w-fit rounded-full border border-emerald-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-emerald-700 dark:border-emerald-500/20 dark:text-emerald-300">
                             {companyLocations.length} Active
                           </span>
                         </div>

                         <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                           {companyLocations.slice(0, 4).map((location) => (
                             <div key={location.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/30">
                               <div className="flex items-start justify-between gap-3">
                                 <div>
                                   <p className="text-xs font-bold text-slate-800 dark:text-slate-100">{location.name}</p>
                                   <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                     {location.location_type.replace('_', ' ')} - {location.radius_meters}m
                                   </p>
                                 </div>
                                 {location.is_primary && (
                                   <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
                                     Primary
                                   </span>
                                 )}
                               </div>
                               <p className="mt-2 font-mono text-[10px] text-slate-500">
                                 {Number(location.latitude).toFixed(5)}, {Number(location.longitude).toFixed(5)}
                               </p>
                             </div>
                           ))}

                           {companyLocations.length === 0 && (
                             <p className="rounded-lg border border-slate-200 p-4 text-center text-xs text-slate-500 dark:border-slate-800 md:col-span-2">
                               {locationsMessage || 'No active company locations found.'}
                             </p>
                           )}
                         </div>
                       </div>
                    </motion.div>
                )}                

                {activeTab === 'roster' && (
                    <motion.div initial={{opacity:0, y:5}} animate={{opacity:1, y:0}} className="bg-white dark:bg-[#0a1a17]/40 border border-slate-200 dark:border-emerald-500/10 rounded-2xl flex flex-col overflow-hidden backdrop-blur-sm shadow-xl min-h-[320px]">
                       <div className="p-4 border-b border-slate-200 dark:border-emerald-500/10 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
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
                               <th className="p-3">{t('dash.dayDate')}</th>
                               <th className="p-3">{t('dash.shiftFrame')}</th>
                               <th className="p-3">Break Time</th>
                               <th className="p-3">{t('dash.locationRole')}</th>
                               <th className={cn("p-3", isRtl ? "text-left" : "text-right")}>{t('dash.status')}</th>
                             </tr>
                           </thead>
                           <tbody className="text-sm">
                             {schedule.map((s, i) => (
                               <tr key={i} className="border-b border-slate-100 dark:border-slate-800/50 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 transition-colors group">
                                 <td className="p-3">
                                   <div className="font-bold text-slate-800 dark:text-slate-200 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">{s.day}, {s.date}</div>
                                 </td>
                                 <td className="p-3 font-mono text-xs text-slate-500 dark:text-slate-400">
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
                                 <td className="p-3 font-mono text-xs text-slate-500 dark:text-slate-400">
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
                                 <td className="p-3 text-xs text-slate-600 dark:text-slate-300">
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
                                 <td className={cn("p-3", isRtl ? "text-left" : "text-right")}>
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

                {activeTab === 'feed' && (
                   <motion.div initial={{opacity:0, y:5}} animate={{opacity:1, y:0}} className="bg-white dark:bg-[#0a1a17]/90 border border-slate-200 dark:border-emerald-500/20 rounded-2xl p-4 shadow-xl backdrop-blur-sm min-h-[320px]">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
                            <Newspaper className="h-5 w-5 text-emerald-500" />
                            Company Feed
                          </h2>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            Announcements, events, and policy updates for your company.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            loadFeed();
                            loadAdminFeed();
                          }}
                          disabled={feedLoading || adminFeedLoading}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-600 transition hover:border-emerald-300 hover:text-emerald-700 disabled:cursor-wait disabled:opacity-60 dark:border-slate-800 dark:text-slate-300"
                        >
                          Refresh
                        </button>
                      </div>

                      {user.role === 'hr_admin' && (
                        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/40">
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                            <input
                              value={feedForm.title}
                              onChange={(event) => updateFeedForm('title', event.target.value)}
                              placeholder="Post title"
                              className="rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 md:col-span-2"
                            />
                            <select
                              value={feedForm.postType}
                              onChange={(event) => updateFeedForm('postType', event.target.value)}
                              className="rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                            >
                              <option value="announcement">Announcement</option>
                              <option value="event">Event</option>
                              <option value="policy_update">Policy Update</option>
                              <option value="general">General</option>
                            </select>
                            <select
                              value={feedForm.status}
                              onChange={(event) => updateFeedForm('status', event.target.value)}
                              className="rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                            >
                              <option value="published">Published</option>
                              <option value="draft">Draft</option>
                            </select>
                            <select
                              value={feedForm.visibility}
                              onChange={(event) => updateFeedForm('visibility', event.target.value)}
                              className="rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 md:col-span-2"
                            >
                              <option value="all">Everyone</option>
                              <option value="role:employee">Role: Employee</option>
                              <option value="role:manager">Role: Manager</option>
                              <option value="role:hr_admin">Role: HR Admin</option>
                              {companyLocations.map((location) => (
                                <option key={location.id} value={`location:${location.id}`}>
                                  Location: {location.name}
                                </option>
                              ))}
                            </select>
                            <textarea
                              value={feedForm.contentText}
                              onChange={(event) => updateFeedForm('contentText', event.target.value)}
                              placeholder="Write the announcement..."
                              rows={4}
                              className="resize-none rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 md:col-span-4"
                            />
                            <button
                              type="button"
                              onClick={submitFeedPost}
                              disabled={feedSubmitting}
                              className="rounded bg-emerald-500 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-950 transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60 md:col-span-4"
                            >
                              {feedSubmitting ? 'Saving...' : feedForm.status === 'published' ? 'Publish Post' : 'Save Draft'}
                            </button>
                          </div>
                        </div>
                      )}

                      {feedMessage && (
                        <p className={cn(
                          "mt-4 rounded-lg border px-3 py-2 text-xs font-semibold",
                          feedMessageType === 'success'
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300"
                            : "border-red-200 bg-red-50 text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300"
                        )}>
                          {feedMessage}
                        </p>
                      )}

                      <div className="mt-4 space-y-3">
                        {feedPosts.map((post) => (
                          <article key={post.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/35">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{post.title}</h3>
                                <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                  {post.author_name || 'HR Admin'} • {formatShortDateTime(post.published_at)}
                                </p>
                              </div>
                              <span className="w-fit rounded-full border border-emerald-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:border-emerald-500/20 dark:text-emerald-300">
                                {formatLabel(post.post_type)}
                              </span>
                            </div>
                            {post.post_type === 'event' && (post.event_starts_at || post.event_ends_at) && (
                              <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200">
                                {post.event_starts_at ? formatShortDateTime(post.event_starts_at) : 'Event time TBD'}
                                {post.event_ends_at ? ` - ${formatShortDateTime(post.event_ends_at)}` : ''}
                              </p>
                            )}
                            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-300">{post.content_text}</p>
                          </article>
                        ))}

                        {!feedLoading && feedPosts.length === 0 && (
                          <p className="rounded-lg border border-slate-200 p-6 text-center text-xs text-slate-500 dark:border-slate-800">
                            No company announcements yet.
                          </p>
                        )}

                        {feedLoading && (
                          <p className="rounded-lg border border-slate-200 p-6 text-center text-xs text-slate-500 dark:border-slate-800">
                            Loading company feed...
                          </p>
                        )}
                      </div>

                      {user.role === 'hr_admin' && (
                        <div className="mt-4 rounded-xl border border-slate-200 bg-white/70 p-4 dark:border-slate-800 dark:bg-slate-900/30">
                          <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-700 dark:text-slate-300">Manage Posts</h3>
                          <div className="space-y-2">
                            {adminFeedPosts.map((post) => (
                              <div key={post.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40 sm:flex-row sm:items-center sm:justify-between">
                                <div className="min-w-0">
                                  <p className="truncate text-xs font-bold text-slate-800 dark:text-slate-100">{post.title}</p>
                                  <p className="mt-1 text-[10px] uppercase tracking-widest text-slate-500">
                                    {formatLabel(post.post_type)} • {formatShortDateTime(post.created_at)}
                                  </p>
                                </div>
                                <select
                                  value={post.status}
                                  onChange={(event) => updateFeedStatus(post.id, event.target.value as FeedPostStatus)}
                                  disabled={feedUpdatingId !== null}
                                  className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 outline-none focus:border-emerald-400 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                                >
                                  <option value="draft">Draft</option>
                                  <option value="published">Published</option>
                                  <option value="archived">Archived</option>
                                </select>
                              </div>
                            ))}

                            {!adminFeedLoading && adminFeedPosts.length === 0 && (
                              <p className="rounded-lg border border-slate-200 p-4 text-center text-xs text-slate-500 dark:border-slate-800">
                                No posts to manage yet.
                              </p>
                            )}

                            {adminFeedLoading && (
                              <p className="rounded-lg border border-slate-200 p-4 text-center text-xs text-slate-500 dark:border-slate-800">
                                Loading posts...
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                   </motion.div>
                )}

                {activeTab === 'profile' && (
                   <motion.div initial={{opacity:0, y:5}} animate={{opacity:1, y:0}} className="bg-white dark:bg-[#0a1a17]/90 border border-slate-200 dark:border-emerald-500/20 rounded-2xl p-4 shadow-xl backdrop-blur-sm min-h-[320px]">
                      <div className="flex items-center gap-3 mb-5">
                          <User className="w-7 h-7 text-emerald-600 dark:text-emerald-500" />
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
                                disabled={payrollSubmitting}
                                className="rounded bg-emerald-500 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-950 transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60"
                              >
                                {payrollSubmitting ? 'Generating payroll...' : 'Run Payroll'}
                              </button>
                            </div>
                          )}

                          {payrollMessage && (
                            <p className={cn(
                              "rounded-lg border px-3 py-2 text-xs font-semibold",
                              payrollMessageType === 'success'
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300"
                                : "border-red-200 bg-red-50 text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300"
                            )}>
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
                      ) : showGrievancesPanel ? (
                        <div className="space-y-5">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-slate-800 dark:text-slate-200">
                                <MessageSquare className="h-4 w-4 text-emerald-500" />
                                Grievances
                              </h3>
                              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                {canManageGrievances ? 'File a grievance and manage tenant cases.' : 'File and track your own grievance cases.'}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => setShowGrievancesPanel(false)}
                              className="rounded-lg border border-slate-200 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-600 transition hover:border-emerald-300 hover:text-emerald-700 dark:border-slate-800 dark:text-slate-300"
                            >
                              Back
                            </button>
                          </div>

                          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/40">
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                              <input
                                value={grievanceForm.title}
                                onChange={(event) => updateGrievanceForm('title', event.target.value)}
                                placeholder="Title"
                                className="rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 md:col-span-2"
                              />
                              <input
                                value={grievanceForm.category}
                                onChange={(event) => updateGrievanceForm('category', event.target.value)}
                                placeholder="Category"
                                className="rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                              />
                              <select
                                value={grievanceForm.priority}
                                onChange={(event) => updateGrievanceForm('priority', event.target.value)}
                                className="rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                              >
                                <option value="low">Low</option>
                                <option value="normal">Normal</option>
                                <option value="high">High</option>
                                <option value="urgent">Urgent</option>
                              </select>
                              <textarea
                                value={grievanceForm.description}
                                onChange={(event) => updateGrievanceForm('description', event.target.value)}
                                placeholder="Description"
                                rows={4}
                                className="rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 md:col-span-4"
                              />
                              <button
                                type="button"
                                onClick={submitGrievance}
                                disabled={grievanceSubmitting}
                                className="rounded bg-emerald-500 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-950 transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60 md:col-span-4"
                              >
                                {grievanceSubmitting ? 'Submitting...' : 'Submit Grievance'}
                              </button>
                            </div>
                          </div>

                          {grievanceMessage && (
                            <p className={cn(
                              "rounded-lg border px-3 py-2 text-xs font-semibold",
                              grievanceMessageType === 'success'
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300"
                                : "border-red-200 bg-red-50 text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300"
                            )}>
                              {grievanceMessage}
                            </p>
                          )}

                          <div className="rounded-xl border border-slate-200 bg-white/70 p-4 dark:border-slate-800 dark:bg-slate-900/30">
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <h4 className="text-xs font-bold uppercase tracking-widest text-slate-700 dark:text-slate-300">My Grievances</h4>
                              <button
                                type="button"
                                onClick={() => loadGrievances()}
                                disabled={grievanceLoading || tenantGrievanceLoading}
                                className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 transition hover:text-emerald-500 disabled:opacity-60 dark:text-emerald-300"
                              >
                                Refresh
                              </button>
                            </div>

                            <div className="space-y-3">
                              {myGrievances.map((grievance) => (
                                <div key={grievance.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                    <div>
                                      <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{grievance.title}</p>
                                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{grievance.description}</p>
                                    </div>
                                    <span className="w-fit rounded-full border border-emerald-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:border-emerald-500/20 dark:text-emerald-300">
                                      {formatLabel(grievance.status)}
                                    </span>
                                  </div>
                                  <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                    <span>{formatLabel(grievance.category)}</span>
                                    <span>{formatLabel(grievance.priority)}</span>
                                    <span>{formatShortDateTime(grievance.created_at)}</span>
                                  </div>
                                </div>
                              ))}

                              {!grievanceLoading && myGrievances.length === 0 && (
                                <p className="rounded-lg border border-slate-200 p-6 text-center text-xs text-slate-500 dark:border-slate-800">
                                  No grievances filed yet.
                                </p>
                              )}

                              {grievanceLoading && (
                                <p className="rounded-lg border border-slate-200 p-6 text-center text-xs text-slate-500 dark:border-slate-800">
                                  Loading your grievances...
                                </p>
                              )}
                            </div>
                          </div>

                          {canManageGrievances && (
                            <div className="rounded-xl border border-slate-200 bg-white/70 p-4 dark:border-slate-800 dark:bg-slate-900/30">
                              <h4 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-700 dark:text-slate-300">Tenant Grievances</h4>
                              <div className="overflow-x-auto">
                                <table className={cn("w-full min-w-[860px]", isRtl ? "text-right" : "text-left")}>
                                  <thead>
                                    <tr className="border-b border-slate-200 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:border-slate-800">
                                      <th className="p-3">Employee</th>
                                      <th className="p-3">Case</th>
                                      <th className="p-3">Priority</th>
                                      <th className="p-3">Status</th>
                                      <th className="p-3">Created</th>
                                      <th className="p-3">Update</th>
                                    </tr>
                                  </thead>
                                  <tbody className="text-xs">
                                    {tenantGrievances.map((grievance) => (
                                      <tr key={grievance.id} className="border-b border-slate-100 text-slate-700 last:border-0 dark:border-slate-800 dark:text-slate-300">
                                        <td className="p-3 font-semibold">
                                          {grievance.full_name || 'Employee'}
                                          <span className="block text-[10px] font-normal text-slate-500">{grievance.email || grievance.employee_id}</span>
                                        </td>
                                        <td className="p-3">
                                          <span className="block font-bold text-slate-800 dark:text-slate-100">{grievance.title}</span>
                                          <span className="mt-1 block max-w-[280px] truncate text-[10px] text-slate-500">{grievance.description}</span>
                                        </td>
                                        <td className="p-3">{formatLabel(grievance.priority)}</td>
                                        <td className="p-3">{formatLabel(grievance.status)}</td>
                                        <td className="p-3 font-mono text-[11px]">{formatShortDateTime(grievance.created_at)}</td>
                                        <td className="p-3">
                                          <select
                                            value={grievance.status}
                                            onChange={(event) => updateGrievanceStatus(grievance.id, event.target.value as GrievanceStatus)}
                                            disabled={grievanceUpdatingId !== null}
                                            className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 outline-none focus:border-emerald-400 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                                          >
                                            {grievanceStatuses.map((status) => (
                                              <option key={status} value={status}>{formatLabel(status)}</option>
                                            ))}
                                          </select>
                                        </td>
                                      </tr>
                                    ))}

                                    {!tenantGrievanceLoading && tenantGrievances.length === 0 && (
                                      <tr>
                                        <td colSpan={6} className="p-6 text-center text-xs text-slate-500">
                                          No tenant grievances yet.
                                        </td>
                                      </tr>
                                    )}

                                    {tenantGrievanceLoading && (
                                      <tr>
                                        <td colSpan={6} className="p-6 text-center text-xs text-slate-500">
                                          Loading tenant grievances...
                                        </td>
                                      </tr>
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                         <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/50 p-4 rounded-xl md:col-span-2">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
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

                            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                              <label className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-800 dark:bg-slate-950/40">
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

                              <label className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-800 dark:bg-slate-950/40">
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

                         <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/50 p-4 rounded-xl flex flex-col justify-between">
                            <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">{t('profile.leaveName')}</p>
                            <p className="text-3xl font-bold text-slate-800 dark:text-white">24.5 <span className="text-sm text-slate-500 font-normal">{t('profile.leaveDays')}</span></p>
                            <div className="w-full h-1 bg-slate-200 dark:bg-slate-800 mt-3 rounded-full overflow-hidden">
                              <div className="w-[70%] h-full bg-emerald-500"></div>
                            </div>
                         </div>
                         <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/50 p-4 rounded-xl flex flex-col justify-between">
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
                            className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/50 p-4 rounded-xl flex items-center justify-between cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-left"
                         >
                            <p className="font-bold text-slate-700 dark:text-slate-300">{t('profile.payroll')}</p>
                            <Settings2 className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                         </button>
                         <button
                            type="button"
                            onClick={() => {
                              setShowPayrollPanel(false);
                              setShowGrievancesPanel(true);
                            }}
                            className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/50 p-4 rounded-xl flex items-center justify-between cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-left"
                         >
                            <p className="font-bold text-slate-700 dark:text-slate-300">{t('profile.grievance')}</p>
                            <Settings2 className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                         </button>
                      </div>
                      )}
                   </motion.div>
                )}

            </div>

            {/* Sidebar (Right) / Stats & Insights */}
            <div className="w-full xl:w-80 2xl:w-96 flex flex-col gap-4 shrink-0 z-10">
                 <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/50 rounded-2xl p-4 backdrop-blur-sm shadow-xl h-fit overflow-hidden">
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-widest">
                        <MapPin className="w-5 h-5 text-emerald-500" /> Locations
                      </span>
                      <span className="rounded-full border border-emerald-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-emerald-700 dark:border-emerald-500/20 dark:text-emerald-300">
                        {companyLocations.length}
                      </span>
                    </div>

                    <div className="mt-3 space-y-2.5">
                      {companyLocations.map((location) => (
                        <div key={location.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/30">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-xs font-bold text-slate-800 dark:text-slate-100">{location.name}</p>
                              <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                {location.location_type.replace('_', ' ')} - {location.radius_meters}m
                              </p>
                            </div>
                            {location.is_primary && (
                              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
                                HQ
                              </span>
                            )}
                          </div>
                          <p className="mt-2 text-[10px] text-slate-500">
                            {location.is_active ? 'Active' : 'Inactive'}
                          </p>
                        </div>
                      ))}

                      {companyLocations.length === 0 && (
                        <p className="rounded-lg border border-slate-200 p-4 text-center text-xs text-slate-500 dark:border-slate-800">
                          {locationsMessage || 'No company locations found.'}
                        </p>
                      )}
                    </div>
                 </div>

                 <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/50 rounded-2xl p-4 backdrop-blur-sm shadow-xl h-fit overflow-hidden">
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-widest">
                        <CheckCircle2 className="w-5 h-5 text-emerald-500" /> {t('dash.advParams')}
                      </span>
                      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
                        Ready
                      </span>
                    </div>

                    <div className="mt-4 space-y-2.5 text-xs text-slate-600 dark:text-slate-400">
                      <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-2.5 dark:border-slate-800">
                        <span>Locations configured</span>
                        <span className="font-bold text-emerald-600 dark:text-emerald-300">{companyLocations.length}</span>
                      </div>
                      <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-2.5 dark:border-slate-800">
                        <span>Current shift</span>
                        <span className="font-bold text-emerald-600 dark:text-emerald-300">{isClockedIn ? 'Open' : 'Not clocked in'}</span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span>Last attendance event</span>
                        <span className="max-w-[190px] truncate text-right font-medium text-slate-700 dark:text-slate-300">{lastClockEvent}</span>
                      </div>
                    </div>
                 </div>

                 {/* Active Managers Pill (Bottom) */}
<div className="hidden xl:flex relative z-20 bg-emerald-50 dark:bg-emerald-500/5 border border-emerald-200 dark:border-emerald-500/10 backdrop-blur-xl px-4 py-2.5 rounded-full items-center gap-3 shadow-xl w-full">                    <div className="flex -space-x-2">
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
