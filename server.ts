import { logServerError } from './src/lib/server-logging';
import { registerCommunicationsRoutes } from './src/server/communications/communications-routes';
import { registerFlexibleAttendanceRoutes } from './src/server/attendance/flexible-attendance-routes';
import { config as loadDotenv } from 'dotenv';
import express from 'express';
import compression from 'compression';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import sharp from 'sharp';
import { createServer as createViteServer } from 'vite';
import type { PoolClient } from 'pg';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
  type WebAuthnCredential,
} from '@simplewebauthn/server';
import {
  enqueueAuditLog,
  getDbPool,
  hasDatabaseConfig,
  withTenant,
} from './src/lib/hr-background';
import {
  validateEmail,
  validatePasswordStrength,
  validateRequiredText,
} from './src/lib/validation';
import { sendPasswordResetEmail, sendWelcomeEmail } from './src/lib/email';
import { profileImageStorage } from './src/lib/profile-image-storage';
import { registerHiringRoutes } from './src/server/hiring/hiring-routes';
import { registerLiveEmployeesRoutes } from './src/server/live-employees/live-employees-routes';
import { registerAuditRoutes } from './src/server/audit/audit-routes';
import { registerAssetRoutes } from './src/server/assets/asset-routes';
import { registerAssetEvidenceRoutes } from './src/server/assets/asset-evidence-routes';
import { registerPerformanceRoutes } from './src/server/performance/performance-routes';
import { registerOrganisationRoutes } from './src/server/organisation/organisation-routes';
import { registerShiftSwapRoutes } from './src/server/roster/shift-swap-routes';
import { registerRosterGoalRoutes } from './src/server/roster/roster-goal-routes';
import { registerLocationRoutes } from './src/server/locations/location-routes';
import { registerLeaveRoutes } from './src/server/leave/leave-routes';
import { registerDocumentExtractionRoutes } from './src/server/document-extraction/extraction-routes';
import { registerExpenseRoutes } from './src/server/expenses/expense-routes';
import { registerQrTokenRoutes } from './src/server/qr/qr-token-routes';
import { registerEmployeeBadgeRoutes } from './src/server/qr/employee-badge-routes';
import { registerAssetQrLabelRoutes } from './src/server/qr/asset-qr-label-routes';
import { registerResignationRoutes } from './src/server/resignations/resignation-routes';
import { registerNotificationSettingsRoutes } from './src/server/notifications/notification-settings-routes';
import { registerGrievanceRoutes } from './src/server/grievances/grievance-routes';
import { registerSystemRoutes } from './src/server/system/system-routes';
import { registerMapTileRoutes } from './src/server/system/map-tile-routes';
import { registerCompanyFeedRoutes } from './src/server/feed/company-feed-routes';
import {
  registerAttendanceClockInRoute,
  registerAttendanceStatusRoutes,
} from './src/server/attendance/attendance-routes';
import { registerCompanyLocationCompatibilityRoutes } from './src/server/locations/company-location-compatibility-routes';
import { registerBreakRequestRoutes } from './src/server/breaks/break-request-routes';
import { registerRosterShiftRoutes } from './src/server/roster/roster-shift-routes';
import { registerCompensationRoutes } from './src/server/payroll/compensation-routes';
import { registerLoanRoutes } from './src/server/payroll/loan-routes';
import { registerPayrollRoutes } from './src/server/payroll/payroll-routes';
import { registerPayrollExportRoute } from './src/server/payroll/payroll-export-route';
import { registerLegacyLeaveRoutes } from './src/server/leave/legacy-leave-routes';
import {
  registerLegacyRoleDiscoveryRoutes,
  registerLegacyRoleMutationRoutes,
} from './src/server/organisation/legacy-role-routes';
import { registerDashboardAttentionRoutes } from './src/server/dashboard/attention-routes';
import {
  normalizeCompanyLocations,
  type CompanyLocationInput,
  type CompanyLocationType,
} from './src/server/locations/company-location-input';
import { hasPermissionClaim } from './src/server/auth/permission-claims';
import { claimPendingRecognitionDelivery } from './src/server/performance/recognition-delivery';
import { recordAuditEvent } from './src/server/audit/audit-events';
import {
  assertTryCloudflareDevOriginsStartup,
  isAllowedTryCloudflareDevOrigin,
  isTryCloudflareDevOriginsEnabled,
  shouldTrustTryCloudflareDevProxy,
} from './src/server/trycloudflare-dev';

loadDotenv();
if (process.env.NODE_ENV !== 'production') {
  loadDotenv({ path: '.env.development.local', override: true });
}

type WelcomeEmailOptions = {
  sendWelcomeEmail: boolean;
  includeWorkspaceName: boolean;
  includeLoginEmail: boolean;
  credentialDelivery: 'none' | 'setup_link';
};

type CustomTenantRoleInput = {
  name?: string;
  description?: string;
  permissionKeys?: string[];
};

type EmployeeRole = 'hr_admin' | 'manager' | 'employee';

type AuthenticatedUser = {
  employeeId: string;
  tenantId: string;
  email: string;
  role: EmployeeRole;
  jobTitle?: string | null;
  roleNames?: string[];
  permissions?: string[];
};

type AuthEmployeeRow = {
  id: string;
  tenant_id: string;
  email: string;
  full_name: string;
  role: string;
  job_title: string | null;
  profile_image_url: string | null;
  role_names: string[];
  permissions: string[];
  company_name: string;
  is_demo_tenant?: boolean;
};

type WebAuthnCredentialRow = {
  id: string;
  tenant_id: string;
  employee_id: string;
  credential_id: string;
  public_key: string;
  counter: string | number;
  transports: AuthenticatorTransportFuture[] | null;
  device_label: string | null;
  created_at: Date | string;
  last_used_at: Date | string | null;
};

type WebAuthnChallengeType = 'registration' | 'authentication';

const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_LOCK_MS = 5 * 60 * 1000;
const INVALID_LOGIN_TIMING_HASH = generatePasswordHash('stanza-invalid-login-timing-only');
const AUTH_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const AUTH_SESSION_COOKIE = 'stanza_session';
const PROFILE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const PROFILE_IMAGE_SIZE = 512;
const PROFILE_IMAGE_QUALITY = 80;

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
      authSessionId?: string;
    }
  }
}

function generateResetCode() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashResetCode(code: string) {
  return crypto
    .createHash('sha256')
    .update(code)
    .digest('hex');
}

function getRequestIp(req: express.Request) {
  // Express resolves req.ip using the configured trust-proxy topology. Never
  // parse X-Forwarded-For directly: an untrusted client can spoof its first value.
  const address = req.ip || req.socket.remoteAddress || 'unknown';
  const normalized = address.replace(/^::ffff:/i, '').toLowerCase();
  return normalized === '::1' ? '127.0.0.1' : normalized;
}

function maskSessionIp(ip: string) {
  if (!ip || ip === 'unknown') return 'IP unavailable';
  if (ip.includes(':')) {
    const segments = ip.split(':').filter(Boolean);
    return segments.length >= 2 ? `${segments.slice(0, 2).join(':')}::/64` : 'IPv6 network';
  }
  const octets = ip.split('.');
  return octets.length === 4 ? `${octets[0]}.${octets[1]}.${octets[2]}.0/24` : 'IP unavailable';
}

function getSessionDeviceLabel(req: express.Request) {
  const userAgent = req.header('user-agent') || '';
  const browser = /firefox/i.test(userAgent) ? 'Firefox'
    : /edg\//i.test(userAgent) ? 'Edge'
      : /chrome|crios/i.test(userAgent) ? 'Chrome'
        : /safari/i.test(userAgent) ? 'Safari' : 'Browser';
  const os = /windows/i.test(userAgent) ? 'Windows'
    : /android/i.test(userAgent) ? 'Android'
      : /iphone|ipad|ios/i.test(userAgent) ? 'iOS'
        : /mac os|macintosh/i.test(userAgent) ? 'macOS'
          : /linux/i.test(userAgent) ? 'Linux' : 'Unknown OS';
  return `${browser} on ${os}`;
}

function isSameOriginSessionMutation(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!isSameOriginSessionRequest(req)) {
    return res.status(403).json({
      success: false,
      code: 'CSRF_REJECTED',
      error: 'Cross-site session actions are not allowed.',
    });
  }
  return next();
}

function getLoginRateLimitKeys(req: express.Request, normalizedEmail: string) {
  return [`account:${normalizedEmail}`, `ip:${getRequestIp(req)}`];
}

function checkLoginRateLimits(keys: string[]) {
  for (const key of keys) {
    const result = checkLoginRateLimit(key);
    if (result.locked) return result;
  }
  return { locked: false as const };
}

function recordLoginFailures(keys: string[]) {
  keys.forEach((key) => recordFailedLogin(key));
}

function clearLoginRateLimits(keys: string[]) {
  keys.forEach((key) => clearFailedLogins(key));
}

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function formatAuthUser(employee: AuthEmployeeRow) {
  return {
    id: employee.id,
    email: employee.email,
    name: employee.full_name,
    role: employee.role,
    jobTitle: employee.job_title,
    profileImageUrl: employee.profile_image_url,
    roleNames: employee.role_names || [],
    permissions: employee.permissions || [],
    tenantId: employee.tenant_id,
    tenant: employee.company_name,
    isDemoTenant: employee.is_demo_tenant === true,
  };
}

function hashSessionToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function getCookie(req: express.Request, name: string) {
  const cookieHeader = req.header('cookie') || '';
  for (const part of cookieHeader.split(';')) {
    const [key, ...valueParts] = part.trim().split('=');
    if (key === name) return decodeURIComponent(valueParts.join('='));
  }
  return null;
}

function isLoopbackHostname(hostname: string | undefined) {
  const normalized = (hostname || '').trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function shouldUseSecureSessionCookie(req: express.Request) {
  // A production build is routinely used for local verification at
  // http://localhost. Browsers correctly discard Secure cookies there, leaving
  // the dashboard profile visible but every authenticated action unauthenticated.
  // Public origins still fail closed: they receive Secure cookies unless the
  // request arrived through an HTTPS-aware trusted proxy.
  return req.secure || !isLoopbackHostname(req.hostname);
}

function setAuthSessionCookie(req: express.Request, res: express.Response, token: string) {
  const secure = shouldUseSecureSessionCookie(req) ? '; Secure' : '';
  const sameSite = 'Lax';
  res.setHeader(
    'Set-Cookie',
    `${AUTH_SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly${secure}; SameSite=${sameSite}; Path=/; Max-Age=${Math.floor(AUTH_SESSION_TTL_MS / 1000)}`,
  );
}

function clearAuthSessionCookie(req: express.Request, res: express.Response) {
  const secure = shouldUseSecureSessionCookie(req) ? '; Secure' : '';
  const sameSite = 'Lax';
  res.setHeader(
    'Set-Cookie',
    `${AUTH_SESSION_COOKIE}=; HttpOnly${secure}; SameSite=${sameSite}; Path=/; Max-Age=0`,
  );
}

async function createAuthSession(
  employee: { id: string; tenant_id: string },
  req: express.Request,
  res: express.Response,
) {
  const token = crypto.randomBytes(32).toString('base64url');
  const pool = getDbPool();
  await pool.query(
    `INSERT INTO auth_sessions (
       tenant_id, employee_id, session_token_hash, expires_at, device_label, ip_masked, location_label
     )
     VALUES ($1, $2, $3, NOW() + ($4::bigint * INTERVAL '1 millisecond'), $5, $6, 'Location unavailable')`,
    [
      employee.tenant_id,
      employee.id,
      hashSessionToken(token),
      AUTH_SESSION_TTL_MS,
      getSessionDeviceLabel(req),
      maskSessionIp(getRequestIp(req)),
    ],
  );
  setAuthSessionCookie(req, res, token);
}

async function claimRecognitionAfterSuccessfulAuth(tenantId: string, employeeId: string) {
  try {
    return await claimPendingRecognitionDelivery(tenantId, employeeId, 'login');
  } catch (error) {
    // Recognition is supplementary: schema rollout or delivery failure must
    // never prevent a valid employee from receiving a standard session.
    logServerError('[Recognition] Login delivery lookup failed:', error);
    return null;
  }
}

async function revokeAuthSession(req: express.Request, res: express.Response) {
  const token = getCookie(req, AUTH_SESSION_COOKIE);
  if (token) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const sessionResult = await client.query<{
        id: string;
        tenant_id: string;
        employee_id: string;
      }>(
        `SELECT id, tenant_id, employee_id
           FROM auth_sessions
          WHERE session_token_hash = $1
            AND revoked_at IS NULL
          FOR UPDATE`,
        [hashSessionToken(token)],
      );
      const session = sessionResult.rows[0];
      if (session) {
        await client.query(
          `UPDATE auth_sessions SET revoked_at = NOW() WHERE id = $1`,
          [session.id],
        );
        await client.query(
          `SELECT set_config('app.current_tenant', $1, true)`,
          [session.tenant_id],
        );
        await recordAuditEvent(client, {
          tenantId: session.tenant_id,
          actorId: session.employee_id,
          action: 'auth.session.revoked',
          targetType: 'auth_session',
          targetId: session.id,
          metadata: { revocationType: 'logout' },
        });
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  clearAuthSessionCookie(req, res);
}

async function getAuthSessionIdentity(req: express.Request) {
  const token = getCookie(req, AUTH_SESSION_COOKIE);
  if (!token) return null;

  const result = await getDbPool().query<{ id: string; employee_id: string; tenant_id: string }>(
    `SELECT id, employee_id, tenant_id
     FROM auth_sessions
     WHERE session_token_hash = $1
       AND revoked_at IS NULL
       AND expires_at > NOW()
     LIMIT 1`,
    [hashSessionToken(token)],
  );
  const session = result.rows[0];
  if (!session) return null;

  await getDbPool().query(
    `UPDATE auth_sessions SET last_used_at = NOW()
     WHERE id = $1
       AND (last_used_at IS NULL OR last_used_at < NOW() - INTERVAL '5 minutes')`,
    [session.id],
  );
  return session;
}

function allowDevAuthHeaders() {
  return !isProduction() && process.env.DEV_AUTH_HEADERS === 'true';
}

function isSameOriginSessionRequest(req: express.Request) {
  const origin = req.header('origin');
  const fetchSite = req.header('sec-fetch-site');

  // The session cookie is SameSite=Lax. Reject cross-site browser requests as
  // an additional CSRF boundary for this unauthenticated session-issuing route.
  if (fetchSite === 'cross-site') return false;
  if (!origin) return true;

  const expectedOrigin = process.env.APP_BASE_URL?.replace(/\/$/, '');
  if (expectedOrigin && origin === expectedOrigin) return true;

  const requestOrigin = `${req.protocol}://${req.get('host') || ''}`.replace(/\/$/, '');
  if (!expectedOrigin && origin === requestOrigin) return true;

  if (!isAllowedTryCloudflareDevOrigin(origin)) return false;
  try {
    const originUrl = new URL(origin);
    return req.secure && originUrl.hostname === req.hostname.toLowerCase();
  } catch {
    return false;
  }
}

function getWebAuthnConfig() {
  return {
    rpName: process.env.WEBAUTHN_RP_NAME || 'Stanza',
    rpID: process.env.WEBAUTHN_RP_ID || 'localhost',
    origin: process.env.WEBAUTHN_ORIGIN || 'http://localhost:3000',
  };
}

function assertWebAuthnOriginAllowed(origin: string) {
  const parsed = new URL(origin);
  const localhostHosts = new Set(['localhost', '127.0.0.1', '::1']);

  if (parsed.protocol === 'https:' || localhostHosts.has(parsed.hostname)) {
    return;
  }

  throw Object.assign(new Error('WebAuthn origin must be HTTPS or localhost.'), { statusCode: 500 });
}

function bufferToBase64Url(value: Uint8Array | ArrayBuffer) {
  return Buffer.from(value instanceof ArrayBuffer ? new Uint8Array(value) : value).toString('base64url');
}

function base64UrlToBuffer(value: string) {
  return Buffer.from(value, 'base64url');
}

function toWebAuthnCredential(row: WebAuthnCredentialRow): WebAuthnCredential {
  return {
    id: row.credential_id,
    publicKey: base64UrlToBuffer(row.public_key),
    counter: Number(row.counter || 0),
    transports: row.transports || undefined,
  };
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
  const envOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return new Set(
    [
      ...envOrigins,
      process.env.APP_URL,
      process.env.FRONTEND_URL,
      'http://localhost:4173',
      'http://127.0.0.1:4173',
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ].filter(Boolean),
  );
}

function generatePasswordHash(password: string) {
  const salt = crypto.randomBytes(16).toString('hex');

  const hash = crypto
    .scryptSync(password, salt, 64)
    .toString('hex');

  return `scrypt:${salt}:${hash}`;
}

function isValidDateInput(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isUuid(value: string | undefined) {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

const employeeRoles: EmployeeRole[] = ['employee', 'manager', 'hr_admin'];

function isEmployeeRole(value: unknown): value is EmployeeRole {
  return typeof value === 'string' && employeeRoles.includes(value as EmployeeRole);
}

function normalizeCustomTenantRoles(customRoles: CustomTenantRoleInput[] | undefined) {
  if (!Array.isArray(customRoles)) return { ok: true as const, roles: [] };
  if (customRoles.length > 20) {
    return { ok: false as const, error: 'customRoles cannot include more than 20 roles.' };
  }

  const seenNames = new Set<string>();
  const normalizedRoles: Array<{ name: string; description: string | null; permissionKeys: string[] }> = [];

  for (const role of customRoles) {
    const name = role.name?.trim() || '';
    if (!name) continue;
    if (name.length > 100) {
      return { ok: false as const, error: 'Custom role names must be 100 characters or fewer.' };
    }

    const dedupeKey = name.toLowerCase();
    if (seenNames.has(dedupeKey)) {
      return { ok: false as const, error: 'Custom role names must be unique.' };
    }
    seenNames.add(dedupeKey);

    const permissionKeys = Array.isArray(role.permissionKeys)
      ? [...new Set(role.permissionKeys.filter((key) => typeof key === 'string' && key.trim()).map((key) => key.trim()))]
      : [];

    normalizedRoles.push({
      name: name.slice(0, 100),
      description: role.description?.trim() ? role.description.trim().slice(0, 500) : null,
      permissionKeys,
    });
  }

  return { ok: true as const, roles: normalizedRoles };
}

async function seedTenantRolesAndPermissions(
  client: PoolClient,
  tenantId: string,
  customRoles: Array<{ name: string; description: string | null; permissionKeys: string[] }> = [],
) {
  await client.query(
    `
      INSERT INTO tenant_permissions (permission_key, label, description)
      VALUES
        ('locations.read', 'Read locations', 'View company locations.'),
        ('locations.manage', 'Manage locations', 'Create and update company locations and geofences.'),
        ('geofences.manage', 'Manage geofences', 'Create and update company geofence boundaries.'),
        ('attendance.policy.manage', 'Manage attendance policy', 'Configure company attendance and break policies.'),
        ('attendance.clock', 'Clock attendance', 'Clock in and out.'),
        ('attendance.view', 'View attendance', 'View attendance records and summaries.'),
        ('attendance.view_live', 'View live employees', 'View tenant employees with currently open attendance shifts.'),
        ('break_requests.create', 'Create break requests', 'Request manager approval for breaks.'),
        ('break_requests.view_own', 'View own break requests', 'View personal break request history.'),
        ('break_requests.review', 'Review break requests', 'Approve or reject pending break requests.'),
        ('break_requests.view_all', 'View all break requests', 'View tenant break request queues.'),
        ('leave.create', 'Create leave requests', 'Create and view personal leave requests.'),
        ('leave.request.self', 'Request personal leave', 'Create personal leave requests.'),
        ('leave.view.self', 'View personal leave', 'View personal leave request history.'),
        ('leave.cancel.self', 'Cancel personal leave', 'Cancel pending personal leave requests.'),
        ('leave.view.scoped', 'View scoped leave requests', 'View leave requests within an authorised employee scope.'),
        ('leave.approve', 'Approve scoped leave requests', 'Approve or reject leave requests within an authorised employee scope.'),
        ('leave.manage', 'Manage tenant leave', 'Manage leave requests across an explicitly authorised company scope.'),
        ('leave.review', 'Review leave requests', 'Review tenant leave requests.'),
        ('roster.view_all', 'View tenant rosters', 'View roster shifts for employees in the tenant.'),
        ('roster.manage', 'Manage rosters', 'Create, update, cancel, and override roster shifts.'),
        ('roster.goals.view_self', 'View own roster goals', 'View personal weekly roster goals and tasks.'),
        ('roster.goals.view_scoped', 'View scoped roster goals', 'View weekly roster goals for employees in an authorised scope.'),
        ('roster.goals.manage', 'Manage roster goals', 'Assign and manage weekly roster goals within an authorised scope.'),
        ('roster.goals.complete_self', 'Complete own roster goals', 'Update progress and complete personal weekly roster goals.'),
        ('payroll.view_self', 'View own payroll', 'View personal payroll records.'),
        ('payroll.view_all', 'View all payroll', 'View tenant payroll records.'),
        ('payroll.run', 'Run payroll', 'Generate tenant payroll.'),
        ('payroll.approve', 'Approve payroll', 'Approve or cancel payroll records.'),
        ('payroll.mark_paid', 'Mark payroll paid', 'Mark approved payroll as paid.'),
        ('payroll.export_pdf', 'Export payroll PDF', 'Export payroll statements as PDF.'),
        ('compensation.manage', 'Manage compensation', 'Create and update compensation profiles.'),
        ('loans.view_self', 'View own loans', 'View personal employee loans.'),
        ('loans.manage', 'Manage loans', 'Create and update employee loans.'),
        ('grievances.create', 'Create grievances', 'File grievance cases.'),
        ('grievances.review', 'Review grievances', 'Review scoped grievance cases.'),
        ('grievances.view_own', 'Grievances view own', 'Authorized grievance case access.'),
        ('grievances.view', 'Grievances view', 'Authorized grievance case access.'),
        ('grievances.triage', 'Grievances triage', 'Authorized grievance case access.'),
        ('grievances.assign', 'Grievances assign', 'Authorized grievance case access.'),
        ('grievances.respond', 'Grievances respond', 'Authorized grievance case access.'),
        ('grievances.internal_notes', 'Grievances internal notes', 'Authorized grievance case access.'),
        ('grievances.resolve', 'Grievances resolve', 'Authorized grievance case access.'),
        ('grievances.close', 'Grievances close', 'Authorized grievance case access.'),
        ('grievances.confidential', 'Grievances confidential', 'Authorized grievance case access.'),
        ('grievances.configure', 'Grievances configure', 'Authorized grievance case access.'),
        ('resignations.create', 'Create resignation requests', 'Submit resignation requests.'),
        ('resignations.view_own', 'View own resignation requests', 'View personal resignation requests.'),
        ('resignations.view_all', 'View all resignation requests', 'View tenant resignation requests.'),
        ('resignations.review', 'Review resignation requests', 'Approve or reject resignation requests.'),
        ('resignations.process', 'Process resignation requests', 'Mark approved resignation requests as processed.'),
        ('feed.read', 'Read company feed', 'Read company feed posts.'),
        ('feed.publish', 'Publish company feed', 'Create and manage company feed posts.'),
        ('audit.view', 'View audit trail', 'View tenant-scoped audit events.'),
        ('roles.manage', 'Manage roles', 'Manage tenant roles, permissions, and employee titles.'),
        ('roles.assign_privileged', 'Assign privileged roles', 'Assign system administrator and equivalent privileged roles.')
      ON CONFLICT (permission_key) DO UPDATE SET
        label = EXCLUDED.label,
        description = EXCLUDED.description
    `,
  );

  await client.query(
    `
      INSERT INTO tenant_roles (tenant_id, name, description, system_key, is_system)
      VALUES
        ($1, 'Employee', 'Default employee access.', 'employee', true),
        ($1, 'Manager', 'Default manager access.', 'manager', true),
        ($1, 'HR Admin', 'Default HR administrator access.', 'hr_admin', true)
      ON CONFLICT (tenant_id, name) DO NOTHING
    `,
    [tenantId],
  );

  await client.query(
    `
      INSERT INTO tenant_role_permissions (tenant_id, role_id, permission_key)
      SELECT tenant_roles.tenant_id, tenant_roles.id, permission_seed.permission_key
      FROM tenant_roles
      JOIN (
        VALUES
          ('employee', 'locations.read'),
          ('employee', 'attendance.clock'),
          ('employee', 'break_requests.create'),
          ('employee', 'break_requests.view_own'),
          ('employee', 'leave.create'),
          ('employee', 'leave.request.self'),
          ('employee', 'leave.view.self'),
          ('employee', 'leave.cancel.self'),
          ('employee', 'payroll.view_self'),
          ('employee', 'payroll.export_pdf'),
          ('employee', 'loans.view_self'),
          ('employee', 'grievances.create'),
          ('employee', 'grievances.view_own'),
          ('employee', 'resignations.create'),
          ('employee', 'resignations.view_own'),
          ('employee', 'feed.read'),
          ('employee', 'roster.goals.view_self'),
          ('employee', 'roster.goals.complete_self'),
          ('manager', 'locations.read'),
          ('manager', 'attendance.view'),
          ('manager', 'break_requests.create'),
          ('manager', 'break_requests.view_own'),
          ('manager', 'break_requests.review'),
          ('manager', 'break_requests.view_all'),
          ('manager', 'leave.review'),
          ('manager', 'leave.request.self'),
          ('manager', 'leave.view.self'),
          ('manager', 'leave.cancel.self'),
          ('manager', 'roster.view_all'),
          ('manager', 'roster.manage'),
          ('manager', 'roster.goals.view_self'),
          ('manager', 'roster.goals.complete_self'),
          ('manager', 'roster.goals.view_scoped'),
          ('manager', 'roster.goals.manage'),
          ('manager', 'payroll.view_self'),
          ('manager', 'payroll.export_pdf'),
          ('manager', 'loans.view_self'),
          ('manager', 'grievances.review'),
          ('manager', 'grievances.view'),
          ('manager', 'grievances.triage'),
          ('manager', 'grievances.assign'),
          ('manager', 'grievances.respond'),
          ('manager', 'grievances.internal_notes'),
          ('manager', 'grievances.resolve'),
          ('manager', 'grievances.close'),
          ('manager', 'resignations.view_all'),
          ('manager', 'resignations.review'),
          ('manager', 'feed.read')
      ) AS permission_seed(system_key, permission_key)
        ON permission_seed.system_key = tenant_roles.system_key
      WHERE tenant_roles.tenant_id = $1
      ON CONFLICT (tenant_id, role_id, permission_key) DO NOTHING
    `,
    [tenantId],
  );

  await client.query(
    `
      INSERT INTO tenant_role_permissions (tenant_id, role_id, permission_key)
      SELECT tenant_roles.tenant_id, tenant_roles.id, tenant_permissions.permission_key
      FROM tenant_roles
      CROSS JOIN tenant_permissions
      WHERE tenant_roles.tenant_id = $1
        AND tenant_roles.system_key = 'hr_admin'
      ON CONFLICT (tenant_id, role_id, permission_key) DO NOTHING
    `,
    [tenantId],
  );

  const requestedCustomPermissionKeys = [...new Set(customRoles.flatMap((role) => role.permissionKeys))];
  if (requestedCustomPermissionKeys.length > 0) {
    const permissionsResult = await client.query<{ permission_key: string }>(
      `
        SELECT permission_key
        FROM tenant_permissions
        WHERE permission_key = ANY($1::varchar[])
      `,
      [requestedCustomPermissionKeys],
    );
    const validPermissionKeys = new Set(permissionsResult.rows.map((row) => row.permission_key));
    const invalidPermissionKeys = requestedCustomPermissionKeys.filter((key) => !validPermissionKeys.has(key));

    if (invalidPermissionKeys.length > 0) {
      throw Object.assign(new Error(`Invalid custom role permission keys: ${invalidPermissionKeys.join(', ')}`), { statusCode: 400 });
    }
  }

  for (const role of customRoles) {
    const roleResult = await client.query<{ id: string }>(
      `
        INSERT INTO tenant_roles (tenant_id, name, description, is_system)
        VALUES ($1, $2::varchar, $3::text, false)
        ON CONFLICT (tenant_id, name)
        DO UPDATE SET
          description = EXCLUDED.description,
          updated_at = NOW()
        RETURNING id
      `,
      [tenantId, role.name, role.description],
    );

    const roleId = roleResult.rows[0]?.id;
    if (roleId && role.permissionKeys.length > 0) {
      await client.query(
        `
          INSERT INTO tenant_role_permissions (tenant_id, role_id, permission_key)
          SELECT $1, $2, tenant_permissions.permission_key
          FROM tenant_permissions
          WHERE tenant_permissions.permission_key = ANY($3::varchar[])
          ON CONFLICT (tenant_id, role_id, permission_key) DO NOTHING
        `,
        [tenantId, roleId, role.permissionKeys],
      );
    }
  }
}

async function enqueueBestEffort(label: string, task: () => Promise<unknown>) {
  try {
    await task();
  } catch (error) {
    logServerError(`[Background Queue] Failed to enqueue ${label}:`, error);
  }
}

async function demoAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const sessionIdentity = await getAuthSessionIdentity(req);
  if (sessionIdentity) req.authSessionId = sessionIdentity.id;
  const employeeId = sessionIdentity?.employee_id || (allowDevAuthHeaders() ? req.header('x-employee-id') : undefined);
  const tenantId = sessionIdentity?.tenant_id || (allowDevAuthHeaders() ? req.header('x-tenant-id') : undefined);

  if (!sessionIdentity && !allowDevAuthHeaders()) {
    return res.status(401).json({
      success: false,
      code: 'AUTH_SESSION_REQUIRED', error: 'Your session is unavailable or expired. Please sign in again.',
    });
  }

  if (!employeeId || !tenantId) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required.',
    });
  }

  if (!isUuid(employeeId) || !isUuid(tenantId)) {
    return res.status(401).json({
      success: false,
      error: 'Invalid authentication context.',
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
          employees.id AS "employeeId",
          employees.tenant_id AS "tenantId",
          employees.email,
          employees.role,
          employees.job_title AS "jobTitle",
          COALESCE(
            array_remove(array_agg(DISTINCT assigned_role.name), NULL),
            ARRAY[]::varchar[]
          ) AS "roleNames",
          COALESCE(
            array_remove(array_agg(DISTINCT tenant_role_permissions.permission_key), NULL),
            ARRAY[]::varchar[]
          ) AS permissions
        FROM employees
        ${ACTIVE_AUTH_ROLE_JOINS}
        WHERE employees.id = $1
          AND employees.tenant_id = $2
        GROUP BY employees.id
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
    if ((error as { code?: string }).code === '42P01' || (error as { code?: string }).code === '42703') {
      try {
        const fallbackResult = await getDbPool().query<AuthenticatedUser>(
          `
            SELECT
              id AS "employeeId",
              tenant_id AS "tenantId",
              email,
              role,
              NULL::varchar AS "jobTitle",
              ARRAY[]::varchar[] AS "roleNames",
              CASE
                WHEN role = 'hr_admin' THEN ARRAY['roles.manage']::varchar[]
                ELSE ARRAY[]::varchar[]
              END AS permissions
            FROM employees
            WHERE id = $1
              AND tenant_id = $2
            LIMIT 1
          `,
          [employeeId, tenantId],
        );

        if (fallbackResult.rowCount === 0) {
          return res.status(401).json({
            success: false,
            error: 'Invalid authentication context.',
          });
        }

        req.authUser = fallbackResult.rows[0];
        return next();
      } catch (fallbackError) {
        console.error('[Auth] Fallback auth failed:', fallbackError);
      }
    }

    logServerError('[Auth] Failed to resolve authenticated user:', error);

    res.status(500).json({
      success: false,
      error: 'Unable to authenticate request.',
    });
  }
}

function demoAuthWhenDatabaseConfigured(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  if (!hasDatabaseConfig()) {
    return next();
  }

  return demoAuth(req, res, next);
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

function requirePermission(permissionKey: string) {
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

    if (hasPermissionClaim(req.authUser, permissionKey)) {
      return next();
    }

    return res.status(403).json({
      success: false,
      error: 'You do not have permission to perform this action.',
    });
  };
}

function requireHrAdminSessionCenter(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  if (!req.authUser) return res.status(401).json({ success: false, error: 'Authentication required.' });
  if (req.authUser.role !== 'hr_admin' || !hasPermissionClaim(req.authUser, 'sessions.manage')) {
    return res.status(403).json({ success: false, error: 'You do not have permission to manage tenant sessions.' });
  }
  return next();
}

function requireResignationPermission(permissionKey: string, fallbackRoles: EmployeeRole[]) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const user = req.authUser;
    if (!user) return res.status(401).json({ success: false, error: 'Authentication required.' });
    if (user.role === 'hr_admin' || fallbackRoles.includes(user.role) || user.permissions?.includes(permissionKey)) return next();
    return res.status(403).json({ success: false, error: 'You do not have permission to perform this action.' });
  };
}

function apiErrorHandler(
  error: unknown,
  _req: express.Request,
  res: express.Response,
  _next: express.NextFunction,
) {
  logServerError('[API] Unhandled error:', error);

  if (res.headersSent) return;

  const statusCode = Number((error as { statusCode?: number }).statusCode) || 500;
  res.status(statusCode >= 400 && statusCode < 600 ? statusCode : 500).json({
    success: false,
    error: statusCode >= 500 ? 'Internal server error.' : ((error as Error).message || 'Request failed.'),
  });
}
// yet another helper function to verify password against stored hash
function verifyPassword(password: string, storedHash: string | null) {
  if (!storedHash) return false;

  // Demo seed accounts use bcrypt while existing accounts retain the established scrypt format.
  if (storedHash.startsWith('$2')) {
    return bcrypt.compareSync(password, storedHash);
  }

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

async function storeWebAuthnChallenge(
  client: PoolClient,
  tenantId: string,
  employeeId: string,
  challenge: string,
  challengeType: WebAuthnChallengeType,
) {
  await client.query(
    `
      UPDATE webauthn_challenges
      SET used_at = NOW()
      WHERE tenant_id = $1
        AND employee_id = $2
        AND challenge_type = $3::varchar
        AND used_at IS NULL
    `,
    [tenantId, employeeId, challengeType],
  );

  await client.query(
    `
      INSERT INTO webauthn_challenges (
        tenant_id,
        employee_id,
        challenge,
        challenge_type,
        expires_at
      )
      VALUES ($1, $2, $3, $4::varchar, NOW() + INTERVAL '5 minutes')
    `,
    [tenantId, employeeId, challenge, challengeType],
  );
}

async function consumeWebAuthnChallenge(
  client: PoolClient,
  tenantId: string,
  employeeId: string,
  challengeType: WebAuthnChallengeType,
) {
  const result = await client.query<{ id: string; challenge: string }>(
    `
      UPDATE webauthn_challenges
      SET used_at = NOW()
      WHERE id = (
        SELECT id
        FROM webauthn_challenges
        WHERE tenant_id = $1
          AND employee_id = $2
          AND challenge_type = $3::varchar
          AND used_at IS NULL
          AND expires_at > NOW()
        ORDER BY created_at DESC
        LIMIT 1
      )
      RETURNING id, challenge
    `,
    [tenantId, employeeId, challengeType],
  );

  return result.rows[0]?.challenge || null;
}

// Keep login, session refresh and employee projections consistent with active authority.
const ACTIVE_AUTH_ROLE_JOINS = `
 LEFT JOIN employee_role_assignments
   ON employee_role_assignments.tenant_id = employees.tenant_id
  AND employee_role_assignments.employee_id = employees.id
  AND employee_role_assignments.revoked_at IS NULL
  AND employee_role_assignments.assigned_at <= NOW()
  AND (employee_role_assignments.expires_at IS NULL OR employee_role_assignments.expires_at > NOW())
 LEFT JOIN tenant_roles assigned_role
   ON assigned_role.tenant_id = employees.tenant_id
  AND assigned_role.id = employee_role_assignments.role_id
  AND assigned_role.is_active
 LEFT JOIN tenant_role_permissions
   ON tenant_role_permissions.tenant_id = assigned_role.tenant_id
  AND tenant_role_permissions.role_id = assigned_role.id
`;

async function fetchAuthEmployeeByEmail(normalizedEmail: string) {
  const result = await getDbPool().query<AuthEmployeeRow>(
    `
      SELECT
        employees.id,
        employees.tenant_id,
        employees.email,
        employees.full_name,
        employees.role,
        employees.job_title,
        employees.profile_image_url,
        COALESCE(
          array_remove(array_agg(DISTINCT assigned_role.name), NULL),
          ARRAY[]::varchar[]
        ) AS role_names,
        COALESCE(
          array_remove(array_agg(DISTINCT tenant_role_permissions.permission_key), NULL),
          ARRAY[]::varchar[]
        ) AS permissions,
        tenants.company_name,
        tenants.slug = 'stanza-demo' AS is_demo_tenant
      FROM employees
      INNER JOIN tenants
        ON tenants.id = employees.tenant_id
      ${ACTIVE_AUTH_ROLE_JOINS}
      WHERE LOWER(employees.email) = $1
      GROUP BY employees.id, tenants.company_name, tenants.slug
      LIMIT 1
    `,
    [normalizedEmail],
  );

  return result.rows[0] || null;
}

async function fetchAuthEmployeeById(tenantId: string, employeeId: string) {
  const result = await getDbPool().query<AuthEmployeeRow>(
    `
      SELECT
        employees.id,
        employees.tenant_id,
        employees.email,
        employees.full_name,
        employees.role,
        employees.job_title,
        employees.profile_image_url,
        COALESCE(
          array_remove(array_agg(DISTINCT assigned_role.name), NULL),
          ARRAY[]::varchar[]
        ) AS role_names,
        COALESCE(
          array_remove(array_agg(DISTINCT tenant_role_permissions.permission_key), NULL),
          ARRAY[]::varchar[]
        ) AS permissions,
        tenants.company_name,
        tenants.slug = 'stanza-demo' AS is_demo_tenant
      FROM employees
      INNER JOIN tenants
        ON tenants.id = employees.tenant_id
      ${ACTIVE_AUTH_ROLE_JOINS}
      WHERE employees.tenant_id = $1
        AND employees.id = $2
        AND employees.is_active = true
        AND employees.employment_status = 'active'
      GROUP BY employees.id, tenants.company_name, tenants.slug
      LIMIT 1
    `,
    [tenantId, employeeId],
  );

  return result.rows[0] || null;
}

async function startServer() {
  if (isProduction() && process.env.DEV_AUTH_HEADERS === 'true') {
    throw new Error('DEV_AUTH_HEADERS must be disabled in production.');
  }
  assertTryCloudflareDevOriginsStartup();
  if (!isProduction()) {
    console.log('[Stanza] Demo accounts use standard email/password authentication.');
  }

  const app = express();
  const PORT = Number.parseInt(process.env.PORT || '3000', 10);
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error('PORT must be a valid TCP port number.');
  }
  const rateLimitHandler: Parameters<typeof rateLimit>[0]['handler'] = (_req, res) => {
    res.status(429).json({
      success: false,
      code: 'RATE_LIMITED',
      message: 'Too many attempts. Please try again later.',
    });
  };
  const createAuthRateLimiter = (windowMs: number, limit: number) => rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler,
  });
  const sensitiveAuthRateLimiter = createAuthRateLimiter(15 * 60 * 1000, 10);
  const signupRateLimiter = createAuthRateLimiter(60 * 60 * 1000, 5);
  const passwordResetRequestRateLimiter = createAuthRateLimiter(60 * 60 * 1000, 5);
  const passwordResetConfirmRateLimiter = createAuthRateLimiter(60 * 60 * 1000, 10);
  const passkeyLoginRateLimiter = createAuthRateLimiter(15 * 60 * 1000, 20);
  const sessionManagementRateLimiter = createAuthRateLimiter(15 * 60 * 1000, 30);
  const avatarRateLimiter = createAuthRateLimiter(60 * 60 * 1000, 20);
  const feedImageRateLimiter = createAuthRateLimiter(60 * 60 * 1000, 30);
  const feedDraftRateLimiter = createAuthRateLimiter(60 * 1000, 40);
  const assetEvidenceRateLimiter = createAuthRateLimiter(60 * 60 * 1000, 20);
  const organisationMutationRateLimiter = createAuthRateLimiter(15 * 60 * 1000, 60);
  const documentExtractionRateLimiter = createAuthRateLimiter(60 * 60 * 1000, 20);
  const expenseMutationRateLimiter = createAuthRateLimiter(15 * 60 * 1000, 40);
  const qrIssuanceRateLimiter = createAuthRateLimiter(60 * 60 * 1000, 20);
  const qrPublicResolutionRateLimiter = createAuthRateLimiter(15 * 60 * 1000, 120);
  const avatarUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: PROFILE_IMAGE_MAX_BYTES, files: 1 },
    fileFilter: (_req, file, callback) => {
      callback(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype));
    },
  }).single('avatar');
  const parseAvatarUpload = (req: express.Request, res: express.Response) => new Promise<Express.Multer.File>((resolve, reject) => {
    avatarUpload(req, res, (error) => {
      if (error) return reject(error);
      if (!req.file) return reject(Object.assign(new Error('Unsupported image format.'), { statusCode: 415 }));
      resolve(req.file);
    });
  });
  const configuredProxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
  app.set('trust proxy', isTryCloudflareDevOriginsEnabled()
    ? (address: string, hop: number) => shouldTrustTryCloudflareDevProxy(address, hop)
    : Number.isInteger(configuredProxyHops) && configuredProxyHops >= 0
      ? configuredProxyHops
      : 0);
  app.disable('x-powered-by');
  app.use(compression({
    threshold: 1024,
    // compression's content-type guard keeps binary assets such as GLB and PNG
    // out of the response transform while reducing HTML, JS, CSS, JSON, and SVG.
  }));
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: isProduction()
      ? {
          directives: {
            defaultSrc: ["'self'"],
            baseUri: ["'self'"],
            // GLTFLoader decodes the card's embedded texture through a temporary
            // same-document blob URL; MapTiler remains the only remote origin.
            connectSrc: ["'self'", 'blob:', 'https://api.maptiler.com', 'https://*.maptiler.com'],
            fontSrc: ["'self'", 'data:'],
            imgSrc: ["'self'", 'data:', 'blob:', 'https://api.maptiler.com', 'https://*.maptiler.com'],
            objectSrc: ["'none'"],
            // Rapier initializes its bundled WebAssembly module at runtime. This
            // narrow CSP source permits Wasm compilation without enabling general
            // JavaScript eval, which remains prohibited.
            scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://api.maptiler.com', 'https://*.maptiler.com'],
            workerSrc: ["'self'", 'blob:'],
          },
        }
      : false,
  }));
  app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '1mb' }));
  app.use((req, res, next) => {
    const origin = req.header('origin');
    const allowedOrigins = getAllowedCorsOrigins();

    if (origin && (allowedOrigins.has(origin) || isAllowedTryCloudflareDevOrigin(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-employee-id, x-tenant-id');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    }

    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }

    next();
  });

  // Avatar URLs are intentionally public but use opaque UUID filenames. Writes
  // remain authenticated and tenant-scoped; no filesystem paths are exposed.
  app.use(profileImageStorage.publicPath, express.static(profileImageStorage.directory, {
    dotfiles: 'deny',
    fallthrough: false,
    immutable: false,
    index: false,
    maxAge: 0,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'private, no-cache, must-revalidate');
    },
  }));

  // === HORIZON HR API ROUTES ===

  registerCommunicationsRoutes(app, { standardAuth: demoAuth, mutationGuard: isSameOriginSessionMutation, rateLimiter: organisationMutationRateLimiter });
  registerHiringRoutes(app, { demoAuth, requirePermission });
  registerLiveEmployeesRoutes(app, { demoAuth, requireRole, requirePermission });
  registerAuditRoutes(app, { demoAuth, requirePermission });
  registerAssetRoutes(app, { demoAuth, requirePermission });
  // `demoAuth` is the legacy name of the standard session-auth middleware.
  // Performance routes receive it explicitly as standardAuth and have no
  // demo-only authentication or authorization path.
  registerPerformanceRoutes(app, { standardAuth: demoAuth, requirePermission });
  registerOrganisationRoutes(app, {
    standardAuth: demoAuth,
    mutationGuard: isSameOriginSessionMutation,
    rateLimiter: organisationMutationRateLimiter,
  });
  registerShiftSwapRoutes(app, { standardAuth: demoAuth, mutationGuard: isSameOriginSessionMutation, rateLimiter: organisationMutationRateLimiter });
  registerRosterGoalRoutes(app, { standardAuth: demoAuth, mutationGuard: isSameOriginSessionMutation, rateLimiter: organisationMutationRateLimiter });
  registerLocationRoutes(app, { standardAuth: demoAuth, mutationGuard: isSameOriginSessionMutation, rateLimiter: organisationMutationRateLimiter });
  registerLeaveRoutes(app, { standardAuth: demoAuth, mutationGuard: isSameOriginSessionMutation, rateLimiter: organisationMutationRateLimiter });
  registerDocumentExtractionRoutes(app, {
    standardAuth: demoAuth,
    mutationGuard: isSameOriginSessionMutation,
    rateLimiter: documentExtractionRateLimiter,
  });
  registerExpenseRoutes(app, {
    standardAuth: demoAuth,
    mutationGuard: isSameOriginSessionMutation,
    rateLimiter: expenseMutationRateLimiter,
  });
  registerQrTokenRoutes(app, {
    standardAuth: demoAuth,
    mutationGuard: isSameOriginSessionMutation,
    issuanceRateLimiter: qrIssuanceRateLimiter,
    publicRateLimiter: qrPublicResolutionRateLimiter,
  });
  registerEmployeeBadgeRoutes(app, {
    standardAuth: demoAuth,
    mutationGuard: isSameOriginSessionMutation,
    issuanceRateLimiter: qrIssuanceRateLimiter,
  });
  registerAssetQrLabelRoutes(app, {
    standardAuth: demoAuth,
    mutationGuard: isSameOriginSessionMutation,
    issuanceRateLimiter: qrIssuanceRateLimiter,
  });

  registerAssetEvidenceRoutes(app, {
    standardAuth: demoAuth,
    rateLimiter: assetEvidenceRateLimiter,
    isSameOriginRequest: isSameOriginSessionRequest,
  });
  registerMapTileRoutes(app);

  // Registration Route for multi-tenant wizard
  app.post('/api/auth/register-tenant', signupRateLimiter, async (req, res) => {
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
      customRoles,
      locations,
      lat,
      lng,
      radius,
      welcomeEmailOptions,
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
      customRoles?: CustomTenantRoleInput[];
      locations?: CompanyLocationInput[];
      lat?: number | string;
      lng?: number | string;
      radius?: number | string;
      welcomeEmailOptions?: Partial<WelcomeEmailOptions>;
    };

    const defaultWelcomeEmailOptions: WelcomeEmailOptions = {
      sendWelcomeEmail: true,
      includeWorkspaceName: true,
      includeLoginEmail: true,
      credentialDelivery: 'none',
    };
    const normalizedWelcomeEmailOptions = {
      ...defaultWelcomeEmailOptions,
      ...(welcomeEmailOptions || {}),
    };

    const normalizedCompanyName = validateRequiredText(companyName, { label: 'companyName', max: 255 });
    const normalizedTenantSlug = validateRequiredText(tenantSlug, { label: 'tenantSlug', min: 3, max: 255 });
    const normalizedAdminFullName = validateRequiredText(adminFullName, { label: 'adminFullName', min: 2, max: 255 });
    const normalizedAdminEmail = validateEmail(adminEmail);
    const adminPasswordStrength = validatePasswordStrength(adminPassword);
    const normalizedCurrency = currency?.trim() || '';
    const normalizedCapacity = capacity?.trim() || '';
    const normalizedAdminRole = allowedAdminRoles.includes(adminRole as EmployeeRole)
      ? adminRole as EmployeeRole
      : 'hr_admin';
    const normalizedCustomRoles = normalizeCustomTenantRoles(customRoles);
    const normalizedLocations = normalizeCompanyLocations(locations, {
      name: 'Headquarters',
      locationType: 'headquarters',
      lat,
      lng,
      radius,
      isPrimary: true,
    });

    const validationFields: Record<string, string> = {};
    if (!normalizedCompanyName.valid) validationFields.companyName = normalizedCompanyName.error;
    if (!normalizedTenantSlug.valid) validationFields.tenantSlug = normalizedTenantSlug.error;
    if (!normalizedAdminFullName.valid) validationFields.adminFullName = normalizedAdminFullName.error;
    if (!normalizedAdminEmail.valid) validationFields.adminEmail = normalizedAdminEmail.error;
    if (!adminPassword) validationFields.adminPassword = 'Admin password is required.';
    if (!normalizedCurrency) validationFields.currency = 'Currency is required.';
    if (!normalizedCapacity) validationFields.capacity = 'Capacity is required.';

    if (Object.keys(validationFields).length > 0) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Please fix the highlighted fields.',
        fields: validationFields,
      });
    }

    if (!adminPasswordStrength.valid) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Please fix the highlighted fields.',
        fields: {
          adminPassword: `Password is missing: ${adminPasswordStrength.missingRules.join(', ')}.`,
        },
      });
    }

    if (!normalizedLocations.ok) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Please fix the highlighted fields.',
        fields: { locations: normalizedLocations.error },
      });
    }

    if (!normalizedCustomRoles.ok) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Please fix the highlighted fields.',
        fields: { customRoles: normalizedCustomRoles.error },
      });
    }

    if (
      (welcomeEmailOptions !== undefined && (typeof welcomeEmailOptions !== 'object' || Array.isArray(welcomeEmailOptions)))
      ||
      typeof normalizedWelcomeEmailOptions.sendWelcomeEmail !== 'boolean'
      || typeof normalizedWelcomeEmailOptions.includeWorkspaceName !== 'boolean'
      || typeof normalizedWelcomeEmailOptions.includeLoginEmail !== 'boolean'
      || normalizedWelcomeEmailOptions.credentialDelivery !== 'none'
    ) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Welcome email options are invalid for self-service signup.',
        fields: { welcomeEmailOptions: 'Password setup links are not available during self-service signup.' },
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

      // Keep a global login email unique even though employee rows are tenant-scoped.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [normalizedAdminEmail.value]);
      const existingEmailResult = await client.query<{ id: string }>(
        `
          SELECT id
          FROM employees
          WHERE LOWER(email) = $1
          LIMIT 1
        `,
        [normalizedAdminEmail.value],
      );

      if (existingEmailResult.rows[0]) {
        throw Object.assign(new Error('An account with this email already exists.'), {
          statusCode: 409,
          code: 'EMAIL_ALREADY_REGISTERED',
        });
      }

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
          normalizedCompanyName.value,
          normalizedTenantSlug.value.toLowerCase(),
          normalizedCurrency,
          normalizedCapacity,
          Boolean(allowsLoans),
        ],
      );

      const tenant = tenantResult.rows[0];

      await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenant.id]);
      await seedTenantRolesAndPermissions(client, tenant.id, normalizedCustomRoles.roles);

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
          normalizedAdminFullName.value,
          normalizedAdminEmail.value,
          passwordHash,
          normalizedAdminRole,
        ],
      );

      const employee = employeeResult.rows[0];

      await client.query(
        `
          INSERT INTO employee_role_assignments (tenant_id, employee_id, role_id)
          SELECT $1, $2, tenant_roles.id
          FROM tenant_roles
          WHERE tenant_roles.tenant_id = $1
            AND tenant_roles.system_key = $3
          ON CONFLICT (tenant_id, employee_id, role_id) DO NOTHING
        `,
        [tenant.id, employee.id, employee.role],
      );

      const primaryLocation = normalizedLocations.locations.find((location) => location.isPrimary) || normalizedLocations.locations[0];

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
              ST_SetSRID(ST_MakePoint($3::double precision, $4::double precision), 4326)::geography,
              $5::double precision
            )::geometry
          )
        `,
        [tenant.id, primaryLocation.name, primaryLocation.longitude, primaryLocation.latitude, primaryLocation.radiusMeters],
      );

      const createdLocations = [];

      for (const location of normalizedLocations.locations) {
        const locationResult = await client.query<{
          id: string;
          name: string;
          location_type: CompanyLocationType;
          latitude: string;
          longitude: string;
          radius_meters: number;
          is_primary: boolean;
          is_active: boolean;
        }>(
          `
            INSERT INTO company_locations (
              tenant_id,
              name,
              location_type,
              address,
              latitude,
              longitude,
              radius_meters,
              boundary,
              is_primary,
              is_active
            )
            VALUES (
              $1,
              $2,
              $3,
              $4,
              $5::numeric,
              $6::numeric,
              $7::int,
              ST_Buffer(
                ST_SetSRID(ST_MakePoint($6::double precision, $5::double precision), 4326)::geography,
                $7::double precision
              )::geometry,
              $8::boolean,
              $9::boolean
            )
            RETURNING id, name, location_type, latitude, longitude, radius_meters, is_primary, is_active
          `,
          [
            tenant.id,
            location.name,
            location.locationType,
            location.address,
            location.latitude,
            location.longitude,
            location.radiusMeters,
            location.isPrimary,
            location.isActive,
          ],
        );

        createdLocations.push(locationResult.rows[0]);
      }

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
            customRoles: normalizedCustomRoles.roles.map((role) => role.name),
            locations: createdLocations.map((location) => ({
              id: location.id,
              name: location.name,
              locationType: location.location_type,
              lat: location.latitude,
              lng: location.longitude,
              radius: location.radius_meters,
              isPrimary: location.is_primary,
            })),
            welcomeEmail: {
              requested: normalizedWelcomeEmailOptions.sendWelcomeEmail,
              includeWorkspaceName: normalizedWelcomeEmailOptions.includeWorkspaceName,
              includeLoginEmail: normalizedWelcomeEmailOptions.includeLoginEmail,
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

      let welcomeEmailDelivered = false;
      if (normalizedWelcomeEmailOptions.sendWelcomeEmail) {
        const delivery = await sendWelcomeEmail({
          to: employee.email,
          name: employee.full_name,
          workspaceName: tenant.company_name,
          includeWorkspaceName: normalizedWelcomeEmailOptions.includeWorkspaceName,
          includeLoginEmail: normalizedWelcomeEmailOptions.includeLoginEmail,
        });
        welcomeEmailDelivered = delivery.delivered;
      }

      await enqueueBestEffort(
        'welcome email audit log',
        () => enqueueAuditLog({
          tenantId: tenant.id,
          actorEmployeeId: employee.id,
          action: normalizedWelcomeEmailOptions.sendWelcomeEmail
            ? (welcomeEmailDelivered ? 'welcome_email_sent' : 'welcome_email_delivery_failed')
            : 'welcome_email_disabled',
          entityType: 'employee',
          entityId: employee.id,
          metadata: {
            includeWorkspaceName: normalizedWelcomeEmailOptions.includeWorkspaceName,
            includeLoginEmail: normalizedWelcomeEmailOptions.includeLoginEmail,
          },
        }),
      );

      await createAuthSession(employee, req, res);

      res.status(201).json({
        success: true,
        message: normalizedWelcomeEmailOptions.sendWelcomeEmail && !welcomeEmailDelivered
          ? 'Tenant registered successfully. The welcome email could not be sent yet.'
          : 'Tenant registered successfully.',
        welcomeEmail: {
          requested: normalizedWelcomeEmailOptions.sendWelcomeEmail,
          delivered: welcomeEmailDelivered,
        },
        tenant: responseTenant,
        locations: createdLocations,
        user: {
          id: employee.id,
          email: employee.email,
          name: employee.full_name,
          role: employee.role,
          jobTitle: null,
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

      const registerError = error as {
        message?: string;
        code?: string;
        constraint?: string;
        detail?: string;
        table?: string;
        column?: string;
        stack?: string;
      };

      if ((error as { code?: string }).code === 'EMAIL_ALREADY_REGISTERED') {
        return res.status(400).json({
          success: false,
          code: 'REGISTRATION_UNAVAILABLE',
          message: 'Unable to create workspace with these details.',
          fields: { form: 'Unable to create workspace with these details.' },
        });
      }

      if ((error as { code?: string }).code === '23505') {
        return res.status(400).json({
          success: false,
          code: 'REGISTRATION_UNAVAILABLE',
          message: 'Unable to create workspace with these details.',
          fields: { form: 'Unable to create workspace with these details.' },
        });
      }

      if ((error as { statusCode?: number }).statusCode === 400) {
        return res.status(400).json({
          success: false,
          code: 'VALIDATION_ERROR',
          message: 'Please fix the highlighted fields.',
          fields: { form: (error as Error).message },
        });
      }

      console.error('[Register tenant] Failed:', registerError.code || 'UNKNOWN');
      res.status(500).json({
        success: false,
        code: 'REGISTER_TENANT_FAILED',
        message: 'Unable to register workspace.',
      });
    } finally {
      client?.release();
    }
  });




  // Session lifecycle endpoints.


app.post('/api/auth/logout', async (req, res) => {
  try {
    if (hasDatabaseConfig()) await revokeAuthSession(req, res);
    else clearAuthSessionCookie(req, res);
    res.json({ success: true });
  } catch (error) {
    logServerError('[Logout] Failed to revoke session:', error);
    clearAuthSessionCookie(req, res);
    res.status(500).json({ success: false, error: 'Unable to log out safely.' });
  }
});

app.get('/api/auth/session', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    // This is a passive status endpoint, not a protected resource. It never
    // accepts development identity headers, and anonymous/revoked sessions are
    // represented explicitly rather than as a noisy expected 401 response.
    const sessionIdentity = await getAuthSessionIdentity(req);
    if (!sessionIdentity) {
      return res.json({ success: true, authenticated: false });
    }

    const employee = await fetchAuthEmployeeById(sessionIdentity.tenant_id, sessionIdentity.employee_id);
    if (!employee) {
      return res.json({ success: true, authenticated: false });
    }
    return res.json({ success: true, authenticated: true, user: formatAuthUser(employee) });
  } catch (error) {
    logServerError('[Auth session] Failed:', error);
    return res.status(503).json({ success: false, error: 'Unable to restore the session.' });
  }
});

const sessionSelect = `
  SELECT id, employee_id, tenant_id, device_label, ip_masked, location_label,
         created_at, last_used_at, expires_at, revoked_at
    FROM auth_sessions`;

function presentSession(row: Record<string, unknown>, currentSessionId?: string) {
  const revokedAt = row.revoked_at as string | null;
  const expiresAt = row.expires_at as string;
  const expired = !revokedAt && new Date(expiresAt).getTime() <= Date.now();
  return {
    id: row.id,
    isCurrent: row.id === currentSessionId,
    deviceLabel: row.device_label || 'Unknown device',
    ipMasked: row.ip_masked || 'IP unavailable',
    locationLabel: row.location_label || 'Location unavailable',
    createdAt: row.created_at,
    lastActiveAt: row.last_used_at,
    expiresAt,
    status: revokedAt ? 'revoked' : expired ? 'expired' : 'active',
  };
}

app.get('/api/auth/sessions', demoAuth, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const authUser = req.authUser!;
  const result = await getDbPool().query<Record<string, unknown>>(
    `${sessionSelect}
      WHERE tenant_id = $1 AND employee_id = $2
      ORDER BY (id = $3) DESC, COALESCE(last_used_at, created_at) DESC
      LIMIT 100`,
    [authUser.tenantId, authUser.employeeId, req.authSessionId || ''],
  );
  return res.json({ success: true, sessions: result.rows.map((row) => presentSession(row, req.authSessionId)) });
});

app.delete('/api/auth/sessions/:sessionId', sessionManagementRateLimiter, demoAuth, isSameOriginSessionMutation, async (req, res) => {
  const authUser = req.authUser!;
  const { sessionId } = req.params;
  if (!isUuid(sessionId)) return res.status(400).json({ success: false, code: 'SESSION_ID_INVALID', error: 'Invalid session identifier.' });
  if (sessionId === req.authSessionId) return res.status(409).json({ success: false, code: 'CURRENT_SESSION_PROTECTED', error: 'Use Log Out to end this current session.' });

  const revoked = await withTenant(authUser.tenantId, async (client) => {
    const result = await client.query<{ id: string }>(
      `UPDATE auth_sessions SET revoked_at = NOW()
        WHERE id = $1 AND tenant_id = $2 AND employee_id = $3
          AND revoked_at IS NULL AND expires_at > NOW()
        RETURNING id`,
      [sessionId, authUser.tenantId, authUser.employeeId],
    );
    if (!result.rows[0]) return false;
    await recordAuditEvent(client, {
      tenantId: authUser.tenantId, actorId: authUser.employeeId, action: 'auth.session.revoked',
      targetType: 'auth_session', targetId: sessionId, metadata: { revocationType: 'self_service' },
    });
    return true;
  });
  if (!revoked) return res.status(404).json({ success: false, error: 'Session not found.' });
  return res.json({ success: true, revokedSessionId: sessionId });
});

app.post('/api/auth/sessions/revoke-others', sessionManagementRateLimiter, demoAuth, isSameOriginSessionMutation, async (req, res) => {
  const authUser = req.authUser!;
  const revokedCount = await withTenant(authUser.tenantId, async (client) => {
    const result = await client.query<{ id: string }>(
      `UPDATE auth_sessions SET revoked_at = NOW()
        WHERE tenant_id = $1 AND employee_id = $2 AND id <> $3
          AND revoked_at IS NULL AND expires_at > NOW()
        RETURNING id`,
      [authUser.tenantId, authUser.employeeId, req.authSessionId || ''],
    );
    await recordAuditEvent(client, {
      tenantId: authUser.tenantId, actorId: authUser.employeeId, action: 'auth.sessions.revoked_all',
      targetType: 'auth_session', targetId: req.authSessionId || authUser.employeeId,
      metadata: { revokedCount: result.rowCount, revocationType: 'self_service' },
    });
    return result.rowCount;
  });
  return res.json({ success: true, revokedCount });
});

app.get('/api/hr/session-center', demoAuth, requirePermission('sessions.manage'), requireHrAdminSessionCenter, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const authUser = req.authUser!;
  const status = typeof req.query.status === 'string' ? req.query.status : 'active';
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
  const result = await getDbPool().query<Record<string, unknown>>(
    `SELECT auth_sessions.id, auth_sessions.employee_id, auth_sessions.tenant_id, auth_sessions.device_label,
            auth_sessions.ip_masked, auth_sessions.location_label, auth_sessions.created_at,
            auth_sessions.last_used_at, auth_sessions.expires_at, auth_sessions.revoked_at,
            employees.full_name AS employee_name, employees.email AS employee_email, employees.role AS employee_role
       FROM auth_sessions
       JOIN employees ON employees.id = auth_sessions.employee_id AND employees.tenant_id = auth_sessions.tenant_id
      WHERE auth_sessions.tenant_id = $1
        AND ($2 = '' OR employees.full_name ILIKE '%' || $2 || '%' OR employees.email ILIKE '%' || $2 || '%')
        AND ($3 = 'all' OR ($3 = 'active' AND auth_sessions.revoked_at IS NULL AND auth_sessions.expires_at > NOW())
             OR ($3 = 'revoked' AND auth_sessions.revoked_at IS NOT NULL)
             OR ($3 = 'expired' AND auth_sessions.revoked_at IS NULL AND auth_sessions.expires_at <= NOW()))
      ORDER BY COALESCE(auth_sessions.last_used_at, auth_sessions.created_at) DESC
      LIMIT 200`,
    [authUser.tenantId, search, ['active', 'revoked', 'expired', 'all'].includes(status) ? status : 'active'],
  );
  return res.json({ success: true, sessions: result.rows.map((row) => ({ ...presentSession(row, req.authSessionId), employee: { id: row.employee_id, name: row.employee_name, email: row.employee_email, role: row.employee_role } })) });
});

app.delete('/api/hr/session-center/:sessionId', sessionManagementRateLimiter, demoAuth, requirePermission('sessions.manage'), requireHrAdminSessionCenter, isSameOriginSessionMutation, async (req, res) => {
  const authUser = req.authUser!;
  const { sessionId } = req.params;
  if (!isUuid(sessionId)) return res.status(400).json({ success: false, code: 'SESSION_ID_INVALID', error: 'Invalid session identifier.' });
  if (sessionId === req.authSessionId) return res.status(409).json({ success: false, code: 'CURRENT_SESSION_PROTECTED', error: 'Administrators cannot revoke their own current session here.' });
  const revoked = await withTenant(authUser.tenantId, async (client) => {
    const result = await client.query<{ employee_id: string }>(
      `UPDATE auth_sessions SET revoked_at = NOW()
        WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL AND expires_at > NOW()
        RETURNING employee_id`, [sessionId, authUser.tenantId]);
    if (!result.rows[0]) return false;
    await recordAuditEvent(client, { tenantId: authUser.tenantId, actorId: authUser.employeeId, action: 'auth.session.revoked_by_admin', targetType: 'auth_session', targetId: sessionId, metadata: { revocationType: 'admin' } });
    return true;
  });
  if (!revoked) return res.status(404).json({ success: false, error: 'Session not found.' });
  return res.json({ success: true, revokedSessionId: sessionId });
});

app.post('/api/hr/session-center/employees/:employeeId/revoke-all', sessionManagementRateLimiter, demoAuth, requirePermission('sessions.manage'), requireHrAdminSessionCenter, isSameOriginSessionMutation, async (req, res) => {
  const authUser = req.authUser!;
  const { employeeId } = req.params;
  if (!isUuid(employeeId)) return res.status(400).json({ success: false, code: 'EMPLOYEE_ID_INVALID', error: 'Invalid employee identifier.' });
  if (employeeId === authUser.employeeId) return res.status(409).json({ success: false, code: 'CURRENT_SESSION_PROTECTED', error: 'Use the self-service control to revoke your other sessions.' });
  const revokedCount = await withTenant(authUser.tenantId, async (client) => {
    const result = await client.query<{ id: string }>(
      `UPDATE auth_sessions SET revoked_at = NOW()
        WHERE tenant_id = $1 AND employee_id = $2 AND revoked_at IS NULL AND expires_at > NOW()
        RETURNING id`, [authUser.tenantId, employeeId]);
    if (result.rowCount === 0) {
      const employee = await client.query(`SELECT id FROM employees WHERE id = $1 AND tenant_id = $2`, [employeeId, authUser.tenantId]);
      if (!employee.rows[0]) return -1;
    }
    await recordAuditEvent(client, { tenantId: authUser.tenantId, actorId: authUser.employeeId, action: 'auth.sessions.revoked_all', targetType: 'employee', targetId: employeeId, metadata: { revokedCount: result.rowCount, revocationType: 'admin' } });
    return result.rowCount;
  });
  if (revokedCount < 0) return res.status(404).json({ success: false, error: 'Employee not found.' });
  return res.json({ success: true, revokedCount });
});

app.post('/api/auth/login', sensitiveAuthRateLimiter, async (req, res) => {
  const { email, password } = req.body as {
    email?: string;
    password?: string;
  };

  const normalizedLoginEmail = validateEmail(email);

  if (!normalizedLoginEmail.valid || !password) {
    return res.status(400).json({
      success: false,
      error: !normalizedLoginEmail.valid ? normalizedLoginEmail.error : 'Password is required.',
    });
  }

  const normalizedEmail = normalizedLoginEmail.value;

  const loginRateLimitKeys = getLoginRateLimitKeys(req, normalizedEmail);
  const rateLimit = checkLoginRateLimits(loginRateLimitKeys);

  if (rateLimit.locked) {
    return res.status(429).json({
      success: false,
      code: 'RATE_LIMITED',
      message: 'Too many attempts. Please try again later.',
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
      job_title: string | null;
      profile_image_url: string | null;
      role_names: string[];
      permissions: string[];
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
          employees.job_title,
          employees.profile_image_url,
          COALESCE(
            array_remove(array_agg(DISTINCT assigned_role.name), NULL),
            ARRAY[]::varchar[]
          ) AS role_names,
          COALESCE(
            array_remove(array_agg(DISTINCT tenant_role_permissions.permission_key), NULL),
            ARRAY[]::varchar[]
          ) AS permissions,
          employees.password_hash,
          tenants.company_name,
        tenants.slug = 'stanza-demo' AS is_demo_tenant
        FROM employees
        INNER JOIN tenants
          ON tenants.id = employees.tenant_id
        ${ACTIVE_AUTH_ROLE_JOINS}
        WHERE LOWER(employees.email) = $1
        GROUP BY employees.id, tenants.company_name, tenants.slug
        LIMIT 1
      `,
      [normalizedEmail],
    );

    if (result.rowCount === 0) {
      verifyPassword(password, INVALID_LOGIN_TIMING_HASH);
      recordLoginFailures(loginRateLimitKeys);

      return res.status(401).json({
        success: false,
        error: 'Invalid email or password.',
      });
    }

    const employee = result.rows[0];
    const passwordValid = verifyPassword(password, employee.password_hash);

    if (!passwordValid) {
      recordLoginFailures(loginRateLimitKeys);

      return res.status(401).json({
        success: false,
        error: 'Invalid email or password.',
      });
    }

    clearLoginRateLimits(loginRateLimitKeys);
    await createAuthSession(employee, req, res);
    const recognition = await claimRecognitionAfterSuccessfulAuth(employee.tenant_id, employee.id);

    res.json({
      success: true,
      user: formatAuthUser(employee),
      recognition,
    });
  } catch (error) {
    if ((error as { code?: string }).code === '42P01' || (error as { code?: string }).code === '42703') {
      try {
        const fallbackResult = await getDbPool().query<{
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
              tenants.company_name,
        tenants.slug = 'stanza-demo' AS is_demo_tenant
            FROM employees
            INNER JOIN tenants
              ON tenants.id = employees.tenant_id
            WHERE LOWER(employees.email) = $1
            LIMIT 1
          `,
          [normalizedEmail],
        );

        const fallbackEmployee = fallbackResult.rows[0];
        const fallbackPasswordValid = verifyPassword(
          password,
          fallbackEmployee?.password_hash || INVALID_LOGIN_TIMING_HASH,
        );

        if (!fallbackEmployee || !fallbackPasswordValid) {
          recordLoginFailures(loginRateLimitKeys);
          return res.status(401).json({
            success: false,
            error: 'Invalid email or password.',
          });
        }

          clearLoginRateLimits(loginRateLimitKeys);
        await createAuthSession(fallbackEmployee, req, res);
        const recognition = await claimRecognitionAfterSuccessfulAuth(fallbackEmployee.tenant_id, fallbackEmployee.id);

        return res.json({
          success: true,
          recognition,
          user: {
            id: fallbackEmployee.id,
            email: fallbackEmployee.email,
            name: fallbackEmployee.full_name,
            role: fallbackEmployee.role,
            jobTitle: null,
            profileImageUrl: null,
            roleNames: [],
            permissions: fallbackEmployee.role === 'hr_admin' ? ['roles.manage'] : [],
            tenantId: fallbackEmployee.tenant_id,
            tenant: fallbackEmployee.company_name,
          },
        });
      } catch (fallbackError) {
        console.error('[Login] Fallback login failed:', fallbackError);
      }
    }

    logServerError('[Login] Failed:', error);

    res.status(500).json({
      success: false,
      error: 'Unable to authenticate user.',
    });
  }
});


app.post('/api/profile/avatar', avatarRateLimiter, demoAuth, async (req, res) => {
  const authUser = req.authUser!;
  let newProfileImageUrl: string | null = null;
  let databaseUpdated = false;

  try {
    const file = await parseAvatarUpload(req, res);
    const input = sharp(file.buffer, { animated: false, failOn: 'error', limitInputPixels: 40_000_000 });
    const metadata = await input.metadata();

    if (!metadata.format || !['jpeg', 'png', 'webp'].includes(metadata.format) || (metadata.pages || 1) > 1) {
      return res.status(415).json({ success: false, code: 'UNSUPPORTED_IMAGE', message: 'Unsupported image format.' });
    }

    const processedImage = await input
      .rotate()
      .resize(PROFILE_IMAGE_SIZE, PROFILE_IMAGE_SIZE, { fit: 'cover', position: 'attention' })
      .webp({ quality: PROFILE_IMAGE_QUALITY })
      .toBuffer();

    newProfileImageUrl = await profileImageStorage.write(processedImage);

    const previousProfileImageUrl = await withTenant(authUser.tenantId, async (client) => {
      const current = await client.query<{ profile_image_url: string | null }>(
        `SELECT profile_image_url FROM employees WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [authUser.tenantId, authUser.employeeId],
      );
      if (current.rowCount === 0) throw Object.assign(new Error('Employee profile not found.'), { statusCode: 404 });

      await client.query(
        `UPDATE employees SET profile_image_url = $3, updated_at = NOW() WHERE tenant_id = $1 AND id = $2`,
        [authUser.tenantId, authUser.employeeId, newProfileImageUrl],
      );
      await client.query(
        `INSERT INTO audit_logs (tenant_id, actor_employee_id, action, entity_type, entity_id, metadata)
         VALUES ($1, $2, 'profile.avatar_updated', 'employee', $2, $3::jsonb)`,
        [authUser.tenantId, authUser.employeeId, JSON.stringify({ profileImageUrl: newProfileImageUrl })],
      );
      return current.rows[0].profile_image_url;
    });
    databaseUpdated = true;

    await profileImageStorage.remove(previousProfileImageUrl).catch((error) => {
      logServerError('[Profile Avatar] Previous file cleanup failed:', error);
    });
    return res.json({ success: true, message: 'Profile photo updated.', profileImageUrl: newProfileImageUrl });
  } catch (error) {
    if (newProfileImageUrl && !databaseUpdated) await profileImageStorage.remove(newProfileImageUrl).catch(() => undefined);
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ success: false, code: 'IMAGE_TOO_LARGE', message: 'Image is too large.' });
    }
    const statusCode = Number((error as { statusCode?: number }).statusCode) || 422;
    if (!isProduction()) logServerError('[Profile Avatar] Upload failed:', error);
    return res.status(statusCode).json({
      success: false,
      code: statusCode === 415 ? 'UNSUPPORTED_IMAGE' : 'IMAGE_PROCESSING_FAILED',
      message: statusCode === 415 ? 'Unsupported image format.' : 'Could not process image.',
    });
  }
});

app.delete('/api/profile/avatar', avatarRateLimiter, demoAuth, async (req, res) => {
  const authUser = req.authUser!;
  try {
    const previousProfileImageUrl = await withTenant(authUser.tenantId, async (client) => {
      const current = await client.query<{ profile_image_url: string | null }>(
        `SELECT profile_image_url FROM employees WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [authUser.tenantId, authUser.employeeId],
      );
      if (current.rowCount === 0) throw Object.assign(new Error('Employee profile not found.'), { statusCode: 404 });
      await client.query(
        `UPDATE employees SET profile_image_url = NULL, updated_at = NOW() WHERE tenant_id = $1 AND id = $2`,
        [authUser.tenantId, authUser.employeeId],
      );
      await client.query(
        `INSERT INTO audit_logs (tenant_id, actor_employee_id, action, entity_type, entity_id, metadata)
         VALUES ($1, $2, 'profile.avatar_removed', 'employee', $2, '{}'::jsonb)`,
        [authUser.tenantId, authUser.employeeId],
      );
      return current.rows[0].profile_image_url;
    });
    await profileImageStorage.remove(previousProfileImageUrl).catch((error) => {
      logServerError('[Profile Avatar] Removed file cleanup failed:', error);
    });
    return res.json({ success: true, profileImageUrl: null });
  } catch (error) {
    logServerError('[Profile Avatar] Remove failed:', error);
    return res.status(Number((error as { statusCode?: number }).statusCode) || 500).json({
      success: false,
      message: 'Unable to remove profile photo.',
    });
  }
});

app.get('/api/auth/passkeys', demoAuth, async (req, res) => {
  const authUser = req.authUser!;

  try {
    const passkeys = await withTenant(authUser.tenantId, async (client) => {
      const result = await client.query<WebAuthnCredentialRow>(
        `
          SELECT
            id,
            tenant_id,
            employee_id,
            credential_id,
            public_key,
            counter,
            transports,
            device_label,
            created_at,
            last_used_at
          FROM user_webauthn_credentials
          WHERE tenant_id = $1
            AND employee_id = $2
          ORDER BY created_at DESC
        `,
        [authUser.tenantId, authUser.employeeId],
      );

      return result.rows.map((credential) => ({
        id: credential.id,
        deviceLabel: credential.device_label || 'Passkey',
        transports: credential.transports || [],
        createdAt: credential.created_at,
        lastUsedAt: credential.last_used_at,
      }));
    });

    res.json({ success: true, passkeys });
  } catch (error) {
    logServerError('[Passkeys] Failed to list passkeys:', error);
    res.status(500).json({ success: false, error: 'Unable to load passkeys.' });
  }
});

app.post('/api/auth/passkeys/register/options', sensitiveAuthRateLimiter, demoAuth, async (req, res) => {
  const authUser = req.authUser!;

  if (!hasDatabaseConfig()) {
    return res.status(503).json({ success: false, error: 'DATABASE_URL is required for passkeys.' });
  }

  try {
    const { rpName, rpID, origin } = getWebAuthnConfig();
    assertWebAuthnOriginAllowed(origin);

    const options = await withTenant(authUser.tenantId, async (client) => {
      const existingCredentials = await client.query<WebAuthnCredentialRow>(
        `
          SELECT credential_id, transports
          FROM user_webauthn_credentials
          WHERE tenant_id = $1
            AND employee_id = $2
        `,
        [authUser.tenantId, authUser.employeeId],
      );

      const registrationOptions = await generateRegistrationOptions({
        rpName,
        rpID,
        userID: Buffer.from(authUser.employeeId, 'utf8'),
        userName: authUser.email,
        userDisplayName: authUser.email,
        timeout: 60_000,
        attestationType: 'none',
        excludeCredentials: existingCredentials.rows.map((credential) => ({
          id: credential.credential_id,
          transports: credential.transports || undefined,
        })),
        authenticatorSelection: {
          residentKey: 'required',
          userVerification: 'required',
        },
      });

      await storeWebAuthnChallenge(
        client,
        authUser.tenantId,
        authUser.employeeId,
        registrationOptions.challenge,
        'registration',
      );

      return registrationOptions;
    });

    res.json({ success: true, options });
  } catch (error) {
    logServerError('[Passkeys] Failed to create registration options:', error);
    res.status(Number((error as { statusCode?: number }).statusCode) || 500).json({
      success: false,
      error: (error as Error).message || 'Unable to start passkey registration.',
    });
  }
});

app.post('/api/auth/passkeys/register/verify', sensitiveAuthRateLimiter, demoAuth, async (req, res) => {
  const authUser = req.authUser!;
  const { credential, deviceLabel } = req.body as {
    credential?: RegistrationResponseJSON;
    deviceLabel?: string;
  };

  if (!credential) {
    return res.status(400).json({ success: false, error: 'Passkey credential response is required.' });
  }

  try {
    const { rpID, origin } = getWebAuthnConfig();
    assertWebAuthnOriginAllowed(origin);

    const createdCredential = await withTenant(authUser.tenantId, async (client) => {
      const expectedChallenge = await consumeWebAuthnChallenge(
        client,
        authUser.tenantId,
        authUser.employeeId,
        'registration',
      );

      if (!expectedChallenge) {
        throw Object.assign(new Error('Passkey challenge expired. Try again.'), { statusCode: 400 });
      }

      const verification = await verifyRegistrationResponse({
        response: credential,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      });

      if (!verification.verified || !verification.registrationInfo) {
        throw Object.assign(new Error('Passkey registration could not be verified.'), { statusCode: 400 });
      }

      const webAuthnCredential = verification.registrationInfo.credential;
      const transports = credential.response.transports || webAuthnCredential.transports || [];
      const label = typeof deviceLabel === 'string' && deviceLabel.trim()
        ? deviceLabel.trim().slice(0, 120)
        : 'Passkey';

      const result = await client.query<{ id: string }>(
        `
          INSERT INTO user_webauthn_credentials (
            tenant_id,
            employee_id,
            credential_id,
            public_key,
            counter,
            transports,
            device_label
          )
          VALUES ($1, $2, $3, $4, $5, $6::text[], $7::text)
          ON CONFLICT (credential_id) DO NOTHING
          RETURNING id
        `,
        [
          authUser.tenantId,
          authUser.employeeId,
          webAuthnCredential.id,
          bufferToBase64Url(webAuthnCredential.publicKey),
          webAuthnCredential.counter,
          transports,
          label,
        ],
      );

      if (result.rowCount === 0) {
        throw Object.assign(new Error('This passkey is already registered.'), { statusCode: 409 });
      }

      await client.query(
        `
          INSERT INTO audit_logs (tenant_id, actor_employee_id, action, entity_type, entity_id, metadata)
          VALUES ($1, $2, 'passkey.registered', 'user_webauthn_credentials', $3, $4::jsonb)
        `,
        [
          authUser.tenantId,
          authUser.employeeId,
          result.rows[0].id,
          JSON.stringify({
            deviceLabel: label,
            transports,
            credentialDeviceType: verification.registrationInfo.credentialDeviceType,
            credentialBackedUp: verification.registrationInfo.credentialBackedUp,
          }),
        ],
      );

      return { id: result.rows[0].id, deviceLabel: label, transports };
    });

    res.json({ success: true, passkey: createdCredential });
  } catch (error) {
    logServerError('[Passkeys] Failed to verify registration:', error);
    res.status(Number((error as { statusCode?: number }).statusCode) || 500).json({
      success: false,
      error: (error as Error).message || 'Unable to register passkey.',
    });
  }
});

app.post('/api/auth/passkeys/login/options', passkeyLoginRateLimiter, async (req, res) => {
  const { email } = req.body as { email?: string };
  const normalizedPasskeyEmail = validateEmail(email);

  if (!normalizedPasskeyEmail.valid) {
    return res.status(400).json({
      success: false,
      error: normalizedPasskeyEmail.error,
    });
  }

  if (!hasDatabaseConfig()) {
    return res.status(503).json({ success: false, error: 'DATABASE_URL is required for passkeys.' });
  }

  const normalizedEmail = normalizedPasskeyEmail.value;
  const loginRateLimitKeys = getLoginRateLimitKeys(req, normalizedEmail);
  const rateLimit = checkLoginRateLimits(loginRateLimitKeys);

  if (rateLimit.locked) {
    return res.status(429).json({
      success: false,
      code: 'RATE_LIMITED',
      message: 'Too many attempts. Please try again later.',
      retryAfterSeconds: rateLimit.retryAfterSeconds,
    });
  }

  try {
    const { rpID, origin } = getWebAuthnConfig();
    assertWebAuthnOriginAllowed(origin);

    const employee = await fetchAuthEmployeeByEmail(normalizedEmail);
    const options = await generateAuthenticationOptions({
      rpID,
      timeout: 60_000,
      userVerification: 'required',
      // Keep the public response independent of account/passkey existence.
      // Discoverable credentials let the authenticator select the credential.
      allowCredentials: [],
    });

    if (employee) {
      await withTenant(employee.tenant_id, async (client) => {
        const credentials = await client.query(
          `SELECT 1 FROM user_webauthn_credentials
            WHERE tenant_id = $1 AND employee_id = $2
            LIMIT 1`,
          [employee.tenant_id, employee.id],
        );
        if (credentials.rowCount > 0) {
          await storeWebAuthnChallenge(
            client,
            employee.tenant_id,
            employee.id,
            options.challenge,
            'authentication',
          );
        }
      });
    }

    res.json({ success: true, options });
  } catch (error) {
    if (Number((error as { statusCode?: number }).statusCode) === 401) {
      recordLoginFailures(loginRateLimitKeys);
    }

    logServerError('[Passkeys] Failed to create login options:', error);
    res.status(Number((error as { statusCode?: number }).statusCode) || 500).json({
      success: false,
      error: (error as Error).message || 'Unable to start passkey sign in.',
    });
  }
});

app.post('/api/auth/passkeys/login/verify', passkeyLoginRateLimiter, async (req, res) => {
  const { email, credential } = req.body as {
    email?: string;
    credential?: AuthenticationResponseJSON;
  };

  const normalizedPasskeyEmail = validateEmail(email);

  if (!normalizedPasskeyEmail.valid || !credential) {
    return res.status(400).json({
      success: false,
      error: !normalizedPasskeyEmail.valid ? normalizedPasskeyEmail.error : 'Passkey response is required.',
    });
  }

  const normalizedEmail = normalizedPasskeyEmail.value;
  const loginRateLimitKeys = getLoginRateLimitKeys(req, normalizedEmail);
  const rateLimit = checkLoginRateLimits(loginRateLimitKeys);

  if (rateLimit.locked) {
    return res.status(429).json({
      success: false,
      code: 'RATE_LIMITED',
      message: 'Too many attempts. Please try again later.',
      retryAfterSeconds: rateLimit.retryAfterSeconds,
    });
  }

  try {
    const { rpID, origin } = getWebAuthnConfig();
    assertWebAuthnOriginAllowed(origin);

    const employee = await fetchAuthEmployeeByEmail(normalizedEmail);
    if (!employee) {
      recordLoginFailures(loginRateLimitKeys);
      return res.status(401).json({ success: false, error: 'Invalid passkey sign in.' });
    }

    const loginUser = await withTenant(employee.tenant_id, async (client) => {
      const credentialResult = await client.query<WebAuthnCredentialRow>(
        `
          SELECT *
          FROM user_webauthn_credentials
          WHERE tenant_id = $1
            AND employee_id = $2
            AND credential_id = $3
          LIMIT 1
        `,
        [employee.tenant_id, employee.id, credential.id],
      );

      const credentialRow = credentialResult.rows[0];
      if (!credentialRow) {
        throw Object.assign(new Error('Invalid passkey sign in.'), { statusCode: 401 });
      }

      const expectedChallenge = await consumeWebAuthnChallenge(
        client,
        employee.tenant_id,
        employee.id,
        'authentication',
      );

      if (!expectedChallenge) {
        throw Object.assign(new Error('Passkey challenge expired. Try again.'), { statusCode: 400 });
      }

      const verification = await verifyAuthenticationResponse({
        response: credential,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: toWebAuthnCredential(credentialRow),
        requireUserVerification: true,
      });

      if (!verification.verified) {
        throw Object.assign(new Error('Invalid passkey sign in.'), { statusCode: 401 });
      }

      await client.query(
        `
          UPDATE user_webauthn_credentials
          SET counter = $4,
              last_used_at = NOW()
          WHERE tenant_id = $1
            AND employee_id = $2
            AND credential_id = $3
        `,
        [
          employee.tenant_id,
          employee.id,
          credentialRow.credential_id,
          verification.authenticationInfo.newCounter,
        ],
      );

      await client.query(
        `
          INSERT INTO audit_logs (tenant_id, actor_employee_id, action, entity_type, entity_id, metadata)
          VALUES ($1, $2, 'passkey.login', 'user_webauthn_credentials', $3, $4::jsonb)
        `,
        [
          employee.tenant_id,
          employee.id,
          credentialRow.id,
          JSON.stringify({
            credentialDeviceType: verification.authenticationInfo.credentialDeviceType,
            credentialBackedUp: verification.authenticationInfo.credentialBackedUp,
          }),
        ],
      );

      return employee;
    });

    clearLoginRateLimits(loginRateLimitKeys);
    await createAuthSession(loginUser, req, res);
    const recognition = await claimRecognitionAfterSuccessfulAuth(loginUser.tenant_id, loginUser.id);
    res.json({ success: true, user: formatAuthUser(loginUser), recognition });
  } catch (error) {
    recordLoginFailures(loginRateLimitKeys);
    logServerError('[Passkeys] Failed to verify login:', error);
    res.status(Number((error as { statusCode?: number }).statusCode) || 500).json({
      success: false,
      error: (error as Error).message || 'Unable to sign in with passkey.',
    });
  }
});

app.post('/api/auth/request-password-reset', passwordResetRequestRateLimiter, async (req, res) => {
  const { email, method } = req.body as {
    email?: string;
    method?: 'email' | 'admin' | 'security';
  };

  const normalizedResetEmail = validateEmail(email);

  if (!normalizedResetEmail.valid) {
    return res.status(400).json({
      success: false,
      error: normalizedResetEmail.error,
    });
  }

  if (!hasDatabaseConfig()) {
    return res.status(503).json({
      success: false,
      error: 'DATABASE_URL is required for password recovery.',
    });
  }

  try {
    const normalizedEmail = normalizedResetEmail.value;
    const resetCode = generateResetCode();
    const tokenHash = hashResetCode(resetCode);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const result = await getDbPool().query<{
      tenant_id: string;
      employee_id: string;
      full_name: string;
    }>(
      `
        SELECT
          tenant_id,
          id AS employee_id,
          full_name
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
        message: 'If an account exists, password reset instructions have been sent.',
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
        null,
        expiresAt,
      ],
    );

    const appBaseUrl = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
    const delivery = await sendPasswordResetEmail({
      to: normalizedEmail,
      name: employee.full_name,
      resetUrl: `${appBaseUrl}/reset-password?token=${encodeURIComponent(resetCode)}`,
    });

    const response: { success: true; message: string; developmentFallback?: boolean } = {
      success: true,
      message: 'If an account exists, password reset instructions have been sent.',
    };

    if (delivery.developmentFallback) {
      response.developmentFallback = true;
    }

    res.json(response);
  } catch (error) {
    logServerError('[Password Reset] Failed to create reset token:', error);

    res.status(500).json({
      success: false,
      error: 'Unable to start recovery flow.',
    });
  }
});

registerLegacyRoleDiscoveryRoutes(app, {
  standardAuth: demoAuth,
  requirePermission,
});

registerDashboardAttentionRoutes(app, {
  standardAuth: demoAuth,
});


registerResignationRoutes(app, {
  standardAuth: demoAuth,
  requireResignationPermission,
});

registerLegacyRoleMutationRoutes(app, {
  standardAuth: demoAuth,
  requirePermission,
});

registerNotificationSettingsRoutes(app, {
  standardAuth: demoAuth,
  requireRole,
});

app.post('/api/auth/reset-password', passwordResetConfirmRateLimiter, async (req, res) => {
  const { email, resetCode, token, newPassword } = req.body as {
    email?: string;
    resetCode?: string;
    token?: string;
    newPassword?: string;
  };

  const normalizedResetEmail = validateEmail(email);
  const newPasswordStrength = validatePasswordStrength(newPassword);
  const suppliedToken = token?.trim() || resetCode?.trim();

  if (!suppliedToken || !newPassword || (email && !normalizedResetEmail.valid)) {
    return res.status(400).json({
      success: false,
      error: email && !normalizedResetEmail.valid
        ? normalizedResetEmail.error
        : 'Reset token and new password are required.',
    });
  }

  if (!newPasswordStrength.valid) {
    return res.status(400).json({
      success: false,
      error: `Password is missing: ${newPasswordStrength.missingRules.join(', ')}.`,
    });
  }

  if (!hasDatabaseConfig()) {
    return res.status(503).json({
      success: false,
      error: 'DATABASE_URL is required for password reset.',
    });
  }

  const normalizedEmail = normalizedResetEmail.valid ? normalizedResetEmail.value : null;
  const resetCodeHash = hashResetCode(suppliedToken);
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
        WHERE token_hash = $1
          AND used_at IS NULL
          AND expires_at > NOW()
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE
      `,
      [resetCodeHash],
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
        WHERE employee_id = $1
          AND tenant_id = $2
          AND used_at IS NULL
      `,
      [token.employee_id, token.tenant_id],
    );

    await client.query(
      `
        UPDATE auth_sessions
        SET revoked_at = NOW()
        WHERE employee_id = $1
          AND tenant_id = $2
          AND revoked_at IS NULL
      `,
      [token.employee_id, token.tenant_id],
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Password reset successfully. You can now sign in with the new password.',
    });
  } catch (error) {
    await client.query('ROLLBACK');

    logServerError('[Password Reset] Failed to reset password:', error);

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
registerAttendanceClockInRoute(app, {
  authWhenDatabaseConfigured: demoAuthWhenDatabaseConfigured,
  mutationGuard: isSameOriginSessionMutation,
});

registerCompanyLocationCompatibilityRoutes(app, {
  standardAuth: demoAuth,
  requireRole,
});

registerAttendanceStatusRoutes(app, {
  authWhenDatabaseConfigured: demoAuthWhenDatabaseConfigured,
  mutationGuard: isSameOriginSessionMutation,
});

registerFlexibleAttendanceRoutes(app, { standardAuth: demoAuth, mutationGuard: isSameOriginSessionMutation, rateLimiter: organisationMutationRateLimiter });

registerBreakRequestRoutes(app, {
  standardAuth: demoAuth,
  mutationGuard: isSameOriginSessionMutation,
  requirePermission,
});

registerRosterShiftRoutes(app, {
  standardAuth: demoAuth,
});

registerLegacyLeaveRoutes(app, {
  standardAuth: demoAuth,
  requireRole,
});

registerCompensationRoutes(app, {
  standardAuth: demoAuth,
  requirePermission,
  requireRole,
});

registerLoanRoutes(app, {
  standardAuth: demoAuth,
  requirePermission,
});

registerPayrollRoutes(app, {
  standardAuth: demoAuth,
  requirePermission,
});

registerGrievanceRoutes(app, {standardAuth:demoAuth,mutationGuard:isSameOriginSessionMutation,rateLimiter:organisationMutationRateLimiter});

registerPayrollExportRoute(app, {
  standardAuth: demoAuth,
  requirePermission,
});

registerCompanyFeedRoutes(app, {
  standardAuth: demoAuth,
  requirePermission,
  imageRateLimiter: feedImageRateLimiter,
  draftRateLimiter: feedDraftRateLimiter,
  mutationGuard: isSameOriginSessionMutation,
  isSameOriginRequest: isSameOriginSessionRequest,
});

  registerSystemRoutes(app);

  app.use('/api', apiErrorHandler);
  // API misses must never reach either Vite's or production's SPA fallback.
  app.use('/api', (_req, res) => {
    res.status(404).json({ success: false, code: 'API_ROUTE_NOT_FOUND', error: 'API route not found' });
  });

  // === VITE DEV/PRODUCTION MIDDLEWARE ===
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      // Avoid temporary bundled config modules triggering the TypeScript watcher.
      configLoader: 'runner',
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    const assetsPath = path.join(distPath, 'assets');
    const indexPath = path.join(distPath, 'index.html');
    app.use((req, res, next) => {
      if (req.path.endsWith('.map')) return res.status(404).type('text/plain').send('Not found');
      next();
    });
    app.use('/assets', express.static(assetsPath, {
      immutable: true,
      maxAge: '1y',
      fallthrough: true,
    }));
    app.use('/assets', (_req, res) => {
      res.status(404).type('text/plain').send('Asset not found');
    });
    app.use(express.static(distPath, {
      etag: true,
      maxAge: '1h',
      setHeaders: (res, filePath) => {
        if (filePath === indexPath) res.setHeader('Cache-Control', 'no-cache');
      },
    }));
    app.get('*', (req, res) => {
      const acceptsHtml = Boolean(req.accepts('html'));
      if (!acceptsHtml || path.extname(req.path)) {
        return res.status(404).type('text/plain').send('Not found');
      }
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexPath);
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Stanza] Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('[Stanza] Server startup failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
