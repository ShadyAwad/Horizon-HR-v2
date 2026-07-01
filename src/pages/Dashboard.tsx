import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Fingerprint, LogOut, MapPin, Map, Navigation, 
  Calendar, CheckCircle2, AlertTriangle, User, Sun, Moon, Bell, Coffee, Save, DollarSign, MessageSquare, Newspaper
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useLanguage } from '../lib/LanguageContext';
import { useTheme } from '../lib/ThemeContext';
import { apiUrl } from '../lib/api';
import { BrandWordmark } from '../components/BrandWordmark';
import { RichFeedContent, RichTextEditor } from '../components/RichTextEditor';
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
  channel: NotificationChannel;
  notificationKey: NotificationKey;
  enabled: boolean;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
};

type NotificationChannel = 'in_app' | 'email' | 'push';
type NotificationKey =
  | 'attendance_reminders'
  | 'break_reminders'
  | 'leave_updates'
  | 'payroll_updates'
  | 'loan_updates'
  | 'grievance_updates'
  | 'company_feed_posts'
  | 'role_permission_changes'
  | 'system_alerts';

type PayrollStatus = 'draft' | 'approved' | 'paid' | 'cancelled';

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

const notificationChannels: Array<{ key: NotificationChannel; label: string }> = [
  { key: 'in_app', label: 'In-app' },
  { key: 'email', label: 'Email' },
  { key: 'push', label: 'Push' },
];

const notificationCategories: Array<{ key: NotificationKey; label: string; description: string }> = [
  { key: 'attendance_reminders', label: 'Attendance reminders', description: 'Clock-in, clock-out, and attendance perimeter prompts.' },
  { key: 'break_reminders', label: 'Break reminders', description: 'Scheduled break start and return reminders.' },
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
  return defaultNotificationSettings;
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

function getNextPayrollStatuses(status: PayrollStatus): PayrollStatus[] {
  if (status === 'draft') return ['approved', 'cancelled'];
  if (status === 'approved') return ['paid', 'cancelled'];
  return [];
}

const legacyRolePermissionFallback: Record<AuthUser['role'], string[]> = {
  employee: ['payroll.view_self', 'payroll.export_pdf', 'loans.view_self'],
  manager: ['payroll.view_self', 'payroll.export_pdf', 'loans.view_self'],
  hr_admin: [],
};

function hasPermission(user: AuthUser, permissionKey: string) {
  if (user.role === 'hr_admin') return true;
  if (user.permissions) return user.permissions.includes(permissionKey);
  return legacyRolePermissionFallback[user.role].includes(permissionKey);
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
  const [isClockedIn, setIsClockedIn] = useState(false);
  const [activeTimeLogId, setActiveTimeLogId] = useState<string | null>(null);
  const [lastClockEvent, setLastClockEvent] = useState<string>('No active shift recorded.');
  const [schedule, setSchedule] = useState<ShiftRow[]>(readStoredSchedule);
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings[]>(readStoredNotifications);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notificationSaving, setNotificationSaving] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState('');
  const [notificationMessageType, setNotificationMessageType] = useState<'success' | 'error'>('success');
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
  const [showTenantId, setShowTenantId] = useState(false);
  const [tenantIdCopied, setTenantIdCopied] = useState(false);

  const geo = useGeolocation();

  const { t, lang, setLang, isRtl } = useLanguage();
  const { isDark, toggleTheme } = useTheme();
  const canManageRoster = user.role === 'hr_admin' || user.role === 'manager';
  const missingCompensationProfiles = compensationProfiles.filter((profile) => !profile.id);
  const compensationPayTypes: CompensationPayType[] = ['monthly', 'hourly', 'weekly', 'annual'];
  const loanRepaymentFrequencies: LoanRepaymentFrequency[] = ['monthly', 'weekly', 'one_time'];
  const loanStatuses: LoanStatus[] = ['active', 'paid', 'cancelled'];
  const canManageRoles = user.role === 'hr_admin' || Boolean(user.permissions?.includes('roles.manage'));
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
  const profilePanelHeading = showPayrollPanel ? 'Payroll' : showGrievancesPanel ? 'Grievances' : 'Employee Profile';
  const profilePanelSubtitle = showPayrollPanel
    ? 'Tenant payroll records, compensation, loans, and approvals'
    : showGrievancesPanel
      ? 'File a grievance and manage tenant cases'
      : 'Personal ledger & workflows';
  const userInitials = user.name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();

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
        setNotificationMessage(data.error || 'Unable to load notification settings.');
      }
    } catch {
      setNotificationMessageType('error');
      setNotificationMessage('Server disconnection. Unable to load notification settings.');
    } finally {
      setNotificationLoading(false);
    }
  };

  const saveNotificationSettings = async () => {
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
        setNotificationMessage('Notification settings saved.');
      } else {
        setNotificationMessageType('error');
        setNotificationMessage(data.error || 'Unable to save notification settings.');
      }
    } catch {
      setNotificationMessageType('error');
      setNotificationMessage('Server disconnection. Unable to save notification settings.');
    } finally {
      setNotificationSaving(false);
    }
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
        throw new Error(rolesData.error || 'Unable to load roles.');
      }
      if (!permissionsResponse.ok || !permissionsData.success) {
        throw new Error(permissionsData.error || 'Unable to load permissions.');
      }
      if (!employeesResponse.ok || !employeesData.success) {
        throw new Error(employeesData.error || 'Unable to load role assignments.');
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
      setRoleMessage(error instanceof Error ? error.message : 'Unable to load role management.');
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
        setRoleMessage('Custom role created.');
      } else {
        setRoleMessageType('error');
        setRoleMessage(data.error || 'Unable to create role.');
      }
    } catch {
      setRoleMessageType('error');
      setRoleMessage('Server disconnection. Unable to create role.');
    } finally {
      setRoleSaving(false);
    }
  };

  const assignEmployeeRole = async (employeeId: string, roleId: string) => {
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
        setRoleMessage('Role assigned.');
      } else {
        setRoleMessageType('error');
        setRoleMessage(data.error || 'Unable to assign role.');
      }
    } catch {
      setRoleMessageType('error');
      setRoleMessage('Server disconnection. Unable to assign role.');
    } finally {
      setRoleUpdatingEmployeeId(null);
    }
  };

  const saveEmployeeTitle = async (employeeId: string) => {
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
        setRoleMessage('Job title updated.');
      } else {
        setRoleMessageType('error');
        setRoleMessage(data.error || 'Unable to update job title.');
      }
    } catch {
      setRoleMessageType('error');
      setRoleMessage('Server disconnection. Unable to update job title.');
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
        setPayrollMessage(data.error || 'Unable to load payroll records.');
      }
    } catch {
      setPayrollMessageType('error');
      setPayrollMessage('Server disconnection. Unable to load payroll records.');
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
        setPayrollMessage(data.error || 'Unable to load compensation profiles.');
      }
    } catch {
      setPayrollMessageType('error');
      setPayrollMessage('Server disconnection. Unable to load compensation profiles.');
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
        setPayrollMessage(data.error || 'Unable to load employee loans.');
      }
    } catch {
      setPayrollMessageType('error');
      setPayrollMessage('Server disconnection. Unable to load employee loans.');
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
        setPayrollMessage('Compensation profile saved.');
      } else {
        setPayrollMessageType('error');
        setPayrollMessage(data.error || 'Unable to save compensation profile.');
      }
    } catch {
      setPayrollMessageType('error');
      setPayrollMessage('Server disconnection. Unable to save compensation profile.');
    } finally {
      setCompensationSaving(false);
    }
  };

  const createEmployeeLoan = async () => {
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
        setLoanForm((current) => ({
          ...defaultLoanForm,
          employeeId: current.employeeId,
          currency: current.currency,
          repaymentFrequency: current.repaymentFrequency,
        }));
        setPayrollMessageType('success');
        setPayrollMessage('Employee loan created.');
      } else {
        setPayrollMessageType('error');
        setPayrollMessage(data.error || 'Unable to create employee loan.');
      }
    } catch {
      setPayrollMessageType('error');
      setPayrollMessage('Server disconnection. Unable to create employee loan.');
    } finally {
      setLoanSaving(false);
    }
  };

  const updateEmployeeLoanStatus = async (loanId: string, status: LoanStatus) => {
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
        setPayrollMessageType('success');
        setPayrollMessage('Loan status updated.');
      } else {
        setPayrollMessageType('error');
        setPayrollMessage(data.error || 'Unable to update loan status.');
      }
    } catch {
      setPayrollMessageType('error');
      setPayrollMessage('Server disconnection. Unable to update loan status.');
    } finally {
      setLoanUpdatingId(null);
    }
  };

  const updatePayrollStatus = async (recordId: string, status: PayrollStatus) => {
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
        setPayrollMessageType('success');
        setPayrollMessage(`Payroll marked ${formatLabel(status)}.`);
      } else {
        setPayrollMessageType('error');
        setPayrollMessage(data.error || 'Unable to update payroll status.');
      }
    } catch {
      setPayrollMessageType('error');
      setPayrollMessage('Server disconnection. Unable to update payroll status.');
    } finally {
      setPayrollStatusUpdatingId(null);
    }
  };

  const runPayroll = async () => {
    if (payrollSubmitting || !canRunPayroll) return;

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
        setSkippedPayrollEmployees(data.skippedEmployees || []);
        setLoanDeductionsApplied(Number(data.loanDeductionsApplied || 0));
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

  const exportPayrollPdf = async (recordId: string) => {
    if (payrollExportingId || !canExportPayrollPdf) return;

    setPayrollExportingId(recordId);
    setPayrollMessage('');

    try {
      const res = await fetch(apiUrl(`/api/payroll/${recordId}/pdf`), {
        headers: {
          'x-employee-id': user.id,
          'x-tenant-id': user.tenantId,
        },
      });

      if (!res.ok) {
        let errorMessage = 'Unable to export payroll PDF.';
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
      setPayrollMessage(error instanceof Error ? error.message : 'Unable to export payroll PDF.');
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
    if (activeTab === 'profile' && !showPayrollPanel && !showGrievancesPanel) {
      loadNotificationSettings();
    }
  }, [activeTab, showPayrollPanel, showGrievancesPanel, user.id, user.tenantId]);

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
    if (showControlCenter) {
      loadNotificationSettings(false);
    }
  }, [showControlCenter, user.id, user.tenantId]);

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

  const renderNotificationSettingsPanel = () => (
    <div className="rounded-xl border border-emerald-500/15 bg-white/70 p-4 dark:border-emerald-500/15 dark:bg-black/35">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-slate-800 dark:text-slate-200">
            <Bell className="h-4 w-4 text-emerald-500" />
            Notification Settings
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Choose which updates Stanza should surface for your account.
          </p>
        </div>

        <button
          type="button"
          onClick={() => loadNotificationSettings()}
          disabled={notificationLoading || notificationSaving}
          className="rounded-lg border border-emerald-200 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-emerald-700 transition hover:border-emerald-400 disabled:cursor-wait disabled:opacity-60 dark:border-emerald-500/20 dark:text-emerald-300"
        >
          {notificationLoading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      <p className="mt-3 rounded-lg border border-emerald-500/15 bg-emerald-500/5 px-3 py-2 text-[11px] text-neutral-600 dark:text-emerald-100/55">
        Email and push delivery are preference-ready; delivery providers can be connected later.
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
          <div className="p-3">Category</div>
          {notificationChannels.map((channel) => (
            <div key={channel.key} className="p-3 text-center">{channel.label}</div>
          ))}
        </div>

        <div className="divide-y divide-emerald-500/10">
          {notificationCategories.map((category) => (
            <div key={category.key} className="grid grid-cols-[minmax(180px,1fr)_repeat(3,minmax(64px,86px))] items-center bg-white/55 dark:bg-black/25">
              <div className="p-3">
                <p className="text-xs font-bold text-neutral-800 dark:text-emerald-50">{category.label}</p>
                <p className="mt-1 text-[10px] leading-4 text-neutral-500 dark:text-emerald-100/45">{category.description}</p>
              </div>
              {notificationChannels.map((channel) => {
                const setting = getNotificationSetting(category.key, channel.key);

                return (
                  <label key={channel.key} className="flex justify-center p-3">
                    <input
                      type="checkbox"
                      checked={setting.enabled}
                      onChange={(event) => updateNotificationToggle(category.key, channel.key, event.target.checked)}
                      disabled={notificationLoading || notificationSaving}
                      className="h-4 w-4 accent-emerald-500 disabled:opacity-60"
                      aria-label={`${category.label} ${channel.label}`}
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
          <span className="text-[10px] font-black uppercase tracking-widest text-neutral-500 dark:text-emerald-100/45">Quiet hours start</span>
          <input
            type="time"
            value={quietHoursStart}
            onChange={(event) => setQuietHoursStart(event.target.value)}
            className="mt-1 w-full rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-black uppercase tracking-widest text-neutral-500 dark:text-emerald-100/45">Quiet hours end</span>
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
          disabled={notificationSaving || notificationLoading}
          className="rounded bg-emerald-500 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-black transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60"
        >
          {notificationSaving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  );

  const renderLocationsCard = () => (
    <div className="rounded-2xl border border-emerald-500/15 bg-white p-4 shadow-xl backdrop-blur-sm dark:border-emerald-500/15 dark:bg-black/35">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-slate-700 dark:text-slate-300">
          <MapPin className="h-5 w-5 text-emerald-500" /> Locations
        </span>
        <span className="rounded-full border border-emerald-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-emerald-700 dark:border-emerald-500/20 dark:text-emerald-300">
          {companyLocations.length}
        </span>
      </div>

      <div className="mt-3 space-y-2.5">
        {companyLocations.map((location) => (
          <div key={location.id} className="rounded-xl border border-emerald-500/15 bg-white/70 p-3 dark:border-emerald-500/15 dark:bg-black/35">
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
          <p className="rounded-lg border border-emerald-500/15 p-4 text-center text-xs text-neutral-500 dark:border-emerald-500/15 dark:text-emerald-100/45">
            {locationsMessage || 'No company locations found.'}
          </p>
        )}
      </div>
    </div>
  );

  const renderSystemStatusCard = () => (
    <div className="rounded-2xl border border-emerald-500/15 bg-white p-4 shadow-xl backdrop-blur-sm dark:border-emerald-500/15 dark:bg-black/35">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-slate-700 dark:text-slate-300">
          <CheckCircle2 className="h-5 w-5 text-emerald-500" /> System Status
        </span>
        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
          Ready
        </span>
      </div>

      <div className="mt-4 space-y-2.5 text-xs text-slate-600 dark:text-slate-400">
        <div className="flex items-center justify-between gap-4 border-b border-emerald-500/10 pb-2.5 dark:border-emerald-500/10">
          <span>Locations configured</span>
          <span className="font-bold text-emerald-600 dark:text-emerald-300">{companyLocations.length}</span>
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-emerald-500/10 pb-2.5 dark:border-emerald-500/10">
          <span>Current shift</span>
          <span className="font-bold text-emerald-600 dark:text-emerald-300">{isClockedIn ? 'Open' : 'Not clocked in'}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span>Last attendance event</span>
          <span className="max-w-[190px] truncate text-right font-medium text-slate-700 dark:text-slate-300">{lastClockEvent}</span>
        </div>
      </div>
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
          <div className="h-12 w-12 shrink-0 rounded-full border-2 border-emerald-500 bg-white p-0.5 dark:bg-black">
            <div className="flex h-full w-full items-center justify-center rounded-full bg-emerald-500/10 text-sm font-black tracking-widest text-neutral-800 dark:bg-emerald-950/50 dark:text-white">
              {userInitials}
            </div>
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-black text-slate-900 dark:text-emerald-50">{user.name}</p>
            <p className="truncate text-xs text-neutral-500 dark:text-emerald-100/50">{user.email}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="rounded-full border border-emerald-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
                {formatRole(user.role)}
              </span>
              {user.jobTitle && (
                <span className="rounded-full border border-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-neutral-500 dark:text-emerald-100/50">
                  {user.jobTitle}
                </span>
              )}
              {user.roleNames?.map((roleName) => (
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
          Log Out
        </button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-emerald-500/10 bg-white/60 p-3 dark:bg-black/25">
          <p className="text-[10px] font-black uppercase tracking-widest text-neutral-500 dark:text-emerald-100/45">Company</p>
          <p className="mt-1 truncate text-xs font-bold text-neutral-800 dark:text-emerald-50">{getTenantName(user)}</p>
        </div>
        <div className="rounded-lg border border-emerald-500/10 bg-white/60 p-3 dark:bg-black/25">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-neutral-500 dark:text-emerald-100/45">Tenant ID</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowTenantId((current) => !current)}
                className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 hover:text-emerald-500 dark:text-emerald-300"
              >
                {showTenantId ? 'Hide' : 'Show'}
              </button>
              <button
                type="button"
                onClick={copyTenantId}
                className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 hover:text-emerald-500 dark:text-emerald-300"
              >
                {tenantIdCopied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
          <p className="mt-1 truncate font-mono text-[11px] text-neutral-500 dark:text-emerald-100/55">
            {showTenantId ? user.tenantId : 'Hidden'}
          </p>
        </div>
      </div>
    </div>
  );

  const renderControlCenterSettings = () => (
    <div className="rounded-xl border border-emerald-500/15 bg-white/70 p-4 dark:border-emerald-500/15 dark:bg-black/35">
      <p className="text-sm font-bold uppercase tracking-widest text-slate-800 dark:text-slate-200">Settings</p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={toggleTheme}
          className="flex items-center justify-between gap-3 rounded-lg border border-emerald-500/15 bg-white px-3 py-2 text-left text-xs font-bold text-neutral-700 transition hover:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
        >
          <span>{isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}</span>
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
    "border border-emerald-500/15 dark:border-emerald-900/40",
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
>       <button
          type="button"
          id="stanza-control-center-trigger"
          aria-label="Open Stanza control center"
          aria-expanded={showControlCenter}
          aria-controls="stanza-control-center"
          title="Open Stanza control center"
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
          <Fingerprint className="relative h-6 w-6 text-white dark:text-[#020617]" />
        </button>
        <nav className="flex md:flex-col gap-3 md:gap-4 w-full items-center justify-center md:justify-start">
          <button 
            onClick={() => {
              setActiveTab('geofence');
              setShowPayrollPanel(false);
              setShowGrievancesPanel(false);
            }}
            className={cn("w-10 h-10 rounded-lg flex items-center justify-center transition-colors cursor-pointer", activeTab === 'geofence' ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20" : "hover:bg-emerald-500/5 text-slate-500")}
            title="Geo-Operations"
            aria-label="Geo-Operations"
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
            title="Weekly Roster"
            aria-label="Weekly Roster"
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
            aria-label="Company Feed"
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
            title="Profile"
            aria-label="Profile"
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
            aria-label="Payroll"
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
            aria-label="Grievances"
          >
             <MessageSquare className="w-5 h-5" />
          </button>
        </nav>
      </aside>

      {showControlCenter && (
        <div
          className="fixed inset-0 z-40 bg-black/35 backdrop-blur-[2px] md:bg-black/20"
          onClick={() => setShowControlCenter(false)}
        >
          <section
            id="stanza-control-center"
            role="dialog"
            aria-modal="true"
            aria-labelledby="stanza-control-center-title"
            className={cn(
              "fixed inset-x-3 bottom-3 max-h-[88dvh] overflow-y-auto rounded-2xl border border-emerald-500/20 bg-white/95 p-4 shadow-2xl shadow-black/30 backdrop-blur-xl dark:bg-[#061411]/95",
              "md:bottom-auto md:left-24 md:right-auto md:top-4 md:w-[min(760px,calc(100vw-8rem))] md:max-h-[calc(100dvh-2rem)]"
            )}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 id="stanza-control-center-title" className="text-base font-black uppercase tracking-widest text-slate-900 dark:text-emerald-50">
                  Stanza Control Center
                </h2>
                <p className="mt-1 text-xs text-neutral-500 dark:text-emerald-100/50">
                  Quick access to notifications, locations, and workspace status.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowControlCenter(false)}
                className="rounded-lg border border-emerald-500/20 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-emerald-700 transition hover:border-emerald-400 dark:text-emerald-300"
              >
                Close
              </button>
            </div>

            <div className="space-y-4">
              {renderControlCenterAccount()}
              {renderControlCenterSettings()}
              {renderNotificationSettingsPanel()}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {renderLocationsCard()}
                {renderSystemStatusCard()}
              </div>
            </div>
          </section>
        </div>
      )}

      <main className="min-w-0 flex-1 flex flex-col p-3 md:p-4 lg:p-5 z-10 overflow-y-auto">
        
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
                    <motion.div initial={{opacity:0, y:5}} animate={{opacity:1, y:0}} className="bg-white dark:bg-[#0a1a17]/90 border border-emerald-500/15 dark:border-emerald-500/20 rounded-2xl p-4 flex flex-col items-center justify-center text-center backdrop-blur-sm relative overflow-hidden group shadow-xl">
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
                       
                       <div className="relative z-10 flex h-[420px] w-full flex-col items-center justify-center overflow-hidden rounded-2xl border border-emerald-500/15 bg-white/70 px-4 py-6 dark:border-emerald-500/15 dark:bg-black/35 sm:h-[360px] sm:px-6 sm:py-8">
                           <div className="relative mb-5 flex h-44 min-h-44 w-44 min-w-44 shrink-0 items-center justify-center rounded-full border-4 border-dashed border-emerald-900 sm:h-40 sm:min-h-40 sm:w-40 sm:min-w-40">
                             {clockInState === 'success' && <div className="absolute inset-0 rounded-full shadow-[0_0_50px_rgba(16,185,129,0.3)] animate-pulse"></div>}
                             <button 
                               onClick={handleClockAction}
                               disabled={clockInState === 'locating' || clockInState === 'verifying'}
                               className={cn(
                                   "relative z-10 flex h-36 min-h-36 w-36 min-w-36 shrink-0 items-center justify-center overflow-hidden rounded-full font-black tracking-tighter transition-transform duration-300 hover:scale-105 active:scale-95",
                                   clockInState === 'idle' && isClockedIn ? "bg-gradient-to-tr from-amber-500 to-orange-400 text-slate-950 shadow-[0_0_30px_rgba(245,158,11,0.35)] hover:shadow-[0_0_40px_rgba(245,158,11,0.5)]" :
                                   clockInState === 'idle' ? "bg-gradient-to-tr from-emerald-600 to-emerald-400 text-slate-950 shadow-[0_0_30px_rgba(16,185,129,0.4)] hover:shadow-[0_0_40px_rgba(16,185,129,0.6)]" :
                                   clockInState === 'locating' || clockInState === 'verifying' ? "bg-black/70 text-emerald-100/55 animate-pulse border border-emerald-500/20 shadow-none" :
                                   clockInState === 'success' ? "bg-emerald-500 text-slate-900 shadow-[0_0_40px_rgba(16,185,129,0.6)]" :
                                   "bg-red-500 text-white shadow-[0_0_40px_rgba(239,68,68,0.6)]"
                               )}
                             >
                              <AnimatePresence mode="wait" initial={false}>
                                 {clockInState === 'idle' && (
                                     <motion.div key="idle" initial={{opacity:0, scale:0.92}} animate={{opacity:1, scale:1}} exit={{opacity:0, scale:0.92}} className="absolute inset-0 flex flex-col items-center justify-center">
                                         <span className="whitespace-nowrap text-[10px] sm:text-xs tracking-widest">{isClockedIn ? 'CLOCK OUT' : t('dash.clockIn')}</span>
                                     </motion.div>
                                 )}
                                 {(clockInState === 'locating' || clockInState === 'verifying') && (
                                     <motion.div key="loading" initial={{opacity:0, scale:0.92}} animate={{opacity:1, scale:1}} exit={{opacity:0, scale:0.92}} className="absolute inset-0 flex flex-col items-center justify-center">
                                         <Navigation className="w-8 h-8 mb-2 animate-spin-slow" />
                                         <span className="whitespace-nowrap font-bold text-[10px] uppercase tracking-widest">{clockInState === 'locating' ? t('dash.locating') : t('dash.verifying')}</span>
                                     </motion.div>
                                 )}
                                 {clockInState === 'success' && (
                                     <motion.div key="success" initial={{opacity:0, scale:0.92}} animate={{opacity:1, scale:1}} exit={{opacity:0, scale:0.92}} className="absolute inset-0 flex flex-col items-center justify-center">
                                         <CheckCircle2 className="w-10 h-10 mb-1 opacity-90" />
                                         <span className="font-bold text-[10px] uppercase tracking-widest leading-none">{t('dash.verified')}</span>
                                     </motion.div>
                                 )}
                                 {clockInState === 'failed' && (
                                     <motion.div key="failed" initial={{opacity:0, scale:0.92}} animate={{opacity:1, scale:1}} exit={{opacity:0, scale:0.92}} className="absolute inset-0 flex flex-col items-center justify-center">
                                         <AlertTriangle className="w-10 h-10 mb-1" />
                                         <span className="font-bold text-[10px] uppercase tracking-widest leading-none">{t('dash.breach')}</span>
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
                                        <span className={cn("flex h-2 w-2 shrink-0 rounded-full", clockInState === 'success' ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,1)]" : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,1)]")}></span>
                                        <span className={cn("max-h-12 overflow-hidden text-[10px] uppercase font-bold tracking-widest leading-4", clockInState === 'success' ? "text-emerald-400" : "text-red-400")}>
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
                                        <span className="max-h-12 overflow-hidden text-[10px] uppercase tracking-widest leading-4">{isClockedIn ? 'Active shift open' : t('dash.awaitingInput')}</span>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                           </div>

                           <p className="mt-2 h-4 max-w-full overflow-hidden text-[10px] font-mono uppercase tracking-widest text-neutral-500 dark:text-emerald-100/45">
                             {lastClockEvent}
                           </p>
                       </div>

                       <div className="relative z-10 mt-4 w-full rounded-2xl border border-emerald-500/15 bg-white/70 p-4 text-left dark:border-emerald-500/15 dark:bg-black/30">
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
                             <div key={location.id} className="rounded-xl border border-emerald-500/15 bg-white/70 p-3 dark:border-emerald-500/15 dark:bg-black/35">
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
                             <p className="rounded-lg border border-emerald-500/15 p-4 text-center text-xs text-neutral-500 dark:border-emerald-500/15 dark:text-emerald-100/45 md:col-span-2">
                               {locationsMessage || 'No active company locations found.'}
                             </p>
                           )}
                         </div>
                       </div>
                    </motion.div>
                )}                

                {activeTab === 'roster' && (
                    <motion.div initial={{opacity:0, y:5}} animate={{opacity:1, y:0}} className="bg-white dark:bg-[#0a1a17]/40 border border-emerald-500/15 dark:border-emerald-500/10 rounded-2xl flex flex-col overflow-hidden backdrop-blur-sm shadow-xl min-h-[320px]">
                       <div className="p-4 border-b border-emerald-500/15 dark:border-emerald-500/10 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
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
                             <tr className="text-[10px] text-neutral-500 dark:text-emerald-100/45 uppercase font-bold border-b border-emerald-500/15 dark:border-emerald-500/15 bg-white/70 dark:bg-black/25">
                               <th className="p-3">{t('dash.dayDate')}</th>
                               <th className="p-3">{t('dash.shiftFrame')}</th>
                               <th className="p-3">Break Time</th>
                               <th className="p-3">{t('dash.locationRole')}</th>
                               <th className={cn("p-3", isRtl ? "text-left" : "text-right")}>{t('dash.status')}</th>
                             </tr>
                           </thead>
                           <tbody className="text-sm">
                             {schedule.map((s, i) => (
                               <tr key={i} className="border-b border-emerald-500/10 dark:border-emerald-500/10 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 transition-colors group">
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
                                         className="w-24 rounded border border-emerald-500/15 bg-white px-2 py-1 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                                       />
                                       <span>-</span>
                                       <input
                                         type="time"
                                         value={s.shiftEnd}
                                         onChange={(event) => updateShift(i, 'shiftEnd', event.target.value)}
                                         className="w-24 rounded border border-emerald-500/15 bg-white px-2 py-1 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
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
                                         className="w-24 rounded border border-emerald-500/15 bg-white px-2 py-1 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                                       />
                                       <span>-</span>
                                       <input
                                         type="time"
                                         value={s.breakEnd}
                                         onChange={(event) => updateShift(i, 'breakEnd', event.target.value)}
                                         className="w-24 rounded border border-emerald-500/15 bg-white px-2 py-1 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                                       />
                                     </div>
                                   ) : s.breakStart && s.breakEnd ? `${s.breakStart} - ${s.breakEnd}` : 'No break'}
                                 </td>
                                 <td className="p-3 text-xs text-slate-600 dark:text-slate-300">
                                   {canManageRoster ? (
                                     <input
                                       value={s.type}
                                       onChange={(event) => updateShift(i, 'type', event.target.value)}
                                       className="w-36 rounded border border-emerald-500/15 bg-white px-2 py-1 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                                     />
                                   ) : (
                                     <span className="opacity-80">{s.type}</span>
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
                    </motion.div>
                )}

                {activeTab === 'feed' && (
                   <motion.div initial={{opacity:0, y:5}} animate={{opacity:1, y:0}} className="bg-white dark:bg-[#0a1a17]/90 border border-emerald-500/15 dark:border-emerald-500/20 rounded-2xl p-4 shadow-xl backdrop-blur-sm min-h-[320px]">
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
                          className="rounded-lg border border-emerald-500/15 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-neutral-600 transition hover:border-emerald-300 hover:text-emerald-700 disabled:cursor-wait disabled:opacity-60 dark:border-emerald-500/15 dark:text-emerald-100/60"
                        >
                          Refresh
                        </button>
                      </div>

                      {canPublishFeed && (
                        <div className="mt-4 rounded-xl border border-emerald-500/15 bg-white/70 p-4 dark:border-emerald-500/15 dark:bg-black/35">
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                            <input
                              value={feedForm.title}
                              onChange={(event) => updateFeedForm('title', event.target.value)}
                              placeholder="Post title"
                              className="rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50 md:col-span-2"
                            />
                            <select
                              value={feedForm.postType}
                              onChange={(event) => updateFeedForm('postType', event.target.value)}
                              className="rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                            >
                              <option value="announcement">Announcement</option>
                              <option value="event">Event</option>
                              <option value="policy_update">Policy Update</option>
                              <option value="general">General</option>
                            </select>
                            <select
                              value={feedForm.status}
                              onChange={(event) => updateFeedForm('status', event.target.value)}
                              className="rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                            >
                              <option value="published">Published</option>
                              <option value="draft">Draft</option>
                            </select>
                            <select
                              value={feedForm.visibility}
                              onChange={(event) => updateFeedForm('visibility', event.target.value)}
                              className="rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50 md:col-span-2"
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
                            <div className="md:col-span-4">
                              <RichTextEditor
                                key={feedEditorKey}
                                valueJson={feedForm.contentJson}
                                onChange={updateFeedContent}
                                placeholder="Write the announcement..."
                              />
                            </div>
                            <button
                              type="button"
                              onClick={submitFeedPost}
                              disabled={feedSubmitting || !feedForm.title.trim() || !feedForm.contentText.trim()}
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
                          <article key={post.id} className="rounded-xl border border-emerald-500/15 bg-white/70 p-4 dark:border-emerald-500/15 dark:bg-black/35">
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
                            <RichFeedContent contentJson={post.content_json ?? post.contentJson} contentText={post.content_text} />
                          </article>
                        ))}

                        {!feedLoading && feedPosts.length === 0 && (
                          <p className="rounded-lg border border-emerald-500/15 p-6 text-center text-xs text-neutral-500 dark:border-emerald-500/15 dark:text-emerald-100/45">
                            No company announcements yet.
                          </p>
                        )}

                        {feedLoading && (
                          <p className="rounded-lg border border-emerald-500/15 p-6 text-center text-xs text-neutral-500 dark:border-emerald-500/15 dark:text-emerald-100/45">
                            Loading company feed...
                          </p>
                        )}
                      </div>

                      {canPublishFeed && (
                        <div className="mt-4 rounded-xl border border-emerald-500/15 bg-white/70 p-4 dark:border-emerald-500/15 dark:bg-black/30">
                          <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-700 dark:text-slate-300">Manage Posts</h3>
                          <div className="space-y-2">
                            {adminFeedPosts.map((post) => (
                              <div key={post.id} className="flex flex-col gap-2 rounded-lg border border-emerald-500/15 bg-white/70 p-3 dark:border-emerald-500/15 dark:bg-black/40 sm:flex-row sm:items-center sm:justify-between">
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
                                  className="rounded border border-emerald-500/15 bg-white px-2 py-1 text-xs text-neutral-800 outline-none focus:border-emerald-400 disabled:opacity-60 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                                >
                                  <option value="draft">Draft</option>
                                  <option value="published">Published</option>
                                  <option value="archived">Archived</option>
                                </select>
                              </div>
                            ))}

                            {!adminFeedLoading && adminFeedPosts.length === 0 && (
                              <p className="rounded-lg border border-emerald-500/15 p-4 text-center text-xs text-neutral-500 dark:border-emerald-500/15 dark:text-emerald-100/45">
                                No posts to manage yet.
                              </p>
                            )}

                            {adminFeedLoading && (
                              <p className="rounded-lg border border-emerald-500/15 p-4 text-center text-xs text-neutral-500 dark:border-emerald-500/15 dark:text-emerald-100/45">
                                Loading posts...
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                   </motion.div>
                )}

                {activeTab === 'profile' && (
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
                              <h3 className="text-sm font-bold uppercase tracking-widest text-slate-800 dark:text-slate-200">Payroll</h3>
                              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                {canViewAllPayroll || canRunPayroll ? 'Tenant payroll records and run controls.' : 'Your recent payroll records.'}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => setShowPayrollPanel(false)}
                              className="rounded-lg border border-emerald-500/15 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-neutral-600 transition hover:border-emerald-300 hover:text-emerald-700 dark:border-emerald-500/15 dark:text-emerald-100/60"
                            >
                              Back
                            </button>
                          </div>

                          {(canManageCompensation || canRunPayroll) && (
                            <div className="space-y-3">
                              {canManageCompensation && (
                              <div className="rounded-xl border border-emerald-500/15 bg-white/70 p-4 dark:border-emerald-500/15 dark:bg-black/35">
                                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                  <div>
                                    <h4 className="text-xs font-black uppercase tracking-widest text-neutral-800 dark:text-emerald-50">Compensation Profiles</h4>
                                    <p className="mt-1 text-[11px] text-neutral-500 dark:text-emerald-100/45">Saved profiles override the fallback salary when payroll runs.</p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={loadCompensationProfiles}
                                    disabled={compensationLoading}
                                    className="rounded border border-emerald-500/20 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-emerald-700 transition hover:border-emerald-400 disabled:cursor-wait disabled:opacity-60 dark:text-emerald-300"
                                  >
                                    {compensationLoading ? 'Loading...' : 'Refresh'}
                                  </button>
                                </div>

                                {missingCompensationProfiles.length > 0 && (
                                  <p className="mb-3 rounded-lg border border-amber-400/25 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-200">
                                    {missingCompensationProfiles.length} employee{missingCompensationProfiles.length === 1 ? '' : 's'} missing active compensation profiles.
                                  </p>
                                )}

                                <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
                                  <select
                                    value={compensationForm.employeeId}
                                    onChange={(event) => selectCompensationEmployee(event.target.value)}
                                    className="rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50 md:col-span-2"
                                  >
                                    <option value="">Select employee</option>
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
                                      <option key={payType} value={payType}>{formatLabel(payType)}</option>
                                    ))}
                                  </select>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    placeholder="Base amount"
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
                                    disabled={compensationSaving || !compensationForm.employeeId}
                                    className="rounded bg-emerald-500 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-black transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60 md:col-span-6"
                                  >
                                    {compensationSaving ? 'Saving...' : 'Save Compensation'}
                                  </button>
                                </div>

                                <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
                                  {compensationProfiles.map((profile) => (
                                    <div key={profile.employee_id} className="rounded-lg border border-emerald-500/10 bg-white/50 p-3 text-xs dark:bg-black/25">
                                      <div className="flex items-start justify-between gap-3">
                                        <div>
                                          <p className="font-bold text-neutral-800 dark:text-emerald-50">{profile.full_name || profile.email}</p>
                                          <p className="mt-0.5 text-[10px] text-neutral-500 dark:text-emerald-100/45">{profile.email} • {profile.role ? formatRole(profile.role) : 'Employee'}</p>
                                        </div>
                                        <span className={cn(
                                          "rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                                          profile.id
                                            ? "border-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                                            : "border-amber-400/25 text-amber-700 dark:text-amber-200"
                                        )}>
                                          {profile.id ? 'Active' : 'Missing'}
                                        </span>
                                      </div>
                                      <p className="mt-3 font-mono text-[11px] text-neutral-600 dark:text-emerald-100/60">
                                        {profile.id && profile.base_amount !== null && profile.base_amount !== undefined
                                          ? `${formatPayrollAmount(profile.base_amount, profile.currency || 'USD')} • ${formatLabel(profile.pay_type || 'monthly')}`
                                          : 'No active compensation profile'}
                                      </p>
                                      {profile.effective_from && (
                                        <p className="mt-1 text-[10px] text-neutral-500 dark:text-emerald-100/45">
                                          Effective {formatPayrollDate(profile.effective_from)}
                                        </p>
                                      )}
                                    </div>
                                  ))}
                                  {!compensationLoading && compensationProfiles.length === 0 && (
                                    <p className="rounded-lg border border-emerald-500/10 p-3 text-xs text-neutral-500 dark:text-emerald-100/45">
                                      No employees found for compensation profiles.
                                    </p>
                                  )}
                                </div>
                              </div>
                              )}

                              {canRunPayroll && (
                              <div className="rounded-xl border border-emerald-500/15 bg-white/70 p-4 dark:border-emerald-500/15 dark:bg-black/35">
                                <p className="mb-3 text-[11px] font-semibold text-neutral-500 dark:text-emerald-100/45">
                                  Payroll uses each employee's active compensation profile. Fallback Base Salary is optional, and active loan repayments are automatically included in deductions for new payroll records.
                                </p>
                                <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
                                  <input
                                    type="date"
                                    aria-label="Pay period start"
                                    value={payrollForm.payPeriodStart}
                                    onChange={(event) => updatePayrollForm('payPeriodStart', event.target.value)}
                                    className="rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                                  />
                                  <input
                                    type="date"
                                    aria-label="Pay period end"
                                    value={payrollForm.payPeriodEnd}
                                    onChange={(event) => updatePayrollForm('payPeriodEnd', event.target.value)}
                                    className="rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                                  />
                                  <input
                                    type="number"
                                    aria-label="Fallback base salary"
                                    min="0"
                                    step="0.01"
                                    placeholder="Fallback base salary"
                                    value={payrollForm.defaultBaseSalary}
                                    onChange={(event) => updatePayrollForm('defaultBaseSalary', event.target.value)}
                                    className="rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
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
                                  className="min-w-0 rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                                />
                                <input
                                  type="number"
                                  aria-label="Deductions"
                                  min="0"
                                  step="0.01"
                                  placeholder="Deductions"
                                  value={payrollForm.deductions}
                                  onChange={(event) => updatePayrollForm('deductions', event.target.value)}
                                  className="min-w-0 rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
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
                              </div>
                              )}
                            </div>
                          )}

                          <div className="rounded-xl border border-emerald-500/15 bg-white/70 p-4 dark:border-emerald-500/15 dark:bg-black/35">
                            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <h4 className="text-xs font-black uppercase tracking-widest text-neutral-800 dark:text-emerald-50">Employee Loans</h4>
                                <p className="mt-1 text-[11px] text-neutral-500 dark:text-emerald-100/45">
                                  {canManageLoans ? 'Create tenant loans and manage repayment status.' : 'Your active and historical employee loans.'}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={loadEmployeeLoans}
                                disabled={loanLoading}
                                className="rounded border border-emerald-500/20 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-emerald-700 transition hover:border-emerald-400 disabled:cursor-wait disabled:opacity-60 dark:text-emerald-300"
                              >
                                {loanLoading ? 'Loading...' : 'Refresh'}
                              </button>
                            </div>

                            {canManageLoans && (
                              <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-6">
                                <select
                                  value={loanForm.employeeId}
                                  onChange={(event) => updateLoanForm('employeeId', event.target.value)}
                                  className="rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50 md:col-span-2"
                                >
                                  <option value="">Select employee</option>
                                  {compensationProfiles.map((profile) => (
                                    <option key={profile.employee_id} value={profile.employee_id}>
                                      {profile.full_name || profile.email || profile.employee_id}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  value={loanForm.loanName}
                                  onChange={(event) => updateLoanForm('loanName', event.target.value)}
                                  placeholder="Loan name"
                                  className="rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                                />
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={loanForm.principalAmount}
                                  onChange={(event) => updateLoanForm('principalAmount', event.target.value)}
                                  placeholder="Principal"
                                  className="rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                                />
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={loanForm.repaymentAmount}
                                  onChange={(event) => updateLoanForm('repaymentAmount', event.target.value)}
                                  placeholder="Repayment"
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
                                    <option key={frequency} value={frequency}>{formatLabel(frequency)}</option>
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
                                  disabled={loanSaving || !loanForm.employeeId}
                                  className="rounded bg-emerald-500 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-black transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60 md:col-span-3"
                                >
                                  {loanSaving ? 'Creating...' : 'Create Loan'}
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
                                        {canManageLoans ? `${loan.full_name || loan.email} - ` : ''}{formatLabel(loan.repayment_frequency)}
                                      </p>
                                    </div>
                                    {canManageLoans ? (
                                      <select
                                        value={loan.status}
                                        onChange={(event) => updateEmployeeLoanStatus(loan.id, event.target.value as LoanStatus)}
                                        disabled={loanUpdatingId === loan.id}
                                        className="rounded border border-emerald-500/15 bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-neutral-700 outline-none focus:border-emerald-400 disabled:cursor-wait disabled:opacity-60 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                                      >
                                        {loanStatuses.map((status) => (
                                          <option key={status} value={status}>{formatLabel(status)}</option>
                                        ))}
                                      </select>
                                    ) : (
                                      <span className="rounded-full border border-emerald-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                                        {loan.status}
                                      </span>
                                    )}
                                  </div>
                                  <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-neutral-600 dark:text-emerald-100/60">
                                    <p>Principal <span className="block font-mono">{formatPayrollAmount(loan.principal_amount, loan.currency)}</span></p>
                                    <p>Outstanding <span className="block font-mono">{formatPayrollAmount(loan.outstanding_balance, loan.currency)}</span></p>
                                    <p>Repayment <span className="block font-mono">{formatPayrollAmount(loan.repayment_amount, loan.currency)}</span></p>
                                    <p>Due <span className="block font-mono">{loan.due_date ? formatPayrollDate(loan.due_date) : 'Not set'}</span></p>
                                  </div>
                                </div>
                              ))}
                              {!loanLoading && employeeLoans.length === 0 && (
                                <p className="rounded-lg border border-emerald-500/10 p-3 text-xs text-neutral-500 dark:text-emerald-100/45">
                                  No employee loans yet.
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
                              Loan deductions applied: {formatPayrollAmount(loanDeductionsApplied, payrollRecords[0]?.currency || 'USD')}
                            </p>
                          )}

                          {skippedPayrollEmployees.length > 0 && (
                            <div className="rounded-lg border border-amber-400/25 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-200">
                              <p className="font-bold uppercase tracking-widest">Skipped employees</p>
                              <ul className="mt-2 space-y-1">
                                {skippedPayrollEmployees.map((employee) => (
                                  <li key={employee.employeeId}>
                                    {employee.email}: {employee.reason}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          <div className="overflow-x-auto rounded-xl border border-emerald-500/15 dark:border-emerald-500/15">
                            <table className={cn("w-full min-w-[760px]", isRtl ? "text-right" : "text-left")}>
                              <thead>
                                <tr className="border-b border-emerald-500/15 bg-white/70 text-[10px] font-bold uppercase tracking-widest text-neutral-500 dark:border-emerald-500/15 dark:bg-black/35 dark:text-emerald-100/45">
                                  <th className="p-3">Employee</th>
                                  <th className="p-3">Period</th>
                                  <th className="p-3">Base</th>
                                  <th className="p-3">Bonus</th>
                                  <th className="p-3">Deductions</th>
                                  <th className="p-3">Net</th>
                                  <th className="p-3">Status</th>
                                  {canShowPayrollActions && <th className="p-3">Actions</th>}
                                  <th className="p-3">Export</th>
                                </tr>
                              </thead>
                              <tbody className="text-xs">
                                {payrollRecords.map((record) => (
                                  <tr key={record.id} className="border-b border-emerald-500/10 text-neutral-700 last:border-0 dark:border-emerald-500/10 dark:text-emerald-100/65">
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
                                      {record.approved_at && (
                                        <span className="mt-1 block text-[10px] font-normal text-neutral-500 dark:text-emerald-100/45">
                                          Approved {formatPayrollDate(record.approved_at)}
                                        </span>
                                      )}
                                      {record.paid_at && (
                                        <span className="mt-1 block text-[10px] font-normal text-neutral-500 dark:text-emerald-100/45">
                                          Paid {formatPayrollDate(record.paid_at)}
                                        </span>
                                      )}
                                      {record.cancelled_at && (
                                        <span className="mt-1 block text-[10px] font-normal text-neutral-500 dark:text-emerald-100/45">
                                          Cancelled {formatPayrollDate(record.cancelled_at)}
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
                                                disabled={payrollStatusUpdatingId === record.id}
                                                className="rounded border border-emerald-200 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-700 transition hover:border-emerald-400 disabled:cursor-wait disabled:opacity-60 dark:border-emerald-500/20 dark:text-emerald-300"
                                              >
                                                {payrollStatusUpdatingId === record.id ? 'Updating...' : formatLabel(status)}
                                              </button>
                                            ))}
                                          </div>
                                        ) : (
                                          <span className="text-[10px] uppercase tracking-widest text-neutral-400 dark:text-emerald-100/35">Final</span>
                                        )}
                                      </td>
                                    )}
                                    <td className="p-3">
                                      {canExportPayrollRecord(record) ? (
                                        <button
                                          type="button"
                                          onClick={() => exportPayrollPdf(record.id)}
                                          disabled={payrollExportingId !== null}
                                          className="rounded border border-emerald-200 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-700 transition hover:border-emerald-400 disabled:cursor-wait disabled:opacity-60 dark:border-emerald-500/20 dark:text-emerald-300"
                                        >
                                          {payrollExportingId === record.id ? 'Exporting...' : 'Export PDF'}
                                        </button>
                                      ) : (
                                        <span className="text-[10px] uppercase tracking-widest text-neutral-400 dark:text-emerald-100/35">No access</span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                                {!payrollLoading && payrollRecords.length === 0 && (
                                  <tr>
                                    <td colSpan={payrollTableColSpan} className="p-6 text-center text-xs text-slate-500">
                                      {canUsePayrollPanel ? 'No payroll records yet.' : 'No payroll access assigned yet.'}
                                    </td>
                                  </tr>
                                )}
                                {payrollLoading && (
                                  <tr>
                                    <td colSpan={payrollTableColSpan} className="p-6 text-center text-xs text-slate-500">
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
                              className="rounded-lg border border-emerald-500/15 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-neutral-600 transition hover:border-emerald-300 hover:text-emerald-700 dark:border-emerald-500/15 dark:text-emerald-100/60"
                            >
                              Back
                            </button>
                          </div>

                          <div className="rounded-xl border border-emerald-500/15 bg-white/70 p-4 dark:border-emerald-500/15 dark:bg-black/35">
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                              <input
                                value={grievanceForm.title}
                                onChange={(event) => updateGrievanceForm('title', event.target.value)}
                                placeholder="Title"
                                className="rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50 md:col-span-2"
                              />
                              <input
                                value={grievanceForm.category}
                                onChange={(event) => updateGrievanceForm('category', event.target.value)}
                                placeholder="Category"
                                className="rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                              />
                              <select
                                value={grievanceForm.priority}
                                onChange={(event) => updateGrievanceForm('priority', event.target.value)}
                                className="rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
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
                                className="rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50 md:col-span-4"
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

                          <div className="rounded-xl border border-emerald-500/15 bg-white/70 p-4 dark:border-emerald-500/15 dark:bg-black/30">
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
                                <div key={grievance.id} className="rounded-lg border border-emerald-500/15 bg-white/70 p-3 dark:border-emerald-500/15 dark:bg-black/40">
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
                                <p className="rounded-lg border border-emerald-500/15 p-6 text-center text-xs text-neutral-500 dark:border-emerald-500/15 dark:text-emerald-100/45">
                                  No grievances filed yet.
                                </p>
                              )}

                              {grievanceLoading && (
                                <p className="rounded-lg border border-emerald-500/15 p-6 text-center text-xs text-neutral-500 dark:border-emerald-500/15 dark:text-emerald-100/45">
                                  Loading your grievances...
                                </p>
                              )}
                            </div>
                          </div>

                          {canManageGrievances && (
                            <div className="rounded-xl border border-emerald-500/15 bg-white/70 p-4 dark:border-emerald-500/15 dark:bg-black/30">
                              <h4 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-700 dark:text-slate-300">Tenant Grievances</h4>
                              <div className="overflow-x-auto">
                                <table className={cn("w-full min-w-[860px]", isRtl ? "text-right" : "text-left")}>
                                  <thead>
                                    <tr className="border-b border-emerald-500/15 text-[10px] font-bold uppercase tracking-widest text-neutral-500 dark:border-emerald-500/15 dark:text-emerald-100/45">
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
                                      <tr key={grievance.id} className="border-b border-emerald-500/10 text-neutral-700 last:border-0 dark:border-emerald-500/10 dark:text-emerald-100/65">
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
                                            className="rounded border border-emerald-500/15 bg-white px-2 py-1 text-xs text-neutral-800 outline-none focus:border-emerald-400 disabled:opacity-60 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
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
                         <div className="md:col-span-2">
                           {renderNotificationSettingsPanel()}
                         </div>

                         {canManageRoles && (
                           <div className="bg-white/70 dark:bg-black/35 border border-emerald-500/15 dark:border-emerald-500/15 p-4 rounded-xl md:col-span-2">
                             <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                               <div>
                                 <p className="text-sm font-bold uppercase tracking-widest text-slate-800 dark:text-slate-200">Roles & Permissions</p>
                                 <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Foundation controls for tenant roles, permission keys, and employee job titles.</p>
                               </div>
                               <button
                                 type="button"
                                 onClick={loadRoleManagement}
                                 disabled={rolesLoading}
                                 className="rounded-lg border border-emerald-200 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-emerald-700 transition hover:border-emerald-400 disabled:cursor-wait disabled:opacity-60 dark:border-emerald-500/20 dark:text-emerald-300"
                               >
                                 {rolesLoading ? 'Loading...' : 'Refresh'}
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
                                             {role.is_system ? 'System role' : 'Custom role'} • {role.assigned_employee_count || 0} assigned
                                           </p>
                                         </div>
                                         <span className="rounded-full border border-emerald-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                                           {role.system_key ? formatRole(role.system_key) : 'Custom'}
                                         </span>
                                       </div>
                                       <div className="mt-3 flex flex-wrap gap-1">
                                         {role.permissions.map((permission) => (
                                           <span key={permission} className="rounded border border-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold text-neutral-500 dark:text-emerald-100/45">
                                             {permission}
                                           </span>
                                         ))}
                                         {role.permissions.length === 0 && (
                                           <span className="text-[10px] text-neutral-500 dark:text-emerald-100/40">No permissions yet.</span>
                                         )}
                                       </div>
                                     </div>
                                   ))}
                                 </div>

                                 <div className="rounded-lg border border-emerald-500/10 bg-white/60 p-3 dark:bg-black/25">
                                   <p className="mb-3 text-xs font-bold uppercase tracking-widest text-neutral-800 dark:text-emerald-50">Employee Assignments</p>
                                   <div className="space-y-2">
                                     {roleEmployees.map((employee) => (
                                       <div key={employee.id} className="rounded border border-emerald-500/10 p-3">
                                         <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                                           <div>
                                             <p className="text-xs font-bold text-neutral-800 dark:text-emerald-50">{employee.full_name}</p>
                                             <p className="text-[10px] text-neutral-500 dark:text-emerald-100/45">
                                               {employee.email} • {formatRole(employee.role)}
                                             </p>
                                             <p className="mt-1 text-[10px] text-emerald-700/70 dark:text-emerald-100/55">
                                               {employee.assigned_roles.map((role) => role.name).join(', ') || 'No custom assignments'}
                                             </p>
                                           </div>
                                           <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] lg:w-[420px]">
                                             <select
                                               defaultValue=""
                                               onChange={(event) => assignEmployeeRole(employee.id, event.target.value)}
                                               disabled={roleUpdatingEmployeeId === employee.id}
                                               className="rounded border border-emerald-500/15 bg-white px-2 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 disabled:opacity-60 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                                             >
                                               <option value="">Assign role</option>
                                               {tenantRoles.map((role) => (
                                                 <option key={role.id} value={role.id}>{role.name}</option>
                                               ))}
                                             </select>
                                             <button
                                               type="button"
                                               onClick={() => saveEmployeeTitle(employee.id)}
                                               disabled={roleUpdatingEmployeeId === employee.id}
                                               className="rounded border border-emerald-500/20 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-emerald-700 transition hover:border-emerald-400 disabled:cursor-wait disabled:opacity-60 dark:text-emerald-300"
                                             >
                                               Save Title
                                             </button>
                                             <input
                                               value={titleDrafts[employee.id] || ''}
                                               onChange={(event) => setTitleDrafts((current) => ({ ...current, [employee.id]: event.target.value }))}
                                               placeholder="Job title"
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
                                 <p className="mb-3 text-xs font-bold uppercase tracking-widest text-neutral-800 dark:text-emerald-50">Create Custom Role</p>
                                 <div className="space-y-2">
                                   <input
                                     value={roleForm.name}
                                     onChange={(event) => setRoleForm((current) => ({ ...current, name: event.target.value }))}
                                     placeholder="Role name"
                                     className="w-full rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-emerald-400 dark:border-emerald-500/20 dark:bg-black/40 dark:text-emerald-50"
                                   />
                                   <textarea
                                     value={roleForm.description}
                                     onChange={(event) => setRoleForm((current) => ({ ...current, description: event.target.value }))}
                                     placeholder="Description"
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
                                     disabled={roleSaving || !roleForm.name.trim()}
                                     className="w-full rounded bg-emerald-500 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-black transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60"
                                   >
                                     {roleSaving ? 'Creating...' : 'Create Role'}
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
                               Cleared
                            </p>
                            <p className="text-[10px] text-emerald-600 dark:text-emerald-500 mt-1 font-mono uppercase tracking-widest">No active liabilities</p>
                         </div>
                      </div>
                      )}
                   </motion.div>
                )}

            </div>

        </div>
      </main>
    </div>
  );
}
