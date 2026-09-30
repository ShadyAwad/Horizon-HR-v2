import type { PoolClient } from 'pg';
import { resolveScopedPermission } from '../organisation/scoped-permissions';
import { caseFail } from '../../lib/grievance-contract';
export type CaseActor = {
    tenantId: string;
    employeeId: string;
};
export type CaseRow = Record<string, any>;
// The SQL projection uses the existing assignments/delegations and organisation scopes.
// Keep one predicate for inbox, details, badges, candidates and every mutation.
export function casePermissionSql(keys: readonly string[], alias = 'g', actor = '$2') {
    const safe = keys.map(k => `'${k}'`).join(',');
    return `EXISTS(SELECT 1 FROM (
 SELECT a.scope_type,a.scope_id FROM employee_role_assignments a JOIN tenant_role_permissions p ON p.tenant_id=a.tenant_id AND p.role_id=a.role_id WHERE a.tenant_id=${alias}.tenant_id AND a.employee_id=${actor} AND p.permission_key IN (${safe}) AND a.revoked_at IS NULL AND a.assigned_at<=now() AND (a.expires_at IS NULL OR a.expires_at>now())
 UNION ALL SELECT d.scope_type,d.scope_id FROM permission_delegations d WHERE d.tenant_id=${alias}.tenant_id AND d.granted_to_employee_id=${actor} AND d.permission_key IN (${safe}) AND d.status='active' AND d.revoked_at IS NULL AND d.starts_at<=now() AND d.expires_at>now()
 ) authority WHERE authority.scope_type='company'
 OR (authority.scope_type='department' AND authority.scope_id=COALESCE(${alias}.assigned_department_id,${alias}.destination_department_id))
 OR (authority.scope_type='direct_reports' AND EXISTS(SELECT 1 FROM employees target WHERE target.tenant_id=${alias}.tenant_id AND target.id=${alias}.employee_id AND target.manager_id=${actor}))
 OR (authority.scope_type IN ('self','team','location') AND EXISTS(SELECT 1 FROM employees target LEFT JOIN organisation_teams team ON team.tenant_id=target.tenant_id AND team.id=target.team_id WHERE target.tenant_id=${alias}.tenant_id AND target.id=${alias}.employee_id AND ((authority.scope_type='self' AND target.id=${actor}) OR (authority.scope_type='location' AND team.location_id=authority.scope_id) OR (authority.scope_type='team' AND (target.team_id=authority.scope_id OR EXISTS(SELECT 1 FROM organisation_team_memberships m WHERE m.tenant_id=target.tenant_id AND m.employee_id=target.id AND m.team_id=authority.scope_id AND (m.ends_at IS NULL OR m.ends_at>=CURRENT_DATE))))))))`;
}
export const handlerVisibilitySql = (alias = 'g', actor = '$2') => `${alias}.employee_id<>${actor} AND ${casePermissionSql(['grievances.view', 'grievances.review'], alias, actor)} AND (${alias}.confidentiality='standard' OR ${casePermissionSql(['grievances.confidential'], alias, actor)})`;
export async function activeCaseActor(c: PoolClient, u: CaseActor) { if (!(await c.query("SELECT 1 FROM employees WHERE tenant_id=$1 AND id=$2 AND is_active AND employment_status='active'", [u.tenantId, u.employeeId])).rowCount)
    throw caseFail(403, 'INACTIVE_ACCOUNT', 'An active employee account is required.'); }
export async function caseAccess(c: PoolClient, u: CaseActor, id: string, lock = false) {
    const row = (await c.query(`SELECT g.*,g.employee_id=$2 AS owner,(${handlerVisibilitySql()}) AS handler FROM grievances g WHERE g.tenant_id=$1 AND g.id=$3 ${lock ? 'FOR UPDATE' : ''}`, [u.tenantId, u.employeeId, id])).rows[0];
    if (row?.owner) {
        let allowed = false;
        for (const permissionKey of ['grievances.view_own', 'grievances.create']) {
            if ((await resolveScopedPermission(c, { tenantId: u.tenantId, actorEmployeeId: u.employeeId, permissionKey, targetEmployeeId: u.employeeId })).allowed) {
                allowed = true;
                break;
            }
        }
        if (!allowed)
            throw caseFail(404, 'CASE_UNAVAILABLE', 'Case unavailable.');
    }
    if (!row || (!row.owner && !row.handler))
        throw caseFail(404, 'CASE_UNAVAILABLE', 'Case unavailable.');
    return row as CaseRow;
}
export async function caseAction(c: PoolClient, u: CaseActor, row: CaseRow, key: string) { if (!row.handler || !(await c.query(`SELECT 1 FROM grievances g WHERE g.tenant_id=$1 AND g.id=$3 AND ${casePermissionSql([key])}`, [u.tenantId, u.employeeId, row.id])).rowCount)
    throw caseFail(403, 'CASE_PERMISSION_DENIED', 'You do not have permission for this case action.'); }
export function publicCase(row: CaseRow, handler = false) { const keys = ['id', 'case_number', 'title', 'description', 'category', 'priority', 'confidentiality', 'status', 'created_at', 'updated_at', 'resolved_at', 'closed_at', 'version', 'destination_department_id', 'destination_name', 'resolution_summary']; if (handler)
    keys.push('employee_id', 'assigned_to', 'assigned_department_id', 'resolved_by', 'reporter_name', 'department_name', 'assigned_to_name'); return Object.fromEntries(keys.map(k => [k, row[k]])); }
