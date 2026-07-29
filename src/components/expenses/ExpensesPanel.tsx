import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FileImage,
  FileText,
  History,
  LoaderCircle,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  WalletCards,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { AuthUser } from '../../App';
import { apiFetch, apiUrl } from '../../lib/api';
import { useLanguage } from '../../lib/LanguageContext';
import { cn } from '../../lib/utils';
import {
  EXPENSE_AMOUNT_PATTERN,
  EXPENSE_CATEGORIES,
  EXPENSE_CURRENCIES,
  EXPENSE_STATUSES,
  RECEIPT_MAX_BYTES,
  isReceiptFile,
  type ExpenseCategory,
  type ExpenseStatus,
} from './expense-ui-contract';

export type ExpenseWorkspaceView = 'claims' | 'new' | 'history' | 'approvals' | 'reimbursements';

export type ExpenseDeepLink = {
  view: Exclude<ExpenseWorkspaceView, 'new' | 'history'>;
  claimId: string | null;
};

type Claim = {
  claimId: string;
  extractionId?: string | null;
  extractionAssociated: boolean;
  merchantName: string;
  expenseDate: string;
  amount: string;
  currency: string;
  category: ExpenseCategory;
  businessReason: string;
  status: ExpenseStatus;
  submittedAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  cancelledAt: string | null;
  reimbursedAt: string | null;
  decisionNote: string | null;
  reimbursementExternalReference?: string | null;
  reimbursementNote?: string | null;
  approvalConfigured: boolean;
  version: number;
  employee?: {
    employeeId: string;
    displayName: string;
    departmentName: string | null;
    teamName: string | null;
  };
  canApprove?: boolean;
  canReimburse?: boolean;
  approvalSource?: string | null;
  approvalScopeType?: string | null;
};

type ClaimHistory = {
  action: string;
  previousStatus: string | null;
  newStatus: string;
  createdAt: string;
};

type ClaimListResponse = {
  success: boolean;
  claims: Claim[];
  total: number;
  page: number;
  pageSize: number;
  code?: string;
  message?: string;
};

type ClaimDetailResponse = {
  success: boolean;
  claim: Claim;
  history: ClaimHistory[];
  code?: string;
  message?: string;
};

type ExtractedField = {
  value: string | null;
  confidence: number | null;
  confidenceLevel: 'high' | 'medium' | 'low' | 'unavailable';
  warning: string | null;
};

type ReceiptFields = {
  merchantName: ExtractedField;
  transactionDate: ExtractedField;
  totalAmount: ExtractedField;
  currency: ExtractedField;
};

type ExtractionResponse = {
  success: boolean;
  extractionId: string;
  status: string;
  fields: ReceiptFields | null;
  warnings: Array<{ code: string; field: string | null; message: string }>;
  expiresAt: string;
  code?: string;
  message?: string;
};

type ClaimForm = {
  merchantName: string;
  expenseDate: string;
  amount: string;
  currency: string;
  category: ExpenseCategory | '';
  businessReason: string;
};

type ActionDialog =
  | { kind: 'cancel'; claim: Claim }
  | { kind: 'approve' | 'reject' | 'reimburse'; claim: Claim }
  | null;

const initialForm: ClaimForm = {
  merchantName: '',
  expenseDate: '',
  amount: '',
  currency: 'EGP',
  category: '',
  businessReason: '',
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readError(payload: unknown, fallback: string) {
  if (payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string') {
    return payload.message;
  }
  return fallback;
}

function errorCode(payload: unknown) {
  return payload && typeof payload === 'object' && 'code' in payload && typeof payload.code === 'string'
    ? payload.code
    : '';
}

function requestKey() {
  return typeof crypto.randomUUID === 'function'
    ? `expense:${crypto.randomUUID()}`
    : `expense:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function Dialog({
  title,
  description,
  onClose,
  children,
  labelledBy,
  closeLabel,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  labelledBy: string;
  closeLabel: string;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const first = dialog?.querySelector<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    first?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ));
      if (!focusable.length) return;
      const firstItem = focusable[0];
      const lastItem = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      returnFocusRef.current?.focus();
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/65 p-0 sm:items-center sm:p-4" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="max-h-[calc(100dvh-1rem)] w-full overflow-y-auto rounded-t-2xl border border-emerald-500/20 bg-white p-4 text-slate-900 shadow-2xl dark:bg-[#07110d] dark:text-emerald-50 sm:max-w-3xl sm:rounded-2xl sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id={labelledBy} className="text-lg font-bold">{title}</h2>
            {description && <p className="mt-1 text-sm text-slate-500 dark:text-emerald-100/60">{description}</p>}
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:hover:bg-white/10" aria-label={closeLabel}>
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function StatusBadge({ status, label }: { status: ExpenseStatus; label: string }) {
  const tone = status === 'approved' || status === 'reimbursed'
    ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    : status === 'rejected'
      ? 'border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300'
      : status === 'cancelled'
        ? 'border-slate-500/25 bg-slate-500/10 text-slate-600 dark:text-slate-300'
        : 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300';
  return <span className={cn('inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold', tone)}>{label}</span>;
}

function SummaryCard({ label, value, icon }: { label: string; value: number; icon: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-emerald-500/15 bg-white/75 p-4 shadow-sm dark:bg-white/[0.035]">
      <div className="flex items-center justify-between gap-3 text-emerald-600 dark:text-emerald-300">
        <span className="text-xs font-bold uppercase tracking-wider">{label}</span>
        {icon}
      </div>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}

export function ExpensesPanel({
  user,
  deepLink,
  onDeepLinkHandled,
}: {
  user: AuthUser;
  deepLink?: ExpenseDeepLink | null;
  onDeepLinkHandled?: () => void;
}) {
  const { t, lang, isRtl } = useLanguage();
  const [activeView, setActiveView] = useState<ExpenseWorkspaceView>('claims');
  const [claims, setClaims] = useState<Claim[]>([]);
  const [claimsTotal, setClaimsTotal] = useState(0);
  const [claimsPage, setClaimsPage] = useState(1);
  const [claimsLoading, setClaimsLoading] = useState(true);
  const [claimsError, setClaimsError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [financeClaims, setFinanceClaims] = useState<Claim[]>([]);
  const [financeTotal, setFinanceTotal] = useState(0);
  const [financePage, setFinancePage] = useState(1);
  const [financeLoading, setFinanceLoading] = useState(false);
  const [financeError, setFinanceError] = useState('');
  const [financeAccess, setFinanceAccess] = useState(false);
  const [financeSearch, setFinanceSearch] = useState('');
  const [detail, setDetail] = useState<{ claim: Claim; history: ClaimHistory[]; finance: boolean } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [actionDialog, setActionDialog] = useState<ActionDialog>(null);
  const [actionNote, setActionNote] = useState('');
  const [externalReference, setExternalReference] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [claimFlowOpen, setClaimFlowOpen] = useState(false);
  const [claimStep, setClaimStep] = useState<1 | 2 | 3 | 4>(1);
  const [form, setForm] = useState<ClaimForm>(initialForm);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState(false);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [extractionId, setExtractionId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<ReceiptFields | null>(null);
  const [extractionWarnings, setExtractionWarnings] = useState<string[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [extractionError, setExtractionError] = useState('');
  const [dropActive, setDropActive] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(requestKey);
  const dirtyFieldsRef = useRef(new Set<keyof ClaimForm>());
  const extractionRef = useRef<string | null>(null);
  const submittedRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pageSize = 10;
  const explicitReimburse = Boolean(user.permissions?.some((permission) => permission === 'expenses.reimburse' || permission === 'expenses.manage'));
  const explicitFinance = Boolean(user.permissions?.some((permission) => (
    permission === 'expenses.view.scoped'
    || permission === 'expenses.approve'
    || permission === 'expenses.reimburse'
    || permission === 'expenses.manage'
  )));

  const statusLabel = useCallback((status: ExpenseStatus) => t(`expenses.status.${status}` as Parameters<typeof t>[0]), [t]);
  const categoryLabel = useCallback((category: ExpenseCategory) => t(`expenses.category.${category}` as Parameters<typeof t>[0]), [t]);
  const authorityLabel = useCallback((claim: Claim) => {
    if (!claim.approvalSource) return t('expenses.authority.scoped');
    return t(`expenses.authority.${claim.approvalSource}` as Parameters<typeof t>[0]);
  }, [t]);
  const formatDate = useCallback((value: string | null) => {
    if (!value) return t('expenses.notAvailable');
    const parsed = new Date(value.length === 10 ? `${value}T00:00:00` : value);
    return Number.isNaN(parsed.valueOf()) ? t('expenses.notAvailable') : new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-GB', { dateStyle: 'medium' }).format(parsed);
  }, [lang, t]);
  const displayAmount = useCallback((claim: Claim) => `${claim.amount} ${claim.currency}`, []);

  const ownQuery = useMemo(() => {
    const query = new URLSearchParams({ page: String(claimsPage), pageSize: String(pageSize) });
    if (statusFilter) query.set('status', statusFilter);
    if (categoryFilter) query.set('category', categoryFilter);
    if (fromDate) query.set('fromDate', fromDate);
    if (toDate) query.set('toDate', toDate);
    return query;
  }, [categoryFilter, claimsPage, fromDate, statusFilter, toDate]);

  const loadOwnClaims = useCallback(async () => {
    setClaimsLoading(true);
    setClaimsError('');
    try {
      const response = await apiFetch(apiUrl(`/api/me/expense-claims?${ownQuery}`));
      const payload = await response.json() as ClaimListResponse;
      if (!response.ok || !payload.success) throw new Error(readError(payload, t('expenses.loadError')));
      setClaims(payload.claims || []);
      setClaimsTotal(payload.total || 0);
    } catch (error) {
      setClaimsError(error instanceof Error ? error.message : t('expenses.loadError'));
    } finally {
      setClaimsLoading(false);
    }
  }, [ownQuery, t]);

  const loadFinanceClaims = useCallback(async (view: 'approvals' | 'reimbursements', page = financePage, probe = false) => {
    if (!probe) {
      setFinanceLoading(true);
      setFinanceError('');
    }
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (view === 'approvals') {
      query.set('actionableOnly', 'true');
    } else {
      query.set('status', 'approved');
    }
    if (financeSearch) query.set('search', financeSearch);
    try {
      const response = await apiFetch(apiUrl(`/api/finance/expense-claims?${query}`));
      const payload = await response.json() as ClaimListResponse;
      if (response.status === 403) {
        if (probe) setFinanceAccess(false);
        return false;
      }
      if (!response.ok || !payload.success) throw new Error(readError(payload, t('expenses.financeLoadError')));
      setFinanceAccess(true);
      if (!probe || payload.claims.length > 0) {
        setFinanceClaims(payload.claims || []);
        setFinanceTotal(payload.total || 0);
      }
      return true;
    } catch (error) {
      if (!probe) setFinanceError(error instanceof Error ? error.message : t('expenses.financeLoadError'));
      return false;
    } finally {
      if (!probe) setFinanceLoading(false);
    }
  }, [financePage, financeSearch, t]);

  useEffect(() => {
    void loadOwnClaims();
  }, [loadOwnClaims]);

  useEffect(() => {
    void loadFinanceClaims('approvals', 1, true);
  }, [loadFinanceClaims]);

  useEffect(() => {
    if (activeView === 'approvals' || activeView === 'reimbursements') {
      void loadFinanceClaims(activeView);
    }
  }, [activeView, financePage, loadFinanceClaims]);

  const loadDetail = useCallback(async (claimId: string, finance: boolean) => {
    if (!UUID_PATTERN.test(claimId)) {
      setDetailError(t('expenses.deepLinkInvalid'));
      return;
    }
    setDetailLoading(true);
    setDetailError('');
    try {
      const path = finance ? `/api/finance/expense-claims/${claimId}` : `/api/me/expense-claims/${claimId}`;
      const response = await apiFetch(apiUrl(path));
      const payload = await response.json() as ClaimDetailResponse;
      if (!response.ok || !payload.success) throw new Error(readError(payload, t('expenses.detailUnavailable')));
      setDetail({ claim: payload.claim, history: payload.history || [], finance });
    } catch (error) {
      setDetail(null);
      setDetailError(error instanceof Error ? error.message : t('expenses.detailUnavailable'));
    } finally {
      setDetailLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!deepLink) return;
    const view = deepLink.view === 'reimbursements' && !explicitReimburse
      ? financeAccess ? 'approvals' : 'claims'
      : deepLink.view === 'approvals' && !financeAccess
        ? 'claims'
        : deepLink.view;
    setActiveView(view);
    if (deepLink.claimId) void loadDetail(deepLink.claimId, view !== 'claims');
    else if (!deepLink.claimId) setDetailError(t('expenses.deepLinkInvalid'));
    onDeepLinkHandled?.();
  }, [deepLink, explicitReimburse, financeAccess, loadDetail, onDeepLinkHandled, t]);

  useEffect(() => () => {
    const current = extractionRef.current;
    if (current && !submittedRef.current) {
      void apiFetch(apiUrl(`/api/document-extractions/${current}`), { method: 'DELETE' }).catch(() => undefined);
    }
  }, []);

  const resetFlow = useCallback(async (deleteExtraction = true) => {
    const current = extractionRef.current;
    if (deleteExtraction && current && !submittedRef.current) {
      try {
        await apiFetch(apiUrl(`/api/document-extractions/${current}`), { method: 'DELETE' });
      } catch {
        // Temporary cleanup must never block closing the form.
      }
    }
    extractionRef.current = null;
    submittedRef.current = false;
    dirtyFieldsRef.current.clear();
    setClaimFlowOpen(false);
    setActiveView('claims');
    setClaimStep(1);
    setForm(initialForm);
    setFormError('');
    setReceiptFile(null);
    setExtractionId(null);
    setSuggestions(null);
    setExtractionWarnings([]);
    setExtractionError('');
    setDuplicateWarning(false);
    setIdempotencyKey(requestKey());
  }, []);

  const openFlow = () => {
    submittedRef.current = false;
    setClaimFlowOpen(true);
    setActiveView('new');
  };

  const updateField = <K extends keyof ClaimForm>(field: K, value: ClaimForm[K], manual = true) => {
    if (manual) dirtyFieldsRef.current.add(field);
    setForm((current) => ({ ...current, [field]: value }));
  };

  const setReceipt = (file: File | null) => {
    setExtractionError('');
    if (!file) {
      setReceiptFile(null);
      return;
    }
    if (!isReceiptFile(file)) {
      setReceiptFile(null);
      setExtractionError(file.size > RECEIPT_MAX_BYTES ? t('expenses.fileTooLarge') : t('expenses.unsupportedFile'));
      return;
    }
    setReceiptFile(file);
  };

  const extractReceipt = async () => {
    if (!receiptFile || extracting) return;
    setExtracting(true);
    setExtractionError('');
    const prior = extractionRef.current;
    try {
      const body = new FormData();
      body.append('mode', 'expense_receipt');
      body.append('file', receiptFile);
      const response = await apiFetch(apiUrl('/api/document-extractions'), { method: 'POST', body });
      const payload = await response.json() as ExtractionResponse;
      if (!response.ok || !payload.success) {
        const code = errorCode(payload);
        const mapped = response.status === 429 || code.includes('RATE') ? t('expenses.extractionRateLimit')
          : code.includes('TYPE') ? t('expenses.unsupportedFile')
            : code.includes('SIZE') ? t('expenses.fileTooLarge')
              : code.includes('TIMEOUT') ? t('expenses.extractionTimeout')
                : code.includes('EXPIRED') ? t('expenses.extractionExpired')
                : t('expenses.extractionUnavailable');
        throw new Error(mapped);
      }
      if (prior && prior !== payload.extractionId) {
        void apiFetch(apiUrl(`/api/document-extractions/${prior}`), { method: 'DELETE' }).catch(() => undefined);
      }
      extractionRef.current = payload.extractionId;
      setExtractionId(payload.extractionId);
      setSuggestions(payload.fields);
      setExtractionWarnings((payload.warnings || []).map((warning) => warning.message));
      const values: Array<[keyof ClaimForm, string | null | undefined]> = [
        ['merchantName', payload.fields?.merchantName.value],
        ['expenseDate', payload.fields?.transactionDate.value],
        ['amount', payload.fields?.totalAmount.value],
        ['currency', payload.fields?.currency.value?.toUpperCase()],
      ];
      setForm((current) => {
        const next = { ...current };
        for (const [field, value] of values) {
          if (!value || dirtyFieldsRef.current.has(field)) continue;
          if (field === 'currency' && !(EXPENSE_CURRENCIES as readonly string[]).includes(value)) continue;
          next[field] = value as never;
        }
        return next;
      });
      setClaimStep(2);
    } catch (error) {
      setExtractionError(error instanceof Error ? error.message : t('expenses.extractionUnavailable'));
    } finally {
      setExtracting(false);
    }
  };

  const removeReceipt = async () => {
    const current = extractionRef.current;
    extractionRef.current = null;
    setReceiptFile(null);
    setExtractionId(null);
    setSuggestions(null);
    setExtractionWarnings([]);
    setExtractionError('');
    if (current) {
      try {
        await apiFetch(apiUrl(`/api/document-extractions/${current}`), { method: 'DELETE' });
      } catch {
        // The local reference is removed even when best-effort cleanup is unavailable.
      }
    }
  };

  const applySuggestion = (field: keyof ClaimForm, value: string | null) => {
    if (!value) return;
    if (field === 'currency' && !(EXPENSE_CURRENCIES as readonly string[]).includes(value.toUpperCase())) {
      setExtractionError(t('expenses.unknownCurrency'));
      return;
    }
    updateField(field, (field === 'currency' ? value.toUpperCase() : value) as never);
  };

  const validateForm = () => {
    if (!form.merchantName.trim() || form.merchantName.length > 200) return t('expenses.merchantRequired');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.expenseDate)) return t('expenses.dateRequired');
    if (!EXPENSE_AMOUNT_PATTERN.test(form.amount) || form.amount === '0' || form.amount === '0.00') return t('expenses.invalidAmount');
    if (!(EXPENSE_CURRENCIES as readonly string[]).includes(form.currency)) return t('expenses.invalidCurrency');
    if (!(EXPENSE_CATEGORIES as readonly string[]).includes(form.category)) return t('expenses.categoryRequired');
    if (!form.businessReason.trim() || form.businessReason.length > 2000) return t('expenses.reasonRequired');
    return '';
  };

  const moveToReview = () => {
    const error = validateForm();
    setFormError(error);
    if (!error) setClaimStep(3);
  };

  const submitClaim = async () => {
    const validation = validateForm();
    if (validation || submitting) {
      setFormError(validation);
      return;
    }
    setSubmitting(true);
    setFormError('');
    try {
      const response = await apiFetch(apiUrl('/api/me/expense-claims'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          extractionId,
          merchantName: form.merchantName,
          expenseDate: form.expenseDate,
          amount: form.amount,
          currency: form.currency,
          category: form.category,
          businessReason: form.businessReason,
        }),
      });
      const payload = await response.json() as { success: boolean; claim?: Claim; duplicateWarning?: boolean; message?: string };
      if (!response.ok || !payload.success) {
        if (errorCode(payload) === 'EXPENSE_EXTRACTION_NOT_FOUND') {
          extractionRef.current = null;
          setExtractionId(null);
          setSuggestions(null);
          throw new Error(t('expenses.extractionExpired'));
        }
        throw new Error(readError(payload, t('expenses.submitError')));
      }
      submittedRef.current = true;
      setDuplicateWarning(Boolean(payload.duplicateWarning));
      setClaimStep(4);
      setSuccessMessage(t('expenses.submitted'));
      await loadOwnClaims();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t('expenses.submitError'));
    } finally {
      setSubmitting(false);
    }
  };

  const executeAction = async () => {
    if (!actionDialog || actionLoading) return;
    setActionLoading(true);
    setActionError('');
    try {
      const { kind, claim } = actionDialog;
      const path = kind === 'cancel'
        ? `/api/me/expense-claims/${claim.claimId}/cancel`
        : `/api/finance/expense-claims/${claim.claimId}/${kind}`;
      const body = kind === 'cancel'
        ? { expectedVersion: claim.version }
        : kind === 'reimburse'
          ? { expectedVersion: claim.version, externalReference: externalReference || null, note: actionNote || null }
          : { expectedVersion: claim.version, note: actionNote || null };
      const response = await apiFetch(apiUrl(path), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        const code = errorCode(payload);
        throw new Error(code === 'EXPENSE_STATE_CONFLICT' ? t('expenses.staleVersion') : readError(payload, t('expenses.actionError')));
      }
      setSuccessMessage(kind === 'approve' ? t('expenses.approvedSuccess')
        : kind === 'reject' ? t('expenses.rejectedSuccess')
          : kind === 'reimburse' ? t('expenses.reimbursedSuccess')
            : t('expenses.cancelledSuccess'));
      setActionDialog(null);
      setActionNote('');
      setExternalReference('');
      setDetail(null);
      await Promise.all([
        loadOwnClaims(),
        financeAccess ? loadFinanceClaims(activeView === 'reimbursements' ? 'reimbursements' : 'approvals') : Promise.resolve(false),
      ]);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t('expenses.actionError'));
    } finally {
      setActionLoading(false);
    }
  };

  const tabs = useMemo(() => {
    const items: Array<{ id: ExpenseWorkspaceView; label: string; icon: ReactNode }> = [
      { id: 'claims', label: t('expenses.myClaims'), icon: <ReceiptText className="h-4 w-4" /> },
      { id: 'new', label: t('expenses.newClaim'), icon: <Plus className="h-4 w-4" /> },
      { id: 'history', label: t('expenses.history'), icon: <History className="h-4 w-4" /> },
    ];
    if (financeAccess || explicitFinance) items.push({ id: 'approvals', label: t('expenses.approvals'), icon: <ShieldCheck className="h-4 w-4" /> });
    if (explicitReimburse) items.push({ id: 'reimbursements', label: t('expenses.reimbursements'), icon: <WalletCards className="h-4 w-4" /> });
    return items;
  }, [explicitFinance, explicitReimburse, financeAccess, t]);

  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = tabs.findIndex((tab) => tab.id === activeView);
    const direction = isRtl ? -1 : 1;
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? tabs.length - 1
        : event.key === 'ArrowRight'
          ? (current + direction + tabs.length) % tabs.length
          : (current - direction + tabs.length) % tabs.length;
    setActiveView(tabs[next].id);
    document.getElementById(`expense-tab-${tabs[next].id}`)?.focus();
  };

  const ownSummary = {
    pending: claims.filter((claim) => claim.status === 'pending').length,
    approved: claims.filter((claim) => claim.status === 'approved').length,
    reimbursed: claims.filter((claim) => claim.status === 'reimbursed').length,
    attention: claims.filter((claim) => claim.status === 'rejected' || !claim.approvalConfigured).length,
  };

  const visibleOwnClaims = activeView === 'history'
    ? claims.filter((claim) => claim.status !== 'pending')
    : claims;

  const claimCard = (claim: Claim, finance = false) => (
    <article key={claim.claimId} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-emerald-500/15 dark:bg-white/[0.035]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {finance && claim.employee && <p className="mb-1 text-xs font-bold text-emerald-700 dark:text-emerald-300">{claim.employee.displayName}</p>}
          <h3 className="truncate font-bold">{claim.merchantName}</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-emerald-100/60">{formatDate(claim.expenseDate)} · {categoryLabel(claim.category)}</p>
          {finance && claim.employee && (
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
              <span className="rounded-full border border-emerald-500/20 bg-emerald-500/5 px-2 py-1 text-emerald-700 dark:text-emerald-300">{authorityLabel(claim)}</span>
              {claim.approvalScopeType && <span className="rounded-full border border-slate-300 px-2 py-1 text-slate-500 dark:border-emerald-500/15 dark:text-emerald-100/55">{t(`expenses.scope.${claim.approvalScopeType}` as Parameters<typeof t>[0])}</span>}
              {(claim.employee.departmentName || claim.employee.teamName) && <span className="rounded-full border border-slate-300 px-2 py-1 text-slate-500 dark:border-emerald-500/15 dark:text-emerald-100/55">{claim.employee.teamName || claim.employee.departmentName}</span>}
            </div>
          )}
        </div>
        <div className="text-end">
          <p className="font-mono text-lg font-black">{displayAmount(claim)}</p>
          <StatusBadge status={claim.status} label={statusLabel(claim.status)} />
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 dark:border-emerald-500/10">
        <div className="flex flex-wrap gap-2 text-xs text-slate-500 dark:text-emerald-100/55">
          <span>{t('expenses.submittedAt')}: {formatDate(claim.submittedAt)}</span>
          {claim.extractionAssociated && <span className="inline-flex items-center gap-1"><FileImage className="h-3.5 w-3.5" />{t('expenses.extractionUsed')}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void loadDetail(claim.claimId, finance)} className="rounded-lg border border-emerald-500/20 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-500/10 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:text-emerald-300">{t('expenses.viewDetails')}</button>
          {!finance && claim.status === 'pending' && (
            <button type="button" onClick={() => setActionDialog({ kind: 'cancel', claim })} className="rounded-lg border border-red-500/20 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-500/10 focus:outline-none focus:ring-2 focus:ring-red-500 dark:text-red-300">{t('expenses.cancelClaim')}</button>
          )}
          {finance && claim.canApprove && (
            <>
              <button type="button" onClick={() => setActionDialog({ kind: 'approve', claim })} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500">{t('expenses.approve')}</button>
              <button type="button" onClick={() => setActionDialog({ kind: 'reject', claim })} className="rounded-lg border border-red-500/25 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-500/10 focus:outline-none focus:ring-2 focus:ring-red-500 dark:text-red-300">{t('expenses.reject')}</button>
            </>
          )}
          {finance && claim.canReimburse && explicitReimburse && (
            <button type="button" onClick={() => setActionDialog({ kind: 'reimburse', claim })} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500">{t('expenses.markReimbursed')}</button>
          )}
        </div>
      </div>
    </article>
  );

  const renderPagination = (page: number, total: number, setPage: (value: number) => void) => {
    const pages = Math.max(1, Math.ceil(total / pageSize));
    return (
      <div className="mt-4 flex items-center justify-between gap-3">
        <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-lg border border-emerald-500/20 px-3 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40">{isRtl ? <ArrowRight className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />}</button>
        <span className="text-xs text-slate-500 dark:text-emerald-100/60">{t('expenses.page')} {page} / {pages}</span>
        <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} className="rounded-lg border border-emerald-500/20 px-3 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40">{isRtl ? <ArrowLeft className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}</button>
      </div>
    );
  };

  const suggestionCard = (label: string, field: ExtractedField, target: keyof ClaimForm) => (
    <div className="rounded-lg border border-emerald-500/15 bg-emerald-500/[0.04] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-bold text-slate-500 dark:text-emerald-100/55">{label}</p>
          <p className="mt-1 truncate text-sm font-semibold">{field.value || t('expenses.notDetected')}</p>
        </div>
        <span className={cn(
          'rounded-full border px-2 py-1 text-[10px] font-bold',
          field.confidenceLevel === 'high' ? 'border-emerald-500/25 text-emerald-700 dark:text-emerald-300'
            : field.confidenceLevel === 'medium' ? 'border-amber-500/25 text-amber-700 dark:text-amber-300'
              : 'border-red-500/25 text-red-700 dark:text-red-300',
        )}>{t(`expenses.confidence.${field.confidenceLevel}` as Parameters<typeof t>[0])}</span>
      </div>
      {field.warning && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{field.warning}</p>}
      {field.value && <button type="button" onClick={() => applySuggestion(target, field.value)} className="mt-2 text-xs font-bold text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-300">{t('expenses.applySuggestion')}</button>}
    </div>
  );

  return (
    <section dir={isRtl ? 'rtl' : 'ltr'} className="min-w-0 space-y-5 overflow-x-hidden">
      <header className="flex flex-col gap-4 rounded-2xl border border-emerald-500/15 bg-white/80 p-5 shadow-sm dark:bg-white/[0.035] sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-300">
            <ReceiptText className="h-5 w-5" />
            <span className="text-xs font-black uppercase tracking-[0.18em]">{t('expenses.financeWorkspace')}</span>
          </div>
          <h1 className="mt-2 text-2xl font-black">{t('expenses.title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-emerald-100/60">{t('expenses.subtitle')}</p>
        </div>
        <button type="button" onClick={openFlow} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-900/10 hover:bg-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500">
          <Plus className="h-4 w-4" />
          {t('expenses.newClaim')}
        </button>
      </header>

      {successMessage && (
        <div role="status" className="flex items-center justify-between gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm font-semibold text-emerald-800 dark:text-emerald-200">
          <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />{successMessage}</span>
          <button type="button" onClick={() => setSuccessMessage('')} aria-label={t('expenses.dismiss')}><X className="h-4 w-4" /></button>
        </div>
      )}
      {detailError && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
          <span>{detailError}</span>
          <button type="button" onClick={() => setDetailError('')} aria-label={t('expenses.dismiss')}><X className="h-4 w-4" /></button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label={t('expenses.summary.pending')} value={ownSummary.pending} icon={<Clock3 className="h-4 w-4" />} />
        <SummaryCard label={t('expenses.summary.approved')} value={ownSummary.approved} icon={<Check className="h-4 w-4" />} />
        <SummaryCard label={t('expenses.summary.reimbursed')} value={ownSummary.reimbursed} icon={<WalletCards className="h-4 w-4" />} />
        <SummaryCard label={t('expenses.summary.attention')} value={ownSummary.attention} icon={<AlertTriangle className="h-4 w-4" />} />
      </div>

      <div className="rounded-2xl border border-emerald-500/15 bg-white/80 p-3 shadow-sm dark:bg-white/[0.035] sm:p-5">
        <div role="tablist" aria-label={t('expenses.views')} onKeyDown={onTabKeyDown} className="flex max-w-full gap-1 overflow-x-auto border-b border-slate-200 pb-2 dark:border-emerald-500/10">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              id={`expense-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={activeView === tab.id}
              tabIndex={activeView === tab.id ? 0 : -1}
              onClick={() => tab.id === 'new' ? openFlow() : setActiveView(tab.id)}
              className={cn(
                'inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500',
                activeView === tab.id ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5',
              )}
            >
              {tab.icon}{tab.label}
            </button>
          ))}
        </div>

        {(activeView === 'claims' || activeView === 'history') && (
          <div role="tabpanel" aria-labelledby={`expense-tab-${activeView}`} className="pt-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-xs font-bold text-slate-600 dark:text-emerald-100/70">
                {t('expenses.status')}
                <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setClaimsPage(1); }} className="stanza-select mt-1 w-full">
                  <option value="">{t('expenses.allStatuses')}</option>
                  {EXPENSE_STATUSES.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
                </select>
              </label>
              <label className="text-xs font-bold text-slate-600 dark:text-emerald-100/70">
                {t('expenses.category')}
                <select value={categoryFilter} onChange={(event) => { setCategoryFilter(event.target.value); setClaimsPage(1); }} className="stanza-select mt-1 w-full">
                  <option value="">{t('expenses.allCategories')}</option>
                  {EXPENSE_CATEGORIES.map((category) => <option key={category} value={category}>{categoryLabel(category)}</option>)}
                </select>
              </label>
              <label className="text-xs font-bold text-slate-600 dark:text-emerald-100/70">
                {t('expenses.fromDate')}
                <input type="date" value={fromDate} onChange={(event) => { setFromDate(event.target.value); setClaimsPage(1); }} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-emerald-500/20 dark:bg-black/20" />
              </label>
              <label className="text-xs font-bold text-slate-600 dark:text-emerald-100/70">
                {t('expenses.toDate')}
                <input type="date" value={toDate} onChange={(event) => { setToDate(event.target.value); setClaimsPage(1); }} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-emerald-500/20 dark:bg-black/20" />
              </label>
            </div>
            {claimsLoading ? (
              <div className="flex min-h-48 items-center justify-center"><LoaderCircle className="h-6 w-6 animate-spin text-emerald-500" /><span className="sr-only">{t('expenses.loading')}</span></div>
            ) : claimsError ? (
              <div className="mt-5 rounded-xl border border-red-500/20 bg-red-500/10 p-5 text-center">
                <p className="text-sm text-red-700 dark:text-red-300">{claimsError}</p>
                <button type="button" onClick={() => void loadOwnClaims()} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-red-500/25 px-3 py-2 text-xs font-bold"><RefreshCw className="h-4 w-4" />{t('expenses.retry')}</button>
              </div>
            ) : visibleOwnClaims.length === 0 ? (
              <div className="mt-5 rounded-xl border border-dashed border-emerald-500/20 p-8 text-center">
                <ReceiptText className="mx-auto h-9 w-9 text-emerald-500/50" />
                <h2 className="mt-3 font-bold">{activeView === 'history' ? t('expenses.noHistory') : t('expenses.noClaims')}</h2>
                <p className="mx-auto mt-1 max-w-md text-sm text-slate-500 dark:text-emerald-100/55">{t('expenses.noClaimsHelp')}</p>
              </div>
            ) : (
              <div className="mt-5 grid gap-3 xl:grid-cols-2">{visibleOwnClaims.map((claim) => claimCard(claim))}</div>
            )}
            {renderPagination(claimsPage, claimsTotal, setClaimsPage)}
          </div>
        )}

        {(activeView === 'approvals' || activeView === 'reimbursements') && (
          <div role="tabpanel" aria-labelledby={`expense-tab-${activeView}`} className="pt-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-lg font-bold">{activeView === 'approvals' ? t('expenses.approvals') : t('expenses.reimbursements')}</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-emerald-100/60">{activeView === 'approvals' ? t('expenses.approvalsHelp') : t('expenses.reimbursementsHelp')}</p>
              </div>
              <label className="relative block w-full sm:max-w-xs">
                <span className="sr-only">{t('expenses.search')}</span>
                <Search className="pointer-events-none absolute start-3 top-3 h-4 w-4 text-slate-400" />
                <input value={financeSearch} onChange={(event) => { setFinanceSearch(event.target.value); setFinancePage(1); }} placeholder={t('expenses.search')} className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pe-3 ps-9 text-sm dark:border-emerald-500/20 dark:bg-black/20" />
              </label>
            </div>
            {financeLoading ? (
              <div className="flex min-h-48 items-center justify-center"><LoaderCircle className="h-6 w-6 animate-spin text-emerald-500" /></div>
            ) : financeError ? (
              <div className="mt-5 rounded-xl border border-red-500/20 bg-red-500/10 p-5 text-center">
                <p className="text-sm text-red-700 dark:text-red-300">{financeError}</p>
                <button type="button" onClick={() => void loadFinanceClaims(activeView)} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-red-500/25 px-3 py-2 text-xs font-bold"><RefreshCw className="h-4 w-4" />{t('expenses.retry')}</button>
              </div>
            ) : financeClaims.length === 0 ? (
              <div className="mt-5 rounded-xl border border-dashed border-emerald-500/20 p-8 text-center">
                <CheckCircle2 className="mx-auto h-9 w-9 text-emerald-500/50" />
                <h2 className="mt-3 font-bold">{activeView === 'approvals' ? t('expenses.noApprovals') : t('expenses.noReimbursements')}</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-emerald-100/55">{t('expenses.queueClear')}</p>
              </div>
            ) : (
              <div className="mt-5 grid gap-3 xl:grid-cols-2">{financeClaims.map((claim) => claimCard(claim, true))}</div>
            )}
            {renderPagination(financePage, financeTotal, setFinancePage)}
          </div>
        )}
      </div>

      {detailLoading && (
        <div className="fixed inset-0 z-[119] flex items-center justify-center bg-black/40" role="status">
          <LoaderCircle className="h-8 w-8 animate-spin text-emerald-400" />
          <span className="sr-only">{t('expenses.loading')}</span>
        </div>
      )}

      {detail && (
        <Dialog title={detail.finance && detail.claim.employee ? detail.claim.employee.displayName : detail.claim.merchantName} description={`${displayAmount(detail.claim)} · ${statusLabel(detail.claim.status)}`} onClose={() => setDetail(null)} labelledBy="expense-detail-title" closeLabel={t('expenses.close')}>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {[
              [t('expenses.merchant'), detail.claim.merchantName],
              [t('expenses.expenseDate'), formatDate(detail.claim.expenseDate)],
              [t('expenses.amount'), displayAmount(detail.claim)],
              [t('expenses.category'), categoryLabel(detail.claim.category)],
              [t('expenses.submittedAt'), formatDate(detail.claim.submittedAt)],
              [t('expenses.status'), statusLabel(detail.claim.status)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-slate-200 p-3 dark:border-emerald-500/15">
                <p className="text-xs font-bold text-slate-500 dark:text-emerald-100/55">{label}</p>
                <p className="mt-1 text-sm font-semibold">{value}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-lg border border-slate-200 p-3 dark:border-emerald-500/15">
            <p className="text-xs font-bold text-slate-500 dark:text-emerald-100/55">{t('expenses.businessReason')}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm">{detail.claim.businessReason}</p>
          </div>
          <div className="mt-5">
            <h3 className="text-sm font-bold">{t('expenses.timeline')}</h3>
            <ol className="mt-3 space-y-3 border-s border-emerald-500/20 ps-4">
              {detail.history.map((item, index) => (
                <li key={`${item.action}-${item.createdAt}-${index}`} className="relative">
                  <span className="absolute -start-[1.22rem] top-1 h-2 w-2 rounded-full bg-emerald-500" />
                  <p className="text-sm font-semibold">{t(`expenses.history.${item.action}` as Parameters<typeof t>[0])}</p>
                  <p className="text-xs text-slate-500 dark:text-emerald-100/55">{formatDate(item.createdAt)}</p>
                </li>
              ))}
            </ol>
          </div>
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            {!detail.finance && detail.claim.status === 'pending' && <button type="button" onClick={() => { setActionDialog({ kind: 'cancel', claim: detail.claim }); setDetail(null); }} className="rounded-lg border border-red-500/25 px-4 py-2 text-sm font-bold text-red-700 dark:text-red-300">{t('expenses.cancelClaim')}</button>}
            {detail.finance && detail.claim.canApprove && <>
              <button type="button" onClick={() => { setActionDialog({ kind: 'reject', claim: detail.claim }); setDetail(null); }} className="rounded-lg border border-red-500/25 px-4 py-2 text-sm font-bold text-red-700 dark:text-red-300">{t('expenses.reject')}</button>
              <button type="button" onClick={() => { setActionDialog({ kind: 'approve', claim: detail.claim }); setDetail(null); }} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white">{t('expenses.approve')}</button>
            </>}
            {detail.finance && detail.claim.canReimburse && explicitReimburse && <button type="button" onClick={() => { setActionDialog({ kind: 'reimburse', claim: detail.claim }); setDetail(null); }} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white">{t('expenses.markReimbursed')}</button>}
          </div>
        </Dialog>
      )}

      {actionDialog && (
        <Dialog
          title={actionDialog.kind === 'cancel' ? t('expenses.confirmCancel')
            : actionDialog.kind === 'approve' ? t('expenses.confirmApprove')
              : actionDialog.kind === 'reject' ? t('expenses.confirmReject')
                : t('expenses.confirmReimburse')}
          description={actionDialog.kind === 'approve' ? t('expenses.approvalNotReimbursement')
            : actionDialog.kind === 'reject' ? t('expenses.rejectionConsequence')
              : actionDialog.kind === 'reimburse' ? t('expenses.noBankTransfer')
                : t('expenses.cancelConsequence')}
          onClose={() => !actionLoading && setActionDialog(null)}
          labelledBy="expense-action-title"
          closeLabel={t('expenses.close')}
        >
          <div className="mt-5 rounded-xl border border-emerald-500/15 p-4">
            <p className="font-bold">{actionDialog.claim.merchantName}</p>
            <p className="mt-1 font-mono text-lg">{displayAmount(actionDialog.claim)}</p>
          </div>
          {actionDialog.kind !== 'cancel' && (
            <label className="mt-4 block text-sm font-bold">
              {t('expenses.noteOptional')}
              <textarea value={actionNote} onChange={(event) => setActionNote(event.target.value)} maxLength={1000} rows={3} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-3 font-normal dark:border-emerald-500/20 dark:bg-black/20" />
            </label>
          )}
          {actionDialog.kind === 'reimburse' && (
            <label className="mt-4 block text-sm font-bold">
              {t('expenses.externalReference')}
              <input value={externalReference} onChange={(event) => setExternalReference(event.target.value)} maxLength={120} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-3 font-normal dark:border-emerald-500/20 dark:bg-black/20" />
            </label>
          )}
          {actionError && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{actionError}</p>}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" disabled={actionLoading} onClick={() => setActionDialog(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold dark:border-emerald-500/20">{t('expenses.back')}</button>
            <button type="button" disabled={actionLoading} onClick={() => void executeAction()} className={cn('inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-60', actionDialog.kind === 'reject' || actionDialog.kind === 'cancel' ? 'bg-red-600' : 'bg-emerald-600')}>
              {actionLoading && <LoaderCircle className="h-4 w-4 animate-spin" />}
              {t('expenses.confirm')}
            </button>
          </div>
        </Dialog>
      )}

      {claimFlowOpen && (
        <Dialog title={t('expenses.newClaim')} description={t(`expenses.step.${claimStep}` as Parameters<typeof t>[0])} onClose={() => void resetFlow()} labelledBy="expense-flow-title" closeLabel={t('expenses.close')}>
          <div className="mt-5 flex items-center gap-2" aria-label={t('expenses.progress')}>
            {[1, 2, 3, 4].map((step) => <span key={step} className={cn('h-1.5 flex-1 rounded-full', step <= claimStep ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-white/10')} />)}
          </div>

          {claimStep === 1 && (
            <div className="mt-5">
              <div
                onDragEnter={(event) => { event.preventDefault(); setDropActive(true); }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => { event.preventDefault(); setDropActive(false); }}
                onDrop={(event: DragEvent<HTMLDivElement>) => {
                  event.preventDefault();
                  setDropActive(false);
                  setReceipt(event.dataTransfer.files[0] || null);
                }}
                className={cn('rounded-2xl border-2 border-dashed p-6 text-center transition', dropActive ? 'border-emerald-500 bg-emerald-500/10' : 'border-emerald-500/25 bg-emerald-500/[0.035]')}
              >
                <Upload className="mx-auto h-9 w-9 text-emerald-500" />
                <h3 className="mt-3 font-bold">{t('expenses.dropReceipt')}</h3>
                <p className="mt-1 text-sm text-slate-500 dark:text-emerald-100/55">{t('expenses.receiptFormats')}</p>
                <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setReceipt(event.target.files?.[0] || null)} className="sr-only" />
                <button type="button" onClick={() => fileInputRef.current?.click()} className="mt-4 rounded-lg border border-emerald-500/25 px-4 py-2 text-sm font-bold text-emerald-700 hover:bg-emerald-500/10 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:text-emerald-300">{t('expenses.chooseFile')}</button>
                {receiptFile && (
                  <div className="mx-auto mt-4 flex max-w-md items-center justify-between gap-3 rounded-lg border border-emerald-500/15 bg-white p-3 text-start dark:bg-black/20">
                    <span className="min-w-0 truncate text-sm font-semibold">{receiptFile.name}</span>
                    <button type="button" onClick={() => void removeReceipt()} className="shrink-0 rounded p-1 text-red-600" aria-label={t('expenses.removeReceipt')}><Trash2 className="h-4 w-4" /></button>
                  </div>
                )}
              </div>
              <p className="mt-3 text-xs text-slate-500 dark:text-emerald-100/50">{t('expenses.temporaryReceipt')}</p>
              {extractionError && <p role="alert" className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">{extractionError} {t('expenses.manualFallback')}</p>}
              {suggestions && (
                <p className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-200">
                  {t('expenses.replacePreservesEdits')}
                </p>
              )}
              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                <button type="button" onClick={() => setClaimStep(2)} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold dark:border-emerald-500/20">{t('expenses.continueManual')}</button>
                <button type="button" disabled={!receiptFile || extracting} onClick={() => void extractReceipt()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
                  {extracting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileImage className="h-4 w-4" />}
                  {extracting ? t('expenses.processing') : t('expenses.extractDetails')}
                </button>
              </div>
            </div>
          )}

          {claimStep === 2 && (
            <div className="mt-5">
              {suggestions && (
                <div className="mb-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-bold">{t('expenses.ocrSuggestions')}</h3>
                    <button type="button" onClick={() => setClaimStep(1)} className="text-xs font-bold text-emerald-700 hover:underline dark:text-emerald-300">{t('expenses.replaceReceipt')}</button>
                  </div>
                  <p className="mt-1 text-xs text-slate-500 dark:text-emerald-100/55">{t('expenses.suggestionsHelp')}</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {suggestionCard(t('expenses.merchant'), suggestions.merchantName, 'merchantName')}
                    {suggestionCard(t('expenses.expenseDate'), suggestions.transactionDate, 'expenseDate')}
                    {suggestionCard(t('expenses.amount'), suggestions.totalAmount, 'amount')}
                    {suggestionCard(t('expenses.currency'), suggestions.currency, 'currency')}
                  </div>
                  {extractionWarnings.length > 0 && (
                    <ul className="mt-3 space-y-1 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
                      {extractionWarnings.map((warning) => <li key={warning}>• {warning}</li>)}
                    </ul>
                  )}
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-bold">{t('expenses.merchant')}<input required maxLength={200} value={form.merchantName} onChange={(event) => updateField('merchantName', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-3 font-normal dark:border-emerald-500/20 dark:bg-black/20" /></label>
                <label className="text-sm font-bold">{t('expenses.expenseDate')}<input required type="date" value={form.expenseDate} onChange={(event) => updateField('expenseDate', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-3 font-normal dark:border-emerald-500/20 dark:bg-black/20" /></label>
                <label className="text-sm font-bold">{t('expenses.amount')}<input required type="text" inputMode="decimal" pattern="(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?" value={form.amount} onChange={(event) => updateField('amount', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-3 font-mono font-normal dark:border-emerald-500/20 dark:bg-black/20" /></label>
                <label className="text-sm font-bold">{t('expenses.currency')}<select required value={form.currency} onChange={(event) => updateField('currency', event.target.value)} className="stanza-select mt-1 w-full">{EXPENSE_CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label>
                <label className="text-sm font-bold sm:col-span-2">{t('expenses.category')}<select required value={form.category} onChange={(event) => updateField('category', event.target.value as ExpenseCategory)} className="stanza-select mt-1 w-full"><option value="">{t('expenses.selectCategory')}</option>{EXPENSE_CATEGORIES.map((category) => <option key={category} value={category}>{categoryLabel(category)}</option>)}</select></label>
                <label className="text-sm font-bold sm:col-span-2">{t('expenses.businessReason')}<textarea required maxLength={2000} rows={4} value={form.businessReason} onChange={(event) => updateField('businessReason', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-3 font-normal dark:border-emerald-500/20 dark:bg-black/20" /></label>
              </div>
              {formError && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{formError}</p>}
              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                <button type="button" onClick={() => setClaimStep(1)} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold dark:border-emerald-500/20">{t('expenses.back')}</button>
                <button type="button" onClick={moveToReview} className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white">{t('expenses.reviewClaim')}</button>
              </div>
            </div>
          )}

          {claimStep === 3 && (
            <div className="mt-5">
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  [t('expenses.merchant'), form.merchantName],
                  [t('expenses.expenseDate'), formatDate(form.expenseDate)],
                  [t('expenses.amount'), `${form.amount} ${form.currency}`],
                  [t('expenses.category'), form.category ? categoryLabel(form.category) : ''],
                  [t('expenses.extractionUsed'), extractionId ? t('expenses.yes') : t('expenses.no')],
                ].map(([label, value]) => <div key={label} className="rounded-lg border border-slate-200 p-3 dark:border-emerald-500/15"><p className="text-xs font-bold text-slate-500 dark:text-emerald-100/55">{label}</p><p className="mt-1 text-sm font-semibold">{value}</p></div>)}
              </div>
              <div className="mt-3 rounded-lg border border-slate-200 p-3 dark:border-emerald-500/15"><p className="text-xs font-bold text-slate-500 dark:text-emerald-100/55">{t('expenses.businessReason')}</p><p className="mt-1 whitespace-pre-wrap text-sm">{form.businessReason}</p></div>
              {extractionWarnings.length > 0 && <p className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">{t('expenses.reviewWarnings')}</p>}
              {formError && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{formError}</p>}
              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                <button type="button" onClick={() => setClaimStep(2)} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold dark:border-emerald-500/20">{t('expenses.back')}</button>
                <button type="button" disabled={submitting} onClick={() => void submitClaim()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">{submitting && <LoaderCircle className="h-4 w-4 animate-spin" />}{t('expenses.submitClaim')}</button>
              </div>
            </div>
          )}

          {claimStep === 4 && (
            <div className="mt-8 text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
              <h3 className="mt-4 text-xl font-black">{t('expenses.submitted')}</h3>
              <p className="mx-auto mt-2 max-w-md text-sm text-slate-500 dark:text-emerald-100/60">{t('expenses.submittedHelp')}</p>
              {duplicateWarning && <p className="mx-auto mt-4 max-w-md rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">{t('expenses.duplicateWarning')}</p>}
              <button type="button" onClick={() => { void resetFlow(false); setActiveView('claims'); }} className="mt-6 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white">{t('expenses.viewClaims')}</button>
            </div>
          )}
        </Dialog>
      )}
    </section>
  );
}
