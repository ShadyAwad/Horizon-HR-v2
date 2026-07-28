import type express from 'express';
import type { PoolClient } from 'pg';
import { withTenant } from '../../lib/hr-background';
import { recordAuditEvent } from '../audit/audit-events';
import { canDelegatePermissionAtScope, hasCompanyPermission, isOrganisationScope, resolveScopedPermission, type OrganisationScopeType } from './scoped-permissions';
import { PERMISSION_REGISTRY as PERMISSION_METADATA, getPermissionMetadata, getPermissionDefinition, validatePermissionKeys } from './permission-registry';
import { assertHrAdminAssignmentTimingIsSafe, assertHrAdminAssignmentsMayBeRevoked, HR_ADMIN_SYSTEM_KEY, lockFinalHrAdminAuthority } from './final-hr-admin';
import { registerDelegationRoutes } from './delegation-routes';

type Middleware = express.RequestHandler;
type Dependencies = { standardAuth: Middleware; mutationGuard: Middleware; rateLimiter: Middleware };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
const text = (value: unknown, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
const sendError = (res: express.Response, error: unknown, fallback: string) => {
  const typed = error as { statusCode?: number; message?: string };
  if (!typed.statusCode || typed.statusCode >= 500) console.error('[Organisation]', error);
  res.status(typed.statusCode || 500).json({ success: false, error: typed.statusCode ? typed.message : fallback });
};

const PERMISSION_REGISTRY = new Set([
  'organisation.view', 'organisation.manage', 'departments.manage', 'teams.manage', 'job_titles.manage', 'roles.view', 'roles.manage', 'permissions.manage', 'hierarchy.manage', 'delegations.manage', 'roster.propose_changes', 'roster.manage_scoped', 'roster.approve_changes',
]);

async function assertCompanyPermission(client: PoolClient, req: express.Request, permission: string) {
  const user = req.authUser!;
  const authority = await hasCompanyPermission(client, user.tenantId, user.employeeId, permission);
  if (!authority.allowed) throw fail(403, 'You do not have permission to perform this action.');
  return authority;
}

async function assertActiveEmployee(client: PoolClient, tenantId: string, employeeId: string) {
  const employee = (await client.query(`SELECT id,full_name FROM employees WHERE tenant_id=$1 AND id=$2 AND is_active=true AND employment_status='active'`, [tenantId, employeeId])).rows[0];
  if (!employee) throw fail(400, 'Employee must be active.');
  return employee;
}

async function assertNoDepartmentCycle(client: PoolClient, tenantId: string, departmentId: string | null, parentId: string | null) {
  if (!parentId) return;
  if (departmentId === parentId) throw fail(400, 'A department cannot be its own parent.');
  if (!departmentId) return;
  const cycle = await client.query(
    `WITH RECURSIVE ancestors AS (
       SELECT id,parent_department_id FROM organisation_departments WHERE tenant_id=$1 AND id=$2
       UNION ALL
       SELECT department.id,department.parent_department_id FROM organisation_departments department
       JOIN ancestors ON department.id=ancestors.parent_department_id AND department.tenant_id=$1
     ) SELECT 1 FROM ancestors WHERE id=$3 LIMIT 1`,
    [tenantId, parentId, departmentId],
  );
  if (cycle.rows[0]) throw fail(409, 'This parent department would create a cycle.');
}

async function assertNoReportingCycle(client: PoolClient, tenantId: string, employeeId: string, managerId: string | null) {
  if (!managerId) return;
  if (managerId === employeeId) throw fail(400, 'An employee cannot manage themselves.');
  await assertActiveEmployee(client, tenantId, managerId);
  const cycle = await client.query(
    `WITH RECURSIVE chain AS (
       SELECT id,manager_id FROM employees WHERE tenant_id=$1 AND id=$2
       UNION ALL
       SELECT employee.id,employee.manager_id FROM employees employee
       JOIN chain ON employee.id=chain.manager_id AND employee.tenant_id=$1
     ) SELECT 1 FROM chain WHERE id=$3 LIMIT 1`,
    [tenantId, managerId, employeeId],
  );
  if (cycle.rows[0]) throw fail(409, 'This reporting line would create a cycle.');
}

async function audit(client: PoolClient, req: express.Request, action: string, entityType: string, entityId: string, metadata: Record<string, unknown> = {}) {
  const user = req.authUser!;
  await recordAuditEvent(client, { tenantId: user.tenantId, actorId: user.employeeId, action, targetType: entityType, targetId: entityId, metadata });
}

function assertAllowedFields(value: unknown, allowedFields: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(400, 'Role payload is invalid.');
  const unknown = Object.keys(value).find((field) => !allowedFields.includes(field));
  if (unknown) throw fail(400, `Role field is not allowed: ${unknown}.`);
}

async function assertRoleNameAvailable(client: PoolClient, tenantId: string, name: string, excludeRoleId?: string) {
  const existing = (await client.query(
    `SELECT id FROM tenant_roles WHERE tenant_id=$1 AND lower(name)=lower($2) AND ($3::uuid IS NULL OR id<>$3) LIMIT 1`,
    [tenantId, name, excludeRoleId ?? null],
  )).rows[0];
  if (existing) throw fail(409, 'A role with this name already exists.');
}

function generatedDuplicateRoleName(name: string, roleId: string) {
  const suffix = ` copy ${roleId.slice(0, 8)}`;
  return `${name.slice(0, 160 - suffix.length)}${suffix}`;
}

async function assertPermissionMutationAuthority(client: PoolClient, req: express.Request, permissionKeys: string[]) {
  const user = req.authUser!;
  await assertCompanyPermission(client, req, 'roles.manage');
  await assertCompanyPermission(client, req, 'permissions.manage');
  for (const permissionKey of permissionKeys) {
    const definition = getPermissionDefinition(permissionKey);
    if (!definition || definition.protected || !definition.delegatable) {
      throw fail(403, `Permission cannot be assigned to a custom role: ${permissionKey}.`);
    }
    const authority = await hasCompanyPermission(client, user.tenantId, user.employeeId, permissionKey);
    if (!authority.allowed) throw fail(403, `You cannot grant permission: ${permissionKey}.`);
  }
}

async function assertScopeTarget(client: PoolClient, tenantId: string, scopeType: OrganisationScopeType, scopeId: string | null) {
  const targetScope = ['location', 'department', 'team'].includes(scopeType);
  if (!targetScope && scopeId) throw fail(400, 'This scope cannot have a scope ID.');
  if (targetScope && !scopeId) throw fail(400, 'This scope requires a scope ID.');
  if (!scopeId) return;
  const table = scopeType === 'location' ? 'company_locations' : scopeType === 'department' ? 'organisation_departments' : 'organisation_teams';
  const active = (await client.query(`SELECT 1 FROM ${table} WHERE tenant_id=$1 AND id=$2 AND is_active=true`, [tenantId, scopeId])).rows[0];
  if (!active) throw fail(400, 'Scope target must be active and belong to this tenant.');
}

async function assertAssignmentAuthority(client: PoolClient, req: express.Request, role: { is_system: boolean }, permissionKeys: string[], scopeType: OrganisationScopeType, scopeId: string | null, employeeId: string) {
  const user = req.authUser!;
  await assertCompanyPermission(client, req, 'roles.manage');
  if (role.is_system) await assertCompanyPermission(client, req, 'roles.assign_privileged');
  for (const permissionKey of permissionKeys) {
    const definition = getPermissionDefinition(permissionKey);
    if (!definition) throw fail(400, 'Role contains an unknown permission.');
    if (!definition.allowedScopeTypes.includes(scopeType)) throw fail(403, `Permission cannot be assigned at this scope: ${permissionKey}.`);
    if (!role.is_system && (definition.protected || !definition.delegatable)) throw fail(403, `Permission cannot be delegated: ${permissionKey}.`);
    const allowed = role.is_system
      ? (await hasCompanyPermission(client, user.tenantId, user.employeeId, permissionKey)).allowed
      : await canDelegatePermissionAtScope(client, { tenantId: user.tenantId, actorEmployeeId: user.employeeId, permissionKey, requestedScope: { type: scopeType, id: scopeId }, targetEmployeeId: employeeId });
    if (!allowed) throw fail(403, `You cannot assign permission: ${permissionKey}.`);
  }
}

export function registerOrganisationRoutes(app: express.Express, { standardAuth, mutationGuard, rateLimiter }: Dependencies) {
  registerDelegationRoutes(app, { standardAuth, mutationGuard, rateLimiter });
  app.get('/api/hr/organisation/overview', standardAuth, async (req, res) => {
    try {
      const user = req.authUser!;
      const overview = await withTenant(user.tenantId, async client => {
        await assertCompanyPermission(client, req, 'organisation.view');
        const counts = (await client.query(`SELECT
          (SELECT count(*)::int FROM employees WHERE tenant_id=$1 AND is_active AND employment_status='active') AS "employeeCount",
          (SELECT count(*)::int FROM organisation_departments WHERE tenant_id=$1 AND is_active) AS departments,
          (SELECT count(*)::int FROM organisation_teams WHERE tenant_id=$1 AND is_active) AS teams,
          (SELECT count(*)::int FROM employees WHERE tenant_id=$1 AND is_active AND employment_status='active' AND manager_id IS NOT NULL) AS "managedEmployees",
          (SELECT count(*)::int FROM employees WHERE tenant_id=$1 AND is_active AND employment_status='active' AND department_id IS NULL) AS "unassignedEmployees",
          (SELECT count(*)::int FROM permission_delegations WHERE tenant_id=$1 AND status='active' AND revoked_at IS NULL AND starts_at<=NOW() AND expires_at>NOW()) AS "activeDelegations"`, [user.tenantId])).rows[0];
        return counts;
      });
      res.json({ success: true, overview });
    } catch (error) { sendError(res, error, 'Unable to load organisation overview.'); }
  });

  app.get('/api/hr/organisation/permission-registry',standardAuth,async(req,res)=>{try{const user=req.authUser!;const permissions=await withTenant(user.tenantId,async client=>{await assertCompanyPermission(client,req,'roles.view');const known=new Set((await client.query(`SELECT permission_key FROM tenant_permissions`)).rows.map(row=>row.permission_key));return PERMISSION_METADATA.filter(permission=>known.has(permission.key));});res.json({success:true,permissions});}catch(error){sendError(res,error,'Unable to load permission registry.');}});
  app.get('/api/hr/organisation/roles',standardAuth,async(req,res)=>{try{const user=req.authUser!,page=Math.max(1,Number(req.query.page)||1),pageSize=Math.min(100,Math.max(1,Number(req.query.pageSize)||25)),search=text(req.query.search,120)||null,kind=req.query.kind==='system'||req.query.kind==='custom'?req.query.kind:null,activity=req.query.activity==='archived'?'archived':'active';const result=await withTenant(user.tenantId,async client=>{await assertCompanyPermission(client,req,'roles.view');const where=`role.tenant_id=$1 AND ($2::text IS NULL OR role.name ILIKE '%'||$2||'%' OR COALESCE(role.description,'') ILIKE '%'||$2||'%') AND ($3::text IS NULL OR ($3='system' AND role.is_system) OR ($3='custom' AND NOT role.is_system)) AND (($4='active' AND role.is_active) OR ($4='archived' AND NOT role.is_active))`;const rows=(await client.query(`SELECT role.id,role.name,role.description,role.system_key AS "systemKey",role.is_system AS "isSystem",role.is_active AS "isActive",role.created_at AS "createdAt",role.updated_at AS "updatedAt",COUNT(DISTINCT permission.permission_key)::int AS "permissionCount",COUNT(DISTINCT assignment.id) FILTER(WHERE assignment.revoked_at IS NULL AND (assignment.expires_at IS NULL OR assignment.expires_at>NOW()))::int AS "activeAssignmentCount" FROM tenant_roles role LEFT JOIN tenant_role_permissions permission ON permission.tenant_id=role.tenant_id AND permission.role_id=role.id LEFT JOIN employee_role_assignments assignment ON assignment.tenant_id=role.tenant_id AND assignment.role_id=role.id WHERE ${where} GROUP BY role.id ORDER BY role.is_system DESC,role.name LIMIT $5 OFFSET $6`,[user.tenantId,search,kind,activity,pageSize,(page-1)*pageSize])).rows;const total=(await client.query(`SELECT count(*)::int AS count FROM tenant_roles role WHERE ${where}`,[user.tenantId,search,kind,activity])).rows[0].count;return {roles:rows.map(role=>({id:role.id,name:role.name,description:role.description,systemKey:role.systemKey,isSystem:role.isSystem,isActive:role.isActive,privilegeLevel:role.systemKey==='hr_admin'?3:role.systemKey==='manager'?2:1,permissionCount:role.permissionCount,activeAssignmentCount:role.activeAssignmentCount,createdAt:role.createdAt,updatedAt:role.updatedAt})),total,page,pageSize};});res.json({success:true,...result});}catch(error){sendError(res,error,'Unable to load roles.');}});
  app.get('/api/hr/organisation/roles/:roleId',standardAuth,async(req,res)=>{try{const user=req.authUser!;if(!uuid(req.params.roleId))throw fail(404,'Role not found.');const role=await withTenant(user.tenantId,async client=>{await assertCompanyPermission(client,req,'roles.view');const row=(await client.query(`SELECT role.id,role.name,role.description,role.system_key AS "systemKey",role.is_system AS "isSystem",role.is_active AS "isActive",role.created_at AS "createdAt",role.updated_at AS "updatedAt",COUNT(DISTINCT permission.permission_key)::int AS "permissionCount",COUNT(DISTINCT assignment.id) FILTER(WHERE assignment.revoked_at IS NULL AND (assignment.expires_at IS NULL OR assignment.expires_at>NOW()))::int AS "activeAssignmentCount",COUNT(DISTINCT assignment.id) FILTER(WHERE assignment.revoked_at IS NOT NULL OR assignment.expires_at<=NOW())::int AS "historicalAssignmentCount",COALESCE(array_remove(array_agg(DISTINCT permission.permission_key),NULL),ARRAY[]::varchar[]) AS keys FROM tenant_roles role LEFT JOIN tenant_role_permissions permission ON permission.tenant_id=role.tenant_id AND permission.role_id=role.id LEFT JOIN employee_role_assignments assignment ON assignment.tenant_id=role.tenant_id AND assignment.role_id=role.id WHERE role.tenant_id=$1 AND role.id=$2 GROUP BY role.id`,[user.tenantId,req.params.roleId])).rows[0];if(!row)throw fail(404,'Role not found.');const permissions=row.keys.map(getPermissionMetadata).filter(Boolean);return {id:row.id,name:row.name,description:row.description,systemKey:row.systemKey,isSystem:row.isSystem,isActive:row.isActive,privilegeLevel:row.systemKey==='hr_admin'?3:row.systemKey==='manager'?2:1,permissionCount:row.permissionCount,activeAssignmentCount:row.activeAssignmentCount,historicalAssignmentCount:row.historicalAssignmentCount,createdAt:row.createdAt,updatedAt:row.updatedAt,permissions};});res.json({success:true,role});}catch(error){sendError(res,error,'Unable to load role.');}});
  app.get('/api/hr/organisation/roles/:roleId/permissions',standardAuth,async(req,res)=>{try{const user=req.authUser!;if(!uuid(req.params.roleId))throw fail(404,'Role not found.');const permissions=await withTenant(user.tenantId,async client=>{await assertCompanyPermission(client,req,'roles.view');const exists=(await client.query(`SELECT 1 FROM tenant_roles WHERE tenant_id=$1 AND id=$2`,[user.tenantId,req.params.roleId])).rows[0];if(!exists)throw fail(404,'Role not found.');const selected=new Set((await client.query(`SELECT permission_key FROM tenant_role_permissions WHERE tenant_id=$1 AND role_id=$2`,[user.tenantId,req.params.roleId])).rows.map(row=>row.permission_key));return PERMISSION_METADATA.map(permission=>({...permission,selected:selected.has(permission.key)}));});res.json({success:true,permissions});}catch(error){sendError(res,error,'Unable to load role permissions.');}});

  app.put('/api/hr/organisation/roles/:roleId/permissions', rateLimiter, standardAuth, mutationGuard, async (req, res) => {
    try {
      const user = req.authUser!;
      if (!uuid(req.params.roleId)) throw fail(404, 'Role not found.');
      assertAllowedFields(req.body, ['permissionKeys']);
      const permissionKeys = validatePermissionKeys(req.body.permissionKeys);
      if (!permissionKeys) throw fail(400, 'Permission keys must be recognised registry keys.');
      const result = await withTenant(user.tenantId, async (client) => {
        await assertPermissionMutationAuthority(client, req, permissionKeys);
        const registered = new Set((await client.query(
          `SELECT permission_key FROM tenant_permissions WHERE permission_key = ANY($1::varchar[])`,
          [permissionKeys],
        )).rows.map((row) => row.permission_key));
        if (registered.size !== permissionKeys.length) throw fail(400, 'One or more permission keys are unavailable for this tenant.');

        await client.query('BEGIN');
        try {
          const role = (await client.query(
            `SELECT id,is_system,is_active FROM tenant_roles WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
            [user.tenantId, req.params.roleId],
          )).rows[0];
          if (!role) throw fail(404, 'Role not found.');
          // Essential system-role baselines are not modelled yet, so system mutation stays closed.
          if (role.is_system) throw fail(403, 'System role permissions cannot be changed.');
          if (!role.is_active) throw fail(409, 'Archived role permissions cannot be changed.');

          const previousKeys = (await client.query(
            `SELECT permission_key FROM tenant_role_permissions WHERE tenant_id=$1 AND role_id=$2`,
            [user.tenantId, role.id],
          )).rows.map((row) => row.permission_key as string);
          const previousSet = new Set(previousKeys);
          const nextSet = new Set(permissionKeys);
          const addedCount = permissionKeys.filter((key) => !previousSet.has(key)).length;
          const removedCount = previousKeys.filter((key) => !nextSet.has(key)).length;

          await client.query(`DELETE FROM tenant_role_permissions WHERE tenant_id=$1 AND role_id=$2`, [user.tenantId, role.id]);
          if (permissionKeys.length > 0) {
            await client.query(
              `INSERT INTO tenant_role_permissions(tenant_id,role_id,permission_key)
               SELECT $1,$2,requested.permission_key FROM unnest($3::varchar[]) AS requested(permission_key)`,
              [user.tenantId, role.id, permissionKeys],
            );
          }
          await audit(client, req, 'organisation.role.permissions_updated', 'tenant_role', role.id, {
            roleId: role.id,
            previousPermissionCount: previousKeys.length,
            newPermissionCount: permissionKeys.length,
            addedCount,
            removedCount,
          });
          await client.query('COMMIT');
          return {
            roleId: role.id,
            permissions: PERMISSION_METADATA.map((permission) => ({ ...permission, selected: nextSet.has(permission.key) })),
          };
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      });
      res.json({ success: true, ...result });
    } catch (error) { sendError(res, error, 'Unable to update role permissions.'); }
  });

  app.get('/api/hr/organisation/role-assignments', standardAuth, async (req, res) => {
    try {
      const user = req.authUser!;
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
      const search = text(req.query.search, 120) || null;
      const employeeId = uuid(req.query.employeeId) ? req.query.employeeId : null;
      const roleId = uuid(req.query.roleId) ? req.query.roleId : null;
      const scopeType = isOrganisationScope(req.query.scopeType) ? req.query.scopeType : null;
      const status = ['active', 'upcoming', 'expired', 'revoked'].includes(String(req.query.status)) ? String(req.query.status) : null;
      const result = await withTenant(user.tenantId, async (client) => {
        await assertCompanyPermission(client, req, 'roles.manage');
        const where = `assignment.tenant_id=$1 AND ($2::uuid IS NULL OR assignment.employee_id=$2) AND ($3::uuid IS NULL OR assignment.role_id=$3) AND ($4::text IS NULL OR assignment.scope_type=$4) AND ($5::text IS NULL OR employee.full_name ILIKE '%'||$5||'%' OR role.name ILIKE '%'||$5||'%') AND ($6::text IS NULL OR ($6='expired' AND assignment.expires_at IS NOT NULL AND assignment.expires_at<=NOW()) OR ($6='revoked' AND assignment.revoked_at IS NOT NULL AND (assignment.expires_at IS NULL OR assignment.expires_at>NOW())) OR ($6='upcoming' AND assignment.revoked_at IS NULL AND assignment.assigned_at>NOW()) OR ($6='active' AND assignment.revoked_at IS NULL AND assignment.assigned_at<=NOW() AND (assignment.expires_at IS NULL OR assignment.expires_at>NOW())))`;
        const rows = (await client.query(`SELECT assignment.id AS "assignmentId",employee.id AS "employeeId",employee.full_name AS "employeeName",role.id AS "roleId",role.name AS "roleName",CASE WHEN role.is_system THEN 'system' ELSE 'custom' END AS "roleType",assignment.scope_type AS "scopeType",assignment.scope_id AS "scopeId",COALESCE(location.name,department.name,team.name,assignment.scope_type) AS "scopeLabel",assigner.id AS "assignedById",assigner.full_name AS "assignedByName",assignment.assigned_at AS "assignedAt",assignment.assigned_at AS "startsAt",assignment.expires_at AS "expiresAt",assignment.revoked_at AS "revokedAt",CASE WHEN assignment.expires_at IS NOT NULL AND assignment.expires_at<=NOW() THEN 'expired' WHEN assignment.revoked_at IS NOT NULL THEN 'revoked' WHEN assignment.assigned_at>NOW() THEN 'upcoming' ELSE 'active' END AS status FROM employee_role_assignments assignment JOIN employees employee ON employee.tenant_id=assignment.tenant_id AND employee.id=assignment.employee_id JOIN tenant_roles role ON role.tenant_id=assignment.tenant_id AND role.id=assignment.role_id LEFT JOIN employees assigner ON assigner.tenant_id=assignment.tenant_id AND assigner.id=assignment.assigned_by LEFT JOIN company_locations location ON location.tenant_id=assignment.tenant_id AND location.id=assignment.scope_id AND assignment.scope_type='location' LEFT JOIN organisation_departments department ON department.tenant_id=assignment.tenant_id AND department.id=assignment.scope_id AND assignment.scope_type='department' LEFT JOIN organisation_teams team ON team.tenant_id=assignment.tenant_id AND team.id=assignment.scope_id AND assignment.scope_type='team' WHERE ${where} ORDER BY assignment.assigned_at DESC,assignment.id DESC LIMIT $7 OFFSET $8`, [user.tenantId, employeeId, roleId, scopeType, search, status, pageSize, (page - 1) * pageSize])).rows;
        const total = (await client.query(`SELECT count(*)::int AS count FROM employee_role_assignments assignment JOIN employees employee ON employee.tenant_id=assignment.tenant_id AND employee.id=assignment.employee_id JOIN tenant_roles role ON role.tenant_id=assignment.tenant_id AND role.id=assignment.role_id WHERE ${where}`, [user.tenantId, employeeId, roleId, scopeType, search, status])).rows[0].count;
        return { assignments: rows, total, page, pageSize };
      });
      res.json({ success: true, ...result });
    } catch (error) { sendError(res, error, 'Unable to load role assignments.'); }
  });

  app.post('/api/hr/organisation/employees/:employeeId/roles', rateLimiter, standardAuth, mutationGuard, async (req, res) => {
    try {
      const user = req.authUser!;
      if (!uuid(req.params.employeeId)) throw fail(404, 'Employee not found.');
      assertAllowedFields(req.body, ['roleId', 'scopeType', 'scopeId', 'startsAt', 'expiresAt', 'reason']);
      const body = req.body as Record<string, unknown>;
      const scopeType = body.scopeType;
      if (!uuid(body.roleId) || !isOrganisationScope(scopeType)) throw fail(400, 'Role and scope type are required.');
      if (!(body.scopeId === null || body.scopeId === undefined || uuid(body.scopeId))) throw fail(400, 'Scope ID is invalid.');
      if (body.reason !== undefined && (typeof body.reason !== 'string' || body.reason.length > 1000)) throw fail(400, 'Reason is invalid.');
      const startsAt = body.startsAt === undefined ? new Date() : new Date(String(body.startsAt));
      const expiresAt = body.expiresAt === undefined || body.expiresAt === null ? null : new Date(String(body.expiresAt));
      if (Number.isNaN(startsAt.getTime()) || (expiresAt && (Number.isNaN(expiresAt.getTime()) || expiresAt <= startsAt))) throw fail(400, 'Assignment dates are invalid.');
      const assignment = await withTenant(user.tenantId, async (client) => {
        await client.query('BEGIN');
        try {
          await lockFinalHrAdminAuthority(client, user.tenantId);
          await assertActiveEmployee(client, user.tenantId, req.params.employeeId);
          const scopeId = uuid(body.scopeId) ? body.scopeId : null;
          await assertScopeTarget(client, user.tenantId, scopeType, scopeId);
          const role = (await client.query(`SELECT id,is_system,is_active,system_key FROM tenant_roles WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [user.tenantId, body.roleId])).rows[0];
          if (!role) throw fail(404, 'Role not found.');
          if (!role.is_active) throw fail(409, 'Archived role cannot be assigned.');
          const permissionKeys = (await client.query(`SELECT permission_key FROM tenant_role_permissions WHERE tenant_id=$1 AND role_id=$2`, [user.tenantId, role.id])).rows.map((row) => row.permission_key as string);
          if (permissionKeys.length === 0) throw fail(409, 'Role must have at least one permission.');
          await assertAssignmentAuthority(client, req, role, permissionKeys, scopeType, scopeId, req.params.employeeId);
          if (role.system_key === HR_ADMIN_SYSTEM_KEY) {
            await assertHrAdminAssignmentTimingIsSafe(client, user.tenantId, startsAt, expiresAt);
          }
          await client.query(`UPDATE employee_role_assignments SET revoked_at=NOW(),revoked_by=$4 WHERE tenant_id=$1 AND employee_id=$2 AND role_id=$3 AND scope_type=$5 AND scope_target_key=COALESCE($6::uuid,'00000000-0000-0000-0000-000000000000'::uuid) AND revoked_at IS NULL AND expires_at IS NOT NULL AND expires_at<=NOW()`, [user.tenantId, req.params.employeeId, role.id, user.employeeId, scopeType, scopeId]);
          const row = (await client.query(`INSERT INTO employee_role_assignments(tenant_id,employee_id,role_id,assigned_by,assigned_at,scope_type,scope_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id AS "assignmentId",assigned_at AS "startsAt",expires_at AS "expiresAt"`, [user.tenantId, req.params.employeeId, role.id, user.employeeId, startsAt.toISOString(), scopeType, scopeId, expiresAt?.toISOString() ?? null])).rows[0];
          await audit(client, req, 'organisation.role.assigned', 'employee_role_assignment', row.assignmentId, { assignmentId: row.assignmentId, employeeId: req.params.employeeId, roleId: role.id, scopeType, scopeId, hasExpiry: Boolean(expiresAt) });
          await client.query('COMMIT');
          return row;
        } catch (error) { await client.query('ROLLBACK'); throw error; }
      });
      res.status(201).json({ success: true, assignment });
    } catch (error) { sendError(res, error, 'Unable to assign role.'); }
  });

  app.post('/api/hr/organisation/role-assignments/:assignmentId/revoke', rateLimiter, standardAuth, mutationGuard, async (req, res) => {
    try {
      const user = req.authUser!;
      if (!uuid(req.params.assignmentId)) throw fail(404, 'Role assignment not found.');
      assertAllowedFields(req.body ?? {}, []);
      const assignment = await withTenant(user.tenantId, async (client) => {
        await client.query('BEGIN');
        try {
          await lockFinalHrAdminAuthority(client, user.tenantId);
          const current = (await client.query(`SELECT assignment.id,assignment.employee_id,assignment.role_id,assignment.scope_type,assignment.scope_id,assignment.expires_at,assignment.revoked_at,role.is_system,role.system_key FROM employee_role_assignments assignment JOIN tenant_roles role ON role.tenant_id=assignment.tenant_id AND role.id=assignment.role_id WHERE assignment.tenant_id=$1 AND assignment.id=$2 FOR UPDATE`, [user.tenantId, req.params.assignmentId])).rows[0];
          if (!current) throw fail(404, 'Role assignment not found.');
          if (current.revoked_at) throw fail(409, 'Role assignment is already revoked.');
          const permissionKeys = (await client.query(`SELECT permission_key FROM tenant_role_permissions WHERE tenant_id=$1 AND role_id=$2`, [user.tenantId, current.role_id])).rows.map((row) => row.permission_key as string);
          await assertAssignmentAuthority(client, req, current, permissionKeys, current.scope_type, current.scope_id, current.employee_id);
          if (current.system_key === HR_ADMIN_SYSTEM_KEY) {
            await assertHrAdminAssignmentsMayBeRevoked(client, user.tenantId, current.employee_id, [current.id]);
          }
          const revoked = (await client.query(`UPDATE employee_role_assignments SET revoked_at=NOW(),revoked_by=$3 WHERE tenant_id=$1 AND id=$2 AND revoked_at IS NULL RETURNING id AS "assignmentId",revoked_at AS "revokedAt"`, [user.tenantId, current.id, user.employeeId])).rows[0];
          await client.query(`UPDATE auth_sessions SET revoked_at=NOW() WHERE tenant_id=$1 AND employee_id=$2 AND revoked_at IS NULL AND expires_at>NOW()`, [user.tenantId, current.employee_id]);
          await audit(client, req, 'organisation.role.revoked', 'employee_role_assignment', current.id, { assignmentId: current.id, employeeId: current.employee_id, roleId: current.role_id, scopeType: current.scope_type, scopeId: current.scope_id, hasExpiry: Boolean(current.expires_at) });
          await client.query('COMMIT');
          return revoked;
        } catch (error) { await client.query('ROLLBACK'); throw error; }
      });
      res.json({ success: true, assignment });
    } catch (error) { sendError(res, error, 'Unable to revoke role assignment.'); }
  });

  app.post('/api/hr/organisation/roles', rateLimiter, standardAuth, mutationGuard, async (req, res) => {
    try {
      const user = req.authUser!;
      assertAllowedFields(req.body, ['name', 'description']);
      const name = text(req.body.name, 160);
      if (!name) throw fail(400, 'Role name is required.');
      if (req.body.description !== undefined && typeof req.body.description !== 'string') throw fail(400, 'Role description is invalid.');
      const role = await withTenant(user.tenantId, async (client) => {
        await assertCompanyPermission(client, req, 'roles.manage');
        await assertRoleNameAvailable(client, user.tenantId, name);
        const row = (await client.query(
          `INSERT INTO tenant_roles(tenant_id,name,description,system_key,is_system,is_active)
           VALUES($1,$2,$3,NULL,false,true)
           RETURNING id,name,description,is_system AS "isSystem",is_active AS "isActive",created_at AS "createdAt",updated_at AS "updatedAt"`,
          [user.tenantId, name, text(req.body.description, 2000) || null],
        )).rows[0];
        await audit(client, req, 'organisation.role.created', 'tenant_role', row.id, { isSystem: false, permissionCount: 0 });
        return row;
      });
      res.status(201).json({ success: true, role });
    } catch (error) { sendError(res, error, 'Unable to create role.'); }
  });

  app.patch('/api/hr/organisation/roles/:roleId', rateLimiter, standardAuth, mutationGuard, async (req, res) => {
    try {
      const user = req.authUser!;
      if (!uuid(req.params.roleId)) throw fail(404, 'Role not found.');
      assertAllowedFields(req.body, ['name', 'description']);
      if (req.body.name === undefined && req.body.description === undefined) throw fail(400, 'Provide a role name or description.');
      if (req.body.name !== undefined && (typeof req.body.name !== 'string' || !text(req.body.name, 160))) throw fail(400, 'Role name is required.');
      if (req.body.description !== undefined && typeof req.body.description !== 'string') throw fail(400, 'Role description is invalid.');
      const role = await withTenant(user.tenantId, async (client) => {
        await assertCompanyPermission(client, req, 'roles.manage');
        const current = (await client.query(
          `SELECT id,name,is_system,is_active FROM tenant_roles WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
          [user.tenantId, req.params.roleId],
        )).rows[0];
        if (!current) throw fail(404, 'Role not found.');
        if (current.is_system) throw fail(403, 'System roles cannot be edited.');
        if (!current.is_active) throw fail(409, 'Archived roles cannot be edited.');
        const nextName = req.body.name === undefined ? current.name : text(req.body.name, 160);
        await assertRoleNameAvailable(client, user.tenantId, nextName, current.id);
        const row = (await client.query(
          `UPDATE tenant_roles SET name=$3,description=CASE WHEN $4::boolean THEN $5 ELSE description END,updated_at=NOW()
           WHERE tenant_id=$1 AND id=$2
           RETURNING id,name,description,is_system AS "isSystem",is_active AS "isActive",created_at AS "createdAt",updated_at AS "updatedAt"`,
          [user.tenantId, current.id, nextName, req.body.description !== undefined, req.body.description === undefined ? null : text(req.body.description, 2000) || null],
        )).rows[0];
        await audit(client, req, 'organisation.role.updated', 'tenant_role', row.id, { isSystem: false });
        return row;
      });
      res.json({ success: true, role });
    } catch (error) { sendError(res, error, 'Unable to update role.'); }
  });

  app.post('/api/hr/organisation/roles/:roleId/duplicate', rateLimiter, standardAuth, mutationGuard, async (req, res) => {
    try {
      const user = req.authUser!;
      if (!uuid(req.params.roleId)) throw fail(404, 'Role not found.');
      assertAllowedFields(req.body ?? {}, ['name']);
      if (req.body?.name !== undefined && (typeof req.body.name !== 'string' || !text(req.body.name, 160))) throw fail(400, 'Role name is required.');
      const role = await withTenant(user.tenantId, async (client) => {
        await assertCompanyPermission(client, req, 'roles.manage');
        await client.query('BEGIN');
        try {
          const source = (await client.query(
            `SELECT id,name,description,is_system FROM tenant_roles WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
            [user.tenantId, req.params.roleId],
          )).rows[0];
          if (!source) throw fail(404, 'Role not found.');
          if (source.is_system) throw fail(403, 'System roles cannot be duplicated.');
          const name = req.body?.name === undefined ? generatedDuplicateRoleName(source.name, source.id) : text(req.body.name, 160);
          await assertRoleNameAvailable(client, user.tenantId, name);
          const copy = (await client.query(
            `INSERT INTO tenant_roles(tenant_id,name,description,system_key,is_system,is_active)
             VALUES($1,$2,$3,NULL,false,true)
             RETURNING id,name,description,is_system AS "isSystem",is_active AS "isActive",created_at AS "createdAt",updated_at AS "updatedAt"`,
            [user.tenantId, name, source.description],
          )).rows[0];
          const permissionCount = (await client.query(
            `INSERT INTO tenant_role_permissions(tenant_id,role_id,permission_key)
             SELECT tenant_id,$3,permission_key FROM tenant_role_permissions WHERE tenant_id=$1 AND role_id=$2
             ON CONFLICT(tenant_id,role_id,permission_key) DO NOTHING
             RETURNING permission_key`,
            [user.tenantId, source.id, copy.id],
          )).rowCount ?? 0;
          await audit(client, req, 'organisation.role.duplicated', 'tenant_role', copy.id, { sourceRoleId: source.id, isSystem: false, permissionCount });
          await client.query('COMMIT');
          return { ...copy, permissionCount };
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      });
      res.status(201).json({ success: true, role });
    } catch (error) { sendError(res, error, 'Unable to duplicate role.'); }
  });

  app.post('/api/hr/organisation/roles/:roleId/archive', rateLimiter, standardAuth, mutationGuard, async (req, res) => {
    try {
      const user = req.authUser!;
      if (!uuid(req.params.roleId)) throw fail(404, 'Role not found.');
      assertAllowedFields(req.body ?? {}, []);
      const role = await withTenant(user.tenantId, async (client) => {
        await assertCompanyPermission(client, req, 'roles.manage');
        await client.query('BEGIN');
        try {
          const current = (await client.query(
            `SELECT id,is_system,is_active FROM tenant_roles WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
            [user.tenantId, req.params.roleId],
          )).rows[0];
          if (!current) throw fail(404, 'Role not found.');
          if (current.is_system) throw fail(403, 'System roles cannot be archived.');
          if (!current.is_active) throw fail(409, 'Role is already archived.');
          const activeAssignmentCount = Number((await client.query(
            `SELECT count(*)::int AS count FROM employee_role_assignments
             WHERE tenant_id=$1 AND role_id=$2 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>NOW())`,
            [user.tenantId, current.id],
          )).rows[0]?.count ?? 0);
          if (activeAssignmentCount > 0) throw fail(409, 'Revoke or migrate active role assignments before archiving this role.');
          const archived = (await client.query(
            `UPDATE tenant_roles SET is_active=false,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING id,is_active AS "isActive",updated_at AS "updatedAt"`,
            [user.tenantId, current.id],
          )).rows[0];
          await audit(client, req, 'organisation.role.archived', 'tenant_role', archived.id, { isSystem: false, activeAssignmentCount: 0 });
          await client.query('COMMIT');
          return archived;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      });
      res.json({ success: true, role });
    } catch (error) { sendError(res, error, 'Unable to archive role.'); }
  });

  app.get('/api/me/organisation', standardAuth, async (req, res) => {
    try {
      const user = req.authUser!;
      const organisation = await withTenant(user.tenantId, async client => {
        const employee = (await client.query(`SELECT employee.id,employee.job_title AS "legacyJobTitle",title.name AS "jobTitle",department.name AS department,team.name AS team,manager.full_name AS "managerName",lead.full_name AS "teamLeadName",location.name AS "locationName" FROM employees employee LEFT JOIN organisation_job_titles title ON title.tenant_id=employee.tenant_id AND title.id=employee.job_title_id LEFT JOIN organisation_departments department ON department.tenant_id=employee.tenant_id AND department.id=employee.department_id LEFT JOIN organisation_teams team ON team.tenant_id=employee.tenant_id AND team.id=employee.team_id LEFT JOIN employees manager ON manager.tenant_id=employee.tenant_id AND manager.id=employee.manager_id LEFT JOIN employees lead ON lead.tenant_id=team.tenant_id AND lead.id=team.team_lead_id LEFT JOIN organisation_teams team_location ON team_location.id=team.id LEFT JOIN company_locations location ON location.tenant_id=team_location.tenant_id AND location.id=team_location.location_id WHERE employee.tenant_id=$1 AND employee.id=$2`, [user.tenantId, user.employeeId])).rows[0];
        const delegations = (await client.query(`SELECT permission_key AS "permissionKey",scope_type AS "scopeType",scope_id AS "scopeId",expires_at AS "expiresAt" FROM permission_delegations WHERE tenant_id=$1 AND granted_to_employee_id=$2 AND status='active' AND revoked_at IS NULL AND starts_at<=NOW() AND expires_at>NOW() ORDER BY expires_at`, [user.tenantId, user.employeeId])).rows;
        return { employee, delegations };
      });
      res.json({ success: true, organisation });
    } catch (error) { sendError(res, error, 'Unable to load your organisation.'); }
  });

  app.get('/api/hr/organisation/departments', standardAuth, async (req, res) => {
    try { const user=req.authUser!; const departments=await withTenant(user.tenantId,async client=>{await assertCompanyPermission(client,req,'organisation.view');return (await client.query(`SELECT department.id,department.name,department.code,department.description,department.parent_department_id AS "parentDepartmentId",department.department_head_id AS "departmentHeadId",department.is_active AS "isActive",head.full_name AS "departmentHeadName" FROM organisation_departments department LEFT JOIN employees head ON head.tenant_id=department.tenant_id AND head.id=department.department_head_id WHERE department.tenant_id=$1 ORDER BY department.name`,[user.tenantId])).rows;});res.json({success:true,departments}); } catch(error){sendError(res,error,'Unable to load departments.');} });
  app.post('/api/hr/organisation/departments', rateLimiter, standardAuth, mutationGuard, async (req,res)=>{try{const user=req.authUser!,body=req.body||{};const department=await withTenant(user.tenantId,async client=>{await assertCompanyPermission(client,req,'departments.manage');const name=text(body.name,160);if(!name)throw fail(400,'Department name is required.');const parentId=uuid(body.parentDepartmentId)?body.parentDepartmentId:null;if(body.parentDepartmentId&&!parentId)throw fail(400,'Parent department is invalid.');await assertNoDepartmentCycle(client,user.tenantId,null,parentId);if(uuid(body.departmentHeadId))await assertActiveEmployee(client,user.tenantId,body.departmentHeadId);const row=(await client.query(`INSERT INTO organisation_departments(tenant_id,name,code,description,department_head_id,parent_department_id)VALUES($1,$2,$3,$4,$5,$6) RETURNING id,name,code`,[user.tenantId,name,text(body.code,60)||null,text(body.description,2000)||null,uuid(body.departmentHeadId)?body.departmentHeadId:null,parentId])).rows[0];await audit(client,req,'organisation.department.created','organisation_department',row.id,{name});return row;});res.status(201).json({success:true,department});}catch(error){sendError(res,error,'Unable to create department.');}});
  app.patch('/api/hr/organisation/departments/:departmentId', rateLimiter, standardAuth, mutationGuard, async(req,res)=>{try{const user=req.authUser!;if(!uuid(req.params.departmentId))throw fail(404,'Department not found.');const department=await withTenant(user.tenantId,async client=>{await assertCompanyPermission(client,req,'departments.manage');const body=req.body||{},parentId=body.parentDepartmentId===undefined?undefined:(uuid(body.parentDepartmentId)?body.parentDepartmentId:null);if(body.parentDepartmentId!==undefined&&body.parentDepartmentId!==null&&!uuid(body.parentDepartmentId))throw fail(400,'Parent department is invalid.');if(parentId!==undefined)await assertNoDepartmentCycle(client,user.tenantId,req.params.departmentId,parentId);if(uuid(body.departmentHeadId))await assertActiveEmployee(client,user.tenantId,body.departmentHeadId);const row=(await client.query(`UPDATE organisation_departments SET name=COALESCE($3,name),code=COALESCE($4,code),description=COALESCE($5,description),department_head_id=CASE WHEN $6::boolean THEN $7 ELSE department_head_id END,parent_department_id=CASE WHEN $8::boolean THEN $9 ELSE parent_department_id END,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING id,name`,[user.tenantId,req.params.departmentId,text(body.name,160)||null,body.code===undefined?null:text(body.code,60)||null,body.description===undefined?null:text(body.description,2000)||null,body.departmentHeadId!==undefined,uuid(body.departmentHeadId)?body.departmentHeadId:null,body.parentDepartmentId!==undefined,parentId])).rows[0];if(!row)throw fail(404,'Department not found.');await audit(client,req,'organisation.department.updated','organisation_department',row.id,{});return row;});res.json({success:true,department});}catch(error){sendError(res,error,'Unable to update department.');}});
  app.post('/api/hr/organisation/departments/:departmentId/archive',rateLimiter,standardAuth,mutationGuard,async(req,res)=>{try{const user=req.authUser!;if(!uuid(req.params.departmentId))throw fail(404,'Department not found.');const department=await withTenant(user.tenantId,async client=>{await assertCompanyPermission(client,req,'departments.manage');const row=(await client.query(`UPDATE organisation_departments SET is_active=false,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 AND is_active=true RETURNING id`,[user.tenantId,req.params.departmentId])).rows[0];if(!row)throw fail(404,'Active department not found.');await audit(client,req,'organisation.department.archived','organisation_department',row.id,{});return row;});res.json({success:true,department});}catch(error){sendError(res,error,'Unable to archive department.');}});

  app.get('/api/hr/organisation/teams',standardAuth,async(req,res)=>{try{const user=req.authUser!;const teams=await withTenant(user.tenantId,async client=>{await assertCompanyPermission(client,req,'organisation.view');return (await client.query(`SELECT team.id,team.name,team.description,team.department_id AS "departmentId",department.name AS "departmentName",team.team_lead_id AS "teamLeadId",lead.full_name AS "teamLeadName",team.location_id AS "locationId",team.is_active AS "isActive",COUNT(membership.id)::int AS "memberCount" FROM organisation_teams team LEFT JOIN organisation_departments department ON department.tenant_id=team.tenant_id AND department.id=team.department_id LEFT JOIN employees lead ON lead.tenant_id=team.tenant_id AND lead.id=team.team_lead_id LEFT JOIN organisation_team_memberships membership ON membership.tenant_id=team.tenant_id AND membership.team_id=team.id AND (membership.ends_at IS NULL OR membership.ends_at>=CURRENT_DATE) WHERE team.tenant_id=$1 GROUP BY team.id,department.name,lead.full_name ORDER BY team.name`,[user.tenantId])).rows;});res.json({success:true,teams});}catch(error){sendError(res,error,'Unable to load teams.');}});
  app.post('/api/hr/organisation/teams',rateLimiter,standardAuth,mutationGuard,async(req,res)=>{try{const user=req.authUser!,body=req.body||{};const team=await withTenant(user.tenantId,async client=>{await assertCompanyPermission(client,req,'teams.manage');const name=text(body.name,160);if(!name)throw fail(400,'Team name is required.');for(const id of [body.departmentId,body.teamLeadId,body.locationId])if(id!==undefined&&id!==null&&!uuid(id))throw fail(400,'Team reference is invalid.');if(uuid(body.teamLeadId))await assertActiveEmployee(client,user.tenantId,body.teamLeadId);const row=(await client.query(`INSERT INTO organisation_teams(tenant_id,name,description,department_id,team_lead_id,location_id)VALUES($1,$2,$3,$4,$5,$6) RETURNING id,name`,[user.tenantId,name,text(body.description,2000)||null,uuid(body.departmentId)?body.departmentId:null,uuid(body.teamLeadId)?body.teamLeadId:null,uuid(body.locationId)?body.locationId:null])).rows[0];await audit(client,req,'organisation.team.created','organisation_team',row.id,{name});return row;});res.status(201).json({success:true,team});}catch(error){sendError(res,error,'Unable to create team.');}});
  app.post('/api/hr/organisation/teams/:teamId/members',rateLimiter,standardAuth,mutationGuard,async(req,res)=>{try{const user=req.authUser!,employeeId=req.body?.employeeId;if(!uuid(req.params.teamId)||!uuid(employeeId))throw fail(400,'Team and employee are required.');const membership=await withTenant(user.tenantId,async client=>{await assertCompanyPermission(client,req,'teams.manage');await assertActiveEmployee(client,user.tenantId,employeeId);const exists=(await client.query(`SELECT id FROM organisation_teams WHERE tenant_id=$1 AND id=$2 AND is_active=true`,[user.tenantId,req.params.teamId])).rows[0];if(!exists)throw fail(404,'Team not found.');if((await client.query(`SELECT 1 FROM organisation_team_memberships WHERE tenant_id=$1 AND team_id=$2 AND employee_id=$3 AND (ends_at IS NULL OR ends_at>=CURRENT_DATE)`,[user.tenantId,req.params.teamId,employeeId])).rows[0])throw fail(409,'Employee is already an active member of this team.');const row=(await client.query(`INSERT INTO organisation_team_memberships(tenant_id,team_id,employee_id,membership_type,starts_at)VALUES($1,$2,$3,$4,CURRENT_DATE) RETURNING id`,[user.tenantId,req.params.teamId,employeeId,req.body?.membershipType==='lead'?'lead':'member'])).rows[0];await audit(client,req,'organisation.team.member_added','organisation_team',req.params.teamId,{employeeId});return row;});res.status(201).json({success:true,membership});}catch(error){sendError(res,error,'Unable to add team member.');}});
  app.delete('/api/hr/organisation/teams/:teamId/members/:employeeId',rateLimiter,standardAuth,mutationGuard,async(req,res)=>{try{const user=req.authUser!;if(!uuid(req.params.teamId)||!uuid(req.params.employeeId))throw fail(404,'Team membership not found.');const membership=await withTenant(user.tenantId,async client=>{await assertCompanyPermission(client,req,'teams.manage');const row=(await client.query(`UPDATE organisation_team_memberships SET ends_at=CURRENT_DATE WHERE tenant_id=$1 AND team_id=$2 AND employee_id=$3 AND (ends_at IS NULL OR ends_at>=CURRENT_DATE) RETURNING id`,[user.tenantId,req.params.teamId,req.params.employeeId])).rows[0];if(!row)throw fail(404,'Team membership not found.');await audit(client,req,'organisation.team.member_removed','organisation_team',req.params.teamId,{employeeId:req.params.employeeId});return row;});res.json({success:true,membership});}catch(error){sendError(res,error,'Unable to remove team member.');}});
  app.get('/api/hr/organisation/teams/:teamId/members',standardAuth,async(req,res)=>{try{const user=req.authUser!;if(!uuid(req.params.teamId))throw fail(404,'Team not found.');const page=Math.max(1,Number(req.query.page)||1),pageSize=Math.min(100,Math.max(1,Number(req.query.pageSize)||25)),search=text(req.query.search,120)||null;const result=await withTenant(user.tenantId,async client=>{await assertCompanyPermission(client,req,'organisation.view');const team=(await client.query(`SELECT id FROM organisation_teams WHERE tenant_id=$1 AND id=$2`,[user.tenantId,req.params.teamId])).rows[0];if(!team)throw fail(404,'Team not found.');const where=`membership.tenant_id=$1 AND membership.team_id=$2 AND (membership.ends_at IS NULL OR membership.ends_at>=CURRENT_DATE) AND ($3::text IS NULL OR employee.full_name ILIKE '%'||$3||'%' OR employee.email ILIKE '%'||$3||'%')`;const members=(await client.query(`SELECT membership.id,membership.employee_id AS "employeeId",employee.full_name AS "fullName",employee.email,title.name AS "jobTitle",department.name AS department,team.name AS "teamName",employee.is_active AND employee.employment_status='active' AS "isActive",membership.membership_type AS "membershipType",membership.starts_at AS "startsAt" FROM organisation_team_memberships membership JOIN employees employee ON employee.tenant_id=membership.tenant_id AND employee.id=membership.employee_id LEFT JOIN organisation_job_titles title ON title.tenant_id=employee.tenant_id AND title.id=employee.job_title_id LEFT JOIN organisation_departments department ON department.tenant_id=employee.tenant_id AND department.id=employee.department_id LEFT JOIN organisation_teams team ON team.tenant_id=membership.tenant_id AND team.id=membership.team_id WHERE ${where} ORDER BY employee.full_name LIMIT $4 OFFSET $5`,[user.tenantId,req.params.teamId,search,pageSize,(page-1)*pageSize])).rows;const total=(await client.query(`SELECT count(*)::int AS count FROM organisation_team_memberships membership JOIN employees employee ON employee.tenant_id=membership.tenant_id AND employee.id=membership.employee_id WHERE ${where}`,[user.tenantId,req.params.teamId,search])).rows[0].count;return {members,total,page,pageSize};});res.json({success:true,...result});}catch(error){sendError(res,error,'Unable to load team members.');}});
  app.post('/api/hr/organisation/teams/:teamId/members/move',rateLimiter,standardAuth,mutationGuard,async(req,res)=>{try{const user=req.authUser!,employeeId=req.body?.employeeId,fromTeamId=req.body?.fromTeamId;if(!uuid(req.params.teamId)||!uuid(employeeId)||!uuid(fromTeamId))throw fail(400,'Employee and source team are required.');if(req.params.teamId===fromTeamId)throw fail(400,'Source and destination teams must differ.');const membership=await withTenant(user.tenantId,async client=>{await assertCompanyPermission(client,req,'teams.manage');const employee=await assertActiveEmployee(client,user.tenantId,employeeId);const target=(await client.query(`SELECT id,department_id FROM organisation_teams WHERE tenant_id=$1 AND id=$2 AND is_active`,[user.tenantId,req.params.teamId])).rows[0];if(!target)throw fail(404,'Destination team not found.');const employeeDepartment=(await client.query(`SELECT department_id FROM employees WHERE tenant_id=$1 AND id=$2`,[user.tenantId,employee.id])).rows[0]?.department_id;if(employeeDepartment&&target.department_id&&employeeDepartment!==target.department_id)throw fail(400,'Target team must belong to the employee department.');await client.query('BEGIN');try{if((await client.query(`SELECT 1 FROM organisation_team_memberships WHERE tenant_id=$1 AND team_id=$2 AND employee_id=$3 AND (ends_at IS NULL OR ends_at>=CURRENT_DATE)`,[user.tenantId,req.params.teamId,employeeId])).rows[0])throw fail(409,'Employee is already an active member of the target team.');const removed=(await client.query(`UPDATE organisation_team_memberships SET ends_at=CURRENT_DATE WHERE tenant_id=$1 AND team_id=$2 AND employee_id=$3 AND (ends_at IS NULL OR ends_at>=CURRENT_DATE) RETURNING id`,[user.tenantId,fromTeamId,employeeId])).rows[0];if(!removed)throw fail(404,'Active source membership not found.');const added=(await client.query(`INSERT INTO organisation_team_memberships(tenant_id,team_id,employee_id,membership_type,starts_at) VALUES($1,$2,$3,'member',CURRENT_DATE) RETURNING id`,[user.tenantId,req.params.teamId,employeeId])).rows[0];await audit(client,req,'organisation.team.member_removed','organisation_team',fromTeamId,{employeeId});await audit(client,req,'organisation.team.member_added','organisation_team',req.params.teamId,{employeeId,fromTeamId});await client.query('COMMIT');return added;}catch(error){await client.query('ROLLBACK');throw error;}});res.json({success:true,membership});}catch(error){sendError(res,error,'Unable to move team member.');}});

  app.get('/api/hr/organisation/job-titles',standardAuth,async(req,res)=>{try{const user=req.authUser!;const jobTitles=await withTenant(user.tenantId,async client=>{await assertCompanyPermission(client,req,'organisation.view');return (await client.query(`SELECT id,name,description,level,is_active AS "isActive" FROM organisation_job_titles WHERE tenant_id=$1 ORDER BY level NULLS LAST,name`,[user.tenantId])).rows;});res.json({success:true,jobTitles});}catch(error){sendError(res,error,'Unable to load job titles.');}});
  app.get('/api/hr/organisation/hierarchy',standardAuth,async(req,res)=>{try{const user=req.authUser!,search=text(req.query.search,120).toLowerCase(),departmentId=uuid(req.query.departmentId)?req.query.departmentId:null,teamId=uuid(req.query.teamId)?req.query.teamId:null,employeeId=uuid(req.query.employeeId)?req.query.employeeId:null,includeUnassigned=req.query.includeUnassigned!=='false',depth=Math.min(12,Math.max(1,Number(req.query.depth)||6));const hierarchy=await withTenant(user.tenantId,async client=>{await assertCompanyPermission(client,req,'organisation.view');const [tenantResult,departmentResult,teamResult,employeeResult]=await Promise.all([client.query(`SELECT id,company_name AS name FROM tenants WHERE id=$1`,[user.tenantId]),client.query(`SELECT department.id,department.name,department.parent_department_id AS "parentDepartmentId",department.department_head_id AS "headId",head.full_name AS "headName" FROM organisation_departments department LEFT JOIN employees head ON head.tenant_id=department.tenant_id AND head.id=department.department_head_id AND head.is_active AND head.employment_status='active' WHERE department.tenant_id=$1 AND department.is_active ORDER BY department.name`,[user.tenantId]),client.query(`SELECT team.id,team.name,team.department_id AS "departmentId",team.team_lead_id AS "leaderId",leader.full_name AS "leaderName",location.name AS "locationName",COUNT(membership.id) FILTER(WHERE membership.ends_at IS NULL OR membership.ends_at>=CURRENT_DATE)::int AS "memberCount" FROM organisation_teams team LEFT JOIN employees leader ON leader.tenant_id=team.tenant_id AND leader.id=team.team_lead_id AND leader.is_active AND leader.employment_status='active' LEFT JOIN company_locations location ON location.tenant_id=team.tenant_id AND location.id=team.location_id LEFT JOIN organisation_team_memberships membership ON membership.tenant_id=team.tenant_id AND membership.team_id=team.id WHERE team.tenant_id=$1 AND team.is_active GROUP BY team.id,leader.full_name,location.name ORDER BY team.name`,[user.tenantId]),client.query(`SELECT employee.id AS "employeeId",employee.full_name AS "displayName",title.name AS "jobTitle",employee.department_id AS "departmentId",employee.team_id AS "teamId",employee.manager_id AS "managerId",manager.full_name AS "managerName",employee.is_active AND employee.employment_status='active' AS "isActive",location.name AS "locationName",COUNT(report.id)::int AS "directReportCount" FROM employees employee LEFT JOIN organisation_job_titles title ON title.tenant_id=employee.tenant_id AND title.id=employee.job_title_id LEFT JOIN employees manager ON manager.tenant_id=employee.tenant_id AND manager.id=employee.manager_id LEFT JOIN employees report ON report.tenant_id=employee.tenant_id AND report.manager_id=employee.id AND report.is_active AND report.employment_status='active' LEFT JOIN organisation_teams team ON team.tenant_id=employee.tenant_id AND team.id=employee.team_id LEFT JOIN company_locations location ON location.tenant_id=team.tenant_id AND location.id=team.location_id WHERE employee.tenant_id=$1 AND employee.is_active AND employee.employment_status='active' GROUP BY employee.id,title.name,manager.full_name,location.name ORDER BY employee.full_name`,[user.tenantId])]);const warnings:Array<{code:string;message:string;entityId?:string}> = [];const departments=departmentResult.rows.map(row=>({...row,children:[] as any[],teams:[] as any[]}));const departmentById=new Map(departments.map(department=>[department.id,department]));for(const department of departments){if(department.parentDepartmentId){const parent=departmentById.get(department.parentDepartmentId);if(!parent||parent.id===department.id){warnings.push({code:'department_orphan',message:'Some department relationships could not be displayed because the hierarchy contains inconsistent legacy data.',entityId:department.id});continue;}const seen=new Set<string>([department.id]);let current:any=parent;while(current){if(seen.has(current.id)){warnings.push({code:'department_cycle',message:'Some department relationships could not be displayed because the hierarchy contains inconsistent legacy data.',entityId:department.id});current=null;break;}seen.add(current.id);current=current.parentDepartmentId?departmentById.get(current.parentDepartmentId):null;}if(!current&&seen.size>1&&seen.has(department.id))continue;parent.children.push(department);}}
const roots=departments.filter(department=>!department.parentDepartmentId||!departmentById.has(department.parentDepartmentId));for(const team of teamResult.rows){const department=team.departmentId?departmentById.get(team.departmentId):null;if(department)department.teams.push({...team,members:[]});else warnings.push({code:'orphaned_team',message:'A team is not attached to an active department.',entityId:team.id});if(!team.leaderId)warnings.push({code:'missing_team_leader',message:'A team does not have a leader assigned.',entityId:team.id});}for(const department of departments)if(!department.headId)warnings.push({code:'missing_department_head',message:'A department does not have a head assigned.',entityId:department.id});const employees=employeeResult.rows;const employeeById=new Map(employees.map(employee=>[employee.employeeId,employee]));for(const employee of employees){if(employee.managerId&&!employeeById.has(employee.managerId))warnings.push({code:'missing_manager',message:'An employee has an inactive or missing manager.',entityId:employee.employeeId});if(!employee.managerId)warnings.push({code:'missing_manager',message:'An employee does not have a direct manager.',entityId:employee.employeeId});if(employee.teamId){const team=teamResult.rows.find(item=>item.id===employee.teamId);const department=team?.departmentId?departmentById.get(team.departmentId):null;const node=department?.teams.find((item:any)=>item.id===employee.teamId);if(node)node.members.push(employee);}}
for(const employee of employees){const seen=new Set<string>();let current:any=employee;for(let level=0;level<depth&&current?.managerId;level++){if(seen.has(current.employeeId)){warnings.push({code:'reporting_cycle',message:'Some reporting relationships could not be displayed because the hierarchy contains inconsistent legacy data.',entityId:employee.employeeId});break;}seen.add(current.employeeId);current=employeeById.get(current.managerId);}}
const matches=(value:any)=>!search||[value.name,value.displayName,value.jobTitle,value.managerName,value.locationName].some(item=>String(item||'').toLowerCase().includes(search));const filteredRoots=roots.filter(department=>!departmentId||department.id===departmentId||department.children.some((child:any)=>child.id===departmentId)).map(department=>({...department,teams:department.teams.filter((team:any)=>!teamId||team.id===teamId).map((team:any)=>({...team,members:team.members.filter(matches)})),children:department.children})).filter((department:any)=>matches(department)||department.teams.some((team:any)=>matches(team)||team.members.length)||department.children.length);const unassigned=employees.filter(employee=>includeUnassigned&&(!employee.departmentId||!employee.teamId||!employee.jobTitle||!employee.managerId)&&matches(employee));const focusedEmployee=employeeId?employees.find(employee=>employee.employeeId===employeeId)||null:null;return {company:tenantResult.rows[0],departments:filteredRoots,unassignedEmployees:unassigned,warnings:[...new Map(warnings.map(warning=>[`${warning.code}:${warning.entityId}`,warning])).values()],focusedEmployee};});res.json({success:true,...hierarchy});}catch(error){sendError(res,error,'Unable to load organisation hierarchy.');}});
  app.post('/api/hr/organisation/job-titles',rateLimiter,standardAuth,mutationGuard,async(req,res)=>{try{const user=req.authUser!,body=req.body||{};const jobTitle=await withTenant(user.tenantId,async client=>{await assertCompanyPermission(client,req,'job_titles.manage');const name=text(body.name,160);if(!name)throw fail(400,'Job title name is required.');const level=body.level===undefined||body.level===null?null:Number(body.level);if(level!==null&&(!Number.isInteger(level)||level<0||level>100))throw fail(400,'Job title level is invalid.');const row=(await client.query(`INSERT INTO organisation_job_titles(tenant_id,name,description,level)VALUES($1,$2,$3,$4)RETURNING id,name,level`,[user.tenantId,name,text(body.description,2000)||null,level])).rows[0];await audit(client,req,'organisation.job_title.created','organisation_job_title',row.id,{name});return row;});res.status(201).json({success:true,jobTitle});}catch(error){sendError(res,error,'Unable to create job title.');}});

  app.patch('/api/hr/organisation/teams/:teamId',rateLimiter,standardAuth,mutationGuard,async(req,res)=>{try{const user=req.authUser!,body=req.body||{};if(!uuid(req.params.teamId))throw fail(404,'Team not found.');for(const value of [body.departmentId,body.teamLeadId,body.locationId])if(value!==undefined&&value!==null&&!uuid(value))throw fail(400,'Team reference is invalid.');const team=await withTenant(user.tenantId,async client=>{await assertCompanyPermission(client,req,'teams.manage');if(uuid(body.teamLeadId))await assertActiveEmployee(client,user.tenantId,body.teamLeadId);if(uuid(body.departmentId)&&!(await client.query(`SELECT 1 FROM organisation_departments WHERE tenant_id=$1 AND id=$2 AND is_active`,[user.tenantId,body.departmentId])).rows[0])throw fail(400,'Department must be active.');if(uuid(body.locationId)&&!(await client.query(`SELECT 1 FROM company_locations WHERE tenant_id=$1 AND id=$2 AND is_active`,[user.tenantId,body.locationId])).rows[0])throw fail(400,'Location must be active.');const row=(await client.query(`UPDATE organisation_teams SET name=COALESCE($3,name),description=COALESCE($4,description),department_id=CASE WHEN $5::boolean THEN $6 ELSE department_id END,team_lead_id=CASE WHEN $7::boolean THEN $8 ELSE team_lead_id END,location_id=CASE WHEN $9::boolean THEN $10 ELSE location_id END,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING id,name`,[user.tenantId,req.params.teamId,text(body.name,160)||null,body.description===undefined?null:text(body.description,2000)||null,body.departmentId!==undefined,uuid(body.departmentId)?body.departmentId:null,body.teamLeadId!==undefined,uuid(body.teamLeadId)?body.teamLeadId:null,body.locationId!==undefined,uuid(body.locationId)?body.locationId:null])).rows[0];if(!row)throw fail(404,'Team not found.');await audit(client,req,'organisation.team.updated','organisation_team',row.id,{});return row;});res.json({success:true,team});}catch(error){sendError(res,error,'Unable to update team.');}});
  app.post('/api/hr/organisation/teams/:teamId/archive',rateLimiter,standardAuth,mutationGuard,async(req,res)=>{try{const user=req.authUser!;if(!uuid(req.params.teamId))throw fail(404,'Team not found.');const team=await withTenant(user.tenantId,async client=>{await assertCompanyPermission(client,req,'teams.manage');const activeMembers=(await client.query(`SELECT count(*)::int AS count FROM organisation_team_memberships WHERE tenant_id=$1 AND team_id=$2 AND (ends_at IS NULL OR ends_at>=CURRENT_DATE)`,[user.tenantId,req.params.teamId])).rows[0]?.count||0;if(activeMembers>0&&!req.body?.confirmArchive)throw fail(409,`Team has ${activeMembers} active member(s). Confirm archive to preserve membership history.`);const row=(await client.query(`UPDATE organisation_teams SET is_active=false,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 AND is_active=true RETURNING id`,[user.tenantId,req.params.teamId])).rows[0];if(!row)throw fail(404,'Active team not found.');await audit(client,req,'organisation.team.archived','organisation_team',row.id,{activeMembers});return row;});res.json({success:true,team});}catch(error){sendError(res,error,'Unable to archive team.');}});
  app.patch('/api/hr/organisation/job-titles/:jobTitleId',rateLimiter,standardAuth,mutationGuard,async(req,res)=>{try{const user=req.authUser!,body=req.body||{};if(!uuid(req.params.jobTitleId))throw fail(404,'Job title not found.');const title=await withTenant(user.tenantId,async client=>{await assertCompanyPermission(client,req,'job_titles.manage');const level=body.level===undefined?undefined:(body.level===null?null:Number(body.level));if(level!==undefined&&level!==null&&(!Number.isInteger(level)||level<0||level>100))throw fail(400,'Job title level is invalid.');const row=(await client.query(`UPDATE organisation_job_titles SET name=COALESCE($3,name),description=COALESCE($4,description),level=CASE WHEN $5::boolean THEN $6 ELSE level END,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING id,name,level`,[user.tenantId,req.params.jobTitleId,text(body.name,160)||null,body.description===undefined?null:text(body.description,2000)||null,level!==undefined,level??null])).rows[0];if(!row)throw fail(404,'Job title not found.');await audit(client,req,'organisation.job_title.updated','organisation_job_title',row.id,{});return row;});res.json({success:true,jobTitle:title});}catch(error){sendError(res,error,'Unable to update job title.');}});
  app.post('/api/hr/organisation/job-titles/:jobTitleId/archive',rateLimiter,standardAuth,mutationGuard,async(req,res)=>{try{const user=req.authUser!;if(!uuid(req.params.jobTitleId))throw fail(404,'Job title not found.');const title=await withTenant(user.tenantId,async client=>{await assertCompanyPermission(client,req,'job_titles.manage');const assigned=(await client.query(`SELECT count(*)::int AS count FROM employees WHERE tenant_id=$1 AND job_title_id=$2`,[user.tenantId,req.params.jobTitleId])).rows[0]?.count||0;if(assigned>0&&!req.body?.confirmArchive)throw fail(409,`Job title is assigned to ${assigned} employee(s). Confirm archive to preserve history.`);const row=(await client.query(`UPDATE organisation_job_titles SET is_active=false,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 AND is_active=true RETURNING id`,[user.tenantId,req.params.jobTitleId])).rows[0];if(!row)throw fail(404,'Active job title not found.');await audit(client,req,'organisation.job_title.archived','organisation_job_title',row.id,{assigned});return row;});res.json({success:true,jobTitle:title});}catch(error){sendError(res,error,'Unable to archive job title.');}});
  app.get('/api/hr/organisation/people',standardAuth,async(req,res)=>{try{const user=req.authUser!;const page=Math.max(1,Number(req.query.page)||1),pageSize=Math.min(100,Math.max(1,Number(req.query.pageSize)||25)),search=text(req.query.search,120)||null;const people=await withTenant(user.tenantId,async client=>{await assertCompanyPermission(client,req,'organisation.view');const where=`employee.tenant_id=$1 AND ($2::text IS NULL OR employee.full_name ILIKE '%'||$2||'%' OR employee.email ILIKE '%'||$2||'%')`;const rows=(await client.query(`SELECT employee.id,employee.full_name AS "fullName",employee.email,employee.job_title AS "legacyJobTitle",employee.job_title_id AS "jobTitleId",title.name AS "jobTitle",employee.department_id AS "departmentId",department.name AS department,employee.team_id AS "teamId",team.name AS team,employee.manager_id AS "managerId",manager.full_name AS "managerName",employee.is_active AS "isActive",employee.employment_status AS "employmentStatus" FROM employees employee LEFT JOIN organisation_job_titles title ON title.tenant_id=employee.tenant_id AND title.id=employee.job_title_id LEFT JOIN organisation_departments department ON department.tenant_id=employee.tenant_id AND department.id=employee.department_id LEFT JOIN organisation_teams team ON team.tenant_id=employee.tenant_id AND team.id=employee.team_id LEFT JOIN employees manager ON manager.tenant_id=employee.tenant_id AND manager.id=employee.manager_id WHERE ${where} ORDER BY employee.full_name LIMIT $3 OFFSET $4`,[user.tenantId,search,pageSize,(page-1)*pageSize])).rows;const total=(await client.query(`SELECT count(*)::int AS count FROM employees employee WHERE ${where}`,[user.tenantId,search])).rows[0].count;return {people:rows,total,page,pageSize};});res.json({success:true,...people});}catch(error){sendError(res,error,'Unable to load people.');}});

  app.patch('/api/hr/organisation/employees/:employeeId/reporting-line',rateLimiter,standardAuth,mutationGuard,async(req,res)=>{try{const user=req.authUser!,managerId=req.body?.managerId;if(!uuid(req.params.employeeId)||!(managerId===null||managerId===undefined||uuid(managerId)))throw fail(400,'Manager is invalid.');const employee=await withTenant(user.tenantId,async client=>{await assertCompanyPermission(client,req,'hierarchy.manage');await assertNoReportingCycle(client,user.tenantId,req.params.employeeId,uuid(managerId)?managerId:null);const row=(await client.query(`UPDATE employees SET manager_id=$3,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING id,manager_id AS "managerId"`,[user.tenantId,req.params.employeeId,uuid(managerId)?managerId:null])).rows[0];if(!row)throw fail(404,'Employee not found.');await audit(client,req,'organisation.reporting_line.updated','employee',row.id,{managerId:row.managerId});return row;});res.json({success:true,employee});}catch(error){sendError(res,error,'Unable to update reporting line.');}});
  app.patch('/api/hr/organisation/employees/:employeeId/placement',rateLimiter,standardAuth,mutationGuard,async(req,res)=>{try{const user=req.authUser!,body=req.body||{};if(!uuid(req.params.employeeId))throw fail(404,'Employee not found.');for(const value of [body.jobTitleId,body.departmentId,body.teamId])if(value!==undefined&&value!==null&&!uuid(value))throw fail(400,'Placement reference is invalid.');const employee=await withTenant(user.tenantId,async client=>{await assertCompanyPermission(client,req,'hierarchy.manage');const current=(await client.query(`SELECT department_id,team_id,job_title_id FROM employees WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,[user.tenantId,req.params.employeeId])).rows[0];if(!current)throw fail(404,'Employee not found.');const jobTitleId=body.jobTitleId===undefined?current.job_title_id:(uuid(body.jobTitleId)?body.jobTitleId:null),departmentId=body.departmentId===undefined?current.department_id:(uuid(body.departmentId)?body.departmentId:null),teamId=body.teamId===undefined?current.team_id:(uuid(body.teamId)?body.teamId:null);if(jobTitleId&&!(await client.query(`SELECT 1 FROM organisation_job_titles WHERE tenant_id=$1 AND id=$2 AND is_active`,[user.tenantId,jobTitleId])).rows[0])throw fail(400,'Job title must be active.');if(departmentId&&!(await client.query(`SELECT 1 FROM organisation_departments WHERE tenant_id=$1 AND id=$2 AND is_active`,[user.tenantId,departmentId])).rows[0])throw fail(400,'Department must be active.');if(teamId){const team=(await client.query(`SELECT department_id FROM organisation_teams WHERE tenant_id=$1 AND id=$2 AND is_active`,[user.tenantId,teamId])).rows[0];if(!team)throw fail(400,'Team must be active.');if(departmentId&&team.department_id&&team.department_id!==departmentId)throw fail(400,'Team must belong to the selected department.');}const row=(await client.query(`UPDATE employees SET job_title_id=$3,department_id=$4,team_id=$5,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING id,job_title_id AS "jobTitleId",department_id AS "departmentId",team_id AS "teamId"`,[user.tenantId,req.params.employeeId,jobTitleId,departmentId,teamId])).rows[0];await audit(client,req,'organisation.employee_placement.updated','employee',row.id,{jobTitleId,departmentId,teamId});return row;});res.json({success:true,employee});}catch(error){sendError(res,error,'Unable to update employee placement.');}});

  app.get('/api/hr/organisation/delegations',standardAuth,async(req,res)=>{try{const user=req.authUser!;const delegations=await withTenant(user.tenantId,async client=>{await assertCompanyPermission(client,req,'delegations.manage');return (await client.query(`SELECT delegation.id,delegation.permission_key AS "permissionKey",delegation.scope_type AS "scopeType",delegation.scope_id AS "scopeId",delegation.reason,delegation.starts_at AS "startsAt",delegation.expires_at AS "expiresAt",delegation.status,grantor.full_name AS "grantedByName",grantee.full_name AS "grantedToName" FROM permission_delegations delegation JOIN employees grantor ON grantor.tenant_id=delegation.tenant_id AND grantor.id=delegation.granted_by_employee_id JOIN employees grantee ON grantee.tenant_id=delegation.tenant_id AND grantee.id=delegation.granted_to_employee_id WHERE delegation.tenant_id=$1 ORDER BY delegation.expires_at DESC`,[user.tenantId])).rows;});res.json({success:true,delegations});}catch(error){sendError(res,error,'Unable to load delegations.');}});
  app.post('/api/hr/organisation/delegations',rateLimiter,standardAuth,mutationGuard,async(req,res)=>{try{const user=req.authUser!,body=req.body||{};if(!uuid(body.grantedToEmployeeId)||!PERMISSION_REGISTRY.has(body.permissionKey)||!isOrganisationScope(body.scopeType))throw fail(400,'Delegation is invalid.');const scopeId=uuid(body.scopeId)?body.scopeId:null;if(['location','department','team'].includes(body.scopeType)&&!scopeId)throw fail(400,'Delegation scope target is required.');const startsAt=body.startsAt?new Date(body.startsAt):new Date(),expiresAt=new Date(body.expiresAt);if(Number.isNaN(startsAt.getTime())||Number.isNaN(expiresAt.getTime())||expiresAt<=startsAt)throw fail(400,'Delegation expiry is required and must be later than its start.');const delegation=await withTenant(user.tenantId,async client=>{const authority=await resolveScopedPermission(client,{tenantId:user.tenantId,actorEmployeeId:user.employeeId,permissionKey:body.permissionKey,targetEmployeeId:body.grantedToEmployeeId});if(!authority.allowed)throw fail(403,'You cannot delegate a permission you do not possess over this employee.');await assertActiveEmployee(client,user.tenantId,body.grantedToEmployeeId);const row=(await client.query(`INSERT INTO permission_delegations(tenant_id,granted_by_employee_id,granted_to_employee_id,permission_key,scope_type,scope_id,reason,starts_at,expires_at)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)RETURNING id`,[user.tenantId,user.employeeId,body.grantedToEmployeeId,body.permissionKey,body.scopeType,scopeId,text(body.reason,1000)||null,startsAt.toISOString(),expiresAt.toISOString()])).rows[0];await audit(client,req,'organisation.delegation.created','permission_delegation',row.id,{permissionKey:body.permissionKey,scopeType:body.scopeType,scopeId});return row;});res.status(201).json({success:true,delegation});}catch(error){sendError(res,error,'Unable to create delegation.');}});
  app.post('/api/hr/organisation/delegations/:delegationId/revoke',rateLimiter,standardAuth,mutationGuard,async(req,res)=>{try{const user=req.authUser!;if(!uuid(req.params.delegationId))throw fail(404,'Delegation not found.');const delegation=await withTenant(user.tenantId,async client=>{await assertCompanyPermission(client,req,'delegations.manage');const row=(await client.query(`UPDATE permission_delegations SET status='revoked',revoked_at=NOW(),revoked_by=$3,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 AND status='active' AND revoked_at IS NULL RETURNING id`,[user.tenantId,req.params.delegationId,user.employeeId])).rows[0];if(!row)throw fail(404,'Active delegation not found.');await audit(client,req,'organisation.delegation.revoked','permission_delegation',row.id,{});return row;});res.json({success:true,delegation});}catch(error){sendError(res,error,'Unable to revoke delegation.');}});
}
