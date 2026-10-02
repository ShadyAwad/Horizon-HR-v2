import { logServerError } from '../../lib/server-logging';
import type express from 'express';
import type { PoolClient } from 'pg';
import { withTenant } from '../../lib/hr-background';
import { recordAuditEvent } from '../audit/audit-events';
import { resolveScopedPermission } from '../organisation/scoped-permissions';

type EmployeeRole = 'hr_admin' | 'manager' | 'employee';

type AuthenticatedUser = {
  employeeId: string;
  tenantId: string;
  email: string;
  role: EmployeeRole;
  jobTitle?: string | null;
  roleNames?: string[];
  permissions?: string[];
};

type RosterShiftInput = {
  employeeId?: string;
  startTime?: string;
  endTime?: string;
  notes?: string | null;
  overrideCodes?: string[];
  overrideReason?: string;
};

type RosterWarning = {
  code: 'APPROVED_LEAVE_CONFLICT' | 'WEEKLY_HOURS_EXCEEDED';
  message: string;
  currentMinutes?: number;
  proposedMinutes?: number;
  thresholdMinutes?: number;
  leaveRequestId?: string;
  leaveType?: string;
  startDate?: string;
  endDate?: string;
};

type RosterShiftRouteDependencies = {
  standardAuth: express.RequestHandler;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string | undefined) {
  return Boolean(value && uuidPattern.test(value));
}

function isValidDateInput(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const DEFAULT_ROSTER_WEEKLY_HOURS = 40;

function getRosterWeeklyThresholdMinutes() {
  const configuredHours = Number(process.env.ROSTER_WEEKLY_HOURS_THRESHOLD);
  const hours = Number.isFinite(configuredHours) && configuredHours > 0
    ? configuredHours
    : DEFAULT_ROSTER_WEEKLY_HOURS;
  return Math.round(hours * 60);
}

function parseRosterTimestamp(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getIsoWeekBounds(timestamp: Date) {
  const utcDate = new Date(Date.UTC(timestamp.getUTCFullYear(), timestamp.getUTCMonth(), timestamp.getUTCDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() - day + 1);
  const start = utcDate;
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return { start, end };
}

async function rosterScopeAccess(client: PoolClient, authUser: AuthenticatedUser, targetEmployeeId: string, requireManage = false) {
  if (targetEmployeeId === authUser.employeeId && !requireManage) return true;
  const permissionKeys = requireManage ? ['roster.manage'] : ['roster.manage', 'roster.view_all'];
  for (const permissionKey of permissionKeys) {
    const authority = await resolveScopedPermission(client, {
      tenantId: authUser.tenantId,
      actorEmployeeId: authUser.employeeId,
      permissionKey,
      targetEmployeeId,
    });
    if (authority.allowed) return true;
  }
  return false;
}

async function recordApprovedLeaveConflictsForShift(client: PoolClient, input: {
  tenantId: string;
  actorEmployeeId: string;
  shift: { id: string; employee_id: string; start_time: string | Date; end_time: string | Date; status: string };
}) {
  if (input.shift.status !== 'scheduled' || new Date(input.shift.end_time) <= new Date()) return;
  const requests = (await client.query(
    `SELECT id,leave_type,start_date,end_date
     FROM leave_requests
     WHERE tenant_id=$1 AND employee_id=$2 AND status='approved'
       AND $3::timestamptz < ((end_date + 1)::timestamp AT TIME ZONE 'UTC')
       AND $4::timestamptz > (start_date::timestamp AT TIME ZONE 'UTC')
     ORDER BY id FOR UPDATE`,
    [input.tenantId, input.shift.employee_id, input.shift.start_time, input.shift.end_time],
  )).rows;
  for (const request of requests) {
    const existing = (await client.query(
      `SELECT status FROM leave_roster_conflicts WHERE tenant_id=$1 AND leave_request_id=$2 AND roster_shift_id=$3`,
      [input.tenantId, request.id, input.shift.id],
    )).rows[0];
    await client.query(
      `INSERT INTO leave_roster_conflicts(tenant_id,leave_request_id,roster_shift_id,status,detected_at)
       VALUES($1,$2,$3,'open',NOW())
       ON CONFLICT (tenant_id,leave_request_id,roster_shift_id)
       DO UPDATE SET status='open',resolved_at=NULL,resolved_by_employee_id=NULL,resolution_note=NULL,updated_at=NOW()`,
      [input.tenantId, request.id, input.shift.id],
    );
    if (existing?.status === 'open' || existing?.status === 'acknowledged') continue;
    const idempotencyKey = `leave-roster-conflict:${request.id}:${input.shift.id}`;
    const payload = {
      idempotencyKey,
      leaveRequestId: request.id,
      shiftId: input.shift.id,
      employeeId: input.actorEmployeeId,
      affectedEmployeeId: input.shift.employee_id,
      shiftStartTime: input.shift.start_time,
      shiftEndTime: input.shift.end_time,
      conflictStatus: 'open',
      notificationKey: 'leave_updates',
      deepLink: { section: 'roster', view: 'schedule', employeeId: input.shift.employee_id },
    };
    await client.query(
      `INSERT INTO outbox_events(tenant_id,event_type,payload)
       SELECT $1,'notification.leave_roster_conflict',$2::jsonb
       WHERE NOT EXISTS (
         SELECT 1 FROM outbox_events WHERE tenant_id=$1 AND event_type='notification.leave_roster_conflict'
           AND payload->>'idempotencyKey'=$3
       )`,
      [input.tenantId, JSON.stringify(payload), idempotencyKey],
    );
    await client.query(
      `INSERT INTO leave_request_history(tenant_id,leave_request_id,actor_employee_id,action,previous_status,new_status,metadata)
       VALUES($1,$2,$3,'schedule_conflict_detected','approved','approved',$4::jsonb)`,
      [input.tenantId, request.id, input.actorEmployeeId, JSON.stringify({ conflictCount: 1, status: 'open' })],
    );
    await recordAuditEvent(client, {
      tenantId: input.tenantId,
      actorId: input.actorEmployeeId,
      action: 'leave.schedule_conflict_detected',
      targetType: 'leave_request',
      targetId: request.id,
      metadata: { leaveRequestId: request.id, employeeId: input.shift.employee_id, conflictCount: 1, status: 'open' },
    });
  }
}

async function validateRosterWarnings(
  client: PoolClient,
  tenantId: string,
  employeeId: string,
  startTime: Date,
  endTime: Date,
  excludeShiftId?: string,
) {
  const warnings: RosterWarning[] = [];
  const leaveResult = await client.query<{
    id: string;
    leave_type: string;
    start_date: string;
    end_date: string;
  }>(
    `
      SELECT id, leave_type, start_date::text, end_date::text
      FROM leave_requests
      WHERE tenant_id = $1
        AND employee_id = $2
        AND status = 'approved'
        AND leave_type = 'annual'
        AND start_date <= ($4::timestamptz AT TIME ZONE 'UTC')::date
        AND end_date >= ($3::timestamptz AT TIME ZONE 'UTC')::date
    `,
    [tenantId, employeeId, startTime.toISOString(), endTime.toISOString()],
  );

  for (const leave of leaveResult.rows) {
    warnings.push({
      code: 'APPROVED_LEAVE_CONFLICT',
      message: 'This employee is on approved annual leave.',
      leaveRequestId: leave.id,
      leaveType: leave.leave_type,
      startDate: leave.start_date,
      endDate: leave.end_date,
    });
  }

  const week = getIsoWeekBounds(startTime);
  const weeklyResult = await client.query<{ minutes: string }>(
    `
      SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (LEAST(end_time, $4::timestamptz) - GREATEST(start_time, $3::timestamptz))) / 60), 0)::bigint AS minutes
      FROM roster_shifts
      WHERE tenant_id = $1
        AND employee_id = $2
        AND status = 'scheduled'
        AND start_time < $4::timestamptz
        AND end_time > $3::timestamptz
        AND ($5::uuid IS NULL OR id <> $5::uuid)
    `,
    [tenantId, employeeId, week.start.toISOString(), week.end.toISOString(), excludeShiftId ?? null],
  );
  const currentMinutes = Number(weeklyResult.rows[0]?.minutes ?? 0);
  const proposedMinutes = currentMinutes + Math.round((endTime.getTime() - startTime.getTime()) / 60_000);
  const thresholdMinutes = getRosterWeeklyThresholdMinutes();
  if (proposedMinutes > thresholdMinutes) {
    warnings.push({
      code: 'WEEKLY_HOURS_EXCEEDED',
      message: `This schedule would total ${Math.round(proposedMinutes / 60)} hours.`,
      currentMinutes,
      proposedMinutes,
      thresholdMinutes,
    });
  }
  return warnings;
}

export function registerRosterShiftRoutes(
  app: express.Express,
  { standardAuth: demoAuth }: RosterShiftRouteDependencies,
) {
  app.get('/api/roster/employees', demoAuth, async (req, res) => {
    const authUser = req.authUser!;
    try {
      const employees = await withTenant(authUser.tenantId, async (client) => {
        const result = await client.query<{ id: string; full_name: string; email: string; role: EmployeeRole }>(
          `SELECT id, full_name, email, role FROM employees
           WHERE tenant_id = $1 AND is_active=true AND employment_status='active'
           ORDER BY full_name ASC, email ASC`,
          [authUser.tenantId],
        );
        const visible = [];
        for (const employee of result.rows) {
          if (await rosterScopeAccess(client, authUser, employee.id)) visible.push(employee);
        }
        return visible.map((employee) => ({ id: employee.id, fullName: employee.full_name, email: employee.email, role: employee.role }));
      });
      res.json({ success: true, employees });
    } catch (error) {
      logServerError('[Roster] Failed to load employees:', error);
      res.status(500).json({ success: false, error: 'Unable to load roster employees.' });
    }
  });
  
  app.get('/api/roster/shifts', demoAuth, async (req, res) => {
    const authUser = req.authUser!;
    const requestedEmployeeId = typeof req.query.employeeId === 'string' ? req.query.employeeId : authUser.employeeId;
    const startDate = typeof req.query.startDate === 'string' ? req.query.startDate : undefined;
    const endDate = typeof req.query.endDate === 'string' ? req.query.endDate : undefined;
    if (!isUuid(requestedEmployeeId) || (startDate && !isValidDateInput(startDate)) || (endDate && !isValidDateInput(endDate))) {
      return res.status(400).json({ success: false, error: 'employeeId and date range are invalid.' });
    }
    try {
      const shifts = await withTenant(authUser.tenantId, async (client) => {
        if (!(await rosterScopeAccess(client, authUser, requestedEmployeeId))) {
          const denied = new Error('You do not have permission to view this roster.');
          Object.assign(denied, { statusCode: 403 });
          throw denied;
        }
        const result = await client.query(
          `
            SELECT shift.id,shift.employee_id,shift.start_time,shift.end_time,shift.status,shift.notes,shift.override_codes,shift.override_reason,
              (approved_leave.leave_request_id IS NOT NULL) AS approved_leave,
              approved_leave.leave_request_id,approved_leave.leave_type,approved_leave.start_date AS leave_start_date,
              approved_leave.end_date AS leave_end_date,COALESCE(approved_leave.conflict_count,0)::int AS conflict_count,
              (COALESCE(approved_leave.conflict_count,0)>0) AS has_roster_conflict
            FROM roster_shifts shift
            LEFT JOIN LATERAL (
              SELECT request.id AS leave_request_id,request.leave_type,request.start_date,request.end_date,
                count(conflict.id) FILTER (WHERE conflict.status IN ('open','acknowledged'))::int AS conflict_count
              FROM leave_requests request
              LEFT JOIN leave_roster_conflicts conflict
                ON conflict.tenant_id=request.tenant_id AND conflict.leave_request_id=request.id AND conflict.roster_shift_id=shift.id
              WHERE request.tenant_id=shift.tenant_id AND request.employee_id=shift.employee_id AND request.status='approved'
                AND shift.start_time < ((request.end_date + 1)::timestamp AT TIME ZONE 'UTC')
                AND shift.end_time > (request.start_date::timestamp AT TIME ZONE 'UTC')
              GROUP BY request.id
              ORDER BY request.start_date,request.id
              LIMIT 1
            ) approved_leave ON true
            WHERE shift.tenant_id = $1 AND shift.employee_id = $2
              AND ($3::date IS NULL OR shift.end_time > $3::date)
              AND ($4::date IS NULL OR shift.start_time < ($4::date + INTERVAL '1 day'))
            ORDER BY shift.start_time ASC
          `,
          [authUser.tenantId, requestedEmployeeId, startDate ?? null, endDate ?? null],
        );
        return result.rows;
      });
      res.json({ success: true, shifts });
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 403) return res.status(403).json({ success: false, error: 'You do not have permission to view this roster.' });
      logServerError('[Roster] Failed to load shifts:', error);
      res.status(500).json({ success: false, error: 'Unable to load roster shifts.' });
    }
  });
  
  async function saveRosterShift(req: express.Request, res: express.Response, shiftId?: string) {
    const authUser = req.authUser!;
    const body = req.body as RosterShiftInput;
    const employeeId = body.employeeId;
    const startTime = parseRosterTimestamp(body.startTime);
    const endTime = parseRosterTimestamp(body.endTime);
    const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 1000) : null;
    const requestedOverrideCodes = Array.isArray(body.overrideCodes)
      ? [...new Set(body.overrideCodes.filter((code): code is RosterWarning['code'] => code === 'APPROVED_LEAVE_CONFLICT' || code === 'WEEKLY_HOURS_EXCEEDED'))]
      : [];
    const overrideReason = typeof body.overrideReason === 'string' ? body.overrideReason.trim().slice(0, 500) : '';
  
    if (!isUuid(employeeId) || !startTime || !endTime || endTime <= startTime) {
      return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', error: 'employeeId, startTime, and an endTime after startTime are required.' });
    }
    if (requestedOverrideCodes.length > 0 && !overrideReason) {
      return res.status(400).json({ success: false, code: 'OVERRIDE_REASON_REQUIRED', error: 'An override reason is required.' });
    }
  
    try {
      const savedShift = await withTenant(authUser.tenantId, async (client) => {
        // Serialise a single employee schedule before rechecking conflicts.
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, [authUser.tenantId, employeeId]);
        const employeeResult = await client.query(`SELECT id FROM employees WHERE tenant_id = $1 AND id = $2`, [authUser.tenantId, employeeId]);
        if (employeeResult.rowCount === 0) {
          const missing = new Error('Employee not found.');
          (missing as Error & { statusCode: number }).statusCode = 404;
          throw missing;
        }
        if (!(await rosterScopeAccess(client, authUser, employeeId, true))) {
          const denied = new Error('You do not have permission to manage this employee roster.');
          Object.assign(denied, { statusCode: 403 });
          throw denied;
        }
        const overlaps = await client.query<{ id: string; start_time: string; end_time: string }>(
          `SELECT id, start_time, end_time FROM roster_shifts WHERE tenant_id = $1 AND employee_id = $2 AND status = 'scheduled' AND start_time < $4 AND end_time > $3 AND ($5::uuid IS NULL OR id <> $5::uuid)`,
          [authUser.tenantId, employeeId, startTime.toISOString(), endTime.toISOString(), shiftId ?? null],
        );
        if (overlaps.rowCount > 0) {
          const conflict = new Error('This employee already has a shift during this time.');
          Object.assign(conflict, { statusCode: 409, code: 'SHIFT_OVERLAP', conflicts: overlaps.rows.map((row) => ({ shiftId: row.id, startTime: row.start_time, endTime: row.end_time })) });
          throw conflict;
        }
        const warnings = await validateRosterWarnings(client, authUser.tenantId, employeeId, startTime, endTime, shiftId);
        const unacknowledged = warnings.filter((warning) => !requestedOverrideCodes.includes(warning.code));
        if (unacknowledged.length > 0) {
          const warningError = new Error('Scheduling confirmation is required.');
          Object.assign(warningError, { statusCode: 409, code: 'ROSTER_WARNING_CONFIRMATION_REQUIRED', warnings: unacknowledged });
          throw warningError;
        }
        const result = shiftId
          ? await client.query(
            `UPDATE roster_shifts SET employee_id = $3, start_time = $4, end_time = $5, notes = $6, override_codes = $7::text[], override_reason = $8, updated_by = $2, updated_at = NOW() WHERE tenant_id = $1 AND id = $9 RETURNING *`,
            [authUser.tenantId, authUser.employeeId, employeeId, startTime.toISOString(), endTime.toISOString(), notes, requestedOverrideCodes, overrideReason || null, shiftId],
          )
          : await client.query(
            `INSERT INTO roster_shifts (tenant_id, employee_id, created_by, updated_by, start_time, end_time, notes, override_codes, override_reason) VALUES ($1, $2, $3, $3, $4, $5, $6, $7::text[], $8) RETURNING *`,
            [authUser.tenantId, employeeId, authUser.employeeId, startTime.toISOString(), endTime.toISOString(), notes, requestedOverrideCodes, overrideReason || null],
          );
        if (result.rowCount === 0) {
          const missing = new Error('Roster shift not found.');
          (missing as Error & { statusCode: number }).statusCode = 404;
          throw missing;
        }
        if (requestedOverrideCodes.length > 0) {
          await client.query(
            `INSERT INTO audit_logs (tenant_id, actor_employee_id, action, entity_type, entity_id, metadata) VALUES ($1, $2, 'roster.warning_overridden', 'roster_shift', $3, $4::jsonb)`,
            [authUser.tenantId, authUser.employeeId, result.rows[0].id, JSON.stringify({ employeeId, warningCodes: requestedOverrideCodes, overrideReason, startTime: startTime.toISOString(), endTime: endTime.toISOString() })],
          );
        }
        await recordApprovedLeaveConflictsForShift(client, {
          tenantId: authUser.tenantId,
          actorEmployeeId: authUser.employeeId,
          shift: result.rows[0],
        });
        return result.rows[0];
      });
      res.status(shiftId ? 200 : 201).json({ success: true, shift: savedShift });
    } catch (error) {
      const rosterError = error as Error & { statusCode?: number; code?: string; conflicts?: unknown; warnings?: unknown };
      if (rosterError.code === '23P01') {
        return res.status(409).json({ success: false, code: 'SHIFT_OVERLAP', error: 'This employee already has a shift during this time.' });
      }
      if (rosterError.statusCode) {
        return res.status(rosterError.statusCode).json({ success: false, code: rosterError.code, error: rosterError.message, conflicts: rosterError.conflicts, warnings: rosterError.warnings, requiresConfirmation: rosterError.code === 'ROSTER_WARNING_CONFIRMATION_REQUIRED' });
      }
      logServerError('[Roster] Failed to save shift:', error);
      return res.status(500).json({ success: false, error: 'Unable to save roster shift.' });
    }
  }
  
  app.post('/api/roster/shifts', demoAuth, (req, res) => saveRosterShift(req, res));
  app.patch('/api/roster/shifts/:id', demoAuth, (req, res) => isUuid(req.params.id) ? saveRosterShift(req, res, req.params.id) : res.status(400).json({ success: false, error: 'Invalid roster shift id.' }));
  
  app.patch('/api/roster/shifts/:id/cancel', demoAuth, async (req, res) => {
    const authUser = req.authUser!;
    if (!isUuid(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid roster shift id.' });
    try {
      const result = await withTenant(authUser.tenantId, async (client) => {
        const shift = (await client.query(`SELECT employee_id FROM roster_shifts WHERE tenant_id=$1 AND id=$2`, [authUser.tenantId, req.params.id])).rows[0];
        if (!shift) return { rowCount: 0, rows: [] };
        if (!(await rosterScopeAccess(client, authUser, shift.employee_id, true))) {
          const denied = new Error('You do not have permission to manage this employee roster.');
          Object.assign(denied, { statusCode: 403 });
          throw denied;
        }
        return client.query(`UPDATE roster_shifts SET status = 'cancelled', updated_by = $2, updated_at = NOW() WHERE tenant_id = $1 AND id = $3 RETURNING *`, [authUser.tenantId, authUser.employeeId, req.params.id]);
      });
      if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'Roster shift not found.' });
      return res.json({ success: true, shift: result.rows[0] });
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 403) return res.status(403).json({ success: false, error: (error as Error).message });
      logServerError('[Roster] Failed to cancel shift:', error);
      return res.status(500).json({ success: false, error: 'Unable to cancel roster shift.' });
    }
  });
}
