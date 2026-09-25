import type express from 'express';
import { hasDatabaseConfig, withTenant } from '../../lib/hr-background';
import { recordAuditEvent } from '../audit/audit-events';

type EmployeeRole = 'employee' | 'manager' | 'hr_admin';
type GrievancePriority = 'low' | 'normal' | 'high' | 'urgent';
type GrievanceStatus = 'open' | 'under_review' | 'resolved' | 'rejected' | 'closed';

type CreateGrievanceBody = {
  title?: string;
  description?: string;
  category?: string;
  priority?: GrievancePriority;
};

type UpdateGrievanceStatusBody = {
  status?: GrievanceStatus;
  assignedTo?: string | null;
};

type GrievanceRouteDependencies = {
  standardAuth: express.RequestHandler;
  requireRole: (roles: EmployeeRole[]) => express.RequestHandler;
};

const grievancePriorities: GrievancePriority[] = ['low', 'normal', 'high', 'urgent'];
const grievanceStatuses: GrievanceStatus[] = ['open', 'under_review', 'resolved', 'rejected', 'closed'];

function isGrievancePriority(value: unknown): value is GrievancePriority {
  return typeof value === 'string' && grievancePriorities.includes(value as GrievancePriority);
}

function isGrievanceStatus(value: unknown): value is GrievanceStatus {
  return typeof value === 'string' && grievanceStatuses.includes(value as GrievanceStatus);
}

export function registerGrievanceRoutes(
  app: express.Express,
  { standardAuth, requireRole }: GrievanceRouteDependencies,
) {
  app.post(
    '/api/grievances',
    standardAuth,
    requireRole(['employee', 'manager', 'hr_admin']),
    async (req, res) => {
      const { title, description, category = 'general', priority = 'normal' } = req.body as CreateGrievanceBody;
      const tenantId = req.authUser!.tenantId;
      const employeeId = req.authUser!.employeeId;
      const normalizedTitle = title?.trim() || '';
      const normalizedDescription = description?.trim() || '';
      const normalizedCategory = category?.trim() || 'general';

      if (!normalizedTitle || !normalizedDescription) {
        return res.status(400).json({ success: false, error: 'title and description are required.' });
      }
      if (!isGrievancePriority(priority)) {
        return res.status(400).json({ success: false, error: 'priority must be low, normal, high, or urgent.' });
      }
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ success: false, error: 'DATABASE_URL is required for grievances' });
      }

      try {
        const grievance = await withTenant(tenantId, async (client) => {
          const result = await client.query(
            `INSERT INTO grievances (
               tenant_id, employee_id, title, description, category, priority, status
             ) VALUES ($1, $2, $3, $4, $5, $6, 'open')
             RETURNING id, tenant_id, employee_id, assigned_to, title, description,
               category, priority, status, created_at, updated_at, resolved_at`,
            [tenantId, employeeId, normalizedTitle, normalizedDescription, normalizedCategory, priority],
          );
          const createdGrievance = result.rows[0];

          await client.query(
            `INSERT INTO audit_logs (
               tenant_id, actor_employee_id, action, entity_type, entity_id, metadata
             ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
            [
              tenantId,
              employeeId,
              'grievance_created',
              'grievance',
              createdGrievance.id,
              JSON.stringify({ title: normalizedTitle, category: normalizedCategory, priority }),
            ],
          );
          return createdGrievance;
        });

        res.status(201).json({ success: true, grievanceId: grievance.id, grievance });
      } catch (error) {
        console.error('[Grievances] Failed to create grievance:', error);
        res.status(500).json({ success: false, error: 'Unable to create grievance' });
      }
    },
  );

  app.get(
    '/api/grievances/me',
    standardAuth,
    requireRole(['employee', 'manager', 'hr_admin']),
    async (req, res) => {
      const tenantId = req.authUser!.tenantId;
      const employeeId = req.authUser!.employeeId;
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ success: false, error: 'DATABASE_URL is required for grievances' });
      }

      try {
        const grievances = await withTenant(tenantId, async (client) => (await client.query(
          `SELECT id, employee_id, assigned_to, title, description, category, priority,
             status, created_at, updated_at, resolved_at
           FROM grievances
           WHERE tenant_id = $1 AND employee_id = $2
           ORDER BY created_at DESC LIMIT 50`,
          [tenantId, employeeId],
        )).rows);
        res.json({ success: true, grievances });
      } catch (error) {
        console.error('[Grievances] Failed to load employee grievances:', error);
        res.status(500).json({ success: false, error: 'Unable to load grievances' });
      }
    },
  );

  app.get(
    '/api/grievances',
    standardAuth,
    requireRole(['manager', 'hr_admin']),
    async (req, res) => {
      const tenantId = req.authUser!.tenantId;
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ success: false, error: 'DATABASE_URL is required for grievances' });
      }

      try {
        const grievances = await withTenant(tenantId, async (client) => (await client.query(
          `SELECT grievances.id, grievances.employee_id, submitter.full_name, submitter.email,
             grievances.assigned_to, assignee.full_name AS assigned_to_name,
             assignee.email AS assigned_to_email, grievances.title, grievances.description,
             grievances.category, grievances.priority, grievances.status, grievances.created_at,
             grievances.updated_at, grievances.resolved_at
           FROM grievances
           INNER JOIN employees submitter
             ON submitter.id = grievances.employee_id AND submitter.tenant_id = grievances.tenant_id
           LEFT JOIN employees assignee
             ON assignee.id = grievances.assigned_to AND assignee.tenant_id = grievances.tenant_id
           WHERE grievances.tenant_id = $1
           ORDER BY grievances.created_at DESC LIMIT 100`,
          [tenantId],
        )).rows);
        res.json({ success: true, grievances });
      } catch (error) {
        console.error('[Grievances] Failed to load tenant grievances:', error);
        res.status(500).json({ success: false, error: 'Unable to load grievances' });
      }
    },
  );

  app.patch(
    '/api/grievances/:id/status',
    standardAuth,
    requireRole(['manager', 'hr_admin']),
    async (req, res) => {
      const { id } = req.params;
      const { status, assignedTo } = req.body as UpdateGrievanceStatusBody;
      const tenantId = req.authUser!.tenantId;
      const actorEmployeeId = req.authUser!.employeeId;

      if (!isGrievanceStatus(status)) {
        return res.status(400).json({ success: false, error: 'status must be open, under_review, resolved, rejected, or closed.' });
      }
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ success: false, error: 'DATABASE_URL is required for grievances' });
      }

      try {
        const grievance = await withTenant(tenantId, async (client) => {
          if (assignedTo !== undefined && assignedTo !== null) {
            const assigneeResult = await client.query(
              `SELECT id FROM employees WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
              [tenantId, assignedTo],
            );
            if (assigneeResult.rowCount === 0) {
              throw Object.assign(new Error('Assignee not found in tenant.'), { statusCode: 400 });
            }
          }

          const existingResult = await client.query<{ status: GrievanceStatus }>(
            `SELECT status FROM grievances
             WHERE tenant_id = $1 AND id = $2 LIMIT 1 FOR UPDATE`,
            [tenantId, id],
          );
          if (existingResult.rowCount === 0) {
            throw Object.assign(new Error('Grievance not found.'), { statusCode: 404 });
          }

          const previousStatus = existingResult.rows[0].status;
          const shouldResolve = status === 'resolved' || status === 'closed';
          const shouldClearResolution = status === 'open' || status === 'under_review';
          const updateResult = await client.query(
            `UPDATE grievances
             SET status = $3,
               assigned_to = CASE
                 WHEN $4::uuid IS NULL AND $5::boolean THEN NULL
                 WHEN $4::uuid IS NULL THEN assigned_to
                 ELSE $4::uuid
               END,
               resolved_at = CASE
                 WHEN $6::boolean THEN NOW()
                 WHEN $7::boolean THEN NULL
                 ELSE resolved_at
               END,
               updated_at = NOW()
             WHERE tenant_id = $1 AND id = $2
             RETURNING id, employee_id, assigned_to, title, description, category,
               priority, status, created_at, updated_at, resolved_at`,
            [tenantId, id, status, assignedTo || null, assignedTo === null, shouldResolve, shouldClearResolution],
          );
          const updatedGrievance = updateResult.rows[0];

          await recordAuditEvent(client, {
            tenantId,
            actorId: actorEmployeeId,
            action: 'grievance.status_changed',
            targetType: 'grievance',
            targetId: id,
            metadata: { previousStatus, newStatus: status },
          });
          return updatedGrievance;
        });

        res.json({ success: true, grievance });
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 400 || statusCode === 404) {
          return res.status(statusCode).json({ success: false, error: (error as Error).message });
        }
        console.error('[Grievances] Failed to update grievance status:', error);
        res.status(500).json({ success: false, error: 'Unable to update grievance status' });
      }
    },
  );
}
