import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import {
  enqueueAttendanceRollup,
  enqueueAuditLog,
  hasDatabaseConfig,
  withTenant,
} from './src/lib/hr-background';

type ClockInBody = {
  tenantId?: string;
  employeeId?: string;
  latitude?: number;
  longitude?: number;
};

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

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // === HORIZON HR API ROUTES ===

  // Registration Route for multi-tenant wizard
  app.post('/api/auth/register-tenant', async (req, res) => {
    // In production:
    // 1. BEGIN TRANSACTION
    // 2. INSERT INTO tenants (company_name, slug, default_currency, capacity_tier, allows_company_loans) 
    //      VALUES (req.body.companyName, req.body.tenantSlug, ...) RETURNING id;
    // 3. INSERT INTO employees (tenant_id, email, password_hash, role)
    //      VALUES (tenant.id, req.body.adminEmail, hash(req.body.adminPassword), 'hr_admin');
    // 4. INSERT INTO geofences (tenant_id, name, boundary)
    //      VALUES (tenant.id, 'HQ', ST_Buffer(ST_MakePoint(req.body.lng, req.body.lat)::geography, req.body.radius)::geometry);
    // 5. COMMIT
    
    await new Promise(resolve => setTimeout(resolve, 1500)); // Simulate work

    // For demo: pretend it worked always, unless slug is exactly 'taken'
    if (req.body.tenantSlug === 'taken') {
      res.status(400).json({ success: false, error: 'Tenant slug is already taken.' });
    } else {
      res.json({ success: true, message: 'Tenant sandbox initialized successfully.' });
    }
  });

  // 1. Auth Endpoint (Simulates secure iron-session check)
  app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    
    // Simulate database lookup latency for biometric UI experience
    await new Promise(resolve => setTimeout(resolve, 800));

    if (email === 'admin@horizon.com' && password === 'admin') {
      res.json({
        success: true,
        user: { 
          id: 'u-1', 
          name: 'Sarah Connor', 
          role: 'HR Admin', 
          tenant: 'Cyberdyne Systems'
        }
      });
    } else {
      res.status(401).json({
        success: false,
        error: 'Invalid biometric pattern or credentials'
      });
    }
  });

  // 2. Geofenced Clock-In Simulator
  // In production, this would execute PostGIS: 
  // ST_DWithin(employee_location, geofence.boundary, radius)
  app.post('/api/clock-in', async (req, res) => {
    const { tenantId, employeeId, latitude, longitude } = req.body as ClockInBody;
    
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return res.status(400).json({ error: 'Geolocation required for clock-in' });
    }

    // Mock HQ Location: 37.7749, -122.4194 (San Francisco)
    // Accept anything within a loose bounding box for the demo
    const hqLat = 37.7749;
    const hqLng = -122.4194;
    
    // Math.abs diff logic purely to mock PostGIS in this runtime
    const isWithinGeofence = Math.abs(latitude - hqLat) < 0.5 && Math.abs(longitude - hqLng) < 0.5;
    const clockedIn = new Date();

    if (hasDatabaseConfig()) {
      if (!tenantId || !employeeId) {
        return res.status(400).json({
          error: 'tenantId and employeeId are required when DATABASE_URL is configured',
        });
      }

      try {
        const timeLog = await withTenant(tenantId, async (client) => {
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
                workDate,
              },
            }),
          ),
        ]);

        return res.json({
          success: true,
          timeLogId: timeLog.id,
          clockedIn: timeLog.clock_in_time,
          locationValid: isWithinGeofence,
          message: isWithinGeofence ? 'Clock-in secured.' : 'Warning: Clock-in recorded outside geofenced perimeter.',
        });
      } catch (error) {
        console.error('[Clock-In] Failed to persist clock-in:', error);
        return res.status(500).json({ error: 'Unable to record clock-in' });
      }
    }

    res.json({
      success: true,
      clockedIn: clockedIn.toISOString(),
      locationValid: isWithinGeofence,
      message: isWithinGeofence ? 'Clock-in secured.' : 'Warning: Clock-in recorded outside geofenced perimeter.'
    });
  });

  app.post('/api/leave-requests', async (req, res) => {
    const { tenantId, employeeId, startDate, endDate, reason } = req.body;

    if (!tenantId || !employeeId || !startDate || !endDate || !reason) {
      return res.status(400).json({
        error: 'tenantId, employeeId, startDate, endDate, and reason are required',
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
          [tenantId, employeeId, startDate, endDate, reason],
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
          metadata: { startDate, endDate, reason },
        }),
      );

      res.status(201).json({ success: true, leaveRequestId: leaveRequest.id });
    } catch (error) {
      console.error('[Leave] Failed to create leave request:', error);
      res.status(500).json({ error: 'Unable to create leave request' });
    }
  });

  app.patch('/api/leave-requests/:id/status', async (req, res) => {
    const { id } = req.params;
    const { tenantId, actorEmployeeId, status } = req.body;

    if (!tenantId || !actorEmployeeId || !status) {
      return res.status(400).json({
        error: 'tenantId, actorEmployeeId, and status are required',
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
        const result = await client.query<{ id: string; employee_id: string; status: string }>(
          `
            UPDATE leave_requests
            SET
              status = $3,
              approved_by = CASE WHEN $3 = 'approved' THEN $2 ELSE approved_by END,
              updated_at = NOW()
            WHERE tenant_id = $1
              AND id = $4
            RETURNING id, employee_id, status
          `,
          [tenantId, actorEmployeeId, status, id],
        );

        return result.rows[0];
      });

      if (!leaveRequest) {
        return res.status(404).json({ error: 'Leave request not found' });
      }

      await enqueueBestEffort(
        'leave status audit log',
        () => enqueueAuditLog({
          tenantId,
          actorEmployeeId,
          action: 'leave_status_changed',
          entityType: 'leave_request',
          entityId: leaveRequest.id,
          metadata: {
            employeeId: leaveRequest.employee_id,
            status: leaveRequest.status,
          },
        }),
      );

      res.json({ success: true, leaveRequest });
    } catch (error) {
      console.error('[Leave] Failed to update leave request status:', error);
      res.status(500).json({ error: 'Unable to update leave request status' });
    }
  });

  // === VITE DEV/PRODUCTION MIDDLEWARE ===
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Horizon HR Network] Edge Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
