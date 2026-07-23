import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Ban,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Filter,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRoundCog,
  X,
} from 'lucide-react';
import { apiFetch, apiUrl } from '../../lib/api';
import { useLanguage, type TranslationKey } from '../../lib/LanguageContext';
import { cn } from '../../lib/utils';

type AuditSeverity = 'neutral' | 'informational' | 'warning' | 'critical';

type AuditEvent = {
  id: string;
  action: string;
  module: string;
  severity: AuditSeverity;
  actor: { id: string | null; displayName: string; role: string };
  target: { type: string; id: string | null; displayName: string };
  summary: string;
  createdAt: string;
  metadata: Record<string, unknown>;
};

type AuditResponse = {
  success: true;
  page: number;
  pageSize: number;
  total: number;
  summary: {
    eventsToday: number;
    securityEvents: number;
    employeeChanges: number;
    rejectedActions: number;
  };
  filters: {
    actions: string[];
    modules: string[];
    actors: Array<{ id: string; displayName: string; role: string }>;
  };
  events: AuditEvent[];
};

type AuditFilters = {
  action: string;
  module: string;
  actorId: string;
  dateFrom: string;
  dateTo: string;
  search: string;
};

const EMPTY_FILTERS: AuditFilters = {
  action: '',
  module: '',
  actorId: '',
  dateFrom: '',
  dateTo: '',
  search: '',
};

const ACTION_TRANSLATIONS: Record<string, TranslationKey> = {
  'attendance.clock_in': 'audit.action.clockIn',
  'attendance.clock_out': 'audit.action.clockOut',
  'attendance.geofence_rejected': 'audit.action.geofenceRejected',
  'auth.passkey.login': 'audit.action.passkeyLogin',
  'auth.passkey.registered': 'audit.action.passkeyRegistered',
  'auth.session.revoked': 'audit.action.sessionRevoked',
  'auth.sessions.revoked_all': 'audit.action.sessionsRevokedAll',
  'auth.session.revoked_by_admin': 'audit.action.sessionRevokedByAdmin',
  'employee.role.assigned': 'audit.action.roleAssigned',
  'employee.role.privileged_assigned': 'audit.action.privilegedRoleAssigned',
  'employee.role.removed': 'audit.action.roleRemoved',
  'employee.role.privileged_removed': 'audit.action.privilegedRoleRemoved',
  'employee.salary.updated': 'audit.action.salaryUpdated',
  'employee.updated': 'audit.action.employeeUpdated',
  'feed.post.created': 'audit.action.feedPostCreated',
  'feed.post.status_changed': 'audit.action.feedPostStatusChanged',
  'geofence.created': 'audit.action.geofenceCreated',
  'geofence.updated': 'audit.action.geofenceUpdated',
  'grievance.created': 'audit.action.grievanceCreated',
  'grievance.status_changed': 'audit.action.grievanceStatusChanged',
  'hiring.applicant.created': 'audit.action.hiringApplicantCreated',
  'hiring.applicant.updated': 'audit.action.hiringApplicantUpdated',
  'hiring.stage_changed': 'audit.action.hiringStageChanged',
  'leave.requested': 'audit.action.leaveRequested',
  'leave.status_changed': 'audit.action.leaveStatusChanged',
  'payroll.approved': 'audit.action.payrollApproved',
  'payroll.cancelled': 'audit.action.payrollCancelled',
  'payroll.generated': 'audit.action.payrollGenerated',
  'payroll.paid': 'audit.action.payrollPaid',
  'payroll.status_changed': 'audit.action.payrollStatusChanged',
  'tenant.registered': 'audit.action.tenantRegistered',
};

const MODULE_TRANSLATIONS: Record<string, TranslationKey> = {
  auth: 'audit.module.auth',
  attendance: 'audit.module.attendance',
  breaks: 'audit.module.breaks',
  employees: 'audit.module.employees',
  feed: 'audit.module.feed',
  geofence: 'audit.module.geofence',
  grievances: 'audit.module.grievances',
  hiring: 'audit.module.hiring',
  leave: 'audit.module.leave',
  notifications: 'audit.module.notifications',
  payroll: 'audit.module.payroll',
  resignations: 'audit.module.resignations',
  roster: 'audit.module.roster',
  workspace: 'audit.module.workspace',
};

function readInitialFilters() {
  if (typeof window === 'undefined') return { page: 1, filters: EMPTY_FILTERS };
  const params = new URLSearchParams(window.location.search);
  const pageValue = Number(params.get('page'));
  return {
    page: Number.isInteger(pageValue) && pageValue > 0 ? pageValue : 1,
    filters: {
      action: params.get('action') || '',
      module: params.get('module') || '',
      actorId: params.get('actorId') || '',
      dateFrom: params.get('dateFrom') || '',
      dateTo: params.get('dateTo') || '',
      search: params.get('search') || '',
    },
  };
}

function humanize(value: string) {
  return value
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const severityClass: Record<AuditSeverity, string> = {
  neutral: 'border-neutral-500/25 bg-neutral-500/10 text-neutral-500 dark:text-neutral-300',
  informational: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  warning: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  critical: 'border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300',
};

export function AuditTrailPanel() {
  const { t, lang, isRtl } = useLanguage();
  const initial = useMemo(readInitialFilters, []);
  const [page, setPage] = useState(initial.page);
  const [draftFilters, setDraftFilters] = useState<AuditFilters>(initial.filters);
  const [filters, setFilters] = useState<AuditFilters>(initial.filters);
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const requestRef = useRef<AbortController | null>(null);

  const updateUrl = useCallback((nextPage: number, nextFilters: AuditFilters) => {
    const params = new URLSearchParams();
    if (nextPage > 1) params.set('page', String(nextPage));
    Object.entries(nextFilters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
  }, []);

  const loadEvents = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError('');

    const params = new URLSearchParams({ page: String(page), pageSize: '25' });
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });

    try {
      const response = await apiFetch(apiUrl(`/api/hr/audit-events?${params}`), {
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.success !== true) {
        throw new Error(body.error || t('audit.error'));
      }
      setData(body as AuditResponse);
      updateUrl(page, filters);
    } catch (requestError) {
      if ((requestError as Error).name !== 'AbortError') {
        setError(requestError instanceof Error ? requestError.message : t('audit.error'));
      }
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }, [filters, page, t, updateUrl]);

  useEffect(() => {
    void loadEvents();
    return () => requestRef.current?.abort();
  }, [loadEvents]);

  const totalPages = Math.max(1, Math.ceil((data?.total || 0) / 25));
  const actionLabel = (action: string) => ACTION_TRANSLATIONS[action] ? t(ACTION_TRANSLATIONS[action]) : t('audit.unknownAction');
  const eventSummary = (event: AuditEvent) => ACTION_TRANSLATIONS[event.action]
    ? actionLabel(event.action)
    : t('audit.unknownAction');
  const moduleLabel = (moduleName: string) => MODULE_TRANSLATIONS[moduleName] ? t(MODULE_TRANSLATIONS[moduleName]) : humanize(moduleName);
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }),
    [lang],
  );
  const summaryCards = [
    { label: t('audit.eventsToday'), value: data?.summary.eventsToday ?? 0, icon: Clock3 },
    { label: t('audit.securityEvents'), value: data?.summary.securityEvents ?? 0, icon: ShieldCheck },
    { label: t('audit.employeeChanges'), value: data?.summary.employeeChanges ?? 0, icon: UserRoundCog },
    { label: t('audit.rejectedActions'), value: data?.summary.rejectedActions ?? 0, icon: Ban },
  ];

  const applyFilters = () => {
    setPage(1);
    setFilters({ ...draftFilters });
  };
  const clearFilters = () => {
    setDraftFilters(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };
  const updateDraft = (key: keyof AuditFilters, value: string) => {
    setDraftFilters((current) => ({ ...current, [key]: value }));
  };

  return (
    <section dir={isRtl ? 'rtl' : 'ltr'} className="w-full min-w-0 space-y-4" aria-labelledby="audit-trail-title">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-emerald-500/15 pb-4">
        <div>
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-300">
            <Activity className="h-5 w-5" aria-hidden="true" />
            <h2 id="audit-trail-title" className="text-lg font-bold text-neutral-950 dark:text-emerald-50">{t('audit.title')}</h2>
          </div>
          <p className="mt-1 text-sm text-neutral-500 dark:text-emerald-100/55">{t('audit.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={() => void loadEvents()}
          disabled={loading}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-emerald-500/20 px-3 text-xs font-bold text-emerald-700 hover:bg-emerald-500/10 disabled:cursor-wait disabled:opacity-60 dark:text-emerald-200"
        >
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden="true" />
          {t('audit.retry')}
        </button>
      </header>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {summaryCards.map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded-lg border border-emerald-500/15 bg-white/70 p-3 dark:bg-black/30">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-neutral-500 dark:text-emerald-100/55">{label}</p>
              <Icon className="h-4 w-4 text-emerald-500" aria-hidden="true" />
            </div>
            <p className="mt-2 text-2xl font-bold text-neutral-950 dark:text-emerald-50">{value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-emerald-500/15 bg-white/65 dark:bg-black/25">
        <button
          type="button"
          aria-expanded={filtersOpen}
          aria-controls="audit-filter-panel"
          onClick={() => setFiltersOpen((current) => !current)}
          className="flex w-full items-center justify-between gap-3 px-3 py-3 text-sm font-bold text-neutral-800 md:hidden dark:text-emerald-100"
        >
          <span className="flex items-center gap-2"><Filter className="h-4 w-4" />{t('audit.filters')}</span>
          <ChevronRight className={cn('h-4 w-4 transition-transform', filtersOpen && (isRtl ? '-rotate-90' : 'rotate-90'))} />
        </button>
        <div id="audit-filter-panel" className={cn('p-3', !filtersOpen && 'hidden md:block')}>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <label className="space-y-1 text-xs font-semibold text-neutral-600 dark:text-emerald-100/65">
              <span>{t('audit.dateFrom')}</span>
              <input type="date" value={draftFilters.dateFrom} onChange={(event) => updateDraft('dateFrom', event.target.value)} className="h-9 w-full rounded-lg border border-emerald-500/20 bg-white px-2 text-sm text-neutral-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:bg-black/40 dark:text-emerald-50" />
            </label>
            <label className="space-y-1 text-xs font-semibold text-neutral-600 dark:text-emerald-100/65">
              <span>{t('audit.dateTo')}</span>
              <input type="date" value={draftFilters.dateTo} onChange={(event) => updateDraft('dateTo', event.target.value)} className="h-9 w-full rounded-lg border border-emerald-500/20 bg-white px-2 text-sm text-neutral-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:bg-black/40 dark:text-emerald-50" />
            </label>
            <label className="space-y-1 text-xs font-semibold text-neutral-600 dark:text-emerald-100/65">
              <span>{t('audit.module')}</span>
              <select value={draftFilters.module} onChange={(event) => updateDraft('module', event.target.value)} className="h-9 w-full rounded-lg border border-emerald-500/20 bg-white px-2 text-sm text-neutral-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:bg-black/40 dark:text-emerald-50">
                <option value="">{t('audit.allModules')}</option>
                {(data?.filters.modules || []).map((moduleName) => <option key={moduleName} value={moduleName}>{moduleLabel(moduleName)}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs font-semibold text-neutral-600 dark:text-emerald-100/65">
              <span>{t('audit.action')}</span>
              <select value={draftFilters.action} onChange={(event) => updateDraft('action', event.target.value)} className="h-9 w-full rounded-lg border border-emerald-500/20 bg-white px-2 text-sm text-neutral-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:bg-black/40 dark:text-emerald-50">
                <option value="">{t('audit.allActions')}</option>
                {(data?.filters.actions || []).map((action) => <option key={action} value={action}>{actionLabel(action)}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs font-semibold text-neutral-600 dark:text-emerald-100/65">
              <span>{t('audit.actor')}</span>
              <select value={draftFilters.actorId} onChange={(event) => updateDraft('actorId', event.target.value)} className="h-9 w-full rounded-lg border border-emerald-500/20 bg-white px-2 text-sm text-neutral-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:bg-black/40 dark:text-emerald-50">
                <option value="">{t('audit.allActors')}</option>
                {(data?.filters.actors || []).map((actor) => <option key={actor.id} value={actor.id}>{actor.displayName}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs font-semibold text-neutral-600 dark:text-emerald-100/65">
              <span>{t('audit.search')}</span>
              <span className="relative block">
                <Search className="pointer-events-none absolute start-2.5 top-2.5 h-4 w-4 text-neutral-400" aria-hidden="true" />
                <input value={draftFilters.search} maxLength={100} onChange={(event) => updateDraft('search', event.target.value)} placeholder={t('audit.searchPlaceholder')} className="h-9 w-full rounded-lg border border-emerald-500/20 bg-white ps-8 pe-2 text-sm text-neutral-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:bg-black/40 dark:text-emerald-50" />
              </span>
            </label>
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button type="button" onClick={clearFilters} className="inline-flex h-9 items-center gap-2 rounded-lg border border-emerald-500/15 px-3 text-xs font-bold text-neutral-600 hover:bg-emerald-500/5 dark:text-emerald-100/65">
              <X className="h-4 w-4" />{t('audit.clearFilters')}
            </button>
            <button type="button" onClick={applyFilters} className="inline-flex h-9 items-center gap-2 rounded-lg bg-emerald-500 px-4 text-xs font-bold text-[#02110b] hover:bg-emerald-400">
              <Filter className="h-4 w-4" />{t('audit.applyFilters')}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-200">
          <span>{error}</span>
          <button type="button" onClick={() => void loadEvents()} className="font-bold underline underline-offset-4">{t('audit.retry')}</button>
        </div>
      )}

      <div className={cn('relative min-h-48 transition-opacity', loading && data && 'opacity-60')}>
        {loading && !data ? (
          <div className="grid min-h-64 place-items-center text-sm text-emerald-700 dark:text-emerald-300" role="status">
            <RefreshCw className="mb-2 h-6 w-6 animate-spin" />
            {t('audit.loading')}
          </div>
        ) : data?.events.length === 0 ? (
          <div className="grid min-h-64 place-items-center rounded-lg border border-dashed border-emerald-500/20 text-center">
            <div>
              <ShieldCheck className="mx-auto h-8 w-8 text-emerald-500/60" />
              <p className="mt-3 font-bold text-neutral-800 dark:text-emerald-100">{t('audit.empty')}</p>
              <p className="mt-1 text-sm text-neutral-500 dark:text-emerald-100/50">{t('audit.emptyHint')}</p>
            </div>
          </div>
        ) : (
          <>
            <div className="hidden overflow-hidden rounded-lg border border-emerald-500/15 md:block">
              <table className="w-full table-fixed border-collapse text-start text-sm">
                <thead className="bg-emerald-500/5 text-xs uppercase text-neutral-500 dark:text-emerald-100/55">
                  <tr>
                    <th className="w-[18%] px-3 py-2.5 text-start">{t('audit.timestamp')}</th>
                    <th className="w-[18%] px-3 py-2.5 text-start">{t('audit.action')}</th>
                    <th className="w-[16%] px-3 py-2.5 text-start">{t('audit.actor')}</th>
                    <th className="w-[16%] px-3 py-2.5 text-start">{t('audit.target')}</th>
                    <th className="w-[12%] px-3 py-2.5 text-start">{t('audit.module')}</th>
                    <th className="w-[20%] px-3 py-2.5 text-start">{t('audit.summary')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-emerald-500/10">
                  {data?.events.map((event) => (
                    <tr key={event.id} className="bg-white/55 align-top hover:bg-emerald-500/5 dark:bg-black/20">
                      <td className="px-3 py-3 text-xs text-neutral-500 dark:text-emerald-100/55">{dateFormatter.format(new Date(event.createdAt))}</td>
                      <td className="px-3 py-3"><span className={cn('inline-flex rounded border px-2 py-1 text-xs font-semibold', severityClass[event.severity])}>{actionLabel(event.action)}</span></td>
                      <td className="truncate px-3 py-3 font-semibold text-neutral-800 dark:text-emerald-100" title={event.actor.displayName}>{event.actor.displayName}</td>
                      <td className="truncate px-3 py-3 text-neutral-600 dark:text-emerald-100/70" title={event.target.displayName}>{event.target.displayName}</td>
                      <td className="px-3 py-3 text-xs font-semibold text-emerald-700 dark:text-emerald-300">{moduleLabel(event.module)}</td>
                      <td className="px-3 py-3 text-neutral-600 dark:text-emerald-100/70">{eventSummary(event)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-2 md:hidden">
              {data?.events.map((event) => (
                <article key={event.id} className="rounded-lg border border-emerald-500/15 bg-white/65 p-3 dark:bg-black/25">
                  <div className="flex items-start justify-between gap-2">
                    <span className={cn('inline-flex rounded border px-2 py-1 text-xs font-semibold', severityClass[event.severity])}>{actionLabel(event.action)}</span>
                    <time className="text-end text-[11px] text-neutral-500 dark:text-emerald-100/50">{dateFormatter.format(new Date(event.createdAt))}</time>
                  </div>
                  <p className="mt-2 text-sm font-bold text-neutral-900 dark:text-emerald-50">{eventSummary(event)}</p>
                  <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                    <dt className="text-neutral-500 dark:text-emerald-100/45">{t('audit.actor')}</dt><dd className="min-w-0 truncate text-neutral-700 dark:text-emerald-100/75">{event.actor.displayName}</dd>
                    <dt className="text-neutral-500 dark:text-emerald-100/45">{t('audit.target')}</dt><dd className="min-w-0 truncate text-neutral-700 dark:text-emerald-100/75">{event.target.displayName}</dd>
                    <dt className="text-neutral-500 dark:text-emerald-100/45">{t('audit.module')}</dt><dd className="text-emerald-700 dark:text-emerald-300">{moduleLabel(event.module)}</dd>
                  </dl>
                </article>
              ))}
            </div>
          </>
        )}
        {loading && data && <span className="sr-only" role="status">{t('audit.loading')}</span>}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-emerald-500/15 pt-3 text-xs text-neutral-500 dark:text-emerald-100/55">
        <p>{t('audit.paginationStatus').replace('{page}', String(data?.page || page)).replace('{pages}', String(totalPages)).replace('{total}', String(data?.total || 0))}</p>
        <div className="flex items-center gap-2">
          <button type="button" disabled={loading || page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} aria-label={t('audit.previousPage')} className="grid h-9 w-9 place-items-center rounded-lg border border-emerald-500/20 hover:bg-emerald-500/10 disabled:opacity-40">
            <ChevronLeft className={cn('h-4 w-4', isRtl && 'rotate-180')} />
          </button>
          <button type="button" disabled={loading || page >= totalPages} onClick={() => setPage((current) => current + 1)} aria-label={t('audit.nextPage')} className="grid h-9 w-9 place-items-center rounded-lg border border-emerald-500/20 hover:bg-emerald-500/10 disabled:opacity-40">
            <ChevronRight className={cn('h-4 w-4', isRtl && 'rotate-180')} />
          </button>
        </div>
      </footer>
    </section>
  );
}
