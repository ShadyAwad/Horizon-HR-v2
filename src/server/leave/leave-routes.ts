import type express from 'express';
import type { PoolClient } from 'pg';
import { withTenant } from '../../lib/hr-background';
import { recordAuditEvent } from '../audit/audit-events';
import { resolveApprovalChain } from '../organisation/approval-chain';
import { hasCompanyPermission, resolveScopedPermission, type PermissionAuthority } from '../organisation/scoped-permissions';

type Middleware = express.RequestHandler;
type Dependencies = { standardAuth: Middleware; mutationGuard: Middleware; rateLimiter: Middleware };
type LeaveBody = { leaveType?: unknown; startDate?: unknown; endDate?: unknown; reason?: unknown; expectedVersion?: unknown };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{3,4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{3,12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LEAVE_TYPES = new Set(['annual', 'sick', 'unpaid', 'personal']);
const MAX_LEAVE_DAYS = 366;
const APPROVAL_NOTE_MAX_LENGTH = 1000;
const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
const uuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

function strictFields(body: unknown, allowed: string[]) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !allowed.includes(key))) {
    throw fail(400, 'Leave request payload is invalid.');
  }
}

function dateOnly(value: unknown, name: string) {
  if (typeof value !== 'string' || !DATE.test(value)) throw fail(400, `${name} must use YYYY-MM-DD.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw fail(400, `${name} is invalid.`);
  return value;
}

function normaliseCreate(body: LeaveBody) {
  const leaveType = typeof body.leaveType === 'string' ? body.leaveType.trim().toLowerCase() : '';
  const startDate = dateOnly(body.startDate, 'startDate');
  const endDate = dateOnly(body.endDate, 'endDate');
  const reason = body.reason === undefined || body.reason === null ? null : typeof body.reason === 'string' ? body.reason.trim().slice(0, 1000) || null : (() => { throw fail(400, 'reason must be text.'); })();
  if (!LEAVE_TYPES.has(leaveType)) throw fail(400, 'leaveType is invalid.');
  const durationDays = Math.floor((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000) + 1;
  if (durationDays < 1 || durationDays > MAX_LEAVE_DAYS) throw fail(400, `Leave requests may not exceed ${MAX_LEAVE_DAYS} days.`);
  return { leaveType, startDate, endDate, reason, durationDays };
}

function page(value: unknown, fallback: number, maximum: number) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? Math.min(number, maximum) : fallback;
}

function safeLeave(row: any) {
  return {
    requestId: row.request_id || row.id,
    leaveType: row.leave_type,
    startDate: row.start_date,
    endDate: row.end_date,
    reason: row.reason || null,
    status: row.status,
    submittedAt: row.submitted_at,
    cancelledAt: row.cancelled_at || null,
    approvalPending: row.status === 'pending',
    approvalConfigured: Boolean(row.approver_employee_id),
    decisionAt: row.approval_decided_at || null,
    approvedAt: row.approved_at || null,
    rejectedAt: row.rejected_at || null,
    version: row.version,
  };
}

const sourceLabels: Record<string, string> = {
  direct_manager: 'Direct manager',
  team_leader: 'Team leader',
  department_head: 'Department head',
  reporting_chain: 'Reporting chain',
  scoped_role: 'Scoped authority',
  delegation: 'Delegated authority',
  hr_admin: 'Company leave authority',
};

function approvalSelect(includeReason = false) {
  return `request.id AS request_id,request.employee_id,request.leave_type,request.start_date,request.end_date,${includeReason ? 'request.reason,' : ''}
    request.status,request.submitted_at,request.cancelled_at,request.version,request.approver_employee_id,request.approval_source,
    request.approval_scope_type,request.approval_scope_id,request.approval_resolved_at,request.approval_decided_at,
    request.approved_at,request.rejected_at,employee.full_name AS employee_name,employee.department_id,employee.team_id,
    department.name AS department_name,team.name AS team_name,team.location_id,location.name AS location_name,
    approver.full_name AS approver_name`;
}

const approvalJoins = `FROM leave_requests request
  JOIN employees employee ON employee.tenant_id=request.tenant_id AND employee.id=request.employee_id
  LEFT JOIN organisation_departments department ON department.tenant_id=employee.tenant_id AND department.id=employee.department_id
  LEFT JOIN organisation_teams team ON team.tenant_id=employee.tenant_id AND team.id=employee.team_id
  LEFT JOIN company_locations location ON location.tenant_id=team.tenant_id AND location.id=team.location_id
  LEFT JOIN employees approver ON approver.tenant_id=request.tenant_id AND approver.id=request.approver_employee_id`;

function scopeLabel(row: any) {
  if (!row.approval_scope_type) return null;
  if (row.approval_scope_type === 'company') return 'Company';
  if (row.approval_scope_type === 'department') return row.department_name || 'Department';
  if (row.approval_scope_type === 'team') return row.team_name || 'Team';
  if (row.approval_scope_type === 'location') return row.location_name || 'Location';
  if (row.approval_scope_type === 'direct_reports') return 'Direct reports';
  return 'Personal scope';
}

function safeApproval(row: any, includeReason = false) {
  return {
    requestId: row.request_id,
    employee: { employeeId: row.employee_id, displayName: row.employee_name },
    leaveType: row.leave_type,
    startDate: row.start_date,
    endDate: row.end_date,
    ...(includeReason ? { reason: row.reason || null } : {}),
    status: row.status,
    submittedAt: row.submitted_at,
    version: row.version,
    approverDisplayName: row.approver_name || null,
    approvalSourceLabel: row.approval_source ? sourceLabels[row.approval_source] || 'Configured authority' : 'Awaiting configuration',
    scopeLabel: scopeLabel(row),
    decisionAt: row.approval_decided_at || null,
  };
}

async function requireActiveActor(client: PoolClient, tenantId: string, employeeId: string) {
  const active = (await client.query(
    `SELECT 1 FROM employees WHERE tenant_id=$1 AND id=$2 AND is_active=true AND employment_status='active'`,
    [tenantId, employeeId],
  )).rows[0];
  if (!active) throw fail(403, 'Only active employees may access leave approvals.');
}

type ApprovalAccess = { canView: boolean; canDecide: boolean; authority: PermissionAuthority | null };

async function approvalAccess(client: PoolClient, tenantId: string, actorId: string, request: any): Promise<ApprovalAccess> {
  if (request.employee_id === actorId) return { canView: false, canDecide: false, authority: null };
  if (request.approver_employee_id === actorId) {
    if (request.approval_source !== 'delegation') return { canView: true, canDecide: true, authority: null };
    const delegated = await resolveScopedPermission(client, { tenantId, actorEmployeeId: actorId, permissionKey: 'leave.approve', targetEmployeeId: request.employee_id });
    if (delegated.allowed && delegated.source === 'delegation') return { canView: true, canDecide: true, authority: delegated };
  }
  for (const permissionKey of ['leave.manage', 'leave.approve'] as const) {
    const authority = await resolveScopedPermission(client, { tenantId, actorEmployeeId: actorId, permissionKey, targetEmployeeId: request.employee_id });
    if (authority.allowed) return { canView: true, canDecide: true, authority };
  }
  const view = await resolveScopedPermission(client, { tenantId, actorEmployeeId: actorId, permissionKey: 'leave.view.scoped', targetEmployeeId: request.employee_id });
  return { canView: view.allowed, canDecide: false, authority: view.allowed ? view : null };
}

async function notify(client: PoolClient, input: { tenantId: string; eventType: string; requestId: string; employeeId: string; idempotencyKey: string }) {
  const payload = {
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    employeeId: input.employeeId,
    notificationKey: 'leave_updates',
    deepLink: { section: 'roster', view: 'leave', requestId: input.requestId },
  };
  await client.query(
    `INSERT INTO outbox_events(tenant_id,event_type,payload)
     SELECT $1,$2,$3::jsonb
     WHERE NOT EXISTS (
       SELECT 1 FROM outbox_events WHERE tenant_id=$1 AND event_type=$2 AND payload->>'idempotencyKey'=$4
     )`,
    [input.tenantId, input.eventType, JSON.stringify(payload), input.idempotencyKey],
  );
}

async function notifyUnconfiguredAuthorities(client: PoolClient, tenantId: string, requestId: string) {
  const recipients = (await client.query(
    `SELECT DISTINCT assignment.employee_id
     FROM employee_role_assignments assignment
     JOIN tenant_role_permissions permission ON permission.tenant_id=assignment.tenant_id AND permission.role_id=assignment.role_id
     JOIN employees employee ON employee.tenant_id=assignment.tenant_id AND employee.id=assignment.employee_id
     WHERE assignment.tenant_id=$1 AND permission.permission_key='leave.manage' AND assignment.scope_type='company'
       AND assignment.revoked_at IS NULL AND assignment.assigned_at<=NOW()
       AND (assignment.expires_at IS NULL OR assignment.expires_at>NOW())
       AND employee.is_active=true AND employee.employment_status='active'`,
    [tenantId],
  )).rows;
  for (const recipient of recipients) {
    await notify(client, { tenantId, eventType: 'notification.leave_approver_unconfigured', requestId, employeeId: recipient.employee_id, idempotencyKey: `leave-approver-unconfigured:${requestId}:${recipient.employee_id}` });
  }
}

async function requireActiveSelfPermission(client: PoolClient, req: express.Request, permissionKey: 'leave.request.self' | 'leave.view.self' | 'leave.cancel.self') {
  const user = req.authUser!;
  const employee = (await client.query(
    `SELECT 1 FROM employees WHERE tenant_id=$1 AND id=$2 AND is_active=true AND employment_status='active'`,
    [user.tenantId, user.employeeId],
  )).rows[0];
  if (!employee) throw fail(403, 'Only active employees may manage personal leave.');
  const authority = await hasCompanyPermission(client, user.tenantId, user.employeeId, permissionKey);
  if (authority.allowed) return;
  // Existing custom roles can retain the historical personal-leave capability.
  const legacy = await hasCompanyPermission(client, user.tenantId, user.employeeId, 'leave.create');
  if (!legacy.allowed) throw fail(403, 'You do not have permission to manage personal leave.');
}

async function history(client: PoolClient, input: { tenantId: string; requestId: string; actorId: string; action: string; previousStatus: string | null; nextStatus: string; metadata: Record<string, unknown> }) {
  await client.query(
    `INSERT INTO leave_request_history(tenant_id,leave_request_id,actor_employee_id,action,previous_status,new_status,metadata)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [input.tenantId, input.requestId, input.actorId, input.action, input.previousStatus, input.nextStatus, JSON.stringify(input.metadata)],
  );
}

function send(res: express.Response, error: unknown, fallback: string) {
  const typed = error as { statusCode?: number; message?: string };
  if (!typed.statusCode || typed.statusCode >= 500) console.error('[Leave]', error);
  res.status(typed.statusCode || 500).json({ success: false, error: typed.statusCode ? typed.message : fallback });
}

export function registerLeaveRoutes(app: express.Express, { standardAuth, mutationGuard, rateLimiter }: Dependencies) {
  app.get('/api/me/leave-requests', standardAuth, async (req, res) => {
    try {
      const user = req.authUser!;
      const status = typeof req.query.status === 'string' && ['pending', 'approved', 'rejected', 'cancelled'].includes(req.query.status) ? req.query.status : null;
      const fromDate = req.query.fromDate === undefined ? null : dateOnly(req.query.fromDate, 'fromDate');
      const toDate = req.query.toDate === undefined ? null : dateOnly(req.query.toDate, 'toDate');
      if (fromDate && toDate && fromDate > toDate) throw fail(400, 'fromDate must not be after toDate.');
      const result = await withTenant(user.tenantId, async (client) => {
        await requireActiveSelfPermission(client, req, 'leave.view.self');
        const currentPage = page(req.query.page, 1, 10_000);
        const pageSize = page(req.query.pageSize, 25, 100);
        const where = `tenant_id=$1 AND employee_id=$2 AND ($3::text IS NULL OR status=$3) AND ($4::date IS NULL OR end_date >= $4) AND ($5::date IS NULL OR start_date <= $5)`;
        const requests = (await client.query(
          `SELECT id AS request_id,leave_type,start_date,end_date,reason,status,submitted_at,cancelled_at,approver_employee_id,
             approval_decided_at,approved_at,rejected_at,version
           FROM leave_requests WHERE ${where} ORDER BY submitted_at DESC,id DESC LIMIT $6 OFFSET $7`,
          [user.tenantId, user.employeeId, status, fromDate, toDate, pageSize, (currentPage - 1) * pageSize],
        )).rows.map(safeLeave);
        const total = (await client.query(`SELECT count(*)::int AS count FROM leave_requests WHERE ${where}`, [user.tenantId, user.employeeId, status, fromDate, toDate])).rows[0].count;
        return { requests, total, page: currentPage, pageSize };
      });
      res.json({ success: true, ...result });
    } catch (error) { send(res, error, 'Unable to load leave requests.'); }
  });

  app.post('/api/me/leave-requests', rateLimiter, standardAuth, mutationGuard, async (req, res) => {
    try {
      strictFields(req.body, ['leaveType', 'startDate', 'endDate', 'reason']);
      const value = normaliseCreate(req.body || {});
      const user = req.authUser!;
      const request = await withTenant(user.tenantId, async (client) => {
        await client.query('BEGIN');
        try {
          await requireActiveSelfPermission(client, req, 'leave.request.self');
          const collision = (await client.query(
            `SELECT 1 FROM leave_requests
             WHERE tenant_id=$1 AND employee_id=$2 AND leave_type=$3 AND start_date=$4 AND end_date=$5 AND status='pending'
             UNION ALL
             SELECT 1 FROM leave_requests
             WHERE tenant_id=$1 AND employee_id=$2 AND status IN ('pending','approved') AND start_date <= $6 AND end_date >= $5
             LIMIT 1`,
            [user.tenantId, user.employeeId, value.leaveType, value.startDate, value.endDate, value.endDate],
          )).rows[0];
          if (collision) throw fail(409, 'This leave request conflicts with an existing pending or approved request.');
          const created = (await client.query(
            `INSERT INTO leave_requests(tenant_id,employee_id,leave_type,start_date,end_date,reason,status,submitted_at,version)
             VALUES($1,$2,$3,$4,$5,$6,'pending',NOW(),1)
             RETURNING id AS request_id,employee_id,leave_type,start_date,end_date,reason,status,submitted_at,cancelled_at,version`,
            [user.tenantId, user.employeeId, value.leaveType, value.startDate, value.endDate, value.reason],
          )).rows[0];
          const placement = (await client.query(
            `SELECT employee.team_id,employee.department_id,team.location_id
             FROM employees employee
             LEFT JOIN organisation_teams team ON team.tenant_id=employee.tenant_id AND team.id=employee.team_id
             WHERE employee.tenant_id=$1 AND employee.id=$2`,
            [user.tenantId, user.employeeId],
          )).rows[0];
          const resolution = await resolveApprovalChain(client, {
            tenantId: user.tenantId,
            requestingEmployeeId: user.employeeId,
            requiredPermissionKey: 'leave.approve',
            targetTeamId: placement?.team_id,
            targetDepartmentId: placement?.department_id,
            targetLocationId: placement?.location_id,
            excludedEmployeeIds: [user.employeeId],
          });
          const row = (await client.query(
            `UPDATE leave_requests SET approver_employee_id=$3,approval_source=$4,approval_scope_type=$5,
               approval_scope_id=$6,approval_resolved_at=NOW(),updated_at=NOW()
             WHERE tenant_id=$1 AND id=$2
             RETURNING id AS request_id,employee_id,leave_type,start_date,end_date,reason,status,submitted_at,cancelled_at,
               approver_employee_id,approval_decided_at,approved_at,rejected_at,version`,
            [user.tenantId, created.request_id, resolution.approverEmployeeId, resolution.source, resolution.resolvedScopeType, resolution.resolvedScopeId],
          )).rows[0];
          await history(client, { tenantId: user.tenantId, requestId: row.request_id, actorId: user.employeeId, action: 'requested', previousStatus: null, nextStatus: 'pending', metadata: { leaveType: value.leaveType, startDate: value.startDate, endDate: value.endDate } });
          await recordAuditEvent(client, { tenantId: user.tenantId, actorId: user.employeeId, action: 'leave.requested', targetType: 'leave_request', targetId: row.request_id, metadata: { leaveType: value.leaveType, startDate: value.startDate, endDate: value.endDate } });
          if (resolution.approverEmployeeId) {
            await history(client, { tenantId: user.tenantId, requestId: row.request_id, actorId: user.employeeId, action: 'approver_resolved', previousStatus: 'pending', nextStatus: 'pending', metadata: { approverEmployeeId: resolution.approverEmployeeId, approvalSource: resolution.source, scopeType: resolution.resolvedScopeType } });
            await recordAuditEvent(client, { tenantId: user.tenantId, actorId: user.employeeId, action: 'leave.approver_resolved', targetType: 'leave_request', targetId: row.request_id, metadata: { requestId: row.request_id, employeeId: user.employeeId, approverEmployeeId: resolution.approverEmployeeId, leaveType: value.leaveType, startDate: value.startDate, endDate: value.endDate, approvalSource: resolution.source, scopeType: resolution.resolvedScopeType, status: 'pending' } });
            await notify(client, { tenantId: user.tenantId, eventType: 'notification.leave_approval_required', requestId: row.request_id, employeeId: resolution.approverEmployeeId, idempotencyKey: `leave-approval-required:${row.request_id}` });
          } else {
            await history(client, { tenantId: user.tenantId, requestId: row.request_id, actorId: user.employeeId, action: 'approver_unconfigured', previousStatus: 'pending', nextStatus: 'pending', metadata: { leaveType: value.leaveType } });
            await recordAuditEvent(client, { tenantId: user.tenantId, actorId: user.employeeId, action: 'leave.approver_unconfigured', targetType: 'leave_request', targetId: row.request_id, metadata: { requestId: row.request_id, employeeId: user.employeeId, leaveType: value.leaveType, startDate: value.startDate, endDate: value.endDate, status: 'pending' } });
            await notifyUnconfiguredAuthorities(client, user.tenantId, row.request_id);
          }
          await client.query('COMMIT');
          return safeLeave(row);
        } catch (error) { await client.query('ROLLBACK'); throw error; }
      });
      res.status(201).json({ success: true, request });
    } catch (error) { send(res, error, 'Unable to create leave request.'); }
  });

  app.get('/api/me/leave-requests/:requestId', standardAuth, async (req, res) => {
    try {
      const user = req.authUser!;
      if (!uuid(req.params.requestId)) throw fail(404, 'Leave request not found.');
      const result = await withTenant(user.tenantId, async (client) => {
        await requireActiveSelfPermission(client, req, 'leave.view.self');
        const request = (await client.query(
          `SELECT id AS request_id,leave_type,start_date,end_date,reason,status,submitted_at,cancelled_at,approver_employee_id,
             approval_decided_at,approved_at,rejected_at,version
           FROM leave_requests WHERE tenant_id=$1 AND employee_id=$2 AND id=$3`,
          [user.tenantId, user.employeeId, req.params.requestId],
        )).rows[0];
        if (!request) throw fail(404, 'Leave request not found.');
        const historyRows = (await client.query(
          `SELECT action,previous_status AS "previousStatus",new_status AS "newStatus",created_at AS "createdAt"
           FROM leave_request_history WHERE tenant_id=$1 AND leave_request_id=$2 ORDER BY created_at ASC,id ASC`,
          [user.tenantId, req.params.requestId],
        )).rows;
        return { request: safeLeave(request), history: historyRows };
      });
      res.json({ success: true, ...result });
    } catch (error) { send(res, error, 'Unable to load leave request.'); }
  });

  app.post('/api/me/leave-requests/:requestId/cancel', rateLimiter, standardAuth, mutationGuard, async (req, res) => {
    try {
      strictFields(req.body, ['expectedVersion']);
      const user = req.authUser!;
      if (!uuid(req.params.requestId) || !Number.isInteger(req.body?.expectedVersion) || req.body.expectedVersion < 1) throw fail(400, 'Leave request cancellation is invalid.');
      const request = await withTenant(user.tenantId, async (client) => {
        await client.query('BEGIN');
        try {
          await requireActiveSelfPermission(client, req, 'leave.cancel.self');
          const current = (await client.query(
            `SELECT id,leave_type,start_date,end_date,status,version FROM leave_requests
             WHERE tenant_id=$1 AND employee_id=$2 AND id=$3 FOR UPDATE`,
            [user.tenantId, user.employeeId, req.params.requestId],
          )).rows[0];
          if (!current) throw fail(404, 'Leave request not found.');
          if (current.status !== 'pending') throw fail(409, 'Only pending leave requests may be cancelled.');
          if (current.version !== req.body.expectedVersion) throw fail(409, 'Leave request changed. Refresh and try again.');
          const row = (await client.query(
            `UPDATE leave_requests SET status='cancelled',cancelled_at=NOW(),updated_at=NOW(),version=version+1
             WHERE tenant_id=$1 AND employee_id=$2 AND id=$3 AND status='pending' AND version=$4
             RETURNING id AS request_id,leave_type,start_date,end_date,reason,status,submitted_at,cancelled_at,approver_employee_id,
               approval_decided_at,approved_at,rejected_at,version`,
            [user.tenantId, user.employeeId, current.id, current.version],
          )).rows[0];
          if (!row) throw fail(409, 'Leave request changed. Refresh and try again.');
          await history(client, { tenantId: user.tenantId, requestId: current.id, actorId: user.employeeId, action: 'cancelled', previousStatus: 'pending', nextStatus: 'cancelled', metadata: { leaveType: current.leave_type, startDate: current.start_date, endDate: current.end_date } });
          await recordAuditEvent(client, { tenantId: user.tenantId, actorId: user.employeeId, action: 'leave.cancelled', targetType: 'leave_request', targetId: current.id, metadata: { leaveType: current.leave_type, startDate: current.start_date, endDate: current.end_date, status: 'cancelled' } });
          await client.query('COMMIT');
          return safeLeave(row);
        } catch (error) { await client.query('ROLLBACK'); throw error; }
      });
      res.json({ success: true, request });
    } catch (error) { send(res, error, 'Unable to cancel leave request.'); }
  });

  app.get('/api/hr/leave-requests', standardAuth, async (req, res) => {
    try {
      const user = req.authUser!;
      const status = req.query.status === undefined ? null : String(req.query.status);
      if (status && !['pending', 'approved', 'rejected', 'cancelled'].includes(status)) throw fail(400, 'status is invalid.');
      const leaveType = req.query.leaveType === undefined ? null : String(req.query.leaveType).toLowerCase();
      if (leaveType && !LEAVE_TYPES.has(leaveType)) throw fail(400, 'leaveType is invalid.');
      const ids = ['employeeId', 'departmentId', 'teamId', 'locationId'] as const;
      for (const key of ids) if (req.query[key] !== undefined && !uuid(req.query[key])) throw fail(400, `${key} is invalid.`);
      const fromDate = req.query.fromDate === undefined ? null : dateOnly(req.query.fromDate, 'fromDate');
      const toDate = req.query.toDate === undefined ? null : dateOnly(req.query.toDate, 'toDate');
      if (fromDate && toDate && fromDate > toDate) throw fail(400, 'fromDate must not be after toDate.');
      if (req.query.actionableOnly !== undefined && !['true', 'false'].includes(String(req.query.actionableOnly))) throw fail(400, 'actionableOnly is invalid.');
      const actionableOnly = String(req.query.actionableOnly) === 'true';
      const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 120) || null : null;
      const currentPage = page(req.query.page, 1, 10_000);
      const pageSize = page(req.query.pageSize, 25, 100);
      const result = await withTenant(user.tenantId, async (client) => {
        await requireActiveActor(client, user.tenantId, user.employeeId);
        const rows = (await client.query(
          `SELECT ${approvalSelect()} ${approvalJoins}
           WHERE request.tenant_id=$1
             AND ($2::text IS NULL OR request.status=$2)
             AND ($3::uuid IS NULL OR request.employee_id=$3)
             AND ($4::uuid IS NULL OR employee.department_id=$4)
             AND ($5::uuid IS NULL OR employee.team_id=$5)
             AND ($6::uuid IS NULL OR team.location_id=$6)
             AND ($7::text IS NULL OR request.leave_type=$7)
             AND ($8::date IS NULL OR request.end_date >= $8)
             AND ($9::date IS NULL OR request.start_date <= $9)
             AND ($10::text IS NULL OR employee.full_name ILIKE '%'||$10||'%')
           ORDER BY request.submitted_at DESC,request.id DESC`,
          [user.tenantId, status, req.query.employeeId || null, req.query.departmentId || null, req.query.teamId || null, req.query.locationId || null, leaveType, fromDate, toDate, search],
        )).rows;
        const visible: Array<{ row: any; access: ApprovalAccess }> = [];
        for (const row of rows) {
          const access = await approvalAccess(client, user.tenantId, user.employeeId, row);
          if (access.canView && (!actionableOnly || (row.status === 'pending' && access.canDecide))) visible.push({ row, access });
        }
        const offset = (currentPage - 1) * pageSize;
        return {
          requests: visible.slice(offset, offset + pageSize).map(({ row, access }) => ({ ...safeApproval(row), canDecide: row.status === 'pending' && access.canDecide })),
          total: visible.length,
          page: currentPage,
          pageSize,
        };
      });
      res.json({ success: true, ...result });
    } catch (error) { send(res, error, 'Unable to load leave approvals.'); }
  });

  app.get('/api/hr/leave-requests/:requestId', standardAuth, async (req, res) => {
    try {
      const user = req.authUser!;
      if (!uuid(req.params.requestId)) throw fail(404, 'Leave request not found.');
      const result = await withTenant(user.tenantId, async (client) => {
        await requireActiveActor(client, user.tenantId, user.employeeId);
        const row = (await client.query(
          `SELECT ${approvalSelect(true)} ${approvalJoins} WHERE request.tenant_id=$1 AND request.id=$2`,
          [user.tenantId, req.params.requestId],
        )).rows[0];
        if (!row) throw fail(404, 'Leave request not found.');
        const access = await approvalAccess(client, user.tenantId, user.employeeId, row);
        if (!access.canView) throw fail(404, 'Leave request not found.');
        const historyRows = (await client.query(
          `SELECT action,previous_status AS "previousStatus",new_status AS "newStatus",created_at AS "createdAt"
           FROM leave_request_history WHERE tenant_id=$1 AND leave_request_id=$2 ORDER BY created_at ASC,id ASC`,
          [user.tenantId, req.params.requestId],
        )).rows;
        return { request: { ...safeApproval(row, true), canDecide: row.status === 'pending' && access.canDecide }, history: historyRows };
      });
      res.json({ success: true, ...result });
    } catch (error) { send(res, error, 'Unable to load leave request.'); }
  });

  const decide = (decision: 'approved' | 'rejected') => async (req: express.Request, res: express.Response) => {
    try {
      strictFields(req.body, ['expectedVersion', 'note']);
      const user = req.authUser!;
      if (typeof req.body?.note === 'string' && req.body.note.length > APPROVAL_NOTE_MAX_LENGTH) throw fail(400, `note must be ${APPROVAL_NOTE_MAX_LENGTH} characters or fewer.`);
      const note = req.body?.note === undefined || req.body.note === null
        ? null
        : typeof req.body.note === 'string' ? req.body.note.trim() || null : (() => { throw fail(400, 'note must be text.'); })();
      if (!uuid(req.params.requestId)) throw fail(404, 'Leave request not found.');
      if (!Number.isInteger(req.body?.expectedVersion) || req.body.expectedVersion < 1) throw fail(400, 'expectedVersion is invalid.');
      const request = await withTenant(user.tenantId, async (client) => {
        await client.query('BEGIN');
        try {
          await requireActiveActor(client, user.tenantId, user.employeeId);
          const current = (await client.query(
            `SELECT ${approvalSelect(true)} ${approvalJoins}
             WHERE request.tenant_id=$1 AND request.id=$2 FOR UPDATE OF request`,
            [user.tenantId, req.params.requestId],
          )).rows[0];
          if (!current) throw fail(404, 'Leave request not found.');
          const access = await approvalAccess(client, user.tenantId, user.employeeId, current);
          if (!access.canDecide || current.employee_id === user.employeeId) throw fail(404, 'Leave request not found.');
          if (current.status !== 'pending') throw fail(409, 'Leave request has already been decided or cancelled.');
          if (current.version !== req.body.expectedVersion) throw fail(409, 'Leave request changed. Refresh and try again.');
          if (decision === 'approved') {
            const overlap = (await client.query(
              `SELECT 1 FROM leave_requests WHERE tenant_id=$1 AND employee_id=$2 AND id<>$3
               AND status='approved' AND start_date<=$5 AND end_date>=$4 LIMIT 1`,
              [user.tenantId, current.employee_id, current.request_id, current.start_date, current.end_date],
            )).rows[0];
            if (overlap) throw fail(409, 'This employee already has approved leave in the requested date range.');
          }
          const actedThroughStoredRoute = current.approver_employee_id === user.employeeId && current.approval_source !== 'delegation';
          const decisionSource = actedThroughStoredRoute ? current.approval_source : access.authority?.source === 'delegation' ? 'delegation' : 'scoped_role';
          const decisionScopeType = actedThroughStoredRoute ? current.approval_scope_type : access.authority?.resolvedScope?.type || current.approval_scope_type;
          const decisionScopeId = actedThroughStoredRoute ? current.approval_scope_id : access.authority?.resolvedScope?.id || current.approval_scope_id;
          const row = (await client.query(
            `UPDATE leave_requests SET status=$5,approver_employee_id=$3,approval_source=$6,approval_scope_type=$7,
               approval_scope_id=$8,approval_note=$9,approval_decided_at=NOW(),approved_at=CASE WHEN $5='approved' THEN NOW() ELSE NULL END,
               rejected_at=CASE WHEN $5='rejected' THEN NOW() ELSE NULL END,updated_at=NOW(),version=version+1
             WHERE tenant_id=$1 AND id=$2 AND status='pending' AND version=$4
             RETURNING id AS request_id,leave_type,start_date,end_date,status,submitted_at,cancelled_at,approver_employee_id,
               approval_decided_at,approved_at,rejected_at,version`,
            [user.tenantId, current.request_id, user.employeeId, current.version, decision, decisionSource, decisionScopeType, decisionScopeId, note],
          )).rows[0];
          if (!row) throw fail(409, 'Leave request changed. Refresh and try again.');
          await history(client, { tenantId: user.tenantId, requestId: current.request_id, actorId: user.employeeId, action: decision, previousStatus: 'pending', nextStatus: decision, metadata: { leaveType: current.leave_type, startDate: current.start_date, endDate: current.end_date, approvalSource: decisionSource, scopeType: decisionScopeType } });
          await recordAuditEvent(client, { tenantId: user.tenantId, actorId: user.employeeId, action: decision === 'approved' ? 'leave.approved' : 'leave.rejected', targetType: 'leave_request', targetId: current.request_id, metadata: { requestId: current.request_id, employeeId: current.employee_id, approverEmployeeId: user.employeeId, leaveType: current.leave_type, startDate: current.start_date, endDate: current.end_date, approvalSource: decisionSource, scopeType: decisionScopeType, status: decision } });
          await notify(client, { tenantId: user.tenantId, eventType: decision === 'approved' ? 'notification.leave_approved' : 'notification.leave_rejected', requestId: current.request_id, employeeId: current.employee_id, idempotencyKey: `${decision === 'approved' ? 'leave-approved' : 'leave-rejected'}:${current.request_id}` });
          await client.query('COMMIT');
          return safeLeave(row);
        } catch (error) { await client.query('ROLLBACK'); throw error; }
      });
      res.json({ success: true, request });
    } catch (error) { send(res, error, `Unable to ${decision === 'approved' ? 'approve' : 'reject'} leave request.`); }
  };

  app.post('/api/hr/leave-requests/:requestId/approve', rateLimiter, standardAuth, mutationGuard, decide('approved'));
  app.post('/api/hr/leave-requests/:requestId/reject', rateLimiter, standardAuth, mutationGuard, decide('rejected'));
}
