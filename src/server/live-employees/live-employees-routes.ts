import type express from 'express';
import { withTenant } from '../../lib/hr-background';
import { getLiveEmployeeOverdueHours } from './live-employees-rules';

type Middleware = express.RequestHandler;

type LiveEmployeesRouteDependencies = {
  demoAuth: Middleware;
  requireRole: (roles: Array<'employee' | 'manager' | 'hr_admin'>) => Middleware;
  requirePermission: (permission: string) => Middleware;
};

type LiveEmployeeRow = {
  employeeId: string;
  displayName: string;
  avatarUrl: string | null;
  department: null;
  role: string;
  clockInTime: Date;
  elapsedMinutes: number;
  status: 'clocked_in' | 'on_break' | 'overdue';
  isValidGeofence: boolean;
  geofenceName: string | null;
  currentBreakStartedAt: Date | null;
  lastAttendanceActivityAt: Date;
};

export function registerLiveEmployeesRoutes(
  app: express.Express,
  dependencies: LiveEmployeesRouteDependencies,
) {
  const { demoAuth, requireRole, requirePermission } = dependencies;

  app.get(
    '/api/hr/live-employees',
    demoAuth,
    requireRole(['hr_admin']),
    requirePermission('attendance.view_live'),
    async (req, res) => {
      const tenantId = req.authUser!.tenantId;
      const overdueHours = getLiveEmployeeOverdueHours();

      try {
        const employees = await withTenant(tenantId, async (client) => {
          const result = await client.query<LiveEmployeeRow>(
            `
              SELECT
                employee.id AS "employeeId",
                employee.full_name AS "displayName",
                employee.profile_image_url AS "avatarUrl",
                NULL::text AS "department",
                COALESCE(NULLIF(employee.job_title, ''), initcap(replace(employee.role, '_', ' '))) AS "role",
                time_log.clock_in_time AS "clockInTime",
                floor(extract(epoch FROM (NOW() - time_log.clock_in_time)) / 60)::integer AS "elapsedMinutes",
                CASE
                  WHEN NOW() >= time_log.clock_in_time + ($2::double precision * interval '1 hour') THEN 'overdue'
                  WHEN active_break.requested_start_time IS NOT NULL THEN 'on_break'
                  ELSE 'clocked_in'
                END AS "status",
                time_log.is_valid_geofence AS "isValidGeofence",
                geofence.name AS "geofenceName",
                active_break.requested_start_time AS "currentBreakStartedAt",
                GREATEST(
                  time_log.clock_in_time,
                  time_log.updated_at,
                  COALESCE(active_break.activity_at, time_log.updated_at)
                ) AS "lastAttendanceActivityAt"
              FROM time_logs AS time_log
              JOIN employees AS employee
                ON employee.tenant_id = time_log.tenant_id
               AND employee.id = time_log.employee_id
              LEFT JOIN LATERAL (
                SELECT
                  break_request.requested_start_time,
                  GREATEST(
                    break_request.created_at,
                    break_request.updated_at,
                    COALESCE(break_request.reviewed_at, break_request.updated_at)
                  ) AS activity_at
                FROM break_requests AS break_request
                WHERE break_request.tenant_id = time_log.tenant_id
                  AND break_request.employee_id = time_log.employee_id
                  AND break_request.status = 'approved'
                  AND break_request.requested_start_time IS NOT NULL
                  AND break_request.requested_end_time IS NOT NULL
                  AND NOW() >= break_request.requested_start_time
                  AND NOW() < break_request.requested_end_time
                ORDER BY break_request.requested_start_time DESC, break_request.id
                LIMIT 1
              ) AS active_break ON TRUE
              LEFT JOIN LATERAL (
                SELECT location.name
                FROM company_locations AS location
                WHERE location.tenant_id = time_log.tenant_id
                  AND location.is_active = TRUE
                  AND time_log.clock_in_location IS NOT NULL
                  AND ST_Intersects(location.boundary, time_log.clock_in_location)
                ORDER BY location.is_primary DESC, location.created_at, location.id
                LIMIT 1
              ) AS geofence ON TRUE
              WHERE time_log.tenant_id = $1
                AND time_log.clock_out_time IS NULL
                AND employee.is_active = TRUE
                AND employee.employment_status = 'active'
              ORDER BY
                CASE
                  WHEN NOW() >= time_log.clock_in_time + ($2::double precision * interval '1 hour') THEN 0
                  WHEN active_break.requested_start_time IS NOT NULL THEN 1
                  ELSE 2
                END,
                time_log.clock_in_time,
                employee.id
            `,
            [tenantId, overdueHours],
          );
          return result.rows;
        });

        res.json({
          success: true,
          generatedAt: new Date().toISOString(),
          overdueHours,
          employees,
        });
      } catch (error) {
        console.error('[Live Employees] Failed to load live employees:', error);
        res.status(500).json({
          success: false,
          error: 'Unable to load live employees.',
        });
      }
    },
  );
}

