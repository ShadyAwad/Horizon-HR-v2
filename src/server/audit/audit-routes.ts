import type express from 'express';
import type { RequestHandler } from 'express';
import { withTenant } from '../../lib/hr-background';
import {
  AUDIT_MODULES,
  presentAuditEvent,
  storedActionsForFilter,
} from './audit-events';

type Dependencies = {
  demoAuth: RequestHandler;
  requirePermission: (permission: string) => RequestHandler;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY_PATTERN = /^[a-z0-9_.-]{1,120}$/i;
const MODULE_SQL = `
  CASE
    WHEN audit_logs.action LIKE 'auth.%' OR audit_logs.action LIKE 'passkey.%' OR audit_logs.entity_type = 'user_webauthn_credentials' THEN 'auth'
    WHEN audit_logs.action LIKE 'clock_%' OR audit_logs.action LIKE 'attendance.%' OR audit_logs.entity_type = 'time_log' THEN 'attendance'
    WHEN audit_logs.action LIKE 'break_%' OR audit_logs.entity_type = 'break_request' THEN 'breaks'
    WHEN audit_logs.action LIKE 'employee_%' OR audit_logs.action LIKE 'profile.%' OR audit_logs.action LIKE '%role%' OR audit_logs.entity_type IN ('employee', 'employee_compensation_profile', 'employee_loan', 'tenant_role') THEN 'employees'
    WHEN audit_logs.action LIKE 'company_feed_%' OR audit_logs.action LIKE 'feed.%' OR audit_logs.entity_type = 'company_feed_post' THEN 'feed'
    WHEN audit_logs.action LIKE 'company_location_%' OR audit_logs.action LIKE 'geofence.%' OR audit_logs.entity_type = 'company_location' THEN 'geofence'
    WHEN audit_logs.action LIKE 'grievance%' OR audit_logs.entity_type = 'grievance' THEN 'grievances'
    WHEN audit_logs.action LIKE 'hiring.%' OR audit_logs.entity_type LIKE 'hiring_%' THEN 'hiring'
    WHEN audit_logs.action LIKE 'leave_%' OR audit_logs.action LIKE 'leave.%' OR audit_logs.entity_type = 'leave_request' THEN 'leave'
    WHEN audit_logs.action LIKE 'notification_%' OR audit_logs.entity_type = 'notification_settings' THEN 'notifications'
    WHEN audit_logs.action LIKE 'payroll%' OR audit_logs.entity_type IN ('payroll', 'payroll_record') THEN 'payroll'
    WHEN audit_logs.action LIKE 'resignation.%' OR audit_logs.entity_type = 'resignation_request' THEN 'resignations'
    WHEN audit_logs.action LIKE 'roster.%' OR audit_logs.entity_type = 'roster_shift' THEN 'roster'
    ELSE 'workspace'
  END
`;

function parsePositiveInteger(value: unknown, fallback: number, label: string) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw Object.assign(new Error(`${label} must be a positive integer.`), { statusCode: 400 });
  }
  return Number(value);
}

function parseDate(value: unknown, label: string) {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw Object.assign(new Error(`${label} must be a valid YYYY-MM-DD date.`), { statusCode: 400 });
  }
  return value;
}

function parseKey(value: unknown, label: string) {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !KEY_PATTERN.test(value)) {
    throw Object.assign(new Error(`${label} is invalid.`), { statusCode: 400 });
  }
  return value;
}

function parseUuid(value: unknown, label: string) {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw Object.assign(new Error(`${label} must be a valid UUID.`), { statusCode: 400 });
  }
  return value;
}

function targetDisplayName(row: Record<string, unknown>) {
  if (typeof row.target_employee_name === 'string') return row.target_employee_name;
  if (typeof row.target_applicant_name === 'string') return row.target_applicant_name;
  if (typeof row.target_location_name === 'string') return row.target_location_name;
  const type = String(row.entity_type || 'record').replace(/_/g, ' ');
  return type.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function registerAuditRoutes(app: express.Express, { demoAuth, requirePermission }: Dependencies) {
  app.get('/api/hr/audit-events', demoAuth, requirePermission('audit.view'), async (req, res) => {
    try {
      const page = parsePositiveInteger(req.query.page, 1, 'page');
      const pageSize = Math.min(parsePositiveInteger(req.query.pageSize, 25, 'pageSize'), 100);
      const action = parseKey(req.query.action, 'action');
      const moduleName = parseKey(req.query.module, 'module');
      if (moduleName && !(AUDIT_MODULES as readonly string[]).includes(moduleName)) {
        throw Object.assign(new Error('module is invalid.'), { statusCode: 400 });
      }
      const actorId = parseUuid(req.query.actorId, 'actorId');
      const targetType = parseKey(req.query.targetType, 'targetType');
      const targetId = parseUuid(req.query.targetId, 'targetId');
      const dateFrom = parseDate(req.query.dateFrom, 'dateFrom');
      const dateTo = parseDate(req.query.dateTo, 'dateTo');
      if (dateFrom && dateTo && dateFrom > dateTo) {
        throw Object.assign(new Error('dateFrom cannot be after dateTo.'), { statusCode: 400 });
      }
      const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
      if (search.length > 100) throw Object.assign(new Error('search must be 100 characters or fewer.'), { statusCode: 400 });
      if (req.query.search !== undefined && typeof req.query.search !== 'string') {
        throw Object.assign(new Error('search is invalid.'), { statusCode: 400 });
      }

      const tenantId = req.authUser!.tenantId;
      const result = await withTenant(tenantId, async (client) => {
        const values: unknown[] = [tenantId];
        const conditions = ['audit_logs.tenant_id = $1'];
        const add = (condition: (position: number) => string, value: unknown) => {
          values.push(value);
          conditions.push(condition(values.length));
        };

        if (action) add((position) => `audit_logs.action = ANY($${position}::varchar[])`, storedActionsForFilter(action));
        if (moduleName) add((position) => `(${MODULE_SQL}) = $${position}::varchar`, moduleName);
        if (actorId) add((position) => `audit_logs.actor_employee_id = $${position}::uuid`, actorId);
        if (targetType) add((position) => `audit_logs.entity_type = $${position}::varchar`, targetType);
        if (targetId) add((position) => `audit_logs.entity_id = $${position}::uuid`, targetId);
        if (dateFrom) add((position) => `audit_logs.created_at >= $${position}::date`, dateFrom);
        if (dateTo) add((position) => `audit_logs.created_at < ($${position}::date + INTERVAL '1 day')`, dateTo);
        if (search) {
          add((position) => `(
            audit_logs.action ILIKE '%' || $${position}::text || '%'
            OR audit_logs.entity_type ILIKE '%' || $${position}::text || '%'
            OR COALESCE(actor.full_name, '') ILIKE '%' || $${position}::text || '%'
            OR COALESCE(target_employee.full_name, '') ILIKE '%' || $${position}::text || '%'
            OR COALESCE(target_applicant.full_name, '') ILIKE '%' || $${position}::text || '%'
            OR COALESCE(target_location.name, '') ILIKE '%' || $${position}::text || '%'
          )`, search);
        }

        const fromAndJoins = `
          FROM audit_logs
          LEFT JOIN employees actor
            ON actor.tenant_id = audit_logs.tenant_id
           AND actor.id = audit_logs.actor_employee_id
          LEFT JOIN employees target_employee
            ON target_employee.tenant_id = audit_logs.tenant_id
           AND audit_logs.entity_type = 'employee'
           AND target_employee.id = audit_logs.entity_id
          LEFT JOIN hiring_applicants target_applicant
            ON target_applicant.tenant_id = audit_logs.tenant_id
           AND audit_logs.entity_type = 'hiring_applicant'
           AND target_applicant.id = audit_logs.entity_id
          LEFT JOIN company_locations target_location
            ON target_location.tenant_id = audit_logs.tenant_id
           AND audit_logs.entity_type = 'company_location'
           AND target_location.id = audit_logs.entity_id
          WHERE ${conditions.join(' AND ')}
        `;

        const count = await client.query<{ total: string }>(`SELECT COUNT(*)::text AS total ${fromAndJoins}`, values);
        const pageValues = [...values, pageSize, (page - 1) * pageSize];
        const rows = await client.query(
          `SELECT
             audit_logs.id,
             audit_logs.action,
             audit_logs.entity_type,
             audit_logs.entity_id,
             audit_logs.metadata,
             audit_logs.created_at,
             actor.id AS actor_id,
             actor.full_name AS actor_name,
             actor.role AS actor_role,
             target_employee.full_name AS target_employee_name,
             target_applicant.full_name AS target_applicant_name,
             target_location.name AS target_location_name
           ${fromAndJoins}
           ORDER BY audit_logs.created_at DESC, audit_logs.id DESC
           LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
          pageValues,
        );
        const summary = await client.query<{
          events_today: string;
          security_events: string;
          employee_changes: string;
          rejected_actions: string;
        }>(
          `SELECT
             COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::text AS events_today,
             COUNT(*) FILTER (WHERE action LIKE 'auth.%' OR action LIKE 'passkey.%' OR entity_type = 'user_webauthn_credentials')::text AS security_events,
             COUNT(*) FILTER (WHERE action LIKE 'employee%' OR action LIKE '%role%' OR entity_type IN ('employee', 'employee_compensation_profile'))::text AS employee_changes,
             COUNT(*) FILTER (WHERE action ILIKE '%rejected%' OR action ILIKE '%failed%' OR metadata->>'status' = 'rejected')::text AS rejected_actions
           FROM audit_logs
           WHERE tenant_id = $1`,
          [tenantId],
        );

        return {
          total: Number(count.rows[0]?.total || 0),
          rows: rows.rows,
          summary: summary.rows[0],
        };
      });

      const events = result.rows.map((row) => {
        const presentation = presentAuditEvent(row.action, row.entity_type, row.metadata);
        return {
          id: row.id,
          action: presentation.action,
          module: presentation.module,
          severity: presentation.severity,
          actor: {
            id: row.actor_id || null,
            displayName: row.actor_name || 'System',
            role: row.actor_role || 'system',
          },
          target: {
            type: row.entity_type,
            id: row.entity_id || null,
            displayName: targetDisplayName(row),
          },
          summary: presentation.summary,
          createdAt: row.created_at,
          metadata: presentation.metadata,
        };
      });

      res.setHeader('Cache-Control', 'no-store');
      return res.json({
        success: true,
        page,
        pageSize,
        total: result.total,
        summary: {
          eventsToday: Number(result.summary?.events_today || 0),
          securityEvents: Number(result.summary?.security_events || 0),
          employeeChanges: Number(result.summary?.employee_changes || 0),
          rejectedActions: Number(result.summary?.rejected_actions || 0),
        },
        events,
      });
    } catch (error) {
      const statusCode = Number((error as { statusCode?: number }).statusCode) || 500;
      if (statusCode >= 500) console.error('[Audit Trail] Failed to load events:', error);
      return res.status(statusCode).json({
        success: false,
        code: statusCode === 400 ? 'AUDIT_QUERY_INVALID' : 'AUDIT_EVENTS_FAILED',
        error: statusCode === 400 ? (error as Error).message : 'Unable to load audit events.',
      });
    }
  });
}
