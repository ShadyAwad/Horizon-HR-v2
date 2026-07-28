import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  LoaderCircle,
  RefreshCw,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { apiFetch } from '../../lib/api';
import { useLanguage } from '../../lib/LanguageContext';
import { cn } from '../../lib/utils';

type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
type LeaveView = 'requests' | 'upcoming' | 'history' | 'approvals';
type RequestStep = 'details' | 'review' | 'success';
type ApprovalDecision = 'approve' | 'reject';

type LeaveConflict = {
  shiftId: string;
  startTime: string;
  endTime: string;
  shiftStatus: string;
  conflictStatus: string;
};

type LeaveRequest = {
  requestId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  reason?: string | null;
  status: LeaveStatus;
  submittedAt: string;
  cancelledAt?: string | null;
  approvalPending: boolean;
  approvalConfigured: boolean;
  decisionAt?: string | null;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  hasRosterConflict: boolean;
  conflictCount: number;
  schedulerAttentionRequired: boolean;
  version: number;
  conflictingShifts?: LeaveConflict[];
};

type LeaveHistoryEntry = {
  action: string;
  previousStatus?: string | null;
  newStatus: string;
  createdAt: string;
};

type LeaveDetail = {
  request: LeaveRequest;
  history: LeaveHistoryEntry[];
};

type ApprovalRequest = {
  requestId: string;
  employee: { employeeId: string; displayName: string };
  leaveType: string;
  startDate: string;
  endDate: string;
  reason?: string | null;
  status: LeaveStatus;
  submittedAt: string;
  version: number;
  approverDisplayName?: string | null;
  approvalSourceLabel: string;
  scopeLabel?: string | null;
  decisionAt?: string | null;
  hasRosterConflict: boolean;
  conflictCount: number;
  schedulerAttentionRequired: boolean;
  canDecide?: boolean;
  conflictingShifts?: LeaveConflict[];
};

type ApprovalDetail = {
  request: ApprovalRequest;
  history: LeaveHistoryEntry[];
};

type LeaveListResponse = {
  success: boolean;
  requests?: LeaveRequest[];
  total?: number;
  page?: number;
  pageSize?: number;
  error?: string;
};

type Copy = {
  [key: string]: string;
};

const EN: Copy = {
  title: 'Leave',
  subtitle: 'Request time away and follow each decision without leaving the roster.',
  requestLeave: 'Request leave',
  myRequests: 'My Requests',
  upcoming: 'Upcoming Leave',
  history: 'History',
  pendingRequests: 'Pending requests',
  upcomingApproved: 'Upcoming approved leave',
  needsAttention: 'Requests needing attention',
  rosterConflicts: 'Roster conflicts',
  status: 'Status',
  allStatuses: 'All statuses',
  fromDate: 'From date',
  toDate: 'To date',
  applyFilters: 'Apply filters',
  clearFilters: 'Clear',
  loading: 'Loading leave requests...',
  loadError: 'Unable to load leave requests.',
  retry: 'Retry',
  emptyRequests: 'No leave requests match this view.',
  emptyRequestsHelp: 'Request leave when you need time away. Your approver will be selected by the secure workflow.',
  emptyUpcoming: 'No upcoming approved leave.',
  emptyHistory: 'No completed leave requests yet.',
  viewDetails: 'View details',
  pending: 'Pending approval',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  annual: 'Annual leave',
  sick: 'Sick leave',
  unpaid: 'Unpaid leave',
  personal: 'Personal leave',
  submitted: 'Submitted',
  decided: 'Decision',
  previous: 'Previous',
  next: 'Next',
  page: 'Page',
  of: 'of',
  close: 'Close',
  requestDetails: 'Leave details',
  requestReview: 'Review request',
  leaveType: 'Leave type',
  startDate: 'Start date',
  endDate: 'End date',
  reason: 'Reason (optional)',
  reasonHelp: 'Up to 1,000 characters. Do not include unnecessary medical details.',
  continue: 'Review request',
  back: 'Back',
  submit: 'Submit request',
  submitting: 'Submitting...',
  requestCreated: 'Leave request submitted',
  requestCreatedHelp: 'The request is pending the configured approval workflow.',
  calendarDays: 'calendar days',
  selectedRange: 'Selected date range',
  invalidDates: 'Choose a valid start and end date.',
  tooLong: 'A leave request cannot exceed 366 calendar days.',
  conflictError: 'This request overlaps an existing pending or approved leave request.',
  noApprover: 'No leave approver is currently configured. HR has been notified to resolve the approval route.',
  details: 'Leave request details',
  approvalPending: 'Awaiting an authorised approver',
  safeTimeline: 'Request timeline',
  conflictsHeading: 'Roster attention',
  noConflicts: 'No scheduled shift conflicts',
  oneConflict: '1 scheduled shift needs attention',
  manyConflicts: 'scheduled shifts need attention',
  conflictExplanation: 'Approved leave does not automatically cancel or reassign scheduled shifts. A scheduler must resolve each conflict.',
  openSchedule: 'View my schedule',
  cancelRequest: 'Cancel request',
  cancelHeading: 'Cancel pending request?',
  cancelExplanation: 'The pending request will be cancelled. Its historical record will remain available.',
  confirmCancel: 'Cancel request',
  cancelling: 'Cancelling...',
  staleRequest: 'This request changed. Refresh it and try again.',
  statusChanged: 'Request updated successfully.',
  schedulerAttention: 'Scheduler attention required',
  dateRange: 'Date range',
  notAvailable: 'Not available',
  approvals: 'Approvals',
  approvalsSubtitle: 'Actionable leave requests in your authorised scope.',
  awaitingApproval: 'Awaiting my approval',
  approvedRecently: 'Approved recently',
  rejectedRecently: 'Rejected recently',
  scopedConflicts: 'Open roster conflicts in scope',
  actionableOnly: 'Actionable only',
  employeeSearch: 'Employee search',
  searchPlaceholder: 'Search employee name',
  leaveTypeFilter: 'Leave type',
  allTypes: 'All leave types',
  emptyApprovals: 'No leave requests are awaiting your action.',
  emptyApprovalsHelp: 'Only requests inside your current authority scope appear here.',
  review: 'Review',
  employee: 'Employee',
  authority: 'Authority',
  scope: 'Scope',
  approve: 'Approve',
  reject: 'Reject',
  approveHeading: 'Approve leave request?',
  rejectHeading: 'Reject leave request?',
  approveConsequence: 'Approval confirms the leave dates. Existing roster conflicts remain assigned until a scheduler resolves them.',
  rejectConsequence: 'Rejection closes this request without changing any roster shifts.',
  decisionNote: 'Decision note (optional)',
  savingDecision: 'Saving decision...',
  decisionSaved: 'Leave decision saved.',
  conflictBeforeApproval: 'Scheduled shifts overlap this request. Approval is still valid, but scheduler follow-up will be required.',
  configuredAuthority: 'Configured authority',
  directManager: 'Direct manager',
  teamLeader: 'Team leader',
  departmentHead: 'Department head',
  reportingChain: 'Reporting manager',
  delegatedAuthority: 'Delegated authority',
  scopedRole: 'Scoped role',
  hrAuthority: 'HR authority',
};

const AR: Copy = {
  title: 'الإجازات',
  subtitle: 'اطلب وقتاً بعيداً وتابع كل قرار من داخل جدول المناوبات.',
  requestLeave: 'طلب إجازة',
  myRequests: 'طلباتي',
  upcoming: 'الإجازات القادمة',
  history: 'السجل',
  pendingRequests: 'الطلبات المعلقة',
  upcomingApproved: 'الإجازات القادمة المعتمدة',
  needsAttention: 'طلبات تحتاج إلى متابعة',
  rosterConflicts: 'تعارضات الجدول',
  status: 'الحالة',
  allStatuses: 'كل الحالات',
  fromDate: 'من تاريخ',
  toDate: 'إلى تاريخ',
  applyFilters: 'تطبيق المرشحات',
  clearFilters: 'مسح',
  loading: 'جارٍ تحميل طلبات الإجازة...',
  loadError: 'تعذر تحميل طلبات الإجازة.',
  retry: 'إعادة المحاولة',
  emptyRequests: 'لا توجد طلبات إجازة مطابقة لهذا العرض.',
  emptyRequestsHelp: 'قدّم طلب إجازة عند الحاجة، وسيحدد سير العمل الآمن صاحب الموافقة.',
  emptyUpcoming: 'لا توجد إجازات معتمدة قادمة.',
  emptyHistory: 'لا توجد طلبات إجازة مكتملة بعد.',
  viewDetails: 'عرض التفاصيل',
  pending: 'بانتظار الموافقة',
  approved: 'معتمد',
  rejected: 'مرفوض',
  cancelled: 'ملغي',
  annual: 'إجازة سنوية',
  sick: 'إجازة مرضية',
  unpaid: 'إجازة غير مدفوعة',
  personal: 'إجازة شخصية',
  submitted: 'تاريخ التقديم',
  decided: 'تاريخ القرار',
  previous: 'السابق',
  next: 'التالي',
  page: 'صفحة',
  of: 'من',
  close: 'إغلاق',
  requestDetails: 'تفاصيل الإجازة',
  requestReview: 'مراجعة الطلب',
  leaveType: 'نوع الإجازة',
  startDate: 'تاريخ البدء',
  endDate: 'تاريخ الانتهاء',
  reason: 'السبب (اختياري)',
  reasonHelp: 'حتى 1000 حرف. لا تضف تفاصيل طبية غير ضرورية.',
  continue: 'مراجعة الطلب',
  back: 'رجوع',
  submit: 'إرسال الطلب',
  submitting: 'جارٍ الإرسال...',
  requestCreated: 'تم إرسال طلب الإجازة',
  requestCreatedHelp: 'الطلب الآن بانتظار سير الموافقة المحدد.',
  calendarDays: 'أيام تقويمية',
  selectedRange: 'الفترة المحددة',
  invalidDates: 'اختر تاريخ بداية ونهاية صالحين.',
  tooLong: 'لا يمكن أن يتجاوز طلب الإجازة 366 يوماً تقويمياً.',
  conflictError: 'يتداخل هذا الطلب مع طلب إجازة معلق أو معتمد.',
  noApprover: 'لا يوجد مسؤول موافقة مهيأ حالياً. تم إخطار الموارد البشرية لمعالجة مسار الموافقة.',
  details: 'تفاصيل طلب الإجازة',
  approvalPending: 'بانتظار مسؤول موافقة مخوّل',
  safeTimeline: 'الخط الزمني للطلب',
  conflictsHeading: 'متابعة الجدول',
  noConflicts: 'لا توجد تعارضات مع مناوبات مجدولة',
  oneConflict: 'مناوبة مجدولة واحدة تحتاج إلى متابعة',
  manyConflicts: 'مناوبات مجدولة تحتاج إلى متابعة',
  conflictExplanation: 'اعتماد الإجازة لا يلغي المناوبات المجدولة أو يعيد تعيينها تلقائياً. يجب على مسؤول الجدول معالجة كل تعارض.',
  openSchedule: 'عرض جدولي',
  cancelRequest: 'إلغاء الطلب',
  cancelHeading: 'إلغاء الطلب المعلق؟',
  cancelExplanation: 'سيتم إلغاء الطلب المعلق مع الاحتفاظ بسجله التاريخي.',
  confirmCancel: 'إلغاء الطلب',
  cancelling: 'جارٍ الإلغاء...',
  staleRequest: 'تم تغيير هذا الطلب. حدّثه ثم حاول مرة أخرى.',
  statusChanged: 'تم تحديث الطلب بنجاح.',
  schedulerAttention: 'يتطلب متابعة مسؤول الجدول',
  dateRange: 'الفترة',
  notAvailable: 'غير متاح',
  approvals: 'الموافقات',
  approvalsSubtitle: 'طلبات الإجازة القابلة للإجراء ضمن نطاق صلاحيتك.',
  awaitingApproval: 'بانتظار موافقتي',
  approvedRecently: 'معتمد مؤخراً',
  rejectedRecently: 'مرفوض مؤخراً',
  scopedConflicts: 'تعارضات جدول مفتوحة ضمن النطاق',
  actionableOnly: 'القابلة للإجراء فقط',
  employeeSearch: 'بحث الموظفين',
  searchPlaceholder: 'ابحث باسم الموظف',
  leaveTypeFilter: 'نوع الإجازة',
  allTypes: 'كل أنواع الإجازات',
  emptyApprovals: 'لا توجد طلبات إجازة بانتظار إجراء منك.',
  emptyApprovalsHelp: 'تظهر هنا فقط الطلبات الواقعة ضمن نطاق صلاحيتك الحالية.',
  review: 'مراجعة',
  employee: 'الموظف',
  authority: 'الصلاحية',
  scope: 'النطاق',
  approve: 'موافقة',
  reject: 'رفض',
  approveHeading: 'الموافقة على طلب الإجازة؟',
  rejectHeading: 'رفض طلب الإجازة؟',
  approveConsequence: 'تؤكد الموافقة تواريخ الإجازة. تبقى تعارضات الجدول قائمة حتى يعالجها مسؤول الجدول.',
  rejectConsequence: 'يغلق الرفض هذا الطلب من دون تغيير أي مناوبة.',
  decisionNote: 'ملاحظة القرار (اختيارية)',
  savingDecision: 'جارٍ حفظ القرار...',
  decisionSaved: 'تم حفظ قرار الإجازة.',
  conflictBeforeApproval: 'تتداخل مناوبات مجدولة مع هذا الطلب. تظل الموافقة صالحة، ولكنها تتطلب متابعة مسؤول الجدول.',
  configuredAuthority: 'صلاحية مهيأة',
  directManager: 'المدير المباشر',
  teamLeader: 'قائد الفريق',
  departmentHead: 'رئيس القسم',
  reportingChain: 'مدير التسلسل الإداري',
  delegatedAuthority: 'صلاحية مفوضة',
  scopedRole: 'دور محدد النطاق',
  hrAuthority: 'صلاحية الموارد البشرية',
};

const LEAVE_TYPES = ['annual', 'sick', 'unpaid', 'personal'] as const;
const PAGE_SIZE = 8;
const focusableSelector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

function calendarDays(startDate: string, endDate: string) {
  if (!startDate || !endDate) return 0;
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.floor((end - start) / 86_400_000) + 1;
}

function useDialog(open: boolean, onClose: () => void) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    window.setTimeout(() => dialog?.querySelector<HTMLElement>(focusableSelector)?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      restoreFocusRef.current?.focus();
    };
  }, [onClose, open]);

  return dialogRef;
}

function LeaveDialog({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useDialog(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/65 p-2 sm:items-center sm:p-4" role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="leave-dialog-title"
        className="max-h-[calc(100dvh-1rem)] w-full max-w-2xl overflow-y-auto rounded-xl border border-emerald-500/20 bg-white p-4 shadow-2xl dark:bg-[#07150f] sm:max-h-[calc(100dvh-2rem)] sm:p-6"
      >
        <div className="flex items-center justify-between gap-3">
          <h3 id="leave-dialog-title" className="text-base font-bold text-slate-900 dark:text-emerald-50">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-2 text-slate-500 transition hover:bg-emerald-500/10 hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 dark:text-emerald-100/60"
            aria-label={title}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function statusClass(status: LeaveStatus) {
  if (status === 'approved') return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200';
  if (status === 'rejected') return 'border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-200';
  if (status === 'cancelled') return 'border-slate-400/25 bg-slate-500/10 text-slate-600 dark:text-slate-300';
  return 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-200';
}

function isTerminal(status: LeaveStatus) {
  return status !== 'pending';
}

export function LeaveWorkspace({
  openRequestSignal = 0,
  initialRequestId,
  initialLeaveView,
  hasApproverAuthorityHint = false,
  onOpenSchedule,
  onDataChanged,
}: {
  openRequestSignal?: number;
  initialRequestId?: string | null;
  initialLeaveView?: LeaveView | null;
  hasApproverAuthorityHint?: boolean;
  onOpenSchedule?: () => void;
  onDataChanged?: () => void;
}) {
  const { lang, isRtl } = useLanguage();
  const copy = lang === 'ar' ? AR : EN;
  const locale = lang === 'ar' ? 'ar-EG' : 'en-US';
  const [view, setView] = useState<LeaveView>(initialLeaveView || 'requests');
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);
  const [requestStep, setRequestStep] = useState<RequestStep>('details');
  const [requestForm, setRequestForm] = useState({ leaveType: 'annual', startDate: '', endDate: '', reason: '' });
  const [requestError, setRequestError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [detail, setDetail] = useState<LeaveDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [approvalVisible, setApprovalVisible] = useState(hasApproverAuthorityHint);
  const [approvalProbed, setApprovalProbed] = useState(false);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [approvalTotal, setApprovalTotal] = useState(0);
  const [approvalPage, setApprovalPage] = useState(1);
  const [approvalLoading, setApprovalLoading] = useState(false);
  const [approvalError, setApprovalError] = useState('');
  const [approvalStatus, setApprovalStatus] = useState('pending');
  const [approvalLeaveType, setApprovalLeaveType] = useState('');
  const [approvalSearch, setApprovalSearch] = useState('');
  const [approvalFromDate, setApprovalFromDate] = useState('');
  const [approvalToDate, setApprovalToDate] = useState('');
  const [actionableOnly, setActionableOnly] = useState(true);
  const [approvalDetail, setApprovalDetail] = useState<ApprovalDetail | null>(null);
  const [approvalDetailLoading, setApprovalDetailLoading] = useState(false);
  const [approvalDetailError, setApprovalDetailError] = useState('');
  const [decision, setDecision] = useState<ApprovalDecision | null>(null);
  const [decisionNote, setDecisionNote] = useState('');
  const [decisionBusy, setDecisionBusy] = useState(false);
  const lastOpenSignal = useRef(openRequestSignal);
  const submittingRef = useRef(false);
  const decisionRef = useRef(false);

  const labelStatus = useCallback((value: LeaveStatus) => copy[value] || value, [copy]);
  const labelType = useCallback((value: string) => copy[value] || value.replaceAll('_', ' '), [copy]);
  const formatDate = useCallback((value?: string | null) => (
    value ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(`${value.slice(0, 10)}T00:00:00`)) : copy.notAvailable
  ), [copy.notAvailable, locale]);
  const formatDateTime = useCallback((value?: string | null) => (
    value ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : copy.notAvailable
  ), [copy.notAvailable, locale]);
  const authorityLabel = useCallback((value?: string | null) => {
    const normalized = (value || '').toLowerCase();
    if (normalized.includes('direct manager')) return copy.directManager;
    if (normalized.includes('team leader')) return copy.teamLeader;
    if (normalized.includes('department head')) return copy.departmentHead;
    if (normalized.includes('reporting')) return copy.reportingChain;
    if (normalized.includes('delegat')) return copy.delegatedAuthority;
    if (normalized.includes('scoped')) return copy.scopedRole;
    if (normalized.includes('company') || normalized.includes('hr')) return copy.hrAuthority;
    return value || copy.configuredAuthority;
  }, [copy]);

  const effectiveQuery = useMemo(() => {
    const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (view === 'upcoming') {
      query.set('status', 'approved');
      query.set('fromDate', new Date().toISOString().slice(0, 10));
    } else {
      if (status) query.set('status', status);
      if (fromDate) query.set('fromDate', fromDate);
      if (toDate) query.set('toDate', toDate);
    }
    return query;
  }, [fromDate, page, status, toDate, view]);

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiFetch(`/api/me/leave-requests?${effectiveQuery.toString()}`);
      const data = await response.json() as LeaveListResponse;
      if (!response.ok || !data.success) throw new Error(data.error || copy.loadError);
      const next = data.requests || [];
      setRequests(view === 'history' ? next.filter((request) => isTerminal(request.status)) : next);
      setTotal(Number(data.total || 0));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : copy.loadError);
    } finally {
      setLoading(false);
    }
  }, [copy.loadError, effectiveQuery, view]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  useEffect(() => {
    if (openRequestSignal === lastOpenSignal.current) return;
    lastOpenSignal.current = openRequestSignal;
    setRequestStep('details');
    setRequestError('');
    setRequestDialogOpen(true);
  }, [openRequestSignal]);

  const loadDetail = useCallback(async (requestId: string) => {
    setDetailLoading(true);
    setDetailError('');
    setDetail(null);
    try {
      const response = await apiFetch(`/api/me/leave-requests/${requestId}`);
      const data = await response.json() as LeaveDetail & { success?: boolean; error?: string };
      if (!response.ok || !data.success) throw new Error(data.error || copy.loadError);
      setDetail({ request: data.request, history: data.history || [] });
    } catch (loadError) {
      setDetailError(loadError instanceof Error ? loadError.message : copy.loadError);
    } finally {
      setDetailLoading(false);
    }
  }, [copy.loadError]);

  useEffect(() => {
    if (initialRequestId && initialLeaveView !== 'approvals') void loadDetail(initialRequestId);
  }, [initialLeaveView, initialRequestId, loadDetail]);

  useEffect(() => {
    if (initialLeaveView) setView(initialLeaveView);
  }, [initialLeaveView]);

  const approvalQuery = useMemo(() => {
    const query = new URLSearchParams({
      page: String(approvalPage),
      pageSize: String(PAGE_SIZE),
      actionableOnly: String(actionableOnly),
    });
    if (approvalStatus) query.set('status', approvalStatus);
    if (approvalLeaveType) query.set('leaveType', approvalLeaveType);
    if (approvalSearch.trim()) query.set('search', approvalSearch.trim());
    if (approvalFromDate) query.set('fromDate', approvalFromDate);
    if (approvalToDate) query.set('toDate', approvalToDate);
    return query;
  }, [actionableOnly, approvalFromDate, approvalLeaveType, approvalPage, approvalSearch, approvalStatus, approvalToDate]);

  const loadApprovals = useCallback(async (probe = false) => {
    if (!probe) setApprovalLoading(true);
    setApprovalError('');
    try {
      const query = probe
        ? new URLSearchParams({ page: '1', pageSize: '1', actionableOnly: 'true', status: 'pending' })
        : approvalQuery;
      const response = await apiFetch(`/api/hr/leave-requests?${query.toString()}`);
      const data = await response.json() as { success?: boolean; requests?: ApprovalRequest[]; total?: number; error?: string };
      if (!response.ok || !data.success) {
        if (response.status === 401 || response.status === 403) {
          if (!hasApproverAuthorityHint) setApprovalVisible(false);
          return;
        }
        throw new Error(data.error || copy.loadError);
      }
      const nextRequests = data.requests || [];
      if (probe) {
        if (hasApproverAuthorityHint || nextRequests.length > 0) setApprovalVisible(true);
        return;
      }
      setApprovals(nextRequests);
      setApprovalTotal(Number(data.total || 0));
      if (hasApproverAuthorityHint || nextRequests.length > 0 || Number(data.total || 0) > 0) setApprovalVisible(true);
    } catch (loadError) {
      if (!probe) setApprovalError(loadError instanceof Error ? loadError.message : copy.loadError);
    } finally {
      if (probe) setApprovalProbed(true);
      if (!probe) setApprovalLoading(false);
    }
  }, [approvalQuery, copy.loadError, hasApproverAuthorityHint]);

  useEffect(() => {
    void loadApprovals(true);
  }, [loadApprovals]);

  useEffect(() => {
    if (view === 'approvals' && approvalVisible) void loadApprovals();
  }, [approvalVisible, loadApprovals, view]);

  useEffect(() => {
    if (approvalProbed && view === 'approvals' && !approvalVisible) setView('requests');
  }, [approvalProbed, approvalVisible, view]);

  const loadApprovalDetail = useCallback(async (requestId: string) => {
    setApprovalDetailLoading(true);
    setApprovalDetailError('');
    setApprovalDetail(null);
    try {
      const response = await apiFetch(`/api/hr/leave-requests/${requestId}`);
      const data = await response.json() as ApprovalDetail & { success?: boolean; error?: string };
      if (!response.ok || !data.success) throw new Error(data.error || copy.loadError);
      setApprovalDetail({ request: data.request, history: data.history || [] });
    } catch (loadError) {
      setApprovalDetailError(loadError instanceof Error ? loadError.message : copy.loadError);
    } finally {
      setApprovalDetailLoading(false);
    }
  }, [copy.loadError]);

  useEffect(() => {
    if (initialRequestId && initialLeaveView === 'approvals') {
      setDetail(null);
      void loadApprovalDetail(initialRequestId);
    }
  }, [initialLeaveView, initialRequestId, loadApprovalDetail]);

  const submitDecision = async () => {
    if (!approvalDetail?.request || !decision || decisionRef.current) return;
    decisionRef.current = true;
    setDecisionBusy(true);
    setApprovalDetailError('');
    try {
      const response = await apiFetch(`/api/hr/leave-requests/${approvalDetail.request.requestId}/${decision}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedVersion: approvalDetail.request.version,
          note: decisionNote.trim() || null,
        }),
      });
      const data = await response.json() as { success?: boolean; error?: string };
      if (!response.ok || !data.success) throw new Error(response.status === 409 ? copy.staleRequest : data.error || copy.loadError);
      const requestId = approvalDetail.request.requestId;
      setDecision(null);
      setDecisionNote('');
      setMessage(copy.decisionSaved);
      await Promise.all([loadApprovals(), loadApprovalDetail(requestId), loadRequests()]);
      onDataChanged?.();
    } catch (saveError) {
      setDecision(null);
      setApprovalDetailError(saveError instanceof Error ? saveError.message : copy.loadError);
    } finally {
      decisionRef.current = false;
      setDecisionBusy(false);
    }
  };

  const openRequestDialog = () => {
    setRequestStep('details');
    setRequestError('');
    setRequestDialogOpen(true);
  };

  const validateRequest = () => {
    const days = calendarDays(requestForm.startDate, requestForm.endDate);
    if (days < 1) return copy.invalidDates;
    if (days > 366) return copy.tooLong;
    return '';
  };

  const reviewRequest = () => {
    const validation = validateRequest();
    setRequestError(validation);
    if (!validation) setRequestStep('review');
  };

  const submitRequest = async () => {
    if (submittingRef.current) return;
    const validation = validateRequest();
    if (validation) {
      setRequestError(validation);
      setRequestStep('details');
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setRequestError('');
    try {
      const response = await apiFetch('/api/me/leave-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leaveType: requestForm.leaveType,
          startDate: requestForm.startDate,
          endDate: requestForm.endDate,
          reason: requestForm.reason.trim() || null,
        }),
      });
      const data = await response.json() as { success?: boolean; request?: LeaveRequest; error?: string };
      if (!response.ok || !data.success || !data.request) {
        const safeError = data.error || copy.loadError;
        throw new Error(response.status === 409 ? copy.conflictError : safeError);
      }
      setRequestStep('success');
      setMessage(copy.requestCreated);
      await loadRequests();
      onDataChanged?.();
    } catch (submitError) {
      setRequestError(submitError instanceof Error ? submitError.message : copy.loadError);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const closeRequestDialog = useCallback(() => {
    if (submittingRef.current) return;
    setRequestDialogOpen(false);
    if (requestStep === 'success') {
      setRequestForm({ leaveType: 'annual', startDate: '', endDate: '', reason: '' });
      setRequestStep('details');
    }
  }, [requestStep]);

  const cancelRequest = async () => {
    if (!detail?.request || cancelling) return;
    setCancelling(true);
    setDetailError('');
    try {
      const response = await apiFetch(`/api/me/leave-requests/${detail.request.requestId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: detail.request.version }),
      });
      const data = await response.json() as { success?: boolean; request?: LeaveRequest; error?: string };
      if (!response.ok || !data.success) throw new Error(response.status === 409 ? copy.staleRequest : data.error || copy.loadError);
      setCancelOpen(false);
      setMessage(copy.statusChanged);
      await Promise.all([loadRequests(), loadDetail(detail.request.requestId)]);
      onDataChanged?.();
    } catch (cancelError) {
      setDetailError(cancelError instanceof Error ? cancelError.message : copy.loadError);
      setCancelOpen(false);
    } finally {
      setCancelling(false);
    }
  };

  const tabKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const tabs: LeaveView[] = approvalVisible ? ['requests', 'upcoming', 'history', 'approvals'] : ['requests', 'upcoming', 'history'];
    const current = tabs.indexOf(view);
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    setView(tabs[next]);
    setPage(1);
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };

  const summary = useMemo(() => ({
    pending: requests.filter((request) => request.status === 'pending').length,
    upcoming: requests.filter((request) => request.status === 'approved' && request.endDate >= new Date().toISOString().slice(0, 10)).length,
    attention: requests.filter((request) => request.status === 'pending' && !request.approvalConfigured).length,
    conflicts: requests.reduce((count, request) => count + request.conflictCount, 0),
  }), [requests]);
  const summaryCards: Array<{ label: string; count: number; Icon: typeof Clock3 }> = [
    { label: copy.pendingRequests, count: summary.pending, Icon: Clock3 },
    { label: copy.upcomingApproved, count: summary.upcoming, Icon: CheckCircle2 },
    { label: copy.needsAttention, count: summary.attention, Icon: AlertTriangle },
    { label: copy.rosterConflicts, count: summary.conflicts, Icon: CalendarDays },
  ];

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const approvalPageCount = Math.max(1, Math.ceil(approvalTotal / PAGE_SIZE));
  const emptyText = view === 'upcoming' ? copy.emptyUpcoming : view === 'history' ? copy.emptyHistory : copy.emptyRequests;

  return (
    <section className="border-t border-emerald-500/10 p-3 sm:p-5" dir={isRtl ? 'rtl' : 'ltr'} data-leave-workspace>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-emerald-50">
            <CalendarDays className="h-5 w-5 text-emerald-500" />
            {copy.title}
          </h3>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500 dark:text-emerald-100/55">{copy.subtitle}</p>
        </div>
        <button
          type="button"
          onClick={openRequestDialog}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-black transition hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 dark:ring-offset-[#07150f]"
        >
          <FileText className="h-4 w-4" />
          {copy.requestLeave}
        </button>
      </div>

      {message && <p role="status" className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-100">{message}</p>}

      <div className="mt-5 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {summaryCards.map(({ label, count, Icon }) => (
          <article key={label} className="min-w-0 rounded-lg border border-emerald-500/15 bg-white/70 p-3 dark:bg-black/25">
            <Icon className="h-4 w-4 text-emerald-500" />
            <p className="mt-3 text-xl font-bold text-slate-900 dark:text-emerald-50">{count}</p>
            <p className="mt-1 text-[11px] leading-4 text-slate-500 dark:text-emerald-100/50">{label}</p>
          </article>
        ))}
      </div>

      <div role="tablist" aria-label={copy.title} onKeyDown={tabKeyDown} className="mt-5 flex max-w-full gap-1 overflow-x-auto border-b border-emerald-500/10 pb-2">
        {([
          ['requests', copy.myRequests],
          ['upcoming', copy.upcoming],
          ['history', copy.history],
          ...(approvalVisible ? [['approvals', copy.approvals]] : []),
        ] as Array<[LeaveView, string]>).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={view === value}
            tabIndex={view === value ? 0 : -1}
            onClick={() => {
              setView(value);
              setPage(1);
            }}
            className={cn(
              'min-h-10 shrink-0 rounded-md px-3 text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400',
              view === value ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-100' : 'text-slate-500 hover:bg-emerald-500/10 dark:text-emerald-100/55',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'requests' && (
        <div className="mt-4 grid gap-2 rounded-lg border border-emerald-500/10 bg-black/[0.02] p-3 dark:bg-black/20 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-[11px] font-bold text-slate-600 dark:text-emerald-100/60">
            {copy.status}
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="stanza-select mt-1 w-full">
              <option value="">{copy.allStatuses}</option>
              {(['pending', 'approved', 'rejected', 'cancelled'] as LeaveStatus[]).map((value) => <option key={value} value={value}>{labelStatus(value)}</option>)}
            </select>
          </label>
          <label className="text-[11px] font-bold text-slate-600 dark:text-emerald-100/60">
            {copy.fromDate}
            <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="mt-1 w-full rounded-md border border-emerald-500/20 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-emerald-400 dark:bg-black/35 dark:text-emerald-50" />
          </label>
          <label className="text-[11px] font-bold text-slate-600 dark:text-emerald-100/60">
            {copy.toDate}
            <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="mt-1 w-full rounded-md border border-emerald-500/20 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-emerald-400 dark:bg-black/35 dark:text-emerald-50" />
          </label>
          <button type="button" onClick={() => { setPage(1); void loadRequests(); }} className="min-h-10 self-end rounded-md bg-emerald-600 px-3 py-2 text-xs font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">{copy.applyFilters}</button>
          <button type="button" onClick={() => { setStatus(''); setFromDate(''); setToDate(''); setPage(1); }} className="min-h-10 self-end rounded-md border border-emerald-500/20 px-3 py-2 text-xs font-bold text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 dark:text-emerald-100/70">{copy.clearFilters}</button>
        </div>
      )}

      {view !== 'approvals' && error && (
        <div role="alert" className="mt-4 flex flex-col gap-3 rounded-lg border border-red-500/25 bg-red-500/10 p-4 text-xs text-red-700 dark:text-red-200 sm:flex-row sm:items-center sm:justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => void loadRequests()} className="inline-flex min-h-10 items-center justify-center gap-2 rounded border border-current px-3 font-bold"><RefreshCw className="h-4 w-4" />{copy.retry}</button>
        </div>
      )}

      {view === 'approvals' ? (
        <section className="mt-4" aria-label={copy.approvals}>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {[
              { label: copy.awaitingApproval, count: approvalStatus === 'pending' ? approvalTotal : approvals.filter((request) => request.status === 'pending').length },
              { label: copy.approvedRecently, count: approvals.filter((request) => request.status === 'approved').length },
              { label: copy.rejectedRecently, count: approvals.filter((request) => request.status === 'rejected').length },
              { label: copy.scopedConflicts, count: approvals.reduce((count, request) => count + request.conflictCount, 0) },
            ].map((card) => (
              <article key={card.label} className="rounded-lg border border-emerald-500/15 bg-white/70 p-3 dark:bg-black/25">
                <p className="text-xl font-bold text-slate-900 dark:text-emerald-50">{card.count}</p>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-emerald-100/50">{card.label}</p>
              </article>
            ))}
          </div>
          <div className="mt-4 grid gap-2 rounded-lg border border-emerald-500/10 bg-black/[0.02] p-3 dark:bg-black/20 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-[11px] font-bold text-slate-600 dark:text-emerald-100/60">
              {copy.employeeSearch}
              <input value={approvalSearch} onChange={(event) => setApprovalSearch(event.target.value)} placeholder={copy.searchPlaceholder} className="mt-1 w-full rounded-md border border-emerald-500/20 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-emerald-400 dark:bg-black/35 dark:text-emerald-50" />
            </label>
            <label className="text-[11px] font-bold text-slate-600 dark:text-emerald-100/60">
              {copy.status}
              <select value={approvalStatus} onChange={(event) => { setApprovalStatus(event.target.value); setApprovalPage(1); }} className="stanza-select mt-1 w-full">
                <option value="">{copy.allStatuses}</option>
                {(['pending', 'approved', 'rejected', 'cancelled'] as LeaveStatus[]).map((value) => <option key={value} value={value}>{labelStatus(value)}</option>)}
              </select>
            </label>
            <label className="text-[11px] font-bold text-slate-600 dark:text-emerald-100/60">
              {copy.leaveTypeFilter}
              <select value={approvalLeaveType} onChange={(event) => { setApprovalLeaveType(event.target.value); setApprovalPage(1); }} className="stanza-select mt-1 w-full">
                <option value="">{copy.allTypes}</option>
                {LEAVE_TYPES.map((value) => <option key={value} value={value}>{labelType(value)}</option>)}
              </select>
            </label>
            <label className="flex min-h-10 items-center gap-2 self-end rounded-md border border-emerald-500/20 px-3 py-2 text-xs font-bold text-slate-600 dark:text-emerald-100/70">
              <input type="checkbox" checked={actionableOnly} onChange={(event) => { setActionableOnly(event.target.checked); setApprovalPage(1); }} className="h-4 w-4 accent-emerald-500" />
              {copy.actionableOnly}
            </label>
            <label className="text-[11px] font-bold text-slate-600 dark:text-emerald-100/60">
              {copy.fromDate}
              <input type="date" value={approvalFromDate} onChange={(event) => setApprovalFromDate(event.target.value)} className="mt-1 w-full rounded-md border border-emerald-500/20 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-emerald-400 dark:bg-black/35 dark:text-emerald-50" />
            </label>
            <label className="text-[11px] font-bold text-slate-600 dark:text-emerald-100/60">
              {copy.toDate}
              <input type="date" value={approvalToDate} onChange={(event) => setApprovalToDate(event.target.value)} className="mt-1 w-full rounded-md border border-emerald-500/20 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-emerald-400 dark:bg-black/35 dark:text-emerald-50" />
            </label>
            <button type="button" onClick={() => { setApprovalPage(1); void loadApprovals(); }} className="min-h-10 self-end rounded-md bg-emerald-600 px-3 py-2 text-xs font-bold text-white">{copy.applyFilters}</button>
            <button type="button" onClick={() => { setApprovalSearch(''); setApprovalStatus('pending'); setApprovalLeaveType(''); setApprovalFromDate(''); setApprovalToDate(''); setActionableOnly(true); setApprovalPage(1); }} className="min-h-10 self-end rounded-md border border-emerald-500/20 px-3 py-2 text-xs font-bold text-slate-600 dark:text-emerald-100/70">{copy.clearFilters}</button>
          </div>
          {approvalError && (
            <div role="alert" className="mt-4 flex flex-col gap-3 rounded-lg border border-red-500/25 bg-red-500/10 p-4 text-xs text-red-700 dark:text-red-200 sm:flex-row sm:items-center sm:justify-between">
              <span>{approvalError}</span>
              <button type="button" onClick={() => void loadApprovals()} className="inline-flex min-h-10 items-center justify-center gap-2 rounded border border-current px-3 font-bold"><RefreshCw className="h-4 w-4" />{copy.retry}</button>
            </div>
          )}
          {approvalLoading ? (
            <div className="flex min-h-52 items-center justify-center gap-2 text-xs text-slate-500 dark:text-emerald-100/50"><LoaderCircle className="h-5 w-5 animate-spin text-emerald-500" />{copy.loading}</div>
          ) : approvals.length === 0 ? (
            <div className="flex min-h-52 flex-col items-center justify-center rounded-lg border border-dashed border-emerald-500/20 p-5 text-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-500/70" />
              <p className="mt-3 text-sm font-bold text-slate-800 dark:text-emerald-50">{copy.emptyApprovals}</p>
              <p className="mt-2 max-w-md text-xs leading-5 text-slate-500 dark:text-emerald-100/50">{copy.emptyApprovalsHelp}</p>
            </div>
          ) : (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {approvals.map((request) => (
                <article key={request.requestId} className="rounded-lg border border-emerald-500/15 bg-white/75 p-4 shadow-sm dark:bg-black/25">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-900 dark:text-emerald-50">{request.employee.displayName}</p>
                      <p className="mt-1 text-xs text-slate-600 dark:text-emerald-100/65">{labelType(request.leaveType)}</p>
                    </div>
                    <span className={cn('shrink-0 rounded-full border px-2 py-1 text-[10px] font-bold', statusClass(request.status))}>{labelStatus(request.status)}</span>
                  </div>
                  <p className="mt-3 text-xs font-medium text-slate-600 dark:text-emerald-100/65" dir="ltr">{formatDate(request.startDate)} – {formatDate(request.endDate)}</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-bold">
                    <span className="rounded-full border border-emerald-500/20 px-2 py-1 text-emerald-700 dark:text-emerald-200">{authorityLabel(request.approvalSourceLabel)}</span>
                    {request.scopeLabel && <span className="rounded-full border border-slate-400/20 px-2 py-1 text-slate-500 dark:text-slate-300">{request.scopeLabel}</span>}
                  </div>
                  {request.hasRosterConflict && <p className="mt-3 flex items-center gap-2 text-[11px] font-bold text-amber-700 dark:text-amber-200"><AlertTriangle className="h-4 w-4" />{request.conflictCount === 1 ? copy.oneConflict : `${request.conflictCount} ${copy.manyConflicts}`}</p>}
                  <button type="button" onClick={() => void loadApprovalDetail(request.requestId)} className="mt-4 min-h-10 rounded-md bg-emerald-600 px-3 py-2 text-xs font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">{copy.review}</button>
                </article>
              ))}
            </div>
          )}
          {!approvalLoading && approvalTotal > PAGE_SIZE && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-emerald-100/55">
              <span>{copy.page} {approvalPage} {copy.of} {approvalPageCount}</span>
              <div className="flex gap-2">
                <button type="button" disabled={approvalPage <= 1} onClick={() => setApprovalPage((current) => Math.max(1, current - 1))} className="min-h-10 rounded border border-emerald-500/20 px-3 disabled:opacity-40">{copy.previous}</button>
                <button type="button" disabled={approvalPage >= approvalPageCount} onClick={() => setApprovalPage((current) => Math.min(approvalPageCount, current + 1))} className="min-h-10 rounded border border-emerald-500/20 px-3 disabled:opacity-40">{copy.next}</button>
              </div>
            </div>
          )}
        </section>
      ) : loading ? (
        <div className="flex min-h-52 items-center justify-center gap-2 text-xs text-slate-500 dark:text-emerald-100/50">
          <LoaderCircle className="h-5 w-5 animate-spin text-emerald-500" />
          {copy.loading}
        </div>
      ) : requests.length === 0 ? (
        <div className="flex min-h-52 flex-col items-center justify-center rounded-lg border border-dashed border-emerald-500/20 p-5 text-center">
          <CalendarDays className="h-8 w-8 text-emerald-500/70" />
          <p className="mt-3 text-sm font-bold text-slate-800 dark:text-emerald-50">{emptyText}</p>
          {view === 'requests' && <p className="mt-2 max-w-md text-xs leading-5 text-slate-500 dark:text-emerald-100/50">{copy.emptyRequestsHelp}</p>}
        </div>
      ) : (
        <div role="tabpanel" className="mt-4 grid gap-3 md:grid-cols-2">
          {requests.map((request) => (
            <article key={request.requestId} className="min-w-0 rounded-lg border border-emerald-500/15 bg-white/75 p-4 shadow-sm dark:bg-black/25">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-900 dark:text-emerald-50">{labelType(request.leaveType)}</p>
                  <p className="mt-1 text-xs font-medium text-slate-600 dark:text-emerald-100/65" dir="ltr">{formatDate(request.startDate)} – {formatDate(request.endDate)}</p>
                </div>
                <span className={cn('shrink-0 rounded-full border px-2 py-1 text-[10px] font-bold', statusClass(request.status))}>{labelStatus(request.status)}</span>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-2 text-[11px] text-slate-500 dark:text-emerald-100/50">
                <dt>{copy.submitted}</dt><dd className="text-end">{formatDateTime(request.submittedAt)}</dd>
                {request.decisionAt && <><dt>{copy.decided}</dt><dd className="text-end">{formatDateTime(request.decisionAt)}</dd></>}
              </dl>
              {request.status === 'pending' && !request.approvalConfigured && <p className="mt-3 rounded border border-amber-500/20 bg-amber-500/10 p-2 text-[11px] leading-4 text-amber-800 dark:text-amber-100">{copy.noApprover}</p>}
              {request.hasRosterConflict && <p className="mt-3 inline-flex items-center gap-2 text-[11px] font-bold text-amber-700 dark:text-amber-200"><AlertTriangle className="h-4 w-4" />{request.conflictCount === 1 ? copy.oneConflict : `${request.conflictCount} ${copy.manyConflicts}`}</p>}
              <button type="button" onClick={() => void loadDetail(request.requestId)} className="mt-4 min-h-10 rounded-md border border-emerald-500/20 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 dark:text-emerald-200">{copy.viewDetails}</button>
            </article>
          ))}
        </div>
      )}

      {view !== 'approvals' && !loading && total > PAGE_SIZE && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-emerald-100/55">
          <span>{copy.page} {page} {copy.of} {pageCount}</span>
          <div className="flex gap-2">
            <button type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="inline-flex min-h-10 items-center gap-1 rounded border border-emerald-500/20 px-3 disabled:opacity-40"><ChevronLeft className="h-4 w-4" />{copy.previous}</button>
            <button type="button" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))} className="inline-flex min-h-10 items-center gap-1 rounded border border-emerald-500/20 px-3 disabled:opacity-40">{copy.next}<ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      )}

      <LeaveDialog open={requestDialogOpen} title={requestStep === 'review' ? copy.requestReview : copy.requestDetails} onClose={closeRequestDialog}>
        {requestStep === 'details' && (
          <form className="mt-5 space-y-4" onSubmit={(event) => { event.preventDefault(); reviewRequest(); }}>
            <label className="block text-xs font-bold text-slate-700 dark:text-emerald-100/70">
              {copy.leaveType}
              <select value={requestForm.leaveType} onChange={(event) => setRequestForm((current) => ({ ...current, leaveType: event.target.value }))} className="stanza-select mt-1 w-full">
                {LEAVE_TYPES.map((value) => <option key={value} value={value}>{labelType(value)}</option>)}
              </select>
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-xs font-bold text-slate-700 dark:text-emerald-100/70">
                {copy.startDate}
                <input required type="date" value={requestForm.startDate} onChange={(event) => setRequestForm((current) => ({ ...current, startDate: event.target.value }))} className="mt-1 w-full rounded-md border border-emerald-500/20 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-400 dark:bg-black/35 dark:text-emerald-50" />
              </label>
              <label className="block text-xs font-bold text-slate-700 dark:text-emerald-100/70">
                {copy.endDate}
                <input required type="date" min={requestForm.startDate || undefined} value={requestForm.endDate} onChange={(event) => setRequestForm((current) => ({ ...current, endDate: event.target.value }))} className="mt-1 w-full rounded-md border border-emerald-500/20 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-400 dark:bg-black/35 dark:text-emerald-50" />
              </label>
            </div>
            <label className="block text-xs font-bold text-slate-700 dark:text-emerald-100/70">
              {copy.reason}
              <textarea maxLength={1000} rows={4} value={requestForm.reason} onChange={(event) => setRequestForm((current) => ({ ...current, reason: event.target.value }))} className="mt-1 w-full resize-y rounded-md border border-emerald-500/20 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-400 dark:bg-black/35 dark:text-emerald-50" />
              <span className="mt-1 block font-normal text-slate-500 dark:text-emerald-100/45">{copy.reasonHelp}</span>
            </label>
            {requestError && <p role="alert" className="rounded border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-200">{requestError}</p>}
            <div className="flex justify-end">
              <button type="submit" className="min-h-11 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">{copy.continue}</button>
            </div>
          </form>
        )}
        {requestStep === 'review' && (
          <div className="mt-5">
            <div className="rounded-lg border border-emerald-500/15 bg-emerald-500/5 p-4">
              <p className="text-[11px] font-bold uppercase text-slate-500 dark:text-emerald-100/50">{copy.selectedRange}</p>
              <p className="mt-2 text-base font-bold text-slate-900 dark:text-emerald-50" dir="ltr">{formatDate(requestForm.startDate)} – {formatDate(requestForm.endDate)}</p>
              <p className="mt-2 text-xs text-slate-600 dark:text-emerald-100/65">{calendarDays(requestForm.startDate, requestForm.endDate)} {copy.calendarDays}</p>
              <dl className="mt-4 grid grid-cols-2 gap-2 text-xs text-slate-600 dark:text-emerald-100/60">
                <dt>{copy.leaveType}</dt><dd className="text-end font-bold">{labelType(requestForm.leaveType)}</dd>
                {requestForm.reason.trim() && <><dt>{copy.reason}</dt><dd className="break-words text-end">{requestForm.reason.trim()}</dd></>}
              </dl>
            </div>
            {requestError && <p role="alert" className="mt-4 rounded border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-200">{requestError}</p>}
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" disabled={submitting} onClick={() => setRequestStep('details')} className="min-h-11 rounded-lg border border-emerald-500/20 px-4 py-2 text-xs font-bold text-slate-600 dark:text-emerald-100/70">{copy.back}</button>
              <button type="button" disabled={submitting} onClick={() => void submitRequest()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-black disabled:opacity-55">{submitting && <LoaderCircle className="h-4 w-4 animate-spin" />}{submitting ? copy.submitting : copy.submit}</button>
            </div>
          </div>
        )}
        {requestStep === 'success' && (
          <div className="py-8 text-center" role="status">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
            <p className="mt-4 text-base font-bold text-slate-900 dark:text-emerald-50">{copy.requestCreated}</p>
            <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-slate-500 dark:text-emerald-100/55">{copy.requestCreatedHelp}</p>
            <button type="button" onClick={closeRequestDialog} className="mt-5 min-h-11 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-black">{copy.close}</button>
          </div>
        )}
      </LeaveDialog>

      <LeaveDialog open={detailLoading || Boolean(detail) || Boolean(detailError)} title={copy.details} onClose={() => { setDetail(null); setDetailError(''); }}>
        {detailLoading ? (
          <div className="flex min-h-48 items-center justify-center"><LoaderCircle className="h-6 w-6 animate-spin text-emerald-500" /></div>
        ) : detailError ? (
          <div role="alert" className="mt-5 rounded-lg border border-red-500/25 bg-red-500/10 p-4 text-xs text-red-700 dark:text-red-200">
            <p>{detailError}</p>
            {detail?.request.requestId && <button type="button" onClick={() => void loadDetail(detail.request.requestId)} className="mt-3 rounded border border-current px-3 py-2 font-bold">{copy.retry}</button>}
          </div>
        ) : detail && (
          <div className="mt-5 space-y-5">
            <div className="rounded-lg border border-emerald-500/15 bg-emerald-500/5 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-base font-bold text-slate-900 dark:text-emerald-50">{labelType(detail.request.leaveType)}</p>
                  <p className="mt-1 text-xs text-slate-600 dark:text-emerald-100/65" dir="ltr">{formatDate(detail.request.startDate)} – {formatDate(detail.request.endDate)}</p>
                </div>
                <span className={cn('rounded-full border px-2 py-1 text-[10px] font-bold', statusClass(detail.request.status))}>{labelStatus(detail.request.status)}</span>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-2 text-xs text-slate-500 dark:text-emerald-100/55">
                <dt>{copy.submitted}</dt><dd className="text-end">{formatDateTime(detail.request.submittedAt)}</dd>
                <dt>{copy.decided}</dt><dd className="text-end">{formatDateTime(detail.request.decisionAt)}</dd>
              </dl>
              {detail.request.status === 'pending' && <p className="mt-4 text-xs font-bold text-amber-700 dark:text-amber-200">{detail.request.approvalConfigured ? copy.approvalPending : copy.noApprover}</p>}
            </div>

            <section>
              <h4 className="text-xs font-bold uppercase text-slate-600 dark:text-emerald-100/60">{copy.conflictsHeading}</h4>
              {detail.request.conflictCount === 0 ? (
                <p className="mt-2 rounded-lg border border-emerald-500/15 p-3 text-xs text-slate-500 dark:text-emerald-100/50">{copy.noConflicts}</p>
              ) : (
                <div className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/10 p-4">
                  <p className="flex items-center gap-2 text-xs font-bold text-amber-800 dark:text-amber-100"><AlertTriangle className="h-4 w-4" />{detail.request.conflictCount === 1 ? copy.oneConflict : `${detail.request.conflictCount} ${copy.manyConflicts}`}</p>
                  <p className="mt-2 text-xs leading-5 text-amber-800/80 dark:text-amber-100/75">{copy.conflictExplanation}</p>
                  <div className="mt-3 grid gap-2">
                    {(detail.request.conflictingShifts || []).map((conflict) => (
                      <div key={conflict.shiftId} className="rounded border border-amber-500/20 bg-white/55 p-3 text-xs dark:bg-black/20">
                        <p className="font-bold text-slate-800 dark:text-emerald-50">{formatDateTime(conflict.startTime)}</p>
                        <p className="mt-1 text-slate-500 dark:text-emerald-100/55" dir="ltr">{formatDateTime(conflict.startTime)} – {formatDateTime(conflict.endTime)}</p>
                      </div>
                    ))}
                  </div>
                  {onOpenSchedule && <button type="button" onClick={() => { setDetail(null); onOpenSchedule(); }} className="mt-3 min-h-10 rounded border border-amber-600/30 px-3 py-2 text-xs font-bold text-amber-800 dark:text-amber-100">{copy.openSchedule}</button>}
                </div>
              )}
            </section>

            <section>
              <h4 className="text-xs font-bold uppercase text-slate-600 dark:text-emerald-100/60">{copy.safeTimeline}</h4>
              <ol className="mt-3 space-y-3 border-s border-emerald-500/20 ps-4">
                {detail.history.map((entry, index) => (
                  <li key={`${entry.createdAt}-${index}`} className="relative text-xs text-slate-600 dark:text-emerald-100/60">
                    <span className="absolute -start-[1.28rem] top-1 h-2 w-2 rounded-full bg-emerald-500" />
                    <p className="font-bold capitalize text-slate-800 dark:text-emerald-50">{entry.action.replaceAll('_', ' ')}</p>
                    <p className="mt-1">{formatDateTime(entry.createdAt)}</p>
                  </li>
                ))}
              </ol>
            </section>

            {detail.request.status === 'pending' && (
              <div className="flex justify-end">
                <button type="button" onClick={() => setCancelOpen(true)} className="min-h-11 rounded-lg border border-red-500/30 px-4 py-2 text-xs font-bold text-red-700 hover:bg-red-500/10 dark:text-red-200">{copy.cancelRequest}</button>
              </div>
            )}
          </div>
        )}
      </LeaveDialog>

      <LeaveDialog
        open={!decision && (approvalDetailLoading || Boolean(approvalDetail) || Boolean(approvalDetailError))}
        title={copy.approvals}
        onClose={() => {
          setApprovalDetail(null);
          setApprovalDetailError('');
        }}
      >
        {approvalDetailLoading ? (
          <div className="flex min-h-48 items-center justify-center"><LoaderCircle className="h-6 w-6 animate-spin text-emerald-500" /></div>
        ) : approvalDetailError ? (
          <div role="alert" className="mt-5 rounded-lg border border-red-500/25 bg-red-500/10 p-4 text-xs text-red-700 dark:text-red-200">
            <p>{approvalDetailError}</p>
            {approvalDetail?.request.requestId && <button type="button" onClick={() => void loadApprovalDetail(approvalDetail.request.requestId)} className="mt-3 rounded border border-current px-3 py-2 font-bold">{copy.retry}</button>}
          </div>
        ) : approvalDetail && (
          <div className="mt-5 space-y-5">
            <div className="rounded-lg border border-emerald-500/15 bg-emerald-500/5 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-base font-bold text-slate-900 dark:text-emerald-50">{approvalDetail.request.employee.displayName}</p>
                  <p className="mt-1 text-xs text-slate-600 dark:text-emerald-100/65">{labelType(approvalDetail.request.leaveType)}</p>
                  <p className="mt-1 text-xs text-slate-600 dark:text-emerald-100/65" dir="ltr">{formatDate(approvalDetail.request.startDate)} – {formatDate(approvalDetail.request.endDate)}</p>
                </div>
                <span className={cn('rounded-full border px-2 py-1 text-[10px] font-bold', statusClass(approvalDetail.request.status))}>{labelStatus(approvalDetail.request.status)}</span>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-2 text-xs text-slate-500 dark:text-emerald-100/55">
                <dt>{copy.submitted}</dt><dd className="text-end">{formatDateTime(approvalDetail.request.submittedAt)}</dd>
                <dt>{copy.authority}</dt><dd className="text-end font-bold text-emerald-700 dark:text-emerald-200">{authorityLabel(approvalDetail.request.approvalSourceLabel)}</dd>
                <dt>{copy.scope}</dt><dd className="text-end">{approvalDetail.request.scopeLabel || copy.configuredAuthority}</dd>
              </dl>
              {approvalDetail.request.reason && (
                <div className="mt-4 border-t border-emerald-500/10 pt-3">
                  <p className="text-[11px] font-bold uppercase text-slate-500 dark:text-emerald-100/50">{copy.reason}</p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700 dark:text-emerald-100/75">{approvalDetail.request.reason}</p>
                </div>
              )}
            </div>

            {approvalDetail.request.hasRosterConflict ? (
              <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-4">
                <p className="flex items-center gap-2 text-xs font-bold text-amber-800 dark:text-amber-100"><AlertTriangle className="h-4 w-4" />{copy.conflictBeforeApproval}</p>
                <p className="mt-2 text-xs leading-5 text-amber-800/80 dark:text-amber-100/75">{copy.conflictExplanation}</p>
                <div className="mt-3 grid gap-2">
                  {(approvalDetail.request.conflictingShifts || []).map((conflict) => (
                    <div key={conflict.shiftId} className="rounded border border-amber-500/20 bg-white/55 p-3 text-xs dark:bg-black/20">
                      <p className="font-bold text-slate-800 dark:text-emerald-50">{formatDateTime(conflict.startTime)}</p>
                      <p className="mt-1 text-slate-500 dark:text-emerald-100/55" dir="ltr">{formatDateTime(conflict.startTime)} – {formatDateTime(conflict.endTime)}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="rounded-lg border border-emerald-500/15 p-3 text-xs text-slate-500 dark:text-emerald-100/50">{copy.noConflicts}</p>
            )}

            <section>
              <h4 className="text-xs font-bold uppercase text-slate-600 dark:text-emerald-100/60">{copy.safeTimeline}</h4>
              <ol className="mt-3 space-y-3 border-s border-emerald-500/20 ps-4">
                {approvalDetail.history.map((entry, index) => (
                  <li key={`${entry.createdAt}-${index}`} className="relative text-xs text-slate-600 dark:text-emerald-100/60">
                    <span className="absolute -start-[1.28rem] top-1 h-2 w-2 rounded-full bg-emerald-500" />
                    <p className="font-bold capitalize text-slate-800 dark:text-emerald-50">{entry.action.replaceAll('_', ' ')}</p>
                    <p className="mt-1">{formatDateTime(entry.createdAt)}</p>
                  </li>
                ))}
              </ol>
            </section>

            {approvalDetail.request.canDecide && approvalDetail.request.status === 'pending' && (
              <div className="flex flex-col gap-2 border-t border-emerald-500/10 pt-4 sm:flex-row sm:justify-end">
                <button type="button" onClick={() => setDecision('reject')} className="min-h-11 rounded-lg border border-red-500/30 px-4 py-2 text-xs font-bold text-red-700 hover:bg-red-500/10 dark:text-red-200">{copy.reject}</button>
                <button type="button" onClick={() => setDecision('approve')} className="min-h-11 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-black">{copy.approve}</button>
              </div>
            )}
          </div>
        )}
      </LeaveDialog>

      <LeaveDialog
        open={Boolean(decision)}
        title={decision === 'approve' ? copy.approveHeading : copy.rejectHeading}
        onClose={() => {
          if (!decisionBusy) setDecision(null);
        }}
      >
        <p className="mt-4 text-sm leading-6 text-slate-600 dark:text-emerald-100/65">{decision === 'approve' ? copy.approveConsequence : copy.rejectConsequence}</p>
        {decision === 'approve' && approvalDetail?.request.hasRosterConflict && <p className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-100">{copy.conflictBeforeApproval}</p>}
        <label className="mt-4 block text-xs font-bold text-slate-700 dark:text-emerald-100/70">
          {copy.decisionNote}
          <textarea value={decisionNote} maxLength={1000} rows={4} onChange={(event) => setDecisionNote(event.target.value)} className="mt-1 w-full resize-y rounded-md border border-emerald-500/20 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-400 dark:bg-black/35 dark:text-emerald-50" />
        </label>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" disabled={decisionBusy} onClick={() => setDecision(null)} className="min-h-11 rounded-lg border border-emerald-500/20 px-4 py-2 text-xs font-bold text-slate-600 dark:text-emerald-100/70">{copy.close}</button>
          <button type="button" disabled={decisionBusy} onClick={() => void submitDecision()} className={cn('inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-xs font-bold disabled:opacity-55', decision === 'approve' ? 'bg-emerald-500 text-black' : 'bg-red-600 text-white')}>
            {decisionBusy && <LoaderCircle className="h-4 w-4 animate-spin" />}
            {decisionBusy ? copy.savingDecision : decision === 'approve' ? copy.approve : copy.reject}
          </button>
        </div>
      </LeaveDialog>

      <LeaveDialog open={cancelOpen} title={copy.cancelHeading} onClose={() => { if (!cancelling) setCancelOpen(false); }}>
        <p className="mt-4 text-sm leading-6 text-slate-600 dark:text-emerald-100/65">{copy.cancelExplanation}</p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" disabled={cancelling} onClick={() => setCancelOpen(false)} className="min-h-11 rounded-lg border border-emerald-500/20 px-4 py-2 text-xs font-bold text-slate-600 dark:text-emerald-100/70">{copy.close}</button>
          <button type="button" disabled={cancelling} onClick={() => void cancelRequest()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-55">{cancelling && <LoaderCircle className="h-4 w-4 animate-spin" />}{cancelling ? copy.cancelling : copy.confirmCancel}</button>
        </div>
      </LeaveDialog>
    </section>
  );
}
