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

type PayrollRunBody = {
  payPeriodStart?: string;
  payPeriodEnd?: string;
  defaultBaseSalary?: number;
  bonuses?: number;
  deductions?: number;
};

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

type EmployeeRole = 'hr_admin' | 'manager' | 'employee';

type AuthenticatedUser = {
  employeeId: string;
  tenantId: string;
  email: string;
  role: EmployeeRole;
};

type DemoTimeLog = {
  id: string;
  tenantId: string;
  employeeId: string;
  clockInTime: Date;
  clockOutTime?: Date;
};

const demoOpenTimeLogs = new Map<string, DemoTimeLog>();

const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_LOCK_MS = 5 * 60 * 1000;

type LoginAttemptState = {
  failedAttempts: number;
  firstFailedAt: number;
  lockedUntil?: number;
};

// In-memory limiter is fine for this single-process app. Use Redis later for multi-instance deployments.
const loginAttemptStore = new Map<string, LoginAttemptState>();

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

function getRequestIp(req: express.Request) {
  const forwardedFor = req.header('x-forwarded-for');
  const forwardedIp = forwardedFor?.split(',')[0]?.trim();
  return forwardedIp || req.ip || req.socket.remoteAddress || 'unknown';
}

function getLoginRateLimitKey(req: express.Request, normalizedEmail: string) {
  return `${normalizedEmail}:${getRequestIp(req)}`;
}

function checkLoginRateLimit(key: string) {
  const now = Date.now();
  const attemptState = loginAttemptStore.get(key);

  if (!attemptState) {
    return { locked: false as const };
  }

  if (attemptState.lockedUntil && attemptState.lockedUntil > now) {
    return {
      locked: true as const,
      retryAfterSeconds: Math.ceil((attemptState.lockedUntil - now) / 1000),
    };
  }

  if (attemptState.lockedUntil || now - attemptState.firstFailedAt > LOGIN_WINDOW_MS) {
    loginAttemptStore.delete(key);
  }

  return { locked: false as const };
}

function recordFailedLogin(key: string) {
  const now = Date.now();
  const attemptState = loginAttemptStore.get(key);

  if (!attemptState || now - attemptState.firstFailedAt > LOGIN_WINDOW_MS) {
    loginAttemptStore.set(key, {
      failedAttempts: 1,
      firstFailedAt: now,
    });
    return;
  }

  const failedAttempts = attemptState.failedAttempts + 1;
  loginAttemptStore.set(key, {
    failedAttempts,
    firstFailedAt: attemptState.firstFailedAt,
    lockedUntil: failedAttempts >= MAX_LOGIN_ATTEMPTS ? now + LOGIN_LOCK_MS : attemptState.lockedUntil,
  });
}

function clearFailedLogins(key: string) {
  loginAttemptStore.delete(key);
}

function getAllowedCorsOrigins() {
  return new Set(
    [
      process.env.APP_URL,
      process.env.FRONTEND_URL,
      'http://localhost:4173',
      'http://127.0.0.1:4173',
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ].filter(Boolean),
  );
}

function getAttendanceKey(tenantId?: string, employeeId?: string) {
  return `${tenantId || 'demo-tenant'}:${employeeId || 'demo-employee'}`;
}

function recordDemoClockIn(
  tenantId: string | undefined,
  employeeId: string | undefined,
  clockedIn: Date,
) {
  const attendanceKey = getAttendanceKey(tenantId, employeeId);
  const existingOpenLog = demoOpenTimeLogs.get(attendanceKey);

  if (existingOpenLog && !existingOpenLog.clockOutTime) {
    return {
      ok: false as const,
      status: 409,
      body: {
        success: false,
        timeLogId: existingOpenLog.id,
        clockedIn: existingOpenLog.clockInTime.toISOString(),
        error: 'This employee already has an open shift.',
      },
    };
  }

  const demoTimeLog: DemoTimeLog = {
    id: crypto.randomUUID(),
    tenantId: tenantId || 'demo-tenant',
    employeeId: employeeId || 'demo-employee',
    clockInTime: clockedIn,
  };

  demoOpenTimeLogs.set(attendanceKey, demoTimeLog);

  return {
    ok: true as const,
    status: 200,
    body: demoTimeLog,
  };
}

function recordDemoClockOut(tenantId: string | undefined, employeeId: string | undefined) {
  const clockOutTime = new Date();
  const attendanceKey = getAttendanceKey(tenantId, employeeId);
  const openLog = demoOpenTimeLogs.get(attendanceKey);

  if (!openLog || openLog.clockOutTime) {
    return {
      ok: false as const,
      status: 404,
      body: {
        success: false,
        error: 'No open shift found for this employee',
      },
    };
  }

  openLog.clockOutTime = clockOutTime;
  demoOpenTimeLogs.delete(attendanceKey);

  return {
    ok: true as const,
    status: 200,
    body: {
      success: true,
      timeLogId: openLog.id,
      clockedIn: openLog.clockInTime.toISOString(),
      clockedOut: clockOutTime.toISOString(),
      message: 'Clock-out recorded successfully.',
    },
  };
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

function isValidDateInput(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isNonNegativeAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

const grievancePriorities: GrievancePriority[] = ['low', 'normal', 'high', 'urgent'];
const grievanceStatuses: GrievanceStatus[] = ['open', 'under_review', 'resolved', 'rejected', 'closed'];

function isGrievancePriority(value: unknown): value is GrievancePriority {
  return typeof value === 'string' && grievancePriorities.includes(value as GrievancePriority);
}

function isGrievanceStatus(value: unknown): value is GrievanceStatus {
  return typeof value === 'string' && grievanceStatuses.includes(value as GrievanceStatus);
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
  app.use((req, res, next) => {
    const origin = req.header('origin');
    const allowedOrigins = getAllowedCorsOrigins();

    if (origin && allowedOrigins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-employee-id, x-tenant-id');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
    }

    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }

    next();
  });

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

  const normalizedEmail = email.toLowerCase().trim();
  const loginRateLimitKey = getLoginRateLimitKey(req, normalizedEmail);
  const rateLimit = checkLoginRateLimit(loginRateLimitKey);

  if (rateLimit.locked) {
    return res.status(429).json({
      success: false,
      error: `Too many failed login attempts. Try again in ${rateLimit.retryAfterSeconds} seconds.`,
      retryAfterSeconds: rateLimit.retryAfterSeconds,
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
      recordFailedLogin(loginRateLimitKey);

      return res.status(401).json({
        success: false,
        error: 'Invalid biometric pattern or credentials',
      });
    }

    const employee = result.rows[0];
    const passwordValid = verifyPassword(password, employee.password_hash);

    if (!passwordValid) {
      recordFailedLogin(loginRateLimitKey);

      return res.status(401).json({
        success: false,
        error: 'Invalid biometric pattern or credentials',
      });
    }

    clearFailedLogins(loginRateLimitKey);

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

        if ((error as { code?: string }).code === '23505') {
          return res.status(409).json({
            error: 'This employee already has an open shift.',
          });
        }

        console.warn('[Clock-In] Falling back to demo attendance store.');
      }
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
      message: isWithinGeofence ? 'Clock-in secured.' : 'Warning: Clock-in recorded outside geofenced perimeter.'
    });
  });

  app.post('/api/clock-out', async (req, res) => {
  const { tenantId, employeeId } = req.body;

  if (hasDatabaseConfig() && (!tenantId || !employeeId)) {
    return res.status(400).json({
      error: 'tenantId and employeeId are required when DATABASE_URL is configured',
    });
  }

  try {
    const clockOutTime = new Date();

    if (!hasDatabaseConfig()) {
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

    console.warn('[Clock-Out] Falling back to demo attendance store.');
    const demoClockOut = recordDemoClockOut(tenantId, employeeId);
    res.status(demoClockOut.status).json(demoClockOut.body);
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

app.get(
  '/api/payroll/me',
  demoAuth,
  requireRole(['employee', 'manager', 'hr_admin']),
  async (req, res) => {
    const tenantId = req.authUser!.tenantId;
    const employeeId = req.authUser!.employeeId;

    if (!hasDatabaseConfig()) {
      return res.status(503).json({ error: 'DATABASE_URL is required for payroll records' });
    }

    try {
      const payroll = await withTenant(tenantId, async (client) => {
        const result = await client.query(
          `
            SELECT
              id,
              employee_id,
              pay_period_start,
              pay_period_end,
              base_salary,
              bonuses,
              deductions,
              net_pay,
              currency,
              status,
              generated_at,
              paid_at
            FROM payroll_records
            WHERE tenant_id = $1
              AND employee_id = $2
            ORDER BY pay_period_end DESC, pay_period_start DESC, generated_at DESC
            LIMIT 12
          `,
          [tenantId, employeeId],
        );

        return result.rows;
      });

      res.json({ success: true, payroll });
    } catch (error) {
      console.error('[Payroll] Failed to load employee payroll:', error);
      res.status(500).json({ error: 'Unable to load payroll records' });
    }
  },
);

app.get(
  '/api/payroll',
  demoAuth,
  requireRole(['hr_admin']),
  async (req, res) => {
    const tenantId = req.authUser!.tenantId;

    if (!hasDatabaseConfig()) {
      return res.status(503).json({ error: 'DATABASE_URL is required for payroll records' });
    }

    try {
      const payroll = await withTenant(tenantId, async (client) => {
        const result = await client.query(
          `
            SELECT
              payroll_records.id,
              payroll_records.employee_id,
              employees.full_name,
              employees.email,
              payroll_records.pay_period_start,
              payroll_records.pay_period_end,
              payroll_records.base_salary,
              payroll_records.bonuses,
              payroll_records.deductions,
              payroll_records.net_pay,
              payroll_records.currency,
              payroll_records.status,
              payroll_records.generated_at,
              payroll_records.paid_at
            FROM payroll_records
            INNER JOIN employees
              ON employees.id = payroll_records.employee_id
             AND employees.tenant_id = payroll_records.tenant_id
            WHERE payroll_records.tenant_id = $1
            ORDER BY payroll_records.generated_at DESC, payroll_records.pay_period_end DESC
            LIMIT 100
          `,
          [tenantId],
        );

        return result.rows;
      });

      res.json({ success: true, payroll });
    } catch (error) {
      console.error('[Payroll] Failed to load tenant payroll:', error);
      res.status(500).json({ error: 'Unable to load payroll records' });
    }
  },
);

app.post(
  '/api/payroll/run',
  demoAuth,
  requireRole(['hr_admin']),
  async (req, res) => {
    const {
      payPeriodStart,
      payPeriodEnd,
      defaultBaseSalary,
      bonuses = 0,
      deductions = 0,
    } = req.body as PayrollRunBody;

    const tenantId = req.authUser!.tenantId;
    const actorEmployeeId = req.authUser!.employeeId;

    if (
      !isValidDateInput(payPeriodStart) ||
      !isValidDateInput(payPeriodEnd) ||
      !isNonNegativeAmount(defaultBaseSalary)
    ) {
      return res.status(400).json({
        error: 'payPeriodStart, payPeriodEnd, and defaultBaseSalary are required.',
      });
    }

    if (!isNonNegativeAmount(bonuses) || !isNonNegativeAmount(deductions)) {
      return res.status(400).json({
        error: 'Payroll amounts cannot be negative.',
      });
    }

    if (payPeriodEnd! < payPeriodStart!) {
      return res.status(400).json({
        error: 'payPeriodEnd must not be before payPeriodStart.',
      });
    }

    if (!hasDatabaseConfig()) {
      return res.status(503).json({ error: 'DATABASE_URL is required to run payroll' });
    }

    try {
      const recordsGenerated = await withTenant(tenantId, async (client) => {
        const tenantResult = await client.query<{ default_currency: string | null }>(
          `
            SELECT default_currency
            FROM tenants
            WHERE id = $1
            LIMIT 1
          `,
          [tenantId],
        );
        const currency = tenantResult.rows[0]?.default_currency || 'USD';
        const netPay = defaultBaseSalary + bonuses - deductions;

        const payrollResult = await client.query(
          `
            INSERT INTO payroll_records (
              tenant_id,
              employee_id,
              pay_period_start,
              pay_period_end,
              base_salary,
              bonuses,
              deductions,
              net_pay,
              currency,
              status,
              generated_by,
              generated_at,
              updated_at
            )
            SELECT
              employees.tenant_id,
              employees.id,
              $2::date,
              $3::date,
              $4::numeric,
              $5::numeric,
              $6::numeric,
              $7::numeric,
              $8::varchar,
              'draft',
              $9::uuid,
              NOW(),
              NOW()
            FROM employees
            WHERE employees.tenant_id = $1
            ON CONFLICT (tenant_id, employee_id, pay_period_start, pay_period_end)
            DO UPDATE SET
              base_salary = EXCLUDED.base_salary,
              bonuses = EXCLUDED.bonuses,
              deductions = EXCLUDED.deductions,
              net_pay = EXCLUDED.net_pay,
              currency = EXCLUDED.currency,
              status = 'draft',
              generated_by = EXCLUDED.generated_by,
              generated_at = NOW(),
              updated_at = NOW()
            RETURNING id
          `,
          [
            tenantId,
            payPeriodStart,
            payPeriodEnd,
            defaultBaseSalary,
            bonuses,
            deductions,
            netPay,
            currency,
            actorEmployeeId,
          ],
        );

        const generatedCount = payrollResult.rowCount || 0;

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
            tenantId,
            actorEmployeeId,
            'payroll_run_generated',
            'payroll',
            actorEmployeeId,
            JSON.stringify({
              payPeriodStart,
              payPeriodEnd,
              defaultBaseSalary,
              bonuses,
              deductions,
              recordsGenerated: generatedCount,
            }),
          ],
        );

        return generatedCount;
      });

      res.json({
        success: true,
        message: 'Payroll run generated successfully.',
        recordsGenerated,
      });
    } catch (error) {
      console.error('[Payroll] Failed to run payroll:', error);
      res.status(500).json({ error: 'Unable to run payroll' });
    }
  },
);

app.post(
  '/api/grievances',
  demoAuth,
  requireRole(['employee', 'manager', 'hr_admin']),
  async (req, res) => {
    const { title, description, category = 'general', priority = 'normal' } = req.body as CreateGrievanceBody;
    const tenantId = req.authUser!.tenantId;
    const employeeId = req.authUser!.employeeId;

    const normalizedTitle = title?.trim() || '';
    const normalizedDescription = description?.trim() || '';
    const normalizedCategory = category?.trim() || 'general';

    if (!normalizedTitle || !normalizedDescription) {
      return res.status(400).json({
        success: false,
        error: 'title and description are required.',
      });
    }

    if (!isGrievancePriority(priority)) {
      return res.status(400).json({
        success: false,
        error: 'priority must be low, normal, high, or urgent.',
      });
    }

    if (!hasDatabaseConfig()) {
      return res.status(503).json({ success: false, error: 'DATABASE_URL is required for grievances' });
    }

    try {
      const grievance = await withTenant(tenantId, async (client) => {
        const result = await client.query(
          `
            INSERT INTO grievances (
              tenant_id,
              employee_id,
              title,
              description,
              category,
              priority,
              status
            )
            VALUES ($1, $2, $3, $4, $5, $6, 'open')
            RETURNING
              id,
              tenant_id,
              employee_id,
              assigned_to,
              title,
              description,
              category,
              priority,
              status,
              created_at,
              updated_at,
              resolved_at
          `,
          [tenantId, employeeId, normalizedTitle, normalizedDescription, normalizedCategory, priority],
        );

        const createdGrievance = result.rows[0];

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
            tenantId,
            employeeId,
            'grievance_created',
            'grievance',
            createdGrievance.id,
            JSON.stringify({
              title: normalizedTitle,
              category: normalizedCategory,
              priority,
            }),
          ],
        );

        return createdGrievance;
      });

      res.status(201).json({
        success: true,
        grievanceId: grievance.id,
        grievance,
      });
    } catch (error) {
      console.error('[Grievances] Failed to create grievance:', error);
      res.status(500).json({ success: false, error: 'Unable to create grievance' });
    }
  },
);

app.get(
  '/api/grievances/me',
  demoAuth,
  requireRole(['employee', 'manager', 'hr_admin']),
  async (req, res) => {
    const tenantId = req.authUser!.tenantId;
    const employeeId = req.authUser!.employeeId;

    if (!hasDatabaseConfig()) {
      return res.status(503).json({ success: false, error: 'DATABASE_URL is required for grievances' });
    }

    try {
      const grievances = await withTenant(tenantId, async (client) => {
        const result = await client.query(
          `
            SELECT
              id,
              employee_id,
              assigned_to,
              title,
              description,
              category,
              priority,
              status,
              created_at,
              updated_at,
              resolved_at
            FROM grievances
            WHERE tenant_id = $1
              AND employee_id = $2
            ORDER BY created_at DESC
            LIMIT 50
          `,
          [tenantId, employeeId],
        );

        return result.rows;
      });

      res.json({ success: true, grievances });
    } catch (error) {
      console.error('[Grievances] Failed to load employee grievances:', error);
      res.status(500).json({ success: false, error: 'Unable to load grievances' });
    }
  },
);

app.get(
  '/api/grievances',
  demoAuth,
  requireRole(['manager', 'hr_admin']),
  async (req, res) => {
    const tenantId = req.authUser!.tenantId;

    if (!hasDatabaseConfig()) {
      return res.status(503).json({ success: false, error: 'DATABASE_URL is required for grievances' });
    }

    try {
      const grievances = await withTenant(tenantId, async (client) => {
        const result = await client.query(
          `
            SELECT
              grievances.id,
              grievances.employee_id,
              submitter.full_name,
              submitter.email,
              grievances.assigned_to,
              assignee.full_name AS assigned_to_name,
              assignee.email AS assigned_to_email,
              grievances.title,
              grievances.description,
              grievances.category,
              grievances.priority,
              grievances.status,
              grievances.created_at,
              grievances.updated_at,
              grievances.resolved_at
            FROM grievances
            INNER JOIN employees submitter
              ON submitter.id = grievances.employee_id
             AND submitter.tenant_id = grievances.tenant_id
            LEFT JOIN employees assignee
              ON assignee.id = grievances.assigned_to
             AND assignee.tenant_id = grievances.tenant_id
            WHERE grievances.tenant_id = $1
            ORDER BY grievances.created_at DESC
            LIMIT 100
          `,
          [tenantId],
        );

        return result.rows;
      });

      res.json({ success: true, grievances });
    } catch (error) {
      console.error('[Grievances] Failed to load tenant grievances:', error);
      res.status(500).json({ success: false, error: 'Unable to load grievances' });
    }
  },
);

app.patch(
  '/api/grievances/:id/status',
  demoAuth,
  requireRole(['manager', 'hr_admin']),
  async (req, res) => {
    const { id } = req.params;
    const { status, assignedTo } = req.body as UpdateGrievanceStatusBody;

    const tenantId = req.authUser!.tenantId;
    const actorEmployeeId = req.authUser!.employeeId;

    if (!isGrievanceStatus(status)) {
      return res.status(400).json({
        success: false,
        error: 'status must be open, under_review, resolved, rejected, or closed.',
      });
    }

    if (!hasDatabaseConfig()) {
      return res.status(503).json({ success: false, error: 'DATABASE_URL is required for grievances' });
    }

    try {
      const grievance = await withTenant(tenantId, async (client) => {
        if (assignedTo !== undefined && assignedTo !== null) {
          const assigneeResult = await client.query(
            `
              SELECT id
              FROM employees
              WHERE tenant_id = $1
                AND id = $2
              LIMIT 1
            `,
            [tenantId, assignedTo],
          );

          if (assigneeResult.rowCount === 0) {
            throw Object.assign(new Error('Assignee not found in tenant.'), { statusCode: 400 });
          }
        }

        const existingResult = await client.query<{ status: GrievanceStatus }>(
          `
            SELECT status
            FROM grievances
            WHERE tenant_id = $1
              AND id = $2
            LIMIT 1
            FOR UPDATE
          `,
          [tenantId, id],
        );

        if (existingResult.rowCount === 0) {
          throw Object.assign(new Error('Grievance not found.'), { statusCode: 404 });
        }

        const previousStatus = existingResult.rows[0].status;
        const shouldResolve = status === 'resolved' || status === 'closed';
        const shouldClearResolution = status === 'open' || status === 'under_review';

        const updateResult = await client.query(
          `
            UPDATE grievances
            SET
              status = $3,
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
            WHERE tenant_id = $1
              AND id = $2
            RETURNING
              id,
              employee_id,
              assigned_to,
              title,
              description,
              category,
              priority,
              status,
              created_at,
              updated_at,
              resolved_at
          `,
          [
            tenantId,
            id,
            status,
            assignedTo || null,
            assignedTo === null,
            shouldResolve,
            shouldClearResolution,
          ],
        );

        const updatedGrievance = updateResult.rows[0];

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
            tenantId,
            actorEmployeeId,
            'grievance_status_updated',
            'grievance',
            id,
            JSON.stringify({
              previousStatus,
              newStatus: status,
              assignedTo: assignedTo ?? updatedGrievance.assigned_to,
            }),
          ],
        );

        return updatedGrievance;
      });

      res.json({ success: true, grievance });
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;

      if (statusCode === 400 || statusCode === 404) {
        return res.status(statusCode).json({
          success: false,
          error: (error as Error).message,
        });
      }

      console.error('[Grievances] Failed to update grievance status:', error);
      res.status(500).json({ success: false, error: 'Unable to update grievance status' });
    }
  },
);

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
