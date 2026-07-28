import type express from 'express';
import type { PoolClient } from 'pg';
import { withTenant } from '../../lib/hr-background';
import { recordAuditEvent } from '../audit/audit-events';
import { getPermissionDefinition } from './permission-registry';
import { canDelegatePermissionAtScope, isOrganisationScope, type OrganisationScopeType } from './scoped-permissions';

type Middleware = express.RequestHandler;
type Dependencies = { standardAuth: Middleware; mutationGuard: Middleware; rateLimiter: Middleware };
type Scope = { type: OrganisationScopeType; id: string | null };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_DELEGATION_MS = 90 * 24 * 60 * 60 * 1000;
const uuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
const text = (value: unknown, maximum = 1000) => typeof value === 'string' ? value.trim().slice(0, maximum) : '';

function sendError(res: express.Response, error: unknown, fallback: string) {
  const typed = error as { statusCode?: number; message?: string };
  if (!typed.statusCode || typed.statusCode >= 500) console.error('[Delegations]', error);
  res.status(typed.statusCode || 500).json({ success: false, error: typed.statusCode ? typed.message : fallback });
}

function assertFields(value: unknown, allowed: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(400, 'Delegation payload is invalid.');
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) throw fail(400, `Delegation field is not allowed: ${unexpected}.`);
}

async function assertActiveEmployee(client: PoolClient, tenantId: string, employeeId: string) {
  const employee = (await client.query(`SELECT id,full_name FROM employees WHERE tenant_id=$1 AND id=$2 AND is_active=true AND employment_status='active'`, [tenantId, employeeId])).rows[0];
  if (!employee) throw fail(400, 'Delegation recipient must be an active tenant employee.');
  return employee;
}

async function assertScopeTarget(client: PoolClient, tenantId: string, scope: Scope) {
  if (['company', 'direct_reports'].includes(scope.type)) {
    if (scope.id) throw fail(400, 'This delegation scope cannot have a target.');
    return;
  }
  if (!scope.id) throw fail(400, 'Delegation scope target is required.');
  const table = scope.type === 'location' ? 'company_locations' : scope.type === 'department' ? 'organisation_departments' : 'organisation_teams';
  const row = (await client.query(`SELECT id FROM ${table} WHERE tenant_id=$1 AND id=$2 AND is_active=true`, [tenantId, scope.id])).rows[0];
  if (!row) throw fail(400, 'Delegation scope target must be active and belong to this workspace.');
}

async function requireDelegationAuthority(client: PoolClient, req: express.Request) {
  const user = req.authUser!;
  const permitted = await canDelegatePermissionAtScope(client, {
    tenantId: user.tenantId,
    actorEmployeeId: user.employeeId,
    permissionKey: 'delegations.manage',
    requestedScope: { type: 'company', id: null },
    targetEmployeeId: user.employeeId,
  });
  if (!permitted) throw fail(403, 'You do not have permission to manage delegations.');
}

function statusSql() {
  return `CASE WHEN delegation.revoked_at IS NOT NULL THEN 'revoked' WHEN delegation.expires_at<=NOW() THEN 'expired' WHEN delegation.starts_at>NOW() THEN 'upcoming' ELSE 'active' END`;
}

export function registerDelegationRoutes(app: express.Express, { standardAuth, mutationGuard, rateLimiter }: Dependencies) {
  app.get('/api/hr/organisation/delegations', standardAuth, async (req, res) => {
    try {
      const user = req.authUser!;
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
      const search = text(req.query.search, 120) || null;
      const grantorId = uuid(req.query.grantorEmployeeId) ? req.query.grantorEmployeeId : null;
      const recipientId = uuid(req.query.recipientEmployeeId) ? req.query.recipientEmployeeId : null;
      const permissionKey = typeof req.query.permissionKey === 'string' && getPermissionDefinition(req.query.permissionKey) ? req.query.permissionKey : null;
      const scopeType = isOrganisationScope(req.query.scopeType) && req.query.scopeType !== 'self' ? req.query.scopeType : null;
      const status = ['active', 'upcoming', 'expired', 'revoked'].includes(String(req.query.status)) ? String(req.query.status) : null;
      const result = await withTenant(user.tenantId, async (client) => {
        await requireDelegationAuthority(client, req);
        const where = `delegation.tenant_id=$1 AND ($2::uuid IS NULL OR delegation.granted_by_employee_id=$2) AND ($3::uuid IS NULL OR delegation.granted_to_employee_id=$3) AND ($4::varchar IS NULL OR delegation.permission_key=$4) AND ($5::varchar IS NULL OR delegation.scope_type=$5) AND ($6::text IS NULL OR grantor.full_name ILIKE '%'||$6||'%' OR recipient.full_name ILIKE '%'||$6||'%' OR delegation.permission_key ILIKE '%'||$6||'%') AND ($7::text IS NULL OR ${statusSql()}=$7)`;
        const sql = `SELECT delegation.id AS "delegationId",delegation.granted_by_employee_id AS "grantorEmployeeId",grantor.full_name AS "grantorName",delegation.granted_to_employee_id AS "recipientEmployeeId",recipient.full_name AS "recipientName",delegation.permission_key AS "permissionKey",delegation.scope_type AS "scopeType",delegation.scope_id AS "scopeId",COALESCE(location.name,department.name,team.name,delegation.scope_type) AS "scopeLabel",delegation.starts_at AS "startsAt",delegation.expires_at AS "expiresAt",delegation.revoked_at AS "revokedAt",${statusSql()} AS status FROM permission_delegations delegation JOIN employees grantor ON grantor.tenant_id=delegation.tenant_id AND grantor.id=delegation.granted_by_employee_id JOIN employees recipient ON recipient.tenant_id=delegation.tenant_id AND recipient.id=delegation.granted_to_employee_id LEFT JOIN company_locations location ON location.tenant_id=delegation.tenant_id AND location.id=delegation.scope_id AND delegation.scope_type='location' LEFT JOIN organisation_departments department ON department.tenant_id=delegation.tenant_id AND department.id=delegation.scope_id AND delegation.scope_type='department' LEFT JOIN organisation_teams team ON team.tenant_id=delegation.tenant_id AND team.id=delegation.scope_id AND delegation.scope_type='team' WHERE ${where} ORDER BY delegation.starts_at DESC,delegation.id DESC LIMIT $8 OFFSET $9`;
        const values = [user.tenantId, grantorId, recipientId, permissionKey, scopeType, search, status, pageSize, (page - 1) * pageSize];
        const rows = (await client.query(sql, values)).rows;
        const total = (await client.query(`SELECT count(*)::int AS count FROM permission_delegations delegation JOIN employees grantor ON grantor.tenant_id=delegation.tenant_id AND grantor.id=delegation.granted_by_employee_id JOIN employees recipient ON recipient.tenant_id=delegation.tenant_id AND recipient.id=delegation.granted_to_employee_id WHERE ${where}`, values.slice(0, 7))).rows[0].count;
        return { delegations: rows.map((row) => ({ ...row, permissionLabel: getPermissionDefinition(row.permissionKey)?.label || row.permissionKey })), total, page, pageSize };
      });
      res.json({ success: true, ...result });
    } catch (error) { sendError(res, error, 'Unable to load delegations.'); }
  });

  app.post('/api/hr/organisation/delegations', rateLimiter, standardAuth, mutationGuard, async (req, res) => {
    try {
      const user = req.authUser!;
      assertFields(req.body, ['recipientEmployeeId', 'permissionKey', 'scopeType', 'scopeId', 'startsAt', 'expiresAt', 'reason']);
      const body = req.body as Record<string, unknown>;
      if (!uuid(body.recipientEmployeeId) || !isOrganisationScope(body.scopeType) || body.scopeType === 'self' || typeof body.permissionKey !== 'string') throw fail(400, 'Delegation recipient, permission, and scope are required.');
      const recipientEmployeeId = body.recipientEmployeeId;
      const permissionKey = body.permissionKey;
      const definition = getPermissionDefinition(permissionKey);
      if (!definition) throw fail(400, 'Delegation permission must be a recognised registry key.');
      if (!definition.delegatable || definition.protected) throw fail(403, 'This permission cannot be delegated.');
      if (!definition.allowedScopeTypes.includes(body.scopeType)) throw fail(400, 'This permission cannot be delegated at the requested scope.');
      const scope: Scope = { type: body.scopeType, id: uuid(body.scopeId) ? body.scopeId : null };
      const startsAt = new Date(String(body.startsAt || ''));
      const expiresAt = new Date(String(body.expiresAt || ''));
      if (Number.isNaN(startsAt.getTime()) || Number.isNaN(expiresAt.getTime()) || expiresAt <= startsAt) throw fail(400, 'Delegation expiry is required and must be later than its start.');
      if (expiresAt.getTime() - startsAt.getTime() > MAX_DELEGATION_MS) throw fail(400, 'Delegations may not exceed 90 days.');
      const delegation = await withTenant(user.tenantId, async (client) => {
        await client.query('BEGIN');
        try {
          await requireDelegationAuthority(client, req);
          await assertActiveEmployee(client, user.tenantId, recipientEmployeeId);
          await assertScopeTarget(client, user.tenantId, scope);
          const contained = await canDelegatePermissionAtScope(client, { tenantId: user.tenantId, actorEmployeeId: user.employeeId, permissionKey, requestedScope: scope, targetEmployeeId: recipientEmployeeId });
          if (!contained) throw fail(403, 'Your authority does not cover this delegated permission scope.');
          const overlap = (await client.query(`SELECT 1 FROM permission_delegations WHERE tenant_id=$1 AND granted_by_employee_id=$2 AND granted_to_employee_id=$3 AND permission_key=$4 AND scope_type=$5 AND scope_id IS NOT DISTINCT FROM $6 AND revoked_at IS NULL AND starts_at<$8 AND expires_at>$7 FOR UPDATE`, [user.tenantId, user.employeeId, recipientEmployeeId, permissionKey, scope.type, scope.id, startsAt.toISOString(), expiresAt.toISOString()])).rows[0];
          if (overlap) throw fail(409, 'An overlapping active delegation already exists.');
          const row = (await client.query(`INSERT INTO permission_delegations(tenant_id,granted_by_employee_id,granted_to_employee_id,permission_key,scope_type,scope_id,reason,starts_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id AS "delegationId"`, [user.tenantId, user.employeeId, recipientEmployeeId, permissionKey, scope.type, scope.id, text(body.reason) || null, startsAt.toISOString(), expiresAt.toISOString()])).rows[0];
          await recordAuditEvent(client, { tenantId: user.tenantId, actorId: user.employeeId, action: 'organisation.delegation.created', targetType: 'permission_delegation', targetId: row.delegationId, metadata: { delegationId: row.delegationId, grantorEmployeeId: user.employeeId, recipientEmployeeId, permissionKey, scopeType: scope.type, scopeId: scope.id, hasExpiry: true } });
          await client.query('COMMIT');
          return row;
        } catch (error) { await client.query('ROLLBACK'); throw error; }
      });
      res.status(201).json({ success: true, delegation });
    } catch (error) { sendError(res, error, 'Unable to create delegation.'); }
  });

  app.post('/api/hr/organisation/delegations/:delegationId/revoke', rateLimiter, standardAuth, mutationGuard, async (req, res) => {
    try {
      const user = req.authUser!;
      if (!uuid(req.params.delegationId)) throw fail(404, 'Delegation not found.');
      const delegation = await withTenant(user.tenantId, async (client) => {
        await client.query('BEGIN');
        try {
          const current = (await client.query(`SELECT * FROM permission_delegations WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [user.tenantId, req.params.delegationId])).rows[0];
          if (!current) throw fail(404, 'Delegation not found.');
          if (current.revoked_at) throw fail(409, 'Delegation is already revoked.');
          if (current.granted_by_employee_id !== user.employeeId) await requireDelegationAuthority(client, req);
          const row = (await client.query(`UPDATE permission_delegations SET status='revoked',revoked_at=NOW(),revoked_by=$3,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING id AS "delegationId"`, [user.tenantId, req.params.delegationId, user.employeeId])).rows[0];
          await recordAuditEvent(client, { tenantId: user.tenantId, actorId: user.employeeId, action: 'organisation.delegation.revoked', targetType: 'permission_delegation', targetId: row.delegationId, metadata: { delegationId: row.delegationId, grantorEmployeeId: current.granted_by_employee_id, recipientEmployeeId: current.granted_to_employee_id, permissionKey: current.permission_key, scopeType: current.scope_type, scopeId: current.scope_id, hasExpiry: true } });
          await client.query('COMMIT');
          return row;
        } catch (error) { await client.query('ROLLBACK'); throw error; }
      });
      res.json({ success: true, delegation });
    } catch (error) { sendError(res, error, 'Unable to revoke delegation.'); }
  });
}
