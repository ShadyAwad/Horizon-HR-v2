import { logServerError } from '../../lib/server-logging';
import type express from 'express';
import { getDbPool, hasDatabaseConfig, withTenant } from '../../lib/hr-background';
import {
  assertHrAdminAssignmentTimingIsSafe,
  assertHrAdminAssignmentsMayBeRevoked,
  HR_ADMIN_SYSTEM_KEY,
  lockFinalHrAdminAuthority,
} from './final-hr-admin';
import { recordAuditEvent } from '../audit/audit-events';
import { hasPermissionClaim } from '../auth/permission-claims';
import { resolveScopedPermission } from './scoped-permissions';

type EmployeeRole = 'employee' | 'manager' | 'hr_admin';

type RoleRouteDependencies = {
  standardAuth: express.RequestHandler;
  requirePermission: (permission: string) => express.RequestHandler;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string | undefined) {
  return Boolean(value && uuidPattern.test(value));
}

function privilegeLevel(systemKey: string | null | undefined, permissions: string[] = []) {
  if (systemKey === 'hr_admin' || permissions.includes('roles.assign_privileged')) return 3;
  if (systemKey === 'manager' || permissions.includes('roles.manage')) return 2;
  return 1;
}

function isPrivilegedRole(systemKey: string | null | undefined, permissions: string[] = []) {
  return privilegeLevel(systemKey, permissions) >= 3;
}

export function registerLegacyRoleDiscoveryRoutes(
  app: express.Express,
  { standardAuth: demoAuth, requirePermission }: RoleRouteDependencies,
) {
  app.get(
    '/api/roles',
    demoAuth,
    requirePermission('roles.manage'),
    async (req, res) => {
      const tenantId = req.authUser!.tenantId;
  
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ success: false, error: 'DATABASE_URL is required for tenant roles' });
      }
  
      try {
        const roles = await withTenant(tenantId, async (client) => {
          const result = await client.query(
            `
              SELECT
                tenant_roles.id,
                tenant_roles.name,
                tenant_roles.description,
                tenant_roles.system_key,
                tenant_roles.is_system,
                tenant_roles.is_active,
                tenant_roles.created_at,
                tenant_roles.updated_at,
                COALESCE(
                  array_remove(array_agg(DISTINCT tenant_role_permissions.permission_key ORDER BY tenant_role_permissions.permission_key), NULL),
                  ARRAY[]::varchar[]
                ) AS permissions,
                COUNT(DISTINCT employee_role_assignments.employee_id)::int AS assigned_employee_count
              FROM tenant_roles
              LEFT JOIN tenant_role_permissions
                ON tenant_role_permissions.tenant_id = tenant_roles.tenant_id
               AND tenant_role_permissions.role_id = tenant_roles.id
              LEFT JOIN employee_role_assignments
                ON employee_role_assignments.tenant_id = tenant_roles.tenant_id
               AND employee_role_assignments.role_id = tenant_roles.id
              WHERE tenant_roles.tenant_id = $1
              GROUP BY tenant_roles.id
              ORDER BY tenant_roles.is_system DESC, tenant_roles.name ASC
            `,
            [tenantId],
          );
  
          return result.rows;
        });
  
        res.json({ success: true, roles });
      } catch (error) {
        logServerError('[Roles] Failed to load tenant roles:', error);
        res.status(500).json({ success: false, error: 'Unable to load tenant roles' });
      }
    },
  );
  
  app.get(
    '/api/permissions',
    demoAuth,
    requirePermission('roles.manage'),
    async (_req, res) => {
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ success: false, error: 'DATABASE_URL is required for permissions' });
      }
  
      try {
        const result = await getDbPool().query(
          `
            SELECT permission_key, label, description
            FROM tenant_permissions
            ORDER BY permission_key ASC
          `,
        );
  
        res.json({ success: true, permissions: result.rows });
      } catch (error) {
        logServerError('[Roles] Failed to load permissions:', error);
        res.status(500).json({ success: false, error: 'Unable to load permissions' });
      }
    },
  );
}

export function registerLegacyRoleMutationRoutes(
  app: express.Express,
  { standardAuth: demoAuth, requirePermission }: RoleRouteDependencies,
) {
  app.post(
    '/api/roles',
    demoAuth,
    requirePermission('roles.manage'),
    async (req, res) => {
      const tenantId = req.authUser!.tenantId;
      const actorEmployeeId = req.authUser!.employeeId;
      const { name, description, permissionKeys = [] } = req.body as {
        name?: string;
        description?: string;
        permissionKeys?: string[];
      };
      const normalizedName = name?.trim() || '';
      const normalizedDescription = description?.trim() || null;
      const normalizedPermissionKeys = [...new Set(Array.isArray(permissionKeys) ? permissionKeys : [])];
  
      if (!normalizedName || normalizedName.length > 100) {
        return res.status(400).json({ success: false, error: 'name is required and must be 100 characters or fewer.' });
      }
  
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ success: false, error: 'DATABASE_URL is required for tenant roles' });
      }
  
      try {
        const role = await withTenant(tenantId, async (client) => {
          await client.query('BEGIN');
          try {
            const permissionsResult = await client.query<{ permission_key: string }>(
              `
                SELECT permission_key
                FROM tenant_permissions
                WHERE permission_key = ANY($1::varchar[])
              `,
              [normalizedPermissionKeys],
            );
            const validPermissionKeys = permissionsResult.rows.map((row) => row.permission_key);
  
            if (validPermissionKeys.length !== normalizedPermissionKeys.length) {
              throw Object.assign(new Error('One or more permission keys are invalid.'), { statusCode: 400 });
            }
  
            const roleResult = await client.query(
              `
                INSERT INTO tenant_roles (tenant_id, name, description, is_system)
                VALUES ($1, $2::varchar, $3::text, false)
                RETURNING id, name, description, system_key, is_system, is_active, created_at, updated_at
              `,
              [tenantId, normalizedName, normalizedDescription],
            );
  
            const createdRole = roleResult.rows[0];
  
            if (validPermissionKeys.length > 0) {
              await client.query(
                `
                  INSERT INTO tenant_role_permissions (tenant_id, role_id, permission_key)
                  SELECT $1, $2, tenant_permissions.permission_key
                  FROM tenant_permissions
                  WHERE tenant_permissions.permission_key = ANY($3::varchar[])
                  ON CONFLICT (tenant_id, role_id, permission_key) DO NOTHING
                `,
                [tenantId, createdRole.id, validPermissionKeys],
              );
            }
  
            await client.query(
              `
                INSERT INTO audit_logs (tenant_id, actor_employee_id, action, entity_type, entity_id, metadata)
                VALUES ($1, $2, $3, $4, $5, $6::jsonb)
              `,
              [
                tenantId,
                actorEmployeeId,
                'tenant_role_created',
                'tenant_role',
                createdRole.id,
                JSON.stringify({ name: normalizedName, permissionKeys: validPermissionKeys }),
              ],
            );
  
            await client.query(
              `UPDATE auth_sessions SET revoked_at = NOW()
               WHERE tenant_id = $1 AND revoked_at IS NULL`,
              [tenantId],
            );
  
            await client.query('COMMIT');
            return { ...createdRole, permissions: validPermissionKeys };
          } catch (error) {
            await client.query('ROLLBACK');
            throw error;
          }
        });
  
        res.status(201).json({ success: true, role });
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 400) {
          return res.status(400).json({ success: false, error: (error as Error).message });
        }
        if ((error as { code?: string }).code === '23505') {
          return res.status(409).json({ success: false, error: 'A role with this name already exists.' });
        }
  
        logServerError('[Roles] Failed to create role:', error);
        res.status(500).json({ success: false, error: 'Unable to create role' });
      }
    },
  );
  
  app.put(
    '/api/roles/:id/permissions',
    demoAuth,
    requirePermission('roles.manage'),
    async (req, res) => {
      const tenantId = req.authUser!.tenantId;
      const actorEmployeeId = req.authUser!.employeeId;
      const { id } = req.params;
      const { permissionKeys = [] } = req.body as { permissionKeys?: string[] };
      const normalizedPermissionKeys = [...new Set(Array.isArray(permissionKeys) ? permissionKeys : [])];
  
      if (normalizedPermissionKeys.includes('roles.assign_privileged') && !hasPermissionClaim(req.authUser!, 'roles.assign_privileged')) {
        return res.status(403).json({ success: false, error: 'Privileged permission assignment requires an authorized administrator.' });
      }
  
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ success: false, error: 'DATABASE_URL is required for tenant roles' });
      }
  
      try {
        const role = await withTenant(tenantId, async (client) => {
          await client.query('BEGIN');
          try {
            const roleResult = await client.query<{ id: string; name: string; is_system: boolean }>(
              `
                SELECT id, name, is_system
                FROM tenant_roles
                WHERE tenant_id = $1
                  AND id = $2
                LIMIT 1
              `,
              [tenantId, id],
            );
            const tenantRole = roleResult.rows[0];
            if (!tenantRole) return null;
            if (tenantRole.is_system) {
              throw Object.assign(new Error('System roles cannot be edited in this foundation version.'), { statusCode: 400 });
            }
  
            const permissionsResult = await client.query<{ permission_key: string }>(
              `
                SELECT permission_key
                FROM tenant_permissions
                WHERE permission_key = ANY($1::varchar[])
              `,
              [normalizedPermissionKeys],
            );
            const validPermissionKeys = permissionsResult.rows.map((row) => row.permission_key);
            if (validPermissionKeys.length !== normalizedPermissionKeys.length) {
              throw Object.assign(new Error('One or more permission keys are invalid.'), { statusCode: 400 });
            }
  
            await client.query(
              `
                DELETE FROM tenant_role_permissions
                WHERE tenant_id = $1
                  AND role_id = $2
              `,
              [tenantId, id],
            );
  
            if (validPermissionKeys.length > 0) {
              await client.query(
                `
                  INSERT INTO tenant_role_permissions (tenant_id, role_id, permission_key)
                  SELECT $1, $2, tenant_permissions.permission_key
                  FROM tenant_permissions
                  WHERE tenant_permissions.permission_key = ANY($3::varchar[])
                `,
                [tenantId, id, validPermissionKeys],
              );
            }
  
            await client.query(
              `
                INSERT INTO audit_logs (tenant_id, actor_employee_id, action, entity_type, entity_id, metadata)
                VALUES ($1, $2, $3, $4, $5, $6::jsonb)
              `,
              [
                tenantId,
                actorEmployeeId,
                'tenant_role_permissions_updated',
                'tenant_role',
                id,
                JSON.stringify({ permissionKeys: validPermissionKeys }),
              ],
            );
  
            await client.query('COMMIT');
            return { ...tenantRole, permissions: validPermissionKeys };
          } catch (error) {
            await client.query('ROLLBACK');
            throw error;
          }
        });
  
        if (!role) {
          return res.status(404).json({ success: false, error: 'Tenant role not found.' });
        }
  
        res.json({ success: true, role });
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 400) {
          return res.status(400).json({ success: false, error: (error as Error).message });
        }
  
        logServerError('[Roles] Failed to update role permissions:', error);
        res.status(500).json({ success: false, error: 'Unable to update role permissions' });
      }
    },
  );
  
  app.get(
    '/api/employees/role-assignments',
    demoAuth,
    requirePermission('roles.manage'),
    async (req, res) => {
      const tenantId = req.authUser!.tenantId;
  
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ success: false, error: 'DATABASE_URL is required for role assignments' });
      }
  
      try {
        const employees = await withTenant(tenantId, async (client) => {
          const result = await client.query(
            `
              SELECT
                employees.id,
                employees.email,
                employees.full_name,
                employees.role,
                employees.job_title,
                COALESCE(
                  json_agg(
                    DISTINCT jsonb_build_object(
                      'id', tenant_roles.id,
                      'name', tenant_roles.name,
                      'systemKey', tenant_roles.system_key
                    )
                  ) FILTER (WHERE tenant_roles.id IS NOT NULL),
                  '[]'::json
                ) AS assigned_roles
              FROM employees
              LEFT JOIN employee_role_assignments
                ON employee_role_assignments.tenant_id = employees.tenant_id
               AND employee_role_assignments.employee_id = employees.id
               AND employee_role_assignments.revoked_at IS NULL
               AND (employee_role_assignments.expires_at IS NULL OR employee_role_assignments.expires_at > NOW())
              LEFT JOIN tenant_roles
                ON tenant_roles.tenant_id = employees.tenant_id
               AND tenant_roles.id = employee_role_assignments.role_id
              WHERE employees.tenant_id = $1
              GROUP BY employees.id
              ORDER BY employees.full_name ASC, employees.email ASC
            `,
            [tenantId],
          );
  
          return result.rows;
        });
  
        res.json({ success: true, employees });
      } catch (error) {
        logServerError('[Roles] Failed to load role assignments:', error);
        res.status(500).json({ success: false, error: 'Unable to load role assignments' });
      }
    },
  );
  
  app.post(
    '/api/employees/:employeeId/roles',
    demoAuth,
    requirePermission('roles.manage'),
    async (req, res) => {
      const tenantId = req.authUser!.tenantId;
      const actorEmployeeId = req.authUser!.employeeId;
      const { employeeId } = req.params;
      const { roleId } = req.body as { roleId?: string };
  
      if (!roleId) {
        return res.status(400).json({ success: false, error: 'roleId is required.' });
      }
  
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ success: false, error: 'DATABASE_URL is required for role assignments' });
      }
  
      try {
        const assignment = await withTenant(tenantId, async (client) => {
          await lockFinalHrAdminAuthority(client, tenantId);
          const employeeResult = await client.query<{ id: string }>(
            `
              SELECT id
              FROM employees
              WHERE tenant_id = $1
                AND id = $2
              LIMIT 1
            `,
            [tenantId, employeeId],
          );
          if (!employeeResult.rows[0]) return null;
  
          const roleResult = await client.query<{ id: string; name: string; system_key: string | null; permissions: string[] }>(
            `
              SELECT tenant_roles.id, tenant_roles.name, tenant_roles.system_key,
                COALESCE(array_agg(DISTINCT tenant_role_permissions.permission_key)
                  FILTER (WHERE tenant_role_permissions.permission_key IS NOT NULL), ARRAY[]::varchar[]) AS permissions
              FROM tenant_roles
              LEFT JOIN tenant_role_permissions
                ON tenant_role_permissions.tenant_id = tenant_roles.tenant_id
               AND tenant_role_permissions.role_id = tenant_roles.id
              WHERE tenant_roles.tenant_id = $1
                AND tenant_roles.id = $2
                AND tenant_roles.is_active = true
              GROUP BY tenant_roles.id
              LIMIT 1
            `,
            [tenantId, roleId],
          );
          const tenantRole = roleResult.rows[0];
          if (!tenantRole) {
            throw Object.assign(new Error('Tenant role not found.'), { statusCode: 400 });
          }
  
          const actorLevel = privilegeLevel(req.authUser!.role, req.authUser!.permissions || []);
          const targetLevel = privilegeLevel(tenantRole.system_key, tenantRole.permissions);
          const privilegedTarget = isPrivilegedRole(tenantRole.system_key, tenantRole.permissions);
          if (tenantRole.system_key === 'hr_admin' && req.authUser!.role !== 'hr_admin') {
            throw Object.assign(new Error('Only an authorized tenant administrator may assign HR Admin.'), { statusCode: 403 });
          }
          if (targetLevel > actorLevel) {
            throw Object.assign(new Error('You cannot assign a role with greater privileges than your own.'), { statusCode: 403 });
          }
          if (employeeId === actorEmployeeId && targetLevel > actorLevel) {
            throw Object.assign(new Error('You cannot elevate your own privileges.'), { statusCode: 403 });
          }
          if (privilegedTarget && !hasPermissionClaim(req.authUser!, 'roles.assign_privileged')) {
            throw Object.assign(new Error('Privileged role assignment requires roles.assign_privileged.'), { statusCode: 403 });
          }
          if (tenantRole.system_key === HR_ADMIN_SYSTEM_KEY) {
            await assertHrAdminAssignmentTimingIsSafe(client, tenantId, new Date(), null);
          }
  
          // Existing role assignments are company-scoped. The organisation migration
          // uses a partial active-assignment uniqueness index so historical revoked
          // assignments do not block a later re-assignment.
          await client.query(
            `
              UPDATE employee_role_assignments
              SET revoked_at = COALESCE(revoked_at, expires_at),
                  revoked_by = COALESCE(revoked_by, $4)
              WHERE tenant_id = $1 AND employee_id = $2 AND role_id = $3
                AND revoked_at IS NULL AND expires_at IS NOT NULL AND expires_at <= NOW()
            `,
            [tenantId, employeeId, roleId, actorEmployeeId],
          );
  
          const insertResult = await client.query(
            `INSERT INTO employee_role_assignments (tenant_id, employee_id, role_id, assigned_by, scope_type)
             VALUES ($1, $2, $3, $4, 'company')
             ON CONFLICT DO NOTHING
             RETURNING id, employee_id, role_id, assigned_at`,
            [tenantId, employeeId, roleId, actorEmployeeId],
          );
  
          const assignment = insertResult.rows[0] || (await client.query(
            `SELECT id, employee_id, role_id, assigned_at
             FROM employee_role_assignments
             WHERE tenant_id=$1 AND employee_id=$2 AND role_id=$3
               AND scope_type='company' AND scope_id IS NULL AND revoked_at IS NULL
             LIMIT 1`,
            [tenantId, employeeId, roleId],
          )).rows[0];
  
          await recordAuditEvent(client, {
            tenantId,
            actorId: actorEmployeeId,
            action: privilegedTarget ? 'employee.role.privileged_assigned' : 'employee.role.assigned',
            targetType: 'employee',
            targetId: employeeId,
            metadata: {
              roleName: tenantRole.name,
              systemKey: tenantRole.system_key,
              privileged: privilegedTarget,
            },
          });
  
          await client.query(
            `UPDATE auth_sessions SET revoked_at = NOW()
             WHERE tenant_id = $1 AND employee_id = $2 AND revoked_at IS NULL`,
            [tenantId, employeeId],
          );
  
          return assignment;
        });
  
        if (!assignment) {
          return res.status(404).json({ success: false, error: 'Employee not found.' });
        }
  
        res.json({ success: true, assignment });
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 400 || statusCode === 403 || statusCode === 409) {
          return res.status(statusCode).json({ success: false, error: (error as Error).message });
        }
  
        logServerError('[Roles] Failed to assign role:', error);
        res.status(500).json({ success: false, error: 'Unable to assign role' });
      }
    },
  );
  
  app.delete(
    '/api/employees/:employeeId/roles/:roleId',
    demoAuth,
    requirePermission('roles.manage'),
    async (req, res) => {
      const tenantId = req.authUser!.tenantId;
      const actorEmployeeId = req.authUser!.employeeId;
      const { employeeId, roleId } = req.params;
  
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ success: false, error: 'DATABASE_URL is required for role assignments' });
      }
  
      try {
        const removed = await withTenant(tenantId, async (client) => {
          await lockFinalHrAdminAuthority(client, tenantId);
          const countResult = await client.query<{ assignment_count: string; fallback_role: EmployeeRole | null }>(
            `
              SELECT
                COUNT(employee_role_assignments.id) AS assignment_count,
                employees.role AS fallback_role
              FROM employees
              LEFT JOIN employee_role_assignments
                ON employee_role_assignments.tenant_id = employees.tenant_id
               AND employee_role_assignments.employee_id = employees.id
              WHERE employees.tenant_id = $1
                AND employees.id = $2
              GROUP BY employees.id
            `,
            [tenantId, employeeId],
          );
          const assignmentState = countResult.rows[0];
          if (!assignmentState) return null;
  
          if (Number(assignmentState.assignment_count) <= 1 && !assignmentState.fallback_role) {
            throw Object.assign(new Error('Cannot remove the final role assignment for this employee.'), { statusCode: 400 });
          }
  
          const roleResult = await client.query<{ name: string; system_key: string | null; permissions: string[] }>(
            `SELECT tenant_roles.name, tenant_roles.system_key,
               COALESCE(array_agg(DISTINCT tenant_role_permissions.permission_key)
                 FILTER (WHERE tenant_role_permissions.permission_key IS NOT NULL), ARRAY[]::varchar[]) AS permissions
             FROM tenant_roles
             LEFT JOIN tenant_role_permissions
               ON tenant_role_permissions.tenant_id = tenant_roles.tenant_id
              AND tenant_role_permissions.role_id = tenant_roles.id
             WHERE tenant_roles.tenant_id = $1 AND tenant_roles.id = $2
             GROUP BY tenant_roles.id`,
            [tenantId, roleId],
          );
          const tenantRole = roleResult.rows[0];
          const privilegedRemoval = Boolean(tenantRole && isPrivilegedRole(tenantRole.system_key, tenantRole.permissions));
          // HR Admin self-demotion is governed by the shared final-admin guard
          // below. Other privileged roles retain the existing stricter rule.
          if (privilegedRemoval && tenantRole?.system_key !== HR_ADMIN_SYSTEM_KEY && employeeId === actorEmployeeId) {
            throw Object.assign(new Error('You cannot remove your own privileged role.'), { statusCode: 403 });
          }
          if (privilegedRemoval && !hasPermissionClaim(req.authUser!, 'roles.assign_privileged')) {
            throw Object.assign(new Error('Privileged role removal requires roles.assign_privileged.'), { statusCode: 403 });
          }
          if (tenantRole?.system_key === HR_ADMIN_SYSTEM_KEY) {
            const activeAssignments = (await client.query<{ id: string }>(
              `SELECT assignment.id
               FROM employee_role_assignments assignment
               WHERE assignment.tenant_id=$1
                 AND assignment.employee_id=$2
                 AND assignment.role_id=$3
                 AND assignment.revoked_at IS NULL
                 AND assignment.assigned_at<=NOW()
                 AND (assignment.expires_at IS NULL OR assignment.expires_at>NOW())
               FOR UPDATE`,
              [tenantId, employeeId, roleId],
            )).rows.map((assignment) => assignment.id);
            await assertHrAdminAssignmentsMayBeRevoked(client, tenantId, employeeId, activeAssignments);
          }
  
          const deleteResult = await client.query<{ id: string }>(
            `
              UPDATE employee_role_assignments
              SET revoked_at = NOW(), revoked_by = $4
              WHERE tenant_id = $1
                AND employee_id = $2
                AND role_id = $3
                AND revoked_at IS NULL
              RETURNING id
            `,
            [tenantId, employeeId, roleId, actorEmployeeId],
          );
  
          if (!deleteResult.rows[0]) return null;
  
          await recordAuditEvent(client, {
            tenantId,
            actorId: actorEmployeeId,
            action: privilegedRemoval ? 'employee.role.privileged_removed' : 'employee.role.removed',
            targetType: 'employee',
            targetId: employeeId,
            metadata: {
              roleName: tenantRole?.name,
              systemKey: tenantRole?.system_key,
              privileged: privilegedRemoval,
            },
          });
  
          await client.query(
            `UPDATE auth_sessions SET revoked_at = NOW()
             WHERE tenant_id = $1 AND employee_id = $2 AND revoked_at IS NULL`,
            [tenantId, employeeId],
          );
  
          return deleteResult.rows[0];
        });
  
        if (!removed) {
          return res.status(404).json({ success: false, error: 'Role assignment not found.' });
        }
  
        res.json({ success: true, removed });
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 400 || statusCode === 403 || statusCode === 409) {
          return res.status(statusCode).json({ success: false, error: (error as Error).message });
        }
  
        logServerError('[Roles] Failed to remove role:', error);
        res.status(500).json({ success: false, error: 'Unable to remove role' });
      }
    },
  );
  
  app.patch(
    '/api/employees/:employeeId/title',
    demoAuth,
    requirePermission('roles.manage'),
    async (req, res) => {
      const tenantId = req.authUser!.tenantId;
      const actorEmployeeId = req.authUser!.employeeId;
      const { employeeId } = req.params;
      const { jobTitle } = req.body as { jobTitle?: string | null };
      const normalizedJobTitle = jobTitle?.trim() || null;
  
      if (normalizedJobTitle && normalizedJobTitle.length > 120) {
        return res.status(400).json({ success: false, error: 'jobTitle must be 120 characters or fewer.' });
      }
  
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ success: false, error: 'DATABASE_URL is required for employees' });
      }
  
      try {
        const employee = await withTenant(tenantId, async (client) => {
          const updateResult = await client.query(
            `
              UPDATE employees
              SET job_title = $3::varchar,
                  updated_at = NOW()
              WHERE tenant_id = $1
                AND id = $2
              RETURNING id, email, full_name, role, job_title
            `,
            [tenantId, employeeId, normalizedJobTitle],
          );
  
          const updatedEmployee = updateResult.rows[0];
          if (!updatedEmployee) return null;
  
          await client.query(
            `
              INSERT INTO audit_logs (tenant_id, actor_employee_id, action, entity_type, entity_id, metadata)
              VALUES ($1, $2, $3, $4, $5, $6::jsonb)
            `,
            [
              tenantId,
              actorEmployeeId,
              'employee_title_updated',
              'employee',
              employeeId,
              JSON.stringify({ jobTitle: normalizedJobTitle }),
            ],
          );
  
          return updatedEmployee;
        });
  
        if (!employee) {
          return res.status(404).json({ success: false, error: 'Employee not found.' });
        }
  
        res.json({ success: true, employee });
      } catch (error) {
        logServerError('[Roles] Failed to update employee title:', error);
        res.status(500).json({ success: false, error: 'Unable to update employee title' });
      }
    },
  );
}
