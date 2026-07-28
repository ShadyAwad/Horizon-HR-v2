import type { PoolClient } from 'pg';

export const HR_ADMIN_SYSTEM_KEY = 'hr_admin';
const FINAL_HR_ADMIN_ERROR = 'Another active HR Admin is required before removing this access.';

type EffectiveAdmin = {
  employeeId: string;
  legacyHrAdmin: boolean;
  assignmentIds: string[];
};

function finalAdminFailure() {
  return Object.assign(new Error(FINAL_HR_ADMIN_ERROR), {
    statusCode: 409,
    code: 'FINAL_HR_ADMIN_REQUIRED',
  });
}

/**
 * Every mutation that can remove or time-limit HR Admin authority takes this
 * tenant-scoped transaction lock before inspecting assignment rows. The row
 * lock protects the tenant when no HR Admin assignment exists; the advisory
 * lock gives all participating mutation paths one deterministic lock point.
 */
export async function lockFinalHrAdminAuthority(client: PoolClient, tenantId: string) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext('stanza-final-hr-admin'))`, [tenantId]);
  await client.query(`SELECT id FROM tenants WHERE id=$1 FOR UPDATE`, [tenantId]);
}

async function lockHrAdminAssignments(client: PoolClient, tenantId: string) {
  await client.query(
    `SELECT assignment.id
     FROM employee_role_assignments assignment
     JOIN tenant_roles role
       ON role.tenant_id=assignment.tenant_id
      AND role.id=assignment.role_id
      AND role.system_key=$2
     WHERE assignment.tenant_id=$1 AND assignment.revoked_at IS NULL
     FOR UPDATE OF assignment`,
    [tenantId, HR_ADMIN_SYSTEM_KEY],
  );
}

async function effectiveHrAdminsAt(client: PoolClient, tenantId: string, at: Date): Promise<EffectiveAdmin[]> {
  // employees.role remains an authentication compatibility fallback. Count it
  // alongside effective system-role assignments until that legacy field is
  // retired, rather than treating an assignment revocation as authority loss
  // when the employee still has the same active legacy administrator role.
  const rows = await client.query<EffectiveAdmin>(
    `SELECT employee.id AS "employeeId",
            (employee.role='hr_admin') AS "legacyHrAdmin",
            COALESCE(array_remove(array_agg(assignment.id), NULL), ARRAY[]::uuid[]) AS "assignmentIds"
     FROM employees employee
     LEFT JOIN employee_role_assignments assignment
       ON assignment.tenant_id=employee.tenant_id
      AND assignment.employee_id=employee.id
      AND assignment.revoked_at IS NULL
      AND assignment.assigned_at <= $2
      AND (assignment.expires_at IS NULL OR assignment.expires_at > $2)
      AND EXISTS (
        SELECT 1 FROM tenant_roles role
        WHERE role.tenant_id=assignment.tenant_id
          AND role.id=assignment.role_id
          AND role.system_key=$3
          AND role.is_active=true
      )
     WHERE employee.tenant_id=$1
       AND employee.is_active=true
       AND employee.employment_status='active'
     GROUP BY employee.id
     HAVING employee.role='hr_admin' OR COUNT(assignment.id)>0`,
    [tenantId, at.toISOString(), HR_ADMIN_SYSTEM_KEY],
  );
  return rows.rows;
}

/**
 * Call after lockFinalHrAdminAuthority. Assignment rows are locked before the
 * effective count is recalculated, so two concurrent removals cannot both
 * decide that a different administrator remains.
 */
export async function assertHrAdminAssignmentsMayBeRevoked(
  client: PoolClient,
  tenantId: string,
  employeeId: string,
  assignmentIds: readonly string[],
) {
  if (assignmentIds.length === 0) return;
  await lockHrAdminAssignments(client, tenantId);
  const activeAdmins = await effectiveHrAdminsAt(client, tenantId, new Date());
  const target = activeAdmins.find((admin) => admin.employeeId === employeeId);
  if (!target) return;

  const revoked = new Set(assignmentIds);
  const remainsAdministrator = target.legacyHrAdmin || target.assignmentIds.some((id) => !revoked.has(id));
  if (!remainsAdministrator && activeAdmins.length <= 1) throw finalAdminFailure();
}

/**
 * An expiring or scheduled HR Admin assignment is only safe when the tenant
 * retains uninterrupted effective authority under the current UTC timeline.
 */
export async function assertHrAdminAssignmentTimingIsSafe(
  client: PoolClient,
  tenantId: string,
  startsAt: Date,
  expiresAt: Date | null,
) {
  await lockHrAdminAssignments(client, tenantId);
  const now = new Date();
  const currentAdmins = await effectiveHrAdminsAt(client, tenantId, now);
  if (startsAt > now && currentAdmins.length === 0) throw finalAdminFailure();

  if (startsAt > now) {
    const administratorsAtStart = await effectiveHrAdminsAt(client, tenantId, startsAt);
    // The new assignment is effective at startsAt. This check covers the time
    // immediately before it and rejects a scheduled replacement with a gap.
    if (administratorsAtStart.length === 0) throw finalAdminFailure();
  }

  if (expiresAt) {
    const administratorsAfterExpiry = await effectiveHrAdminsAt(client, tenantId, expiresAt);
    if (administratorsAfterExpiry.length === 0) throw finalAdminFailure();
  }
}
