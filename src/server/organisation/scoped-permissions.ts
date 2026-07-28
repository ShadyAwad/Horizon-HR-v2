import type { PoolClient } from 'pg';

export const ORGANISATION_SCOPE_TYPES = ['company', 'location', 'department', 'team', 'direct_reports', 'self'] as const;
export type OrganisationScopeType = typeof ORGANISATION_SCOPE_TYPES[number];
export type PermissionAuthority = {
  allowed: boolean;
  source: 'role_assignment' | 'delegation' | null;
  permissionKey: string;
  resolvedScope: { type: OrganisationScopeType; id: string | null } | null;
  assignmentId: string | null;
};

type CandidateAuthority = {
  id: string;
  source: 'role_assignment' | 'delegation';
  scope_type: OrganisationScopeType;
  scope_id: string | null;
};

export type RequestedPermissionScope = { type: OrganisationScopeType; id: string | null };

const empty = (permissionKey: string): PermissionAuthority => ({ allowed: false, source: null, permissionKey, resolvedScope: null, assignmentId: null });

export function isOrganisationScope(value: unknown): value is OrganisationScopeType {
  return typeof value === 'string' && (ORGANISATION_SCOPE_TYPES as readonly string[]).includes(value);
}

export async function scopeContains(
  client: PoolClient,
  tenantId: string,
  actorEmployeeId: string,
  authority: RequestedPermissionScope,
  requested: RequestedPermissionScope,
  targetEmployeeId: string,
): Promise<boolean> {
  if (authority.type === 'company') return true;
  if (authority.type === 'self') return requested.type === 'self' && targetEmployeeId === actorEmployeeId;
  if (authority.type === 'direct_reports') {
    return requested.type === 'self' && Boolean((await client.query(
      `SELECT 1 FROM employees WHERE tenant_id=$1 AND id=$2 AND manager_id=$3 AND is_active=true AND employment_status='active'`,
      [tenantId, targetEmployeeId, actorEmployeeId],
    )).rows[0]);
  }
  if (authority.type === 'location') return requested.type === 'location' && authority.id === requested.id;
  if (authority.type === 'team') return requested.type === 'team' && authority.id === requested.id;
  if (requested.type === 'department' && authority.id === requested.id) return true;
  if (requested.type !== 'team' || !authority.id || !requested.id) return false;
  return Boolean((await client.query(
    `SELECT 1 FROM organisation_teams WHERE tenant_id=$1 AND id=$2 AND department_id=$3 AND is_active=true`,
    [tenantId, requested.id, authority.id],
  )).rows[0]);
}

export async function canDelegatePermissionAtScope(
  client: PoolClient,
  input: { tenantId: string; actorEmployeeId: string; permissionKey: string; requestedScope: RequestedPermissionScope; targetEmployeeId: string },
): Promise<boolean> {
  const candidates = await client.query<CandidateAuthority>(
    `SELECT assignment.id,'role_assignment'::text AS source,assignment.scope_type,assignment.scope_id
     FROM employee_role_assignments assignment
     JOIN tenant_role_permissions permission ON permission.tenant_id=assignment.tenant_id AND permission.role_id=assignment.role_id
     WHERE assignment.tenant_id=$1 AND assignment.employee_id=$2 AND permission.permission_key=$3
       AND assignment.revoked_at IS NULL AND assignment.assigned_at<=NOW()
       AND (assignment.expires_at IS NULL OR assignment.expires_at>NOW())`,
    [input.tenantId, input.actorEmployeeId, input.permissionKey],
  );
  for (const candidate of candidates.rows) {
    if (await scopeContains(client, input.tenantId, input.actorEmployeeId, { type: candidate.scope_type, id: candidate.scope_id }, input.requestedScope, input.targetEmployeeId)) return true;
  }
  return false;
}

async function scopeAllows(
  client: PoolClient,
  tenantId: string,
  actorEmployeeId: string,
  candidate: CandidateAuthority,
  targetEmployeeId?: string | null,
): Promise<boolean> {
  if (candidate.scope_type === 'company') return true;
  if (!targetEmployeeId) return false;
  if (candidate.scope_type === 'self') return targetEmployeeId === actorEmployeeId;
  if (candidate.scope_type === 'direct_reports') {
    return Boolean((await client.query(
      `SELECT 1 FROM employees WHERE tenant_id=$1 AND id=$2 AND manager_id=$3`,
      [tenantId, targetEmployeeId, actorEmployeeId],
    )).rows[0]);
  }

  if (!candidate.scope_id) return false;
  if (candidate.scope_type === 'department') {
    return Boolean((await client.query(
      `SELECT 1 FROM employees WHERE tenant_id=$1 AND id=$2 AND department_id=$3`,
      [tenantId, targetEmployeeId, candidate.scope_id],
    )).rows[0]);
  }
  if (candidate.scope_type === 'team') {
    return Boolean((await client.query(
      `SELECT 1 FROM employees employee
       WHERE employee.tenant_id=$1 AND employee.id=$2 AND (
         employee.team_id=$3 OR EXISTS (
           SELECT 1 FROM organisation_team_memberships membership
           WHERE membership.tenant_id=employee.tenant_id AND membership.employee_id=employee.id
             AND membership.team_id=$3 AND (membership.ends_at IS NULL OR membership.ends_at>=CURRENT_DATE)
         )
       )`,
      [tenantId, targetEmployeeId, candidate.scope_id],
    )).rows[0]);
  }
  return Boolean((await client.query(
    `SELECT 1 FROM employees employee
     LEFT JOIN organisation_teams team ON team.tenant_id=employee.tenant_id AND team.id=employee.team_id
     WHERE employee.tenant_id=$1 AND employee.id=$2 AND team.location_id=$3`,
    [tenantId, targetEmployeeId, candidate.scope_id],
  )).rows[0]);
}

/**
 * Resolves a permission decision with an auditable authority source. Callers must
 * pass a server-validated target employee when the action concerns another person.
 */
export async function resolveScopedPermission(
  client: PoolClient,
  input: { tenantId: string; actorEmployeeId: string; permissionKey: string; targetEmployeeId?: string | null },
): Promise<PermissionAuthority> {
  const assignments = await client.query<CandidateAuthority>(
    `SELECT assignment.id,'role_assignment'::text AS source,assignment.scope_type,assignment.scope_id
     FROM employee_role_assignments assignment
     JOIN tenant_role_permissions permission
       ON permission.tenant_id=assignment.tenant_id AND permission.role_id=assignment.role_id
     WHERE assignment.tenant_id=$1 AND assignment.employee_id=$2 AND permission.permission_key=$3
       AND assignment.revoked_at IS NULL AND assignment.assigned_at<=NOW() AND (assignment.expires_at IS NULL OR assignment.expires_at>NOW())
     UNION ALL
     SELECT delegation.id,'delegation'::text AS source,delegation.scope_type,delegation.scope_id
     FROM permission_delegations delegation
     WHERE delegation.tenant_id=$1 AND delegation.granted_to_employee_id=$2 AND delegation.permission_key=$3
       AND delegation.status='active' AND delegation.revoked_at IS NULL
       AND delegation.starts_at<=NOW() AND delegation.expires_at>NOW()
     ORDER BY source`,
    [input.tenantId, input.actorEmployeeId, input.permissionKey],
  );

  for (const candidate of assignments.rows) {
    if (await scopeAllows(client, input.tenantId, input.actorEmployeeId, candidate, input.targetEmployeeId)) {
      return {
        allowed: true,
        source: candidate.source,
        permissionKey: input.permissionKey,
        resolvedScope: { type: candidate.scope_type, id: candidate.scope_id },
        assignmentId: candidate.id,
      };
    }
  }
  return empty(input.permissionKey);
}

export async function hasCompanyPermission(client: PoolClient, tenantId: string, employeeId: string, permissionKey: string) {
  return resolveScopedPermission(client, { tenantId, actorEmployeeId: employeeId, permissionKey });
}
