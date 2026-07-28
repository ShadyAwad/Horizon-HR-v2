import type express from 'express';
import type { PoolClient } from 'pg';
import { withTenant } from '../../lib/hr-background';
import { recordAuditEvent } from '../audit/audit-events';
import { hasCompanyPermission } from '../organisation/scoped-permissions';

type Middleware = express.RequestHandler;
type Dependencies = { standardAuth: Middleware; mutationGuard: Middleware; rateLimiter: Middleware };
type LeaveBody = { leaveType?: unknown; startDate?: unknown; endDate?: unknown; reason?: unknown; expectedVersion?: unknown };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{3,4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{3,12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LEAVE_TYPES = new Set(['annual', 'sick', 'unpaid', 'personal']);
const MAX_LEAVE_DAYS = 366;
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
    version: row.version,
  };
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
          `SELECT id AS request_id,leave_type,start_date,end_date,reason,status,submitted_at,cancelled_at,version
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
          const row = (await client.query(
            `INSERT INTO leave_requests(tenant_id,employee_id,leave_type,start_date,end_date,reason,status,submitted_at,version)
             VALUES($1,$2,$3,$4,$5,$6,'pending',NOW(),1)
             RETURNING id AS request_id,leave_type,start_date,end_date,reason,status,submitted_at,cancelled_at,version`,
            [user.tenantId, user.employeeId, value.leaveType, value.startDate, value.endDate, value.reason],
          )).rows[0];
          await history(client, { tenantId: user.tenantId, requestId: row.request_id, actorId: user.employeeId, action: 'requested', previousStatus: null, nextStatus: 'pending', metadata: { leaveType: value.leaveType, startDate: value.startDate, endDate: value.endDate } });
          await recordAuditEvent(client, { tenantId: user.tenantId, actorId: user.employeeId, action: 'leave.requested', targetType: 'leave_request', targetId: row.request_id, metadata: { leaveType: value.leaveType, startDate: value.startDate, endDate: value.endDate } });
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
          `SELECT id AS request_id,leave_type,start_date,end_date,reason,status,submitted_at,cancelled_at,version
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
             RETURNING id AS request_id,leave_type,start_date,end_date,reason,status,submitted_at,cancelled_at,version`,
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
}
