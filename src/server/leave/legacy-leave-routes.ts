import type express from 'express';
import { enqueueAuditLog, hasDatabaseConfig, withTenant } from '../../lib/hr-background';

type EmployeeRole = 'employee' | 'manager' | 'hr_admin';

type LegacyLeaveRouteDependencies = {
  standardAuth: express.RequestHandler;
  requireRole: (roles: EmployeeRole[]) => express.RequestHandler;
};

function isValidDateInput(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function enqueueBestEffort(label: string, task: () => Promise<unknown>) {
  try {
    await task();
  } catch (error) {
    console.error(`[Background Queue] Failed to enqueue ${label}:`, error);
  }
}

export function registerLegacyLeaveRoutes(
  app: express.Express,
  { standardAuth: demoAuth, requireRole }: LegacyLeaveRouteDependencies,
) {
  app.post(
    '/api/leave-requests',
    demoAuth,
    requireRole(['hr_admin', 'manager', 'employee']),
    async (req, res) => {
      const { startDate, endDate, reason } = req.body;
      const normalizedReason = typeof reason === 'string' ? reason.trim() : '';
  
      const tenantId = req.authUser!.tenantId;
      const employeeId = req.authUser!.employeeId;
  
      if (!startDate || !endDate || !normalizedReason) {
        return res.status(400).json({
          error: 'startDate, endDate, and reason are required',
        });
      }
  
      if (!isValidDateInput(startDate) || !isValidDateInput(endDate) || endDate < startDate) {
        return res.status(400).json({
          error: 'startDate and endDate must be valid YYYY-MM-DD dates, and endDate must not be before startDate.',
        });
      }
  
      if (normalizedReason.length > 1000) {
        return res.status(400).json({
          error: 'reason must be 1000 characters or fewer.',
        });
      }
  
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ error: 'DATABASE_URL is required for leave requests' });
      }
  
      try {
        const leaveRequest = await withTenant(tenantId, async (client) => {
          const result = await client.query<{ id: string }>(
            `
              INSERT INTO leave_requests (
                tenant_id,
                employee_id,
                start_date,
                end_date,
                reason
              )
              VALUES ($1, $2, $3, $4, $5)
              RETURNING id
            `,
            [tenantId, employeeId, startDate, endDate, normalizedReason],
          );
  
          return result.rows[0];
        });
  
        await enqueueBestEffort(
          'leave request audit log',
          () => enqueueAuditLog({
            tenantId,
            actorEmployeeId: employeeId,
            action: 'leave_requested',
            entityType: 'leave_request',
            entityId: leaveRequest.id,
            metadata: { startDate, endDate, reason: normalizedReason },
          }),
        );
  
        res.status(201).json({ success: true, leaveRequestId: leaveRequest.id });
      } catch (error) {
        console.error('[Leave] Failed to create leave request:', error);
        res.status(500).json({ error: 'Unable to create leave request' });
      }
    });
  
  app.patch(
    '/api/leave-requests/:id/status',
    demoAuth,
    requireRole(['hr_admin', 'manager']),
    async (req, res) => {
      const { id } = req.params;
      const { status } = req.body;
  
      const tenantId = req.authUser!.tenantId;
      const actorEmployeeId = req.authUser!.employeeId;
  
  if (!status) {
    return res.status(400).json({
      error: 'status is required',
    });
  }
  
      if (!['approved', 'rejected', 'cancelled'].includes(status)) {
        return res.status(400).json({ error: 'status must be approved, rejected, or cancelled' });
      }
  
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ error: 'DATABASE_URL is required for leave requests' });
      }
  
      try {
        const leaveRequest = await withTenant(tenantId, async (client) => {
          const current = await client.query<{ id: string; employee_id: string; status: string }>(
            `SELECT id, employee_id, status
               FROM leave_requests
              WHERE tenant_id = $1 AND id = $2
              FOR UPDATE`,
            [tenantId, id],
          );
          if (!current.rows[0]) {
            throw Object.assign(new Error('Leave request not found'), { statusCode: 404 });
          }
          if (current.rows[0].status !== 'pending') {
            throw Object.assign(new Error('Leave request has already been decided.'), { statusCode: 409 });
          }
  
          const result = await client.query<{ id: string; employee_id: string; status: string }>(
            `UPDATE leave_requests
                SET status = $3::varchar,
                    approved_by = CASE WHEN $3::varchar = 'approved' THEN $2 ELSE approved_by END,
                    updated_at = NOW()
              WHERE tenant_id = $1 AND id = $4 AND status = 'pending'
              RETURNING id, employee_id, status`,
            [tenantId, actorEmployeeId, status, id],
          );
          const row = result.rows[0];
          if (!row) {
            throw Object.assign(new Error('Leave request was changed concurrently.'), { statusCode: 409 });
          }
  
          const setting = await client.query<{ enabled: boolean }>(
            `SELECT enabled FROM user_notification_settings
              WHERE tenant_id = $1 AND employee_id = $2
                AND channel = 'in_app' AND notification_key = 'leave_updates'
              LIMIT 1`,
            [tenantId, row.employee_id],
          );
          if (setting.rows[0]?.enabled !== false) {
            await client.query(
              `INSERT INTO outbox_events (tenant_id, event_type, payload)
               VALUES ($1, 'notification.leave_updated', $2::jsonb)`,
              [tenantId, JSON.stringify({
                notificationKey: 'leave_updates',
                leaveRequestId: row.id,
                recipientEmployeeIds: [row.employee_id],
                title: status === 'approved' ? 'Leave approved' : status === 'rejected' ? 'Leave rejected' : 'Leave cancelled',
                status,
              })],
            );
          }
          await client.query(
            `INSERT INTO audit_logs (tenant_id, actor_employee_id, action, entity_type, entity_id, metadata)
             VALUES ($1, $2, 'leave_status_changed', 'leave_request', $3, $4::jsonb)`,
            [tenantId, actorEmployeeId, row.id, JSON.stringify({ employeeId: row.employee_id, status })],
          );
          return row;
        });
  
        res.json({ success: true, leaveRequest });
      } catch (error) {
        const typed = error as { statusCode?: number; message?: string };
        if (typed.statusCode === 404 || typed.statusCode === 409) {
          return res.status(typed.statusCode).json({ success: false, error: typed.message });
        }
        console.error('[Leave] Failed to update leave request status:', error);
        res.status(500).json({ error: 'Unable to update leave request status' });
      }
    });
}
