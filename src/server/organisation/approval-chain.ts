import type { PoolClient } from 'pg';
import { resolveScopedPermission, type OrganisationScopeType } from './scoped-permissions';

export type ApprovalSource = 'direct_manager' | 'team_leader' | 'department_head' | 'reporting_chain' | 'scoped_role' | 'delegation' | 'hr_admin';
export type ApprovalResolution = {
  found: boolean;
  approverEmployeeId: string | null;
  source: ApprovalSource | null;
  resolvedScopeType: OrganisationScopeType | null;
  resolvedScopeId: string | null;
  authoritySourceId: string | null;
  message?: string;
};
export type ApprovalInput = {
  tenantId: string;
  requestingEmployeeId: string;
  requiredPermissionKey: string;
  targetTeamId?: string | null;
  targetDepartmentId?: string | null;
  targetLocationId?: string | null;
  excludedEmployeeIds?: string[];
};

const none = (): ApprovalResolution => ({ found: false, approverEmployeeId: null, source: null, resolvedScopeType: null, resolvedScopeId: null, authoritySourceId: null, message: 'No eligible approver configured.' });

async function activeCandidate(client: PoolClient, input: ApprovalInput, candidateId: string | null | undefined, source: ApprovalSource, seen: Set<string>): Promise<ApprovalResolution | null> {
  if (!candidateId || seen.has(candidateId) || candidateId === input.requestingEmployeeId || input.excludedEmployeeIds?.includes(candidateId)) return null;
  seen.add(candidateId);
  const active = (await client.query(`SELECT 1 FROM employees WHERE tenant_id=$1 AND id=$2 AND is_active=true AND employment_status='active'`, [input.tenantId, candidateId])).rows[0];
  if (!active) return null;
  const authority = await resolveScopedPermission(client, { tenantId: input.tenantId, actorEmployeeId: candidateId, permissionKey: input.requiredPermissionKey, targetEmployeeId: input.requestingEmployeeId });
  if (!authority.allowed) return null;
  return { found: true, approverEmployeeId: candidateId, source: authority.source === 'delegation' ? 'delegation' : source, resolvedScopeType: authority.resolvedScope?.type || null, resolvedScopeId: authority.resolvedScope?.id || null, authoritySourceId: authority.assignmentId };
}

/** Resolves candidates only; it never approves a workflow action. */
export async function resolveApprovalChain(client: PoolClient, input: ApprovalInput): Promise<ApprovalResolution> {
  const requester = (await client.query(`SELECT manager_id,team_id,department_id FROM employees WHERE tenant_id=$1 AND id=$2`, [input.tenantId, input.requestingEmployeeId])).rows[0];
  if (!requester) return none();
  const seen = new Set<string>();
  const direct = await activeCandidate(client, input, requester.manager_id, 'direct_manager', seen);
  if (direct) return direct;
  const teamId = input.targetTeamId || requester.team_id;
  if (teamId) {
    const leader = (await client.query(`SELECT team_lead_id FROM organisation_teams WHERE tenant_id=$1 AND id=$2 AND is_active=true`, [input.tenantId, teamId])).rows[0]?.team_lead_id;
    const result = await activeCandidate(client, input, leader, 'team_leader', seen);
    if (result) return result;
  }
  const departmentId = input.targetDepartmentId || requester.department_id;
  if (departmentId) {
    const head = (await client.query(`SELECT department_head_id FROM organisation_departments WHERE tenant_id=$1 AND id=$2 AND is_active=true`, [input.tenantId, departmentId])).rows[0]?.department_head_id;
    const result = await activeCandidate(client, input, head, 'department_head', seen);
    if (result) return result;
  }
  let managerId = requester.manager_id as string | null;
  while (managerId && !seen.has(managerId)) {
    const next = (await client.query(`SELECT manager_id FROM employees WHERE tenant_id=$1 AND id=$2`, [input.tenantId, managerId])).rows[0];
    const result = await activeCandidate(client, input, managerId, 'reporting_chain', seen);
    if (result) return result;
    managerId = next?.manager_id || null;
  }
  const candidates = (await client.query(`SELECT DISTINCT employee_id FROM employee_role_assignments WHERE tenant_id=$1 AND revoked_at IS NULL AND assigned_at<=NOW() AND (expires_at IS NULL OR expires_at>NOW()) UNION SELECT DISTINCT granted_to_employee_id FROM permission_delegations WHERE tenant_id=$1 AND revoked_at IS NULL AND starts_at<=NOW() AND expires_at>NOW() ORDER BY employee_id`, [input.tenantId])).rows;
  for (const row of candidates) {
    const result = await activeCandidate(client, input, row.employee_id, 'scoped_role', seen);
    if (result) return result;
  }
  const admins = (await client.query(`SELECT DISTINCT assignment.employee_id FROM employee_role_assignments assignment JOIN tenant_roles role ON role.tenant_id=assignment.tenant_id AND role.id=assignment.role_id WHERE assignment.tenant_id=$1 AND role.system_key='hr_admin' AND assignment.revoked_at IS NULL AND assignment.assigned_at<=NOW() AND (assignment.expires_at IS NULL OR assignment.expires_at>NOW()) ORDER BY assignment.employee_id`, [input.tenantId])).rows;
  for (const row of admins) {
    const result = await activeCandidate(client, input, row.employee_id, 'hr_admin', seen);
    if (result) return { ...result, source: result.source === 'delegation' ? 'delegation' : 'hr_admin' };
  }
  return none();
}
