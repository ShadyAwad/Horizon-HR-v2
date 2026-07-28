import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { useLanguage } from '../../lib/LanguageContext';

type Employee = { employeeId: string; displayName: string; jobTitle: string | null; departmentId: string | null; teamId: string | null; managerId: string | null; directReportCount: number };
type Team = { id: string; name: string; leaderName: string | null; locationName: string | null; memberCount: number; members: Employee[] };
type Department = { id: string; name: string; headName: string | null; children: Department[]; teams: Team[] };
type Hierarchy = { company: { name: string }; departments: Department[]; unassignedEmployees: Employee[]; warnings: Array<{ code: string; message: string }>; };

export function HierarchyPanel() {
  const { lang, isRtl } = useLanguage();
  const tr = (en: string, ar: string) => lang === 'ar' ? ar : en;
  const [data, setData] = useState<Hierarchy | null>(null);
  const [view, setView] = useState<'structure' | 'reporting' | 'unassigned' | 'warnings'>('structure');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['company']));
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const response = await apiFetch(`/api/hr/organisation/hierarchy?search=${encodeURIComponent(search)}&includeUnassigned=true`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Unable to load hierarchy.');
      setData(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load hierarchy.');
    }
  }, [search]);

  useEffect(() => { void load(); }, [load]);
  const toggle = (id: string) => setExpanded(current => {
    const next = new Set(current);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const Node = ({ id, label, level, children }: { id: string; label: string; level: number; children?: ReactNode }) => {
    const open = expanded.has(id);
    const hasChildren = Boolean(children);
    return <li role="treeitem" aria-level={level} aria-expanded={hasChildren ? open : undefined}>
      <button
        type="button"
        onClick={() => hasChildren && toggle(id)}
        onKeyDown={event => {
          if (event.key === 'ArrowRight' && hasChildren) setExpanded(current => new Set(current).add(id));
          if (event.key === 'ArrowLeft' && hasChildren) setExpanded(current => { const next = new Set(current); next.delete(id); return next; });
        }}
        className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm font-semibold outline-none hover:bg-emerald-500/10 focus-visible:ring-2 focus-visible:ring-emerald-500"
      >
        {hasChildren ? open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" /> : <span className="w-4" />}
        {label}
      </button>
      {hasChildren && open && <ul role="group" className="ms-4 border-s border-emerald-500/20 ps-2">{children}</ul>}
    </li>;
  };

  const renderDepartment = (department: Department, level: number): ReactNode => {
    const departmentLabel = department.headName
      ? `${department.name} - ${department.headName}`
      : `${department.name} - ${tr('No department head', 'لا يوجد رئيس قسم')}`;
    return <Node key={department.id} id={`department:${department.id}`} level={level} label={departmentLabel}>
    {department.teams.map(team => <Node key={team.id} id={`team:${team.id}`} level={level + 1} label={`${team.name} - ${team.memberCount} ${tr('members', 'أعضاء')}${team.locationName ? ` - ${team.locationName}` : ''}`}>
      {team.members.map(employee => <li role="treeitem" aria-level={level + 2} key={employee.employeeId} className="rounded px-2 py-1 text-sm text-neutral-600 dark:text-emerald-100/70">{employee.displayName} - {employee.jobTitle || tr('No job title', 'بدون مسمى وظيفي')}</li>)}
    </Node>)}
    {department.children.map(child => renderDepartment(child, level + 1))}
    </Node>;
  };

  const allEmployees = (data?.departments || []).flatMap(department => department.teams.flatMap(team => team.members));
  const roots = allEmployees.filter(employee => !employee.managerId || !allEmployees.some(candidate => candidate.employeeId === employee.managerId));
  const renderReportingBranch = (employee: Employee, visited = new Set<string>()): ReactNode => {
    if (visited.has(employee.employeeId)) return null;
    const nextVisited = new Set(visited).add(employee.employeeId);
    const reports = allEmployees.filter(candidate => candidate.managerId === employee.employeeId && !nextVisited.has(candidate.employeeId));
    return <li key={employee.employeeId} className="rounded border border-emerald-500/15 p-3"><p className="font-bold">{employee.displayName}</p><p className="text-xs text-neutral-500">{employee.jobTitle || tr('No job title', 'بدون مسمى وظيفي')} - {employee.directReportCount} {tr('direct reports', 'تقارير مباشرة')}</p>{reports.length > 0 && <ul className="mt-2 space-y-2 border-s border-emerald-500/20 ps-3">{reports.map(report => renderReportingBranch(report, nextVisited))}</ul>}</li>;
  };
  const labels: Record<typeof view, [string, string]> = { structure: ['Structure', 'الهيكل'], reporting: ['Reporting Lines', 'خطوط الإدارة'], unassigned: ['Unassigned People', 'غير المعيّنين'], warnings: ['Warnings', 'التحذيرات'] };

  return <section dir={isRtl ? 'rtl' : 'ltr'} className="mt-4 min-w-0 space-y-4 rounded-lg border border-emerald-500/15 bg-emerald-500/[0.03] p-3">
    <div className="flex flex-wrap gap-2">{(Object.keys(labels) as Array<typeof view>).map(item => <button key={item} type="button" onClick={() => setView(item)} className={view === item ? 'rounded bg-emerald-500 px-3 py-2 text-xs font-bold text-black' : 'rounded border border-emerald-500/20 px-3 py-2 text-xs'}>{tr(...labels[item])}</button>)}</div>
    <label className="block text-sm font-medium">{tr('Search hierarchy', 'البحث في الهيكل')}<input value={search} onChange={event => setSearch(event.target.value)} className="mt-1 w-full rounded border border-emerald-500/20 bg-white p-2 dark:bg-black/20" /></label>
    {error && <p role="alert" className="rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700">{error}<button type="button" onClick={() => void load()} className="ms-2 underline">{tr('Retry', 'إعادة المحاولة')}</button></p>}
    {!data ? <p className="text-sm text-neutral-500">{tr('Loading hierarchy...', 'جارٍ تحميل الهيكل...')}</p> : view === 'structure' ? <ul role="tree" aria-label={tr('Organisational structure', 'الهيكل التنظيمي')} className="space-y-1"><Node id="company" level={1} label={data.company?.name || tr('Company', 'الشركة')}>{data.departments.map(department => renderDepartment(department, 2))}</Node></ul> : view === 'reporting' ? <ul className="space-y-2">{roots.map(employee => renderReportingBranch(employee))}</ul> : view === 'unassigned' ? <div className="space-y-2">{data.unassignedEmployees.map(employee => <article key={employee.employeeId} className="rounded border border-amber-500/25 p-3"><p className="font-medium">{employee.displayName}</p><p className="text-xs text-neutral-500">{[!employee.departmentId && tr('no department', 'لا قسم'), !employee.teamId && tr('no team', 'لا فريق'), !employee.jobTitle && tr('no job title', 'لا مسمى'), !employee.managerId && tr('no manager', 'لا مدير')].filter(Boolean).join(' - ')}</p></article>)}{!data.unassignedEmployees.length && <p className="text-sm text-neutral-500">{tr('Everyone has a complete placement.', 'لدى الجميع تعيين مكتمل.')}</p>}</div> : <div className="space-y-2">{data.warnings.map((warning, index) => <div key={`${warning.code}-${index}`} className="flex gap-2 rounded border border-amber-500/25 bg-amber-500/10 p-3 text-sm"><AlertTriangle className="h-4 w-4 shrink-0" />{warning.message}</div>)}{!data.warnings.length && <p className="text-sm text-neutral-500">{tr('No hierarchy warnings.', 'لا توجد تحذيرات.')}</p>}</div>}
  </section>;
}
