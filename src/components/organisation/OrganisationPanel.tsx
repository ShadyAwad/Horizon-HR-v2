import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Building2, Network, RefreshCw, UsersRound } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { useLanguage } from '../../lib/LanguageContext';

type Overview = { employeeCount: number; departments: number; teams: number; managedEmployees: number; unassignedEmployees: number; activeDelegations: number };
type Department = { id: string; name: string; code: string | null; departmentHeadName: string | null; isActive: boolean };
type Team = { id: string; name: string; departmentName: string | null; teamLeadName: string | null; memberCount: number; isActive: boolean };
type JobTitle = { id: string; name: string; level: number | null; isActive: boolean };
type Person = { id: string; fullName: string; email: string; jobTitle: string | null; department: string | null; team: string | null; managerName: string | null; isActive: boolean };

export function OrganisationPanel() {
  const { t, isRtl } = useLanguage();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [jobTitles, setJobTitles] = useState<JobTitle[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [tab, setTab] = useState<'overview' | 'people' | 'departments' | 'teams' | 'titles'>('overview');
  const [newName, setNewName] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const responses = await Promise.all(['/api/hr/organisation/overview', '/api/hr/organisation/departments', '/api/hr/organisation/teams', '/api/hr/organisation/job-titles', `/api/hr/organisation/people?search=${encodeURIComponent(search)}`].map((path) => apiFetch(path)));
      const bodies = await Promise.all(responses.map((response) => response.json()));
      if (responses.some((response) => !response.ok)) throw new Error(bodies.find((body) => body?.error)?.error || t('organisation.loadError'));
      setOverview(bodies[0].overview); setDepartments(bodies[1].departments || []); setTeams(bodies[2].teams || []); setJobTitles(bodies[3].jobTitles || []); setPeople(bodies[4].people || []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('organisation.loadError')); }
    finally { setLoading(false); }
  }, [search, t]);

  useEffect(() => { void load(); }, [load]);
  const create = async (event: FormEvent) => { event.preventDefault(); const path = tab === 'departments' ? '/api/hr/organisation/departments' : tab === 'teams' ? '/api/hr/organisation/teams' : '/api/hr/organisation/job-titles'; if (!newName.trim() || tab === 'overview' || tab === 'people') return; try { const response = await apiFetch(path, { method: 'POST', body: JSON.stringify({ name: newName.trim() }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error || t('organisation.loadError')); setNewName(''); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : t('organisation.loadError')); } };
  const archive = async (kind: 'departments' | 'teams' | 'job-titles', id: string) => { if (!confirm(t('organisation.confirmArchive'))) return; try { const response = await apiFetch(`/api/hr/organisation/${kind}/${id}/archive`, { method: 'POST', body: JSON.stringify({ confirmArchive: true }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error || t('organisation.loadError')); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : t('organisation.loadError')); } };
  const cards = overview ? [
    [t('organisation.employees'), overview.employeeCount, UsersRound], [t('organisation.departments'), overview.departments, Building2], [t('organisation.teams'), overview.teams, Network], [t('organisation.unassigned'), overview.unassignedEmployees, UsersRound],
  ] : [];

  return <section className="rounded-2xl border border-emerald-500/15 bg-white p-4 shadow-xl dark:bg-black/40" dir={isRtl ? 'rtl' : 'ltr'}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-bold text-neutral-900 dark:text-emerald-50">{t('organisation.title')}</h2><p className="mt-1 text-sm text-neutral-600 dark:text-emerald-100/60">{t('organisation.subtitle')}</p></div>
      <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded border border-emerald-500/25 px-3 py-2 text-xs font-bold text-emerald-700 disabled:opacity-60 dark:text-emerald-200"><RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />{t('organisation.refresh')}</button>
    </div>
    {error && <div role="alert" className="mt-4 rounded border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-200">{error}</div>}
    <div className="mt-4 flex max-w-full gap-2 overflow-x-auto pb-1">{(['overview','people','departments','teams','titles'] as const).map((item) => <button key={item} type="button" onClick={() => setTab(item)} className={`shrink-0 rounded border px-3 py-2 text-xs font-bold ${tab===item?'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200':'border-emerald-500/15 text-neutral-600 dark:text-emerald-100/60'}`}>{t(`organisation.${item}` as never)}</button>)}</div>
    {tab==='overview' && <><div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">{cards.map(([label, value, Icon]) => { const MetricIcon = Icon as typeof UsersRound; return <div key={String(label)} className="rounded-lg border border-emerald-500/15 bg-emerald-500/5 p-3"><MetricIcon className="h-4 w-4 text-emerald-500" /><p className="mt-3 text-2xl font-bold text-neutral-900 dark:text-emerald-50">{String(value)}</p><p className="text-xs text-neutral-600 dark:text-emerald-100/55">{String(label)}</p></div>; })}</div>
    <div className="mt-6 grid gap-4 xl:grid-cols-2">
      <section><h3 className="text-sm font-bold text-neutral-900 dark:text-emerald-50">{t('organisation.departments')}</h3><div className="mt-2 space-y-2">{departments.filter((department) => department.isActive).map((department) => <div key={department.id} className="flex items-center justify-between gap-2 rounded border border-emerald-500/12 p-3 text-sm"><span className="font-medium text-neutral-800 dark:text-emerald-100">{department.name}</span><span className="text-xs text-neutral-500 dark:text-emerald-100/50">{department.departmentHeadName || t('organisation.noHead')}</span></div>)}{!loading && !departments.length && <p className="text-sm text-neutral-500 dark:text-emerald-100/50">{t('organisation.emptyDepartments')}</p>}</div></section>
      <section><h3 className="text-sm font-bold text-neutral-900 dark:text-emerald-50">{t('organisation.teams')}</h3><div className="mt-2 space-y-2">{teams.filter((team) => team.isActive).map((team) => <div key={team.id} className="flex items-center justify-between gap-2 rounded border border-emerald-500/12 p-3 text-sm"><span className="font-medium text-neutral-800 dark:text-emerald-100">{team.name}</span><span className="text-xs text-neutral-500 dark:text-emerald-100/50">{team.memberCount} {t('organisation.members')}</span></div>)}{!loading && !teams.length && <p className="text-sm text-neutral-500 dark:text-emerald-100/50">{t('organisation.emptyTeams')}</p>}</div></section>
    </div></>}
    {tab==='people' && <section className="mt-5"><input value={search} onChange={(event)=>setSearch(event.target.value)} placeholder={t('organisation.searchPeople')} className="w-full rounded border border-emerald-500/20 bg-transparent px-3 py-2 text-sm" /><div className="mt-3 grid gap-2 md:grid-cols-2">{people.map((person)=><article key={person.id} className="rounded border border-emerald-500/15 p-3"><p className="font-bold text-neutral-900 dark:text-emerald-50">{person.fullName}</p><p className="text-xs text-neutral-500 dark:text-emerald-100/55">{person.jobTitle || t('organisation.unassigned')} · {person.department || t('organisation.unassigned')} · {person.team || t('organisation.unassigned')}</p><p className="mt-1 text-xs text-neutral-500 dark:text-emerald-100/55">{t('organisation.manager')}: {person.managerName || t('organisation.none')}</p></article>)}</div></section>}
    {(tab==='departments'||tab==='teams'||tab==='titles') && <section className="mt-5"><form onSubmit={create} className="flex gap-2"><input value={newName} onChange={(event)=>setNewName(event.target.value)} placeholder={t('organisation.name')} className="min-w-0 flex-1 rounded border border-emerald-500/20 bg-transparent px-3 py-2 text-sm" /><button className="rounded bg-emerald-500 px-3 py-2 text-xs font-bold text-black">{t('organisation.create')}</button></form><div className="mt-3 space-y-2">{(tab==='departments'?departments:tab==='teams'?teams:jobTitles).map((item)=><article key={item.id} className="flex items-center justify-between gap-3 rounded border border-emerald-500/15 p-3"><span className="font-medium text-neutral-900 dark:text-emerald-50">{item.name}</span><button type="button" onClick={()=>archive(tab==='titles'?'job-titles':tab,item.id)} className="text-xs font-bold text-red-600 dark:text-red-300">{t('organisation.archive')}</button></article>)}</div></section>}
  </section>;
}
