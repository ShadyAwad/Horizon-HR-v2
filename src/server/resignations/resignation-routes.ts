import { logServerError } from '../../lib/server-logging';
import type express from 'express';
import { hasDatabaseConfig, withTenant } from '../../lib/hr-background';

type EmployeeRole = 'employee' | 'manager' | 'hr_admin';
type ResignationType = 'voluntary' | 'personal_reasons' | 'career_change' | 'other';

type CreateResignationBody = {
  resignationType?: ResignationType;
  requestedLastWorkingDay?: string;
  reason?: string;
};

type ReviewResignationBody = {
  status?: 'approved' | 'rejected';
  reviewNote?: string;
};

type PermissionMiddlewareFactory = (
  permissionKey: string,
  fallbackRoles: EmployeeRole[],
) => express.RequestHandler;

type ResignationRouteDependencies = {
  standardAuth: express.RequestHandler;
  requireResignationPermission: PermissionMiddlewareFactory;
};

const resignationTypes = new Set<ResignationType>([
  'voluntary',
  'personal_reasons',
  'career_change',
  'other',
]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const isUuid = (value: unknown): value is string => (
  typeof value === 'string' && uuidPattern.test(value)
);

const isValidDateInput = (value: unknown): value is string => {
  if (typeof value !== 'string' || !datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const isResignationType = (value: unknown): value is ResignationType => (
  typeof value === 'string' && resignationTypes.has(value as ResignationType)
);

export function registerResignationRoutes(
  app: express.Express,
  { standardAuth, requireResignationPermission }: ResignationRouteDependencies,
) {
  app.get(
    '/api/resignations/me',
    standardAuth,
    requireResignationPermission('resignations.view_own', ['employee', 'manager', 'hr_admin']),
    async (req, res) => {
      const { tenantId, employeeId } = req.authUser!;
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ success: false, error: 'DATABASE_URL is required for resignations' });
      }

      try {
        const resignations = await withTenant(tenantId, async (client) => (await client.query(
          `SELECT id, employee_id, resignation_type, requested_last_working_day, reason, status, reviewed_by, reviewed_at, review_note, created_at, updated_at
           FROM resignation_requests WHERE tenant_id = $1 AND employee_id = $2 ORDER BY created_at DESC LIMIT 50`,
          [tenantId, employeeId],
        )).rows);
        res.json({ success: true, resignations });
      } catch (error) {
        logServerError('[Resignations] Failed to load employee requests:', error);
        res.status(500).json({ success: false, error: 'Unable to load resignation requests' });
      }
    },
  );

  app.post(
    '/api/resignations',
    standardAuth,
    requireResignationPermission('resignations.create', ['employee', 'manager', 'hr_admin']),
    async (req, res) => {
      const { resignationType = 'voluntary', requestedLastWorkingDay, reason } = req.body as CreateResignationBody;
      const { tenantId, employeeId } = req.authUser!;
      const normalizedReason = reason?.trim() || null;
      const today = new Date().toISOString().slice(0, 10);

      if (
        !isResignationType(resignationType)
        || !isValidDateInput(requestedLastWorkingDay)
        || requestedLastWorkingDay < today
        || (normalizedReason && normalizedReason.length > 2000)
      ) {
        return res.status(400).json({
          success: false,
          error: 'Provide a valid future last working day, resignation type, and reason.',
        });
      }
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ success: false, error: 'DATABASE_URL is required for resignations' });
      }

      try {
        const resignation = await withTenant(tenantId, async (client) => {
          const existing = await client.query(
            'SELECT id FROM resignation_requests WHERE tenant_id = $1 AND employee_id = $2 AND status = $3 LIMIT 1',
            [tenantId, employeeId, 'pending'],
          );
          if (existing.rowCount) {
            throw Object.assign(new Error('You already have a pending resignation request.'), { statusCode: 409 });
          }

          const created = await client.query(
            `INSERT INTO resignation_requests (tenant_id, employee_id, resignation_type, requested_last_working_day, reason)
             VALUES ($1, $2, $3, $4::date, $5::text)
             RETURNING id, employee_id, resignation_type, requested_last_working_day, reason, status, reviewed_by, reviewed_at, review_note, created_at, updated_at`,
            [tenantId, employeeId, resignationType, requestedLastWorkingDay, normalizedReason],
          );
          const row = created.rows[0];
          await client.query(
            `INSERT INTO audit_logs (tenant_id, actor_employee_id, action, entity_type, entity_id, metadata)
             VALUES ($1, $2, 'resignation.created', 'resignation_request', $3, $4::jsonb)`,
            [tenantId, employeeId, row.id, JSON.stringify({ requestedLastWorkingDay, resignationType })],
          );
          await client.query(
            `INSERT INTO outbox_events (tenant_id, event_type, payload)
             VALUES ($1, 'resignation.submitted', $2::jsonb)`,
            [tenantId, JSON.stringify({
              resignationId: row.id,
              employeeId,
              notificationKey: 'system_alerts',
              title: 'Resignation request submitted',
            })],
          );
          return row;
        });
        res.status(201).json({ success: true, resignation });
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 409) {
          return res.status(409).json({ success: false, error: (error as Error).message });
        }
        logServerError('[Resignations] Failed to create request:', error);
        res.status(500).json({ success: false, error: 'Unable to submit resignation request' });
      }
    },
  );

  app.get(
    '/api/resignations',
    standardAuth,
    requireResignationPermission('resignations.view_all', ['manager', 'hr_admin']),
    async (req, res) => {
      const { tenantId } = req.authUser!;
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ success: false, error: 'DATABASE_URL is required for resignations' });
      }

      try {
        const resignations = await withTenant(tenantId, async (client) => (await client.query(
          `SELECT r.id, r.employee_id, e.full_name, e.email, r.resignation_type, r.requested_last_working_day, r.reason, r.status,
                  r.reviewed_by, reviewer.full_name AS reviewer_name, r.reviewed_at, r.review_note, r.created_at, r.updated_at,
                  outstanding_assets.outstanding_asset_count
           FROM resignation_requests r
           INNER JOIN employees e ON e.id = r.employee_id AND e.tenant_id = r.tenant_id
           LEFT JOIN employees reviewer ON reviewer.id = r.reviewed_by AND reviewer.tenant_id = r.tenant_id
           LEFT JOIN LATERAL (
             SELECT COUNT(*)::integer AS outstanding_asset_count
             FROM asset_assignments asset_assignment
             WHERE asset_assignment.tenant_id = r.tenant_id
               AND asset_assignment.employee_id = r.employee_id
               AND asset_assignment.status = 'active'
           ) outstanding_assets ON true
           WHERE r.tenant_id = $1 ORDER BY r.created_at DESC LIMIT 100`,
          [tenantId],
        )).rows);
        res.json({ success: true, resignations });
      } catch (error) {
        logServerError('[Resignations] Failed to load tenant requests:', error);
        res.status(500).json({ success: false, error: 'Unable to load resignation requests' });
      }
    },
  );

  app.patch(
    '/api/resignations/:id/review',
    standardAuth,
    requireResignationPermission('resignations.review', ['manager', 'hr_admin']),
    async (req, res) => {
      const { id } = req.params;
      const { status, reviewNote } = req.body as ReviewResignationBody;
      const { tenantId, employeeId } = req.authUser!;
      const note = reviewNote?.trim() || null;

      if (!isUuid(id) || (status !== 'approved' && status !== 'rejected') || (note && note.length > 2000)) {
        return res.status(400).json({ success: false, error: 'Provide a valid request, review status, and note.' });
      }

      try {
        const resignation = await withTenant(tenantId, async (client) => {
          const result = await client.query(
            `UPDATE resignation_requests SET status = $3::varchar, reviewed_by = $4::uuid, reviewed_at = NOW(), review_note = $5::text, updated_at = NOW()
             WHERE tenant_id = $1 AND id = $2 AND status = 'pending'
             RETURNING id, employee_id, resignation_type, requested_last_working_day, reason, status, reviewed_by, reviewed_at, review_note, created_at, updated_at`,
            [tenantId, id, status, employeeId, note],
          );
          if (!result.rowCount) {
            throw Object.assign(new Error('Pending resignation request not found.'), { statusCode: 404 });
          }
          const row = result.rows[0];
          await client.query(
            `INSERT INTO audit_logs (tenant_id, actor_employee_id, action, entity_type, entity_id, metadata)
             VALUES ($1, $2, $3, 'resignation_request', $4, $5::jsonb)`,
            [tenantId, employeeId, `resignation.${status}`, id, JSON.stringify({ reviewNote: note })],
          );
          await client.query(
            'INSERT INTO outbox_events (tenant_id, event_type, payload) VALUES ($1, $2, $3::jsonb)',
            [tenantId, `resignation.${status}`, JSON.stringify({
              resignationId: id,
              employeeId: row.employee_id,
              notificationKey: 'system_alerts',
              title: `Resignation request ${status}`,
            })],
          );
          return row;
        });
        res.json({ success: true, resignation });
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404) {
          return res.status(404).json({ success: false, error: (error as Error).message });
        }
        logServerError('[Resignations] Failed to review request:', error);
        res.status(500).json({ success: false, error: 'Unable to review resignation request' });
      }
    },
  );

  app.patch(
    '/api/resignations/:id/withdraw',
    standardAuth,
    requireResignationPermission('resignations.create', ['employee', 'manager', 'hr_admin']),
    async (req, res) => {
      const { id } = req.params;
      const { tenantId, employeeId } = req.authUser!;
      if (!isUuid(id)) {
        return res.status(400).json({ success: false, error: 'Resignation request id must be a valid UUID.' });
      }

      try {
        const resignation = await withTenant(tenantId, async (client) => {
          const result = await client.query(
            `UPDATE resignation_requests SET status = 'withdrawn', updated_at = NOW()
             WHERE tenant_id = $1 AND id = $2 AND employee_id = $3 AND status = 'pending'
             RETURNING id, status, employee_id, updated_at`,
            [tenantId, id, employeeId],
          );
          if (!result.rowCount) {
            throw Object.assign(new Error('Pending resignation request not found.'), { statusCode: 404 });
          }
          await client.query(
            `INSERT INTO audit_logs (tenant_id, actor_employee_id, action, entity_type, entity_id, metadata)
             VALUES ($1, $2, 'resignation.withdrawn', 'resignation_request', $3, '{}'::jsonb)`,
            [tenantId, employeeId, id],
          );
          return result.rows[0];
        });
        res.json({ success: true, resignation });
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404) {
          return res.status(404).json({ success: false, error: (error as Error).message });
        }
        logServerError('[Resignations] Failed to withdraw request:', error);
        res.status(500).json({ success: false, error: 'Unable to withdraw resignation request' });
      }
    },
  );

  app.patch(
    '/api/resignations/:id/process',
    standardAuth,
    requireResignationPermission('resignations.process', ['hr_admin']),
    async (req, res) => {
      const { id } = req.params;
      const { tenantId, employeeId } = req.authUser!;
      if (!isUuid(id)) {
        return res.status(400).json({ success: false, error: 'Resignation request id must be a valid UUID.' });
      }

      try {
        const resignation = await withTenant(tenantId, async (client) => {
          const result = await client.query(
            `UPDATE resignation_requests SET status = 'processed', updated_at = NOW()
             WHERE tenant_id = $1 AND id = $2 AND status = 'approved'
             RETURNING id, employee_id, status, updated_at`,
            [tenantId, id],
          );
          if (!result.rowCount) {
            throw Object.assign(new Error('Approved resignation request not found.'), { statusCode: 404 });
          }
          await client.query(
            `INSERT INTO audit_logs (tenant_id, actor_employee_id, action, entity_type, entity_id, metadata)
             VALUES ($1, $2, 'resignation.processed', 'resignation_request', $3, '{}'::jsonb)`,
            [tenantId, employeeId, id],
          );
          const outstandingAssets = await client.query<{ count: number }>(
            `SELECT COUNT(*)::integer AS count FROM asset_assignments
             WHERE tenant_id=$1 AND employee_id=$2 AND status='active'`,
            [tenantId, result.rows[0].employee_id],
          );
          if (outstandingAssets.rows[0].count > 0) {
            await client.query(
              `INSERT INTO audit_logs (tenant_id, actor_employee_id, action, entity_type, entity_id, metadata)
               VALUES ($1, $2, 'offboarding.completed_with_assets', 'resignation_request', $3, $4::jsonb)`,
              [tenantId, employeeId, id, JSON.stringify({
                outstandingAssetCount: outstandingAssets.rows[0].count,
              })],
            );
          }
          await client.query(
            `INSERT INTO outbox_events (tenant_id, event_type, payload)
             VALUES ($1, 'resignation.processed', $2::jsonb)`,
            [tenantId, JSON.stringify({
              resignationId: id,
              employeeId: result.rows[0].employee_id,
              notificationKey: 'system_alerts',
              title: 'Resignation request processed',
            })],
          );
          return result.rows[0];
        });
        res.json({ success: true, resignation });
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404) {
          return res.status(404).json({ success: false, error: (error as Error).message });
        }
        logServerError('[Resignations] Failed to process request:', error);
        res.status(500).json({ success: false, error: 'Unable to process resignation request' });
      }
    },
  );
}
