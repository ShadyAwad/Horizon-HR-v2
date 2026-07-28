import type express from 'express';
import { withTenant } from '../../lib/hr-background';
import { recordAuditEvent } from '../audit/audit-events';
import { resolveApprovalChain } from '../organisation/approval-chain';
import { resolveScopedPermission } from '../organisation/scoped-permissions';

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
const fields = (body: unknown, allowed: string[]) => {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !allowed.includes(key))) throw fail(400, 'Shift-swap payload is invalid.');
};
const send = (res: express.Response, error: unknown, fallback: string) => {
  const value = error as { statusCode?: number; message?: string };
  if (!value.statusCode || value.statusCode >= 500) console.error('[Shift swaps]', error);
  res.status(value.statusCode || 500).json({ success: false, error: value.statusCode ? value.message : fallback });
};
const note = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim().slice(0, 1000) : null;

async function active(client: any, tenantId: string, employeeId: string) {
  const employee = (await client.query(
    `SELECT 1 FROM employees WHERE tenant_id=$1 AND id=$2 AND is_active=true AND employment_status='active'`,
    [tenantId, employeeId],
  )).rows[0];
  if (!employee) throw fail(400, 'Shift-swap participants must be active tenant employees.');
}

/** Locks both shifts and validates the *proposed* ownership change without applying it. */
async function validateShifts(client: any, tenantId: string, request: any) {
  const rows = (await client.query(
    `SELECT id, employee_id, start_time, end_time, status
       FROM roster_shifts WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE`,
    [tenantId, [request.requesterShiftId, request.targetShiftId]],
  )).rows;
  if (rows.length !== 2) throw fail(404, 'Roster shift not found.');
  const requesterShift = rows.find((row: any) => row.id === request.requesterShiftId);
  const targetShift = rows.find((row: any) => row.id === request.targetShiftId);
  if (!requesterShift || !targetShift || requesterShift.employee_id !== request.requesterEmployeeId || targetShift.employee_id !== request.targetEmployeeId) throw fail(409, 'Each employee must own the selected shift. Shift ownership changed while this swap was pending.');
  for (const shift of rows) if (shift.status !== 'scheduled' || new Date(shift.start_time) <= new Date()) throw fail(409, 'Only future scheduled shifts can be swapped.');
  const overlap = await client.query(
    `SELECT 1 FROM roster_shifts
     WHERE tenant_id=$1 AND status='scheduled' AND (
       (employee_id=$2 AND id<>$3 AND start_time<$5 AND end_time>$4) OR
       (employee_id=$6 AND id<>$7 AND start_time<$9 AND end_time>$8)
     ) LIMIT 1`,
    [tenantId, request.targetEmployeeId, targetShift.id, requesterShift.start_time, requesterShift.end_time, request.requesterEmployeeId, requesterShift.id, targetShift.start_time, targetShift.end_time],
  );
  if (overlap.rows[0]) throw fail(409, 'The resulting schedules would overlap.');
  return { requesterShift, targetShift };
}

async function ensureNoActiveAttendance(client: any, tenantId: string, employeeIds: string[]) {
  const activeLog = (await client.query(
    `SELECT 1 FROM time_logs
     WHERE tenant_id=$1 AND employee_id=ANY($2::uuid[]) AND clock_out_time IS NULL
     LIMIT 1 FOR UPDATE`,
    [tenantId, employeeIds],
  )).rows[0];
  if (activeLog) throw fail(409, 'A shift-swap participant has an active attendance shift.');
}

async function canActOnSwap(client: any, tenantId: string, actorId: string, swap: any) {
  if (swap.approver_employee_id === actorId) return true;
  for (const permissionKey of ['roster.swap.manage', 'roster.swap.approve']) {
    const requester = await resolveScopedPermission(client, { tenantId, actorEmployeeId: actorId, permissionKey, targetEmployeeId: swap.requester_employee_id });
    const target = await resolveScopedPermission(client, { tenantId, actorEmployeeId: actorId, permissionKey, targetEmployeeId: swap.target_employee_id });
    if (requester.allowed && target.allowed) return true;
  }
  return false;
}

async function writeHistory(client: any, input: { tenantId: string; swap: any; actorId: string; action: string; previousStatus: string; nextStatus: string; metadata?: Record<string, unknown> }) {
  await client.query(
    `INSERT INTO shift_swap_history(tenant_id,shift_swap_request_id,actor_employee_id,action,previous_status,new_status,metadata)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [input.tenantId, input.swap.id, input.actorId, input.action, input.previousStatus, input.nextStatus, JSON.stringify(input.metadata || { swapId: input.swap.id })],
  );
}

async function notify(client: any, tenantId: string, type: string, employeeId: string | null, swapId: string) {
  if (!employeeId) return;
  await client.query(`INSERT INTO outbox_events(tenant_id,event_type,payload) VALUES($1,$2,$3::jsonb)`, [tenantId, type, JSON.stringify({ swapId, employeeId })]);
}

export function registerShiftSwapRoutes(app: express.Express, deps: { standardAuth: express.RequestHandler; mutationGuard: express.RequestHandler; rateLimiter: express.RequestHandler }) {
  const { standardAuth, mutationGuard, rateLimiter } = deps;

  app.post('/api/me/shift-swaps', rateLimiter, standardAuth, mutationGuard, async (req, res) => {
    try {
      fields(req.body, ['requesterShiftId', 'targetEmployeeId', 'targetShiftId', 'reason']);
      const user = req.authUser!;
      const body = req.body;
      if (!uuid(body.requesterShiftId) || !uuid(body.targetEmployeeId) || !uuid(body.targetShiftId) || body.targetEmployeeId === user.employeeId || (body.reason !== undefined && typeof body.reason !== 'string') || String(body.reason || '').length > 1000) throw fail(400, 'Shift-swap request is invalid.');
      const swap = await withTenant(user.tenantId, async (client) => {
        await client.query('BEGIN');
        try {
          await active(client, user.tenantId, user.employeeId);
          await active(client, user.tenantId, body.targetEmployeeId);
          await validateShifts(client, user.tenantId, { requesterEmployeeId: user.employeeId, targetEmployeeId: body.targetEmployeeId, requesterShiftId: body.requesterShiftId, targetShiftId: body.targetShiftId });
          const row = (await client.query(
            `INSERT INTO shift_swap_requests(tenant_id,requester_employee_id,target_employee_id,requester_shift_id,target_shift_id,reason)
             VALUES($1,$2,$3,$4,$5,$6) RETURNING id AS "swapId",status,version`,
            [user.tenantId, user.employeeId, body.targetEmployeeId, body.requesterShiftId, body.targetShiftId, note(body.reason)],
          )).rows[0];
          await writeHistory(client, { tenantId: user.tenantId, swap: { id: row.swapId }, actorId: user.employeeId, action: 'requested', previousStatus: '', nextStatus: 'pending_target' });
          await recordAuditEvent(client, { tenantId: user.tenantId, actorId: user.employeeId, action: 'roster.shift_swap.requested', targetType: 'shift_swap_request', targetId: row.swapId, metadata: { swapId: row.swapId, requesterEmployeeId: user.employeeId, targetEmployeeId: body.targetEmployeeId, status: row.status } });
          await client.query('COMMIT');
          return row;
        } catch (error) { await client.query('ROLLBACK'); throw error; }
      });
      res.status(201).json({ success: true, swap });
    } catch (error) { send(res, error, 'Unable to create shift swap.'); }
  });

  app.post('/api/me/shift-swaps/:swapId/respond', rateLimiter, standardAuth, mutationGuard, async (req, res) => {
    try {
      fields(req.body, ['decision', 'note']);
      const user = req.authUser!;
      const body = req.body;
      if (!uuid(req.params.swapId) || !['accept', 'decline'].includes(body.decision) || (body.note !== undefined && typeof body.note !== 'string')) throw fail(400, 'Shift-swap response is invalid.');
      const swap = await withTenant(user.tenantId, async (client) => {
        await client.query('BEGIN');
        try {
          const current = (await client.query(`SELECT * FROM shift_swap_requests WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [user.tenantId, req.params.swapId])).rows[0];
          if (!current) throw fail(404, 'Shift swap not found.');
          if (current.target_employee_id !== user.employeeId) throw fail(403, 'Only the target employee may respond.');
          if (current.status !== 'pending_target') throw fail(409, 'Shift swap is no longer awaiting target response.');
          await validateShifts(client, user.tenantId, { requesterEmployeeId: current.requester_employee_id, targetEmployeeId: current.target_employee_id, requesterShiftId: current.requester_shift_id, targetShiftId: current.target_shift_id });
          if (body.decision === 'decline') {
            const row = (await client.query(`UPDATE shift_swap_requests SET status='target_declined',target_responded_at=NOW(),target_response_note=$3,version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING id AS "swapId",status,version`, [user.tenantId, current.id, note(body.note)])).rows[0];
            await writeHistory(client, { tenantId: user.tenantId, swap: current, actorId: user.employeeId, action: 'target_declined', previousStatus: 'pending_target', nextStatus: 'target_declined' });
            await recordAuditEvent(client, { tenantId: user.tenantId, actorId: user.employeeId, action: 'roster.shift_swap.target_declined', targetType: 'shift_swap_request', targetId: current.id, metadata: { swapId: current.id, requesterEmployeeId: current.requester_employee_id, targetEmployeeId: current.target_employee_id, status: 'target_declined' } });
            await client.query('COMMIT');
            return row;
          }
          const requester = (await client.query(`SELECT team_id,department_id FROM employees WHERE tenant_id=$1 AND id=$2`, [user.tenantId, current.requester_employee_id])).rows[0];
          const resolution = await resolveApprovalChain(client, { tenantId: user.tenantId, requestingEmployeeId: current.requester_employee_id, requiredPermissionKey: 'roster.swap.approve', targetTeamId: requester?.team_id, targetDepartmentId: requester?.department_id, excludedEmployeeIds: [current.requester_employee_id, current.target_employee_id] });
          const row = (await client.query(
            `UPDATE shift_swap_requests SET status='pending_approval',target_responded_at=NOW(),target_response_note=$3,approver_employee_id=$4,approval_source=$5,approval_scope_type=$6,approval_scope_id=$7,version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING id AS "swapId",status,version,approver_employee_id AS "approverEmployeeId"`,
            [user.tenantId, current.id, note(body.note), resolution.approverEmployeeId, resolution.source, resolution.resolvedScopeType, resolution.resolvedScopeId],
          )).rows[0];
          await writeHistory(client, { tenantId: user.tenantId, swap: current, actorId: user.employeeId, action: 'target_accepted', previousStatus: 'pending_target', nextStatus: 'pending_approval', metadata: { swapId: current.id, approverEmployeeId: resolution.approverEmployeeId, approvalSource: resolution.source } });
          await recordAuditEvent(client, { tenantId: user.tenantId, actorId: user.employeeId, action: 'roster.shift_swap.target_accepted', targetType: 'shift_swap_request', targetId: current.id, metadata: { swapId: current.id, requesterEmployeeId: current.requester_employee_id, targetEmployeeId: current.target_employee_id, status: 'pending_approval' } });
          await recordAuditEvent(client, { tenantId: user.tenantId, actorId: user.employeeId, action: 'roster.shift_swap.approver_resolved', targetType: 'shift_swap_request', targetId: current.id, metadata: { swapId: current.id, requesterEmployeeId: current.requester_employee_id, targetEmployeeId: current.target_employee_id, approverEmployeeId: resolution.approverEmployeeId, approvalSource: resolution.source, scopeType: resolution.resolvedScopeType, status: 'pending_approval' } });
          await notify(client, user.tenantId, resolution.approverEmployeeId ? 'notification.shift_swap_approval_required' : 'notification.shift_swap_approval_unconfigured', resolution.approverEmployeeId, current.id);
          if (!resolution.approverEmployeeId) await client.query(`INSERT INTO outbox_events(tenant_id,event_type,payload) VALUES($1,'notification.shift_swap_approval_unconfigured',$2::jsonb)`, [user.tenantId, JSON.stringify({ swapId: current.id })]);
          await client.query('COMMIT');
          return { ...row, approvalMessage: resolution.message };
        } catch (error) { await client.query('ROLLBACK'); throw error; }
      });
      res.json({ success: true, swap });
    } catch (error) { send(res, error, 'Unable to respond to shift swap.'); }
  });

  app.get('/api/me/shift-swaps', standardAuth, async (req, res) => {
    try {
      const user = req.authUser!;
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
      const status = typeof req.query.status === 'string' ? req.query.status : null;
      const role = ['requester', 'target'].includes(String(req.query.role)) ? String(req.query.role) : null;
      const result = await withTenant(user.tenantId, async (client) => {
        const where = `tenant_id=$1 AND (requester_employee_id=$2 OR target_employee_id=$2) AND ($3::text IS NULL OR status=$3) AND ($4::text IS NULL OR ($4='requester' AND requester_employee_id=$2) OR ($4='target' AND target_employee_id=$2))`;
        const swaps = (await client.query(`SELECT id AS "swapId",requester_employee_id AS "requesterEmployeeId",target_employee_id AS "targetEmployeeId",requester_shift_id AS "requesterShiftId",target_shift_id AS "targetShiftId",status,requester_submitted_at AS "submittedAt",target_responded_at AS "targetRespondedAt",version FROM shift_swap_requests WHERE ${where} ORDER BY created_at DESC LIMIT $5 OFFSET $6`, [user.tenantId, user.employeeId, status, role, pageSize, (page - 1) * pageSize])).rows;
        const total = (await client.query(`SELECT count(*)::int AS count FROM shift_swap_requests WHERE ${where}`, [user.tenantId, user.employeeId, status, role])).rows[0].count;
        return { swaps, total, page, pageSize };
      });
      res.json({ success: true, ...result });
    } catch (error) { send(res, error, 'Unable to load shift swaps.'); }
  });

  app.post('/api/me/shift-swaps/:swapId/cancel', rateLimiter, standardAuth, mutationGuard, async (req, res) => {
    try {
      const user = req.authUser!;
      if (!uuid(req.params.swapId)) throw fail(400, 'Shift swap id is invalid.');
      const swap = await withTenant(user.tenantId, async (client) => {
        await client.query('BEGIN');
        try {
          const current = (await client.query(`SELECT * FROM shift_swap_requests WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [user.tenantId, req.params.swapId])).rows[0];
          if (!current) throw fail(404, 'Shift swap not found.');
          if (current.requester_employee_id !== user.employeeId) throw fail(403, 'Only the requester may cancel this shift swap.');
          if (!['pending_target', 'pending_approval'].includes(current.status)) throw fail(409, 'Shift swap can no longer be cancelled.');
          const row = (await client.query(`UPDATE shift_swap_requests SET status='cancelled',version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING id AS "swapId",status,version`, [user.tenantId, current.id])).rows[0];
          await writeHistory(client, { tenantId: user.tenantId, swap: current, actorId: user.employeeId, action: 'cancelled', previousStatus: current.status, nextStatus: 'cancelled' });
          await recordAuditEvent(client, { tenantId: user.tenantId, actorId: user.employeeId, action: 'roster.shift_swap.cancelled', targetType: 'shift_swap_request', targetId: current.id, metadata: { swapId: current.id, requesterEmployeeId: current.requester_employee_id, targetEmployeeId: current.target_employee_id, status: 'cancelled' } });
          await client.query('COMMIT');
          return row;
        } catch (error) { await client.query('ROLLBACK'); throw error; }
      });
      res.json({ success: true, swap });
    } catch (error) { send(res, error, 'Unable to cancel shift swap.'); }
  });

  app.get('/api/hr/shift-swaps', standardAuth, async (req, res) => {
    try {
      const user = req.authUser!;
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
      const status = typeof req.query.status === 'string' ? req.query.status : null;
      const actionableOnly = req.query.actionableOnly === 'true';
      const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 120) : '';
      const result = await withTenant(user.tenantId, async (client) => {
        const rows = (await client.query(
          `SELECT swap.*,requester.full_name AS "requesterName",target.full_name AS "targetName",approver.full_name AS "approverName",rs.start_time AS "requesterStart",rs.end_time AS "requesterEnd",ts.start_time AS "targetStart",ts.end_time AS "targetEnd"
           FROM shift_swap_requests swap
           JOIN employees requester ON requester.tenant_id=swap.tenant_id AND requester.id=swap.requester_employee_id
           JOIN employees target ON target.tenant_id=swap.tenant_id AND target.id=swap.target_employee_id
           LEFT JOIN employees approver ON approver.tenant_id=swap.tenant_id AND approver.id=swap.approver_employee_id
           JOIN roster_shifts rs ON rs.tenant_id=swap.tenant_id AND rs.id=swap.requester_shift_id
           JOIN roster_shifts ts ON ts.tenant_id=swap.tenant_id AND ts.id=swap.target_shift_id
           WHERE swap.tenant_id=$1 AND ($2::text IS NULL OR swap.status=$2) AND ($3='' OR requester.full_name ILIKE '%' || $3 || '%' OR target.full_name ILIKE '%' || $3 || '%')
           ORDER BY swap.created_at DESC LIMIT 250`,
          [user.tenantId, status, search],
        )).rows;
        const visible = [] as any[];
        for (const swap of rows) {
          const allowed = await canActOnSwap(client, user.tenantId, user.employeeId, swap)
            || (await resolveScopedPermission(client, { tenantId: user.tenantId, actorEmployeeId: user.employeeId, permissionKey: 'roster.swap.view_scoped', targetEmployeeId: swap.requester_employee_id })).allowed;
          if (allowed && (!actionableOnly || swap.status === 'pending_approval')) visible.push(swap);
        }
        const start = (page - 1) * pageSize;
        return { swaps: visible.slice(start, start + pageSize).map((swap) => ({ swapId: swap.id, requester: { id: swap.requester_employee_id, name: swap.requesterName }, target: { id: swap.target_employee_id, name: swap.targetName }, requesterShift: { start: swap.requesterStart, end: swap.requesterEnd }, targetShift: { start: swap.targetStart, end: swap.targetEnd }, status: swap.status, approver: swap.approver_employee_id ? { id: swap.approver_employee_id, name: swap.approverName } : null, approvalSource: swap.approval_source, scopeType: swap.approval_scope_type, submittedAt: swap.requester_submitted_at, targetRespondedAt: swap.target_responded_at, version: swap.version })), total: visible.length, page, pageSize };
      });
      res.json({ success: true, ...result });
    } catch (error) { send(res, error, 'Unable to load approval queue.'); }
  });

  for (const decision of ['approve', 'reject'] as const) app.post(`/api/hr/shift-swaps/:swapId/${decision}`, rateLimiter, standardAuth, mutationGuard, async (req, res) => {
    try {
      fields(req.body, ['expectedVersion', 'note']);
      const user = req.authUser!;
      const body = req.body;
      if (!uuid(req.params.swapId) || !Number.isInteger(body.expectedVersion) || body.expectedVersion < 1 || (body.note !== undefined && typeof body.note !== 'string')) throw fail(400, 'Shift-swap decision is invalid.');
      const swap = await withTenant(user.tenantId, async (client) => {
        await client.query('BEGIN');
        try {
          const current = (await client.query(`SELECT * FROM shift_swap_requests WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [user.tenantId, req.params.swapId])).rows[0];
          if (!current) throw fail(404, 'Shift swap not found.');
          if (current.status !== 'pending_approval' || current.version !== body.expectedVersion) throw fail(409, 'Shift-swap approval is no longer current.');
          if (!await canActOnSwap(client, user.tenantId, user.employeeId, current)) throw fail(403, 'You are not authorised to decide this shift swap.');
          let lockedShifts: { requesterShift: any; targetShift: any };
          try {
            lockedShifts = await validateShifts(client, user.tenantId, { requesterEmployeeId: current.requester_employee_id, targetEmployeeId: current.target_employee_id, requesterShiftId: current.requester_shift_id, targetShiftId: current.target_shift_id });
            if (decision === 'approve') await ensureNoActiveAttendance(client, user.tenantId, [current.requester_employee_id, current.target_employee_id]);
          }
          catch (error) {
            await recordAuditEvent(client, { tenantId: user.tenantId, actorId: user.employeeId, action: 'roster.shift_swap.approval_conflict', targetType: 'shift_swap_request', targetId: current.id, metadata: { swapId: current.id, requesterEmployeeId: current.requester_employee_id, targetEmployeeId: current.target_employee_id, approverEmployeeId: user.employeeId, status: current.status } });
            throw error;
          }
          const nextStatus = decision === 'approve' ? 'applied' : 'rejected';
          if (decision === 'approve') {
            await client.query(
              `UPDATE roster_shifts
               SET employee_id=CASE id WHEN $2 THEN $3 WHEN $4 THEN $5 END,
                   updated_by=$6,updated_at=NOW()
               WHERE tenant_id=$1 AND id=ANY($7::uuid[])`,
              [user.tenantId, lockedShifts!.requesterShift.id, current.target_employee_id, lockedShifts!.targetShift.id, current.requester_employee_id, user.employeeId, [lockedShifts!.requesterShift.id, lockedShifts!.targetShift.id]],
            );
            await client.query(
              `INSERT INTO roster_shift_assignment_history(tenant_id,roster_shift_id,previous_employee_id,new_employee_id,shift_swap_request_id,applied_by_employee_id)
               VALUES($1,$2,$3,$4,$5,$6),($1,$7,$4,$3,$5,$6)`,
              [user.tenantId, lockedShifts!.requesterShift.id, current.requester_employee_id, current.target_employee_id, current.id, user.employeeId, lockedShifts!.targetShift.id],
            );
          }
          const row = (await client.query(
            `UPDATE shift_swap_requests SET status=$3,approver_employee_id=$4,approval_decided_at=NOW(),approval_note=$5,approved_at=CASE WHEN $3='applied' THEN NOW() ELSE NULL END,applied_at=CASE WHEN $3='applied' THEN NOW() ELSE NULL END,rejected_at=CASE WHEN $3='rejected' THEN NOW() ELSE NULL END,version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING id AS "swapId",status,version`,
            [user.tenantId, current.id, nextStatus, user.employeeId, note(body.note)],
          )).rows[0];
          await writeHistory(client, { tenantId: user.tenantId, swap: current, actorId: user.employeeId, action: decision === 'approve' ? 'applied' : 'rejected', previousStatus: 'pending_approval', nextStatus });
          await recordAuditEvent(client, { tenantId: user.tenantId, actorId: user.employeeId, action: decision === 'approve' ? 'roster.shift_swap.applied' : 'roster.shift_swap.rejected', targetType: 'shift_swap_request', targetId: current.id, metadata: { swapId: current.id, requesterEmployeeId: current.requester_employee_id, targetEmployeeId: current.target_employee_id, approverEmployeeId: user.employeeId, approvalSource: current.approval_source, scopeType: current.approval_scope_type, status: nextStatus } });
          const notificationType = decision === 'approve' ? 'notification.shift_swap_applied' : 'notification.shift_swap_rejected';
          await notify(client, user.tenantId, notificationType, current.requester_employee_id, current.id);
          await notify(client, user.tenantId, notificationType, current.target_employee_id, current.id);
          await client.query('COMMIT');
          return row;
        } catch (error) { await client.query('ROLLBACK'); throw error; }
      });
      res.json({ success: true, swap });
    } catch (error) { send(res, error, `Unable to ${decision} shift swap.`); }
  });

  app.get('/api/me/shift-swaps/:swapId', standardAuth, async (req, res) => {
    try {
      const user = req.authUser!;
      if (!uuid(req.params.swapId)) throw fail(404, 'Shift swap not found.');
      const result = await withTenant(user.tenantId, async (client) => {
        const swap = (await client.query(`SELECT id AS "swapId",status,version,requester_submitted_at AS "submittedAt",target_responded_at AS "targetRespondedAt",CASE WHEN requester_employee_id=$3 THEN 'requester' ELSE 'target' END AS "myRole" FROM shift_swap_requests WHERE tenant_id=$1 AND id=$2 AND (requester_employee_id=$3 OR target_employee_id=$3)`, [user.tenantId, req.params.swapId, user.employeeId])).rows[0];
        if (!swap) throw fail(404, 'Shift swap not found.');
        const history = (await client.query(`SELECT action,previous_status AS "previousStatus",new_status AS "newStatus",created_at AS "createdAt" FROM shift_swap_history WHERE tenant_id=$1 AND shift_swap_request_id=$2 ORDER BY created_at`, [user.tenantId, req.params.swapId])).rows;
        return { swap, history };
      });
      res.json({ success: true, ...result });
    } catch (error) { send(res, error, 'Unable to load shift swap.'); }
  });
}
