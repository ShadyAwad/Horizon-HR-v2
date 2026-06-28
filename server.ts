import 'dotenv/config';
import express from 'express';
import path from 'path';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';
import type { PoolClient } from 'pg';
import {
  enqueueAttendanceRollup,
  enqueueAuditLog,
  getDbPool,
  getHrQueue,
  HR_QUEUE_NAME,
  hasDatabaseConfig,
  withTenant,
} from './src/lib/hr-background';


type ClockInBody = {  
  tenantId?: string;
  employeeId?: string;
  latitude?: number;
  longitude?: number;
};

type EmployeeRole = 'hr_admin' | 'manager' | 'employee';

type AuthenticatedUser = {
  employeeId: string;
  tenantId: string;
  email: string;
  role: EmployeeRole;
};

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthenticatedUser;
    }
  }
}

function generateResetCode() {
  return crypto.randomInt(100000, 999999).toString();
}

function hashResetCode(code: string) {
  return crypto
    .createHash('sha256')
    .update(code)
    .digest('hex');
}

function isTileCoordinate(value: string | undefined) {
  return typeof value === 'string' && /^\d+$/.test(value);
}

function getMapTilerMapId() {
  return process.env.MAPTILER_MAP_ID || 'streets-v4';
}

function generatePasswordHash(password: string) {
  const salt = crypto.randomBytes(16).toString('hex');

  const hash = crypto
    .scryptSync(password, salt, 64)
    .toString('hex');

  return `scrypt:${salt}:${hash}`;
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

async function demoAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const employeeId = req.header('x-employee-id');
  const tenantId = req.header('x-tenant-id');

  if (!employeeId || !tenantId) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required.',
    });
  }

  if (!hasDatabaseConfig()) {
    return res.status(503).json({
      success: false,
      error: 'DATABASE_URL is required for authenticated routes.',
    });
  }

  try {
    const result = await getDbPool().query<AuthenticatedUser>(
      `
        SELECT
          id AS "employeeId",
          tenant_id AS "tenantId",
          email,
          role
        FROM employees
        WHERE id = $1
          AND tenant_id = $2
        LIMIT 1
      `,
      [employeeId, tenantId],
    );

    if (result.rowCount === 0) {
      return res.status(401).json({
        success: false,
        error: 'Invalid authentication context.',
      });
    }

    const user = result.rows[0];

    if (!['hr_admin', 'manager', 'employee'].includes(user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Invalid employee role.',
      });
    }

    req.authUser = user;
    next();
  } catch (error) {
    console.error('[Auth] Failed to resolve authenticated user:', error);

    res.status(500).json({
      success: false,
      error: 'Unable to authenticate request.',
    });
  }
}

function requireRole(allowedRoles: EmployeeRole[]) {
  return (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    if (!req.authUser) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required.',
      });
    }

    if (!allowedRoles.includes(req.authUser.role)) {
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to perform this action.',
      });
    }

    next();
  };
}
// yet another helper function to verify password against stored hash
function verifyPassword(password: string, storedHash: string | null) {
  if (!storedHash) return false;

  const [algorithm, salt, originalHash] = storedHash.split(':');

  if (algorithm !== 'scrypt' || !salt || !originalHash) {
    return false;
  }

  const testHash = crypto
    .scryptSync(password, salt, 64)
    .toString('hex');

  const testBuffer = Buffer.from(testHash, 'hex');
  const originalBuffer = Buffer.from(originalHash, 'hex');

  if (testBuffer.length !== originalBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(testBuffer, originalBuffer);
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // === HORIZON HR API ROUTES ===

  app.get('/api/map-tiles/:z/:x/:y.png', async (req, res) => {
    const { z, x, y } = req.params;
    const maptilerKey = process.env.MAPTILER_KEY;

    if (!maptilerKey) {
      return res.status(503).json({
        success: false,
        error: 'Map tile provider is not configured.',
      });
    }

    if (!isTileCoordinate(z) || !isTileCoordinate(x) || !isTileCoordinate(y)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid tile coordinates.',
      });
    }

    const tileUrl = new URL(
      `https://api.maptiler.com/maps/${getMapTilerMapId()}/256/${z}/${x}/${y}.png`,
    );

    tileUrl.searchParams.set('key', maptilerKey);

    try {
      const upstreamResponse = await fetch(tileUrl);

      if (!upstreamResponse.ok || !upstreamResponse.body) {
        return res.status(upstreamResponse.status || 502).json({
          success: false,
          error: 'Unable to load map tile.',
        });
      }

      res.setHeader(
        'Cache-Control',
        'public, max-age=86400, stale-while-revalidate=604800',
      );
      res.setHeader(
        'Content-Type',
        upstreamResponse.headers.get('content-type') || 'image/png',
      );

      const tileBuffer = Buffer.from(await upstreamResponse.arrayBuffer());
      res.send(tileBuffer);
    } catch (error) {
      console.error('[Map Tiles] Failed to proxy tile:', error);

      res.status(502).json({
        success: false,
        error: 'Unable to load map tile.',
      });
    }
  });

  // Registration Route for multi-tenant wizard
  app.post('/api/auth/register-tenant', async (req, res) => {
    const allowedAdminRoles: EmployeeRole[] = ['employee', 'manager', 'hr_admin'];

    const {
      companyName,
      tenantSlug,
      adminFullName,
      adminEmail,
      adminPassword,
      adminRole,
      currency,
      capacity,
      allowsLoans,
      lat,
      lng,
      radius,
    } = req.body as {
      companyName?: string;
      tenantSlug?: string;
      adminFullName?: string;
      adminEmail?: string;
      adminPassword?: string;
      adminRole?: string;
      currency?: string;
      capacity?: string;
      allowsLoans?: boolean;
      lat?: number | string;
      lng?: number | string;
      radius?: number | string;
    };

    const normalizedCompanyName = companyName?.trim() || '';
    const normalizedTenantSlug = tenantSlug?.trim().toLowerCase() || '';
    const normalizedAdminFullName = adminFullName?.trim() || '';
    const normalizedAdminEmail = adminEmail?.trim().toLowerCase() || '';
    const normalizedCurrency = currency?.trim() || '';
    const normalizedCapacity = capacity?.trim() || '';
    const normalizedAdminRole = allowedAdminRoles.includes(adminRole as EmployeeRole)
      ? adminRole as EmployeeRole
      : 'hr_admin';
    const latitude = Number(lat);
    const longitude = Number(lng);
    const geofenceRadius = Number(radius);

    if (
      !normalizedCompanyName ||
      !normalizedTenantSlug ||
      !normalizedAdminFullName ||
      !normalizedAdminEmail ||
      !adminPassword ||
      !normalizedCurrency ||
      !normalizedCapacity
    ) {
      return res.status(400).json({
        success: false,
        error: 'companyName, tenantSlug, adminFullName, adminEmail, adminPassword, currency, and capacity are required.',
      });
    }

    if (adminPassword.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'adminPassword must be at least 8 characters.',
      });
    }

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(geofenceRadius)) {
      return res.status(400).json({
        success: false,
        error: 'lat, lng, and radius must be valid numbers.',
      });
    }

    if (!hasDatabaseConfig()) {
      return res.status(503).json({
        success: false,
        error: 'DATABASE_URL is required for tenant registration.',
      });
    }

    let client: PoolClient | undefined;

    try {
      client = await getDbPool().connect();
      await client.query('BEGIN');

      const tenantResult = await client.query<{
        id: string;
        company_name: string;
        slug: string;
      }>(
        `
          INSERT INTO tenants (
            company_name,
            slug,
            default_currency,
            capacity_tier,
            allows_company_loans
          )
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id, company_name, slug
        `,
        [
          normalizedCompanyName,
          normalizedTenantSlug,
          normalizedCurrency,
          normalizedCapacity,
          Boolean(allowsLoans),
        ],
      );

      const tenant = tenantResult.rows[0];

      await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenant.id]);

      const passwordHash = generatePasswordHash(adminPassword);

      const employeeResult = await client.query<{
        id: string;
        email: string;
        full_name: string;
        role: EmployeeRole;
        tenant_id: string;
      }>(
        `
          INSERT INTO employees (
            tenant_id,
            full_name,
            email,
            password_hash,
            role
          )
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id, email, full_name, role, tenant_id
        `,
        [
          tenant.id,
          normalizedAdminFullName,
          normalizedAdminEmail,
          passwordHash,
          normalizedAdminRole,
        ],
      );

      const employee = employeeResult.rows[0];

      await client.query(
        `
          INSERT INTO geofences (
            tenant_id,
            name,
            boundary
          )
          VALUES (
            $1,
            $2,
            ST_Buffer(
              ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography,
              $5
            )::geometry
          )
        `,
        [tenant.id, 'HQ', longitude, latitude, geofenceRadius],
      );

      await client.query(
        `
          INSERT INTO audit_logs (
            tenant_id,
            actor_employee_id,
            action,
            entity_type,
            entity_id,
            metadata
          )
          VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        `,
        [
          tenant.id,
          employee.id,
          'tenant_registered',
          'tenant',
          tenant.id,
          JSON.stringify({
            tenantSlug: tenant.slug,
            companyName: tenant.company_name,
            adminEmail: employee.email,
            adminRole: employee.role,
            geofence: {
              lat: latitude,
              lng: longitude,
              radius: geofenceRadius,
            },
          }),
        ],
      );

      await client.query('COMMIT');

      const responseTenant = {
        id: tenant.id,
        slug: tenant.slug,
        companyName: tenant.company_name,
      };

      res.status(201).json({
        success: true,
        message: 'Tenant registered successfully.',
        tenant: responseTenant,
        user: {
          id: employee.id,
          email: employee.email,
          name: employee.full_name,
          role: employee.role,
          tenantId: employee.tenant_id,
          tenant: responseTenant,
        },
      });
    } catch (error) {
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          console.error('[Register Tenant] Rollback failed:', rollbackError);
        }
      }

      console.error('[Register Tenant] Failed:', error);

      if ((error as { code?: string }).code === '23505') {
        return res.status(409).json({
          success: false,
          error: 'The tenant slug or admin email is already in use.',
        });
      }

      res.status(500).json({
        success: false,
        error: 'Unable to register tenant.',
      });
    } finally {
      client?.release();
    }
  });




  // 1. Auth Endpoint (Simulates secure iron-session check)


app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body as {
    email?: string;
    password?: string;
  };

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      error: 'Email and password are required.',
    });
  }

  // Simulate database lookup latency for biometric UI experience
  await new Promise(resolve => setTimeout(resolve, 800));

  if (!hasDatabaseConfig()) {
    return res.status(503).json({
      success: false,
      error: 'DATABASE_URL is required for database-backed login.',
    });
  }

  try {
    const normalizedEmail = email.toLowerCase().trim();

    const result = await getDbPool().query<{
      id: string;
      tenant_id: string;
      email: string;
      full_name: string;
      role: string;
      password_hash: string | null;
      company_name: string;
    }>(
      `
        SELECT
          employees.id,
          employees.tenant_id,
          employees.email,
          employees.full_name,
          employees.role,
          employees.password_hash,
          tenants.company_name
        FROM employees
        INNER JOIN tenants
          ON tenants.id = employees.tenant_id
        WHERE LOWER(employees.email) = $1
        LIMIT 1
      `,
      [normalizedEmail],
    );

    if (result.rowCount === 0) {
      return res.status(401).json({
        success: false,
        error: 'Invalid biometric pattern or credentials',
      });
    }

    const employee = result.rows[0];
    const passwordValid = verifyPassword(password, employee.password_hash);

    if (!passwordValid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid biometric pattern or credentials',
      });
    }

    res.json({
      success: true,
      user: {
        id: employee.id,
        email: employee.email,
        name: employee.full_name,
        role: employee.role,
        tenantId: employee.tenant_id,
        tenant: employee.company_name,
      },
    });
  } catch (error) {
    console.error('[Login] Failed:', error);

    res.status(500).json({
      success: false,
      error: 'Unable to authenticate user.',
    });
  }
});

app.post('/api/auth/request-password-reset', async (req, res) => {
  const { email, method } = req.body as {
    email?: string;
    method?: 'email' | 'admin' | 'security';
  };

  if (!email) {
    return res.status(400).json({
      success: false,
      error: 'Email is required for password recovery.',
    });
  }

  if (!hasDatabaseConfig()) {
    return res.status(503).json({
      success: false,
      error: 'DATABASE_URL is required for password recovery.',
    });
  }

  try {
    const normalizedEmail = email.toLowerCase().trim();
    const resetCode = generateResetCode();
    const tokenHash = hashResetCode(resetCode);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const result = await getDbPool().query<{
      tenant_id: string;
      employee_id: string;
    }>(
      `
        SELECT
          tenant_id,
          id AS employee_id
        FROM employees
        WHERE LOWER(email) = $1
        LIMIT 1
      `,
      [normalizedEmail],
    );

    /*
      Important security behavior:
      We return success even if the email does not exist.
      This prevents account enumeration.
    */
    if (result.rowCount === 0) {
      return res.json({
        success: true,
        message: 'If the account exists, recovery instructions have been generated.',
      });
    }

    const employee = result.rows[0];

    await getDbPool().query(
      `
        INSERT INTO password_reset_tokens (
          tenant_id,
          employee_id,
          email,
          recovery_method,
          token_hash,
          dev_reset_code,
          expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        employee.tenant_id,
        employee.employee_id,
        normalizedEmail,
        method || 'email',
        tokenHash,
        resetCode,
        expiresAt,
      ],
    );

    console.log('[Password Reset] Dev reset code:', {
      email: normalizedEmail,
      resetCode,
      expiresAt,
    });

    res.json({
      success: true,
      message: 'Recovery instructions generated. Dev reset code printed in server logs.',
      devResetCode: resetCode,
    });
  } catch (error) {
    console.error('[Password Reset] Failed to create reset token:', error);

    res.status(500).json({
      success: false,
      error: 'Unable to start recovery flow.',
    });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { email, resetCode, newPassword } = req.body as {
    email?: string;
    resetCode?: string;
    newPassword?: string;
  };

  if (!email || !resetCode || !newPassword) {
    return res.status(400).json({
      success: false,
      error: 'Email, reset code, and new password are required.',
    });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({
      success: false,
      error: 'Password must be at least 8 characters long.',
    });
  }

  if (!hasDatabaseConfig()) {
    return res.status(503).json({
      success: false,
      error: 'DATABASE_URL is required for password reset.',
    });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const resetCodeHash = hashResetCode(resetCode.trim());
  const newPasswordHash = generatePasswordHash(newPassword);

  const pool = getDbPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const tokenResult = await client.query<{
      id: string;
      tenant_id: string;
      employee_id: string;
    }>(
      `
        SELECT
          id,
          tenant_id,
          employee_id
        FROM password_reset_tokens
        WHERE LOWER(email) = $1
          AND token_hash = $2
          AND used_at IS NULL
          AND expires_at > NOW()
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE
      `,
      [normalizedEmail, resetCodeHash],
    );

    if (tokenResult.rowCount === 0) {
      await client.query('ROLLBACK');

      return res.status(400).json({
        success: false,
        error: 'Invalid or expired reset code.',
      });
    }

    const token = tokenResult.rows[0];

    await client.query(
      `
        UPDATE employees
        SET
          password_hash = $1,
          updated_at = NOW()
        WHERE id = $2
          AND tenant_id = $3
      `,
      [newPasswordHash, token.employee_id, token.tenant_id],
    );

    await client.query(
      `
        UPDATE password_reset_tokens
        SET used_at = NOW()
        WHERE id = $1
      `,
      [token.id],
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Password reset successfully. You can now sign in with the new password.',
    });
  } catch (error) {
    await client.query('ROLLBACK');

    console.error('[Password Reset] Failed to reset password:', error);

    res.status(500).json({
      success: false,
      error: 'Unable to reset password.',
    });
  } finally {
    client.release();
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

  app.post('/api/clock-out', async (req, res) => {
  const { tenantId, employeeId } = req.body;

  if (!tenantId || !employeeId) {
    return res.status(400).json({
      error: 'tenantId and employeeId are required',
    });
  }

  if (!hasDatabaseConfig()) {
    return res.status(503).json({
      error: 'DATABASE_URL is required for clock-out',
    });
  }

  try {
    const clockOutTime = new Date();

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

    res.status(500).json({
      error: 'Unable to record clock-out',
    });
  }
});

app.post(
  '/api/leave-requests',
  demoAuth,
  requireRole(['hr_admin', 'manager', 'employee']),
  async (req, res) => {
    const { startDate, endDate, reason } = req.body;

    const tenantId = req.authUser!.tenantId;
    const employeeId = req.authUser!.employeeId;

    if (!startDate || !endDate || !reason) {
      return res.status(400).json({
        error: 'startDate, endDate, and reason are required',
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
        const result = await client.query<{ id: string; employee_id: string; status: string }>(
`
  UPDATE leave_requests
  SET
    status = $3::varchar,
    approved_by = CASE 
      WHEN $3::varchar = 'approved' THEN $2
      ELSE approved_by
    END,
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

  app.get('/api/system/health', async (req, res) => {
  try {
    const queue = getHrQueue();

    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);

    res.json({
      success: true,
      queue: {
        name: HR_QUEUE_NAME,
        waiting,
        active,
        completed,
        failed,
        delayed,
      },
      database: {
        configured: hasDatabaseConfig(),
      },
    });
  } catch (error) {
    console.error('[System Health] Failed:', error);

    res.status(500).json({
      success: false,
      error: 'Unable to read system health',
    });
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
