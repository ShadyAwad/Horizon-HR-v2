import crypto from 'crypto';
import type express from 'express';
import {
  enqueueAttendanceRollup,
  enqueueAuditLog,
  hasDatabaseConfig,
  withTenant,
} from '../../lib/hr-background';
import { claimPendingRecognitionDelivery } from '../performance/recognition-delivery';

type ClockInBody = {
  tenantId?: string;
  employeeId?: string;
  latitude?: number | string;
  longitude?: number | string;
};

type DemoTimeLog = {
  id: string;
  tenantId: string;
  employeeId: string;
  clockInTime: Date;
  clockOutTime?: Date;
};

type AttendanceRouteDependencies = {
  authWhenDatabaseConfigured: express.RequestHandler;
};

const demoOpenTimeLogs = new Map<string, DemoTimeLog>();

function isDemoEnvironment() {
  return process.env.STANZA_DEMO_ENV === 'true';
}

function getAttendanceKey(tenantId?: string, employeeId?: string) {
  return `${tenantId || 'demo'}:${employeeId || 'employee'}`;
}

function recordDemoClockIn(
  tenantId: string | undefined,
  employeeId: string | undefined,
  clockInTime: Date,
) {
  const key = getAttendanceKey(tenantId, employeeId);
  const existing = demoOpenTimeLogs.get(key);
  if (existing && !existing.clockOutTime) {
    return {
      ok: false as const,
      status: 409,
      body: { success: false, error: 'This employee already has an open shift.' },
    };
  }

  const timeLog: DemoTimeLog = {
    id: crypto.randomUUID(),
    tenantId: tenantId || 'demo',
    employeeId: employeeId || 'employee',
    clockInTime,
  };
  demoOpenTimeLogs.set(key, timeLog);
  return { ok: true as const, status: 201, body: timeLog };
}

function recordDemoClockOut(tenantId?: string, employeeId?: string) {
  const key = getAttendanceKey(tenantId, employeeId);
  const existing = demoOpenTimeLogs.get(key);
  if (!existing || existing.clockOutTime) {
    return {
      ok: false as const,
      status: 404,
      body: { success: false, error: 'No open shift found for this employee' },
    };
  }

  existing.clockOutTime = new Date();
  demoOpenTimeLogs.set(key, existing);
  return {
    ok: true as const,
    status: 200,
    body: {
      success: true,
      timeLogId: existing.id,
      clockedOut: existing.clockOutTime.toISOString(),
      message: 'Clock-out recorded successfully.',
    },
  };
}

function toWorkDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

async function enqueueBestEffort(label: string, task: () => Promise<unknown>) {
  try {
    await task();
  } catch (error) {
    console.error(`[Background Queue] Failed to enqueue ${label}:`, error);
  }
}

export function registerAttendanceClockInRoute(
  app: express.Express,
  { authWhenDatabaseConfigured: demoAuthWhenDatabaseConfigured }: AttendanceRouteDependencies,
) {
  app.post('/api/clock-in', demoAuthWhenDatabaseConfigured, async (req, res) => {
      const body = req.body as ClockInBody;
      const tenantId = req.authUser?.tenantId || body.tenantId;
      const employeeId = req.authUser?.employeeId || body.employeeId;
      const latitude = Number(body.latitude);
      const longitude = Number(body.longitude);
      
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return res.status(400).json({ success: false, error: 'Geolocation required for clock-in.' });
      }
  
      if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        return res.status(400).json({ success: false, error: 'Latitude must be -90 to 90 and longitude must be -180 to 180.' });
      }
  
      // Mock HQ Location: 37.7749, -122.4194 (San Francisco).
      // Used only when DATABASE_URL is not configured.
      const hqLat = 37.7749;
      const hqLng = -122.4194;
      
      let isWithinGeofence = Math.abs(latitude - hqLat) < 0.5 && Math.abs(longitude - hqLng) < 0.5;
      let matchedLocation: { id: string; name: string; locationType: string } | undefined;
      const clockedIn = new Date();
  
      if (hasDatabaseConfig()) {
        if (!tenantId || !employeeId) {
          return res.status(401).json({
            success: false,
            error: 'tenantId and employeeId are required when DATABASE_URL is configured',
          });
        }
  
        try {
          const timeLog = await withTenant(tenantId, async (client) => {
            const activeLocations = await client.query<{ count: string }>(
              `
                SELECT COUNT(*)::text AS count
                FROM company_locations
                WHERE tenant_id = $1
                  AND is_active = true
              `,
              [tenantId],
            );
  
            if (Number(activeLocations.rows[0]?.count || 0) === 0) {
              throw Object.assign(new Error('No active company location found for this workspace.'), { statusCode: 404 });
            }
  
            const locationResult = await client.query<{
              id: string;
              name: string;
              location_type: string;
            }>(
              `
                SELECT id, name, location_type
                FROM company_locations
                WHERE tenant_id = $1
                  AND is_active = true
                  AND ST_Intersects(
                    boundary,
                    ST_SetSRID(ST_MakePoint($2, $3), 4326)
                  )
                ORDER BY is_primary DESC, created_at ASC
                LIMIT 1
              `,
              [tenantId, longitude, latitude],
            );
  
            const location = locationResult.rows[0];
            isWithinGeofence = Boolean(location);
            matchedLocation = location
              ? {
                  id: location.id,
                  name: location.name,
                  locationType: location.location_type,
                }
              : undefined;
  
            if (!isWithinGeofence) {
              throw Object.assign(new Error('You are outside the allowed worksite geofence.'), { statusCode: 403 });
            }
  
            const result = await client.query<{ id: string; clock_in_time: Date }>(
              `
                INSERT INTO time_logs (
                  tenant_id,
                  employee_id,
                  clock_in_time,
                  clock_in_location,
                  is_valid_geofence
                )
                VALUES (
                  $1,
                  $2,
                  $3,
                  ST_SetSRID(ST_MakePoint($4, $5), 4326),
                  $6
                )
                RETURNING id, clock_in_time
              `,
              [tenantId, employeeId, clockedIn, longitude, latitude, isWithinGeofence],
            );
  
            return result.rows[0];
          });
  
          const workDate = toWorkDate(new Date(timeLog.clock_in_time));
  
          await Promise.all([
            enqueueBestEffort(
              'attendance rollup',
              () => enqueueAttendanceRollup({ tenantId, employeeId, workDate }),
            ),
            enqueueBestEffort(
              'clock-in audit log',
              () => enqueueAuditLog({
                tenantId,
                actorEmployeeId: employeeId,
                action: 'clock_in',
                entityType: 'time_log',
                entityId: timeLog.id,
                metadata: {
                  latitude,
                  longitude,
                  locationValid: isWithinGeofence,
                  matchedLocation,
                  workDate,
                },
              }),
            ),
          ]);
  
          let recognition = null;
          try {
            recognition = await claimPendingRecognitionDelivery(tenantId, employeeId, 'clock_in');
          } catch (error) {
            // A recognition delivery failure must not roll back a durable clock-in.
            console.error('[Recognition] Clock-in delivery lookup failed:', error);
          }
  
          return res.json({
            success: true,
            timeLogId: timeLog.id,
            clockedIn: timeLog.clock_in_time,
            locationValid: isWithinGeofence,
            isValidGeofence: isWithinGeofence,
            matchedLocation,
            recognition,
            message: isWithinGeofence ? 'Clock-in secured.' : 'Warning: Clock-in recorded outside geofenced perimeter.',
          });
        } catch (error) {
          const statusCode = Number((error as { statusCode?: number }).statusCode);
          if (statusCode === 404) {
            return res.status(404).json({
              success: false,
              error: (error as Error).message,
            });
          }
  
          if (statusCode === 403) {
            return res.status(403).json({
              success: false,
              locationValid: false,
              isValidGeofence: false,
              error: (error as Error).message,
            });
          }
  
          console.error('[Clock-In] Failed to persist clock-in:', error);
  
          if ((error as { code?: string }).code === '23505') {
            return res.status(409).json({
              success: false,
              error: 'This employee already has an open shift.',
            });
          }
  
          return res.status(503).json({
            success: false,
            error: 'Attendance service is temporarily unavailable. Please try again.',
          });
        }
      }
  
      if (!isDemoEnvironment()) {
        return res.status(503).json({
          success: false,
          error: 'Attendance service is temporarily unavailable. Please try again.',
        });
      }
  
      const demoClockIn = recordDemoClockIn(tenantId, employeeId, clockedIn);
  
      if (!demoClockIn.ok) {
        return res.status(demoClockIn.status).json(demoClockIn.body);
      }
  
      res.status(demoClockIn.status).json({
        success: true,
        timeLogId: demoClockIn.body.id,
        clockedIn: clockedIn.toISOString(),
        locationValid: isWithinGeofence,
        isValidGeofence: isWithinGeofence,
        message: isWithinGeofence ? 'Clock-in secured.' : 'Warning: Clock-in recorded outside geofenced perimeter.'
      });
    });
}

export function registerAttendanceStatusRoutes(
  app: express.Express,
  { authWhenDatabaseConfigured: demoAuthWhenDatabaseConfigured }: AttendanceRouteDependencies,
) {
  app.get('/api/clock-status', demoAuthWhenDatabaseConfigured, async (req, res) => {
    const tenantId = req.authUser?.tenantId || (typeof req.query.tenantId === 'string' ? req.query.tenantId : undefined);
    const employeeId = req.authUser?.employeeId || (typeof req.query.employeeId === 'string' ? req.query.employeeId : undefined);
  
    if (hasDatabaseConfig() && (!tenantId || !employeeId)) {
      return res.status(401).json({
        success: false,
        error: 'tenantId and employeeId are required when DATABASE_URL is configured',
      });
    }
  
    try {
      if (!hasDatabaseConfig()) {
        if (!isDemoEnvironment()) {
          return res.status(503).json({
            success: false,
            error: 'Attendance service is temporarily unavailable. Please try again.',
          });
        }
        const openLog = demoOpenTimeLogs.get(getAttendanceKey(tenantId, employeeId));
        return res.json({
          success: true,
          isClockedIn: Boolean(openLog && !openLog.clockOutTime),
          timeLogId: openLog?.id || null,
          clockedIn: openLog?.clockInTime?.toISOString() || null,
        });
      }
  
      const openLog = await withTenant(tenantId, async (client) => {
        const result = await client.query<{
          id: string;
          clock_in_time: Date;
        }>(
          `
            SELECT id, clock_in_time
            FROM time_logs
            WHERE tenant_id = $1
              AND employee_id = $2
              AND clock_out_time IS NULL
            ORDER BY clock_in_time DESC
            LIMIT 1
          `,
          [tenantId, employeeId],
        );
  
        return result.rows[0] || null;
      });
  
      res.json({
        success: true,
        isClockedIn: Boolean(openLog),
        timeLogId: openLog?.id || null,
        clockedIn: openLog?.clock_in_time || null,
      });
    } catch (error) {
      console.error('[Clock-Status] Failed to load active shift:', error);
      res.status(503).json({ success: false, error: 'Attendance service is temporarily unavailable. Please try again.' });
    }
  });
  
  app.post('/api/clock-out', demoAuthWhenDatabaseConfigured, async (req, res) => {
    const body = req.body as { tenantId?: string; employeeId?: string };
    const tenantId = req.authUser?.tenantId || body.tenantId;
    const employeeId = req.authUser?.employeeId || body.employeeId;
  
    if (hasDatabaseConfig() && (!tenantId || !employeeId)) {
      return res.status(401).json({
        success: false,
        error: 'tenantId and employeeId are required when DATABASE_URL is configured',
      });
    }
  
    try {
      const clockOutTime = new Date();
  
      if (!hasDatabaseConfig()) {
        if (!isDemoEnvironment()) {
          return res.status(503).json({
            success: false,
            error: 'Attendance service is temporarily unavailable. Please try again.',
          });
        }
        const demoClockOut = recordDemoClockOut(tenantId, employeeId);
        return res.status(demoClockOut.status).json(demoClockOut.body);
      }
  
      const updatedLog = await withTenant(tenantId, async (client) => {
        const result = await client.query<{
          id: string;
          clock_in_time: Date;
          clock_out_time: Date;
        }>(
          `
            UPDATE time_logs
            SET
              clock_out_time = $3,
              updated_at = NOW()
            WHERE tenant_id = $1
              AND employee_id = $2
              AND clock_out_time IS NULL
            RETURNING id, clock_in_time, clock_out_time
          `,
          [tenantId, employeeId, clockOutTime],
        );
  
        return result.rows[0];
      });
  
      if (!updatedLog) {
        return res.status(404).json({
          success: false,
          error: 'No open shift found for this employee',
        });
      }
  
      const workDate = toWorkDate(new Date(updatedLog.clock_in_time));
  
      await Promise.all([
        enqueueBestEffort(
          'attendance rollup',
          () => enqueueAttendanceRollup({ tenantId, employeeId, workDate }),
        ),
        enqueueBestEffort(
          'clock-out audit log',
          () => enqueueAuditLog({
            tenantId,
            actorEmployeeId: employeeId,
            action: 'clock_out',
            entityType: 'time_log',
            entityId: updatedLog.id,
            metadata: {
              clockInTime: updatedLog.clock_in_time,
              clockOutTime: updatedLog.clock_out_time,
              workDate,
            },
          }),
        ),
      ]);
  
      res.json({
        success: true,
        timeLogId: updatedLog.id,
        clockedOut: updatedLog.clock_out_time,
        message: 'Clock-out recorded successfully.',
      });
    } catch (error) {
      console.error('[Clock-Out] Failed to record clock-out:', error);
  
      res.status(503).json({
        success: false,
        error: 'Attendance service is temporarily unavailable. Please try again.',
      });
    }
  });
}
