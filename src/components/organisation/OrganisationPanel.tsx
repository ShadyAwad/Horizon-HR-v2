import { useCallback, useEffect, useState } from 'react';
import { Building2, Network, RefreshCw, UsersRound } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { useLanguage } from '../../lib/LanguageContext';

type Overview = { employeeCount: number; departments: number; teams: number; managedEmployees: number; unassignedEmployees: number; activeDelegations: number };
type Department = { id: string; name: string; code: string | null; departmentHeadName: string | null; isActive: boolean };
type Team = { id: string; name: string; departmentName: string | null; teamLeadName: string | null; memberCount: number; isActive: boolean };

export function OrganisationPanel() {
  const { t, isRtl } = useLanguage();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const responses = await Promise.all(['/api/hr/organisation/overview', '/api/hr/organisation/departments', '/api/hr/organisation/teams'].map((path) => apiFetch(path)));
      const bodies = await Promise.all(responses.map((response) => response.json()));
      if (responses.some((response) => !response.ok)) throw new Error(bodies.find((body) => body?.error)?.error || t('organisation.loadError'));
      setOverview(bodies[0].overview); setDepartments(bodies[1].departments || []); setTeams(bodies[2].teams || []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('organisation.loadError')); }
    finally { setLoading(false); }
  }, [t]);

  useEffect(() => { void load(); }, [load]);
  const cards = overview ? [
    [t('organisation.employees'), overview.employeeCount, UsersRound], [t('organisation.departments'), overview.departments, Building2], [t('organisation.teams'), overview.teams, Network], [t('organisation.unassigned'), overview.unassignedEmployees, UsersRound],
  ] : [];

  return <section className="rounded-2xl border border-emerald-500/15 bg-white p-4 shadow-xl dark:bg-black/40" dir={isRtl ? 'rtl' : 'ltr'}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-bold text-neutral-900 dark:text-emerald-50">{t('organisation.title')}</h2><p className="mt-1 text-sm text-neutral-600 dark:text-emerald-100/60">{t('organisation.subtitle')}</p></div>
      <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded border border-emerald-500/25 px-3 py-2 text-xs font-bold text-emerald-700 disabled:opacity-60 dark:text-emerald-200"><RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />{t('organisation.refresh')}</button>
    </div>
    {error && <div role="alert" className="mt-4 rounded border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-200">{error}</div>}
    <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">{cards.map(([label, value, Icon]) => { const MetricIcon = Icon as typeof UsersRound; return <div key={String(label)} className="rounded-lg border border-emerald-500/15 bg-emerald-500/5 p-3"><MetricIcon className="h-4 w-4 text-emerald-500" /><p className="mt-3 text-2xl font-bold text-neutral-900 dark:text-emerald-50">{String(value)}</p><p className="text-xs text-neutral-600 dark:text-emerald-100/55">{String(label)}</p></div>; })}</div>
    <div className="mt-6 grid gap-4 xl:grid-cols-2">
      <section><h3 className="text-sm font-bold text-neutral-900 dark:text-emerald-50">{t('organisation.departments')}</h3><div className="mt-2 space-y-2">{departments.filter((department) => department.isActive).map((department) => <div key={department.id} className="flex items-center justify-between gap-2 rounded border border-emerald-500/12 p-3 text-sm"><span className="font-medium text-neutral-800 dark:text-emerald-100">{department.name}</span><span className="text-xs text-neutral-500 dark:text-emerald-100/50">{department.departmentHeadName || t('organisation.noHead')}</span></div>)}{!loading && !departments.length && <p className="text-sm text-neutral-500 dark:text-emerald-100/50">{t('organisation.emptyDepartments')}</p>}</div></section>
      <section><h3 className="text-sm font-bold text-neutral-900 dark:text-emerald-50">{t('organisation.teams')}</h3><div className="mt-2 space-y-2">{teams.filter((team) => team.isActive).map((team) => <div key={team.id} className="flex items-center justify-between gap-2 rounded border border-emerald-500/12 p-3 text-sm"><span className="font-medium text-neutral-800 dark:text-emerald-100">{team.name}</span><span className="text-xs text-neutral-500 dark:text-emerald-100/50">{team.memberCount} {t('organisation.members')}</span></div>)}{!loading && !teams.length && <p className="text-sm text-neutral-500 dark:text-emerald-100/50">{t('organisation.emptyTeams')}</p>}</div></section>
    </div>
  </section>;
}
