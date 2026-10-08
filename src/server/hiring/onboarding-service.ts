import type { PoolClient } from 'pg';
import { resolveScopedPermission } from '../organisation/scoped-permissions';
import { validateTemplate, type TemplateTask } from '../../lib/hiring-depth';
export type HiringActor = {
    tenantId: string;
    employeeId: string;
};
export const hiringError = (message: string, statusCode = 400): never => { throw Object.assign(Error(message), { statusCode }); };
export async function requireHiring(c: PoolClient, u: HiringActor, key: string) { if (!(await resolveScopedPermission(c, { tenantId: u.tenantId, actorEmployeeId: u.employeeId, permissionKey: key })).allowed)
    hiringError('Permission required.', 403); }
export async function applyOnboardingTemplate(c: PoolClient, u: HiringActor, employeeId: string, templateId: string) {
    await requireHiring(c, u, 'hiring.onboarding.manage');
    const hire = (await c.query('SELECT e.id,e.employment_start_date FROM employees e JOIN hiring_applicants a ON a.tenant_id=e.tenant_id AND a.hired_employee_id=e.id WHERE e.tenant_id=$1 AND e.id=$2 FOR UPDATE OF e', [u.tenantId, employeeId])).rows[0];
    if (!hire)
        hiringError('New hire unavailable.', 404);
    const template = (await c.query('SELECT tasks FROM hiring_onboarding_templates WHERE tenant_id=$1 AND id=$2', [u.tenantId, templateId])).rows[0];
    if (!template)
        hiringError('Template unavailable.', 404);
    if (!(await c.query('INSERT INTO hiring_onboarding_template_applications(tenant_id,employee_id,template_id,applied_by) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING employee_id', [u.tenantId, employeeId, templateId, u.employeeId])).rowCount)
        return { applied: false };
    const ids = new Map<string, string>();
    for (const task of validateTemplate(template.tasks)) {
        const row = (await c.query('INSERT INTO hiring_onboarding_tasks(tenant_id,employee_id,title,kind,due_on,dependency_id,template_id) VALUES($1,$2,$3,$4,$5::date+$6::int,$7,$8) ON CONFLICT(tenant_id,employee_id,title) DO NOTHING RETURNING id', [u.tenantId, employeeId, task.title, task.kind, hire.employment_start_date, task.dueOffsetDays, task.dependsOn ? ids.get(task.dependsOn) : null, templateId])).rows[0];
        const id = row?.id || (await c.query('SELECT id FROM hiring_onboarding_tasks WHERE tenant_id=$1 AND employee_id=$2 AND title=$3', [u.tenantId, employeeId, task.title])).rows[0].id;
        ids.set(task.key, id);
    }
    return { applied: true };
}
export async function defaultOnboarding(c: PoolClient, tenantId: string, employeeId: string, startDate: string) { const tasks: TemplateTask[] = [{ key: 'access', title: 'Provision account/access', kind: 'access', dueOffsetDays: 0 }, { key: 'equipment', title: 'Arrange equipment', kind: 'equipment', dueOffsetDays: 0 }, { key: 'policy', title: 'Acknowledge company policies', kind: 'policy', dueOffsetDays: 0 }, { key: 'first_shift', title: 'Plan first shift', kind: 'first_shift', dueOffsetDays: 0 }, { key: 'badge', title: 'Review digital badge', kind: 'badge', dueOffsetDays: 0 }]; for (const t of tasks)
    await c.query('INSERT INTO hiring_onboarding_tasks(tenant_id,employee_id,title,kind,due_on) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [tenantId, employeeId, t.title, t.kind, startDate]); }
export async function onboardingReadiness(c: PoolClient, u: HiringActor, filter: {
    employeeId?: string;
    state?: string;
    kind?: string;
    overdue?: boolean;
    from?: string;
    to?: string;
    missingLaptop?: boolean;
    missingShift?: boolean;
    incomplete?: boolean;
} = {}) {
    await requireHiring(c, u, 'hiring.onboarding.view');
    if (filter.missingLaptop)
        await requireHiring(c, u, 'assets.view');
    if (filter.missingShift)
        await requireHiring(c, u, 'roster.view_all');
    const rows = (await c.query(`WITH hires AS (SELECT e.id,e.full_name,e.employment_start_date,a.id candidate_id,a.stage FROM employees e JOIN hiring_applicants a ON a.tenant_id=e.tenant_id AND a.hired_employee_id=e.id WHERE e.tenant_id=$1 AND ($2::uuid IS NULL OR e.id=$2) AND ($3::date IS NULL OR e.employment_start_date>=$3) AND ($4::date IS NULL OR e.employment_start_date<$4)), task_state AS(SELECT h.*,COALESCE(jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'kind',t.kind,'status',t.status,'ownerId',t.owner_id,'dueOn',t.due_on,'notes',t.notes,'dependencyId',t.dependency_id,'completedAt',t.completed_at) ORDER BY t.due_on NULLS LAST,t.title) FILTER(WHERE t.id IS NOT NULL),'[]') tasks,CASE WHEN bool_or(t.status='blocked') THEN 'blocked' WHEN count(t.id)=0 OR bool_or(t.status<>'completed') THEN 'needs_attention' ELSE 'ready' END readiness FROM hires h LEFT JOIN hiring_onboarding_tasks t ON t.tenant_id=$1 AND t.employee_id=h.id GROUP BY h.id,h.full_name,h.employment_start_date,h.candidate_id,h.stage) SELECT *,count(*) OVER()::int total FROM task_state s WHERE ($5::text IS NULL OR readiness=$5) AND ($6::text IS NULL OR EXISTS(SELECT 1 FROM hiring_onboarding_tasks t WHERE t.tenant_id=$1 AND t.employee_id=s.id AND t.kind=$6 AND t.status<>'completed')) AND ($7::boolean=false OR EXISTS(SELECT 1 FROM hiring_onboarding_tasks t WHERE t.tenant_id=$1 AND t.employee_id=s.id AND t.status<>'completed' AND t.due_on<current_date)) AND ($8::boolean=false OR NOT EXISTS(SELECT 1 FROM asset_assignments x JOIN assets a ON a.tenant_id=x.tenant_id AND a.id=x.asset_id WHERE x.tenant_id=$1 AND x.employee_id=s.id AND x.status='active' AND a.category='laptop')) AND ($9::boolean=false OR NOT EXISTS(SELECT 1 FROM roster_shifts rs WHERE rs.tenant_id=$1 AND rs.employee_id=s.id AND rs.status<>'cancelled' AND rs.start_time>=s.employment_start_date::timestamptz)) AND ($10::boolean=false OR readiness<>'ready') ORDER BY employment_start_date,id LIMIT 50`, [u.tenantId, filter.employeeId ?? null, filter.from ?? null, filter.to ?? null, filter.state ?? null, filter.kind ?? null, filter.overdue ?? false, filter.missingLaptop ?? false, filter.missingShift ?? false, filter.incomplete ?? false])).rows;
    return { hires: rows.map(r => ({ ...r, reasons: r.tasks.filter((t: any) => t.status !== 'completed').map((t: any) => t.title + ' · ' + t.status), ...(r.tasks.length ? {} : { reasons: ['No onboarding checklist configured'] }) })), total: rows[0]?.total ?? 0 };
}
