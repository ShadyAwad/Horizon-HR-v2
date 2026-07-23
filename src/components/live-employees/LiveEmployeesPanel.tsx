import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Clock3, MapPin, RefreshCw, Search, ShieldCheck, UsersRound } from 'lucide-react';
import { fetchLiveEmployees, type LiveEmployee } from '../../api/live-employees';
import { useLanguage } from '../../lib/LanguageContext';
import {
  filterLiveEmployees,
  formatElapsedMinutes,
  summarizeLiveEmployees,
  type LiveEmployeeFilter,
} from '../../lib/live-employees';
import { cn } from '../../lib/utils';
import { UserAvatar } from '../UserAvatar';

const POLL_INTERVAL_MS = 30_000;

export function LiveEmployeesPanel() {
  const { t, lang } = useLanguage();
  const [employees, setEmployees] = useState<LiveEmployee[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<LiveEmployeeFilter>('all');
  const [search, setSearch] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef(false);
  const hasDataRef = useRef(false);

  const load = useCallback(async (manual = false) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const controller = new AbortController();
    requestRef.current = controller;
    if (!hasDataRef.current) setLoading(true);
    if (manual) setRefreshing(true);

    try {
      const response = await fetchLiveEmployees(controller.signal);
      if (controller.signal.aborted) return;
      setEmployees(response.employees);
      setGeneratedAt(response.generatedAt);
      setError('');
      hasDataRef.current = true;
    } catch (loadError) {
      if (!controller.signal.aborted) {
        setError(loadError instanceof Error ? loadError.message : t('liveEmployees.loadError'));
      }
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        inFlightRef.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [t]);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_INTERVAL_MS);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
      requestRef.current?.abort();
      requestRef.current = null;
      inFlightRef.current = false;
    };
  }, [load]);

  const summary = useMemo(() => summarizeLiveEmployees(employees), [employees]);
  const visibleEmployees = useMemo(
    () => filterLiveEmployees(employees, filter, search),
    [employees, filter, search],
  );
  const locale = lang === 'ar' ? 'ar-EG' : 'en-US';
  const formatTime = (value: string) => new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
  const statusLabel = (employee: LiveEmployee) => {
    const primary = t(`liveEmployees.status.${employee.status}` as const);
    return employee.status === 'overdue' && employee.currentBreakStartedAt
      ? `${primary} · ${t('liveEmployees.status.on_break')}`
      : primary;
  };
  const summaryCards = [
    ['total', summary.total, UsersRound],
    ['clockedIn', summary.clockedIn, Clock3],
    ['onBreak', summary.onBreak, MapPin],
    ['overdue', summary.overdue, AlertTriangle],
  ] as const;
  const tableHeadings = [
    ['employee', 'liveEmployees.employee'],
    ['status', 'liveEmployees.status'],
    ['clockIn', 'liveEmployees.clockIn'],
    ['elapsed', 'liveEmployees.elapsed'],
    ['geofence', 'liveEmployees.geofence'],
    ['lastActivity', 'liveEmployees.lastActivity'],
  ] as const;

  return (
    <section className="w-full min-w-0 rounded-2xl border border-emerald-500/15 bg-white/90 p-3 shadow-xl backdrop-blur-sm dark:bg-[#061411]/90 md:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <UsersRound className="h-5 w-5 text-emerald-500" />
            <h2 className="text-lg font-black text-neutral-950 dark:text-emerald-50">{t('liveEmployees.title')}</h2>
          </div>
          <p className="mt-1 text-sm text-neutral-600 dark:text-emerald-100/55">{t('liveEmployees.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={refreshing}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-emerald-500/20 px-3 text-xs font-black uppercase text-emerald-700 transition hover:bg-emerald-500/10 disabled:cursor-wait disabled:opacity-60 dark:text-emerald-300"
        >
          <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
          {t('liveEmployees.refresh')}
        </button>
      </div>

      {error && (
        <div role="status" className="mt-3 flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{t('liveEmployees.staleError')}</span>
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {summaryCards.map(([key, count, Icon]) => (
          <div key={key} className="rounded-lg border border-emerald-500/15 bg-black/[0.025] p-3 dark:bg-black/25">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase text-neutral-500 dark:text-emerald-100/50">{t(`liveEmployees.summary.${key}` as const)}</span>
              <Icon className="h-4 w-4 text-emerald-500" />
            </div>
            <strong className="mt-2 block text-2xl text-neutral-950 dark:text-emerald-50" dir="ltr">{count}</strong>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-[minmax(220px,1fr)_auto]">
        <label className="relative">
          <span className="sr-only">{t('liveEmployees.search')}</span>
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('liveEmployees.search')}
            className="h-10 w-full rounded-lg border border-emerald-500/20 bg-black/5 ps-9 pe-3 text-base text-neutral-950 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 dark:bg-black/35 dark:text-emerald-50"
          />
        </label>
        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value as LiveEmployeeFilter)}
          aria-label={t('liveEmployees.filter')}
          className="h-10 rounded-lg border border-emerald-500/20 bg-black/5 px-3 text-sm text-neutral-900 outline-none focus:border-emerald-500 dark:bg-black/35 dark:text-emerald-50"
        >
          {(['all', 'clocked_in', 'on_break', 'overdue', 'valid_geofence', 'invalid_geofence'] as const).map((value) => (
            <option key={value} value={value}>{t(`liveEmployees.filter.${value}` as const)}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="mt-4 min-h-44 animate-pulse rounded-lg border border-emerald-500/10 bg-emerald-500/5" aria-label={t('liveEmployees.loading')} />
      ) : visibleEmployees.length === 0 ? (
        <div className="mt-4 flex min-h-44 items-center justify-center rounded-lg border border-dashed border-emerald-500/20 px-4 text-center text-sm text-neutral-500 dark:text-emerald-100/45">
          {employees.length === 0 ? t('liveEmployees.empty') : t('liveEmployees.noMatches')}
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-2 md:hidden">
            {visibleEmployees.map((employee) => (
              <article key={employee.employeeId} className="rounded-lg border border-emerald-500/15 bg-black/[0.025] p-3 dark:bg-black/25">
                <div className="flex items-start gap-3">
                  <UserAvatar name={employee.displayName} imageUrl={employee.avatarUrl} className="h-11 w-11" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div><h3 className="truncate font-bold text-neutral-950 dark:text-emerald-50">{employee.displayName}</h3><p className="text-xs text-neutral-500 dark:text-emerald-100/50">{employee.role}</p></div>
                      <StatusBadge employee={employee} label={statusLabel(employee)} />
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-neutral-600 dark:text-emerald-100/60">
                      <span>{t('liveEmployees.clockIn')}: <b dir="ltr">{formatTime(employee.clockInTime)}</b></span>
                      <span>{t('liveEmployees.elapsed')}: <b dir="ltr">{formatElapsedMinutes(employee.elapsedMinutes)}</b></span>
                      <span className="col-span-2">{employee.geofenceName || t('liveEmployees.unknownGeofence')}</span>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <div className="mt-4 hidden overflow-x-auto md:block">
            <table className="w-full min-w-[760px] text-start text-sm">
              <thead className="border-b border-emerald-500/15 text-xs uppercase text-neutral-500 dark:text-emerald-100/45">
                <tr>{tableHeadings.map(([key, translationKey]) => <th key={key} className="px-3 py-2 text-start">{t(translationKey)}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-emerald-500/10">
                {visibleEmployees.map((employee) => (
                  <tr key={employee.employeeId}>
                    <td className="px-3 py-3"><div className="flex items-center gap-2"><UserAvatar name={employee.displayName} imageUrl={employee.avatarUrl} className="h-9 w-9" /><div><div className="font-bold text-neutral-950 dark:text-emerald-50">{employee.displayName}</div><div className="text-xs text-neutral-500">{employee.role}</div></div></div></td>
                    <td className="px-3 py-3"><StatusBadge employee={employee} label={statusLabel(employee)} /></td>
                    <td className="px-3 py-3" dir="ltr">{formatTime(employee.clockInTime)}</td>
                    <td className="px-3 py-3 font-semibold" dir="ltr">{formatElapsedMinutes(employee.elapsedMinutes)}</td>
                    <td className="px-3 py-3"><span className="inline-flex items-center gap-1"><ShieldCheck className={cn('h-4 w-4', employee.isValidGeofence ? 'text-emerald-500' : 'text-red-500')} />{employee.geofenceName || t('liveEmployees.unknownGeofence')}</span></td>
                    <td className="px-3 py-3" dir="ltr">{formatTime(employee.lastAttendanceActivityAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {generatedAt && <p className="mt-3 text-end text-xs text-neutral-500 dark:text-emerald-100/40">{t('liveEmployees.updated')} <span dir="ltr">{formatTime(generatedAt)}</span></p>}
    </section>
  );
}

function StatusBadge({ employee, label }: { employee: LiveEmployee; label: string }) {
  return (
    <span className={cn(
      'inline-flex rounded-full border px-2 py-1 text-[10px] font-black uppercase',
      employee.status === 'overdue'
        ? 'border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300'
        : employee.currentBreakStartedAt
          ? 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300'
          : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    )}>{label}</span>
  );
}
