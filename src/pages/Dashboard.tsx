import { Component, lazy, Suspense, useState, useEffect, useRef, type ChangeEvent, type ErrorInfo, type MouseEvent, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Fingerprint, LogOut, MapPin, Map, Navigation, 
  Calendar, CheckCircle2, AlertTriangle, User, Sun, Moon, Bell, Coffee, Save, DollarSign, MessageSquare, Newspaper, Download, Smartphone, WifiOff, ChevronDown, Info, FileText, Minus, Plus, RotateCcw, Camera, Trash2, BriefcaseBusiness
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useLanguage } from '../lib/LanguageContext';
import { useTheme } from '../lib/ThemeContext';
import { StanzaFingerprintMark } from '../components/StanzaFingerprintMark';
import { apiUrl } from '../lib/api';
import { BrandWordmark } from '../components/BrandWordmark';
import { PrivacyPolicyModal } from '../components/PrivacyPolicyModal';
import type { AuthUser } from '../App';
import { UserAvatar } from '../components/UserAvatar';
import { AttentionBadge } from '../components/AttentionBadge';
import { useDashboardAttentionCounts } from '../hooks/useDashboardAttentionCounts';
import {
  INTERFACE_SCALE_STEP,
  MAX_INTERFACE_SCALE,
  MIN_INTERFACE_SCALE,
  useStanzaPreferences,
} from '../lib/StanzaPreferencesContext';

const RichTextEditor = lazy(() => import('../components/RichTextEditor').then((module) => ({ default: module.RichTextEditor })));
const StanzaDashboardLanyard = lazy(() => import('../components/lanyard/StanzaDashboardLanyard'));
const ProfilePhotoCropDialog = lazy(() => import('../components/ProfilePhotoCropDialog').then((module) => ({ default: module.ProfilePhotoCropDialog })));
const HiringPanel = lazy(() => import('../components/hiring/HiringPanel').then((module) => ({ default: module.HiringPanel })));

type DashboardNetworkInformation = {
  saveData?: boolean;
  effectiveType?: string;
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
};

type DashboardIdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

type LanyardAnchorNdc = {
  x: number;
  y: number;
};

class DashboardLanyardBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.warn('[Stanza Lanyard] Lazy load failed.', error, info.componentStack);
    }
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
const RichFeedContent = lazy(() => import('../components/RichTextEditor').then((module) => ({ default: module.RichFeedContent })));

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

type ClockActionState =
  | 'idle'
  | 'locating'
  | 'verifying'
  | 'success'
  | 'failed'
  | 'outside_geofence'
  | 'open_shift_conflict'
  | 'clocked_out';

type ShiftRow = {
  id?: string;
  employeeId?: string;
  day: string;
  date: string;
  shiftStart: string;
  shiftEnd: string;
  breakStart: string;
  breakEnd: string;
  type: string;
};

type RosterEmployee = {
  id: string;
  fullName: string;
  email: string;
  role: AuthUser['role'];
};

type RosterWarning = {
  code: 'APPROVED_LEAVE_CONFLICT' | 'WEEKLY_HOURS_EXCEEDED';
  message: string;
  currentMinutes?: number;
  proposedMinutes?: number;
  thresholdMinutes?: number;
  startDate?: string;
  endDate?: string;
};

type PendingRosterSave = {
  shift: ShiftRow;
  warnings: RosterWarning[];
};

type NotificationSettings = {
  channel: NotificationChannel;
  notificationKey: NotificationKey;
  enabled: boolean;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
};

type PasskeyRecord = {
  id: string;
  deviceLabel: string;
  transports: string[];
  createdAt: string;
  lastUsedAt?: string | null;
};

type NotificationChannel = 'in_app' | 'email' | 'push';
type NotificationKey =
  | 'attendance_reminders'
  | 'break_reminders'
  | 'break_request_pending'
  | 'break_request_reviewed'
  | 'leave_updates'
  | 'payroll_updates'
  | 'loan_updates'
  | 'grievance_updates'
  | 'company_feed_posts'
  | 'role_permission_changes'
  | 'system_alerts';

type PayrollStatus = 'draft' | 'approved' | 'paid' | 'cancelled';

type BreakRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

type BreakRequest = {
  id: string;
  employee_id: string;
  full_name?: string;
  email?: string;
  role?: AuthUser['role'];
  requested_start_time?: string | null;
  requested_end_time?: string | null;
  duration_minutes: number;
  reason?: string | null;
  status: BreakRequestStatus;
  reviewed_by?: string | null;
  reviewer_name?: string | null;
  reviewed_at?: string | null;
  review_note?: string | null;
  created_at: string;
  updated_at?: string | null;
};

type BreakRequestFormState = {
  durationMinutes: string;
  customDuration: string;
  reason: string;
};

type ResignationStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'processed';
type ResignationRequest = {
  id: string;
  employee_id: string;
  full_name?: string;
  email?: string;
  resignation_type: string;
  requested_last_working_day: string;
  reason?: string | null;
  status: ResignationStatus;
  reviewed_by?: string | null;
  reviewer_name?: string | null;
  reviewed_at?: string | null;
  review_note?: string | null;
  created_at: string;
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
  status: PayrollStatus;
  generated_at: string;
  approved_at?: string | null;
  paid_at?: string | null;
  cancelled_at?: string | null;
};

type PayrollFormState = {
  payPeriodStart: string;
  payPeriodEnd: string;
  defaultBaseSalary: string;
  bonuses: string;
  deductions: string;
};

type CompensationPayType = 'monthly' | 'hourly' | 'weekly' | 'annual';

type CompensationProfile = {
  id?: string | null;
  employee_id: string;
  full_name?: string;
  email?: string;
  role?: AuthUser['role'];
  pay_type?: CompensationPayType | null;
  base_amount?: string | number | null;
  currency?: string | null;
  effective_from?: string | null;
  effective_to?: string | null;
  is_active?: boolean | null;
};

type CompensationFormState = {
  employeeId: string;
  payType: CompensationPayType;
  baseAmount: string;
  currency: string;
  effectiveFrom: string;
};

type SkippedPayrollEmployee = {
  employeeId: string;
  email: string;
  reason: string;
};

type LoanStatus = 'active' | 'paid' | 'cancelled';
type LoanRepaymentFrequency = 'monthly' | 'weekly' | 'one_time';

type EmployeeLoan = {
  id: string;
  employee_id: string;
  full_name?: string;
  email?: string;
  loan_name: string;
  principal_amount: string | number;
  outstanding_balance: string | number;
  currency: string;
  repayment_amount: string | number;
  repayment_frequency: LoanRepaymentFrequency;
  status: LoanStatus;
  issued_at: string;
  due_date?: string | null;
  created_at: string;
  updated_at: string;
};

type LoanFormState = {
  employeeId: string;
  loanName: string;
  principalAmount: string;
  repaymentAmount: string;
  currency: string;
  repaymentFrequency: LoanRepaymentFrequency;
  dueDate: string;
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
  content_json?: unknown | null;
  contentJson?: unknown | null;
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
  contentJson: unknown | null;
  status: 'draft' | 'published';
  visibility: FeedVisibilityValue;
};

type TenantPermission = {
  permission_key: string;
  label: string;
  description?: string | null;
};

type TenantRole = {
  id: string;
  name: string;
  description?: string | null;
  system_key?: AuthUser['role'] | null;
  is_system: boolean;
  is_active: boolean;
  permissions: string[];
  assigned_employee_count?: number;
};

type RoleAssignmentEmployee = {
  id: string;
  email: string;
  full_name: string;
  role: AuthUser['role'];
  job_title?: string | null;
  assigned_roles: Array<{
    id: string;
    name: string;
    systemKey?: AuthUser['role'] | null;
  }>;
};

type RoleFormState = {
  name: string;
  description: string;
  permissionKeys: string[];
};

type TitleDrafts = Record<string, string>;

const defaultSchedule: ShiftRow[] = [
  { day: 'Monday', date: '24', shiftStart: '09:00', shiftEnd: '17:00', breakStart: '13:00', breakEnd: '13:30', type: 'Office HQ' },
  { day: 'Tuesday', date: '25', shiftStart: '09:00', shiftEnd: '17:00', breakStart: '13:00', breakEnd: '13:30', type: 'Office HQ' },
  { day: 'Wednesday', date: '26', shiftStart: '09:00', shiftEnd: '17:00', breakStart: '12:30', breakEnd: '13:00', type: 'Remote' },
  { day: 'Thursday', date: '27', shiftStart: '', shiftEnd: '', breakStart: '', breakEnd: '', type: 'Annual Leave' },
  { day: 'Friday', date: '28', shiftStart: '09:00', shiftEnd: '14:00', breakStart: '11:30', breakEnd: '12:00', type: 'Office HQ' },
  { day: 'Saturday', date: '29', shiftStart: '', shiftEnd: '', breakStart: '', breakEnd: '', type: 'Unscheduled' },
  { day: 'Sunday', date: '30', shiftStart: '', shiftEnd: '', breakStart: '', breakEnd: '', type: 'Unscheduled' },
];

const MAX_ROSTER_RANGE_DAYS = 31;

function toRosterDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function fromRosterDateKey(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  const parsed = new Date(year, month - 1, day, 12);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function addRosterDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getWeekStart(date: Date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  const mondayOffset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - mondayOffset);
  return start;
}

function getDefaultShiftForDate(date: Date): ShiftRow {
  const weekdayIndex = (date.getDay() + 6) % 7;
  const template = defaultSchedule[weekdayIndex];
  return { ...template, date: toRosterDateKey(date) };
}

function getRosterDateRange(startDate: string, endDate: string) {
  const start = fromRosterDateKey(startDate);
  const end = fromRosterDateKey(endDate);
  if (!start || !end || end < start) return { dates: [] as Date[], error: 'invalid' as const };

  const dayCount = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (dayCount > MAX_ROSTER_RANGE_DAYS) return { dates: [] as Date[], error: 'too_large' as const };

  return {
    dates: Array.from({ length: dayCount }, (_, index) => addRosterDays(start, index)),
    error: null,
  };
}

const notificationChannels: Array<{ key: NotificationChannel; label: string }> = [
  { key: 'in_app', label: 'In-app' },
  { key: 'email', label: 'Email' },
  { key: 'push', label: 'Push' },
];

const notificationCategories: Array<{ key: NotificationKey; label: string; description: string }> = [
  { key: 'attendance_reminders', label: 'Attendance reminders', description: 'Clock-in, clock-out, and attendance perimeter prompts.' },
  { key: 'break_reminders', label: 'Break reminders', description: 'Scheduled break start and return reminders.' },
  { key: 'break_request_pending', label: 'Break approval queue', description: 'Manager and HR alerts for pending break requests.' },
  { key: 'break_request_reviewed', label: 'Break request updates', description: 'Approval and rejection updates for your break requests.' },
  { key: 'leave_updates', label: 'Leave request updates', description: 'Leave approvals, rejections, and workflow changes.' },
  { key: 'payroll_updates', label: 'Payroll updates', description: 'Payroll runs, approvals, payments, and statement availability.' },
  { key: 'loan_updates', label: 'Loan updates', description: 'Employee loan creation, balance, and status updates.' },
  { key: 'grievance_updates', label: 'Grievance updates', description: 'Case status changes and review activity.' },
  { key: 'company_feed_posts', label: 'Company feed posts', description: 'Announcements, events, and policy updates.' },
  { key: 'role_permission_changes', label: 'Role & permission changes', description: 'Custom role assignments and permission updates.' },
  { key: 'system_alerts', label: 'System alerts', description: 'Important account, workspace, and security notices.' },
];

const defaultNotificationSettings: NotificationSettings[] = notificationCategories.flatMap((category) => (
  notificationChannels.map((channel) => ({
    channel: channel.key,
    notificationKey: category.key,
    enabled: true,
    quietHoursStart: null,
    quietHoursEnd: null,
  }))
));

const defaultPayrollForm: PayrollFormState = {
  payPeriodStart: '',
  payPeriodEnd: '',
  defaultBaseSalary: '',
  bonuses: '0',
  deductions: '0',
};

const defaultBreakRequestForm: BreakRequestFormState = {
  durationMinutes: '15',
  customDuration: '',
  reason: '',
};

const defaultCompensationForm: CompensationFormState = {
  employeeId: '',
  payType: 'monthly',
  baseAmount: '',
  currency: '',
  effectiveFrom: '',
};

const defaultLoanForm: LoanFormState = {
  employeeId: '',
  loanName: '',
  principalAmount: '',
  repaymentAmount: '',
  currency: '',
  repaymentFrequency: 'monthly',
  dueDate: '',
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
  contentJson: null,
  status: 'published',
  visibility: 'all',
};

const defaultRoleForm: RoleFormState = {
  name: '',
  description: '',
  permissionKeys: [],
};

const grievanceStatuses: GrievanceStatus[] = ['open', 'under_review', 'resolved', 'rejected', 'closed'];

function readStoredSchedule() {
  if (typeof window === 'undefined') return [];

  try {
    const storedSchedule = window.localStorage.getItem('horizon-roster');
    if (!storedSchedule) return [];

    const parsedSchedule = JSON.parse(storedSchedule);
    return Array.isArray(parsedSchedule)
      ? parsedSchedule.filter((shift): shift is ShiftRow => (
        Boolean(shift) && typeof shift.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(shift.date)
      ))
      : [];
  } catch {
    return [];
  }
}

function readStoredNotifications() {
  return defaultNotificationSettings;
}

function getShiftFrame(shift: ShiftRow) {
  return shift.shiftStart && shift.shiftEnd ? `${shift.shiftStart} - ${shift.shiftEnd}` : 'Leave';
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

function getBreakStatusClass(status: BreakRequestStatus) {
  if (status === 'approved') return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/25';
  if (status === 'rejected') return 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/25';
  if (status === 'cancelled') return 'bg-neutral-500/10 text-neutral-600 dark:text-neutral-300 border-neutral-500/25';
  return 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25';
}

function getNextPayrollStatuses(status: PayrollStatus): PayrollStatus[] {
  if (status === 'draft') return ['approved', 'cancelled'];
  if (status === 'approved') return ['paid', 'cancelled'];
  return [];
}

const legacyRolePermissionFallback: Record<AuthUser['role'], string[]> = {
  employee: ['break_requests.create', 'break_requests.view_own', 'payroll.view_self', 'payroll.export_pdf', 'loans.view_self'],
  manager: ['break_requests.create', 'break_requests.view_own', 'break_requests.review', 'break_requests.view_all', 'payroll.view_self', 'payroll.export_pdf', 'loans.view_self'],
  hr_admin: [],
};

function hasPermission(user: AuthUser, permissionKey: string) {
  if (user.role === 'hr_admin') return true;
  if (user.permissions) return user.permissions.includes(permissionKey);
  return legacyRolePermissionFallback[user.role].includes(permissionKey);
}

function isUuidString(value: string | undefined) {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

function notifyEmployee(title: string, body: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  new Notification(title, { body });
}

// Helper hook for Geolocation fetching
type DeviceCoordinates = { lat: number; lng: number; accuracy: number };
type ClockAccuracyLevel = 'good' | 'approximate' | 'low';

function getClockAccuracyLevel(accuracy: number): ClockAccuracyLevel {
  if (accuracy <= 100) return 'good';
  if (accuracy <= 1000) return 'approximate';
  return 'low';
}

function formatAccuracyMeters(accuracy: number) {
  return Math.round(accuracy).toLocaleString();
}

function logClockDebug(message: string, details?: unknown) {
  if (import.meta.env.DEV) {
    if (details !== undefined) {
      console.log(message, details);
    } else {
      console.log(message);
    }
  }
}

function useGeolocation() {
  const [coords, setCoords] = useState<DeviceCoordinates | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const requestCoordinates = (messages?: { unavailable?: string; denied?: string }) => new Promise<DeviceCoordinates>((resolve, reject) => {
    setLoading(true);
    setError(null);
    logClockDebug('[clock-in] requesting geolocation');
    if (!navigator.geolocation) {
      const message = messages?.unavailable || "Location services are not available in this browser.";
      setError(message);
      setLoading(false);
      logClockDebug('[clock-in] geolocation error', { message });
      reject(new Error(message));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nextCoords = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };
        setCoords(nextCoords);
        setLoading(false);
        logClockDebug('[clock-in] geolocation success', nextCoords);
        resolve(nextCoords);
      },
      (err) => {
        const message = err.code === err.PERMISSION_DENIED
          ? messages?.denied || 'Location permission is required to clock in.'
          : err.message || messages?.denied || 'Location permission is required to clock in.';
        setError(message);
        setLoading(false);
        logClockDebug('[clock-in] geolocation error', { code: err.code, message });
        reject(new Error(message));
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  });

  return { coords, error, loading, requestCoordinates };
}

export function Dashboard({ user, onLogout, onShowDemoNotice, onUserUpdate }: { user: AuthUser; onLogout: () => void; onShowDemoNotice: () => void; onUserUpdate: (user: AuthUser) => void }) {
  const [activeTab, setActiveTab] = useState<'geofence' | 'roster' | 'feed' | 'profile' | 'resignations' | 'hiring'>('geofence');
  const [clockInState, setClockInState] = useState<ClockActionState>('idle');
  const [clockMessage, setClockMessage] = useState('');
  const [clockWarning, setClockWarning] = useState('');
  const [lastClockAccuracy, setLastClockAccuracy] = useState<number | null>(null);
  const [isClockedIn, setIsClockedIn] = useState(false);
  const [activeTimeLogId, setActiveTimeLogId] = useState<string | null>(null);
  const [lastClockEvent, setLastClockEvent] = useState<string>('No active shift recorded.');
  const [breakRequests, setBreakRequests] = useState<BreakRequest[]>([]);
  const [pendingBreakRequests, setPendingBreakRequests] = useState<BreakRequest[]>([]);
  const [breakRequestsLoading, setBreakRequestsLoading] = useState(false);
  const [breakRequestSubmitting, setBreakRequestSubmitting] = useState(false);
  const [breakRequestReviewingId, setBreakRequestReviewingId] = useState<string | null>(null);
  const [breakRequestMessage, setBreakRequestMessage] = useState('');
  const [breakRequestMessageType, setBreakRequestMessageType] = useState<'success' | 'error'>('success');
  const [breakRequestForm, setBreakRequestForm] = useState<BreakRequestFormState>(defaultBreakRequestForm);
  const [breakReviewNotes, setBreakReviewNotes] = useState<Record<string, string>>({});
  const [schedule, setSchedule] = useState<ShiftRow[]>(readStoredSchedule);
  const [rosterStartDate, setRosterStartDate] = useState(() => toRosterDateKey(getWeekStart(new Date())));
  const [rosterRangeWeeks, setRosterRangeWeeks] = useState<1 | 2 | 4 | 'custom'>(1);
  const [rosterCustomEndDate, setRosterCustomEndDate] = useState(() => toRosterDateKey(addRosterDays(getWeekStart(new Date()), 6)));
  const [rosterEmployees, setRosterEmployees] = useState<RosterEmployee[]>([]);
  const [selectedRosterEmployeeId, setSelectedRosterEmployeeId] = useState(user.id);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterLoaded, setRosterLoaded] = useState(false);
  const [rosterMessage, setRosterMessage] = useState('');
  const [pendingRosterSave, setPendingRosterSave] = useState<PendingRosterSave | null>(null);
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings[]>(readStoredNotifications);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notificationSaving, setNotificationSaving] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState('');
  const [notificationMessageType, setNotificationMessageType] = useState<'success' | 'error'>('success');
  const [passkeys, setPasskeys] = useState<PasskeyRecord[]>([]);
  const [passkeysLoading, setPasskeysLoading] = useState(false);
  const [passkeySaving, setPasskeySaving] = useState(false);
  const [passkeyMessage, setPasskeyMessage] = useState('');
  const [passkeyMessageType, setPasskeyMessageType] = useState<'success' | 'error'>('success');
  const [quietHoursStart, setQuietHoursStart] = useState('');
  const [quietHoursEnd, setQuietHoursEnd] = useState('');
  const [showPayrollPanel, setShowPayrollPanel] = useState(false);
  const [payrollRecords, setPayrollRecords] = useState<PayrollRecord[]>([]);
  const [payrollLoading, setPayrollLoading] = useState(false);
  const [payrollSubmitting, setPayrollSubmitting] = useState(false);
  const [payrollExportingId, setPayrollExportingId] = useState<string | null>(null);
  const [payrollMessage, setPayrollMessage] = useState('');
  const [payrollMessageType, setPayrollMessageType] = useState<'success' | 'error'>('success');
  const [payrollForm, setPayrollForm] = useState<PayrollFormState>(defaultPayrollForm);
  const [compensationProfiles, setCompensationProfiles] = useState<CompensationProfile[]>([]);
  const [compensationLoading, setCompensationLoading] = useState(false);
  const [compensationSaving, setCompensationSaving] = useState(false);
  const [compensationForm, setCompensationForm] = useState<CompensationFormState>(defaultCompensationForm);
  const [skippedPayrollEmployees, setSkippedPayrollEmployees] = useState<SkippedPayrollEmployee[]>([]);
  const [employeeLoans, setEmployeeLoans] = useState<EmployeeLoan[]>([]);
  const [loanLoading, setLoanLoading] = useState(false);
  const [loanSaving, setLoanSaving] = useState(false);
  const [loanUpdatingId, setLoanUpdatingId] = useState<string | null>(null);
  const [loanForm, setLoanForm] = useState<LoanFormState>(defaultLoanForm);
  const [loanDeductionsApplied, setLoanDeductionsApplied] = useState(0);
  const [payrollStatusUpdatingId, setPayrollStatusUpdatingId] = useState<string | null>(null);
  const [showGrievancesPanel, setShowGrievancesPanel] = useState(false);
  const [showResignationsPanel, setShowResignationsPanel] = useState(false);
  const [myResignations, setMyResignations] = useState<ResignationRequest[]>([]);
  const [tenantResignations, setTenantResignations] = useState<ResignationRequest[]>([]);
  const [resignationsLoading, setResignationsLoading] = useState(false);
  const [resignationSubmitting, setResignationSubmitting] = useState(false);
  const [resignationUpdatingId, setResignationUpdatingId] = useState<string | null>(null);
  const [resignationMessage, setResignationMessage] = useState('');
  const [resignationMessageType, setResignationMessageType] = useState<'success' | 'error'>('success');
  const [resignationForm, setResignationForm] = useState({ requestedLastWorkingDay: '', resignationType: 'voluntary', reason: '' });
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
  const [feedEditorKey, setFeedEditorKey] = useState(0);
  const [companyLocations, setCompanyLocations] = useState<CompanyLocationRecord[]>([]);
  const [locationsMessage, setLocationsMessage] = useState('');
  const [tenantRoles, setTenantRoles] = useState<TenantRole[]>([]);
  const [tenantPermissions, setTenantPermissions] = useState<TenantPermission[]>([]);
  const [roleEmployees, setRoleEmployees] = useState<RoleAssignmentEmployee[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [roleSaving, setRoleSaving] = useState(false);
  const [roleUpdatingEmployeeId, setRoleUpdatingEmployeeId] = useState<string | null>(null);
  const [roleMessage, setRoleMessage] = useState('');
  const [roleMessageType, setRoleMessageType] = useState<'success' | 'error'>('success');
  const [roleForm, setRoleForm] = useState<RoleFormState>(defaultRoleForm);
  const [titleDrafts, setTitleDrafts] = useState<TitleDrafts>({});
  const [showControlCenter, setShowControlCenter] = useState(false);
  const [profilePhotoFile, setProfilePhotoFile] = useState<File | null>(null);
  const [profilePhotoSaving, setProfilePhotoSaving] = useState(false);
  const [profilePhotoMessage, setProfilePhotoMessage] = useState('');
  const [profilePhotoMessageType, setProfilePhotoMessageType] = useState<'success' | 'error'>('success');
  const [isLanyardCapable, setIsLanyardCapable] = useState(false);
  const [isDashboardVisible, setIsDashboardVisible] = useState(() => document.visibilityState === 'visible');
  const [isLanyardIdleReady, setIsLanyardIdleReady] = useState(false);
  const [isLanyardSceneReady, setIsLanyardSceneReady] = useState(false);
  const [lanyardAnchorNdc, setLanyardAnchorNdc] = useState<LanyardAnchorNdc | null>(null);
  const lanyardMountGeneration = useRef(0);
  const dashboardRootRef = useRef<HTMLDivElement>(null);
  const [showPrivacyPolicy, setShowPrivacyPolicy] = useState(false);
  const [controlCenterSections, setControlCenterSections] = useState({
    personalization: true,
    settings: true,
    passkeys: false,
    readiness: false,
    notifications: false,
    workspace: false,
  });
  const [showTenantId, setShowTenantId] = useState(false);
  const [tenantIdCopied, setTenantIdCopied] = useState(false);
  const [isOffline, setIsOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installDismissed, setInstallDismissed] = useState(() => window.localStorage.getItem('stanza-install-dismissed') === 'true');
  const [isStandalone, setIsStandalone] = useState(() => (
    window.matchMedia('(display-mode: standalone)').matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  ));
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(() => (
    'Notification' in window ? Notification.permission : 'unsupported'
  ));
  const [pwaMessage, setPwaMessage] = useState('');
  const [pwaMessageType, setPwaMessageType] = useState<'success' | 'error' | 'info'>('info');
  const { t, lang, setLang, isRtl } = useLanguage();
  const { isDark, toggleTheme } = useTheme();
  const {
    lanyardEnabled,
    interfaceScale,
    setLanyardEnabled,
    setInterfaceScale,
    resetInterfaceScale,
  } = useStanzaPreferences();

  const geo = useGeolocation();

  useEffect(() => {
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const desktopInputQuery = window.matchMedia('(min-width: 1024px) and (hover: hover) and (pointer: fine)');
    const connection = (navigator as Navigator & { connection?: DashboardNetworkInformation }).connection;
    const updateCapability = () => {
      setIsDashboardVisible(document.visibilityState === 'visible');
      if (!desktopInputQuery.matches) {
        setIsLanyardCapable(false);
        return;
      }

      const effectiveType = connection?.effectiveType?.toLowerCase();
      const canvas = document.createElement('canvas');
      const hasWebGl = Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
      setIsLanyardCapable(
        desktopInputQuery.matches &&
        hasWebGl &&
        !reducedMotionQuery.matches &&
        connection?.saveData !== true &&
        effectiveType !== 'slow-2g' &&
        effectiveType !== '2g',
      );
    };
    updateCapability();
    window.addEventListener('resize', updateCapability);
    document.addEventListener('visibilitychange', updateCapability);
    reducedMotionQuery.addEventListener('change', updateCapability);
    desktopInputQuery.addEventListener('change', updateCapability);
    connection?.addEventListener?.('change', updateCapability);
    return () => {
      window.removeEventListener('resize', updateCapability);
      document.removeEventListener('visibilitychange', updateCapability);
      reducedMotionQuery.removeEventListener('change', updateCapability);
      desktopInputQuery.removeEventListener('change', updateCapability);
      connection?.removeEventListener?.('change', updateCapability);
    };
  }, []);

  const shouldMountLanyard = lanyardEnabled && isLanyardCapable && isDashboardVisible;

  useEffect(() => {
    const generation = ++lanyardMountGeneration.current;
    if (!shouldMountLanyard) {
      setIsLanyardIdleReady(false);
      setIsLanyardSceneReady(false);
      return;
    }

    const idleWindow = window as DashboardIdleWindow;
    let idleHandle: number | undefined;
    let timeoutHandle: number | undefined;

    const markIdleReady = () => {
      if (lanyardMountGeneration.current !== generation) return;
      setIsLanyardIdleReady(true);
    };

    // Fiber releases an unmounted WebGL context on a short delay. Keep the
    // replacement scene behind that cleanup window during rapid preference toggles.
    timeoutHandle = window.setTimeout(() => {
      if (lanyardMountGeneration.current !== generation) return;
      if (idleWindow.requestIdleCallback) {
        idleHandle = idleWindow.requestIdleCallback(markIdleReady, { timeout: 900 });
      } else {
        markIdleReady();
      }
    }, 650);

    return () => {
      if (lanyardMountGeneration.current === generation) lanyardMountGeneration.current += 1;
      if (idleHandle !== undefined) idleWindow.cancelIdleCallback?.(idleHandle);
      if (timeoutHandle !== undefined) window.clearTimeout(timeoutHandle);
    };
  }, [shouldMountLanyard]);

  useEffect(() => {
    if (!shouldMountLanyard || !isLanyardIdleReady) {
      setLanyardAnchorNdc(null);
      return;
    }

    const trigger = document.getElementById('stanza-control-center-trigger');
    if (!trigger) return;

    let frame = 0;
    const measure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const rect = trigger.getBoundingClientRect();
        const viewportWidth = Math.max(1, window.innerWidth);
        const viewportHeight = Math.max(1, window.innerHeight);
        setLanyardAnchorNdc({
          x: ((rect.left + rect.width / 2) / viewportWidth) * 2 - 1,
          y: -(rect.bottom / viewportHeight) * 2 + 1,
        });
      });
    };

    const observer = new ResizeObserver(measure);
    observer.observe(trigger);
    window.addEventListener('resize', measure);
    measure();

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [isLanyardIdleReady, shouldMountLanyard]);

  const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
  const canPromptInstall = Boolean(installPrompt && !installDismissed && !isStandalone);
  const shouldShowIosInstallHint = isIos && !isStandalone;

  useEffect(() => {
    const updateOnlineState = () => setIsOffline(!navigator.onLine);
    const updateStandaloneState = () => {
      setIsStandalone(
        window.matchMedia('(display-mode: standalone)').matches ||
        Boolean((navigator as Navigator & { standalone?: boolean }).standalone),
      );
    };
    const displayModeQuery = window.matchMedia('(display-mode: standalone)');
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      if (!installDismissed) {
        setInstallPrompt(event as BeforeInstallPromptEvent);
      }
    };
    const handleAppInstalled = () => {
      setInstallPrompt(null);
      setInstallDismissed(false);
      window.localStorage.removeItem('stanza-install-dismissed');
      setIsStandalone(true);
      setPwaMessageType('success');
      setPwaMessage(t('dash.installedMessage'));
    };

    window.addEventListener('online', updateOnlineState);
    window.addEventListener('offline', updateOnlineState);
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    displayModeQuery.addEventListener('change', updateStandaloneState);

    updateOnlineState();
    updateStandaloneState();

    return () => {
      window.removeEventListener('online', updateOnlineState);
      window.removeEventListener('offline', updateOnlineState);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      displayModeQuery.removeEventListener('change', updateStandaloneState);
    };
  }, [installDismissed, t]);

  const installStanza = async () => {
    if (!installPrompt) return;

    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      setInstallPrompt(null);

      if (choice.outcome === 'dismissed') {
        setInstallDismissed(true);
        window.localStorage.setItem('stanza-install-dismissed', 'true');
        setPwaMessageType('info');
        setPwaMessage(t('dash.installDismissedMessage'));
      } else {
        setPwaMessageType('success');
        setPwaMessage(t('dash.installStartedMessage'));
      }
    } catch {
      setPwaMessageType('error');
      setPwaMessage(t('dash.installPromptError'));
    }
  };

  const dismissInstallPrompt = () => {
    setInstallDismissed(true);
    setInstallPrompt(null);
    window.localStorage.setItem('stanza-install-dismissed', 'true');
  };

  const requestNotificationPermission = async () => {
    if (!('Notification' in window)) {
      setNotificationPermission('unsupported');
      setPwaMessageType('error');
      setPwaMessage(t('dash.notificationUnsupportedMessage'));
      return;
    }

    if (!window.isSecureContext) {
      setPwaMessageType('error');
      setPwaMessage(t('dash.notificationSecureContextMessage'));
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      setPwaMessageType(permission === 'granted' ? 'success' : 'info');
      setPwaMessage(
        permission === 'granted'
          ? t('dash.notificationReadyMessage')
          : t('dash.notificationNotGrantedMessage'),
      );
    } catch {
      setPwaMessageType('error');
      setPwaMessage(t('dash.notificationRequestError'));
    }
  };

  const canManageRoster = hasPermission(user, 'roster.manage');
  const canViewAllRosters = hasPermission(user, 'roster.view_all') || canManageRoster;
  const rosterEndDate = rosterRangeWeeks === 'custom'
    ? rosterCustomEndDate
    : toRosterDateKey(addRosterDays(fromRosterDateKey(rosterStartDate) || getWeekStart(new Date()), rosterRangeWeeks * 7 - 1));
  const rosterRange = getRosterDateRange(rosterStartDate, rosterEndDate);
  const rosterDays = rosterRange.dates;
  const visibleSchedule = rosterDays.map((date) => {
    const dateKey = toRosterDateKey(date);
    const storedShift = schedule.find((shift) => shift.date === dateKey);
    if (storedShift) return { ...getDefaultShiftForDate(date), ...storedShift };
    return rosterLoaded
      ? { day: date.toLocaleDateString('en-US', { weekday: 'long' }), date: dateKey, shiftStart: '', shiftEnd: '', breakStart: '', breakEnd: '', type: 'Unscheduled' }
      : getDefaultShiftForDate(date);
  });
  const missingCompensationProfiles = compensationProfiles.filter((profile) => !profile.id);
  const compensationPayTypes: CompensationPayType[] = ['monthly', 'hourly', 'weekly', 'annual'];
  const loanRepaymentFrequencies: LoanRepaymentFrequency[] = ['monthly', 'weekly', 'one_time'];
  const loanStatuses: LoanStatus[] = ['active', 'paid', 'cancelled'];
  const canManageRoles = user.role === 'hr_admin' || Boolean(user.permissions?.includes('roles.manage'));
  const canCreateBreakRequests = hasPermission(user, 'break_requests.create');
  const canViewOwnBreakRequests = hasPermission(user, 'break_requests.view_own');
  const canReviewBreakRequests = hasPermission(user, 'break_requests.review') || hasPermission(user, 'break_requests.view_all');
  const canPublishFeed = hasPermission(user, 'feed.publish');
  const canViewAllPayroll = hasPermission(user, 'payroll.view_all');
  const canViewOwnPayroll = hasPermission(user, 'payroll.view_self');
  const canRunPayroll = hasPermission(user, 'payroll.run');
  const canApprovePayroll = hasPermission(user, 'payroll.approve');
  const canMarkPayrollPaid = hasPermission(user, 'payroll.mark_paid');
  const canExportPayrollPdf = hasPermission(user, 'payroll.export_pdf');
  const canManageCompensation = hasPermission(user, 'compensation.manage');
  const canManageLoans = hasPermission(user, 'loans.manage');
  const canViewOwnLoans = hasPermission(user, 'loans.view_self');
  const canViewHiring = hasPermission(user, 'hiring.view');
  const canShowPayrollActions = canApprovePayroll || canMarkPayrollPaid;
  const canUsePayrollPanel = canViewAllPayroll || canViewOwnPayroll || canRunPayroll || canManageCompensation || canManageLoans || canViewOwnLoans || canExportPayrollPdf;
  const payrollTableColSpan = canShowPayrollActions ? 9 : 8;
  const canExportPayrollRecord = (record: PayrollRecord) => (
    canExportPayrollPdf && (canViewAllPayroll || record.employee_id === user.id || user.role === 'hr_admin')
  );
  const getAllowedPayrollStatuses = (status: PayrollStatus) => (
    getNextPayrollStatuses(status).filter((nextStatus) => (
      nextStatus === 'paid' ? canMarkPayrollPaid : canApprovePayroll
    ))
  );
  const canReviewResignations = user.role === 'hr_admin' || user.role === 'manager' || Boolean(user.permissions?.includes('resignations.review'));
  const canProcessResignations = user.role === 'hr_admin' || Boolean(user.permissions?.includes('resignations.process'));
  const profilePanelHeading = showPayrollPanel ? t('profile.payroll') : showGrievancesPanel ? t('dash.grievances') : showResignationsPanel ? t('dash.resignations') : t('profile.title');
  const profilePanelSubtitle = showPayrollPanel
    ? t('dash.payrollSubtitleFull')
    : showGrievancesPanel
      ? t('dash.grievancesSubtitleAdmin')
      : showResignationsPanel
        ? t('dash.resignations')
      : t('profile.subtitle');
  const pendingOwnBreakRequest = breakRequests.find((request) => request.status === 'pending');
  const hasAuthenticatedDashboardUser = isUuidString(user.id) && isUuidString(user.tenantId);
  const { counts: attentionCounts, refresh: refreshAttentionCounts } = useDashboardAttentionCounts(
    user,
    hasAuthenticatedDashboardUser,
  );
  const payrollAttentionCount = attentionCounts.payroll + attentionCounts.loans;
  const attentionAriaLabel = (label: string, count: number) => (
    count > 0 ? `${label}: ${count} ${t('dash.actionItems')}` : label
  );
  const hasActiveShift = isClockedIn || Boolean(activeTimeLogId);

  const displayRole = (role: AuthUser['role']) => {
    if (role === 'hr_admin') return t('enum.hrAdmin');
    if (role === 'manager') return t('enum.manager');
    return t('enum.employee');
  };

  const displayEnum = (value: string) => {
    const normalized = value.toLowerCase();
    const enumLabels: Record<string, ReturnType<typeof t>> = {
      employee: t('enum.employee'),
      manager: t('enum.manager'),
      hr_admin: t('enum.hrAdmin'),
      pending: t('enum.pending'),
      approved: t('enum.approved'),
      rejected: t('enum.rejected'),
      cancelled: t('enum.cancelled'),
      draft: t('enum.draft'),
      published: t('enum.published'),
      archived: t('enum.archived'),
      paid: t('enum.paid'),
      open: t('enum.open'),
      under_review: t('enum.underReview'),
      resolved: t('enum.resolved'),
      closed: t('enum.closed'),
      active: t('enum.active'),
      inactive: t('enum.inactive'),
      missing: t('enum.missing'),
      low: t('enum.low'),
      normal: t('enum.normal'),
      high: t('enum.high'),
      urgent: t('enum.urgent'),
      general: t('enum.general'),
      scheduling: t('enum.scheduling'),
      leave_request: t('enum.leaveRequest'),
      announcement: t('enum.announcement'),
      event: t('enum.event'),
      policy_update: t('enum.policyUpdate'),
      monthly: t('enum.monthly'),
      weekly: t('enum.weekly'),
      hourly: t('enum.hourly'),
      annual: t('enum.annual'),
      one_time: t('enum.oneTime'),
      headquarters: t('enum.headquarters'),
      branch: t('enum.branch'),
      warehouse: t('enum.warehouse'),
      remote_site: t('enum.remoteSite'),
      other: t('enum.other'),
    };

    return enumLabels[normalized] || formatLabel(value);
  };

  const displayWeekday = (day: string) => {
    const weekdayLabels: Record<string, string> = {
      Monday: t('dash.monday'),
      Tuesday: t('dash.tuesday'),
      Wednesday: t('dash.wednesday'),
      Thursday: t('dash.thursday'),
      Friday: t('dash.friday'),
      Saturday: t('dash.saturday'),
      Sunday: t('dash.sunday'),
    };
    return weekdayLabels[day] || day;
  };

  const displayShiftType = (type: string) => {
    const shiftLabels: Record<string, string> = {
      'Office HQ': t('dash.officeHq'),
      Remote: t('dash.remote'),
      'Annual Leave': t('dash.annualLeave'),
      Unscheduled: t('dash.abstained'),
    };
    return shiftLabels[type] || type;
  };

  const displayNotificationChannel = (channel: NotificationChannel) => {
    if (channel === 'in_app') return t('notification.inApp');
    if (channel === 'email') return t('notification.email');
    return t('notification.push');
  };

  const displayNotificationCategory = (key: NotificationKey) => {
    const labels: Record<NotificationKey, string> = {
      attendance_reminders: t('notification.attendanceReminders'),
      break_reminders: t('notification.breakReminders'),
      break_request_pending: t('notification.breakRequestPending'),
      break_request_reviewed: t('notification.breakRequestReviewed'),
      leave_updates: t('notification.leaveUpdates'),
      payroll_updates: t('notification.payrollUpdates'),
      loan_updates: t('notification.loanUpdates'),
      grievance_updates: t('notification.grievanceUpdates'),
      company_feed_posts: t('notification.companyFeedPosts'),
      role_permission_changes: t('notification.rolePermissionChanges'),
      system_alerts: t('notification.systemAlerts'),
    };
    return labels[key];
  };

  const displayNotificationDescription = (key: NotificationKey) => {
    const descriptions: Record<NotificationKey, string> = {
      attendance_reminders: t('notification.attendanceRemindersDescription'),
      break_reminders: t('notification.breakRemindersDescription'),
      break_request_pending: t('notification.breakRequestPendingDescription'),
      break_request_reviewed: t('notification.breakRequestReviewedDescription'),
      leave_updates: t('notification.leaveUpdatesDescription'),
      payroll_updates: t('notification.payrollUpdatesDescription'),
      loan_updates: t('notification.loanUpdatesDescription'),
      grievance_updates: t('notification.grievanceUpdatesDescription'),
      company_feed_posts: t('notification.companyFeedPostsDescription'),
      role_permission_changes: t('notification.rolePermissionChangesDescription'),
      system_alerts: t('notification.systemAlertsDescription'),
    };
    return descriptions[key];
  };

  const displayNotificationPermission = () => {
    if (notificationPermission === 'unsupported') return t('dash.unsupported');
    if (notificationPermission === 'granted') return t('dash.permissionGranted');
    if (notificationPermission === 'denied') return t('dash.permissionDenied');
    return t('dash.permissionDefault');
  };

  const displayLastClockEvent = lastClockEvent === 'No active shift recorded.'
    ? t('dash.noActiveShiftRecorded')
    : lastClockEvent;

  const getNotificationSetting = (notificationKey: NotificationKey, channel: NotificationChannel) => (
    notificationSettings.find((setting) => setting.notificationKey === notificationKey && setting.channel === channel) ||
    defaultNotificationSettings.find((setting) => setting.notificationKey === notificationKey && setting.channel === channel)!
  );

  const updateNotificationToggle = (notificationKey: NotificationKey, channel: NotificationChannel, enabled: boolean) => {
    setNotificationSettings((current) => current.map((setting) => (
      setting.notificationKey === notificationKey && setting.channel === channel
        ? { ...setting, enabled }
        : setting
    )));
  };

  const normalizeNotificationSettings = (settings: NotificationSettings[]) => (
    defaultNotificationSettings.map((defaultSetting) => {
      const savedSetting = settings.find((setting) => (
        setting.notificationKey === defaultSetting.notificationKey &&
        setting.channel === defaultSetting.channel
      ));

      return savedSetting ? { ...defaultSetting, ...savedSetting } : defaultSetting;
    })
  );

  const loadNotificationSettings = async (clearMessage = true) => {
    if (!hasAuthenticatedDashboardUser) return;

    setNotificationLoading(true);
    if (clearMessage) setNotificationMessage('');

    try {
      const res = await fetch(apiUrl('/api/notification-settings/me'), { headers: payrollHeaders });
      const data = await res.json();

      if (res.ok && data.success) {
        const settings = normalizeNotificationSettings(data.settings || []);
        setNotificationSettings(settings);
        const settingWithQuietHours = settings.find((setting) => setting.quietHoursStart || setting.quietHoursEnd);
        setQuietHoursStart(settingWithQuietHours?.quietHoursStart || '');
        setQuietHoursEnd(settingWithQuietHours?.quietHoursEnd || '');
      } else {
        setNotificationMessageType('error');
        setNotificationMessage(data.error || t('dash.notificationLoadError'));
      }
    } catch {
      setNotificationMessageType('error');
      setNotificationMessage(t('dash.notificationLoadServerError'));
    } finally {
      setNotificationLoading(false);
    }
  };

  const saveNotificationSettings = async () => {
    if (isOffline) {
      setNotificationMessageType('error');
      setNotificationMessage('You are offline. Some HR actions require connection.');
      return;
    }

    if (notificationSaving) return;

    setNotificationSaving(true);
    setNotificationMessage('');

    try {
      const res = await fetch(apiUrl('/api/notification-settings/me'), {
        method: 'PUT',
        headers: payrollHeaders,
        body: JSON.stringify({
          settings: notificationSettings.map((setting) => ({
            channel: setting.channel,
            notificationKey: setting.notificationKey,
            enabled: setting.enabled,
            quietHoursStart: quietHoursStart || null,
            quietHoursEnd: quietHoursEnd || null,
          })),
        }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setNotificationSettings(normalizeNotificationSettings(data.settings || []));
        setNotificationMessageType('success');
        setNotificationMessage(t('dash.notificationSaved'));
      } else {
        setNotificationMessageType('error');
        setNotificationMessage(data.error || t('dash.notificationSaveError'));
      }
    } catch {
      setNotificationMessageType('error');
      setNotificationMessage(t('dash.notificationSaveServerError'));
    } finally {
      setNotificationSaving(false);
    }
  };

  const resetClockStatusSoon = () => {
    window.setTimeout(() => {
      setClockInState('idle');
      setClockMessage('');
    }, 4000);
  };

  const updateClockAccuracyNotice = (accuracy: number) => {
    setLastClockAccuracy(accuracy);
    const accuracyText = `${t('dash.locationAccuracy')}: ±${formatAccuracyMeters(accuracy)}m`;
    const accuracyLevel = getClockAccuracyLevel(accuracy);

    if (accuracyLevel === 'low') {
      setClockWarning(`${t('dash.lowAccuracyLocation')} ${accuracyText}`);
      return;
    }

    if (accuracyLevel === 'approximate') {
      setClockWarning(`${t('dash.approximateLocation')} ${accuracyText}`);
      return;
    }

    setClockWarning(accuracyText);
  };

  const handleClockAction = async (event?: MouseEvent<HTMLButtonElement>) => {
    event?.preventDefault();
    event?.stopPropagation();
    logClockDebug('[clock-in] clicked');

    if (isOffline) {
      setClockInState('failed');
      setClockMessage(t('dash.offlineAction'));
      setClockWarning('');
      resetClockStatusSoon();
      return;
    }

    if (hasActiveShift) {
      await verifyClockOut();
      return;
    }

    if (!navigator.geolocation) {
      setClockInState('failed');
      setClockMessage(
        !window.isSecureContext
          ? `${t('dash.locationUnavailable')} ${t('dash.secureLocationContext')}`
          : t('dash.locationUnavailable')
      );
      setClockWarning('');
      resetClockStatusSoon();
      return;
    }

    if (!window.isSecureContext && !['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)) {
      logClockDebug('[clock-in] geolocation error', { message: t('dash.secureLocationContext') });
    }

    setClockInState('locating');
    setClockMessage(t('dash.locationPermission'));
    setClockWarning('');

    try {
      const coords = await geo.requestCoordinates({
        unavailable: t('dash.locationUnavailable'),
        denied: t('dash.locationDenied'),
      });
      updateClockAccuracyNotice(coords.accuracy);
      await verifyClockIn(coords);
    } catch (error) {
      setClockInState('failed');
      setClockMessage((error as Error).message || t('dash.locationDenied'));
      setClockWarning('');
      resetClockStatusSoon();
    }
  };

  const rosterHeaders = (): Record<string, string> => ({
    'Content-Type': 'application/json',
    'x-employee-id': user.id,
    'x-tenant-id': user.tenantId,
    ...(user.authToken ? { Authorization: `Bearer ${user.authToken}` } : {}),
  });

  useEffect(() => {
    if (!hasAuthenticatedDashboardUser) return;
    let cancelled = false;
    const loadRosterEmployees = async () => {
      try {
        const response = await fetch(apiUrl('/api/roster/employees'), { headers: rosterHeaders() });
        const data = await response.json();
        if (!response.ok || !data.success || cancelled) return;
        const employees = data.employees as RosterEmployee[];
        setRosterEmployees(employees);
        if (!employees.some((employee) => employee.id === selectedRosterEmployeeId)) {
          setSelectedRosterEmployeeId(user.id);
        }
      } catch {
        // The legacy local draft remains available when the API is unavailable.
      }
    };
    void loadRosterEmployees();
    return () => { cancelled = true; };
  }, [hasAuthenticatedDashboardUser, selectedRosterEmployeeId, user.id, user.tenantId, user.authToken]);

  const loadRosterShifts = async () => {
    if (!hasAuthenticatedDashboardUser || !selectedRosterEmployeeId || rosterRange.error) return;
    setRosterLoading(true);
    try {
      const query = new URLSearchParams({ employeeId: selectedRosterEmployeeId, startDate: rosterStartDate, endDate: rosterEndDate });
      const response = await fetch(apiUrl(`/api/roster/shifts?${query.toString()}`), { headers: rosterHeaders() });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to load roster shifts.');
      const shifts = (data.shifts as Array<{ id: string; employee_id: string; start_time: string; end_time: string; notes?: string | null }>).map((shift) => {
        const start = new Date(shift.start_time);
        const end = new Date(shift.end_time);
        return {
          id: shift.id,
          employeeId: shift.employee_id,
          day: start.toLocaleDateString('en-US', { weekday: 'long' }),
          date: toRosterDateKey(start),
          shiftStart: start.toTimeString().slice(0, 5),
          shiftEnd: end.toTimeString().slice(0, 5),
          breakStart: '',
          breakEnd: '',
          type: shift.notes || 'Scheduled',
        };
      });
      setSchedule(shifts);
      setRosterLoaded(true);
      setRosterMessage('');
    } catch (error) {
      setRosterMessage((error as Error).message || 'Unable to load roster shifts.');
    } finally {
      setRosterLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'roster') void loadRosterShifts();
  }, [activeTab, selectedRosterEmployeeId, rosterStartDate, rosterEndDate]);

  useEffect(() => {
    // Legacy drafts are intentionally retained, never merged into server records.
    if (!rosterLoaded) window.localStorage.setItem('horizon-roster', JSON.stringify(schedule));
  }, [rosterLoaded, schedule]);

  useEffect(() => {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    const breakReminderSetting = getNotificationSetting('break_reminders', 'in_app');
    if (!breakReminderSetting.enabled) return;

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
        breakReminderSetting.enabled,
        todaysShift.breakStart,
        'Break starting',
        `Your break starts at ${todaysShift.breakStart}.`,
      );
      scheduleBreakReminder(
        breakReminderSetting.enabled,
        todaysShift.breakEnd,
        'Break ending',
        `Your break ends at ${todaysShift.breakEnd}.`,
      );
    }

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [notificationSettings, schedule]);

  const verifyClockIn = async (coords: DeviceCoordinates) => {
    setClockInState('verifying');
    setClockMessage(t('dash.validatingGeofence'));
    try {
        const res = await fetch(apiUrl('/api/clock-in'), {
            method: 'POST',
            headers: payrollHeaders,
            body: JSON.stringify({
              tenantId: user.tenantId,
              employeeId: user.id,
              latitude: coords.lat,
              longitude: coords.lng,
              accuracy: coords.accuracy,
            })
        });
        const data = await res.json();
        
        if (res.ok && data.success) {
            setClockInState('success');
            setIsClockedIn(true);
            setActiveTimeLogId(data.timeLogId || null);
            setLastClockEvent(`Clocked in at ${new Date(data.clockedIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
            setClockMessage(t('dash.clockInSuccess'));
        } else {
            if (res.status === 409) {
              setClockInState('open_shift_conflict');
              setClockMessage(t('dash.openShiftConflict'));
              await loadClockStatus(true);
            } else {
              setClockInState(res.status === 403 ? 'outside_geofence' : 'failed');
              setClockMessage(
                res.status === 404 ? t('dash.noActiveLocation') :
                res.status === 403 ? t('dash.outsideGeofence') :
                data.error || data.message || t('dash.clockInTryAgain')
              );
            }
        }
    } catch(err) {
        setClockInState('failed');
        setClockMessage(t('dash.clockInTryAgain'));
    }
    
    // Reset state after 4 seconds
    setTimeout(() => {
      setClockInState('idle');
      setClockMessage('');
    }, 4000);
  };

  const verifyClockOut = async () => {
    setClockInState('verifying');
    setClockMessage(t('dash.clockingOut'));

    try {
      const res = await fetch(apiUrl('/api/clock-out'), {
        method: 'POST',
        headers: rosterHeaders(),
        body: JSON.stringify({
          tenantId: user.tenantId,
          employeeId: user.id,
          timeLogId: activeTimeLogId,
        }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setClockInState('clocked_out');
        setIsClockedIn(false);
        setActiveTimeLogId(null);
        setClockWarning('');
        setLastClockAccuracy(null);
        setLastClockEvent(`Clocked out at ${new Date(data.clockedOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
        setClockMessage(t('dash.clockOutSuccess'));
        await loadClockStatus(true);
      } else {
        setClockInState('failed');
        setClockMessage(res.status === 404 ? t('dash.noActiveShift') : data.error || t('dash.clockOutError'));
      }
    } catch {
      setClockInState('failed');
      setClockMessage(t('dash.clockOutError'));
    }

    setTimeout(() => {
      setClockInState('idle');
      setClockMessage('');
    }, 4000);
  };

  const persistRosterShift = async (shift: ShiftRow, overrideCodes: string[] = [], overrideReason = '') => {
    const startTime = new Date(`${shift.date}T${shift.shiftStart}:00`);
    const endTime = new Date(`${shift.date}T${shift.shiftEnd}:00`);
    if (!shift.shiftStart || !shift.shiftEnd || Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime()) || endTime <= startTime) {
      setRosterMessage(t('dash.rosterEndAfterStart'));
      return;
    }
    const localConflict = schedule.some((existing) => {
      if (!existing.id || existing.id === shift.id || !existing.shiftStart || !existing.shiftEnd) return false;
      const existingStart = new Date(`${existing.date}T${existing.shiftStart}:00`);
      const existingEnd = new Date(`${existing.date}T${existing.shiftEnd}:00`);
      return existingStart < endTime && existingEnd > startTime;
    });
    if (localConflict) {
      setRosterMessage(t('dash.rosterShiftOverlap'));
      return;
    }
    try {
      const response = await fetch(apiUrl(shift.id ? `/api/roster/shifts/${shift.id}` : '/api/roster/shifts'), {
        method: shift.id ? 'PATCH' : 'POST',
        headers: payrollHeaders,
        body: JSON.stringify({
          employeeId: selectedRosterEmployeeId,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          notes: shift.type === 'Unscheduled' ? null : shift.type,
          overrideCodes,
          overrideReason,
        }),
      });
      const data = await response.json();
      if (data.requiresConfirmation) {
        setPendingRosterSave({ shift, warnings: data.warnings || [] });
        return;
      }
      if (!response.ok || !data.success) throw new Error(data.error || 'Unable to save roster shift.');
      await loadRosterShifts();
    } catch (error) {
      setRosterMessage((error as Error).message || 'Unable to save roster shift.');
    }
  };

  const updateShift = (date: string, field: keyof ShiftRow, value: string) => {
    const existingShift = schedule.find((shift) => shift.date === date);
    const nextShift = { ...(existingShift || { ...getDefaultShiftForDate(fromRosterDateKey(date) || new Date()), employeeId: selectedRosterEmployeeId }), [field]: value };
    setSchedule((current) => existingShift
      ? current.map((shift) => shift.date === date ? nextShift : shift)
      : [...current, nextShift]);
    if ((field === 'shiftStart' || field === 'shiftEnd') && nextShift.shiftStart && nextShift.shiftEnd) {
      void persistRosterShift(nextShift);
    }
  };

  const setRosterRange = (value: '1' | '2' | '4' | 'custom') => {
    if (value === 'custom') {
      setRosterRangeWeeks('custom');
      setRosterCustomEndDate(toRosterDateKey(addRosterDays(fromRosterDateKey(rosterStartDate) || getWeekStart(new Date()), 6)));
      return;
    }

    setRosterRangeWeeks(Number(value) as 1 | 2 | 4);
  };

  const moveRosterRange = (direction: -1 | 1) => {
    const start = fromRosterDateKey(rosterStartDate) || getWeekStart(new Date());
    const daysToMove = rosterDays.length || 7;
    const nextStart = addRosterDays(start, direction * daysToMove);
    setRosterStartDate(toRosterDateKey(nextStart));

    if (rosterRangeWeeks === 'custom') {
      setRosterCustomEndDate(toRosterDateKey(addRosterDays(nextStart, Math.max(daysToMove - 1, 0))));
    }
  };

  const resetRosterToThisWeek = () => {
    const start = getWeekStart(new Date());
    setRosterStartDate(toRosterDateKey(start));
    setRosterRangeWeeks(1);
    setRosterCustomEndDate(toRosterDateKey(addRosterDays(start, 6)));
  };

  const resignationHeaders = (): Record<string, string> => ({
    'Content-Type': 'application/json',
    'x-employee-id': user.id,
    'x-tenant-id': user.tenantId,
    ...(user.authToken ? { Authorization: `Bearer ${user.authToken}` } : {}),
  });

  const loadResignations = async () => {
    if (!hasAuthenticatedDashboardUser) return;
    setResignationsLoading(true);
    try {
      const ownResponse = await fetch(apiUrl('/api/resignations/me'), { headers: resignationHeaders() });
      const ownData = await ownResponse.json();
      if (!ownResponse.ok) throw new Error(ownData.error || t('dash.resignationLoadError'));
      setMyResignations(ownData.resignations || []);
      if (canReviewResignations) {
        const tenantResponse = await fetch(apiUrl('/api/resignations'), { headers: resignationHeaders() });
        const tenantData = await tenantResponse.json();
        if (!tenantResponse.ok) throw new Error(tenantData.error || t('dash.resignationLoadError'));
        setTenantResignations(tenantData.resignations || []);
      }
    } catch (error) {
      setResignationMessageType('error');
      setResignationMessage(error instanceof Error ? error.message : t('dash.resignationLoadError'));
    } finally {
      setResignationsLoading(false);
    }
  };

  const submitResignation = async () => {
    if (!resignationForm.requestedLastWorkingDay) {
      setResignationMessageType('error');
      setResignationMessage(t('dash.lastWorkingDayRequired'));
      return;
    }
    setResignationSubmitting(true);
    try {
      const response = await fetch(apiUrl('/api/resignations'), {
        method: 'POST', headers: resignationHeaders(), body: JSON.stringify(resignationForm),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t('dash.resignationSubmitError'));
      setResignationMessageType('success');
      setResignationMessage(t('dash.resignationSubmitted'));
      setResignationForm({ requestedLastWorkingDay: '', resignationType: 'voluntary', reason: '' });
      await loadResignations();
      await refreshAttentionCounts();
    } catch (error) {
      setResignationMessageType('error');
      setResignationMessage(error instanceof Error ? error.message : t('dash.resignationSubmitError'));
    } finally {
      setResignationSubmitting(false);
    }
  };

  const updateResignation = async (id: string, path: 'withdraw' | 'review' | 'process', body?: Record<string, string>) => {
    setResignationUpdatingId(id);
    try {
      const response = await fetch(apiUrl(`/api/resignations/${id}/${path}`), {
        method: 'PATCH', headers: resignationHeaders(), body: body ? JSON.stringify(body) : undefined,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t('dash.resignationUpdateError'));
      setResignationMessageType('success');
      setResignationMessage(path === 'withdraw' ? t('dash.resignationWithdrawn') : path === 'process' ? t('dash.resignationProcessed') : body?.status === 'approved' ? t('dash.resignationApproved') : t('dash.resignationRejected'));
      await loadResignations();
      await refreshAttentionCounts();
    } catch (error) {
      setResignationMessageType('error');
      setResignationMessage(error instanceof Error ? error.message : t('dash.resignationUpdateError'));
    } finally {
      setResignationUpdatingId(null);
    }
  };

  const payrollHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-employee-id': user.id,
    'x-tenant-id': user.tenantId,
  };
  if (user.authToken) {
    payrollHeaders.Authorization = `Bearer ${user.authToken}`;
  }

  const handleProfilePhotoSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setProfilePhotoMessageType('error');
      setProfilePhotoMessage(t('profile.unsupportedImage'));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setProfilePhotoMessageType('error');
      setProfilePhotoMessage(t('profile.imageTooLarge'));
      return;
    }
    setProfilePhotoMessage('');
    setProfilePhotoFile(file);
  };

  const uploadProfilePhoto = async (blob: Blob) => {
    if (isOffline || profilePhotoSaving) return;
    setProfilePhotoSaving(true);
    setProfilePhotoMessage('');
    const body = new FormData();
    body.append('avatar', blob, 'profile-photo.webp');
    const headers: Record<string, string> = {
      'x-employee-id': user.id,
      'x-tenant-id': user.tenantId,
    };
    if (user.authToken) headers.Authorization = `Bearer ${user.authToken}`;

    try {
      const response = await fetch(apiUrl('/api/profile/avatar'), { method: 'POST', headers, body });
      const data = await response.json();
      if (!response.ok || !data.success) {
        const message = data.code === 'IMAGE_TOO_LARGE'
          ? t('profile.imageTooLarge')
          : data.code === 'UNSUPPORTED_IMAGE'
            ? t('profile.unsupportedImage')
            : t('profile.couldNotProcessImage');
        throw new Error(message);
      }
      onUserUpdate({ ...user, profileImageUrl: data.profileImageUrl });
      setProfilePhotoFile(null);
      setProfilePhotoMessageType('success');
      setProfilePhotoMessage(t('profile.photoUpdated'));
    } catch (error) {
      setProfilePhotoMessageType('error');
      setProfilePhotoMessage(error instanceof Error ? error.message : t('profile.couldNotProcessImage'));
    } finally {
      setProfilePhotoSaving(false);
    }
  };

  const removeProfilePhoto = async () => {
    if (isOffline || profilePhotoSaving || !user.profileImageUrl) return;
    setProfilePhotoSaving(true);
    setProfilePhotoMessage('');
    try {
      const response = await fetch(apiUrl('/api/profile/avatar'), { method: 'DELETE', headers: payrollHeaders });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(t('profile.couldNotProcessImage'));
      onUserUpdate({ ...user, profileImageUrl: null });
      setProfilePhotoMessageType('success');
      setProfilePhotoMessage(t('profile.photoRemoved'));
    } catch (error) {
      setProfilePhotoMessageType('error');
      setProfilePhotoMessage(error instanceof Error ? error.message : t('profile.couldNotProcessImage'));
    } finally {
      setProfilePhotoSaving(false);
    }
  };

  const loadClockStatus = async (preserveLastEvent = false) => {
    if (!hasAuthenticatedDashboardUser) return;

    try {
      const res = await fetch(apiUrl('/api/clock-status'), { headers: payrollHeaders });
      const data = await res.json();

      if (res.ok && data.success) {
        const nextIsClockedIn = Boolean(data.isClockedIn);
        setIsClockedIn(nextIsClockedIn);
        setActiveTimeLogId(data.timeLogId || null);
        if (data.clockedIn) {
          setLastClockEvent(`Clocked in at ${new Date(data.clockedIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
        } else if (!preserveLastEvent) {
          setLastClockEvent('No active shift recorded.');
        }
        if (!nextIsClockedIn) {
          setClockWarning('');
          setLastClockAccuracy(null);
        }
      }
    } catch {
      // Clock status is best-effort; explicit clock actions still show errors.
    }
  };

  useEffect(() => {
    loadClockStatus();
  }, [hasAuthenticatedDashboardUser, user.id, user.tenantId]);

  const canManageGrievances = user.role === 'hr_admin' || user.role === 'manager';

  const loadBreakRequests = async (clearMessage = true) => {
    if (!hasAuthenticatedDashboardUser) return;
    if (!canViewOwnBreakRequests && !canReviewBreakRequests) return;

    setBreakRequestsLoading(true);
    if (clearMessage) setBreakRequestMessage('');

    try {
      if (canViewOwnBreakRequests) {
        const ownResponse = await fetch(apiUrl('/api/break-requests/me'), { headers: payrollHeaders });
        const ownData = await ownResponse.json();

        if (!ownResponse.ok || !ownData.success) {
          throw new Error(ownData.error || t('dash.breakLoadError'));
        }

        setBreakRequests(ownData.breakRequests || []);
      }

      if (canReviewBreakRequests) {
        const pendingResponse = await fetch(apiUrl('/api/break-requests/pending'), { headers: payrollHeaders });
        const pendingData = await pendingResponse.json();

        if (!pendingResponse.ok || !pendingData.success) {
          throw new Error(pendingData.error || t('dash.breakPendingLoadError'));
        }

        setPendingBreakRequests(pendingData.breakRequests || []);
      } else {
        setPendingBreakRequests([]);
      }
    } catch (error) {
      setBreakRequestMessageType('error');
      setBreakRequestMessage(error instanceof Error ? error.message : t('dash.breakLoadServerError'));
    } finally {
      setBreakRequestsLoading(false);
    }
  };

  const submitBreakRequest = async () => {
    if (isOffline) {
      setBreakRequestMessageType('error');
      setBreakRequestMessage('You are offline. Some HR actions require connection.');
      return;
    }

    if (breakRequestSubmitting || pendingOwnBreakRequest) return;

    const selectedDuration = breakRequestForm.durationMinutes === 'custom'
      ? Number(breakRequestForm.customDuration)
      : Number(breakRequestForm.durationMinutes);

    if (!Number.isInteger(selectedDuration) || selectedDuration < 5 || selectedDuration > 180) {
      setBreakRequestMessageType('error');
      setBreakRequestMessage(t('dash.breakDurationError'));
      return;
    }

    setBreakRequestSubmitting(true);
    setBreakRequestMessage('');

    try {
      const res = await fetch(apiUrl('/api/break-requests'), {
        method: 'POST',
        headers: payrollHeaders,
        body: JSON.stringify({
          requestedStartTime: new Date().toISOString(),
          durationMinutes: selectedDuration,
          reason: breakRequestForm.reason,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || t('dash.breakRequestError'));
      }

      setBreakRequestForm(defaultBreakRequestForm);
      setBreakRequestMessageType('success');
      setBreakRequestMessage(t('dash.breakRequestSent'));
      await loadBreakRequests(false);
      await refreshAttentionCounts();
    } catch (error) {
      setBreakRequestMessageType('error');
      setBreakRequestMessage(error instanceof Error ? error.message : t('dash.breakRequestServerError'));
    } finally {
      setBreakRequestSubmitting(false);
    }
  };

  const cancelBreakRequest = async (requestId: string) => {
    if (isOffline) {
      setBreakRequestMessageType('error');
      setBreakRequestMessage('You are offline. Some HR actions require connection.');
      return;
    }

    setBreakRequestReviewingId(requestId);
    setBreakRequestMessage('');

    try {
      const res = await fetch(apiUrl(`/api/break-requests/${requestId}/cancel`), {
        method: 'PATCH',
        headers: payrollHeaders,
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || t('dash.breakCancelError'));
      }

      setBreakRequestMessageType('success');
      setBreakRequestMessage(t('dash.breakCancelled'));
      await loadBreakRequests(false);
      await refreshAttentionCounts();
    } catch (error) {
      setBreakRequestMessageType('error');
      setBreakRequestMessage(error instanceof Error ? error.message : t('dash.breakCancelServerError'));
    } finally {
      setBreakRequestReviewingId(null);
    }
  };

  const reviewBreakRequest = async (requestId: string, status: 'approved' | 'rejected') => {
    if (isOffline) {
      setBreakRequestMessageType('error');
      setBreakRequestMessage('You are offline. Some HR actions require connection.');
      return;
    }

    setBreakRequestReviewingId(requestId);
    setBreakRequestMessage('');

    try {
      const res = await fetch(apiUrl(`/api/break-requests/${requestId}/review`), {
        method: 'PATCH',
        headers: payrollHeaders,
        body: JSON.stringify({
          status,
          reviewNote: breakReviewNotes[requestId] || null,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || t('dash.breakReviewError'));
      }

      setBreakReviewNotes((current) => {
        const next = { ...current };
        delete next[requestId];
        return next;
      });
      setBreakRequestMessageType('success');
      setBreakRequestMessage(`Break request ${status}.`);
      await loadBreakRequests(false);
      await refreshAttentionCounts();
    } catch (error) {
      setBreakRequestMessageType('error');
      setBreakRequestMessage(error instanceof Error ? error.message : t('dash.breakReviewServerError'));
    } finally {
      setBreakRequestReviewingId(null);
    }
  };

  const loadPasskeys = async (clearMessage = true) => {
    if (!hasAuthenticatedDashboardUser) return;

    setPasskeysLoading(true);
    if (clearMessage) setPasskeyMessage('');

    try {
      const res = await fetch(apiUrl('/api/auth/passkeys'), { headers: payrollHeaders });
      const data = await res.json();

      if (res.ok && data.success) {
        setPasskeys(data.passkeys || []);
      } else {
        setPasskeyMessageType('error');
        setPasskeyMessage(data.error || t('dash.passkeyLoadError'));
      }
    } catch {
      setPasskeyMessageType('error');
      setPasskeyMessage(t('dash.passkeyLoadServerError'));
    } finally {
      setPasskeysLoading(false);
    }
  };

  const addPasskey = async () => {
    if (isOffline) {
      setPasskeyMessageType('error');
      setPasskeyMessage('You are offline. Some HR actions require connection.');
      return;
    }

    if (!window.PublicKeyCredential) {
      setPasskeyMessageType('error');
      setPasskeyMessage(t('dash.passkeyUnsupported'));
      return;
    }

    setPasskeySaving(true);
    setPasskeyMessage('');

    try {
      const { startRegistration } = await import('@simplewebauthn/browser');
      const optionsResponse = await fetch(apiUrl('/api/auth/passkeys/register/options'), {
        method: 'POST',
        headers: payrollHeaders,
      });
      const optionsData = await optionsResponse.json();

      if (!optionsResponse.ok || !optionsData.success) {
        throw new Error(optionsData.error || t('dash.passkeyStartError'));
      }

      const credential = await startRegistration({ optionsJSON: optionsData.options });
      const verifyResponse = await fetch(apiUrl('/api/auth/passkeys/register/verify'), {
        method: 'POST',
        headers: payrollHeaders,
        body: JSON.stringify({
          credential,
          deviceLabel: 'Platform passkey',
        }),
      });
      const verifyData = await verifyResponse.json();

      if (!verifyResponse.ok || !verifyData.success) {
        throw new Error(verifyData.error || t('dash.passkeySaveError'));
      }

      setPasskeyMessageType('success');
      setPasskeyMessage(t('dash.passkeyAdded'));
      await loadPasskeys(false);
    } catch (error) {
      setPasskeyMessageType('error');
      const message = error instanceof Error ? error.message : '';
      setPasskeyMessage(/webauthn|relying party|not configured|origin/i.test(message)
        ? t('dash.passkeyNotConfigured')
        : message || t('dash.passkeyAddError'));
    } finally {
      setPasskeySaving(false);
    }
  };

  const loadRoleManagement = async () => {
    if (!canManageRoles) return;

    setRolesLoading(true);
    setRoleMessage('');

    try {
      const [rolesResponse, permissionsResponse, employeesResponse] = await Promise.all([
        fetch(apiUrl('/api/roles'), { headers: payrollHeaders }),
        fetch(apiUrl('/api/permissions'), { headers: payrollHeaders }),
        fetch(apiUrl('/api/employees/role-assignments'), { headers: payrollHeaders }),
      ]);
      const rolesData = await rolesResponse.json();
      const permissionsData = await permissionsResponse.json();
      const employeesData = await employeesResponse.json();

      if (!rolesResponse.ok || !rolesData.success) {
        throw new Error(rolesData.error || t('dash.roleLoadError'));
      }
      if (!permissionsResponse.ok || !permissionsData.success) {
        throw new Error(permissionsData.error || t('dash.roleLoadError'));
      }
      if (!employeesResponse.ok || !employeesData.success) {
        throw new Error(employeesData.error || t('dash.roleLoadError'));
      }

      setTenantRoles(rolesData.roles || []);
      setTenantPermissions(permissionsData.permissions || []);
      setRoleEmployees(employeesData.employees || []);
      setTitleDrafts((employeesData.employees || []).reduce((drafts: TitleDrafts, employee: RoleAssignmentEmployee) => ({
        ...drafts,
        [employee.id]: employee.job_title || '',
      }), {}));
    } catch (error) {
      setRoleMessageType('error');
      setRoleMessage(error instanceof Error ? error.message : t('dash.roleLoadError'));
    } finally {
      setRolesLoading(false);
    }
  };

  const toggleRolePermission = (permissionKey: string) => {
    setRoleForm((current) => ({
      ...current,
      permissionKeys: current.permissionKeys.includes(permissionKey)
        ? current.permissionKeys.filter((key) => key !== permissionKey)
        : [...current.permissionKeys, permissionKey],
    }));
  };

  const createTenantRole = async () => {
    if (isOffline) {
      setRoleMessageType('error');
      setRoleMessage('You are offline. Some HR actions require connection.');
      return;
    }

    if (roleSaving) return;

    setRoleSaving(true);
    setRoleMessage('');

    try {
      const res = await fetch(apiUrl('/api/roles'), {
        method: 'POST',
        headers: payrollHeaders,
        body: JSON.stringify(roleForm),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setRoleForm(defaultRoleForm);
        await loadRoleManagement();
        setRoleMessageType('success');
        setRoleMessage(t('dash.roleCreated'));
      } else {
        setRoleMessageType('error');
        setRoleMessage(data.error || t('dash.roleCreateError'));
      }
    } catch {
      setRoleMessageType('error');
      setRoleMessage(t('dash.roleCreateError'));
    } finally {
      setRoleSaving(false);
    }
  };

  const assignEmployeeRole = async (employeeId: string, roleId: string) => {
    if (isOffline) {
      setRoleMessageType('error');
      setRoleMessage('You are offline. Some HR actions require connection.');
      return;
    }

    if (!roleId || roleUpdatingEmployeeId) return;

    setRoleUpdatingEmployeeId(employeeId);
    setRoleMessage('');

    try {
      const res = await fetch(apiUrl(`/api/employees/${employeeId}/roles`), {
        method: 'POST',
        headers: payrollHeaders,
        body: JSON.stringify({ roleId }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        await loadRoleManagement();
        setRoleMessageType('success');
        setRoleMessage(t('dash.roleAssigned'));
      } else {
        setRoleMessageType('error');
        setRoleMessage(data.error || t('dash.roleAssignError'));
      }
    } catch {
      setRoleMessageType('error');
      setRoleMessage(t('dash.roleAssignError'));
    } finally {
      setRoleUpdatingEmployeeId(null);
    }
  };

  const saveEmployeeTitle = async (employeeId: string) => {
    if (isOffline) {
      setRoleMessageType('error');
      setRoleMessage('You are offline. Some HR actions require connection.');
      return;
    }

    if (roleUpdatingEmployeeId) return;

    setRoleUpdatingEmployeeId(employeeId);
    setRoleMessage('');

    try {
      const res = await fetch(apiUrl(`/api/employees/${employeeId}/title`), {
        method: 'PATCH',
        headers: payrollHeaders,
        body: JSON.stringify({ jobTitle: titleDrafts[employeeId] || null }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        await loadRoleManagement();
        setRoleMessageType('success');
        setRoleMessage(t('dash.titleUpdated'));
      } else {
        setRoleMessageType('error');
        setRoleMessage(data.error || t('dash.titleUpdateError'));
      }
    } catch {
      setRoleMessageType('error');
      setRoleMessage(t('dash.titleUpdateError'));
    } finally {
      setRoleUpdatingEmployeeId(null);
    }
  };

  const loadPayrollRecords = async (clearMessage = true) => {
    if (!canViewAllPayroll && !canViewOwnPayroll) {
      setPayrollRecords([]);
      return;
    }

    setPayrollLoading(true);
    if (clearMessage) {
      setPayrollMessage('');
      setSkippedPayrollEmployees([]);
    }

    try {
      const endpoint = canViewAllPayroll ? '/api/payroll' : '/api/payroll/me';
      const res = await fetch(apiUrl(endpoint), { headers: payrollHeaders });
      const data = await res.json();

      if (res.ok && data.success) {
        setPayrollRecords(data.payroll || []);
      } else {
        setPayrollMessageType('error');
        setPayrollMessage(data.error || t('dash.payrollLoadError'));
      }
    } catch {
      setPayrollMessageType('error');
      setPayrollMessage(t('dash.payrollLoadServerError'));
    } finally {
      setPayrollLoading(false);
    }
  };

  const loadCompensationProfiles = async () => {
    if (!canManageCompensation) return;

    setCompensationLoading(true);

    try {
      const res = await fetch(apiUrl('/api/compensation-profiles'), { headers: payrollHeaders });
      const data = await res.json();

      if (res.ok && data.success) {
        const profiles = data.profiles || [];
        setCompensationProfiles(profiles);
        setCompensationForm((current) => {
          if (current.employeeId || profiles.length === 0) return current;
          const firstProfile = profiles[0] as CompensationProfile;
          return {
            employeeId: firstProfile.employee_id,
            payType: firstProfile.pay_type || 'monthly',
            baseAmount: firstProfile.base_amount !== null && firstProfile.base_amount !== undefined ? String(firstProfile.base_amount) : '',
            currency: firstProfile.currency || '',
            effectiveFrom: new Date().toISOString().slice(0, 10),
          };
        });
      } else {
        setPayrollMessageType('error');
        setPayrollMessage(data.error || t('dash.compensationLoadError'));
      }
    } catch {
      setPayrollMessageType('error');
      setPayrollMessage(t('dash.compensationLoadServerError'));
    } finally {
      setCompensationLoading(false);
    }
  };

  const loadEmployeeLoans = async () => {
    if (!canManageLoans && !canViewOwnLoans) {
      setEmployeeLoans([]);
      return;
    }

    setLoanLoading(true);

    try {
      const endpoint = canManageLoans ? '/api/employee-loans' : '/api/employee-loans/me';
      const res = await fetch(apiUrl(endpoint), { headers: payrollHeaders });
      const data = await res.json();

      if (res.ok && data.success) {
        setEmployeeLoans(data.loans || []);
        setLoanForm((current) => {
          if (current.employeeId || !canManageLoans || compensationProfiles.length === 0) return current;
          return { ...current, employeeId: compensationProfiles[0].employee_id };
        });
      } else {
        setPayrollMessageType('error');
        setPayrollMessage(data.error || t('dash.loanLoadError'));
      }
    } catch {
      setPayrollMessageType('error');
      setPayrollMessage(t('dash.loanLoadServerError'));
    } finally {
      setLoanLoading(false);
    }
  };

  const updatePayrollForm = (field: keyof PayrollFormState, value: string) => {
    setPayrollForm((current) => ({ ...current, [field]: value }));
  };

  const selectCompensationEmployee = (employeeId: string) => {
    const profile = compensationProfiles.find((item) => item.employee_id === employeeId);

    setCompensationForm({
      employeeId,
      payType: profile?.pay_type || 'monthly',
      baseAmount: profile?.base_amount !== null && profile?.base_amount !== undefined ? String(profile.base_amount) : '',
      currency: profile?.currency || '',
      effectiveFrom: new Date().toISOString().slice(0, 10),
    });
  };

  const updateCompensationForm = (field: keyof CompensationFormState, value: string) => {
    setCompensationForm((current) => ({ ...current, [field]: value }));
  };

  const updateLoanForm = (field: keyof LoanFormState, value: string) => {
    setLoanForm((current) => ({ ...current, [field]: value }));
  };

  const saveCompensationProfile = async () => {
    if (isOffline) {
      setPayrollMessageType('error');
      setPayrollMessage(t('dash.offlineActionMessage'));
      return;
    }

    if (compensationSaving || !compensationForm.employeeId || !canManageCompensation) return;

    setCompensationSaving(true);
    setPayrollMessage('');

    try {
      const res = await fetch(apiUrl(`/api/compensation-profiles/${compensationForm.employeeId}`), {
        method: 'PUT',
        headers: payrollHeaders,
        body: JSON.stringify({
          payType: compensationForm.payType,
          baseAmount: Number(compensationForm.baseAmount),
          currency: compensationForm.currency || undefined,
          effectiveFrom: compensationForm.effectiveFrom || undefined,
        }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        await loadCompensationProfiles();
        setPayrollMessageType('success');
        setPayrollMessage(t('dash.compensationSaved'));
      } else {
        setPayrollMessageType('error');
        setPayrollMessage(data.error || t('dash.compensationSaveError'));
      }
    } catch {
      setPayrollMessageType('error');
      setPayrollMessage(t('dash.compensationSaveServerError'));
    } finally {
      setCompensationSaving(false);
    }
  };

  const createEmployeeLoan = async () => {
    if (isOffline) {
      setPayrollMessageType('error');
      setPayrollMessage(t('dash.offlineActionMessage'));
      return;
    }

    if (loanSaving || !loanForm.employeeId || !canManageLoans) return;

    setLoanSaving(true);
    setPayrollMessage('');

    try {
      const res = await fetch(apiUrl('/api/employee-loans'), {
        method: 'POST',
        headers: payrollHeaders,
        body: JSON.stringify({
          employeeId: loanForm.employeeId,
          loanName: loanForm.loanName || undefined,
          principalAmount: Number(loanForm.principalAmount),
          repaymentAmount: Number(loanForm.repaymentAmount),
          currency: loanForm.currency || undefined,
          repaymentFrequency: loanForm.repaymentFrequency,
          dueDate: loanForm.dueDate || null,
        }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        await loadEmployeeLoans();
        await refreshAttentionCounts();
        setLoanForm((current) => ({
          ...defaultLoanForm,
          employeeId: current.employeeId,
          currency: current.currency,
          repaymentFrequency: current.repaymentFrequency,
        }));
        setPayrollMessageType('success');
        setPayrollMessage(t('dash.employeeLoanCreated'));
      } else {
        setPayrollMessageType('error');
        setPayrollMessage(data.error || t('dash.employeeLoanCreateError'));
      }
    } catch {
      setPayrollMessageType('error');
      setPayrollMessage(t('dash.employeeLoanCreateServerError'));
    } finally {
      setLoanSaving(false);
    }
  };

  const updateEmployeeLoanStatus = async (loanId: string, status: LoanStatus) => {
    if (isOffline) {
      setPayrollMessageType('error');
      setPayrollMessage(t('dash.offlineActionMessage'));
      return;
    }

    if (loanUpdatingId || !canManageLoans) return;

    setLoanUpdatingId(loanId);
    setPayrollMessage('');

    try {
      const res = await fetch(apiUrl(`/api/employee-loans/${loanId}/status`), {
        method: 'PATCH',
        headers: payrollHeaders,
        body: JSON.stringify({ status }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        await loadEmployeeLoans();
        await refreshAttentionCounts();
        setPayrollMessageType('success');
        setPayrollMessage(t('dash.loanStatusUpdated'));
      } else {
        setPayrollMessageType('error');
        setPayrollMessage(data.error || t('dash.loanStatusUpdateError'));
      }
    } catch {
      setPayrollMessageType('error');
      setPayrollMessage(t('dash.loanStatusUpdateServerError'));
    } finally {
      setLoanUpdatingId(null);
    }
  };

  const updatePayrollStatus = async (recordId: string, status: PayrollStatus) => {
    if (isOffline) {
      setPayrollMessageType('error');
      setPayrollMessage(t('dash.offlineActionMessage'));
      return;
    }

    if (payrollStatusUpdatingId) return;
    if (status === 'paid' && !canMarkPayrollPaid) return;
    if ((status === 'approved' || status === 'cancelled') && !canApprovePayroll) return;

    setPayrollStatusUpdatingId(recordId);
    setPayrollMessage('');

    try {
      const res = await fetch(apiUrl(`/api/payroll/${recordId}/status`), {
        method: 'PATCH',
        headers: payrollHeaders,
        body: JSON.stringify({ status }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        await loadPayrollRecords(false);
        await refreshAttentionCounts();
        setPayrollMessageType('success');
        setPayrollMessage(`${t('dash.payrollStatusUpdated')} ${displayEnum(status)}.`);
      } else {
        setPayrollMessageType('error');
        setPayrollMessage(data.error || t('dash.payrollStatusUpdateError'));
      }
    } catch {
      setPayrollMessageType('error');
      setPayrollMessage(t('dash.payrollStatusUpdateServerError'));
    } finally {
      setPayrollStatusUpdatingId(null);
    }
  };

  const runPayroll = async () => {
    if (isOffline) {
      setPayrollMessageType('error');
      setPayrollMessage(t('dash.offlineActionMessage'));
      return;
    }

    if (payrollSubmitting || !canRunPayroll) return;

    if (!payrollForm.payPeriodStart || !payrollForm.payPeriodEnd || payrollForm.payPeriodEnd <= payrollForm.payPeriodStart) {
      setPayrollMessageType('error');
      setPayrollMessage(t('dash.payrollPeriodError'));
      return;
    }

    setPayrollSubmitting(true);
    setPayrollMessage('');
    setSkippedPayrollEmployees([]);
    setLoanDeductionsApplied(0);

    const payrollPayload: {
      payPeriodStart: string;
      payPeriodEnd: string;
      defaultBaseSalary?: number;
      bonuses: number;
      deductions: number;
    } = {
      payPeriodStart: payrollForm.payPeriodStart,
      payPeriodEnd: payrollForm.payPeriodEnd,
      bonuses: Number(payrollForm.bonuses || 0),
      deductions: Number(payrollForm.deductions || 0),
    };

    if (payrollForm.defaultBaseSalary.trim()) {
      payrollPayload.defaultBaseSalary = Number(payrollForm.defaultBaseSalary);
    }

    try {
      const res = await fetch(apiUrl('/api/payroll/run'), {
        method: 'POST',
        headers: payrollHeaders,
        body: JSON.stringify(payrollPayload),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        await loadPayrollRecords(false);
        await loadEmployeeLoans();
        await refreshAttentionCounts();
        setSkippedPayrollEmployees(data.skippedEmployees || []);
        setLoanDeductionsApplied(Number(data.loanDeductionsApplied || 0));
        setPayrollMessageType('success');
        setPayrollMessage(`${t('dash.payrollRunComplete')} ${data.recordsGenerated}`);
      } else {
        setPayrollMessageType('error');
        setPayrollMessage(data.error || t('dash.payrollRunError'));
      }
    } catch {
      setPayrollMessageType('error');
      setPayrollMessage(t('dash.payrollRunServerError'));
    } finally {
      setPayrollSubmitting(false);
    }
  };

  const exportPayrollPdf = async (recordId: string) => {
    if (isOffline) {
      setPayrollMessageType('error');
      setPayrollMessage(t('dash.offlineActionMessage'));
      return;
    }

    if (payrollExportingId || !canExportPayrollPdf) return;

    setPayrollExportingId(recordId);
    setPayrollMessage('');

    try {
      const res = await fetch(apiUrl(`/api/payroll/${recordId}/pdf`), {
        headers: payrollHeaders,
      });

      if (!res.ok) {
        let errorMessage = t('dash.payrollExportError');
        try {
          const data = await res.json();
          errorMessage = data.error || errorMessage;
        } catch {
          // PDF responses are binary; failed responses may still be plain text.
        }
        throw new Error(errorMessage);
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const disposition = res.headers.get('Content-Disposition') || '';
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/i);
      const link = document.createElement('a');

      link.href = url;
      link.download = filenameMatch?.[1] || `payroll-${recordId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      setPayrollMessageType('error');
      setPayrollMessage(error instanceof Error ? error.message : t('dash.payrollExportError'));
    } finally {
      setPayrollExportingId(null);
    }
  };

  useEffect(() => {
    if (activeTab === 'profile' && showPayrollPanel) {
      loadPayrollRecords();
      loadCompensationProfiles();
      loadEmployeeLoans();
    }
  }, [activeTab, showPayrollPanel, user.id, user.role, user.tenantId]);

  useEffect(() => {
    if (activeTab === 'profile' && !showPayrollPanel && !showGrievancesPanel && canManageRoles) {
      loadRoleManagement();
    }
  }, [activeTab, showPayrollPanel, showGrievancesPanel, canManageRoles, user.id, user.tenantId]);

  useEffect(() => {
    if (hasAuthenticatedDashboardUser && activeTab === 'profile' && !showPayrollPanel && !showGrievancesPanel) {
      loadNotificationSettings();
    }
  }, [activeTab, showPayrollPanel, showGrievancesPanel, hasAuthenticatedDashboardUser, user.id, user.tenantId]);

  useEffect(() => {
    if (hasAuthenticatedDashboardUser && activeTab === 'geofence') {
      loadBreakRequests(false);
    }
  }, [activeTab, hasAuthenticatedDashboardUser, user.id, user.role, user.tenantId]);

  useEffect(() => {
    if (!showControlCenter) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowControlCenter(false);
      }
    };

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [showControlCenter]);

  useEffect(() => {
    if (showControlCenter && hasAuthenticatedDashboardUser) {
      loadNotificationSettings(false);
      loadPasskeys(false);
    }
  }, [showControlCenter, hasAuthenticatedDashboardUser, user.id, user.tenantId]);

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
        setGrievanceMessage(myData.error || t('dash.grievanceLoadError'));
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
          setGrievanceMessage(tenantData.error || t('dash.tenantGrievanceLoadError'));
          return;
        }

        setTenantGrievances(tenantData.grievances || []);
      } else {
        setTenantGrievances([]);
      }
    } catch {
      setGrievanceMessageType('error');
      setGrievanceMessage(t('dash.grievanceLoadServerError'));
    } finally {
      setGrievanceLoading(false);
      setTenantGrievanceLoading(false);
    }
  };

  const updateGrievanceForm = (field: keyof GrievanceFormState, value: string) => {
    setGrievanceForm((current) => ({ ...current, [field]: value as GrievancePriority }));
  };

  const openLeaveRequestFlow = () => {
    setActiveTab('profile');
    setShowPayrollPanel(false);
    setShowGrievancesPanel(true);
    setShowResignationsPanel(false);
    setGrievanceMessageType('success');
    setGrievanceMessage(t('dash.leaveRequestOpened'));
    setGrievanceForm({
      title: t('enum.leaveRequest'),
      category: 'leave_request',
      priority: 'normal',
      description: '',
    });
  };

  const submitGrievance = async () => {
    if (isOffline) {
      setGrievanceMessageType('error');
      setGrievanceMessage('You are offline. Some HR actions require connection.');
      return;
    }

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
        await refreshAttentionCounts();
        setGrievanceMessageType('success');
        setGrievanceMessage(t('dash.grievanceFiled'));
      } else {
        setGrievanceMessageType('error');
        setGrievanceMessage(data.error || t('dash.grievanceFileError'));
      }
    } catch {
      setGrievanceMessageType('error');
      setGrievanceMessage(t('dash.grievanceFileServerError'));
    } finally {
      setGrievanceSubmitting(false);
    }
  };

  const updateGrievanceStatus = async (grievanceId: string, status: GrievanceStatus) => {
    if (isOffline) {
      setGrievanceMessageType('error');
      setGrievanceMessage('You are offline. Some HR actions require connection.');
      return;
    }

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
        await refreshAttentionCounts();
        setGrievanceMessageType('success');
        setGrievanceMessage(t('dash.grievanceStatusUpdated'));
      } else {
        setGrievanceMessageType('error');
        setGrievanceMessage(data.error || t('dash.grievanceStatusUpdateError'));
      }
    } catch {
      setGrievanceMessageType('error');
      setGrievanceMessage(t('dash.grievanceStatusUpdateServerError'));
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
        setFeedMessage(data.error || t('dash.feedLoadError'));
      }
    } catch {
      setFeedMessageType('error');
      setFeedMessage(t('dash.feedLoadServerError'));
    } finally {
      setFeedLoading(false);
    }
  };

  const loadAdminFeed = async () => {
    if (!canPublishFeed) return;

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

  const updateFeedContent = (payload: { json: unknown; text: string }) => {
    setFeedForm((current) => ({
      ...current,
      contentText: payload.text,
      contentJson: payload.json,
    }));
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
    if (isOffline) {
      setFeedMessageType('error');
      setFeedMessage('You are offline. Some HR actions require connection.');
      return;
    }

    if (feedSubmitting || !feedForm.title.trim() || !feedForm.contentText.trim()) return;

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
          contentJson: feedForm.contentJson,
          status: feedForm.status,
          visibility: getFeedVisibilityPayload(),
        }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setFeedForm(defaultFeedForm);
        setFeedEditorKey((current) => current + 1);
        await Promise.all([loadFeed(false), loadAdminFeed()]);
        setFeedMessageType('success');
        setFeedMessage(feedForm.status === 'published' ? t('dash.postPublished') : t('dash.draftSaved'));
      } else {
        setFeedMessageType('error');
        setFeedMessage(data.error || t('dash.feedSaveError'));
      }
    } catch {
      setFeedMessageType('error');
      setFeedMessage(t('dash.feedSaveServerError'));
    } finally {
      setFeedSubmitting(false);
    }
  };

  const updateFeedStatus = async (postId: string, status: FeedPostStatus) => {
    if (isOffline) {
      setFeedMessageType('error');
      setFeedMessage('You are offline. Some HR actions require connection.');
      return;
    }

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
        setFeedMessage(t('dash.postStatusUpdated'));
      } else {
        setFeedMessageType('error');
        setFeedMessage(data.error || t('dash.postStatusUpdateError'));
      }
    } catch {
      setFeedMessageType('error');
      setFeedMessage(t('dash.postStatusUpdateServerError'));
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
          setLocationsMessage(data.error || t('dash.locationsLoadError'));
        }
      } catch {
        setLocationsMessage(t('dash.locationsLoadError'));
      }
    };

    loadCompanyLocations();
  }, [user.id, user.tenantId]);

  const renderControlCenterAccordion = (
    section: keyof typeof controlCenterSections,
    title: string,
    summary: string,
    content: ReactNode,
    badge?: ReactNode,
  ) => {
    const isOpen = controlCenterSections[section];
    const contentId = `stanza-control-center-${section}`;

    return (
      <section className="border-b border-emerald-500/15 last:border-b-0">
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={contentId}
          aria-label={`${isOpen ? t('dash.collapse') : t('dash.expand')} ${title}`}
          onClick={() => setControlCenterSections((current) => ({ ...current, [section]: !current[section] }))}
          className={cn(
            "flex w-full items-center justify-between gap-3 px-1 py-3 text-left outline-none transition-colors hover:text-emerald-600 focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#061411] dark:hover:text-emerald-300",
            isRtl && "text-right"
          )}
        >
          <span className="min-w-0">
            <span className="block text-sm font-bold uppercase tracking-widest text-slate-800 dark:text-slate-200">{title}</span>
            <span className="mt-1 block truncate text-xs font-normal normal-case tracking-normal text-neutral-500 dark:text-emerald-100/50">{summary}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {badge}
            <ChevronDown className={cn("h-4 w-4 text-emerald-500 transition-transform duration-200 motion-reduce:transition-none", isOpen && "rotate-180")} />
          </span>
        </button>
        <div
          id={contentId}
          className={cn(
            "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
            isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
          )}
        >
          <div className="overflow-hidden">
            <div className="pb-3 pt-1">{content}</div>
          </div>
        </div>
      </section>
    );
  };

  const renderNotificationSettingsPanel = () => (
    <div className="rounded-xl border border-emerald-500/15 bg-white/70 p-4 dark:border-emerald-500/15 dark:bg-black/35">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-slate-800 dark:text-slate-200">
            <Bell className="h-4 w-4 text-emerald-500" />
            {t('dash.notificationSettings')}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {t('dash.notificationSettingsSubtitle')}
          </p>
        </div>

        <button
          type="button"
          onClick={() => loadNotificationSettings()}
          disabled={isOffline || notificationLoading || notificationSaving}
          className="rounded-lg border border-emerald-200 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-emerald-700 transition hover:border-emerald-400 disabled:cursor-wait disabled:opacity-60 dark:border-emerald-500/20 dark:text-emerald-300"
        >
          {notificationLoading ? t('dash.loading') : t('dash.refresh')}
        </button>
      </div>

      <p className="mt-3 rounded-lg border border-emerald-500/15 bg-emerald-500/5 px-3 py-2 text-[11px] text-neutral-600 dark:text-emerald-100/55">
        {t('dash.notificationDeliveryReady')}
      </p>
      <p className="mt-2 flex gap-2 text-[10px] leading-4 text-neutral-500 dark:text-emerald-100/45">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
        {t('demo.notifications')}
      </p>

      {notificationMessage && (
        <p className={cn(
          "mt-3 rounded-lg border px-3 py-2 text-xs font-semibold",
          notificationMessageType === 'success'
            ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300"
            : "border-red-200 bg-red-50 text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300"
        )}>
          {notificationMessage}
        </p>
      )}

      <div className="mt-4 overflow-x-auto rounded-xl border border-emerald-500/15">
        <div className="grid grid-cols-[minmax(180px,1fr)_repeat(3,minmax(64px,86px))] gap-0 border-b border-emerald-500/15 bg-white/70 text-[10px] font-black uppercase tracking-widest text-neutral-500 dark:bg-black/35 dark:text-emerald-100/45">
          <div className="p-3">{t('dash.category')}</div>
          {notificationChannels.map((channel) => (
            <div key={channel.key} className="p-3 text-center">{displayNotificationChannel(channel.key)}</div>
          ))}
        </div>

        <div className="divide-y divide-emerald-500/10">
          {notificationCategories.map((category) => (
            <div key={category.key} className="grid grid-cols-[minmax(180px,1fr)_repeat(3,minmax(64px,86px))] items-center bg-white/55 dark:bg-black/25">
              <div className="p-3">
                <p className="text-xs font-bold text-neutral-800 dark:text-emerald-50">{displayNotificationCategory(category.key)}</p>
                <p className="mt-1 text-[10px] leading-4 text-neutral-500 dark:text-emerald-100/45">{displayNotificationDescription(category.key)}</p>
              </div>
              {notificationChannels.map((channel) => {
                const setting = getNotificationSetting(category.key, channel.key);

                return (
                  <label key={channel.key} className="flex justify-center p-3">
                    <input
                      type="checkbox"
                      checked={setting.enabled}
                      onChange={(event) => updateNotificationToggle(category.key, channel.key, event.target.checked)}
                      disabled={isOffline || notificationLoading || notificationSaving}
                      className="h-4 w-4 accent-emerald-500 disabled:opacity-60"
                      aria-label={`${displayNotificationCategory(category.key)} ${displayNotificationChannel(channel.key)}`}
                    />
                  </label>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="block">
          <span className="text-[10px] font-black uppercase tracking-widest text-neutral-500 dark:text-emerald-100/45">{t('dash.quietHoursStart')}</span>
          <input
            type="time"
            value={quietHoursStart}
            onChange={(event) => setQuietHoursStart(event.target.value)}
            className="mt-1 w-full rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-black uppercase tracking-widest text-neutral-500 dark:text-emerald-100/45">{t('dash.quietHoursEnd')}</span>
          <input
            type="time"
            value={quietHoursEnd}
            onChange={(event) => setQuietHoursEnd(event.target.value)}
            className="mt-1 w-full rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
          />
        </label>
        <button
          type="button"
          onClick={saveNotificationSettings}
          disabled={isOffline || notificationSaving || notificationLoading}
          className="rounded bg-emerald-500 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-black transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60"
        >
          {notificationSaving ? t('dash.saving') : t('dash.saveSettings')}
        </button>
      </div>
    </div>
  );

  const renderLocationsCard = () => (
    <div className="rounded-2xl border border-emerald-500/15 bg-white p-4 shadow-xl backdrop-blur-sm dark:border-emerald-500/15 dark:bg-black/35">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-slate-700 dark:text-slate-300">
          <MapPin className="h-5 w-5 text-emerald-500" /> {t('dash.locations')}
        </span>
        <span className="rounded-full border border-emerald-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-emerald-700 dark:border-emerald-500/20 dark:text-emerald-300">
          {companyLocations.length}
        </span>
      </div>

      <p className="mt-3 flex gap-2 rounded-lg border border-emerald-500/10 bg-black/15 px-3 py-2 text-[10px] leading-4 text-neutral-500 dark:text-emerald-100/45">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
        {t('demo.mapNoticeBody')}
      </p>

      <div className="mt-3 space-y-2.5">
        {companyLocations.map((location) => (
          <div key={location.id} className="rounded-xl border border-emerald-500/15 bg-white/70 p-3 dark:border-emerald-500/15 dark:bg-black/35">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-slate-800 dark:text-slate-100">{location.name}</p>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  {displayEnum(location.location_type)} - <span dir="ltr">{location.radius_meters}m</span>
                </p>
              </div>
              {location.is_primary && (
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
                  {t('dash.primary')}
                </span>
              )}
            </div>
            <p className="mt-2 text-[10px] text-slate-500">
              {location.is_active ? t('enum.active') : t('enum.inactive')}
            </p>
          </div>
        ))}

        {companyLocations.length === 0 && (
          <p className="rounded-lg border border-emerald-500/15 p-4 text-center text-xs text-neutral-500 dark:border-emerald-500/15 dark:text-emerald-100/45">
            {locationsMessage || t('dash.noCompanyLocations')}
          </p>
        )}
      </div>
    </div>
  );

  const renderSystemStatusCard = () => (
    <div className="rounded-2xl border border-emerald-500/15 bg-white p-4 shadow-xl backdrop-blur-sm dark:border-emerald-500/15 dark:bg-black/35">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-slate-700 dark:text-slate-300">
          <CheckCircle2 className="h-5 w-5 text-emerald-500" /> {t('dash.systemStatus')}
        </span>
        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
          {t('dash.ready')}
        </span>
      </div>

      <div className="mt-4 space-y-2.5 text-xs text-slate-600 dark:text-slate-400">
        <div className="flex items-center justify-between gap-4 border-b border-emerald-500/10 pb-2.5 dark:border-emerald-500/10">
          <span>{t('dash.locationsConfigured')}</span>
          <span className="font-bold text-emerald-600 dark:text-emerald-300">{companyLocations.length}</span>
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-emerald-500/10 pb-2.5 dark:border-emerald-500/10">
          <span>{t('dash.currentShift')}</span>
          <span className="font-bold text-emerald-600 dark:text-emerald-300">{isClockedIn ? t('dash.open') : t('dash.notClockedIn')}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span>{t('dash.lastAttendanceEvent')}</span>
          <span className={cn("max-w-[190px] truncate font-medium text-slate-700 dark:text-slate-300", isRtl ? "text-left" : "text-right")}>{displayLastClockEvent}</span>
        </div>
      </div>
    </div>
  );

  const renderPwaReadinessPanel = () => (
    <div className="rounded-xl border border-emerald-500/15 bg-white/70 p-4 dark:border-emerald-500/15 dark:bg-black/35">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-slate-800 dark:text-slate-200">
            <Smartphone className="h-4 w-4 text-emerald-500" />
            {t('dash.appReadiness')}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-emerald-100/50">
            {t('dash.appReadinessSubtitle')}
          </p>
        </div>

        <span className={cn(
          "w-fit rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-widest",
          isOffline
            ? "border-amber-300/30 bg-amber-500/10 text-amber-600 dark:text-amber-200"
            : "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
        )}>
          {isOffline ? t('dash.offline') : t('dash.online')}
        </span>
      </div>

      {isOffline && (
        <p className="mt-3 rounded-lg border border-amber-300/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-100">
          {t('dash.offlineAction')}
        </p>
      )}

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-emerald-500/10 bg-white/60 p-3 dark:bg-black/25">
          <p className="text-[10px] font-black uppercase tracking-widest text-neutral-500 dark:text-emerald-100/45">{t('dash.appMode')}</p>
          <p className="mt-1 text-xs font-bold text-neutral-800 dark:text-emerald-50">
            {isStandalone ? t('dash.installedMode') : t('dash.browserMode')}
          </p>
        </div>
        <div className="rounded-lg border border-emerald-500/10 bg-white/60 p-3 dark:bg-black/25">
          <p className="text-[10px] font-black uppercase tracking-widest text-neutral-500 dark:text-emerald-100/45">{t('dash.notifications')}</p>
          <p className="mt-1 text-xs font-bold text-neutral-800 dark:text-emerald-50">
            {displayNotificationPermission()}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {canPromptInstall && (
          <button
            type="button"
            onClick={installStanza}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-black transition hover:bg-emerald-400"
          >
            <Download className="h-3.5 w-3.5" />
            {t('dash.installStanza')}
          </button>
        )}

        {canPromptInstall && (
          <button
            type="button"
            onClick={dismissInstallPrompt}
            className="rounded-lg border border-emerald-500/20 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-emerald-700 transition hover:border-emerald-400 dark:text-emerald-300"
          >
            {t('dash.dismiss')}
          </button>
        )}

        <button
          type="button"
          onClick={requestNotificationPermission}
          disabled={notificationPermission === 'granted'}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-500/20 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-emerald-700 transition hover:border-emerald-400 disabled:cursor-default disabled:opacity-60 dark:text-emerald-300"
        >
          <Bell className="h-3.5 w-3.5" />
          {notificationPermission === 'granted' ? t('dash.notificationsReady') : t('dash.enableNotifications')}
        </button>
      </div>

      {shouldShowIosInstallHint && (
        <p className="mt-3 rounded-lg border border-emerald-500/15 bg-emerald-500/5 px-3 py-2 text-xs text-neutral-600 dark:text-emerald-100/55">
          {t('dash.iosInstallHint')}
        </p>
      )}

      {pwaMessage && (
        <p className={cn(
          "mt-3 rounded-lg border px-3 py-2 text-xs font-semibold",
          pwaMessageType === 'success'
            ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300"
            : pwaMessageType === 'error'
              ? "border-red-200 bg-red-50 text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300"
              : "border-emerald-500/15 bg-emerald-500/5 text-neutral-600 dark:text-emerald-100/55"
        )}>
          {pwaMessage}
        </p>
      )}
    </div>
  );

  const copyTenantId = async () => {
    try {
      await navigator.clipboard?.writeText(user.tenantId);
      setTenantIdCopied(true);
      window.setTimeout(() => setTenantIdCopied(false), 1800);
    } catch {
      setTenantIdCopied(false);
    }
  };

  const renderControlCenterAccount = () => (
    <div className="rounded-xl border border-emerald-500/15 bg-white/70 p-4 dark:border-emerald-500/15 dark:bg-black/35">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <UserAvatar name={user.name} imageUrl={user.profileImageUrl} className="h-12 w-12" />
          <div className="min-w-0">
            <p className="truncate text-sm font-black text-slate-900 dark:text-emerald-50">{user.name}</p>
            <p className="truncate text-xs text-neutral-500 dark:text-emerald-100/50">{user.email}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="rounded-full border border-emerald-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
                {displayRole(user.role)}
              </span>
              {user.jobTitle && (
                <span className="rounded-full border border-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-neutral-500 dark:text-emerald-100/50">
                  {user.jobTitle}
                </span>
              )}
              {Array.from(new globalThis.Map(
                (user.roleNames || [])
                  .map((roleName) => roleName.trim().replace(/\s+/g, ' '))
                  .filter((roleName) => roleName && roleName.toLocaleLowerCase() !== displayRole(user.role).toLocaleLowerCase())
                  .map((roleName) => [roleName.toLocaleLowerCase(), roleName])
              ).values()).slice(0, 2).map((roleName) => (
                <span key={roleName} className="rounded-full border border-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-neutral-500 dark:text-emerald-100/50">
                  {roleName}
                </span>
              ))}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onLogout}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-500/20 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-emerald-700 transition hover:border-emerald-400 hover:text-emerald-500 dark:text-emerald-300"
        >
          <LogOut className="h-3.5 w-3.5" />
          {t('dash.logout')}
        </button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-emerald-500/10 bg-white/60 p-3 dark:bg-black/25">
          <p className="text-[10px] font-black uppercase tracking-widest text-neutral-500 dark:text-emerald-100/45">{t('dash.company')}</p>
          <p className="mt-1 truncate text-xs font-bold text-neutral-800 dark:text-emerald-50">{getTenantName(user)}</p>
        </div>
        <div className="rounded-lg border border-emerald-500/10 bg-white/60 p-3 dark:bg-black/25">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-neutral-500 dark:text-emerald-100/45">{t('dash.tenantId')}</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowTenantId((current) => !current)}
                className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 hover:text-emerald-500 dark:text-emerald-300"
              >
                {showTenantId ? t('dash.hide') : t('dash.show')}
              </button>
              <button
                type="button"
                onClick={copyTenantId}
                className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 hover:text-emerald-500 dark:text-emerald-300"
              >
                {tenantIdCopied ? t('dash.copied') : t('dash.copy')}
              </button>
            </div>
          </div>
          <p className="mt-1 truncate font-mono text-[11px] text-neutral-500 dark:text-emerald-100/55" dir="ltr">
            {showTenantId ? user.tenantId : t('dash.hidden')}
          </p>
        </div>
      </div>
    </div>
  );

  const renderPasskeyPanel = () => (
    <div className="rounded-xl border border-emerald-500/15 bg-white/70 p-4 dark:border-emerald-500/15 dark:bg-black/35">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-slate-800 dark:text-slate-200">
            <Fingerprint className="h-4 w-4 text-emerald-500" />
            {t('dash.passkeys')}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-emerald-100/50">
            {t('dash.passkeyDescription')}
          </p>
        </div>

        <button
          type="button"
          onClick={addPasskey}
          disabled={isOffline || passkeySaving}
          className="rounded-lg bg-emerald-500 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {passkeySaving ? t('dash.opening') : t('dash.addPasskey')}
        </button>
      </div>

      <p className="mt-3 flex gap-2 text-[10px] leading-4 text-neutral-500 dark:text-emerald-100/45">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
        {t('demo.passkeys')}
      </p>

      {passkeyMessage && (
        <p className={cn(
          "mt-3 rounded-lg border px-3 py-2 text-xs font-semibold",
          passkeyMessageType === 'success'
            ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300"
            : "border-red-200 bg-red-50 text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300"
        )}>
          {passkeyMessage}
        </p>
      )}

      <div className="mt-4 space-y-2">
        {passkeys.map((passkey) => (
          <div key={passkey.id} className="rounded-lg border border-emerald-500/10 bg-white/60 p-3 dark:bg-black/25">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs font-bold text-neutral-800 dark:text-emerald-50">{passkey.deviceLabel || t('dash.passkeyDevice')}</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-500 dark:text-emerald-100/45">
                {passkey.transports?.length ? passkey.transports.join(', ') : t('dash.platform')}
              </p>
            </div>
            <p className="mt-1 text-[10px] text-neutral-500 dark:text-emerald-100/45">
              {t('dash.lastUsed')}: <span dir="ltr">{passkey.lastUsedAt ? new Date(passkey.lastUsedAt).toLocaleString() : t('dash.never')}</span> · {t('dash.added')}: <span dir="ltr">{new Date(passkey.createdAt).toLocaleDateString()}</span>
            </p>
          </div>
        ))}

        {!passkeysLoading && passkeys.length === 0 && (
          <p className="rounded-lg border border-emerald-500/15 p-4 text-center text-xs text-neutral-500 dark:border-emerald-500/15 dark:text-emerald-100/45">
            {t('dash.noPasskeys')}
          </p>
        )}

        {passkeysLoading && (
          <p className="rounded-lg border border-emerald-500/15 p-4 text-center text-xs text-neutral-500 dark:border-emerald-500/15 dark:text-emerald-100/45">
            {t('dash.loadingPasskeys')}
          </p>
        )}
      </div>
    </div>
  );

  const renderPersonalizationPanel = () => {
    const percentage = Math.round(interfaceScale * 100);
    const scaleLabel = interfaceScale <= 0.9
      ? t('dash.interfaceCompact')
      : interfaceScale === 1
        ? t('dash.interfaceDefault')
        : interfaceScale <= 1.1
          ? t('dash.interfaceLarge')
          : t('dash.interfaceExtraLarge');
    const atMinimum = interfaceScale <= MIN_INTERFACE_SCALE;
    const atMaximum = interfaceScale >= MAX_INTERFACE_SCALE;

    return (
      <div className="stanza-preference-surface rounded-xl border border-emerald-500/15 bg-white/70 p-4 dark:border-emerald-500/15 dark:bg-black/35">
        <p className="text-sm font-bold uppercase tracking-widest text-slate-800 dark:text-slate-200">
          {t('dash.personalization')}
        </p>

        <div className="mt-3 space-y-3">
          {isLanyardCapable && <div className="stanza-preference-surface flex min-w-0 flex-col gap-3 border border-emerald-500/15 bg-white/75 p-3 dark:border-emerald-500/20 dark:bg-black/40 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-bold text-neutral-800 dark:text-emerald-50">{t('dash.lanyardCard')}</p>
              <p className="mt-1 text-xs leading-relaxed text-neutral-500 dark:text-emerald-100/50">
                {t('dash.lanyardCardDescription')}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-xs font-bold uppercase tracking-widest text-neutral-500 dark:text-emerald-100/55">
                {lanyardEnabled ? t('dash.on') : t('dash.off')}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={lanyardEnabled}
                aria-label={t('dash.lanyardCard')}
                onClick={() => setLanyardEnabled(!lanyardEnabled)}
                className={cn(
                  "relative h-7 w-12 shrink-0 rounded-full border p-0.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white motion-reduce:transition-none dark:focus-visible:ring-offset-[#061411]",
                  lanyardEnabled
                    ? "border-emerald-400 bg-emerald-500"
                    : "border-emerald-500/20 bg-neutral-200 dark:bg-black/60",
                )}
              >
                <span className={cn(
                  "block h-5 w-5 rounded-full bg-white shadow-sm transition-transform motion-reduce:transition-none",
                  lanyardEnabled ? "translate-x-5" : "translate-x-0",
                )} />
              </button>
            </div>
          </div>}

          <div className="stanza-preference-surface min-w-0 border border-emerald-500/15 bg-white/75 p-3 dark:border-emerald-500/20 dark:bg-black/40">
            <div className="min-w-0">
              <p className="text-sm font-bold text-neutral-800 dark:text-emerald-50">{t('dash.interfaceSize')}</p>
              <p className="mt-1 text-xs leading-relaxed text-neutral-500 dark:text-emerald-100/50">
                {t('dash.interfaceSizeDescription')}
              </p>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2" dir="ltr">
              <button
                type="button"
                onClick={() => setInterfaceScale(interfaceScale - INTERFACE_SCALE_STEP)}
                disabled={atMinimum}
                aria-label={t('dash.decreaseInterfaceSize')}
                title={t('dash.decreaseInterfaceSize')}
                className="stanza-preference-control flex min-h-10 min-w-10 items-center justify-center border border-emerald-500/20 bg-white text-emerald-700 outline-none transition hover:border-emerald-400 focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:cursor-not-allowed disabled:opacity-35 motion-reduce:transition-none dark:bg-black/45 dark:text-emerald-300"
              >
                <Minus className="h-4 w-4" aria-hidden="true" />
              </button>
              <div
                className="stanza-preference-control flex min-h-10 min-w-[7.5rem] flex-col items-center justify-center border border-emerald-500/15 bg-emerald-500/5 px-3 py-1 text-center"
                role="status"
                aria-live="polite"
                aria-label={`${t('dash.interfaceSize')}: ${percentage}% - ${scaleLabel}`}
              >
                <span className="text-sm font-black text-neutral-800 dark:text-emerald-50">{percentage}%</span>
                <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300">{scaleLabel}</span>
              </div>
              <button
                type="button"
                onClick={() => setInterfaceScale(interfaceScale + INTERFACE_SCALE_STEP)}
                disabled={atMaximum}
                aria-label={t('dash.increaseInterfaceSize')}
                title={t('dash.increaseInterfaceSize')}
                className="stanza-preference-control flex min-h-10 min-w-10 items-center justify-center border border-emerald-500/20 bg-white text-emerald-700 outline-none transition hover:border-emerald-400 focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:cursor-not-allowed disabled:opacity-35 motion-reduce:transition-none dark:bg-black/45 dark:text-emerald-300"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={resetInterfaceScale}
                disabled={interfaceScale === 1}
                aria-label={t('dash.resetInterfaceSize')}
                title={t('dash.resetInterfaceSize')}
                className="stanza-preference-control flex min-h-10 items-center gap-2 border border-emerald-500/20 bg-white px-3 text-xs font-bold uppercase tracking-widest text-emerald-700 outline-none transition hover:border-emerald-400 focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:cursor-not-allowed disabled:opacity-35 motion-reduce:transition-none dark:bg-black/45 dark:text-emerald-300"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                {t('dash.reset')}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderControlCenterSettings = () => (
    <div className="rounded-xl border border-emerald-500/15 bg-white/70 p-4 dark:border-emerald-500/15 dark:bg-black/35">
      <p className="text-sm font-bold uppercase tracking-widest text-slate-800 dark:text-slate-200">{t('dash.settings')}</p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={toggleTheme}
          className={cn("flex items-center justify-between gap-3 rounded-lg border border-emerald-500/15 bg-white px-3 py-2 text-xs font-bold text-neutral-700 transition hover:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50", isRtl ? "text-right" : "text-left")}
        >
          <span>{isDark ? t('dash.switchLight') : t('dash.switchDark')}</span>
          {isDark ? <Sun className="h-4 w-4 text-emerald-500" /> : <Moon className="h-4 w-4 text-emerald-500" />}
        </button>

        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/15 bg-white px-3 py-2 dark:border-emerald-500/20 dark:bg-black/40">
          <button
            type="button"
            onClick={() => setLang('en')}
            className={cn(
              "flex-1 rounded px-2 py-1 text-xs font-black uppercase tracking-widest transition",
              lang === 'en'
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "text-neutral-500 hover:text-emerald-600 dark:text-emerald-100/45 dark:hover:text-emerald-300"
            )}
          >
            EN-US
          </button>
          <button
            type="button"
            onClick={() => setLang('ar')}
            className={cn(
              "flex-1 rounded px-2 py-1 text-xs font-black uppercase tracking-widest transition",
              lang === 'ar'
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "text-neutral-500 hover:text-emerald-600 dark:text-emerald-100/45 dark:hover:text-emerald-300"
            )}
          >
            AR-AE
          </button>
        </div>
      </div>
    </div>
  );

  return (
<div
  ref={dashboardRootRef}
  dir={isRtl ? 'rtl' : 'ltr'}
  className={cn(
    "h-screen min-h-screen h-[100dvh] min-h-[100dvh] w-full max-w-full bg-[#020403] text-slate-100 font-sans flex flex-col md:flex-row overflow-hidden relative transition-colors duration-300",
    isRtl ? "text-right" : "text-left"
  )}
>
{/* Background Atmosphere */}
<div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
  {/* Light mode base */}
  <div className="absolute inset-0 bg-[linear-gradient(180deg,#f7fbf8_0%,#ecfdf5_45%,#f7fbf8_100%)] dark:hidden" />

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

      {shouldMountLanyard && isLanyardIdleReady && lanyardAnchorNdc && (
        <DashboardLanyardBoundary>
          <Suspense fallback={null}>
            <StanzaDashboardLanyard
              anchorNdc={lanyardAnchorNdc}
              eventSource={dashboardRootRef.current}
              hidden={!isLanyardSceneReady}
              interactionEnabled={!showControlCenter}
              onReady={() => setIsLanyardSceneReady(true)}
              user={user}
            />
          </Suspense>
        </DashboardLanyardBoundary>
      )}

      {/* Sidebar Navigation */}
<aside
  className={cn(
    "fixed left-3 right-3 md:static md:left-auto md:right-auto",
    "bottom-[calc(0.75rem+env(safe-area-inset-bottom))] md:bottom-auto",
    "w-auto max-w-[calc(100vw-1.5rem)] md:w-16 lg:w-[72px] md:max-w-full",
    "isolate bg-white/85 dark:bg-[#061411]/85 backdrop-blur-[6px]",
    "border border-emerald-500/15 dark:border-emerald-900/40",
    "flex md:flex-col items-center",
    "py-2 md:py-5 px-2 md:px-0 gap-2 md:gap-6",
    "shrink-0",
    "mx-0 md:my-2 md:mx-2 lg:mx-3",
    "rounded-2xl",
    "shadow-xl",
    "transition-all duration-300",
    "self-auto md:self-start",
    isRtl ? "md:border-l" : "md:border-r",
    showControlCenter ? "z-30 md:z-20" : "z-50 md:z-20"
  )}
>       <button
          type="button"
          id="stanza-control-center-trigger"
          aria-label={t('dash.controlCenterTitle')}
          aria-expanded={showControlCenter}
          aria-controls="stanza-control-center"
          title={t('dash.controlCenterTitle')}
          onClick={() => setShowControlCenter((current) => !current)}
          className={cn(
            "relative flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-[0_0_20px_rgba(16,185,129,0.3)]",
            "transition duration-200 ease-out hover:scale-105 hover:shadow-[0_0_28px_rgba(16,185,129,0.42)] focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:ring-offset-2 focus:ring-offset-black active:scale-100",
            showControlCenter && "scale-105 ring-2 ring-emerald-300/70 shadow-[0_0_34px_rgba(16,185,129,0.55)]"
          )}
        >
          <span className={cn(
            "absolute inset-[-5px] rounded-2xl border border-emerald-300/0 opacity-0 transition",
            "hover:border-emerald-300/30 hover:opacity-100",
            showControlCenter && "border-emerald-300/40 opacity-100"
          )} />
          <StanzaFingerprintMark size={24} className="relative text-white dark:text-[#020604]" />
        </button>
        <nav className="flex md:flex-col gap-1.5 md:gap-4 min-w-0 flex-1 md:flex-none w-full items-center justify-start overflow-x-auto md:overflow-visible">
          <button 
            onClick={() => {
              setActiveTab('geofence');
              setShowPayrollPanel(false);
              setShowGrievancesPanel(false);
            }}
            className={cn("relative h-10 min-w-0 flex-1 md:flex-none md:w-10 rounded-lg flex items-center justify-center transition-colors cursor-pointer", activeTab === 'geofence' ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20" : "hover:bg-emerald-500/5 text-slate-500")}
            title={attentionAriaLabel(t('dash.geoOp'), attentionCounts.breakRequests)}
            aria-label={attentionAriaLabel(t('dash.geoOp'), attentionCounts.breakRequests)}
          >
             <Map className="w-5 h-5" />
             <AttentionBadge count={attentionCounts.breakRequests} ariaLabel={attentionAriaLabel(t('dash.geoOp'), attentionCounts.breakRequests)} className="absolute end-0 top-0" />
          </button>
          <button 
            onClick={() => {
              setActiveTab('roster');
              setShowPayrollPanel(false);
              setShowGrievancesPanel(false);
            }}
            className={cn("relative h-10 min-w-0 flex-1 md:flex-none md:w-10 rounded-lg flex items-center justify-center transition-colors cursor-pointer", activeTab === 'roster' ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20" : "hover:bg-emerald-500/5 text-slate-500")}
            title={attentionAriaLabel(t('dash.roster'), attentionCounts.leaveRequests)}
            aria-label={attentionAriaLabel(t('dash.roster'), attentionCounts.leaveRequests)}
          >
             <Calendar className="w-5 h-5" />
             <AttentionBadge count={attentionCounts.leaveRequests} ariaLabel={attentionAriaLabel(t('dash.roster'), attentionCounts.leaveRequests)} className="absolute end-0 top-0" />
          </button>
          <button
            onClick={() => {
              setActiveTab('feed');
              setShowPayrollPanel(false);
              setShowGrievancesPanel(false);
            }}
            className={cn("h-10 min-w-0 flex-1 md:flex-none md:w-10 rounded-lg flex items-center justify-center transition-colors cursor-pointer", activeTab === 'feed' ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20" : "hover:bg-emerald-500/5 text-slate-500")}
            title={t('dash.companyFeed')}
            aria-label={t('dash.companyFeed')}
          >
             <Newspaper className="w-5 h-5" />
          </button>
           <button
             onClick={() => {
               setActiveTab('profile');
              setShowPayrollPanel(false);
              setShowGrievancesPanel(false);
              setShowResignationsPanel(false);
            }}
            className={cn("h-10 min-w-0 flex-1 md:flex-none md:w-10 rounded-lg flex items-center justify-center transition-colors cursor-pointer", activeTab === 'profile' && !showPayrollPanel && !showGrievancesPanel && !showResignationsPanel ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20" : "hover:bg-emerald-500/5 text-slate-500")}
            title={t('dash.profile')}
            aria-label={t('dash.profile')}
          >
             <User className="w-5 h-5" />
          </button>
          <button 
            onClick={() => {
              setActiveTab('profile');
              setShowPayrollPanel(true);
              setShowGrievancesPanel(false);
              setShowResignationsPanel(false);
            }}
            className={cn("relative h-10 min-w-0 flex-1 md:flex-none md:w-10 rounded-lg flex items-center justify-center transition-colors cursor-pointer", activeTab === 'profile' && showPayrollPanel ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20" : "hover:bg-emerald-500/5 text-slate-500")}
            title={attentionAriaLabel(t('profile.payroll'), payrollAttentionCount)}
            aria-label={attentionAriaLabel(t('profile.payroll'), payrollAttentionCount)}
          >
             <DollarSign className="w-5 h-5" />
             <AttentionBadge count={payrollAttentionCount} ariaLabel={attentionAriaLabel(t('profile.payroll'), payrollAttentionCount)} className="absolute end-0 top-0" />
          </button>
          <button 
            onClick={() => {
              setActiveTab('profile');
              setShowPayrollPanel(false);
              setShowGrievancesPanel(true);
              setShowResignationsPanel(false);
            }}
            className={cn("relative h-10 min-w-0 flex-1 md:flex-none md:w-10 rounded-lg flex items-center justify-center transition-colors cursor-pointer", activeTab === 'profile' && showGrievancesPanel ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20" : "hover:bg-emerald-500/5 text-slate-500")}
            title={attentionAriaLabel(t('dash.grievances'), attentionCounts.grievances)}
            aria-label={attentionAriaLabel(t('dash.grievances'), attentionCounts.grievances)}
          >
             <MessageSquare className="w-5 h-5" />
             <AttentionBadge count={attentionCounts.grievances} ariaLabel={attentionAriaLabel(t('dash.grievances'), attentionCounts.grievances)} className="absolute end-0 top-0" />
           </button>
           {canViewHiring && (
             <button
               type="button"
               onClick={() => { setActiveTab('hiring'); setShowPayrollPanel(false); setShowGrievancesPanel(false); setShowResignationsPanel(false); }}
               className={cn("relative h-10 min-w-0 flex-1 md:flex-none md:w-10 rounded-lg flex items-center justify-center transition-colors cursor-pointer", activeTab === 'hiring' ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20" : "hover:bg-emerald-500/5 text-slate-500")}
               title={attentionAriaLabel(t('hiring.title'), attentionCounts.hiring)}
               aria-label={attentionAriaLabel(t('hiring.title'), attentionCounts.hiring)}
             >
               <BriefcaseBusiness className="w-5 h-5" />
               <AttentionBadge count={attentionCounts.hiring} ariaLabel={attentionAriaLabel(t('hiring.title'), attentionCounts.hiring)} className="absolute end-0 top-0" />
             </button>
           )}
                     <button
                        type="button"
                        onClick={() => { setActiveTab('resignations'); setShowPayrollPanel(false); setShowGrievancesPanel(false); setShowResignationsPanel(true); loadResignations(); }}
            className={cn("relative h-10 min-w-0 flex-1 md:flex-none md:w-10 rounded-lg flex items-center justify-center transition-colors cursor-pointer", activeTab === 'resignations' ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20" : "hover:bg-emerald-500/5 text-slate-500")}
            title={attentionAriaLabel(t('dash.resignations'), attentionCounts.resignations)}
            aria-label={attentionAriaLabel(t('dash.resignations'), attentionCounts.resignations)}
          >
            <FileText className="w-5 h-5" />
            <AttentionBadge count={attentionCounts.resignations} ariaLabel={attentionAriaLabel(t('dash.resignations'), attentionCounts.resignations)} className="absolute end-0 top-0" />
          </button>
        </nav>
      </aside>

      {isOffline && (
        <div className="fixed inset-x-3 top-[calc(0.75rem+env(safe-area-inset-top))] z-50 mx-auto flex max-w-md items-center justify-center gap-2 rounded-xl border border-amber-300/25 bg-[#1c1304]/95 px-3 py-2 text-xs font-bold text-amber-100 shadow-2xl shadow-black/35 backdrop-blur-xl">
          <WifiOff className="h-4 w-4" />
          {t('dash.offlineAction')}
        </div>
      )}

      {showControlCenter && (
        <div
          className="stanza-control-center-backdrop fixed inset-0 z-40 bg-black/35 backdrop-blur-[2px] md:bg-black/20"
          onClick={() => setShowControlCenter(false)}
        >
          <section
            id="stanza-control-center"
            role="dialog"
            aria-modal="true"
            aria-labelledby="stanza-control-center-title"
            className={cn(
              "fixed inset-x-auto left-[calc(0.75rem+env(safe-area-inset-left))] right-[calc(0.75rem+env(safe-area-inset-right))] bottom-[calc(0.75rem+env(safe-area-inset-bottom))] max-h-[88dvh] overflow-y-auto overscroll-contain rounded-2xl border border-emerald-500/20 bg-white/95 p-4 shadow-2xl shadow-black/30 backdrop-blur-xl dark:bg-[#061411]/95",
              "md:bottom-auto md:top-4 md:w-[min(760px,calc(100vw-8rem))] md:max-h-[calc(100dvh-2rem)]",
              isRtl ? "md:right-24 md:left-auto text-right" : "md:left-24 md:right-auto text-left"
            )}
            onClick={(event) => event.stopPropagation()}
          >
            <div className={cn("mb-4 flex items-start justify-between gap-4", isRtl && "flex-row-reverse")}>
              <div>
                <h2 id="stanza-control-center-title" className="text-base font-black uppercase tracking-widest text-slate-900 dark:text-emerald-50">
                  {t('dash.controlCenterTitle')}
                </h2>
                <p className="mt-1 text-xs text-neutral-500 dark:text-emerald-100/50">
                  {t('dash.controlCenterSubtitle')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowControlCenter(false)}
                className="rounded-lg border border-emerald-500/20 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-emerald-700 transition hover:border-emerald-400 dark:text-emerald-300"
              >
                {t('dash.close')}
              </button>
            </div>

            <div className="divide-y divide-emerald-500/15">
              {renderControlCenterAccount()}
              {renderControlCenterAccordion(
                'personalization',
                t('dash.personalization'),
                `${t('dash.interfaceSize')} ${Math.round(interfaceScale * 100)}% - ${lanyardEnabled ? t('dash.on') : t('dash.off')}`,
                renderPersonalizationPanel(),
              )}
              {renderControlCenterAccordion(
                'settings',
                t('dash.settings'),
                isDark ? t('dash.switchLight') : t('dash.switchDark'),
                renderControlCenterSettings(),
              )}
              {renderControlCenterAccordion(
                'passkeys',
                t('dash.passkeys'),
                t('dash.passkeyDescription'),
                renderPasskeyPanel(),
                <span className="rounded-full border border-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300"><span dir="ltr">{passkeys.length}</span> {t('dash.registered')}</span>,
              )}
              {renderControlCenterAccordion(
                'readiness',
                t('dash.appReadiness'),
                `${isOffline ? t('dash.offline') : t('dash.online')} - ${isStandalone ? t('dash.installedMode') : t('dash.browserMode')}`,
                renderPwaReadinessPanel(),
                <span className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest",
                  isOffline ? "border-amber-300/30 text-amber-600 dark:text-amber-200" : "border-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                )}>{isOffline ? t('dash.offline') : t('dash.online')}</span>,
              )}
              {renderControlCenterAccordion(
                'notifications',
                t('dash.notificationSettings'),
                t('dash.emailPushPreferences'),
                renderNotificationSettingsPanel(),
                <span className="rounded-full border border-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">{t('dash.default')}</span>,
              )}
              {renderControlCenterAccordion(
                'workspace',
                t('dash.workspaceStatus'),
                `${companyLocations.length} ${t('dash.locationsConfigured').toLowerCase()}`,
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {renderLocationsCard()}
                  {renderSystemStatusCard()}
                </div>,
                <span className="rounded-full border border-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300" dir="ltr">{companyLocations.length}</span>,
              )}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t border-emerald-500/15 pt-4">
              <button type="button" onClick={() => setShowPrivacyPolicy(true)} className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 transition hover:text-emerald-500 dark:text-emerald-100/50 dark:hover:text-emerald-300">
                {t('privacy.link')}
              </button>
              <button type="button" onClick={onShowDemoNotice} className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 transition hover:text-emerald-500 dark:text-emerald-100/50 dark:hover:text-emerald-300">
                {t('demo.show')}
              </button>
            </div>
            <p className="mt-2 text-center text-[10px] text-neutral-500 dark:text-emerald-100/40">{t('demo.footer')}</p>
          </section>
        </div>
      )}

      <PrivacyPolicyModal open={showPrivacyPolicy} onClose={() => setShowPrivacyPolicy(false)} />

      <main className="min-w-0 w-full max-w-full flex-1 flex flex-col px-3 pb-[calc(88px+env(safe-area-inset-bottom))] pt-[calc(0.75rem+env(safe-area-inset-top))] md:p-4 lg:p-5 z-10 overflow-y-auto overflow-x-hidden">
        
        {/* Header Pipeline */}
        <header className="mb-3">
          <div className="min-w-0">
            <h1 className="flex items-center text-xl font-bold tracking-tight text-slate-900 dark:text-white">
              <BrandWordmark />
              <span className={cn("hidden rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-xs uppercase text-emerald-600 dark:text-emerald-500 sm:inline-block", isRtl ? "mr-3" : "ml-3")}>{t('dash.elitePortal')}</span>
            </h1>
          </div>
        </header>
        {/* Dashboard Grid Container */}
        <div className="flex flex-col xl:flex-row gap-4 flex-1 w-full max-w-full min-w-0 items-start">
            
            {/* Main Action Area (Left / Center) */}
            <div className="flex-1 space-y-4 w-full max-w-full min-w-0">
                
                {/* Tabs styled like immersive pills (Hidden on small screens, duplicated from sidebar for context) */}
                <div className="hidden max-w-full items-center gap-2 overflow-x-auto pb-1 md:flex [&>button]:min-w-max [&>button]:shrink-0 [&>button]:whitespace-nowrap">
                    <button 
                       onClick={() => {
                         setActiveTab('geofence');
                         setShowPayrollPanel(false);
                         setShowGrievancesPanel(false);
                       }}
                       className={cn("px-4 py-2 text-xs font-bold uppercase tracking-widest rounded transition-all flex items-center gap-2 border", activeTab === 'geofence' ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20" : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300")}
                       aria-label={attentionAriaLabel(t('dash.geoOp'), attentionCounts.breakRequests)}
                     >
                       <MapPin className="w-4 h-4 hidden sm:block" />
                       {t('dash.geoOp')}
                       <AttentionBadge count={attentionCounts.breakRequests} ariaLabel={attentionAriaLabel(t('dash.geoOp'), attentionCounts.breakRequests)} />
                    </button>
                    <button 
                       onClick={() => {
                         setActiveTab('roster');
                         setShowPayrollPanel(false);
                         setShowGrievancesPanel(false);
                       }}
                       className={cn("px-4 py-2 text-xs font-bold uppercase tracking-widest rounded transition-all flex items-center gap-2 border", activeTab === 'roster' ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20" : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300")}
                       aria-label={attentionAriaLabel(t('dash.roster'), attentionCounts.leaveRequests)}
                     >
                       <Calendar className="w-4 h-4 hidden sm:block" />
                       {t('dash.roster')}
                       <AttentionBadge count={attentionCounts.leaveRequests} ariaLabel={attentionAriaLabel(t('dash.roster'), attentionCounts.leaveRequests)} />
                    </button>
                    {canViewHiring && (
                      <button
                        type="button"
                        onClick={() => { setActiveTab('hiring'); setShowPayrollPanel(false); setShowGrievancesPanel(false); setShowResignationsPanel(false); }}
                        className={cn("px-4 py-2 text-xs font-bold uppercase tracking-widest rounded transition-all flex items-center gap-2 border", activeTab === 'hiring' ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20" : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300")}
                        aria-label={attentionAriaLabel(t('hiring.title'), attentionCounts.hiring)}
                      >
                        <BriefcaseBusiness className="w-4 h-4 hidden sm:block" />
                        {t('hiring.title')}
                        <AttentionBadge count={attentionCounts.hiring} ariaLabel={attentionAriaLabel(t('hiring.title'), attentionCounts.hiring)} />
                      </button>
                    )}
                    <button
                       onClick={() => {
                         setActiveTab('feed');
                         setShowPayrollPanel(false);
                         setShowGrievancesPanel(false);
                       }}
                       className={cn("px-4 py-2 text-xs font-bold uppercase tracking-widest rounded transition-all flex items-center gap-2 border", activeTab === 'feed' ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20" : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300")}
                    >
                       <Newspaper className="w-4 h-4 hidden sm:block" />
                       {t('dash.companyFeed')}
                    </button>
                    <button 
                       onClick={() => {
                         setActiveTab('profile');
                         setShowPayrollPanel(false);
                         setShowGrievancesPanel(false);
                         setShowResignationsPanel(false);
                       }}
                       className={cn("px-4 py-2 text-xs font-bold uppercase tracking-widest rounded transition-all flex items-center gap-2 border", activeTab === 'profile' && !showPayrollPanel && !showGrievancesPanel && !showResignationsPanel ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20" : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300")}
                    >
                       <User className="w-4 h-4 hidden sm:block" />
                       {t('dash.profile')}
                    </button>
                    <button 
                       onClick={() => {
                         setActiveTab('profile');
                         setShowPayrollPanel(true);
                         setShowGrievancesPanel(false);
                         setShowResignationsPanel(false);
                       }}
                       className={cn("px-4 py-2 text-xs font-bold uppercase tracking-widest rounded transition-all flex items-center gap-2 border", activeTab === 'profile' && showPayrollPanel ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20" : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300")}
                       aria-label={attentionAriaLabel(t('profile.payroll'), payrollAttentionCount)}
                     >
                       <DollarSign className="w-4 h-4 hidden sm:block" />
                       {t('profile.payroll')}
                       <AttentionBadge count={payrollAttentionCount} ariaLabel={attentionAriaLabel(t('profile.payroll'), payrollAttentionCount)} />
                    </button>
                    <button 
                       onClick={() => {
                         setActiveTab('profile');
                         setShowPayrollPanel(false);
                         setShowGrievancesPanel(true);
                         setShowResignationsPanel(false);
                       }}
                       className={cn("px-4 py-2 text-xs font-bold uppercase tracking-widest rounded transition-all flex items-center gap-2 border", activeTab === 'profile' && showGrievancesPanel ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20" : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300")}
                       aria-label={attentionAriaLabel(t('dash.grievances'), attentionCounts.grievances)}
                     >
                       <MessageSquare className="w-4 h-4 hidden sm:block" />
                       {t('dash.grievances')}
                       <AttentionBadge count={attentionCounts.grievances} ariaLabel={attentionAriaLabel(t('dash.grievances'), attentionCounts.grievances)} />
                    </button>
                    <button
                       type="button"
                       onClick={() => { setActiveTab('resignations'); setShowPayrollPanel(false); setShowGrievancesPanel(false); setShowResignationsPanel(true); loadResignations(); }}
                       className={cn("px-4 py-2 text-xs font-bold uppercase tracking-widest rounded transition-all flex items-center gap-2 border", activeTab === 'resignations' ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20" : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300")}
                       aria-label={attentionAriaLabel(t('dash.resignations'), attentionCounts.resignations)}
                     >
                       <FileText className="w-4 h-4 hidden sm:block" />
                       {t('dash.resignations')}
                       <AttentionBadge count={attentionCounts.resignations} ariaLabel={attentionAriaLabel(t('dash.resignations'), attentionCounts.resignations)} />
                    </button>
                </div>

                {/* Tab Contents */}
                {activeTab === 'hiring' && canViewHiring && (
                  <Suspense fallback={<div className="min-h-[420px] animate-pulse rounded-xl border border-emerald-500/15 bg-emerald-500/5" />}>
                    <HiringPanel user={user} onRefreshAttentionCounts={refreshAttentionCounts} />
                  </Suspense>
                )}
                {activeTab === 'geofence' && (
                    <motion.div initial={{opacity:0, y:5}} animate={{opacity:1, y:0}} className="w-full max-w-full min-h-[calc(100dvh-145px)] md:min-h-0 bg-white dark:bg-[#0a1a17]/90 border border-emerald-500/15 dark:border-emerald-500/20 rounded-2xl p-3 md:p-4 flex flex-col items-center justify-start md:justify-center text-center backdrop-blur-sm relative overflow-hidden group shadow-xl">
                       <div className="absolute inset-0 bg-emerald-50/35 dark:bg-emerald-500/5 group-hover:bg-emerald-50/70 dark:group-hover:bg-emerald-500/10 transition-colors pointer-events-none"></div>
                       <div className="w-full flex items-start justify-between mb-4 z-10 relative">
                           <div className={cn("flex flex-col gap-1", isRtl ? "items-end text-right" : "items-start text-left")}>
                               <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                <MapPin className="w-5 h-5 text-emerald-500" />
                                {t('dash.perimeter')}
                               </h2>
                               <p className="text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-transparent font-mono border border-emerald-200 dark:border-emerald-500/30 px-2 py-0.5 rounded uppercase tracking-widest">{t('dash.hqSecure')}</p>
                           </div>
                       </div>
                       
                       <div className="relative z-10 flex min-h-[calc(100dvh-260px)] w-full max-w-full flex-col items-center justify-center overflow-hidden rounded-2xl border border-emerald-500/10 bg-white/70 px-4 py-6 dark:border-emerald-500/10 dark:bg-black/30 md:min-h-0 md:h-[360px] md:px-6 md:py-8">
                           <div className="relative mb-5 flex h-48 min-h-48 w-48 min-w-48 shrink-0 items-center justify-center rounded-full border-4 border-dashed border-emerald-900 md:h-40 md:min-h-40 md:w-40 md:min-w-40">
                             {clockInState === 'success' && <div className="absolute inset-0 rounded-full shadow-[0_0_50px_rgba(16,185,129,0.3)] animate-pulse"></div>}
                             <button 
                               type="button"
                               onClick={handleClockAction}
                               disabled={isOffline || clockInState === 'locating' || clockInState === 'verifying'}
                               className={cn(
                                   "relative z-10 flex h-40 min-h-40 w-40 min-w-40 shrink-0 items-center justify-center overflow-hidden rounded-full font-black tracking-tighter transition-transform duration-300 hover:scale-105 active:scale-95 md:h-36 md:min-h-36 md:w-36 md:min-w-36",
                                   clockInState === 'idle' && hasActiveShift ? "bg-gradient-to-tr from-amber-500 to-orange-400 text-slate-950 shadow-[0_0_30px_rgba(245,158,11,0.35)] hover:shadow-[0_0_40px_rgba(245,158,11,0.5)]" :
                                   clockInState === 'idle' ? "bg-gradient-to-tr from-emerald-600 to-emerald-400 text-slate-950 shadow-[0_0_30px_rgba(16,185,129,0.4)] hover:shadow-[0_0_40px_rgba(16,185,129,0.6)]" :
                                   clockInState === 'locating' || clockInState === 'verifying' ? "bg-black/70 text-emerald-100/55 animate-pulse border border-emerald-500/20 shadow-none" :
                                   clockInState === 'success' || clockInState === 'clocked_out' ? "bg-emerald-500 text-slate-900 shadow-[0_0_40px_rgba(16,185,129,0.6)]" :
                                   clockInState === 'open_shift_conflict' ? "bg-amber-500 text-slate-950 shadow-[0_0_40px_rgba(245,158,11,0.42)]" :
                                   "bg-red-500 text-white shadow-[0_0_40px_rgba(239,68,68,0.6)]"
                               )}
                             >
                              <AnimatePresence mode="wait" initial={false}>
                                 {clockInState === 'idle' && (
                                     <motion.div key="idle" initial={{opacity:0, scale:0.92}} animate={{opacity:1, scale:1}} exit={{opacity:0, scale:0.92}} className="absolute inset-0 flex flex-col items-center justify-center">
                                         <span className="whitespace-nowrap text-[10px] sm:text-xs tracking-widest">{hasActiveShift ? t('dash.clockOut') : t('dash.clockIn')}</span>
                                     </motion.div>
                                 )}
                                 {(clockInState === 'locating' || clockInState === 'verifying') && (
                                     <motion.div key="loading" initial={{opacity:0, scale:0.92}} animate={{opacity:1, scale:1}} exit={{opacity:0, scale:0.92}} className="absolute inset-0 flex flex-col items-center justify-center">
                                         <Navigation className="w-8 h-8 mb-2 animate-spin-slow" />
                                         <span className="whitespace-nowrap font-bold text-[10px] uppercase tracking-widest">{clockInState === 'locating' ? t('dash.locating') : t('dash.verifying')}</span>
                                     </motion.div>
                                 )}
                                 {(clockInState === 'success' || clockInState === 'clocked_out') && (
                                     <motion.div key="success" initial={{opacity:0, scale:0.92}} animate={{opacity:1, scale:1}} exit={{opacity:0, scale:0.92}} className="absolute inset-0 flex flex-col items-center justify-center">
                                         <CheckCircle2 className="w-10 h-10 mb-1 opacity-90" />
                                         <span className="font-bold text-[10px] uppercase tracking-widest leading-none">{t('dash.verified')}</span>
                                     </motion.div>
                                 )}
                                 {clockInState === 'open_shift_conflict' && (
                                     <motion.div key="conflict" initial={{opacity:0, scale:0.92}} animate={{opacity:1, scale:1}} exit={{opacity:0, scale:0.92}} className="absolute inset-0 flex flex-col items-center justify-center">
                                         <AlertTriangle className="w-10 h-10 mb-1" />
                                         <span className="px-3 text-center font-bold text-[10px] uppercase tracking-widest leading-none">{t('dash.openShiftConflictLabel')}</span>
                                     </motion.div>
                                 )}
                                 {(clockInState === 'failed' || clockInState === 'outside_geofence') && (
                                     <motion.div key="failed" initial={{opacity:0, scale:0.92}} animate={{opacity:1, scale:1}} exit={{opacity:0, scale:0.92}} className="absolute inset-0 flex flex-col items-center justify-center">
                                         <AlertTriangle className="w-10 h-10 mb-1" />
                                         <span className="px-3 text-center font-bold text-[10px] uppercase tracking-widest leading-none">{clockInState === 'outside_geofence' ? t('dash.outsideGeofenceLabel') : t('dash.attendanceErrorLabel')}</span>
                                     </motion.div>
                                 )}
                              </AnimatePresence>
                             </button>
                           </div>

                           {/* Dynamic Status Display */}
                           <div className="relative mt-3 h-16 w-full max-w-[320px] overflow-hidden px-1">
                            <AnimatePresence mode="wait" initial={false}>
                                {clockMessage ? (
                                    <motion.div 
                                        key="msg"
                                        initial={{opacity: 0, y: 4}} 
                                        animate={{opacity: 1, y: 0}}
                                        exit={{opacity: 0, y: -4}}
                                        className="absolute inset-0 flex items-center justify-center gap-2 text-center"
                                    >
                                        <span className={cn(
                                          "flex h-2 w-2 shrink-0 rounded-full",
                                          clockInState === 'success' || clockInState === 'clocked_out'
                                            ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,1)]"
                                            : clockInState === 'open_shift_conflict'
                                              ? "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.9)]"
                                              : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,1)]"
                                        )}></span>
                                        <span className={cn(
                                          "max-h-12 overflow-hidden text-[10px] uppercase font-bold tracking-widest leading-4",
                                          clockInState === 'success' || clockInState === 'clocked_out'
                                            ? "text-emerald-400"
                                            : clockInState === 'open_shift_conflict'
                                              ? "text-amber-400"
                                              : "text-red-400"
                                        )}>
                                            {t('dash.sysMsg')} {clockMessage}
                                        </span>
                                    </motion.div>
                                ) : (
                                    <motion.div 
                                        key="idle"
                                        initial={{opacity: 0, y: 4}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -4}}
                                        className="absolute inset-0 flex items-center justify-center gap-2 text-center text-neutral-500 dark:text-emerald-100/45"
                                    >
                                        <span className="flex h-2 w-2 shrink-0 rounded-full bg-emerald-500/60 animate-pulse"></span>
                                        <span className="max-h-12 overflow-hidden text-[10px] uppercase tracking-widest leading-4">{hasActiveShift ? t('dash.activeShift') : t('dash.awaitingInput')}</span>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                           </div>

                           <div className="mt-2 flex h-16 w-full max-w-[360px] flex-col items-center justify-start gap-1 overflow-hidden px-1">
                             <p className="h-4 max-w-full overflow-hidden text-[10px] font-mono uppercase tracking-widest text-neutral-500 dark:text-emerald-100/45">
                               {lastClockEvent}
                             </p>
                             {clockWarning ? (
                               <p
                                 className={cn(
                                   "max-h-10 max-w-full overflow-hidden rounded-lg border px-2 py-1 text-center text-[10px] font-bold leading-4",
                                   lastClockAccuracy !== null && getClockAccuracyLevel(lastClockAccuracy) === 'low'
                                     ? "border-amber-400/25 bg-amber-500/10 text-amber-700 dark:text-amber-200"
                                     : "border-emerald-500/15 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"
                                 )}
                               >
                                 {clockWarning}
                               </p>
                             ) : (
                               <span className="h-8" aria-hidden="true" />
                             )}
                           </div>
                       </div>

                       <div className={cn("relative z-10 mt-4 grid w-full grid-cols-1 gap-3 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]", isRtl ? "text-right" : "text-left")}>
                         {canCreateBreakRequests && (
                           <div className="rounded-2xl border border-emerald-500/15 bg-white/70 p-4 dark:border-emerald-500/15 dark:bg-black/30">
                             <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                               <div>
                                 <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-800 dark:text-slate-200">
                                   <Coffee className="h-4 w-4 text-emerald-500" />
                                   {t('dash.requestBreak')}
                                 </h3>
                                 <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                                   {t('dash.breakRequestHelp')}
                                 </p>
                               </div>
                               {pendingOwnBreakRequest && (
                                 <span className={cn("w-fit rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest", getBreakStatusClass(pendingOwnBreakRequest.status))}>
                                   {t('dash.pending')}
                                 </span>
                               )}
                             </div>

                             <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                               {['10', '15', '30', '45', '60'].map((minutes) => (
                                 <button
                                   key={minutes}
                                   type="button"
                                   onClick={() => setBreakRequestForm((current) => ({ ...current, durationMinutes: minutes }))}
                                   disabled={Boolean(pendingOwnBreakRequest) || breakRequestSubmitting}
                                   className={cn(
                                     "rounded-lg border px-2 py-2 text-xs font-bold transition-colors",
                                     breakRequestForm.durationMinutes === minutes
                                       ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-200"
                                       : "border-emerald-500/15 bg-white/60 text-slate-600 hover:border-emerald-500/30 dark:bg-black/35 dark:text-emerald-100/65",
                                     (pendingOwnBreakRequest || breakRequestSubmitting) && "cursor-not-allowed opacity-60"
                                   )}
                                 >
                                   {minutes}m
                                 </button>
                               ))}
                             </div>

                             <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[130px_minmax(0,1fr)]">
                               <button
                                 type="button"
                                 onClick={() => setBreakRequestForm((current) => ({ ...current, durationMinutes: 'custom' }))}
                                 disabled={Boolean(pendingOwnBreakRequest) || breakRequestSubmitting}
                                 className={cn(
                                   "rounded-lg border px-3 py-2 text-xs font-bold uppercase tracking-widest transition-colors",
                                   breakRequestForm.durationMinutes === 'custom'
                                     ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-200"
                                     : "border-emerald-500/15 bg-white/60 text-slate-600 hover:border-emerald-500/30 dark:bg-black/35 dark:text-emerald-100/65"
                                 )}
                               >
                                   {t('dash.custom')}
                               </button>
                               <input
                                 type="number"
                                 min={5}
                                 max={180}
                                 value={breakRequestForm.customDuration}
                                 onChange={(event) => setBreakRequestForm((current) => ({ ...current, customDuration: event.target.value, durationMinutes: 'custom' }))}
                                 disabled={Boolean(pendingOwnBreakRequest) || breakRequestSubmitting}
                                 placeholder={t('dash.breakDurationPlaceholder')}
                                 className="rounded-lg border border-emerald-500/15 bg-white/70 px-3 py-2 text-xs text-slate-800 outline-none focus:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                               />
                             </div>

                             <textarea
                               value={breakRequestForm.reason}
                               onChange={(event) => setBreakRequestForm((current) => ({ ...current, reason: event.target.value }))}
                               disabled={Boolean(pendingOwnBreakRequest) || breakRequestSubmitting}
                               rows={3}
                               placeholder={t('dash.optionalReason')}
                               className="mt-3 w-full resize-none rounded-lg border border-emerald-500/15 bg-white/70 px-3 py-2 text-xs text-slate-800 outline-none focus:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                             />

                             <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                               <button
                                 type="button"
                                 onClick={submitBreakRequest}
                                 disabled={isOffline || Boolean(pendingOwnBreakRequest) || breakRequestSubmitting}
                                 className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-black uppercase tracking-widest text-black transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-55"
                               >
                                 {breakRequestSubmitting ? t('dash.sending') : pendingOwnBreakRequest ? t('dash.pendingApproval') : t('dash.requestBreak')}
                               </button>
                               {pendingOwnBreakRequest && (
                                 <button
                                   type="button"
                                   onClick={() => cancelBreakRequest(pendingOwnBreakRequest.id)}
                                   disabled={isOffline || breakRequestReviewingId === pendingOwnBreakRequest.id}
                                   className="rounded-lg border border-emerald-500/20 px-4 py-2 text-xs font-bold uppercase tracking-widest text-slate-600 transition-colors hover:border-red-500/35 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-55 dark:text-emerald-100/65"
                                 >
                                   {t('dash.cancelRequest')}
                                 </button>
                               )}
                             </div>
                           </div>
                         )}

                         <div className="rounded-2xl border border-emerald-500/15 bg-white/70 p-4 dark:border-emerald-500/15 dark:bg-black/30">
                           <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                             <div>
                               <h3 className="text-xs font-bold uppercase tracking-widest text-slate-800 dark:text-slate-200">
                                 {t('dash.breakStatus')}
                               </h3>
                               <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                                 {t('dash.breakStatusHelp')}
                               </p>
                             </div>
                             <button
                               type="button"
                               onClick={() => loadBreakRequests()}
                               disabled={breakRequestsLoading || isOffline}
                               className="w-fit rounded-lg border border-emerald-500/20 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-emerald-700 transition-colors hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-55 dark:text-emerald-300"
                             >
                               {breakRequestsLoading ? t('dash.loading') : t('dash.refresh')}
                             </button>
                           </div>

                           {breakRequestMessage && (
                             <p className={cn(
                               "mt-3 rounded-lg border px-3 py-2 text-xs font-medium",
                               breakRequestMessageType === 'success'
                                 ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                 : "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300"
                             )}>
                               {breakRequestMessage}
                             </p>
                           )}

                           <div className="mt-3 space-y-2">
                             {breakRequests.slice(0, 3).map((request) => (
                               <div key={request.id} className="rounded-xl border border-emerald-500/10 bg-white/60 p-3 dark:bg-black/35">
                                 <div className="flex items-start justify-between gap-3">
                                   <div>
                                     <p className="text-xs font-bold text-slate-800 dark:text-slate-100">
                                       <span dir="ltr">{request.duration_minutes}</span> {t('dash.minutes')}
                                     </p>
                                     <p className="mt-1 text-[10px] uppercase tracking-widest text-slate-500 dark:text-emerald-100/45">
                                       {t('dash.requested')} <span dir="ltr">{formatShortDateTime(request.created_at)}</span>
                                     </p>
                                   </div>
                                   <span className={cn("rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest", getBreakStatusClass(request.status))}>
                                     {displayEnum(request.status)}
                                   </span>
                                 </div>
                                 {request.reason && (
                                   <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">{request.reason}</p>
                                 )}
                                 {request.review_note && (
                                   <p className="mt-2 rounded-lg bg-black/5 px-2 py-1.5 text-[10px] text-slate-600 dark:bg-emerald-500/5 dark:text-emerald-100/55">
                                     {t('dash.reviewNote')}: {request.review_note}
                                   </p>
                                 )}
                               </div>
                             ))}

                             {!breakRequestsLoading && breakRequests.length === 0 && (
                               <p className="rounded-lg border border-emerald-500/15 p-4 text-center text-xs text-neutral-500 dark:text-emerald-100/45">
                                 {t('dash.noBreakRequests')}
                               </p>
                             )}
                           </div>
                         </div>
                       </div>

                       {canReviewBreakRequests && (
                         <div className={cn("relative z-10 mt-4 w-full rounded-2xl border border-emerald-500/15 bg-white/70 p-4 dark:border-emerald-500/15 dark:bg-black/30", isRtl ? "text-right" : "text-left")}>
                           <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                             <div>
                               <h3 className="text-xs font-bold uppercase tracking-widest text-slate-800 dark:text-slate-200">
                                 {t('dash.breakApprovalQueue')}
                               </h3>
                               <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                                 {t('dash.reviewPendingBreakRequests')}
                               </p>
                             </div>
                             <span className="w-fit rounded-full border border-emerald-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
                               {pendingBreakRequests.length} {t('dash.pending')}
                             </span>
                           </div>

                           <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                             {pendingBreakRequests.map((request) => (
                               <div key={request.id} className="rounded-xl border border-emerald-500/10 bg-white/60 p-3 dark:bg-black/35">
                                 <div className="flex items-start justify-between gap-3">
                                   <div>
                                     <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{request.full_name || request.email || t('dash.employee')}</p>
                                     <p className="mt-1 text-[10px] uppercase tracking-widest text-slate-500">
                                       <span dir="ltr">{request.duration_minutes}</span> {t('dash.minutes')} - <span dir="ltr">{formatShortDateTime(request.created_at)}</span>
                                     </p>
                                   </div>
                                   <span className={cn("rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest", getBreakStatusClass(request.status))}>
                                     {displayEnum(request.status)}
                                   </span>
                                 </div>
                                 {request.reason && (
                                   <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">{request.reason}</p>
                                 )}
                                 <input
                                   value={breakReviewNotes[request.id] || ''}
                                   onChange={(event) => setBreakReviewNotes((current) => ({ ...current, [request.id]: event.target.value }))}
                                   placeholder={t('dash.optionalReviewNote')}
                                   className="mt-3 w-full rounded-lg border border-emerald-500/15 bg-white/70 px-3 py-2 text-xs text-slate-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                                 />
                                 <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                                   <button
                                     type="button"
                                     onClick={() => reviewBreakRequest(request.id, 'approved')}
                                     disabled={isOffline || breakRequestReviewingId === request.id}
                                     className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-black uppercase tracking-widest text-black transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-55"
                                   >
                                     {t('dash.approve')}
                                   </button>
                                   <button
                                     type="button"
                                     onClick={() => reviewBreakRequest(request.id, 'rejected')}
                                     disabled={isOffline || breakRequestReviewingId === request.id}
                                     className="rounded-lg border border-red-500/25 px-4 py-2 text-xs font-bold uppercase tracking-widest text-red-600 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-55 dark:text-red-300"
                                   >
                                     {t('dash.reject')}
                                   </button>
                                 </div>
                               </div>
                             ))}

                             {!breakRequestsLoading && pendingBreakRequests.length === 0 && (
                               <p className="rounded-lg border border-emerald-500/15 p-4 text-center text-xs text-neutral-500 dark:text-emerald-100/45 lg:col-span-2">
                                 {t('dash.noPendingBreakRequests')}
                               </p>
                             )}
                           </div>
                         </div>
                       )}

                       <div className={cn("relative z-10 mt-4 w-full rounded-2xl border border-emerald-500/15 bg-white/70 p-4 dark:border-emerald-500/15 dark:bg-black/30", isRtl ? "text-right" : "text-left")}>
                         <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                           <div>
                             <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-800 dark:text-slate-200">
                               <MapPin className="h-4 w-4 text-emerald-500" />
                               {t('dash.companyLocations')}
                             </h3>
                             <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                               {t('dash.clockInValidLocations')}
                             </p>
                           </div>
                           <span className="w-fit rounded-full border border-emerald-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-emerald-700 dark:border-emerald-500/20 dark:text-emerald-300">
                             {companyLocations.length} {t('dash.active')}
                           </span>
                         </div>

                         <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                           {companyLocations.slice(0, 4).map((location) => (
                             <div key={location.id} className="rounded-xl border border-emerald-500/15 bg-white/70 p-3 dark:border-emerald-500/15 dark:bg-black/35">
                               <div className="flex items-start justify-between gap-3">
                                 <div>
                                   <p className="text-xs font-bold text-slate-800 dark:text-slate-100">{location.name}</p>
                                   <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                     {displayEnum(location.location_type)} - <span dir="ltr">{location.radius_meters}m</span>
                                   </p>
                                 </div>
                                 {location.is_primary && (
                                   <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
                                     {t('dash.primary')}
                                   </span>
                                 )}
                               </div>
                               <p className="mt-2 font-mono text-[10px] text-slate-500">
                                 <span dir="ltr">{Number(location.latitude).toFixed(5)}, {Number(location.longitude).toFixed(5)}</span>
                               </p>
                             </div>
                           ))}

                           {companyLocations.length === 0 && (
                             <p className="rounded-lg border border-emerald-500/15 p-4 text-center text-xs text-neutral-500 dark:border-emerald-500/15 dark:text-emerald-100/45 md:col-span-2">
                               {locationsMessage || t('dash.noActiveCompanyLocations')}
                             </p>
                           )}
                         </div>
                       </div>
                    </motion.div>
                )}                

                {activeTab === 'roster' && (
                    <motion.div initial={{opacity:0, y:5}} animate={{opacity:1, y:0}} className="bg-white dark:bg-[#0a1a17]/40 border border-emerald-500/15 dark:border-emerald-500/10 rounded-2xl flex flex-col overflow-hidden backdrop-blur-sm shadow-xl min-h-[320px]">
                       <div className="border-b border-emerald-500/15 p-4 dark:border-emerald-500/10">
                         <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                           <div>
                             <h3 className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
                               <Calendar className="w-5 h-5 text-emerald-600 dark:text-emerald-500" />
                               {t('dash.rosterHub')}
                             </h3>
                             <p className="mt-1 text-[11px] text-neutral-500 dark:text-emerald-100/45" dir="ltr">
                               {rosterStartDate} - {rosterEndDate}
                             </p>
                           </div>
                           <div className="flex flex-wrap items-center gap-2">
                             <span className="rounded border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold uppercase text-emerald-600 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400">{t('dash.weekView')}</span>
                             {canManageRoster && (
                               <span className="inline-flex items-center gap-1 px-3 py-1 text-emerald-600 dark:text-emerald-400 text-xs rounded border border-emerald-200 dark:border-emerald-500/20 font-bold uppercase">
                                 <Save className="h-3 w-3" />
                                 {t('dash.autoSaved')}
                               </span>
                             )}
                             <button
                               type="button"
                               title={t('dash.applyLeave')}
                               aria-label={t('dash.applyLeave')}
                               onClick={openLeaveRequestFlow}
                               className="px-3 py-1 text-slate-500 dark:text-slate-400 text-xs hover:text-slate-800 dark:hover:text-slate-300 font-bold uppercase transition-colors"
                             >
                               {t('dash.applyLeave')}
                             </button>
                           </div>
                         </div>

                         {canManageRoster && (
                           <div className="mt-4 flex flex-col gap-3 border-t border-emerald-500/10 pt-3 lg:flex-row lg:items-end lg:justify-between">
                             <div className="flex flex-wrap items-center gap-2">
                               <button type="button" onClick={() => moveRosterRange(-1)} className="rounded border border-emerald-500/20 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-emerald-700 transition hover:border-emerald-400 dark:text-emerald-300">{t('dash.previousWeek')}</button>
                               <button type="button" onClick={resetRosterToThisWeek} className="rounded border border-emerald-500/20 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-emerald-700 transition hover:border-emerald-400 dark:text-emerald-300">{t('dash.thisWeek')}</button>
                               <button type="button" onClick={() => moveRosterRange(1)} className="rounded border border-emerald-500/20 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-emerald-700 transition hover:border-emerald-400 dark:text-emerald-300">{t('dash.nextWeek')}</button>
                             </div>
                             <div className="flex flex-wrap items-end gap-2">
                               <label className="block">
                                 <span className="text-[10px] font-black uppercase tracking-widest text-neutral-500 dark:text-emerald-100/45">{t('dash.viewRange')}</span>
                                 <select value={rosterRangeWeeks} onChange={(event) => setRosterRange(event.target.value as '1' | '2' | '4' | 'custom')} className="mt-1 block rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50">
                                   <option value="1">{t('dash.oneWeek')}</option>
                                   <option value="2">{t('dash.twoWeeks')}</option>
                                   <option value="4">{t('dash.fourWeeks')}</option>
                                   <option value="custom">{t('dash.customRange')}</option>
                                 </select>
                               </label>
                               {rosterRangeWeeks === 'custom' && (
                                 <>
                                   <label className="block"><span className="text-[10px] font-black uppercase tracking-widest text-neutral-500 dark:text-emerald-100/45">{t('dash.startDate')}</span><input type="date" value={rosterStartDate} onChange={(event) => setRosterStartDate(event.target.value)} className="mt-1 block rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50" /></label>
                                   <label className="block"><span className="text-[10px] font-black uppercase tracking-widest text-neutral-500 dark:text-emerald-100/45">{t('dash.endDate')}</span><input type="date" value={rosterCustomEndDate} onChange={(event) => setRosterCustomEndDate(event.target.value)} className="mt-1 block rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50" /></label>
                                 </>
                               )}
                             </div>
                           </div>
                         )}
                         {canViewAllRosters && (
                           <label className="mt-3 block max-w-sm">
                             <span className="text-[10px] font-black uppercase tracking-widest text-neutral-500 dark:text-emerald-100/45">{t('dash.rosterEmployee')}</span>
                             <select
                               value={selectedRosterEmployeeId}
                               onChange={(event) => setSelectedRosterEmployeeId(event.target.value)}
                               className="mt-1 block w-full rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                             >
                               {rosterEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.fullName} ({employee.email})</option>)}
                             </select>
                           </label>
                         )}
                       </div>

                       {rosterRange.error ? (
                         <p className="m-4 rounded-lg border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-200">{t('dash.rosterRangeTooLarge')}</p>
                       ) : (
                       <>
                       {rosterMessage && <p className="mx-4 mt-4 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-200">{rosterMessage}</p>}
                       {rosterLoading && <p className="mx-4 mt-4 text-xs text-neutral-500 dark:text-emerald-100/45">{t('dash.rosterLoading')}</p>}
                       <div className="w-full max-w-full overflow-x-auto flex-1">
                         <table className={cn("w-full min-w-[760px]", isRtl ? "text-right" : "text-left")}>
                           <thead>
                             <tr className="text-[10px] text-neutral-500 dark:text-emerald-100/45 uppercase font-bold border-b border-emerald-500/15 dark:border-emerald-500/15 bg-white/70 dark:bg-black/25">
                               <th className="p-3">{t('dash.dayDate')}</th>
                               <th className="p-3">{t('dash.shiftFrame')}</th>
                              <th className="p-3">{t('dash.breakTime')}</th>
                               <th className="p-3">{t('dash.locationRole')}</th>
                               <th className={cn("p-3", isRtl ? "text-left" : "text-right")}>{t('dash.status')}</th>
                             </tr>
                           </thead>
                           <tbody className="text-sm">
                             {visibleSchedule.map((s) => (
                               <tr key={s.date} className="border-b border-emerald-500/10 dark:border-emerald-500/10 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 transition-colors group">
                                 <td className="p-3">
                                   <div className="font-bold text-slate-800 dark:text-slate-200 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">{displayWeekday(s.day)}, <span dir="ltr">{s.date}</span></div>
                                 </td>
                                 <td className="p-3 font-mono text-xs text-slate-500 dark:text-slate-400">
                                   {canManageRoster ? (
                                     <div className="flex items-center gap-2">
                                       <input
                                         type="time"
                                         value={s.shiftStart}
                                         onChange={(event) => updateShift(s.date, 'shiftStart', event.target.value)}
                                         className="w-24 rounded border border-emerald-500/15 bg-white px-2 py-1 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                                       />
                                       <span>-</span>
                                       <input
                                         type="time"
                                         value={s.shiftEnd}
                                         onChange={(event) => updateShift(s.date, 'shiftEnd', event.target.value)}
                                         className="w-24 rounded border border-emerald-500/15 bg-white px-2 py-1 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                                       />
                                     </div>
                                   ) : s.shiftStart && s.shiftEnd ? <span dir="ltr">{getShiftFrame(s)}</span> : t('dash.leave')}
                                 </td>
                                 <td className="p-3 font-mono text-xs text-slate-500 dark:text-slate-400">
                                   {canManageRoster ? (
                                     <div className="flex items-center gap-2">
                                       <Coffee className="h-4 w-4 text-emerald-500" />
                                       <input
                                         type="time"
                                         value={s.breakStart}
                                         onChange={(event) => updateShift(s.date, 'breakStart', event.target.value)}
                                         className="w-24 rounded border border-emerald-500/15 bg-white px-2 py-1 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                                       />
                                       <span>-</span>
                                       <input
                                         type="time"
                                         value={s.breakEnd}
                                         onChange={(event) => updateShift(s.date, 'breakEnd', event.target.value)}
                                         className="w-24 rounded border border-emerald-500/15 bg-white px-2 py-1 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                                       />
                                     </div>
                                   ) : s.breakStart && s.breakEnd ? <span dir="ltr">{s.breakStart} - {s.breakEnd}</span> : t('dash.noBreak')}
                                 </td>
                                 <td className="p-3 text-xs text-slate-600 dark:text-slate-300">
                                   {canManageRoster ? (
                                     <input
                                       value={s.type}
                                       onChange={(event) => updateShift(s.date, 'type', event.target.value)}
                                       className="w-36 rounded border border-emerald-500/15 bg-white px-2 py-1 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                                     />
                                   ) : (
                                     <span className="opacity-80">{displayShiftType(s.type)}</span>
                                   )}
                                 </td>
                                 <td className={cn("p-3", isRtl ? "text-left" : "text-right")}>
                                   <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider", !s.shiftStart || !s.shiftEnd ? "bg-neutral-100 dark:bg-black/45 text-neutral-500 dark:text-emerald-100/45" : "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30")}>
                                     {!s.shiftStart || !s.shiftEnd ? t('dash.abstained') : t('dash.scheduled')}
                                   </span>
                                 </td>
                               </tr>
                             ))}
                           </tbody>
                         </table>
                       </div>
                       </>
                       )}
                    </motion.div>
                )}

                {pendingRosterSave && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Scheduling warning">
                    <div className="w-full max-w-md rounded-xl border border-amber-400/25 bg-neutral-950 p-5 text-emerald-50 shadow-2xl">
                      <h3 className="text-sm font-bold uppercase tracking-widest text-amber-200">{t('dash.rosterSchedulingWarning')}</h3>
                      <div className="mt-3 space-y-2 text-xs text-emerald-100/70">
                        {pendingRosterSave.warnings.map((warning) => <p key={warning.code}>{warning.message}{warning.startDate && warning.endDate ? ` ${warning.startDate} - ${warning.endDate}.` : ''}{warning.thresholdMinutes ? ` ${Math.round((warning.proposedMinutes || 0) / 60)}h / ${Math.round(warning.thresholdMinutes / 60)}h.` : ''}</p>)}
                      </div>
                      <label className="mt-4 block text-[10px] font-bold uppercase tracking-widest text-emerald-100/55">{t('dash.rosterOverrideReason')}
                        <input id="roster-override-reason" className="mt-1 w-full rounded border border-emerald-500/20 bg-black/40 px-3 py-2 text-xs text-emerald-50" />
                      </label>
                      <div className="mt-4 flex justify-end gap-2">
                        <button type="button" onClick={() => setPendingRosterSave(null)} className="rounded border border-emerald-500/20 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-emerald-100/70">Cancel</button>
                        <button type="button" onClick={() => {
                          const reason = (document.getElementById('roster-override-reason') as HTMLInputElement | null)?.value || '';
                          const pending = pendingRosterSave;
                          setPendingRosterSave(null);
                          void persistRosterShift(pending.shift, pending.warnings.map((warning) => warning.code), reason);
                        }} className="rounded bg-amber-400 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-neutral-950">{t('dash.rosterScheduleAnyway')}</button>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'feed' && (
                   <motion.div initial={{opacity:0, y:5}} animate={{opacity:1, y:0}} className="bg-white dark:bg-[#0a1a17]/90 border border-emerald-500/15 dark:border-emerald-500/20 rounded-2xl p-4 shadow-xl backdrop-blur-sm min-h-[320px]">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
                            <Newspaper className="h-5 w-5 text-emerald-500" />
                            {t('dash.companyFeed')}
                          </h2>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            {t('dash.companyFeedSubtitle')}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            loadFeed();
                            loadAdminFeed();
                          }}
                          disabled={isOffline || feedLoading || adminFeedLoading}
                          className="rounded-lg border border-emerald-500/15 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-neutral-600 transition hover:border-emerald-300 hover:text-emerald-700 disabled:cursor-wait disabled:opacity-60 dark:border-emerald-500/15 dark:text-emerald-100/60"
                        >
                          {t('dash.refresh')}
                        </button>
                      </div>

                      <p className="mt-3 flex gap-2 rounded-lg border border-emerald-500/10 bg-black/15 px-3 py-2 text-[10px] leading-4 text-neutral-500 dark:text-emerald-100/45">
                        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
                        {t('demo.feed')}
                      </p>

                      {canPublishFeed && (
                        <div className="mt-4 rounded-xl border border-emerald-500/15 bg-white/70 p-4 dark:border-emerald-500/15 dark:bg-black/35">
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                            <input
                              value={feedForm.title}
                              onChange={(event) => updateFeedForm('title', event.target.value)}
                              placeholder={t('dash.postTitle')}
                              className="rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50 md:col-span-2"
                            />
                            <select
                              value={feedForm.postType}
                              onChange={(event) => updateFeedForm('postType', event.target.value)}
                              className="rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                            >
                              <option value="announcement">{t('enum.announcement')}</option>
                              <option value="event">{t('enum.event')}</option>
                              <option value="policy_update">{t('enum.policyUpdate')}</option>
                              <option value="general">{t('enum.general')}</option>
                            </select>
                            <select
                              value={feedForm.status}
                              onChange={(event) => updateFeedForm('status', event.target.value)}
                              className="rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                            >
                              <option value="published">{t('enum.published')}</option>
                              <option value="draft">{t('enum.draft')}</option>
                            </select>
                            <select
                              value={feedForm.visibility}
                              onChange={(event) => updateFeedForm('visibility', event.target.value)}
                              className="rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50 md:col-span-2"
                            >
                              <option value="all">{t('dash.everyone')}</option>
                              <option value="role:employee">{t('dash.roleEmployee')}</option>
                              <option value="role:manager">{t('dash.roleManager')}</option>
                              <option value="role:hr_admin">{t('dash.roleHrAdmin')}</option>
                              {companyLocations.map((location) => (
                                <option key={location.id} value={`location:${location.id}`}>
                                  {t('dash.locationPrefix')}: {location.name}
                                </option>
                              ))}
                            </select>
                            <div className="md:col-span-4">
                              <Suspense fallback={<div className="rounded-lg border border-emerald-500/15 bg-black/25 p-4 text-xs text-emerald-100/45">{t('dash.loadingEditor')}</div>}>
                                <RichTextEditor
                                  key={feedEditorKey}
                                  valueJson={feedForm.contentJson}
                                  onChange={updateFeedContent}
                                  placeholder={t('dash.writeAnnouncement')}
                                />
                              </Suspense>
                            </div>
                            <button
                              type="button"
                              onClick={submitFeedPost}
                              disabled={isOffline || feedSubmitting || !feedForm.title.trim() || !feedForm.contentText.trim()}
                              className="rounded bg-emerald-500 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-950 transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60 md:col-span-4"
                            >
                              {feedSubmitting ? t('dash.saving') : feedForm.status === 'published' ? t('dash.publishPost') : t('dash.saveDraft')}
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
                          <article key={post.id} className="rounded-xl border border-emerald-500/15 bg-white/70 p-4 dark:border-emerald-500/15 dark:bg-black/35">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{post.title}</h3>
                                <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                  {post.author_name || t('enum.hrAdmin')} · <span dir="ltr">{formatShortDateTime(post.published_at)}</span>
                                </p>
                              </div>
                              <span className="w-fit rounded-full border border-emerald-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:border-emerald-500/20 dark:text-emerald-300">
                                {displayEnum(post.post_type)}
                              </span>
                            </div>
                            {post.post_type === 'event' && (post.event_starts_at || post.event_ends_at) && (
                              <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200">
                                <span dir="ltr">{post.event_starts_at ? formatShortDateTime(post.event_starts_at) : t('dash.eventTimeTbd')}</span>
                                {post.event_ends_at ? ` - ${formatShortDateTime(post.event_ends_at)}` : ''}
                              </p>
                            )}
                            <Suspense fallback={<p className="mt-3 text-xs text-emerald-100/45">{post.content_text}</p>}>
                              <RichFeedContent contentJson={post.content_json ?? post.contentJson} contentText={post.content_text} />
                            </Suspense>
                          </article>
                        ))}

                        {!feedLoading && feedPosts.length === 0 && (
                          <p className="rounded-lg border border-emerald-500/15 p-6 text-center text-xs text-neutral-500 dark:border-emerald-500/15 dark:text-emerald-100/45">
                            {t('dash.noCompanyAnnouncements')}
                          </p>
                        )}

                        {feedLoading && (
                          <p className="rounded-lg border border-emerald-500/15 p-6 text-center text-xs text-neutral-500 dark:border-emerald-500/15 dark:text-emerald-100/45">
                            {t('dash.loadingCompanyFeed')}
                          </p>
                        )}
                      </div>

                      {canPublishFeed && (
                        <div className="mt-4 rounded-xl border border-emerald-500/15 bg-white/70 p-4 dark:border-emerald-500/15 dark:bg-black/30">
                          <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-700 dark:text-slate-300">{t('dash.managePosts')}</h3>
                          <div className="space-y-2">
                            {adminFeedPosts.map((post) => (
                              <div key={post.id} className="flex flex-col gap-2 rounded-lg border border-emerald-500/15 bg-white/70 p-3 dark:border-emerald-500/15 dark:bg-black/40 sm:flex-row sm:items-center sm:justify-between">
                                <div className="min-w-0">
                                  <p className="truncate text-xs font-bold text-slate-800 dark:text-slate-100">{post.title}</p>
                                  <p className="mt-1 text-[10px] uppercase tracking-widest text-slate-500">
                                    {displayEnum(post.post_type)} · <span dir="ltr">{formatShortDateTime(post.created_at)}</span>
                                  </p>
                                </div>
                                <select
                                  value={post.status}
                                  onChange={(event) => updateFeedStatus(post.id, event.target.value as FeedPostStatus)}
                                  disabled={isOffline || feedUpdatingId !== null}
                                  className="rounded border border-emerald-500/15 bg-white px-2 py-1 text-xs text-neutral-800 outline-none focus:border-emerald-400 disabled:opacity-60 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                                >
                                  <option value="draft">{t('enum.draft')}</option>
                                  <option value="published">{t('enum.published')}</option>
                                  <option value="archived">{t('enum.archived')}</option>
                                </select>
                              </div>
                            ))}

                            {!adminFeedLoading && adminFeedPosts.length === 0 && (
                              <p className="rounded-lg border border-emerald-500/15 p-4 text-center text-xs text-neutral-500 dark:border-emerald-500/15 dark:text-emerald-100/45">
                                {t('dash.noPostsToManage')}
                              </p>
                            )}

                            {adminFeedLoading && (
                              <p className="rounded-lg border border-emerald-500/15 p-4 text-center text-xs text-neutral-500 dark:border-emerald-500/15 dark:text-emerald-100/45">
                                {t('dash.loadingPosts')}
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                   </motion.div>
                )}

                {(activeTab === 'profile' || activeTab === 'resignations') && (
                   <motion.div initial={{opacity:0, y:5}} animate={{opacity:1, y:0}} className="bg-white dark:bg-[#0a1a17]/90 border border-emerald-500/15 dark:border-emerald-500/20 rounded-2xl p-4 shadow-xl backdrop-blur-sm min-h-[320px]">
                      <div className="flex items-center gap-3 mb-5">
                          <User className="w-7 h-7 text-emerald-600 dark:text-emerald-500" />
                          <div>
                            <h2 className="text-lg font-bold text-slate-900 dark:text-white">{profilePanelHeading}</h2>
                            <p className="text-xs text-emerald-600 dark:text-emerald-400 font-mono uppercase tracking-widest">{profilePanelSubtitle}</p>
                          </div>
                      </div>

                      {showPayrollPanel ? (
                        <div className="space-y-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <h3 className="text-sm font-bold uppercase tracking-widest text-slate-800 dark:text-slate-200">{t('profile.payroll')}</h3>
                              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                {canViewAllPayroll || canRunPayroll ? t('dash.payrollSubtitleAdmin') : t('dash.payrollSubtitleSelf')}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => setShowPayrollPanel(false)}
                              className="rounded-lg border border-emerald-500/15 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-neutral-600 transition hover:border-emerald-300 hover:text-emerald-700 dark:border-emerald-500/15 dark:text-emerald-100/60"
                            >
                              {t('dash.back')}
                            </button>
                          </div>

                          <p className="flex gap-2 rounded-lg border border-emerald-500/10 bg-black/15 px-3 py-2 text-[10px] leading-4 text-neutral-500 dark:text-emerald-100/45">
                            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
                            {t('demo.payroll')}
                          </p>

                          {(canManageCompensation || canRunPayroll) && (
                            <div className="space-y-3">
                              {canManageCompensation && (
                              <div className="rounded-xl border border-emerald-500/15 bg-white/70 p-4 dark:border-emerald-500/15 dark:bg-black/35">
                                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                  <div>
                                    <h4 className="text-xs font-black uppercase tracking-widest text-neutral-800 dark:text-emerald-50">{t('dash.compensationProfiles')}</h4>
                                    <p className="mt-1 text-[11px] text-neutral-500 dark:text-emerald-100/45">{t('dash.compensationProfilesHelp')}</p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={loadCompensationProfiles}
                                    disabled={isOffline || compensationLoading}
                                    className="rounded border border-emerald-500/20 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-emerald-700 transition hover:border-emerald-400 disabled:cursor-wait disabled:opacity-60 dark:text-emerald-300"
                                  >
                                    {compensationLoading ? t('dash.loading') : t('dash.refresh')}
                                  </button>
                                </div>

                                {missingCompensationProfiles.length > 0 && (
                                  <p className="mb-3 rounded-lg border border-amber-400/25 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-200">
                                    <span dir="ltr">{missingCompensationProfiles.length}</span> {t('dash.missingActiveCompensation')}
                                  </p>
                                )}

                                <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
                                  <select
                                    value={compensationForm.employeeId}
                                    onChange={(event) => selectCompensationEmployee(event.target.value)}
                                    className="rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50 md:col-span-2"
                                  >
                                    <option value="">{t('dash.selectEmployee')}</option>
                                    {compensationProfiles.map((profile) => (
                                      <option key={profile.employee_id} value={profile.employee_id}>
                                        {profile.full_name || profile.email || profile.employee_id}
                                      </option>
                                    ))}
                                  </select>
                                  <select
                                    value={compensationForm.payType}
                                    onChange={(event) => updateCompensationForm('payType', event.target.value as CompensationPayType)}
                                    className="rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                                  >
                                    {compensationPayTypes.map((payType) => (
                                      <option key={payType} value={payType}>{displayEnum(payType)}</option>
                                    ))}
                                  </select>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    placeholder={t('dash.baseAmount')}
                                    value={compensationForm.baseAmount}
                                    onChange={(event) => updateCompensationForm('baseAmount', event.target.value)}
                                    className="rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                                  />
                                  <input
                                    placeholder="USD"
                                    value={compensationForm.currency}
                                    onChange={(event) => updateCompensationForm('currency', event.target.value.toUpperCase().slice(0, 3))}
                                    className="rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                                  />
                                  <input
                                    type="date"
                                    value={compensationForm.effectiveFrom}
                                    onChange={(event) => updateCompensationForm('effectiveFrom', event.target.value)}
                                    className="rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                                  />
                                  <button
                                    type="button"
                                    onClick={saveCompensationProfile}
                                  disabled={isOffline || compensationSaving || !compensationForm.employeeId}
                                    className="rounded bg-emerald-500 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-black transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60 md:col-span-6"
                                  >
                                    {compensationSaving ? t('dash.saving') : t('dash.saveCompensation')}
                                  </button>
                                </div>

                                <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
                                  {compensationProfiles.map((profile) => (
                                    <div key={profile.employee_id} className="rounded-lg border border-emerald-500/10 bg-white/50 p-3 text-xs dark:bg-black/25">
                                      <div className="flex items-start justify-between gap-3">
                                        <div>
                                          <p className="font-bold text-neutral-800 dark:text-emerald-50">{profile.full_name || profile.email}</p>
                                          <p className="mt-0.5 text-[10px] text-neutral-500 dark:text-emerald-100/45"><span dir="ltr">{profile.email}</span> · {profile.role ? displayRole(profile.role) : t('enum.employee')}</p>
                                        </div>
                                        <span className={cn(
                                          "rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                                          profile.id
                                            ? "border-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                                            : "border-amber-400/25 text-amber-700 dark:text-amber-200"
                                        )}>
                                          {profile.id ? t('enum.active') : t('enum.missing')}
                                        </span>
                                      </div>
                                      <p className="mt-3 font-mono text-[11px] text-neutral-600 dark:text-emerald-100/60">
                                        {profile.id && profile.base_amount !== null && profile.base_amount !== undefined
                                          ? <><span dir="ltr">{formatPayrollAmount(profile.base_amount, profile.currency || 'USD')}</span> · {displayEnum(profile.pay_type || 'monthly')}</>
                                          : t('dash.noActiveCompensation')}
                                      </p>
                                      {profile.effective_from && (
                                        <p className="mt-1 text-[10px] text-neutral-500 dark:text-emerald-100/45">
                                          {t('dash.effective')} <span dir="ltr">{formatPayrollDate(profile.effective_from)}</span>
                                        </p>
                                      )}
                                    </div>
                                  ))}
                                  {!compensationLoading && compensationProfiles.length === 0 && (
                                    <p className="rounded-lg border border-emerald-500/10 p-3 text-xs text-neutral-500 dark:text-emerald-100/45">
                                      {t('dash.noEmployeesForCompensation')}
                                    </p>
                                  )}
                                </div>
                              </div>
                              )}

                              {canRunPayroll && (
                              <div className="rounded-xl border border-emerald-500/15 bg-white/70 p-4 dark:border-emerald-500/15 dark:bg-black/35">
                                <p className="mb-3 text-[11px] font-semibold text-neutral-500 dark:text-emerald-100/45">
                                  {t('dash.payrollRunHelp')}
                                </p>
                                <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
                                  <input
                                    type="date"
                                    aria-label={t('dash.payPeriodStart')}
                                    value={payrollForm.payPeriodStart}
                                    onChange={(event) => updatePayrollForm('payPeriodStart', event.target.value)}
                                    className="rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                                  />
                                  <input
                                    type="date"
                                    aria-label={t('dash.payPeriodEnd')}
                                    value={payrollForm.payPeriodEnd}
                                    onChange={(event) => updatePayrollForm('payPeriodEnd', event.target.value)}
                                    className="rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                                  />
                                  <input
                                    type="number"
                                    aria-label={t('dash.fallbackBaseSalary')}
                                    min="0"
                                    step="0.01"
                                    placeholder={t('dash.fallbackBaseSalary')}
                                    value={payrollForm.defaultBaseSalary}
                                    onChange={(event) => updatePayrollForm('defaultBaseSalary', event.target.value)}
                                    className="rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                                  />
                                  <div className="grid grid-cols-2 gap-2">
                                <input
                                  type="number"
                                  aria-label={t('dash.bonuses')}
                                  min="0"
                                  step="0.01"
                                  placeholder={t('dash.bonuses')}
                                  value={payrollForm.bonuses}
                                  onChange={(event) => updatePayrollForm('bonuses', event.target.value)}
                                  className="min-w-0 rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                                />
                                <input
                                  type="number"
                                  aria-label={t('dash.deductions')}
                                  min="0"
                                  step="0.01"
                                  placeholder={t('dash.deductions')}
                                  value={payrollForm.deductions}
                                  onChange={(event) => updatePayrollForm('deductions', event.target.value)}
                                  className="min-w-0 rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                                />
                              </div>
                              <button
                                type="button"
                                onClick={runPayroll}
                                disabled={isOffline || payrollSubmitting}
                                className="rounded bg-emerald-500 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-950 transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60"
                              >
                                {payrollSubmitting ? t('dash.generatingPayroll') : t('dash.runPayroll')}
                              </button>
                                </div>
                              </div>
                              )}
                            </div>
                          )}

                          <div className="rounded-xl border border-emerald-500/15 bg-white/70 p-4 dark:border-emerald-500/15 dark:bg-black/35">
                            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <h4 className="text-xs font-black uppercase tracking-widest text-neutral-800 dark:text-emerald-50">{t('dash.employeeLoans')}</h4>
                                <p className="mt-1 text-[11px] text-neutral-500 dark:text-emerald-100/45">
                                  {canManageLoans ? t('dash.employeeLoansAdminHelp') : t('dash.employeeLoansSelfHelp')}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={loadEmployeeLoans}
                                disabled={isOffline || loanLoading}
                                className="rounded border border-emerald-500/20 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-emerald-700 transition hover:border-emerald-400 disabled:cursor-wait disabled:opacity-60 dark:text-emerald-300"
                              >
                                {loanLoading ? t('dash.loading') : t('dash.refresh')}
                              </button>
                            </div>

                            {canManageLoans && (
                              <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-6">
                                <select
                                  value={loanForm.employeeId}
                                  onChange={(event) => updateLoanForm('employeeId', event.target.value)}
                                  className="rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50 md:col-span-2"
                                >
                                  <option value="">{t('dash.selectEmployee')}</option>
                                  {compensationProfiles.map((profile) => (
                                    <option key={profile.employee_id} value={profile.employee_id}>
                                      {profile.full_name || profile.email || profile.employee_id}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  value={loanForm.loanName}
                                  onChange={(event) => updateLoanForm('loanName', event.target.value)}
                                  placeholder={t('dash.loanName')}
                                  className="rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                                />
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={loanForm.principalAmount}
                                  onChange={(event) => updateLoanForm('principalAmount', event.target.value)}
                                  placeholder={t('dash.principal')}
                                  className="rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                                />
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={loanForm.repaymentAmount}
                                  onChange={(event) => updateLoanForm('repaymentAmount', event.target.value)}
                                  placeholder={t('dash.repayment')}
                                  className="rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                                />
                                <input
                                  value={loanForm.currency}
                                  onChange={(event) => updateLoanForm('currency', event.target.value.toUpperCase().slice(0, 3))}
                                  placeholder="USD"
                                  className="rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                                />
                                <select
                                  value={loanForm.repaymentFrequency}
                                  onChange={(event) => updateLoanForm('repaymentFrequency', event.target.value as LoanRepaymentFrequency)}
                                  className="rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50 md:col-span-2"
                                >
                                  {loanRepaymentFrequencies.map((frequency) => (
                                    <option key={frequency} value={frequency}>{displayEnum(frequency)}</option>
                                  ))}
                                </select>
                                <input
                                  type="date"
                                  value={loanForm.dueDate}
                                  onChange={(event) => updateLoanForm('dueDate', event.target.value)}
                                  className="rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                                />
                                <button
                                  type="button"
                                  onClick={createEmployeeLoan}
                                  disabled={isOffline || loanSaving || !loanForm.employeeId}
                                  className="rounded bg-emerald-500 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-black transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60 md:col-span-3"
                                >
                                  {loanSaving ? t('dash.creating') : t('dash.createLoan')}
                                </button>
                              </div>
                            )}

                            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                              {employeeLoans.map((loan) => (
                                <div key={loan.id} className="rounded-lg border border-emerald-500/10 bg-white/50 p-3 text-xs dark:bg-black/25">
                                  <div className="flex items-start justify-between gap-3">
                                    <div>
                                      <p className="font-bold text-neutral-800 dark:text-emerald-50">{loan.loan_name}</p>
                                      <p className="mt-0.5 text-[10px] text-neutral-500 dark:text-emerald-100/45">
                                        {canManageLoans ? `${loan.full_name || loan.email} - ` : ''}{displayEnum(loan.repayment_frequency)}
                                      </p>
                                    </div>
                                    {canManageLoans ? (
                                      <select
                                        value={loan.status}
                                        onChange={(event) => updateEmployeeLoanStatus(loan.id, event.target.value as LoanStatus)}
                                        disabled={isOffline || loanUpdatingId === loan.id}
                                        className="rounded border border-emerald-500/15 bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-neutral-700 outline-none focus:border-emerald-400 disabled:cursor-wait disabled:opacity-60 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                                      >
                                        {loanStatuses.map((status) => (
                                          <option key={status} value={status}>{displayEnum(status)}</option>
                                        ))}
                                      </select>
                                    ) : (
                                      <span className="rounded-full border border-emerald-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                                        {displayEnum(loan.status)}
                                      </span>
                                    )}
                                  </div>
                                  <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-neutral-600 dark:text-emerald-100/60">
                                    <p>{t('dash.principal')} <span className="block font-mono" dir="ltr">{formatPayrollAmount(loan.principal_amount, loan.currency)}</span></p>
                                    <p>{t('dash.outstanding')} <span className="block font-mono" dir="ltr">{formatPayrollAmount(loan.outstanding_balance, loan.currency)}</span></p>
                                    <p>{t('dash.repayment')} <span className="block font-mono" dir="ltr">{formatPayrollAmount(loan.repayment_amount, loan.currency)}</span></p>
                                    <p>{t('dash.due')} <span className="block font-mono" dir="ltr">{loan.due_date ? formatPayrollDate(loan.due_date) : t('dash.notSet')}</span></p>
                                  </div>
                                </div>
                              ))}
                              {!loanLoading && employeeLoans.length === 0 && (
                                <p className="rounded-lg border border-emerald-500/10 p-3 text-xs text-neutral-500 dark:text-emerald-100/45">
                                  {t('dash.noEmployeeLoans')}
                                </p>
                              )}
                            </div>
                          </div>

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

                          {loanDeductionsApplied > 0 && (
                            <p className="rounded-lg border border-emerald-500/20 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                              {t('dash.loanDeductionsApplied')}: <span dir="ltr">{formatPayrollAmount(loanDeductionsApplied, payrollRecords[0]?.currency || 'USD')}</span>
                            </p>
                          )}

                          {skippedPayrollEmployees.length > 0 && (
                            <div className="rounded-lg border border-amber-400/25 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-200">
                              <p className="font-bold uppercase tracking-widest">{t('dash.skippedEmployees')}</p>
                              <ul className="mt-2 space-y-1">
                                {skippedPayrollEmployees.map((employee) => (
                                  <li key={employee.employeeId}>
                                    <span dir="ltr">{employee.email}</span>: {employee.reason === 'Missing active compensation profile and no fallback base salary was provided.'
                                      ? t('dash.missingCompensationSkip')
                                      : employee.reason}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          <div className="overflow-x-auto rounded-xl border border-emerald-500/15 dark:border-emerald-500/15">
                            <table className={cn("w-full min-w-[760px]", isRtl ? "text-right" : "text-left")}>
                              <thead>
                                <tr className="border-b border-emerald-500/15 bg-white/70 text-[10px] font-bold uppercase tracking-widest text-neutral-500 dark:border-emerald-500/15 dark:bg-black/35 dark:text-emerald-100/45">
                                  <th className="p-3">{t('dash.employee')}</th>
                                  <th className="p-3">{t('dash.period')}</th>
                                  <th className="p-3">{t('dash.base')}</th>
                                  <th className="p-3">{t('dash.bonus')}</th>
                                  <th className="p-3">{t('dash.deductions')}</th>
                                  <th className="p-3">{t('dash.net')}</th>
                                  <th className="p-3">{t('dash.status')}</th>
                                  {canShowPayrollActions && <th className="p-3">{t('dash.actions')}</th>}
                                  <th className="p-3">{t('dash.export')}</th>
                                </tr>
                              </thead>
                              <tbody className="text-xs">
                                {payrollRecords.map((record) => (
                                  <tr key={record.id} className="border-b border-emerald-500/10 text-neutral-700 last:border-0 dark:border-emerald-500/10 dark:text-emerald-100/65">
                                    <td className="p-3 font-semibold">
                                      {record.full_name || user.name}
                                      <span className="block text-[10px] font-normal text-slate-500" dir="ltr">{record.email || user.email}</span>
                                    </td>
                                    <td className="p-3 font-mono text-[11px]">
                                      <span dir="ltr">{formatPayrollDate(record.pay_period_start)} - {formatPayrollDate(record.pay_period_end)}</span>
                                    </td>
                                    <td className="p-3" dir="ltr">{formatPayrollAmount(record.base_salary, record.currency)}</td>
                                    <td className="p-3" dir="ltr">{formatPayrollAmount(record.bonuses, record.currency)}</td>
                                    <td className="p-3" dir="ltr">{formatPayrollAmount(record.deductions, record.currency)}</td>
                                    <td className="p-3 font-bold text-emerald-700 dark:text-emerald-300" dir="ltr">{formatPayrollAmount(record.net_pay, record.currency)}</td>
                                    <td className="p-3">
                                      <span className="rounded-full border border-emerald-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:border-emerald-500/20 dark:text-emerald-300">
                                        {displayEnum(record.status)}
                                      </span>
                                      {record.approved_at && (
                                        <span className="mt-1 block text-[10px] font-normal text-neutral-500 dark:text-emerald-100/45">
                                          {t('dash.approvedAt')} <span dir="ltr">{formatPayrollDate(record.approved_at)}</span>
                                        </span>
                                      )}
                                      {record.paid_at && (
                                        <span className="mt-1 block text-[10px] font-normal text-neutral-500 dark:text-emerald-100/45">
                                          {t('dash.paidAt')} <span dir="ltr">{formatPayrollDate(record.paid_at)}</span>
                                        </span>
                                      )}
                                      {record.cancelled_at && (
                                        <span className="mt-1 block text-[10px] font-normal text-neutral-500 dark:text-emerald-100/45">
                                          {t('dash.cancelledAt')} <span dir="ltr">{formatPayrollDate(record.cancelled_at)}</span>
                                        </span>
                                      )}
                                    </td>
                                    {canShowPayrollActions && (
                                      <td className="p-3">
                                        {getAllowedPayrollStatuses(record.status).length > 0 ? (
                                          <div className="flex flex-wrap gap-2">
                                            {getAllowedPayrollStatuses(record.status).map((status) => (
                                              <button
                                                key={status}
                                                type="button"
                                                onClick={() => updatePayrollStatus(record.id, status)}
                                                disabled={isOffline || payrollStatusUpdatingId === record.id}
                                                className="rounded border border-emerald-200 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-700 transition hover:border-emerald-400 disabled:cursor-wait disabled:opacity-60 dark:border-emerald-500/20 dark:text-emerald-300"
                                              >
                                                {payrollStatusUpdatingId === record.id ? t('dash.updating') : displayEnum(status)}
                                              </button>
                                            ))}
                                          </div>
                                        ) : (
                                          <span className="text-[10px] uppercase tracking-widest text-neutral-400 dark:text-emerald-100/35">{t('dash.final')}</span>
                                        )}
                                      </td>
                                    )}
                                    <td className="p-3">
                                      {canExportPayrollRecord(record) ? (
                                        <button
                                          type="button"
                                          onClick={() => exportPayrollPdf(record.id)}
                                          disabled={isOffline || payrollExportingId !== null}
                                          className="rounded border border-emerald-200 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-700 transition hover:border-emerald-400 disabled:cursor-wait disabled:opacity-60 dark:border-emerald-500/20 dark:text-emerald-300"
                                        >
                                          {payrollExportingId === record.id ? t('dash.exporting') : t('dash.exportPdf')}
                                        </button>
                                      ) : (
                                        <span className="text-[10px] uppercase tracking-widest text-neutral-400 dark:text-emerald-100/35">{t('dash.noAccess')}</span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                                {!payrollLoading && payrollRecords.length === 0 && (
                                  <tr>
                                    <td colSpan={payrollTableColSpan} className="p-6 text-center text-xs text-slate-500">
                                      {canUsePayrollPanel ? t('dash.noPayrollRecords') : t('dash.noPayrollAccess')}
                                    </td>
                                  </tr>
                                )}
                                {payrollLoading && (
                                  <tr>
                                    <td colSpan={payrollTableColSpan} className="p-6 text-center text-xs text-slate-500">
                                      {t('dash.loadingPayroll')}
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : activeTab === 'resignations' && showResignationsPanel ? (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between gap-3"><div><h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-slate-800 dark:text-slate-200"><FileText className="h-4 w-4 text-emerald-500" />{t('dash.resignations')}</h3><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('dash.resignationsHelp')}</p></div><button type="button" onClick={() => setShowResignationsPanel(false)} className="rounded-lg border border-emerald-500/15 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-neutral-600 dark:text-emerald-100/60">{t('dash.back')}</button></div>
                          <div className="rounded-xl border border-emerald-500/15 bg-white/70 p-4 dark:bg-black/35">
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                              <label><span className="text-[10px] font-bold uppercase tracking-widest text-neutral-500 dark:text-emerald-100/45">{t('dash.lastWorkingDay')}</span><input type="date" value={resignationForm.requestedLastWorkingDay} onChange={(event) => setResignationForm((current) => ({ ...current, requestedLastWorkingDay: event.target.value }))} className="mt-1 w-full rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 dark:bg-black/40 dark:text-emerald-50" /></label>
                              <label><span className="text-[10px] font-bold uppercase tracking-widest text-neutral-500 dark:text-emerald-100/45">{t('dash.resignationType')}</span><select value={resignationForm.resignationType} onChange={(event) => setResignationForm((current) => ({ ...current, resignationType: event.target.value }))} className="mt-1 w-full rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 dark:bg-black/40 dark:text-emerald-50"><option value="voluntary">{t('dash.voluntary')}</option><option value="personal_reasons">{t('dash.personalReasons')}</option><option value="career_change">{t('dash.careerChange')}</option><option value="other">{t('dash.other')}</option></select></label>
                              <label className="md:col-span-2"><span className="text-[10px] font-bold uppercase tracking-widest text-neutral-500 dark:text-emerald-100/45">{t('dash.reason')}</span><textarea value={resignationForm.reason} maxLength={2000} onChange={(event) => setResignationForm((current) => ({ ...current, reason: event.target.value }))} rows={2} className="mt-1 w-full rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 dark:bg-black/40 dark:text-emerald-50" /></label>
                              <button type="button" onClick={submitResignation} disabled={isOffline || resignationSubmitting} className="rounded bg-emerald-500 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-950 disabled:opacity-60 md:col-span-4">{resignationSubmitting ? t('dash.submitting') : t('dash.submitResignation')}</button>
                            </div>
                          </div>
                          {resignationMessage && <p className={cn("rounded-lg border px-3 py-2 text-xs font-semibold", resignationMessageType === 'success' ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300")}>{resignationMessage}</p>}
                          <div className="rounded-xl border border-emerald-500/15 bg-white/70 p-4 dark:bg-black/30"><div className="mb-3 flex items-center justify-between"><h4 className="text-xs font-bold uppercase tracking-widest text-slate-700 dark:text-slate-300">{t('dash.myResignations')}</h4><button type="button" onClick={loadResignations} className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-300">{t('dash.refresh')}</button></div><div className="space-y-2">{myResignations.map((request) => <div key={request.id} className="rounded-lg border border-emerald-500/15 p-3 text-xs"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-bold text-slate-800 dark:text-slate-100">{displayEnum(request.resignation_type)}</p><p className="mt-1 text-neutral-500 dark:text-emerald-100/45">{t('dash.lastWorkingDay')}: <span dir="ltr">{request.requested_last_working_day}</span></p>{request.reason && <p className="mt-1 text-neutral-500 dark:text-emerald-100/45">{request.reason}</p>}</div><div className="flex items-center gap-2"><span className="rounded-full border border-emerald-500/20 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700 dark:text-emerald-300">{displayEnum(request.status)}</span>{request.status === 'pending' && <button type="button" onClick={() => updateResignation(request.id, 'withdraw')} disabled={resignationUpdatingId === request.id} className="text-[10px] font-bold uppercase text-red-600 dark:text-red-300">{t('dash.withdraw')}</button>}</div></div>{request.review_note && <p className="mt-2 text-[11px] text-neutral-500 dark:text-emerald-100/45">{request.review_note}</p>}</div>)}{!resignationsLoading && myResignations.length === 0 && <p className="p-4 text-center text-xs text-neutral-500 dark:text-emerald-100/45">{t('dash.noResignationRequests')}</p>}</div></div>
                          {canReviewResignations && <div className="rounded-xl border border-emerald-500/15 bg-white/70 p-4 dark:bg-black/30"><h4 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-700 dark:text-slate-300">{t('dash.tenantResignations')}</h4><div className="space-y-2">{tenantResignations.map((request) => <div key={request.id} className="rounded-lg border border-emerald-500/15 p-3 text-xs"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><p className="font-bold text-slate-800 dark:text-slate-100">{request.full_name || request.employee_id}</p><p className="text-[10px] text-neutral-500 dark:text-emerald-100/45" dir="ltr">{request.email}</p><p className="mt-1 text-neutral-500 dark:text-emerald-100/45">{t('dash.lastWorkingDay')}: <span dir="ltr">{request.requested_last_working_day}</span> · {request.reason}</p></div><div className="flex flex-wrap gap-2">{request.status === 'pending' && <><button type="button" onClick={() => updateResignation(request.id, 'review', { status: 'approved' })} className="rounded border border-emerald-500/20 px-2 py-1 text-[10px] font-bold uppercase text-emerald-700 dark:text-emerald-300">{t('dash.approve')}</button><button type="button" onClick={() => updateResignation(request.id, 'review', { status: 'rejected' })} className="rounded border border-red-500/20 px-2 py-1 text-[10px] font-bold uppercase text-red-600 dark:text-red-300">{t('dash.reject')}</button></>}{request.status === 'approved' && canProcessResignations && <button type="button" onClick={() => updateResignation(request.id, 'process')} className="rounded border border-emerald-500/20 px-2 py-1 text-[10px] font-bold uppercase text-emerald-700 dark:text-emerald-300">{t('dash.markProcessed')}</button>}</div></div></div>)}{!resignationsLoading && tenantResignations.length === 0 && <p className="p-4 text-center text-xs text-neutral-500 dark:text-emerald-100/45">{t('dash.noResignationRequests')}</p>}</div></div>}
                        </div>
                      ) : activeTab === 'profile' && showGrievancesPanel ? (
                        <div className="space-y-5">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-slate-800 dark:text-slate-200">
                                <MessageSquare className="h-4 w-4 text-emerald-500" />
                                {t('dash.grievances')}
                              </h3>
                              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                {grievanceForm.category === 'leave_request'
                                  ? t('dash.grievancesSubtitleLeave')
                                  : canManageGrievances ? t('dash.grievancesSubtitleAdmin') : t('dash.grievancesSubtitleSelf')}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => setShowGrievancesPanel(false)}
                              className="rounded-lg border border-emerald-500/15 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-neutral-600 transition hover:border-emerald-300 hover:text-emerald-700 dark:border-emerald-500/15 dark:text-emerald-100/60"
                            >
                              Back
                            </button>
                          </div>

                          <p className="flex gap-2 rounded-lg border border-emerald-500/10 bg-black/15 px-3 py-2 text-[10px] leading-4 text-neutral-500 dark:text-emerald-100/45">
                            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
                            {t('demo.grievances')}
                          </p>

                          <div className="rounded-xl border border-emerald-500/15 bg-white/70 p-4 dark:border-emerald-500/15 dark:bg-black/35">
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                              <input
                                value={grievanceForm.title}
                                onChange={(event) => updateGrievanceForm('title', event.target.value)}
                                placeholder={t('dash.title')}
                                className="rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50 md:col-span-2"
                              />
                              <input
                                value={grievanceForm.category}
                                onChange={(event) => updateGrievanceForm('category', event.target.value)}
                                placeholder={t('dash.categoryLabel')}
                                className="rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                              />
                              <select
                                value={grievanceForm.priority}
                                onChange={(event) => updateGrievanceForm('priority', event.target.value)}
                                className="rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                              >
                                <option value="low">{t('enum.low')}</option>
                                <option value="normal">{t('enum.normal')}</option>
                                <option value="high">{t('enum.high')}</option>
                                <option value="urgent">{t('enum.urgent')}</option>
                              </select>
                              <textarea
                                value={grievanceForm.description}
                                onChange={(event) => updateGrievanceForm('description', event.target.value)}
                                placeholder={t('dash.description')}
                                rows={4}
                                className="rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50 md:col-span-4"
                              />
                              <button
                                type="button"
                                onClick={submitGrievance}
                                disabled={isOffline || grievanceSubmitting}
                                className="rounded bg-emerald-500 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-950 transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60 md:col-span-4"
                              >
                                {grievanceSubmitting ? t('dash.submitting') : grievanceForm.category === 'leave_request' ? t('dash.submitLeaveRequest') : t('dash.submitGrievance')}
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

                          <div className="rounded-xl border border-emerald-500/15 bg-white/70 p-4 dark:border-emerald-500/15 dark:bg-black/30">
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <h4 className="text-xs font-bold uppercase tracking-widest text-slate-700 dark:text-slate-300">{t('dash.myGrievances')}</h4>
                              <button
                                type="button"
                                onClick={() => loadGrievances()}
                                disabled={isOffline || grievanceLoading || tenantGrievanceLoading}
                                className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 transition hover:text-emerald-500 disabled:opacity-60 dark:text-emerald-300"
                              >
                                {t('dash.refresh')}
                              </button>
                            </div>

                            <div className="space-y-3">
                              {myGrievances.map((grievance) => (
                                <div key={grievance.id} className="rounded-lg border border-emerald-500/15 bg-white/70 p-3 dark:border-emerald-500/15 dark:bg-black/40">
                                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                    <div>
                                      <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{grievance.title}</p>
                                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{grievance.description}</p>
                                    </div>
                                    <span className="w-fit rounded-full border border-emerald-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:border-emerald-500/20 dark:text-emerald-300">
                                      {displayEnum(grievance.status)}
                                    </span>
                                  </div>
                                  <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                    <span>{displayEnum(grievance.category)}</span>
                                    <span>{displayEnum(grievance.priority)}</span>
                                    <span dir="ltr">{formatShortDateTime(grievance.created_at)}</span>
                                  </div>
                                </div>
                              ))}

                              {!grievanceLoading && myGrievances.length === 0 && (
                                <p className="rounded-lg border border-emerald-500/15 p-6 text-center text-xs text-neutral-500 dark:border-emerald-500/15 dark:text-emerald-100/45">
                                  {t('dash.noGrievances')}
                                </p>
                              )}

                              {grievanceLoading && (
                                <p className="rounded-lg border border-emerald-500/15 p-6 text-center text-xs text-neutral-500 dark:border-emerald-500/15 dark:text-emerald-100/45">
                                  {t('dash.loadingMyGrievances')}
                                </p>
                              )}
                            </div>
                          </div>

                          {canManageGrievances && (
                            <div className="rounded-xl border border-emerald-500/15 bg-white/70 p-4 dark:border-emerald-500/15 dark:bg-black/30">
                              <h4 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-700 dark:text-slate-300">{t('dash.tenantGrievances')}</h4>
                              <div className="overflow-x-auto">
                                <table className={cn("w-full min-w-[860px]", isRtl ? "text-right" : "text-left")}>
                                  <thead>
                                    <tr className="border-b border-emerald-500/15 text-[10px] font-bold uppercase tracking-widest text-neutral-500 dark:border-emerald-500/15 dark:text-emerald-100/45">
                                      <th className="p-3">{t('dash.employee')}</th>
                                      <th className="p-3">{t('dash.case')}</th>
                                      <th className="p-3">{t('dash.priority')}</th>
                                      <th className="p-3">{t('dash.status')}</th>
                                      <th className="p-3">{t('dash.created')}</th>
                                      <th className="p-3">{t('dash.update')}</th>
                                    </tr>
                                  </thead>
                                  <tbody className="text-xs">
                                    {tenantGrievances.map((grievance) => (
                                      <tr key={grievance.id} className="border-b border-emerald-500/10 text-neutral-700 last:border-0 dark:border-emerald-500/10 dark:text-emerald-100/65">
                                        <td className="p-3 font-semibold">
                                          {grievance.full_name || t('dash.employee')}
                                          <span className="block text-[10px] font-normal text-slate-500" dir="ltr">{grievance.email || grievance.employee_id}</span>
                                        </td>
                                        <td className="p-3">
                                          <span className="block font-bold text-slate-800 dark:text-slate-100">{grievance.title}</span>
                                          <span className="mt-1 block max-w-[280px] truncate text-[10px] text-slate-500">{grievance.description}</span>
                                        </td>
                                        <td className="p-3">{displayEnum(grievance.priority)}</td>
                                        <td className="p-3">{displayEnum(grievance.status)}</td>
                                        <td className="p-3 font-mono text-[11px]" dir="ltr">{formatShortDateTime(grievance.created_at)}</td>
                                        <td className="p-3">
                                          <select
                                            value={grievance.status}
                                            onChange={(event) => updateGrievanceStatus(grievance.id, event.target.value as GrievanceStatus)}
                                            disabled={isOffline || grievanceUpdatingId !== null}
                                            className="rounded border border-emerald-500/15 bg-white px-2 py-1 text-xs text-neutral-800 outline-none focus:border-emerald-400 disabled:opacity-60 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                                          >
                                            {grievanceStatuses.map((status) => (
                                              <option key={status} value={status}>{displayEnum(status)}</option>
                                            ))}
                                          </select>
                                        </td>
                                      </tr>
                                    ))}

                                    {!tenantGrievanceLoading && tenantGrievances.length === 0 && (
                                      <tr>
                                        <td colSpan={6} className="p-6 text-center text-xs text-slate-500">
                                          {t('dash.noTenantGrievances')}
                                        </td>
                                      </tr>
                                    )}

                                    {tenantGrievanceLoading && (
                                      <tr>
                                        <td colSpan={6} className="p-6 text-center text-xs text-slate-500">
                                          {t('dash.loadingTenantGrievances')}
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
                         <div className="rounded-xl border border-emerald-500/15 bg-white/70 p-4 dark:bg-black/35 md:col-span-2">
                           <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                             <div className="flex min-w-0 items-center gap-4">
                               <UserAvatar name={user.name} imageUrl={user.profileImageUrl} className="h-20 w-20" />
                               <div className="min-w-0">
                                 <h3 className="text-sm font-black uppercase tracking-widest text-neutral-800 dark:text-emerald-50">{t('profile.photo')}</h3>
                                 <p className="mt-1 text-xs text-neutral-500 dark:text-emerald-100/50">{t('profile.photoHelp')}</p>
                               </div>
                             </div>
                             <div className="flex flex-wrap gap-2">
                               <label className={cn(
                                 "inline-flex cursor-pointer items-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-black text-black transition hover:bg-emerald-400 focus-within:ring-2 focus-within:ring-emerald-300",
                                 (isOffline || profilePhotoSaving) && "pointer-events-none opacity-50",
                               )}>
                                 <Camera className="h-4 w-4" aria-hidden="true" />
                                 {user.profileImageUrl ? t('profile.changePhoto') : t('profile.uploadPhoto')}
                                 <input
                                   type="file"
                                   accept="image/jpeg,image/png,image/webp"
                                   onChange={handleProfilePhotoSelection}
                                   disabled={isOffline || profilePhotoSaving}
                                   aria-label={user.profileImageUrl ? t('profile.changePhoto') : t('profile.uploadPhoto')}
                                   className="sr-only"
                                 />
                               </label>
                               {user.profileImageUrl && (
                                 <button
                                   type="button"
                                   onClick={() => void removeProfilePhoto()}
                                   disabled={isOffline || profilePhotoSaving}
                                   className="inline-flex items-center gap-2 rounded-lg border border-red-500/20 px-3 py-2 text-xs font-bold text-red-600 transition hover:border-red-400 disabled:cursor-wait disabled:opacity-50 dark:text-red-300"
                                 >
                                   <Trash2 className="h-4 w-4" aria-hidden="true" />
                                   {t('profile.removePhoto')}
                                 </button>
                               )}
                             </div>
                           </div>
                           {profilePhotoMessage && (
                             <p className={cn(
                               "mt-3 rounded-lg border px-3 py-2 text-xs font-semibold",
                               profilePhotoMessageType === 'success'
                                 ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                 : "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300",
                             )} role="status">
                               {profilePhotoMessage}
                             </p>
                           )}
                         </div>

                         <div className="md:col-span-2">
                           {renderNotificationSettingsPanel()}
                         </div>

                         {canManageRoles && (
                           <div className="bg-white/70 dark:bg-black/35 border border-emerald-500/15 dark:border-emerald-500/15 p-4 rounded-xl md:col-span-2">
                             <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                               <div>
                                 <p className="text-sm font-bold uppercase tracking-widest text-slate-800 dark:text-slate-200">{t('dash.rolesPermissions')}</p>
                                 <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('dash.rolesPermissionsHelp')}</p>
                               </div>
                               <button
                                 type="button"
                                 onClick={loadRoleManagement}
                                 disabled={isOffline || rolesLoading}
                                 className="rounded-lg border border-emerald-200 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-emerald-700 transition hover:border-emerald-400 disabled:cursor-wait disabled:opacity-60 dark:border-emerald-500/20 dark:text-emerald-300"
                               >
                                 {rolesLoading ? t('dash.loading') : t('dash.refresh')}
                               </button>
                             </div>

                             {roleMessage && (
                               <p className={cn(
                                 "mb-3 rounded-lg border px-3 py-2 text-xs font-semibold",
                                 roleMessageType === 'success'
                                   ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300"
                                   : "border-red-200 bg-red-50 text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300"
                               )}>
                                 {roleMessage}
                               </p>
                             )}

                             <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
                               <div className="space-y-3">
                                 <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                                   {tenantRoles.map((role) => (
                                     <div key={role.id} className="rounded-lg border border-emerald-500/10 bg-white/60 p-3 text-xs dark:bg-black/25">
                                       <div className="flex items-start justify-between gap-3">
                                         <div>
                                           <p className="font-bold text-neutral-800 dark:text-emerald-50">{role.name}</p>
                                           <p className="mt-0.5 text-[10px] text-neutral-500 dark:text-emerald-100/45">
                                             {role.is_system ? t('dash.systemRole') : t('dash.customRole')} &bull; <span dir="ltr">{role.assigned_employee_count || 0}</span> {t('dash.assigned')}
                                           </p>
                                         </div>
                                         <span className="rounded-full border border-emerald-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                                           {role.system_key ? displayRole(role.system_key) : t('dash.custom')}
                                         </span>
                                       </div>
                                       <div className="mt-3 flex flex-wrap gap-1">
                                         {role.permissions.map((permission) => (
                                           <span key={permission} className="rounded border border-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold text-neutral-500 dark:text-emerald-100/45">
                                             {permission}
                                           </span>
                                         ))}
                                         {role.permissions.length === 0 && (
                                           <span className="text-[10px] text-neutral-500 dark:text-emerald-100/40">{t('dash.noPermissions')}</span>
                                         )}
                                       </div>
                                     </div>
                                   ))}
                                 </div>

                                 <div className="rounded-lg border border-emerald-500/10 bg-white/60 p-3 dark:bg-black/25">
                                   <p className="mb-3 text-xs font-bold uppercase tracking-widest text-neutral-800 dark:text-emerald-50">{t('dash.employeeAssignments')}</p>
                                   <div className="space-y-2">
                                     {roleEmployees.map((employee) => (
                                       <div key={employee.id} className="rounded border border-emerald-500/10 p-3">
                                         <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                                           <div>
                                             <p className="text-xs font-bold text-neutral-800 dark:text-emerald-50">{employee.full_name}</p>
                                             <p className="text-[10px] text-neutral-500 dark:text-emerald-100/45">
                                               <span dir="ltr" className="inline-block max-w-full truncate text-left">{employee.email}</span> &bull; {displayRole(employee.role)}
                                             </p>
                                             <p className="mt-1 text-[10px] text-emerald-700/70 dark:text-emerald-100/55">
                                               {employee.assigned_roles.map((role) => role.name).join(', ') || t('dash.noCustomAssignments')}
                                             </p>
                                           </div>
                                           <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] lg:w-[420px]">
                                             <select
                                               defaultValue=""
                                               onChange={(event) => assignEmployeeRole(employee.id, event.target.value)}
                                               disabled={isOffline || roleUpdatingEmployeeId === employee.id}
                                               className="rounded border border-emerald-500/15 bg-white px-2 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 disabled:opacity-60 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                                             >
                                               <option value="">{t('dash.assignRole')}</option>
                                               {tenantRoles.map((role) => (
                                                 <option key={role.id} value={role.id}>{role.name}</option>
                                               ))}
                                             </select>
                                             <button
                                               type="button"
                                               onClick={() => saveEmployeeTitle(employee.id)}
                                               disabled={isOffline || roleUpdatingEmployeeId === employee.id}
                                               className="rounded border border-emerald-500/20 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-emerald-700 transition hover:border-emerald-400 disabled:cursor-wait disabled:opacity-60 dark:text-emerald-300"
                                             >
                                               {t('dash.saveTitle')}
                                             </button>
                                             <input
                                               value={titleDrafts[employee.id] || ''}
                                               onChange={(event) => setTitleDrafts((current) => ({ ...current, [employee.id]: event.target.value }))}
                                               placeholder={t('dash.jobTitle')}
                                               className="rounded border border-emerald-500/15 bg-white px-2 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50 sm:col-span-2"
                                             />
                                           </div>
                                         </div>
                                       </div>
                                     ))}
                                   </div>
                                 </div>
                               </div>

                               <div className="rounded-lg border border-emerald-500/10 bg-white/60 p-3 dark:bg-black/25">
                                 <p className="mb-3 text-xs font-bold uppercase tracking-widest text-neutral-800 dark:text-emerald-50">{t('dash.createCustomRole')}</p>
                                 <div className="space-y-2">
                                   <input
                                     value={roleForm.name}
                                     onChange={(event) => setRoleForm((current) => ({ ...current, name: event.target.value }))}
                                     placeholder={t('dash.roleName')}
                                     className="w-full rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                                   />
                                   <textarea
                                     value={roleForm.description}
                                     onChange={(event) => setRoleForm((current) => ({ ...current, description: event.target.value }))}
                                     placeholder={t('dash.description')}
                                     rows={3}
                                     className="w-full rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                                   />
                                   <div className="max-h-56 space-y-1 overflow-y-auto rounded border border-emerald-500/10 p-2">
                                     {tenantPermissions.map((permission) => (
                                       <label key={permission.permission_key} className="flex items-start gap-2 rounded px-2 py-1 text-xs text-neutral-600 hover:bg-emerald-500/5 dark:text-emerald-100/60">
                                         <input
                                           type="checkbox"
                                           checked={roleForm.permissionKeys.includes(permission.permission_key)}
                                           onChange={() => toggleRolePermission(permission.permission_key)}
                                           className="mt-0.5 h-3.5 w-3.5 accent-emerald-500"
                                         />
                                         <span>
                                           <span className="block font-bold text-neutral-700 dark:text-emerald-50">{permission.permission_key}</span>
                                           <span className="block text-[10px] text-neutral-500 dark:text-emerald-100/40">{permission.label}</span>
                                         </span>
                                       </label>
                                     ))}
                                   </div>
                                   <button
                                     type="button"
                                     onClick={createTenantRole}
                                     disabled={isOffline || roleSaving || !roleForm.name.trim()}
                                     className="w-full rounded bg-emerald-500 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-black transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60"
                                   >
                                     {roleSaving ? t('dash.creating') : t('dash.createRole')}
                                   </button>
                                 </div>
                               </div>
                             </div>
                           </div>
                         )}

                         <div className="bg-white/70 dark:bg-black/35 border border-emerald-500/15 dark:border-emerald-500/15 p-4 rounded-xl flex flex-col justify-between">
                            <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">{t('profile.leaveName')}</p>
                            <p className="text-3xl font-bold text-slate-800 dark:text-white">24.5 <span className="text-sm text-slate-500 font-normal">{t('profile.leaveDays')}</span></p>
                            <div className="w-full h-1 bg-neutral-200 dark:bg-black/60 mt-3 rounded-full overflow-hidden">
                              <div className="w-[70%] h-full bg-emerald-500"></div>
                            </div>
                         </div>
                         <div className="bg-white/70 dark:bg-black/35 border border-emerald-500/15 dark:border-emerald-500/15 p-4 rounded-xl flex flex-col justify-between">
                            <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">{t('profile.loan')}</p>
                            <p className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                               <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-500" />
                               {t('dash.profileLoanCleared')}
                            </p>
                            <p className="text-[10px] text-emerald-600 dark:text-emerald-500 mt-1 font-mono uppercase tracking-widest">{t('dash.noActiveLiabilities')}</p>
                         </div>
                      </div>
                      )}
                   </motion.div>
                )}

            </div>

        </div>
      </main>
      {profilePhotoFile && (
        <Suspense fallback={null}>
          <ProfilePhotoCropDialog
            file={profilePhotoFile}
            saving={profilePhotoSaving}
            labels={{
              title: t('profile.cropPhoto'),
              zoom: t('profile.zoom'),
              cancel: t('profile.cancel'),
              save: t('profile.savePhoto'),
            }}
            onCancel={() => !profilePhotoSaving && setProfilePhotoFile(null)}
            onSave={(blob) => void uploadProfilePhoto(blob)}
          />
        </Suspense>
      )}
    </div>
  );
}
