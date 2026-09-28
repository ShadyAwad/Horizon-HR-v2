import { attendancePolicy, lockAttendancePolicy } from '../attendance/attendance-policy';
import { resolveScopedPermission } from '../organisation/scoped-permissions';
import type express from 'express';
import { hasDatabaseConfig, withTenant } from '../../lib/hr-background';

type BreakRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

type CreateBreakRequestBody = {
  requestedStartTime?: string | null;
  durationMinutes?: number | string;
  reason?: string | null;
  breakPolicyId?: string;
};

type ReviewBreakRequestBody = {
  status?: 'approved' | 'rejected';
  reviewNote?: string | null;
};

type BreakRequestRouteDependencies = {
  standardAuth: express.RequestHandler;
  mutationGuard: express.RequestHandler;
  requirePermission: (permission: string) => express.RequestHandler;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string | undefined) {
  return Boolean(value && uuidPattern.test(value));
}

function normalizeOptionalTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

export function registerBreakRequestRoutes(
  app: express.Express,
  { standardAuth: demoAuth, requirePermission, mutationGuard }: BreakRequestRouteDependencies,
) {
  app.post(
    '/api/break-requests',
    demoAuth,
    mutationGuard,
    requirePermission('break_requests.create'),
    async (req, res) => {
      const tenantId = req.authUser!.tenantId;
      const employeeId = req.authUser!.employeeId;
      const { requestedStartTime, durationMinutes, reason, breakPolicyId } = req.body as CreateBreakRequestBody;
  
      const normalizedDuration = typeof durationMinutes === 'string'
        ? Number(durationMinutes)
        : durationMinutes;
      const normalizedReason = typeof reason === 'string' ? reason.trim().slice(0, 500) : null;
      const normalizedStartTime = normalizeOptionalTimestamp(requestedStartTime);
  
      if (!Number.isInteger(normalizedDuration) || normalizedDuration < 5 || normalizedDuration > 180) {
        return res.status(400).json({ success: false, error: 'durationMinutes must be a whole number between 5 and 180.' });
      }
  
      if (normalizedStartTime === undefined) {
        return res.status(400).json({ success: false, error: 'requestedStartTime must be a valid date/time if provided.' });
      }
  
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ success: false, error: 'DATABASE_URL is required for break requests' });
      }
  
      try {
        const breakRequest = await withTenant(tenantId, async (client) => {

  
          try {
            await lockAttendancePolicy(client,tenantId);
            if (!breakPolicyId && !(await attendancePolicy(client,tenantId)).allowCustomBreaks) throw Object.assign(new Error('Custom breaks are disabled by company policy.'),{statusCode:403});
            let policy: {requires_approval:boolean;duration_minutes:number}|undefined;
            if (breakPolicyId) {
              if (!isUuid(breakPolicyId)) throw Object.assign(new Error('Invalid break policy.'),{statusCode:400});
              policy=(await client.query('SELECT requires_approval,duration_minutes FROM attendance_break_policies WHERE tenant_id=$1 AND id=$2 AND active=true',[tenantId,breakPolicyId])).rows[0];
              if (!policy || policy.duration_minutes!==normalizedDuration) throw Object.assign(new Error('Use the configured duration for this active break policy.'),{statusCode:400});
            }
            const result = await client.query<{
              id: string;
              employee_id: string;
              requested_start_time: string | null;
              requested_end_time: string | null;
              duration_minutes: number;
              reason: string | null;
              status: BreakRequestStatus;
              created_at: string;
            }>(
              `
                INSERT INTO break_requests (
                  tenant_id,
                  employee_id,
                  requested_start_time,
                  requested_end_time,
                  duration_minutes,
                  reason, break_policy_id, status
                )
                VALUES (
                  $1,
                  $2,
                  $3::timestamptz,
                  CASE
                    WHEN $3::timestamptz IS NULL THEN NULL
                    ELSE $3::timestamptz + ($4::int * INTERVAL '1 minute')
                  END,
                  $4::int,
                  $5::text, $6::uuid, $7::varchar
                )
                RETURNING
                  id,
                  employee_id,
                  requested_start_time,
                  requested_end_time,
                  duration_minutes,
                  reason,
                  status,
                  created_at
              `,
              [tenantId, employeeId, normalizedStartTime, normalizedDuration, normalizedReason, breakPolicyId || null, policy && !policy.requires_approval ? 'approved' : 'pending'],
            );
  
            const requestRow = result.rows[0];
  
            const recipients = await client.query<{ id: string }>(
              `
                WITH requester AS (
                  SELECT manager_id
                  FROM employees
                  WHERE tenant_id = $1
                    AND id = $2
                ),
                candidate_recipients AS (
                  SELECT manager_id AS id
                  FROM requester
                  WHERE manager_id IS NOT NULL
  
                  UNION
  
                  SELECT employees.id
                  FROM employees
                  WHERE employees.tenant_id = $1
                    AND employees.role IN ('manager', 'hr_admin')
                    AND NOT EXISTS (SELECT 1 FROM requester WHERE manager_id IS NOT NULL)
                )
                SELECT candidate_recipients.id
                FROM candidate_recipients
                LEFT JOIN user_notification_settings
                  ON user_notification_settings.tenant_id = $1
                 AND user_notification_settings.employee_id = candidate_recipients.id
                 AND user_notification_settings.channel = 'in_app'
                 AND user_notification_settings.notification_key = 'break_request_pending'
                WHERE COALESCE(user_notification_settings.enabled, true)
              `,
              [tenantId, employeeId],
            );
  
            if (requestRow.status === 'pending' && recipients.rows.length > 0) {
              await client.query(
                `
                  INSERT INTO outbox_events (tenant_id, event_type, payload)
                  VALUES ($1, $2::varchar, $3::jsonb)
                `,
                [
                  tenantId,
                  'notification.break_request_pending',
                  JSON.stringify({
                    notificationKey: 'break_request_pending',
                    breakRequestId: requestRow.id,
                    employeeId,
                    recipientEmployeeIds: recipients.rows.map((row) => row.id),
                    title: 'Break request pending',
                    body: `A ${normalizedDuration}-minute break request is waiting for review.`,
                  }),
                ],
              );
            }
  
            await client.query(
              `
                INSERT INTO audit_logs (tenant_id, actor_employee_id, action, entity_type, entity_id, metadata)
                VALUES ($1, $2, $3::varchar, $4::varchar, $5, $6::jsonb)
              `,
              [
                tenantId,
                employeeId,
                'break_request.created',
                'break_request',
                requestRow.id,
                JSON.stringify({ durationMinutes: normalizedDuration, requestedStartTime: normalizedStartTime, reason: normalizedReason }),
              ],
            );
  

            return requestRow;
          } catch (error) {

            throw error;
          }
        });
  
        if ('duplicatePending' in breakRequest) {
          return res.status(409).json({ success: false, error: 'You already have a pending break request.' });
        }
  
        res.status(201).json({ success: true, breakRequest });
      } catch (error) {
        console.error('[Break Requests] Failed to create break request:', error);
        res.status((error as any).statusCode || 500).json({ success: false, error: (error as any).statusCode ? (error as Error).message : 'Unable to create break request' });
      }
    },
  );
  
  app.get(
    '/api/break-requests/me',
    demoAuth,
    requirePermission('break_requests.view_own'),
    async (req, res) => {
      const tenantId = req.authUser!.tenantId;
      const employeeId = req.authUser!.employeeId;
  
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ success: false, error: 'DATABASE_URL is required for break requests' });
      }
  
      try {
        const breakRequests = await withTenant(tenantId, async (client) => {
          const result = await client.query(
            `
              SELECT
                break_requests.*,
                reviewer.full_name AS reviewer_name
              FROM break_requests
              LEFT JOIN employees reviewer
                ON reviewer.tenant_id = break_requests.tenant_id
               AND reviewer.id = break_requests.reviewed_by
              WHERE break_requests.tenant_id = $1
                AND break_requests.employee_id = $2
              ORDER BY break_requests.created_at DESC
              LIMIT 25
            `,
            [tenantId, employeeId],
          );
  
          return result.rows;
        });
  
        res.json({ success: true, breakRequests });
      } catch (error) {
        console.error('[Break Requests] Failed to load own break requests:', error);
        res.status(500).json({ success: false, error: 'Unable to load break requests' });
      }
    },
  );
  
  app.get(
    '/api/break-requests/pending',
    demoAuth,
    requirePermission('break_requests.view_all'),
    async (req, res) => {
      const tenantId = req.authUser!.tenantId;
  
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ success: false, error: 'DATABASE_URL is required for break requests' });
      }
  
      try {
        const breakRequests = await withTenant(tenantId, async (client) => {
          const result = await client.query(
            `
              SELECT
                break_requests.*,
                employees.full_name,
                employees.email,
                employees.role
              FROM break_requests
              INNER JOIN employees
                ON employees.tenant_id = break_requests.tenant_id
               AND employees.id = break_requests.employee_id
              WHERE break_requests.tenant_id = $1
                AND break_requests.status = 'pending'
              ORDER BY break_requests.created_at ASC
            `,
            [tenantId],
          );
  
          const visible = [];
          for (const row of result.rows) if ((await resolveScopedPermission(client,{tenantId,actorEmployeeId:req.authUser!.employeeId,permissionKey:'break_requests.view_all',targetEmployeeId:row.employee_id})).allowed) visible.push(row);
          return visible;
        });
  
        res.json({ success: true, breakRequests });
      } catch (error) {
        console.error('[Break Requests] Failed to load pending break requests:', error);
        res.status(500).json({ success: false, error: 'Unable to load pending break requests' });
      }
    },
  );
  
  app.patch(
    '/api/break-requests/:id/review',
    demoAuth,
    mutationGuard,
    requirePermission('break_requests.review'),
    async (req, res) => {
      const { id } = req.params;
      const tenantId = req.authUser!.tenantId;
      const reviewerId = req.authUser!.employeeId;
      const { status, reviewNote } = req.body as ReviewBreakRequestBody;
      const normalizedNote = typeof reviewNote === 'string' ? reviewNote.trim().slice(0, 500) : null;
  
      if (!isUuid(id)) {
        return res.status(400).json({ success: false, error: 'Break request id is invalid.' });
      }
  
      if (status !== 'approved' && status !== 'rejected') {
        return res.status(400).json({ success: false, error: 'status must be approved or rejected.' });
      }
  
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ success: false, error: 'DATABASE_URL is required for break requests' });
      }
  
      try {
        const breakRequest = await withTenant(tenantId, async (client) => {

  
          try {
            const target = (await client.query('SELECT employee_id FROM break_requests WHERE tenant_id=$1 AND id=$2',[tenantId,id])).rows[0];
            if (!target || !(await resolveScopedPermission(client,{tenantId,actorEmployeeId:reviewerId,permissionKey:'break_requests.review',targetEmployeeId:target.employee_id})).allowed) throw Object.assign(new Error('Break request is outside your review scope.'),{statusCode:403});
            const result = await client.query<{
              id: string;
              employee_id: string;
              status: BreakRequestStatus;
              duration_minutes: number;
              reviewed_at: string;
            }>(
              `
                UPDATE break_requests
                SET
                  status = $3::varchar,
                  reviewed_by = $2,
                  reviewed_at = NOW(),
                  review_note = $4::text,
                  updated_at = NOW()
                WHERE tenant_id = $1
                  AND id = $5
                  AND status = 'pending'
                RETURNING id, employee_id, status, duration_minutes, reviewed_at
              `,
              [tenantId, reviewerId, status, normalizedNote, id],
            );
  
            const requestRow = result.rows[0];
            if (!requestRow) {

              return null;
            }
  
            const notificationSetting = await client.query<{ enabled: boolean }>(
              `
                SELECT enabled
                FROM user_notification_settings
                WHERE tenant_id = $1
                  AND employee_id = $2
                  AND channel = 'in_app'
                  AND notification_key = 'break_request_reviewed'
                LIMIT 1
              `,
              [tenantId, requestRow.employee_id],
            );
  
            if (notificationSetting.rows[0]?.enabled !== false) {
              await client.query(
                `
                  INSERT INTO outbox_events (tenant_id, event_type, payload)
                  VALUES ($1, $2::varchar, $3::jsonb)
                `,
                [
                  tenantId,
                  'notification.break_request_reviewed',
                  JSON.stringify({
                    notificationKey: 'break_request_reviewed',
                    breakRequestId: requestRow.id,
                    recipientEmployeeIds: [requestRow.employee_id],
                    title: status === 'approved' ? 'Break approved' : 'Break rejected',
                    body: `Your ${requestRow.duration_minutes}-minute break request was ${status}.`,
                  }),
                ],
              );
            }
  
            await client.query(
              `
                INSERT INTO audit_logs (tenant_id, actor_employee_id, action, entity_type, entity_id, metadata)
                VALUES ($1, $2, $3::varchar, $4::varchar, $5, $6::jsonb)
              `,
              [
                tenantId,
                reviewerId,
                status === 'approved' ? 'break_request.approved' : 'break_request.rejected',
                'break_request',
                requestRow.id,
                JSON.stringify({ employeeId: requestRow.employee_id, status, reviewNote: normalizedNote }),
              ],
            );
  

            return requestRow;
          } catch (error) {

            throw error;
          }
        });
  
        if (!breakRequest) {
          return res.status(404).json({ success: false, error: 'Pending break request not found.' });
        }
  
        res.json({ success: true, breakRequest });
      } catch (error) {
        console.error('[Break Requests] Failed to review break request:', error);
        res.status((error as any).statusCode || 500).json({ success: false, error: (error as any).statusCode ? (error as Error).message : 'Unable to review break request' });
      }
    },
  );
  
  app.patch(
    '/api/break-requests/:id/cancel',
    demoAuth,
    mutationGuard,
    requirePermission('break_requests.view_own'),
    async (req, res) => {
      const { id } = req.params;
      const tenantId = req.authUser!.tenantId;
      const employeeId = req.authUser!.employeeId;
  
      if (!isUuid(id)) {
        return res.status(400).json({ success: false, error: 'Break request id is invalid.' });
      }
  
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ success: false, error: 'DATABASE_URL is required for break requests' });
      }
  
      try {
        const breakRequest = await withTenant(tenantId, async (client) => {

  
          try {
            const result = await client.query<{ id: string; status: BreakRequestStatus }>(
              `
                UPDATE break_requests
                SET status = 'cancelled', updated_at = NOW()
                WHERE tenant_id = $1
                  AND id = $2
                  AND employee_id = $3
                  AND status = 'pending'
                RETURNING id, status
              `,
              [tenantId, id, employeeId],
            );
  
            const requestRow = result.rows[0];
            if (!requestRow) {

              return null;
            }
  
            await client.query(
              `
                INSERT INTO audit_logs (tenant_id, actor_employee_id, action, entity_type, entity_id, metadata)
                VALUES ($1, $2, $3::varchar, $4::varchar, $5, $6::jsonb)
              `,
              [
                tenantId,
                employeeId,
                'break_request.cancelled',
                'break_request',
                requestRow.id,
                JSON.stringify({ status: requestRow.status }),
              ],
            );
  

            return requestRow;
          } catch (error) {

            throw error;
          }
        });
  
        if (!breakRequest) {
          return res.status(404).json({ success: false, error: 'Pending break request not found.' });
        }
  
        res.json({ success: true, breakRequest });
      } catch (error) {
        console.error('[Break Requests] Failed to cancel break request:', error);
        res.status(500).json({ success: false, error: 'Unable to cancel break request' });
      }
    },
  );
}
