import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { createServer as createViteServer } from 'vite';
import type { PoolClient } from 'pg';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
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
  enqueueAttendanceRollup,
  enqueueAuditLog,
  getDbPool,
  getHrQueue,
  HR_QUEUE_NAME,
  hasDatabaseConfig,
  withTenant,
} from './src/lib/hr-background';
import {
  validateEmail,
  validatePasswordStrength,
  validateRequiredText,
} from './src/lib/validation';


type ClockInBody = {  
  tenantId?: string;
  employeeId?: string;
  latitude?: number | string;
  longitude?: number | string;
};

type CompanyLocationType = 'headquarters' | 'branch' | 'warehouse' | 'remote_site' | 'other';

type CompanyLocationInput = {
  name?: string;
  locationType?: CompanyLocationType;
  address?: string;
  lat?: number | string;
  lng?: number | string;
  latitude?: number | string;
  longitude?: number | string;
  radius?: number | string;
  isPrimary?: boolean;
  isActive?: boolean;
};

type CustomTenantRoleInput = {
  name?: string;
  description?: string;
  permissionKeys?: string[];
};

type PayrollRunBody = {
  payPeriodStart?: string;
  payPeriodEnd?: string;
  defaultBaseSalary?: number;
  bonuses?: number;
  deductions?: number;
};

type PayrollStatus = 'draft' | 'approved' | 'paid' | 'cancelled';

type UpdatePayrollStatusBody = {
  status?: PayrollStatus;
};

type CompensationPayType = 'monthly' | 'hourly' | 'weekly' | 'annual';

type UpsertCompensationProfileBody = {
  payType?: CompensationPayType;
  baseAmount?: number | string;
  currency?: string;
  effectiveFrom?: string;
};

type LoanStatus = 'active' | 'paid' | 'cancelled';
type LoanRepaymentFrequency = 'monthly' | 'weekly' | 'one_time';

type CreateEmployeeLoanBody = {
  employeeId?: string;
  loanName?: string;
  principalAmount?: number | string;
  repaymentAmount?: number | string;
  currency?: string;
  repaymentFrequency?: LoanRepaymentFrequency;
  issuedAt?: string;
  dueDate?: string | null;
};

type UpdateEmployeeLoanStatusBody = {
  status?: LoanStatus;
};

type GrievancePriority = 'low' | 'normal' | 'high' | 'urgent';
type GrievanceStatus = 'open' | 'under_review' | 'resolved' | 'rejected' | 'closed';
type FeedPostType = 'announcement' | 'event' | 'policy_update' | 'general';
type FeedPostStatus = 'draft' | 'published' | 'archived';
type FeedVisibilityType = 'all' | 'role' | 'location';

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

type FeedVisibilityInput = {
  type?: FeedVisibilityType;
  role?: EmployeeRole;
  locationId?: string;
};

type NormalizedFeedVisibility = {
  type: FeedVisibilityType;
  role?: EmployeeRole;
  locationId?: string;
};

type CreateFeedPostBody = {
  title?: string;
  postType?: FeedPostType;
  contentText?: string;
  contentJson?: unknown;
  eventStartsAt?: string | null;
  eventEndsAt?: string | null;
  status?: Exclude<FeedPostStatus, 'archived'>;
  visibility?: FeedVisibilityInput[];
};

type UpdateFeedPostStatusBody = {
  status?: FeedPostStatus;
};

type NotificationChannel = 'in_app' | 'email' | 'push';
type NotificationKey =
  | 'attendance_reminders'
  | 'break_reminders'
  | 'break_request_pending'
  | 'break_request_reviewed'
  | 'leave_updates'
  | 'payroll_updates'
  | 'loan_updates'
  | 'grievance_updates'
  | 'company_feed_posts'
  | 'role_permission_changes'
  | 'system_alerts';

type NotificationSettingInput = {
  channel?: NotificationChannel;
  notificationKey?: NotificationKey;
  enabled?: boolean;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
};

type UpdateNotificationSettingsBody = {
  settings?: NotificationSettingInput[];
};

type BreakRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

type CreateBreakRequestBody = {
  requestedStartTime?: string | null;
  durationMinutes?: number | string;
  reason?: string | null;
};

type ReviewBreakRequestBody = {
  status?: 'approved' | 'rejected';
  reviewNote?: string | null;
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
  role_names: string[];
  permissions: string[];
  company_name: string;
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

type DemoTimeLog = {
  id: string;
  tenantId: string;
  employeeId: string;
  clockInTime: Date;
  clockOutTime?: Date;
};

type NormalizedCompanyLocation = {
  name: string;
  locationType: CompanyLocationType;
  address: string | null;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  isPrimary: boolean;
  isActive: boolean;
};

const demoOpenTimeLogs = new Map<string, DemoTimeLog>();

const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_LOCK_MS = 5 * 60 * 1000;
const INVALID_LOGIN_TIMING_HASH = generatePasswordHash('stanza-invalid-login-timing-only');
const AUTH_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

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

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function allowDevAuthHeaders() {
  return !isProduction() || process.env.DEV_AUTH_HEADERS === 'true';
}

function getAuthTokenSecret() {
  return process.env.AUTH_TOKEN_SECRET || process.env.SESSION_SECRET || (!isProduction() ? 'stanza-dev-auth-token-secret' : '');
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function signAuthTokenPayload(payload: object) {
  const secret = getAuthTokenSecret();
  if (!secret) {
    throw Object.assign(new Error('AUTH_TOKEN_SECRET is required in production.'), { statusCode: 500 });
  }

  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64url');

  return `${encodedPayload}.${signature}`;
}

function createAuthToken(user: { id: string; tenant_id: string }) {
  return signAuthTokenPayload({
    employeeId: user.id,
    tenantId: user.tenant_id,
    exp: Date.now() + AUTH_TOKEN_TTL_MS,
  });
}

function formatAuthUser(employee: AuthEmployeeRow) {
  return {
    id: employee.id,
    email: employee.email,
    name: employee.full_name,
    role: employee.role,
    jobTitle: employee.job_title,
    roleNames: employee.role_names || [],
    permissions: employee.permissions || [],
    tenantId: employee.tenant_id,
    tenant: employee.company_name,
    authToken: createAuthToken(employee),
  };
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

function getBearerToken(req: express.Request) {
  const header = req.header('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

function verifyAuthToken(req: express.Request) {
  const token = getBearerToken(req);
  if (!token) return { ok: false as const, missing: true as const };

  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) {
    return { ok: false as const, missing: false as const };
  }

  const secret = getAuthTokenSecret();
  if (!secret) {
    return { ok: false as const, missing: false as const };
  }

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64url');
  const provided = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);

  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return { ok: false as const, missing: false as const };
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as {
      employeeId?: unknown;
      tenantId?: unknown;
      exp?: unknown;
    };

    if (
      typeof payload.employeeId !== 'string' ||
      typeof payload.tenantId !== 'string' ||
      typeof payload.exp !== 'number' ||
      payload.exp < Date.now()
    ) {
      return { ok: false as const, missing: false as const };
    }

    return {
      ok: true as const,
      employeeId: payload.employeeId,
      tenantId: payload.tenantId,
    };
  } catch {
    return { ok: false as const, missing: false as const };
  }
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

function isUuid(value: string | undefined) {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

function normalizeOptionalTimestamp(value: string | null | undefined) {
  if (!value) return null;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function isNonNegativeAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

const grievancePriorities: GrievancePriority[] = ['low', 'normal', 'high', 'urgent'];
const grievanceStatuses: GrievanceStatus[] = ['open', 'under_review', 'resolved', 'rejected', 'closed'];
const companyLocationTypes: CompanyLocationType[] = ['headquarters', 'branch', 'warehouse', 'remote_site', 'other'];
const payrollStatuses: PayrollStatus[] = ['draft', 'approved', 'paid', 'cancelled'];
const compensationPayTypes: CompensationPayType[] = ['monthly', 'hourly', 'weekly', 'annual'];
const loanStatuses: LoanStatus[] = ['active', 'paid', 'cancelled'];
const loanRepaymentFrequencies: LoanRepaymentFrequency[] = ['monthly', 'weekly', 'one_time'];
const feedPostTypes: FeedPostType[] = ['announcement', 'event', 'policy_update', 'general'];
const feedPostStatuses: FeedPostStatus[] = ['draft', 'published', 'archived'];
const feedVisibilityTypes: FeedVisibilityType[] = ['all', 'role', 'location'];
const notificationChannels: NotificationChannel[] = ['in_app', 'email', 'push'];
const notificationKeys: NotificationKey[] = [
  'attendance_reminders',
  'break_reminders',
  'break_request_pending',
  'break_request_reviewed',
  'leave_updates',
  'payroll_updates',
  'loan_updates',
  'grievance_updates',
  'company_feed_posts',
  'role_permission_changes',
  'system_alerts',
];
const breakRequestStatuses: BreakRequestStatus[] = ['pending', 'approved', 'rejected', 'cancelled'];
const employeeRoles: EmployeeRole[] = ['employee', 'manager', 'hr_admin'];

function isGrievancePriority(value: unknown): value is GrievancePriority {
  return typeof value === 'string' && grievancePriorities.includes(value as GrievancePriority);
}

function isGrievanceStatus(value: unknown): value is GrievanceStatus {
  return typeof value === 'string' && grievanceStatuses.includes(value as GrievanceStatus);
}

function isCompanyLocationType(value: unknown): value is CompanyLocationType {
  return typeof value === 'string' && companyLocationTypes.includes(value as CompanyLocationType);
}

function isPayrollStatus(value: unknown): value is PayrollStatus {
  return typeof value === 'string' && payrollStatuses.includes(value as PayrollStatus);
}

function isCompensationPayType(value: unknown): value is CompensationPayType {
  return typeof value === 'string' && compensationPayTypes.includes(value as CompensationPayType);
}

function isLoanStatus(value: unknown): value is LoanStatus {
  return typeof value === 'string' && loanStatuses.includes(value as LoanStatus);
}

function isLoanRepaymentFrequency(value: unknown): value is LoanRepaymentFrequency {
  return typeof value === 'string' && loanRepaymentFrequencies.includes(value as LoanRepaymentFrequency);
}

function isFeedPostType(value: unknown): value is FeedPostType {
  return typeof value === 'string' && feedPostTypes.includes(value as FeedPostType);
}

function isFeedPostStatus(value: unknown): value is FeedPostStatus {
  return typeof value === 'string' && feedPostStatuses.includes(value as FeedPostStatus);
}

function isFeedVisibilityType(value: unknown): value is FeedVisibilityType {
  return typeof value === 'string' && feedVisibilityTypes.includes(value as FeedVisibilityType);
}

function isNotificationChannel(value: unknown): value is NotificationChannel {
  return typeof value === 'string' && notificationChannels.includes(value as NotificationChannel);
}

function isNotificationKey(value: unknown): value is NotificationKey {
  return typeof value === 'string' && notificationKeys.includes(value as NotificationKey);
}

function isBreakRequestStatus(value: unknown): value is BreakRequestStatus {
  return typeof value === 'string' && breakRequestStatuses.includes(value as BreakRequestStatus);
}

function isEmployeeRole(value: unknown): value is EmployeeRole {
  return typeof value === 'string' && employeeRoles.includes(value as EmployeeRole);
}

function isValidQuietHour(value: string | null | undefined) {
  return value === null || value === undefined || /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function formatNotificationSetting(row: {
  channel: NotificationChannel;
  notification_key: NotificationKey;
  enabled: boolean;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
}) {
  return {
    channel: row.channel,
    notificationKey: row.notification_key,
    enabled: row.enabled,
    quietHoursStart: row.quiet_hours_start ? String(row.quiet_hours_start).slice(0, 5) : null,
    quietHoursEnd: row.quiet_hours_end ? String(row.quiet_hours_end).slice(0, 5) : null,
  };
}

function buildDefaultNotificationSettings() {
  return notificationKeys.flatMap((notificationKey) => (
    notificationChannels.map((channel) => ({
      channel,
      notification_key: notificationKey,
      enabled: true,
      quiet_hours_start: null,
      quiet_hours_end: null,
    }))
  ));
}

function mergeNotificationSettings(rows: Array<{
  channel: NotificationChannel;
  notification_key: NotificationKey;
  enabled: boolean;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
}>) {
  const savedByKey = new Map(rows.map((row) => [`${row.channel}:${row.notification_key}`, row]));

  return buildDefaultNotificationSettings().map((defaultSetting) => (
    formatNotificationSetting(savedByKey.get(`${defaultSetting.channel}:${defaultSetting.notification_key}`) || defaultSetting)
  ));
}

function normalizeFeedDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function normalizeFeedVisibility(visibility: FeedVisibilityInput[] | undefined) {
  const rawVisibility = Array.isArray(visibility) && visibility.length > 0
    ? visibility
    : [{ type: 'all' as const }];

  if (rawVisibility.some((rule) => rule.type === 'all')) {
    return { ok: true as const, visibility: [{ type: 'all' as const }] };
  }

  const normalizedVisibility: NormalizedFeedVisibility[] = [];

  for (const rule of rawVisibility) {
    if (!isFeedVisibilityType(rule.type)) {
      return { ok: false as const, error: 'visibility type must be all, role, or location.' };
    }

    if (rule.type === 'role') {
      if (!isEmployeeRole(rule.role)) {
        return { ok: false as const, error: 'visibility role must be employee, manager, or hr_admin.' };
      }

      normalizedVisibility.push({ type: 'role', role: rule.role });
    }

    if (rule.type === 'location') {
      if (!rule.locationId) {
        return { ok: false as const, error: 'location visibility requires locationId.' };
      }

      normalizedVisibility.push({ type: 'location', locationId: rule.locationId });
    }
  }

  return {
    ok: true as const,
    visibility: normalizedVisibility.length > 0 ? normalizedVisibility : [{ type: 'all' as const }],
  };
}

function formatPdfDate(value: string | Date | null | undefined) {
  if (!value) return 'Not set';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Not set';

  return parsed.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatPdfDateTime(value: string | Date | null | undefined) {
  if (!value) return 'Not set';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Not set';

  return parsed.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatPdfMoney(value: string | number | null | undefined, currency: string | null | undefined) {
  const amount = Number(value || 0);

  return `${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0)} ${currency || 'USD'}`;
}

function sanitizeFilenamePart(value: string | null | undefined) {
  const sanitized = (value || 'payroll')
    .trim()
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  return sanitized || 'payroll';
}

function normalizeCompanyLocations(
  locations: CompanyLocationInput[] | undefined,
  fallbackLocation?: CompanyLocationInput,
) {
  const rawLocations = Array.isArray(locations) && locations.length > 0
    ? locations
    : fallbackLocation?.lat !== undefined || fallbackLocation?.lng !== undefined || fallbackLocation?.latitude !== undefined || fallbackLocation?.longitude !== undefined || fallbackLocation?.radius !== undefined
      ? [{ ...fallbackLocation, name: fallbackLocation.name || 'Headquarters', locationType: 'headquarters' as const, isPrimary: true }]
      : [];

  if (rawLocations.length === 0) {
    return { ok: false as const, error: 'At least one company location is required.' };
  }

  const primaryIndex = rawLocations.findIndex((location) => location.isPrimary);

  for (const [index, location] of rawLocations.entries()) {
    const name = location.name?.trim() || '';
    const locationType = location.locationType || (index === 0 ? 'headquarters' : 'branch');
    const latitude = Number(location.lat ?? location.latitude);
    const longitude = Number(location.lng ?? location.longitude);
    const radiusMeters = Number(location.radius);

    if (!name) {
      return { ok: false as const, error: 'Each location requires a name.' };
    }

    if (name.length > 120 || (location.address && location.address.trim().length > 300)) {
      return { ok: false as const, error: 'Location names must be 120 characters or fewer and addresses 300 characters or fewer.' };
    }

    if (!isCompanyLocationType(locationType)) {
      return { ok: false as const, error: 'locationType must be headquarters, branch, warehouse, remote_site, or other.' };
    }

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return { ok: false as const, error: 'Each location requires valid lat and lng numbers.' };
    }

    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return { ok: false as const, error: 'Each location latitude must be -90 to 90 and longitude must be -180 to 180.' };
    }

    if (!Number.isFinite(radiusMeters) || radiusMeters < 25 || radiusMeters > 5000) {
      return { ok: false as const, error: 'Each location radius must be between 25 and 5000 meters.' };
    }
  }

  const normalizedLocations: NormalizedCompanyLocation[] = rawLocations.map((location, index) => ({
    name: location.name!.trim().slice(0, 120),
    locationType: location.locationType || (index === 0 ? 'headquarters' : 'branch'),
    address: location.address?.trim().slice(0, 300) || null,
    latitude: Number(location.lat ?? location.latitude),
    longitude: Number(location.lng ?? location.longitude),
    radiusMeters: Number(location.radius),
    isPrimary: primaryIndex === -1 ? index === 0 : index === primaryIndex,
    isActive: location.isActive ?? true,
  }));

  return { ok: true as const, locations: normalizedLocations };
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
        ('attendance.clock', 'Clock attendance', 'Clock in and out.'),
        ('attendance.view', 'View attendance', 'View attendance records and summaries.'),
        ('break_requests.create', 'Create break requests', 'Request manager approval for breaks.'),
        ('break_requests.view_own', 'View own break requests', 'View personal break request history.'),
        ('break_requests.review', 'Review break requests', 'Approve or reject pending break requests.'),
        ('break_requests.view_all', 'View all break requests', 'View tenant break request queues.'),
        ('leave.create', 'Create leave requests', 'Create and view personal leave requests.'),
        ('leave.review', 'Review leave requests', 'Review tenant leave requests.'),
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
        ('grievances.review', 'Review grievances', 'Review tenant grievance cases.'),
        ('feed.read', 'Read company feed', 'Read company feed posts.'),
        ('feed.publish', 'Publish company feed', 'Create and manage company feed posts.'),
        ('roles.manage', 'Manage roles', 'Manage tenant roles, permissions, and employee titles.')
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
          ('employee', 'payroll.view_self'),
          ('employee', 'payroll.export_pdf'),
          ('employee', 'loans.view_self'),
          ('employee', 'grievances.create'),
          ('employee', 'feed.read'),
          ('manager', 'locations.read'),
          ('manager', 'attendance.view'),
          ('manager', 'break_requests.create'),
          ('manager', 'break_requests.view_own'),
          ('manager', 'break_requests.review'),
          ('manager', 'break_requests.view_all'),
          ('manager', 'leave.review'),
          ('manager', 'payroll.view_self'),
          ('manager', 'payroll.export_pdf'),
          ('manager', 'loans.view_self'),
          ('manager', 'grievances.review'),
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
    console.error(`[Background Queue] Failed to enqueue ${label}:`, error);
  }
}

async function demoAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const tokenAuth = verifyAuthToken(req);

  /*
    Production identity must come from a signed token issued by login/signup.
    The legacy x-employee-id/x-tenant-id headers are kept only for local/demo
    workflows unless DEV_AUTH_HEADERS=true is explicitly set.
  */
  if (!tokenAuth.ok && !tokenAuth.missing) {
    return res.status(401).json({
      success: false,
      error: 'Invalid authentication token.',
    });
  }

  const employeeId = tokenAuth.ok ? tokenAuth.employeeId : req.header('x-employee-id');
  const tenantId = tokenAuth.ok ? tokenAuth.tenantId : req.header('x-tenant-id');

  if (!tokenAuth.ok && !allowDevAuthHeaders()) {
    return res.status(401).json({
      success: false,
      error: 'Authentication token required.',
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
        LEFT JOIN employee_role_assignments
          ON employee_role_assignments.tenant_id = employees.tenant_id
         AND employee_role_assignments.employee_id = employees.id
        LEFT JOIN tenant_roles assigned_role
          ON assigned_role.tenant_id = employees.tenant_id
         AND assigned_role.id = employee_role_assignments.role_id
        LEFT JOIN tenant_role_permissions
          ON tenant_role_permissions.tenant_id = assigned_role.tenant_id
         AND tenant_role_permissions.role_id = assigned_role.id
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

    console.error('[Auth] Failed to resolve authenticated user:', error);

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

    if (req.authUser.role === 'hr_admin' || req.authUser.permissions?.includes(permissionKey)) {
      return next();
    }

    return res.status(403).json({
      success: false,
      error: 'You do not have permission to perform this action.',
    });
  };
}

function authUserHasPermission(authUser: AuthenticatedUser, permissionKey: string) {
  return authUser.role === 'hr_admin' || Boolean(authUser.permissions?.includes(permissionKey));
}

function apiErrorHandler(
  error: unknown,
  _req: express.Request,
  res: express.Response,
  _next: express.NextFunction,
) {
  console.error('[API] Unhandled error:', error);

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
        COALESCE(
          array_remove(array_agg(DISTINCT assigned_role.name), NULL),
          ARRAY[]::varchar[]
        ) AS role_names,
        COALESCE(
          array_remove(array_agg(DISTINCT tenant_role_permissions.permission_key), NULL),
          ARRAY[]::varchar[]
        ) AS permissions,
        tenants.company_name
      FROM employees
      INNER JOIN tenants
        ON tenants.id = employees.tenant_id
      LEFT JOIN employee_role_assignments
        ON employee_role_assignments.tenant_id = employees.tenant_id
       AND employee_role_assignments.employee_id = employees.id
      LEFT JOIN tenant_roles assigned_role
        ON assigned_role.tenant_id = employees.tenant_id
       AND assigned_role.id = employee_role_assignments.role_id
      LEFT JOIN tenant_role_permissions
        ON tenant_role_permissions.tenant_id = assigned_role.tenant_id
       AND tenant_role_permissions.role_id = assigned_role.id
      WHERE LOWER(employees.email) = $1
      GROUP BY employees.id, tenants.company_name
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
        COALESCE(
          array_remove(array_agg(DISTINCT assigned_role.name), NULL),
          ARRAY[]::varchar[]
        ) AS role_names,
        COALESCE(
          array_remove(array_agg(DISTINCT tenant_role_permissions.permission_key), NULL),
          ARRAY[]::varchar[]
        ) AS permissions,
        tenants.company_name
      FROM employees
      INNER JOIN tenants
        ON tenants.id = employees.tenant_id
      LEFT JOIN employee_role_assignments
        ON employee_role_assignments.tenant_id = employees.tenant_id
       AND employee_role_assignments.employee_id = employees.id
      LEFT JOIN tenant_roles assigned_role
        ON assigned_role.tenant_id = employees.tenant_id
       AND assigned_role.id = employee_role_assignments.role_id
      LEFT JOIN tenant_role_permissions
        ON tenant_role_permissions.tenant_id = assigned_role.tenant_id
       AND tenant_role_permissions.role_id = assigned_role.id
      WHERE employees.tenant_id = $1
        AND employees.id = $2
      GROUP BY employees.id, tenants.company_name
      LIMIT 1
    `,
    [tenantId, employeeId],
  );

  return result.rows[0] || null;
}

async function startServer() {
  const app = express();
  const PORT = 3000;
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

  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: isProduction()
      ? {
          directives: {
            defaultSrc: ["'self'"],
            baseUri: ["'self'"],
            connectSrc: ["'self'", 'https://api.maptiler.com', 'https://*.maptiler.com'],
            fontSrc: ["'self'", 'data:'],
            imgSrc: ["'self'", 'data:', 'blob:', 'https://api.maptiler.com', 'https://*.maptiler.com'],
            objectSrc: ["'none'"],
            scriptSrc: ["'self'"],
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

    if (origin && allowedOrigins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-employee-id, x-tenant-id');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
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

    if (!hasDatabaseConfig()) {
      return res.status(503).json({
        success: false,
        error: 'DATABASE_URL is required for tenant registration.',
      });
    }

    if (isProduction() && !getAuthTokenSecret()) {
      return res.status(500).json({
        success: false,
        error: 'Authentication is not configured.',
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
        locations: createdLocations,
        user: {
          id: employee.id,
          email: employee.email,
          name: employee.full_name,
          role: employee.role,
          jobTitle: null,
          tenantId: employee.tenant_id,
          tenant: responseTenant,
          authToken: createAuthToken(employee),
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

      console.error('[register-tenant failed]', {
        message: registerError.message,
        code: registerError.code,
        constraint: registerError.constraint,
        detail: registerError.detail,
        table: registerError.table,
        column: registerError.column,
        stack: process.env.NODE_ENV === 'production' ? undefined : registerError.stack,
      });

      if ((error as { code?: string }).code === 'EMAIL_ALREADY_REGISTERED') {
        return res.status(409).json({
          success: false,
          code: 'EMAIL_UNAVAILABLE',
          message: 'This email cannot be used for a new workspace. Try signing in or recovering your account.',
          fields: { adminEmail: 'This email cannot be used for a new workspace. Try signing in or recovering your account.' },
        });
      }

      if ((error as { code?: string }).code === '23505') {
        return res.status(409).json({
          success: false,
          code: 'WORKSPACE_UNAVAILABLE',
          message: 'This workspace name is unavailable. Try another name.',
          fields: { tenantSlug: 'This workspace name is unavailable. Try another name.' },
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

      res.status(500).json({
        success: false,
        code: 'REGISTER_TENANT_FAILED',
        message: 'Unable to register workspace.',
      });
    } finally {
      client?.release();
    }
  });




  // 1. Auth Endpoint (Simulates secure iron-session check)


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
  const loginRateLimitKey = getLoginRateLimitKey(req, normalizedEmail);
  const rateLimit = checkLoginRateLimit(loginRateLimitKey);

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

  if (isProduction() && !getAuthTokenSecret()) {
    return res.status(500).json({
      success: false,
      error: 'Authentication is not configured.',
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
          COALESCE(
            array_remove(array_agg(DISTINCT assigned_role.name), NULL),
            ARRAY[]::varchar[]
          ) AS role_names,
          COALESCE(
            array_remove(array_agg(DISTINCT tenant_role_permissions.permission_key), NULL),
            ARRAY[]::varchar[]
          ) AS permissions,
          employees.password_hash,
          tenants.company_name
        FROM employees
        INNER JOIN tenants
          ON tenants.id = employees.tenant_id
        LEFT JOIN employee_role_assignments
          ON employee_role_assignments.tenant_id = employees.tenant_id
         AND employee_role_assignments.employee_id = employees.id
        LEFT JOIN tenant_roles assigned_role
          ON assigned_role.tenant_id = employees.tenant_id
         AND assigned_role.id = employee_role_assignments.role_id
        LEFT JOIN tenant_role_permissions
          ON tenant_role_permissions.tenant_id = assigned_role.tenant_id
         AND tenant_role_permissions.role_id = assigned_role.id
        WHERE LOWER(employees.email) = $1
        GROUP BY employees.id, tenants.company_name
        LIMIT 1
      `,
      [normalizedEmail],
    );

    if (result.rowCount === 0) {
      verifyPassword(password, INVALID_LOGIN_TIMING_HASH);
      recordFailedLogin(loginRateLimitKey);

      return res.status(401).json({
        success: false,
        error: 'Invalid email or password.',
      });
    }

    const employee = result.rows[0];
    const passwordValid = verifyPassword(password, employee.password_hash);

    if (!passwordValid) {
      recordFailedLogin(loginRateLimitKey);

      return res.status(401).json({
        success: false,
        error: 'Invalid email or password.',
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
        jobTitle: employee.job_title,
        roleNames: employee.role_names,
        permissions: employee.permissions,
        tenantId: employee.tenant_id,
        tenant: employee.company_name,
        authToken: createAuthToken(employee),
      },
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
              tenants.company_name
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
          recordFailedLogin(loginRateLimitKey);
          return res.status(401).json({
            success: false,
            error: 'Invalid email or password.',
          });
        }

        clearFailedLogins(loginRateLimitKey);

        return res.json({
          success: true,
          user: {
            id: fallbackEmployee.id,
            email: fallbackEmployee.email,
            name: fallbackEmployee.full_name,
            role: fallbackEmployee.role,
            jobTitle: null,
            roleNames: [],
            permissions: fallbackEmployee.role === 'hr_admin' ? ['roles.manage'] : [],
            tenantId: fallbackEmployee.tenant_id,
            tenant: fallbackEmployee.company_name,
            authToken: createAuthToken(fallbackEmployee),
          },
        });
      } catch (fallbackError) {
        console.error('[Login] Fallback login failed:', fallbackError);
      }
    }

    console.error('[Login] Failed:', error);

    res.status(500).json({
      success: false,
      error: 'Unable to authenticate user.',
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
    console.error('[Passkeys] Failed to list passkeys:', error);
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
          residentKey: 'preferred',
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
    console.error('[Passkeys] Failed to create registration options:', error);
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
    console.error('[Passkeys] Failed to verify registration:', error);
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
  const loginRateLimitKey = getLoginRateLimitKey(req, normalizedEmail);
  const rateLimit = checkLoginRateLimit(loginRateLimitKey);

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
      recordFailedLogin(loginRateLimitKey);
      return res.status(401).json({ success: false, error: 'Invalid passkey sign in.' });
    }

    const options = await withTenant(employee.tenant_id, async (client) => {
      const credentials = await client.query<WebAuthnCredentialRow>(
        `
          SELECT *
          FROM user_webauthn_credentials
          WHERE tenant_id = $1
            AND employee_id = $2
          ORDER BY created_at DESC
        `,
        [employee.tenant_id, employee.id],
      );

      if (credentials.rowCount === 0) {
        throw Object.assign(new Error('Invalid passkey sign in.'), { statusCode: 401 });
      }

      const authenticationOptions = await generateAuthenticationOptions({
        rpID,
        timeout: 60_000,
        userVerification: 'required',
        allowCredentials: credentials.rows.map((credentialRow) => ({
          id: credentialRow.credential_id,
          transports: credentialRow.transports || undefined,
        })),
      });

      await storeWebAuthnChallenge(
        client,
        employee.tenant_id,
        employee.id,
        authenticationOptions.challenge,
        'authentication',
      );

      return authenticationOptions;
    });

    res.json({ success: true, options });
  } catch (error) {
    if (Number((error as { statusCode?: number }).statusCode) === 401) {
      recordFailedLogin(loginRateLimitKey);
    }

    console.error('[Passkeys] Failed to create login options:', error);
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
  const loginRateLimitKey = getLoginRateLimitKey(req, normalizedEmail);
  const rateLimit = checkLoginRateLimit(loginRateLimitKey);

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
      recordFailedLogin(loginRateLimitKey);
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

    clearFailedLogins(loginRateLimitKey);
    res.json({ success: true, user: formatAuthUser(loginUser) });
  } catch (error) {
    recordFailedLogin(loginRateLimitKey);
    console.error('[Passkeys] Failed to verify login:', error);
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
        isProduction() ? null : resetCode,
        expiresAt,
      ],
    );

    if (!isProduction()) {
      console.log('[Password Reset] Dev reset code:', {
        email: normalizedEmail,
        resetCode,
        expiresAt,
      });
    }

    const response: { success: true; message: string } = {
      success: true,
      message: 'If an account exists, password reset instructions have been sent.',
    };

    res.json(response);
  } catch (error) {
    console.error('[Password Reset] Failed to create reset token:', error);

    res.status(500).json({
      success: false,
      error: 'Unable to start recovery flow.',
    });
  }
});

app.get(
  '/api/roles',
  demoAuth,
  requirePermission('roles.manage'),
  async (req, res) => {
    const tenantId = req.authUser!.tenantId;

    if (!hasDatabaseConfig()) {
      return res.status(503).json({ success: false, error: 'DATABASE_URL is required for tenant roles' });
    }

    try {
      const roles = await withTenant(tenantId, async (client) => {
        const result = await client.query(
          `
            SELECT
              tenant_roles.id,
              tenant_roles.name,
              tenant_roles.description,
              tenant_roles.system_key,
              tenant_roles.is_system,
              tenant_roles.is_active,
              tenant_roles.created_at,
              tenant_roles.updated_at,
              COALESCE(
                array_remove(array_agg(DISTINCT tenant_role_permissions.permission_key ORDER BY tenant_role_permissions.permission_key), NULL),
                ARRAY[]::varchar[]
              ) AS permissions,
              COUNT(DISTINCT employee_role_assignments.employee_id)::int AS assigned_employee_count
            FROM tenant_roles
            LEFT JOIN tenant_role_permissions
              ON tenant_role_permissions.tenant_id = tenant_roles.tenant_id
             AND tenant_role_permissions.role_id = tenant_roles.id
            LEFT JOIN employee_role_assignments
              ON employee_role_assignments.tenant_id = tenant_roles.tenant_id
             AND employee_role_assignments.role_id = tenant_roles.id
            WHERE tenant_roles.tenant_id = $1
            GROUP BY tenant_roles.id
            ORDER BY tenant_roles.is_system DESC, tenant_roles.name ASC
          `,
          [tenantId],
        );

        return result.rows;
      });

      res.json({ success: true, roles });
    } catch (error) {
      console.error('[Roles] Failed to load tenant roles:', error);
      res.status(500).json({ success: false, error: 'Unable to load tenant roles' });
    }
  },
);

app.get(
  '/api/permissions',
  demoAuth,
  requirePermission('roles.manage'),
  async (_req, res) => {
    if (!hasDatabaseConfig()) {
      return res.status(503).json({ success: false, error: 'DATABASE_URL is required for permissions' });
    }

    try {
      const result = await getDbPool().query(
        `
          SELECT permission_key, label, description
          FROM tenant_permissions
          ORDER BY permission_key ASC
        `,
      );

      res.json({ success: true, permissions: result.rows });
    } catch (error) {
      console.error('[Roles] Failed to load permissions:', error);
      res.status(500).json({ success: false, error: 'Unable to load permissions' });
    }
  },
);

app.post(
  '/api/roles',
  demoAuth,
  requirePermission('roles.manage'),
  async (req, res) => {
    const tenantId = req.authUser!.tenantId;
    const actorEmployeeId = req.authUser!.employeeId;
    const { name, description, permissionKeys = [] } = req.body as {
      name?: string;
      description?: string;
      permissionKeys?: string[];
    };
    const normalizedName = name?.trim() || '';
    const normalizedDescription = description?.trim() || null;
    const normalizedPermissionKeys = [...new Set(Array.isArray(permissionKeys) ? permissionKeys : [])];

    if (!normalizedName || normalizedName.length > 100) {
      return res.status(400).json({ success: false, error: 'name is required and must be 100 characters or fewer.' });
    }

    if (!hasDatabaseConfig()) {
      return res.status(503).json({ success: false, error: 'DATABASE_URL is required for tenant roles' });
    }

    try {
      const role = await withTenant(tenantId, async (client) => {
        await client.query('BEGIN');
        try {
          const permissionsResult = await client.query<{ permission_key: string }>(
            `
              SELECT permission_key
              FROM tenant_permissions
              WHERE permission_key = ANY($1::varchar[])
            `,
            [normalizedPermissionKeys],
          );
          const validPermissionKeys = permissionsResult.rows.map((row) => row.permission_key);

          if (validPermissionKeys.length !== normalizedPermissionKeys.length) {
            throw Object.assign(new Error('One or more permission keys are invalid.'), { statusCode: 400 });
          }

          const roleResult = await client.query(
            `
              INSERT INTO tenant_roles (tenant_id, name, description, is_system)
              VALUES ($1, $2::varchar, $3::text, false)
              RETURNING id, name, description, system_key, is_system, is_active, created_at, updated_at
            `,
            [tenantId, normalizedName, normalizedDescription],
          );

          const createdRole = roleResult.rows[0];

          if (validPermissionKeys.length > 0) {
            await client.query(
              `
                INSERT INTO tenant_role_permissions (tenant_id, role_id, permission_key)
                SELECT $1, $2, tenant_permissions.permission_key
                FROM tenant_permissions
                WHERE tenant_permissions.permission_key = ANY($3::varchar[])
                ON CONFLICT (tenant_id, role_id, permission_key) DO NOTHING
              `,
              [tenantId, createdRole.id, validPermissionKeys],
            );
          }

          await client.query(
            `
              INSERT INTO audit_logs (tenant_id, actor_employee_id, action, entity_type, entity_id, metadata)
              VALUES ($1, $2, $3, $4, $5, $6::jsonb)
            `,
            [
              tenantId,
              actorEmployeeId,
              'tenant_role_created',
              'tenant_role',
              createdRole.id,
              JSON.stringify({ name: normalizedName, permissionKeys: validPermissionKeys }),
            ],
          );

          await client.query('COMMIT');
          return { ...createdRole, permissions: validPermissionKeys };
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      });

      res.status(201).json({ success: true, role });
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 400) {
        return res.status(400).json({ success: false, error: (error as Error).message });
      }
      if ((error as { code?: string }).code === '23505') {
        return res.status(409).json({ success: false, error: 'A role with this name already exists.' });
      }

      console.error('[Roles] Failed to create role:', error);
      res.status(500).json({ success: false, error: 'Unable to create role' });
    }
  },
);

app.put(
  '/api/roles/:id/permissions',
  demoAuth,
  requirePermission('roles.manage'),
  async (req, res) => {
    const tenantId = req.authUser!.tenantId;
    const actorEmployeeId = req.authUser!.employeeId;
    const { id } = req.params;
    const { permissionKeys = [] } = req.body as { permissionKeys?: string[] };
    const normalizedPermissionKeys = [...new Set(Array.isArray(permissionKeys) ? permissionKeys : [])];

    if (!hasDatabaseConfig()) {
      return res.status(503).json({ success: false, error: 'DATABASE_URL is required for tenant roles' });
    }

    try {
      const role = await withTenant(tenantId, async (client) => {
        await client.query('BEGIN');
        try {
          const roleResult = await client.query<{ id: string; name: string; is_system: boolean }>(
            `
              SELECT id, name, is_system
              FROM tenant_roles
              WHERE tenant_id = $1
                AND id = $2
              LIMIT 1
            `,
            [tenantId, id],
          );
          const tenantRole = roleResult.rows[0];
          if (!tenantRole) return null;
          if (tenantRole.is_system) {
            throw Object.assign(new Error('System roles cannot be edited in this foundation version.'), { statusCode: 400 });
          }

          const permissionsResult = await client.query<{ permission_key: string }>(
            `
              SELECT permission_key
              FROM tenant_permissions
              WHERE permission_key = ANY($1::varchar[])
            `,
            [normalizedPermissionKeys],
          );
          const validPermissionKeys = permissionsResult.rows.map((row) => row.permission_key);
          if (validPermissionKeys.length !== normalizedPermissionKeys.length) {
            throw Object.assign(new Error('One or more permission keys are invalid.'), { statusCode: 400 });
          }

          await client.query(
            `
              DELETE FROM tenant_role_permissions
              WHERE tenant_id = $1
                AND role_id = $2
            `,
            [tenantId, id],
          );

          if (validPermissionKeys.length > 0) {
            await client.query(
              `
                INSERT INTO tenant_role_permissions (tenant_id, role_id, permission_key)
                SELECT $1, $2, tenant_permissions.permission_key
                FROM tenant_permissions
                WHERE tenant_permissions.permission_key = ANY($3::varchar[])
              `,
              [tenantId, id, validPermissionKeys],
            );
          }

          await client.query(
            `
              INSERT INTO audit_logs (tenant_id, actor_employee_id, action, entity_type, entity_id, metadata)
              VALUES ($1, $2, $3, $4, $5, $6::jsonb)
            `,
            [
              tenantId,
              actorEmployeeId,
              'tenant_role_permissions_updated',
              'tenant_role',
              id,
              JSON.stringify({ permissionKeys: validPermissionKeys }),
            ],
          );

          await client.query('COMMIT');
          return { ...tenantRole, permissions: validPermissionKeys };
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      });

      if (!role) {
        return res.status(404).json({ success: false, error: 'Tenant role not found.' });
      }

      res.json({ success: true, role });
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 400) {
        return res.status(400).json({ success: false, error: (error as Error).message });
      }

      console.error('[Roles] Failed to update role permissions:', error);
      res.status(500).json({ success: false, error: 'Unable to update role permissions' });
    }
  },
);

app.get(
  '/api/employees/role-assignments',
  demoAuth,
  requirePermission('roles.manage'),
  async (req, res) => {
    const tenantId = req.authUser!.tenantId;

    if (!hasDatabaseConfig()) {
      return res.status(503).json({ success: false, error: 'DATABASE_URL is required for role assignments' });
    }

    try {
      const employees = await withTenant(tenantId, async (client) => {
        const result = await client.query(
          `
            SELECT
              employees.id,
              employees.email,
              employees.full_name,
              employees.role,
              employees.job_title,
              COALESCE(
                json_agg(
                  DISTINCT jsonb_build_object(
                    'id', tenant_roles.id,
                    'name', tenant_roles.name,
                    'systemKey', tenant_roles.system_key
                  )
                ) FILTER (WHERE tenant_roles.id IS NOT NULL),
                '[]'::json
              ) AS assigned_roles
            FROM employees
            LEFT JOIN employee_role_assignments
              ON employee_role_assignments.tenant_id = employees.tenant_id
             AND employee_role_assignments.employee_id = employees.id
            LEFT JOIN tenant_roles
              ON tenant_roles.tenant_id = employees.tenant_id
             AND tenant_roles.id = employee_role_assignments.role_id
            WHERE employees.tenant_id = $1
            GROUP BY employees.id
            ORDER BY employees.full_name ASC, employees.email ASC
          `,
          [tenantId],
        );

        return result.rows;
      });

      res.json({ success: true, employees });
    } catch (error) {
      console.error('[Roles] Failed to load role assignments:', error);
      res.status(500).json({ success: false, error: 'Unable to load role assignments' });
    }
  },
);

app.post(
  '/api/employees/:employeeId/roles',
  demoAuth,
  requirePermission('roles.manage'),
  async (req, res) => {
    const tenantId = req.authUser!.tenantId;
    const actorEmployeeId = req.authUser!.employeeId;
    const { employeeId } = req.params;
    const { roleId } = req.body as { roleId?: string };

    if (!roleId) {
      return res.status(400).json({ success: false, error: 'roleId is required.' });
    }

    if (!hasDatabaseConfig()) {
      return res.status(503).json({ success: false, error: 'DATABASE_URL is required for role assignments' });
    }

    try {
      const assignment = await withTenant(tenantId, async (client) => {
        const employeeResult = await client.query<{ id: string }>(
          `
            SELECT id
            FROM employees
            WHERE tenant_id = $1
              AND id = $2
            LIMIT 1
          `,
          [tenantId, employeeId],
        );
        if (!employeeResult.rows[0]) return null;

        const roleResult = await client.query<{ id: string; name: string }>(
          `
            SELECT id, name
            FROM tenant_roles
            WHERE tenant_id = $1
              AND id = $2
              AND is_active = true
            LIMIT 1
          `,
          [tenantId, roleId],
        );
        const tenantRole = roleResult.rows[0];
        if (!tenantRole) {
          throw Object.assign(new Error('Tenant role not found.'), { statusCode: 400 });
        }

        const insertResult = await client.query(
          `
            INSERT INTO employee_role_assignments (tenant_id, employee_id, role_id, assigned_by)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (tenant_id, employee_id, role_id)
            DO UPDATE SET
              assigned_by = EXCLUDED.assigned_by,
              assigned_at = NOW()
            RETURNING id, employee_id, role_id, assigned_at
          `,
          [tenantId, employeeId, roleId, actorEmployeeId],
        );

        await client.query(
          `
            INSERT INTO audit_logs (tenant_id, actor_employee_id, action, entity_type, entity_id, metadata)
            VALUES ($1, $2, $3, $4, $5, $6::jsonb)
          `,
          [
            tenantId,
            actorEmployeeId,
            'employee_role_assigned',
            'employee',
            employeeId,
            JSON.stringify({ roleId, roleName: tenantRole.name }),
          ],
        );

        return insertResult.rows[0];
      });

      if (!assignment) {
        return res.status(404).json({ success: false, error: 'Employee not found.' });
      }

      res.json({ success: true, assignment });
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 400) {
        return res.status(400).json({ success: false, error: (error as Error).message });
      }

      console.error('[Roles] Failed to assign role:', error);
      res.status(500).json({ success: false, error: 'Unable to assign role' });
    }
  },
);

app.delete(
  '/api/employees/:employeeId/roles/:roleId',
  demoAuth,
  requirePermission('roles.manage'),
  async (req, res) => {
    const tenantId = req.authUser!.tenantId;
    const actorEmployeeId = req.authUser!.employeeId;
    const { employeeId, roleId } = req.params;

    if (!hasDatabaseConfig()) {
      return res.status(503).json({ success: false, error: 'DATABASE_URL is required for role assignments' });
    }

    try {
      const removed = await withTenant(tenantId, async (client) => {
        const countResult = await client.query<{ assignment_count: string; fallback_role: EmployeeRole | null }>(
          `
            SELECT
              COUNT(employee_role_assignments.id) AS assignment_count,
              employees.role AS fallback_role
            FROM employees
            LEFT JOIN employee_role_assignments
              ON employee_role_assignments.tenant_id = employees.tenant_id
             AND employee_role_assignments.employee_id = employees.id
            WHERE employees.tenant_id = $1
              AND employees.id = $2
            GROUP BY employees.id
          `,
          [tenantId, employeeId],
        );
        const assignmentState = countResult.rows[0];
        if (!assignmentState) return null;

        if (Number(assignmentState.assignment_count) <= 1 && !assignmentState.fallback_role) {
          throw Object.assign(new Error('Cannot remove the final role assignment for this employee.'), { statusCode: 400 });
        }

        const deleteResult = await client.query<{ id: string }>(
          `
            DELETE FROM employee_role_assignments
            WHERE tenant_id = $1
              AND employee_id = $2
              AND role_id = $3
            RETURNING id
          `,
          [tenantId, employeeId, roleId],
        );

        if (!deleteResult.rows[0]) return null;

        await client.query(
          `
            INSERT INTO audit_logs (tenant_id, actor_employee_id, action, entity_type, entity_id, metadata)
            VALUES ($1, $2, $3, $4, $5, $6::jsonb)
          `,
          [
            tenantId,
            actorEmployeeId,
            'employee_role_removed',
            'employee',
            employeeId,
            JSON.stringify({ roleId }),
          ],
        );

        return deleteResult.rows[0];
      });

      if (!removed) {
        return res.status(404).json({ success: false, error: 'Role assignment not found.' });
      }

      res.json({ success: true, removed });
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 400) {
        return res.status(400).json({ success: false, error: (error as Error).message });
      }

      console.error('[Roles] Failed to remove role:', error);
      res.status(500).json({ success: false, error: 'Unable to remove role' });
    }
  },
);

app.patch(
  '/api/employees/:employeeId/title',
  demoAuth,
  requirePermission('roles.manage'),
  async (req, res) => {
    const tenantId = req.authUser!.tenantId;
    const actorEmployeeId = req.authUser!.employeeId;
    const { employeeId } = req.params;
    const { jobTitle } = req.body as { jobTitle?: string | null };
    const normalizedJobTitle = jobTitle?.trim() || null;

    if (normalizedJobTitle && normalizedJobTitle.length > 120) {
      return res.status(400).json({ success: false, error: 'jobTitle must be 120 characters or fewer.' });
    }

    if (!hasDatabaseConfig()) {
      return res.status(503).json({ success: false, error: 'DATABASE_URL is required for employees' });
    }

    try {
      const employee = await withTenant(tenantId, async (client) => {
        const updateResult = await client.query(
          `
            UPDATE employees
            SET job_title = $3::varchar,
                updated_at = NOW()
            WHERE tenant_id = $1
              AND id = $2
            RETURNING id, email, full_name, role, job_title
          `,
          [tenantId, employeeId, normalizedJobTitle],
        );

        const updatedEmployee = updateResult.rows[0];
        if (!updatedEmployee) return null;

        await client.query(
          `
            INSERT INTO audit_logs (tenant_id, actor_employee_id, action, entity_type, entity_id, metadata)
            VALUES ($1, $2, $3, $4, $5, $6::jsonb)
          `,
          [
            tenantId,
            actorEmployeeId,
            'employee_title_updated',
            'employee',
            employeeId,
            JSON.stringify({ jobTitle: normalizedJobTitle }),
          ],
        );

        return updatedEmployee;
      });

      if (!employee) {
        return res.status(404).json({ success: false, error: 'Employee not found.' });
      }

      res.json({ success: true, employee });
    } catch (error) {
      console.error('[Roles] Failed to update employee title:', error);
      res.status(500).json({ success: false, error: 'Unable to update employee title' });
    }
  },
);

app.get(
  '/api/notification-settings/me',
  demoAuth,
  requireRole(['employee', 'manager', 'hr_admin']),
  async (req, res) => {
    const tenantId = req.authUser!.tenantId;
    const employeeId = req.authUser!.employeeId;

    if (!hasDatabaseConfig()) {
      return res.status(503).json({ success: false, error: 'DATABASE_URL is required for notification settings' });
    }

    try {
      const settings = await withTenant(tenantId, async (client) => {
        const result = await client.query<{
          channel: NotificationChannel;
          notification_key: NotificationKey;
          enabled: boolean;
          quiet_hours_start: string | null;
          quiet_hours_end: string | null;
        }>(
          `
            SELECT
              channel,
              notification_key,
              enabled,
              quiet_hours_start,
              quiet_hours_end
            FROM user_notification_settings
            WHERE tenant_id = $1
              AND employee_id = $2
            ORDER BY notification_key ASC, channel ASC
          `,
          [tenantId, employeeId],
        );

        return mergeNotificationSettings(result.rows);
      });

      res.json({ success: true, settings });
    } catch (error) {
      console.error('[Notifications] Failed to load settings:', error);
      res.status(500).json({ success: false, error: 'Unable to load notification settings' });
    }
  },
);

app.put(
  '/api/notification-settings/me',
  demoAuth,
  requireRole(['employee', 'manager', 'hr_admin']),
  async (req, res) => {
    const tenantId = req.authUser!.tenantId;
    const employeeId = req.authUser!.employeeId;
    const { settings } = req.body as UpdateNotificationSettingsBody;

    if (!Array.isArray(settings)) {
      return res.status(400).json({ success: false, error: 'settings must be an array.' });
    }

    if (!hasDatabaseConfig()) {
      return res.status(503).json({ success: false, error: 'DATABASE_URL is required for notification settings' });
    }

    const normalizedSettings: Array<{
      channel: NotificationChannel;
      notificationKey: NotificationKey;
      enabled: boolean;
      quietHoursStart: string | null;
      quietHoursEnd: string | null;
    }> = [];

    for (const setting of settings) {
      if (!isNotificationChannel(setting.channel)) {
        return res.status(400).json({ success: false, error: 'channel must be in_app, email, or push.' });
      }

      if (!isNotificationKey(setting.notificationKey)) {
        return res.status(400).json({ success: false, error: 'notificationKey is invalid.' });
      }

      if (typeof setting.enabled !== 'boolean') {
        return res.status(400).json({ success: false, error: 'enabled must be a boolean.' });
      }

      if (!isValidQuietHour(setting.quietHoursStart) || !isValidQuietHour(setting.quietHoursEnd)) {
        return res.status(400).json({ success: false, error: 'quiet hours must use HH:MM format.' });
      }

      normalizedSettings.push({
        channel: setting.channel,
        notificationKey: setting.notificationKey,
        enabled: setting.enabled,
        quietHoursStart: setting.quietHoursStart || null,
        quietHoursEnd: setting.quietHoursEnd || null,
      });
    }

    try {
      const savedSettings = await withTenant(tenantId, async (client) => {
        await client.query('BEGIN');

        try {
          for (const setting of normalizedSettings) {
            await client.query(
              `
                INSERT INTO user_notification_settings (
                  tenant_id,
                  employee_id,
                  channel,
                  notification_key,
                  enabled,
                  quiet_hours_start,
                  quiet_hours_end
                )
                VALUES ($1, $2, $3::varchar, $4::varchar, $5::boolean, $6::time, $7::time)
                ON CONFLICT (tenant_id, employee_id, channel, notification_key)
                DO UPDATE SET
                  enabled = EXCLUDED.enabled,
                  quiet_hours_start = EXCLUDED.quiet_hours_start,
                  quiet_hours_end = EXCLUDED.quiet_hours_end,
                  updated_at = NOW()
              `,
              [
                tenantId,
                employeeId,
                setting.channel,
                setting.notificationKey,
                setting.enabled,
                setting.quietHoursStart,
                setting.quietHoursEnd,
              ],
            );
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
              tenantId,
              employeeId,
              'notification_settings_updated',
              'notification_settings',
              employeeId,
              JSON.stringify({ updatedSettingCount: normalizedSettings.length }),
            ],
          );

          const result = await client.query<{
            channel: NotificationChannel;
            notification_key: NotificationKey;
            enabled: boolean;
            quiet_hours_start: string | null;
            quiet_hours_end: string | null;
          }>(
            `
              SELECT
                channel,
                notification_key,
                enabled,
                quiet_hours_start,
                quiet_hours_end
              FROM user_notification_settings
              WHERE tenant_id = $1
                AND employee_id = $2
              ORDER BY notification_key ASC, channel ASC
            `,
            [tenantId, employeeId],
          );

          await client.query('COMMIT');
          return mergeNotificationSettings(result.rows);
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      });

      res.json({ success: true, settings: savedSettings });
    } catch (error) {
      console.error('[Notifications] Failed to save settings:', error);
      res.status(500).json({ success: false, error: 'Unable to save notification settings' });
    }
  },
);

app.post('/api/auth/reset-password', passwordResetConfirmRateLimiter, async (req, res) => {
  const { email, resetCode, newPassword } = req.body as {
    email?: string;
    resetCode?: string;
    newPassword?: string;
  };

  const normalizedResetEmail = validateEmail(email);
  const newPasswordStrength = validatePasswordStrength(newPassword);

  if (!normalizedResetEmail.valid || !resetCode || !newPassword) {
    return res.status(400).json({
      success: false,
      error: !normalizedResetEmail.valid
        ? normalizedResetEmail.error
        : 'Reset code and new password are required.',
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

  const normalizedEmail = normalizedResetEmail.value;
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

        return res.json({
          success: true,
          timeLogId: timeLog.id,
          clockedIn: timeLog.clock_in_time,
          locationValid: isWithinGeofence,
          isValidGeofence: isWithinGeofence,
          matchedLocation,
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
      isValidGeofence: isWithinGeofence,
      message: isWithinGeofence ? 'Clock-in secured.' : 'Warning: Clock-in recorded outside geofenced perimeter.'
    });
  });

app.get(
  '/api/company-locations',
  demoAuth,
  requireRole(['employee', 'manager', 'hr_admin']),
  async (req, res) => {
    const tenantId = req.authUser!.tenantId;

    if (!hasDatabaseConfig()) {
      return res.status(503).json({ success: false, error: 'DATABASE_URL is required for company locations' });
    }

    try {
      const locations = await withTenant(tenantId, async (client) => {
        const result = await client.query(
          `
            SELECT
              id,
              name,
              location_type,
              address,
              latitude,
              longitude,
              radius_meters,
              is_primary,
              is_active,
              created_at,
              updated_at
            FROM company_locations
            WHERE tenant_id = $1
              AND is_active = true
            ORDER BY is_primary DESC, created_at DESC
          `,
          [tenantId],
        );

        return result.rows;
      });

      res.json({ success: true, locations });
    } catch (error) {
      console.error('[Company Locations] Failed to load locations:', error);
      res.status(500).json({ success: false, error: 'Unable to load company locations' });
    }
  },
);

app.post(
  '/api/company-locations',
  demoAuth,
  requireRole(['hr_admin']),
  async (req, res) => {
    const tenantId = req.authUser!.tenantId;
    const actorEmployeeId = req.authUser!.employeeId;
    const normalized = normalizeCompanyLocations([req.body as CompanyLocationInput]);

    if (!normalized.ok) {
      return res.status(400).json({ success: false, error: normalized.error });
    }

    if (!hasDatabaseConfig()) {
      return res.status(503).json({ success: false, error: 'DATABASE_URL is required for company locations' });
    }

    const location = normalized.locations[0];

    try {
      const createdLocation = await withTenant(tenantId, async (client) => {
        if (location.isPrimary) {
          await client.query(
            `
              UPDATE company_locations
              SET is_primary = false, updated_at = NOW()
              WHERE tenant_id = $1
            `,
            [tenantId],
          );
        }

        const result = await client.query(
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
              $5,
              $6,
              $7,
              ST_Buffer(
                ST_SetSRID(ST_MakePoint($6, $5), 4326)::geography,
                $7
              )::geometry,
              $8,
              $9
            )
            RETURNING
              id,
              name,
              location_type,
              address,
              latitude,
              longitude,
              radius_meters,
              is_primary,
              is_active,
              created_at,
              updated_at
          `,
          [
            tenantId,
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

        const created = result.rows[0];

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
            'company_location_created',
            'company_location',
            created.id,
            JSON.stringify({
              name: location.name,
              locationType: location.locationType,
              radius: location.radiusMeters,
              isPrimary: location.isPrimary,
            }),
          ],
        );

        return created;
      });

      res.status(201).json({ success: true, location: createdLocation });
    } catch (error) {
      console.error('[Company Locations] Failed to create location:', error);
      res.status(500).json({ success: false, error: 'Unable to create company location' });
    }
  },
);

app.patch(
  '/api/company-locations/:id',
  demoAuth,
  requireRole(['hr_admin']),
  async (req, res) => {
    const { id } = req.params;
    const tenantId = req.authUser!.tenantId;
    const actorEmployeeId = req.authUser!.employeeId;

    if (!hasDatabaseConfig()) {
      return res.status(503).json({ success: false, error: 'DATABASE_URL is required for company locations' });
    }

    try {
      const updatedLocation = await withTenant(tenantId, async (client) => {
        const existingResult = await client.query<{
          name: string;
          location_type: CompanyLocationType;
          address: string | null;
          latitude: string;
          longitude: string;
          radius_meters: number;
          is_primary: boolean;
          is_active: boolean;
        }>(
          `
            SELECT name, location_type, address, latitude, longitude, radius_meters, is_primary, is_active
            FROM company_locations
            WHERE tenant_id = $1
              AND id = $2
            LIMIT 1
            FOR UPDATE
          `,
          [tenantId, id],
        );

        if (existingResult.rowCount === 0) {
          throw Object.assign(new Error('Company location not found.'), { statusCode: 404 });
        }

        const existing = existingResult.rows[0];
        const body = req.body as CompanyLocationInput;
        const normalized = normalizeCompanyLocations([
          {
            name: body.name ?? existing.name,
            locationType: body.locationType ?? existing.location_type,
            address: body.address ?? existing.address ?? undefined,
            lat: body.lat ?? existing.latitude,
            lng: body.lng ?? existing.longitude,
            radius: body.radius ?? existing.radius_meters,
            isPrimary: body.isPrimary ?? existing.is_primary,
            isActive: body.isActive ?? existing.is_active,
          },
        ]);

        if (!normalized.ok) {
          throw Object.assign(new Error(normalized.error), { statusCode: 400 });
        }

        const location = normalized.locations[0];

        if (location.isPrimary) {
          await client.query(
            `
              UPDATE company_locations
              SET is_primary = false, updated_at = NOW()
              WHERE tenant_id = $1
                AND id <> $2
            `,
            [tenantId, id],
          );
        }

        const result = await client.query(
          `
            UPDATE company_locations
            SET
              name = $3,
              location_type = $4,
              address = $5,
              latitude = $6,
              longitude = $7,
              radius_meters = $8,
              boundary = ST_Buffer(
                ST_SetSRID(ST_MakePoint($7, $6), 4326)::geography,
                $8
              )::geometry,
              is_primary = $9,
              is_active = $10,
              updated_at = NOW()
            WHERE tenant_id = $1
              AND id = $2
            RETURNING
              id,
              name,
              location_type,
              address,
              latitude,
              longitude,
              radius_meters,
              is_primary,
              is_active,
              created_at,
              updated_at
          `,
          [
            tenantId,
            id,
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

        const updated = result.rows[0];

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
            'company_location_updated',
            'company_location',
            id,
            JSON.stringify({
              name: location.name,
              locationType: location.locationType,
              radius: location.radiusMeters,
              isPrimary: location.isPrimary,
              isActive: location.isActive,
            }),
          ],
        );

        return updated;
      });

      res.json({ success: true, location: updatedLocation });
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;

      if (statusCode === 400 || statusCode === 404) {
        return res.status(statusCode).json({
          success: false,
          error: (error as Error).message,
        });
      }

      console.error('[Company Locations] Failed to update location:', error);
      res.status(500).json({ success: false, error: 'Unable to update company location' });
    }
  },
);

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
    res.status(500).json({ success: false, error: 'Unable to load clock status.' });
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

    console.warn('[Clock-Out] Falling back to demo attendance store.');
    const demoClockOut = recordDemoClockOut(tenantId, employeeId);
    res.status(demoClockOut.status).json(demoClockOut.body);
  }
});

app.post(
  '/api/break-requests',
  demoAuth,
  requirePermission('break_requests.create'),
  async (req, res) => {
    const tenantId = req.authUser!.tenantId;
    const employeeId = req.authUser!.employeeId;
    const { requestedStartTime, durationMinutes, reason } = req.body as CreateBreakRequestBody;

    const normalizedDuration = typeof durationMinutes === 'string'
      ? Number(durationMinutes)
      : durationMinutes;
    const normalizedReason = typeof reason === 'string' ? reason.trim().slice(0, 500) : null;
    const normalizedStartTime = normalizeOptionalTimestamp(requestedStartTime);

    if (!Number.isInteger(normalizedDuration) || normalizedDuration < 5 || normalizedDuration > 180) {
      return res.status(400).json({ success: false, error: 'durationMinutes must be a whole number between 5 and 180.' });
    }

    if (normalizedStartTime === undefined) {
      return res.status(400).json({ success: false, error: 'requestedStartTime must be a valid date/time if provided.' });
    }

    if (!hasDatabaseConfig()) {
      return res.status(503).json({ success: false, error: 'DATABASE_URL is required for break requests' });
    }

    try {
      const breakRequest = await withTenant(tenantId, async (client) => {
        await client.query('BEGIN');

        try {
          const existing = await client.query<{ id: string }>(
            `
              SELECT id
              FROM break_requests
              WHERE tenant_id = $1
                AND employee_id = $2
                AND status = 'pending'
              LIMIT 1
            `,
            [tenantId, employeeId],
          );

          if (existing.rows[0]) {
            await client.query('ROLLBACK');
            return { duplicatePending: true as const };
          }

          const result = await client.query<{
            id: string;
            employee_id: string;
            requested_start_time: string | null;
            requested_end_time: string | null;
            duration_minutes: number;
            reason: string | null;
            status: BreakRequestStatus;
            created_at: string;
          }>(
            `
              INSERT INTO break_requests (
                tenant_id,
                employee_id,
                requested_start_time,
                requested_end_time,
                duration_minutes,
                reason
              )
              VALUES (
                $1,
                $2,
                $3::timestamptz,
                CASE
                  WHEN $3::timestamptz IS NULL THEN NULL
                  ELSE $3::timestamptz + ($4::int * INTERVAL '1 minute')
                END,
                $4::int,
                $5::text
              )
              RETURNING
                id,
                employee_id,
                requested_start_time,
                requested_end_time,
                duration_minutes,
                reason,
                status,
                created_at
            `,
            [tenantId, employeeId, normalizedStartTime, normalizedDuration, normalizedReason],
          );

          const requestRow = result.rows[0];

          const recipients = await client.query<{ id: string }>(
            `
              WITH requester AS (
                SELECT manager_id
                FROM employees
                WHERE tenant_id = $1
                  AND id = $2
              ),
              candidate_recipients AS (
                SELECT manager_id AS id
                FROM requester
                WHERE manager_id IS NOT NULL

                UNION

                SELECT employees.id
                FROM employees
                WHERE employees.tenant_id = $1
                  AND employees.role IN ('manager', 'hr_admin')
                  AND NOT EXISTS (SELECT 1 FROM requester WHERE manager_id IS NOT NULL)
              )
              SELECT candidate_recipients.id
              FROM candidate_recipients
              LEFT JOIN user_notification_settings
                ON user_notification_settings.tenant_id = $1
               AND user_notification_settings.employee_id = candidate_recipients.id
               AND user_notification_settings.channel = 'in_app'
               AND user_notification_settings.notification_key = 'break_request_pending'
              WHERE COALESCE(user_notification_settings.enabled, true)
            `,
            [tenantId, employeeId],
          );

          if (recipients.rows.length > 0) {
            await client.query(
              `
                INSERT INTO outbox_events (tenant_id, event_type, payload)
                VALUES ($1, $2::varchar, $3::jsonb)
              `,
              [
                tenantId,
                'notification.break_request_pending',
                JSON.stringify({
                  notificationKey: 'break_request_pending',
                  breakRequestId: requestRow.id,
                  employeeId,
                  recipientEmployeeIds: recipients.rows.map((row) => row.id),
                  title: 'Break request pending',
                  body: `A ${normalizedDuration}-minute break request is waiting for review.`,
                }),
              ],
            );
          }

          await client.query(
            `
              INSERT INTO audit_logs (tenant_id, actor_employee_id, action, entity_type, entity_id, metadata)
              VALUES ($1, $2, $3::varchar, $4::varchar, $5, $6::jsonb)
            `,
            [
              tenantId,
              employeeId,
              'break_request.created',
              'break_request',
              requestRow.id,
              JSON.stringify({ durationMinutes: normalizedDuration, requestedStartTime: normalizedStartTime, reason: normalizedReason }),
            ],
          );

          await client.query('COMMIT');
          return requestRow;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      });

      if ('duplicatePending' in breakRequest) {
        return res.status(409).json({ success: false, error: 'You already have a pending break request.' });
      }

      res.status(201).json({ success: true, breakRequest });
    } catch (error) {
      console.error('[Break Requests] Failed to create break request:', error);
      res.status(500).json({ success: false, error: 'Unable to create break request' });
    }
  },
);

app.get(
  '/api/break-requests/me',
  demoAuth,
  requirePermission('break_requests.view_own'),
  async (req, res) => {
    const tenantId = req.authUser!.tenantId;
    const employeeId = req.authUser!.employeeId;

    if (!hasDatabaseConfig()) {
      return res.status(503).json({ success: false, error: 'DATABASE_URL is required for break requests' });
    }

    try {
      const breakRequests = await withTenant(tenantId, async (client) => {
        const result = await client.query(
          `
            SELECT
              break_requests.*,
              reviewer.full_name AS reviewer_name
            FROM break_requests
            LEFT JOIN employees reviewer
              ON reviewer.tenant_id = break_requests.tenant_id
             AND reviewer.id = break_requests.reviewed_by
            WHERE break_requests.tenant_id = $1
              AND break_requests.employee_id = $2
            ORDER BY break_requests.created_at DESC
            LIMIT 25
          `,
          [tenantId, employeeId],
        );

        return result.rows;
      });

      res.json({ success: true, breakRequests });
    } catch (error) {
      console.error('[Break Requests] Failed to load own break requests:', error);
      res.status(500).json({ success: false, error: 'Unable to load break requests' });
    }
  },
);

app.get(
  '/api/break-requests/pending',
  demoAuth,
  requirePermission('break_requests.view_all'),
  async (req, res) => {
    const tenantId = req.authUser!.tenantId;

    if (!hasDatabaseConfig()) {
      return res.status(503).json({ success: false, error: 'DATABASE_URL is required for break requests' });
    }

    try {
      const breakRequests = await withTenant(tenantId, async (client) => {
        const result = await client.query(
          `
            SELECT
              break_requests.*,
              employees.full_name,
              employees.email,
              employees.role
            FROM break_requests
            INNER JOIN employees
              ON employees.tenant_id = break_requests.tenant_id
             AND employees.id = break_requests.employee_id
            WHERE break_requests.tenant_id = $1
              AND break_requests.status = 'pending'
            ORDER BY break_requests.created_at ASC
          `,
          [tenantId],
        );

        return result.rows;
      });

      res.json({ success: true, breakRequests });
    } catch (error) {
      console.error('[Break Requests] Failed to load pending break requests:', error);
      res.status(500).json({ success: false, error: 'Unable to load pending break requests' });
    }
  },
);

app.patch(
  '/api/break-requests/:id/review',
  demoAuth,
  requirePermission('break_requests.review'),
  async (req, res) => {
    const { id } = req.params;
    const tenantId = req.authUser!.tenantId;
    const reviewerId = req.authUser!.employeeId;
    const { status, reviewNote } = req.body as ReviewBreakRequestBody;
    const normalizedNote = typeof reviewNote === 'string' ? reviewNote.trim().slice(0, 500) : null;

    if (!isUuid(id)) {
      return res.status(400).json({ success: false, error: 'Break request id is invalid.' });
    }

    if (status !== 'approved' && status !== 'rejected') {
      return res.status(400).json({ success: false, error: 'status must be approved or rejected.' });
    }

    if (!hasDatabaseConfig()) {
      return res.status(503).json({ success: false, error: 'DATABASE_URL is required for break requests' });
    }

    try {
      const breakRequest = await withTenant(tenantId, async (client) => {
        await client.query('BEGIN');

        try {
          const result = await client.query<{
            id: string;
            employee_id: string;
            status: BreakRequestStatus;
            duration_minutes: number;
            reviewed_at: string;
          }>(
            `
              UPDATE break_requests
              SET
                status = $3::varchar,
                reviewed_by = $2,
                reviewed_at = NOW(),
                review_note = $4::text,
                updated_at = NOW()
              WHERE tenant_id = $1
                AND id = $5
                AND status = 'pending'
              RETURNING id, employee_id, status, duration_minutes, reviewed_at
            `,
            [tenantId, reviewerId, status, normalizedNote, id],
          );

          const requestRow = result.rows[0];
          if (!requestRow) {
            await client.query('ROLLBACK');
            return null;
          }

          const notificationSetting = await client.query<{ enabled: boolean }>(
            `
              SELECT enabled
              FROM user_notification_settings
              WHERE tenant_id = $1
                AND employee_id = $2
                AND channel = 'in_app'
                AND notification_key = 'break_request_reviewed'
              LIMIT 1
            `,
            [tenantId, requestRow.employee_id],
          );

          if (notificationSetting.rows[0]?.enabled !== false) {
            await client.query(
              `
                INSERT INTO outbox_events (tenant_id, event_type, payload)
                VALUES ($1, $2::varchar, $3::jsonb)
              `,
              [
                tenantId,
                'notification.break_request_reviewed',
                JSON.stringify({
                  notificationKey: 'break_request_reviewed',
                  breakRequestId: requestRow.id,
                  recipientEmployeeIds: [requestRow.employee_id],
                  title: status === 'approved' ? 'Break approved' : 'Break rejected',
                  body: `Your ${requestRow.duration_minutes}-minute break request was ${status}.`,
                }),
              ],
            );
          }

          await client.query(
            `
              INSERT INTO audit_logs (tenant_id, actor_employee_id, action, entity_type, entity_id, metadata)
              VALUES ($1, $2, $3::varchar, $4::varchar, $5, $6::jsonb)
            `,
            [
              tenantId,
              reviewerId,
              status === 'approved' ? 'break_request.approved' : 'break_request.rejected',
              'break_request',
              requestRow.id,
              JSON.stringify({ employeeId: requestRow.employee_id, status, reviewNote: normalizedNote }),
            ],
          );

          await client.query('COMMIT');
          return requestRow;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      });

      if (!breakRequest) {
        return res.status(404).json({ success: false, error: 'Pending break request not found.' });
      }

      res.json({ success: true, breakRequest });
    } catch (error) {
      console.error('[Break Requests] Failed to review break request:', error);
      res.status(500).json({ success: false, error: 'Unable to review break request' });
    }
  },
);

app.patch(
  '/api/break-requests/:id/cancel',
  demoAuth,
  requirePermission('break_requests.view_own'),
  async (req, res) => {
    const { id } = req.params;
    const tenantId = req.authUser!.tenantId;
    const employeeId = req.authUser!.employeeId;

    if (!isUuid(id)) {
      return res.status(400).json({ success: false, error: 'Break request id is invalid.' });
    }

    if (!hasDatabaseConfig()) {
      return res.status(503).json({ success: false, error: 'DATABASE_URL is required for break requests' });
    }

    try {
      const breakRequest = await withTenant(tenantId, async (client) => {
        await client.query('BEGIN');

        try {
          const result = await client.query<{ id: string; status: BreakRequestStatus }>(
            `
              UPDATE break_requests
              SET status = 'cancelled', updated_at = NOW()
              WHERE tenant_id = $1
                AND id = $2
                AND employee_id = $3
                AND status = 'pending'
              RETURNING id, status
            `,
            [tenantId, id, employeeId],
          );

          const requestRow = result.rows[0];
          if (!requestRow) {
            await client.query('ROLLBACK');
            return null;
          }

          await client.query(
            `
              INSERT INTO audit_logs (tenant_id, actor_employee_id, action, entity_type, entity_id, metadata)
              VALUES ($1, $2, $3::varchar, $4::varchar, $5, $6::jsonb)
            `,
            [
              tenantId,
              employeeId,
              'break_request.cancelled',
              'break_request',
              requestRow.id,
              JSON.stringify({ status: requestRow.status }),
            ],
          );

          await client.query('COMMIT');
          return requestRow;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      });

      if (!breakRequest) {
        return res.status(404).json({ success: false, error: 'Pending break request not found.' });
      }

      res.json({ success: true, breakRequest });
    } catch (error) {
      console.error('[Break Requests] Failed to cancel break request:', error);
      res.status(500).json({ success: false, error: 'Unable to cancel break request' });
    }
  },
);

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
  '/api/compensation-profiles',
  demoAuth,
  requirePermission('compensation.manage'),
  async (req, res) => {
    const tenantId = req.authUser!.tenantId;

    if (!hasDatabaseConfig()) {
      return res.status(503).json({ success: false, error: 'DATABASE_URL is required for compensation profiles' });
    }

    try {
      const profiles = await withTenant(tenantId, async (client) => {
        const result = await client.query(
          `
            SELECT
              employee_compensation_profiles.id,
              employees.id AS employee_id,
              employees.full_name,
              employees.email,
              employees.role,
              employee_compensation_profiles.pay_type,
              employee_compensation_profiles.base_amount,
              employee_compensation_profiles.currency,
              employee_compensation_profiles.effective_from,
              employee_compensation_profiles.effective_to,
              employee_compensation_profiles.is_active,
              employee_compensation_profiles.created_by,
              employee_compensation_profiles.updated_by,
              employee_compensation_profiles.created_at,
              employee_compensation_profiles.updated_at
            FROM employees
            LEFT JOIN LATERAL (
              SELECT *
              FROM employee_compensation_profiles
              WHERE employee_compensation_profiles.tenant_id = employees.tenant_id
                AND employee_compensation_profiles.employee_id = employees.id
                AND employee_compensation_profiles.is_active = true
              ORDER BY employee_compensation_profiles.effective_from DESC, employee_compensation_profiles.created_at DESC
              LIMIT 1
            ) employee_compensation_profiles ON true
            WHERE employees.tenant_id = $1
            ORDER BY employees.full_name ASC, employees.email ASC
            LIMIT 200
          `,
          [tenantId],
        );

        return result.rows;
      });

      res.json({ success: true, profiles });
    } catch (error) {
      console.error('[Compensation] Failed to load profiles:', error);
      res.status(500).json({ success: false, error: 'Unable to load compensation profiles' });
    }
  },
);

app.get(
  '/api/compensation-profiles/me',
  demoAuth,
  requireRole(['employee', 'manager', 'hr_admin']),
  async (req, res) => {
    const tenantId = req.authUser!.tenantId;
    const employeeId = req.authUser!.employeeId;

    if (!hasDatabaseConfig()) {
      return res.status(503).json({ success: false, error: 'DATABASE_URL is required for compensation profiles' });
    }

    try {
      const profile = await withTenant(tenantId, async (client) => {
        const result = await client.query(
          `
            SELECT
              employee_compensation_profiles.id,
              employee_compensation_profiles.employee_id,
              employee_compensation_profiles.pay_type,
              employee_compensation_profiles.base_amount,
              employee_compensation_profiles.currency,
              employee_compensation_profiles.effective_from,
              employee_compensation_profiles.effective_to,
              employee_compensation_profiles.is_active,
              employee_compensation_profiles.created_at,
              employee_compensation_profiles.updated_at
            FROM employee_compensation_profiles
            WHERE tenant_id = $1
              AND employee_id = $2
              AND is_active = true
            ORDER BY effective_from DESC, created_at DESC
            LIMIT 1
          `,
          [tenantId, employeeId],
        );

        return result.rows[0] || null;
      });

      res.json({ success: true, profile });
    } catch (error) {
      console.error('[Compensation] Failed to load employee profile:', error);
      res.status(500).json({ success: false, error: 'Unable to load compensation profile' });
    }
  },
);

app.put(
  '/api/compensation-profiles/:employeeId',
  demoAuth,
  requirePermission('compensation.manage'),
  async (req, res) => {
    const tenantId = req.authUser!.tenantId;
    const actorEmployeeId = req.authUser!.employeeId;
    const targetEmployeeId = req.params.employeeId;
    const { payType = 'monthly', baseAmount, currency, effectiveFrom } = req.body as UpsertCompensationProfileBody;

    const normalizedBaseAmount = Number(baseAmount);
    const normalizedCurrency = currency?.trim().toUpperCase();
    const normalizedEffectiveFrom = effectiveFrom || toWorkDate(new Date());

    if (!isUuid(targetEmployeeId)) {
      return res.status(400).json({ success: false, error: 'employeeId must be a valid UUID.' });
    }

    if (!isCompensationPayType(payType)) {
      return res.status(400).json({ success: false, error: 'payType must be monthly, hourly, weekly, or annual.' });
    }

    if (!Number.isFinite(normalizedBaseAmount) || normalizedBaseAmount < 0) {
      return res.status(400).json({ success: false, error: 'baseAmount must be a non-negative number.' });
    }

    if (normalizedCurrency && !/^[A-Z]{3}$/.test(normalizedCurrency)) {
      return res.status(400).json({ success: false, error: 'currency must be a 3-letter code.' });
    }

    if (!isValidDateInput(normalizedEffectiveFrom)) {
      return res.status(400).json({ success: false, error: 'effectiveFrom must be a valid YYYY-MM-DD date.' });
    }

    if (!hasDatabaseConfig()) {
      return res.status(503).json({ success: false, error: 'DATABASE_URL is required for compensation profiles' });
    }

    try {
      const profile = await withTenant(tenantId, async (client) => {
        const employeeResult = await client.query<{ id: string; default_currency: string | null }>(
          `
            SELECT employees.id, tenants.default_currency
            FROM employees
            INNER JOIN tenants
              ON tenants.id = employees.tenant_id
            WHERE employees.tenant_id = $1
              AND employees.id = $2
            LIMIT 1
          `,
          [tenantId, targetEmployeeId],
        );

        const employee = employeeResult.rows[0];
        if (!employee) {
          return null;
        }

        const profileCurrency = normalizedCurrency || employee.default_currency || 'USD';

        await client.query(
          `
            UPDATE employee_compensation_profiles
            SET
              is_active = false,
              effective_to = CASE
                WHEN effective_from <= (($3::date - INTERVAL '1 day')::date)
                  THEN (($3::date - INTERVAL '1 day')::date)
                ELSE effective_from
              END,
              updated_by = $4,
              updated_at = NOW()
            WHERE tenant_id = $1
              AND employee_id = $2
              AND is_active = true
          `,
          [tenantId, targetEmployeeId, normalizedEffectiveFrom, actorEmployeeId],
        );

        const insertResult = await client.query(
          `
            INSERT INTO employee_compensation_profiles (
              tenant_id,
              employee_id,
              pay_type,
              base_amount,
              currency,
              effective_from,
              is_active,
              created_by,
              updated_by
            )
            VALUES (
              $1,
              $2,
              $3::varchar,
              $4::numeric,
              $5::varchar,
              $6::date,
              true,
              $7,
              $7
            )
            RETURNING
              id,
              employee_id,
              pay_type,
              base_amount,
              currency,
              effective_from,
              effective_to,
              is_active,
              created_at,
              updated_at
          `,
          [
            tenantId,
            targetEmployeeId,
            payType,
            normalizedBaseAmount,
            profileCurrency,
            normalizedEffectiveFrom,
            actorEmployeeId,
          ],
        );

        const insertedProfile = insertResult.rows[0];

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
            'employee_compensation_updated',
            'employee_compensation_profile',
            insertedProfile.id,
            JSON.stringify({
              employeeId: targetEmployeeId,
              payType,
              baseAmount: normalizedBaseAmount,
              currency: profileCurrency,
              effectiveFrom: normalizedEffectiveFrom,
            }),
          ],
        );

        return insertedProfile;
      });

      if (!profile) {
        return res.status(404).json({ success: false, error: 'Employee not found for this tenant.' });
      }

      res.json({ success: true, profile });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        return res.status(409).json({ success: false, error: 'An active compensation profile already exists for this employee.' });
      }

      console.error('[Compensation] Failed to save profile:', error);
      res.status(500).json({ success: false, error: 'Unable to save compensation profile' });
    }
  },
);

app.get(
  '/api/employee-loans',
  demoAuth,
  requirePermission('loans.manage'),
  async (req, res) => {
    const tenantId = req.authUser!.tenantId;

    if (!hasDatabaseConfig()) {
      return res.status(503).json({ success: false, error: 'DATABASE_URL is required for employee loans' });
    }

    try {
      const loans = await withTenant(tenantId, async (client) => {
        const result = await client.query(
          `
            SELECT
              employee_loans.id,
              employee_loans.employee_id,
              employees.full_name,
              employees.email,
              employee_loans.loan_name,
              employee_loans.principal_amount,
              employee_loans.outstanding_balance,
              employee_loans.currency,
              employee_loans.repayment_amount,
              employee_loans.repayment_frequency,
              employee_loans.status,
              employee_loans.issued_at,
              employee_loans.due_date,
              employee_loans.created_at,
              employee_loans.updated_at
            FROM employee_loans
            INNER JOIN employees
              ON employees.id = employee_loans.employee_id
             AND employees.tenant_id = employee_loans.tenant_id
            WHERE employee_loans.tenant_id = $1
            ORDER BY employee_loans.created_at DESC
            LIMIT 200
          `,
          [tenantId],
        );

        return result.rows;
      });

      res.json({ success: true, loans });
    } catch (error) {
      console.error('[Loans] Failed to load tenant loans:', error);
      res.status(500).json({ success: false, error: 'Unable to load employee loans' });
    }
  },
);

app.get(
  '/api/employee-loans/me',
  demoAuth,
  requirePermission('loans.view_self'),
  async (req, res) => {
    const tenantId = req.authUser!.tenantId;
    const employeeId = req.authUser!.employeeId;

    if (!hasDatabaseConfig()) {
      return res.status(503).json({ success: false, error: 'DATABASE_URL is required for employee loans' });
    }

    try {
      const loans = await withTenant(tenantId, async (client) => {
        const result = await client.query(
          `
            SELECT
              id,
              employee_id,
              loan_name,
              principal_amount,
              outstanding_balance,
              currency,
              repayment_amount,
              repayment_frequency,
              status,
              issued_at,
              due_date,
              created_at,
              updated_at
            FROM employee_loans
            WHERE tenant_id = $1
              AND employee_id = $2
            ORDER BY created_at DESC
            LIMIT 100
          `,
          [tenantId, employeeId],
        );

        return result.rows;
      });

      res.json({ success: true, loans });
    } catch (error) {
      console.error('[Loans] Failed to load employee loans:', error);
      res.status(500).json({ success: false, error: 'Unable to load employee loans' });
    }
  },
);

app.post(
  '/api/employee-loans',
  demoAuth,
  requirePermission('loans.manage'),
  async (req, res) => {
    const tenantId = req.authUser!.tenantId;
    const actorEmployeeId = req.authUser!.employeeId;
    const {
      employeeId,
      loanName,
      principalAmount,
      repaymentAmount,
      currency,
      repaymentFrequency = 'monthly',
      issuedAt,
      dueDate,
    } = req.body as CreateEmployeeLoanBody;

    const normalizedPrincipalAmount = Number(principalAmount);
    const normalizedRepaymentAmount = Number(repaymentAmount);
    const normalizedCurrency = currency?.trim().toUpperCase();
    const normalizedIssuedAt = issuedAt || toWorkDate(new Date());
    const normalizedDueDate = dueDate || null;
    const normalizedLoanName = loanName?.trim() || 'Employee Loan';

    if (!isUuid(employeeId)) {
      return res.status(400).json({ success: false, error: 'employeeId must be a valid UUID.' });
    }

    if (!Number.isFinite(normalizedPrincipalAmount) || normalizedPrincipalAmount <= 0) {
      return res.status(400).json({ success: false, error: 'principalAmount must be greater than zero.' });
    }

    if (!Number.isFinite(normalizedRepaymentAmount) || normalizedRepaymentAmount < 0) {
      return res.status(400).json({ success: false, error: 'repaymentAmount must be a non-negative number.' });
    }

    if (!normalizedLoanName || normalizedLoanName.length > 160) {
      return res.status(400).json({ success: false, error: 'loanName must be between 1 and 160 characters.' });
    }

    if (normalizedCurrency && !/^[A-Z]{3}$/.test(normalizedCurrency)) {
      return res.status(400).json({ success: false, error: 'currency must be a 3-letter code.' });
    }

    if (!isLoanRepaymentFrequency(repaymentFrequency)) {
      return res.status(400).json({ success: false, error: 'repaymentFrequency must be monthly, weekly, or one_time.' });
    }

    if (!isValidDateInput(normalizedIssuedAt) || (normalizedDueDate !== null && !isValidDateInput(normalizedDueDate))) {
      return res.status(400).json({ success: false, error: 'issuedAt and dueDate must be valid YYYY-MM-DD dates.' });
    }

    if (normalizedDueDate !== null && normalizedDueDate < normalizedIssuedAt) {
      return res.status(400).json({ success: false, error: 'dueDate must not be before issuedAt.' });
    }

    if (!hasDatabaseConfig()) {
      return res.status(503).json({ success: false, error: 'DATABASE_URL is required for employee loans' });
    }

    try {
      const loan = await withTenant(tenantId, async (client) => {
        const employeeResult = await client.query<{ id: string; default_currency: string | null }>(
          `
            SELECT employees.id, tenants.default_currency
            FROM employees
            INNER JOIN tenants
              ON tenants.id = employees.tenant_id
            WHERE employees.tenant_id = $1
              AND employees.id = $2
            LIMIT 1
          `,
          [tenantId, employeeId],
        );

        const employee = employeeResult.rows[0];
        if (!employee) {
          return null;
        }

        const loanCurrency = normalizedCurrency || employee.default_currency || 'USD';
        const loanResult = await client.query(
          `
            INSERT INTO employee_loans (
              tenant_id,
              employee_id,
              loan_name,
              principal_amount,
              outstanding_balance,
              currency,
              repayment_amount,
              repayment_frequency,
              status,
              issued_at,
              due_date,
              created_by,
              updated_by
            )
            VALUES (
              $1,
              $2,
              $3::varchar,
              $4::numeric,
              $4::numeric,
              $5::varchar,
              $6::numeric,
              $7::varchar,
              'active',
              $8::date,
              $9::date,
              $10,
              $10
            )
            RETURNING
              id,
              employee_id,
              loan_name,
              principal_amount,
              outstanding_balance,
              currency,
              repayment_amount,
              repayment_frequency,
              status,
              issued_at,
              due_date,
              created_at,
              updated_at
          `,
          [
            tenantId,
            employeeId,
            normalizedLoanName,
            normalizedPrincipalAmount,
            loanCurrency,
            normalizedRepaymentAmount,
            repaymentFrequency,
            normalizedIssuedAt,
            normalizedDueDate,
            actorEmployeeId,
          ],
        );

        const createdLoan = loanResult.rows[0];

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
            'employee_loan_created',
            'employee_loan',
            createdLoan.id,
            JSON.stringify({
              employeeId,
              principalAmount: normalizedPrincipalAmount,
              repaymentAmount: normalizedRepaymentAmount,
              currency: loanCurrency,
            }),
          ],
        );

        return createdLoan;
      });

      if (!loan) {
        return res.status(404).json({ success: false, error: 'Employee not found for this tenant.' });
      }

      res.status(201).json({ success: true, loan });
    } catch (error) {
      console.error('[Loans] Failed to create employee loan:', error);
      res.status(500).json({ success: false, error: 'Unable to create employee loan' });
    }
  },
);

app.patch(
  '/api/employee-loans/:id/status',
  demoAuth,
  requirePermission('loans.manage'),
  async (req, res) => {
    const tenantId = req.authUser!.tenantId;
    const actorEmployeeId = req.authUser!.employeeId;
    const { id } = req.params;
    const { status } = req.body as UpdateEmployeeLoanStatusBody;

    if (!isUuid(id)) {
      return res.status(400).json({ success: false, error: 'Employee loan id must be a valid UUID.' });
    }

    if (!isLoanStatus(status)) {
      return res.status(400).json({ success: false, error: 'status must be active, paid, or cancelled.' });
    }

    if (!hasDatabaseConfig()) {
      return res.status(503).json({ success: false, error: 'DATABASE_URL is required for employee loans' });
    }

    try {
      const loan = await withTenant(tenantId, async (client) => {
        const existingResult = await client.query<{
          id: string;
          employee_id: string;
          status: LoanStatus;
        }>(
          `
            SELECT id, employee_id, status
            FROM employee_loans
            WHERE tenant_id = $1
              AND id = $2
            LIMIT 1
          `,
          [tenantId, id],
        );

        const existingLoan = existingResult.rows[0];
        if (!existingLoan) {
          return null;
        }

        const updateResult = await client.query(
          `
            UPDATE employee_loans
            SET
              status = $3::varchar,
              outstanding_balance = CASE WHEN $3::varchar = 'paid' THEN 0 ELSE outstanding_balance END,
              updated_by = $4,
              updated_at = NOW()
            WHERE tenant_id = $1
              AND id = $2
            RETURNING
              id,
              employee_id,
              loan_name,
              principal_amount,
              outstanding_balance,
              currency,
              repayment_amount,
              repayment_frequency,
              status,
              issued_at,
              due_date,
              created_at,
              updated_at
          `,
          [tenantId, id, status, actorEmployeeId],
        );

        const updatedLoan = updateResult.rows[0];

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
            'employee_loan_status_updated',
            'employee_loan',
            id,
            JSON.stringify({
              employeeId: existingLoan.employee_id,
              previousStatus: existingLoan.status,
              newStatus: status,
            }),
          ],
        );

        return updatedLoan;
      });

      if (!loan) {
        return res.status(404).json({ success: false, error: 'Employee loan not found.' });
      }

      res.json({ success: true, loan });
    } catch (error) {
      console.error('[Loans] Failed to update employee loan status:', error);
      res.status(500).json({ success: false, error: 'Unable to update employee loan status' });
    }
  },
);

app.get(
  '/api/payroll/me',
  demoAuth,
  requirePermission('payroll.view_self'),
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
              approved_by,
              approved_at,
              paid_at,
              cancelled_at
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
  requirePermission('payroll.view_all'),
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
              payroll_records.approved_by,
              payroll_records.approved_at,
              payroll_records.paid_at,
              payroll_records.cancelled_at
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

app.patch(
  '/api/payroll/:id/status',
  demoAuth,
  (req, res, next) => {
    const { status } = req.body as UpdatePayrollStatusBody;
    const hasPermission = (permissionKey: string) => (
      req.authUser?.role === 'hr_admin' ||
      Boolean(req.authUser?.permissions?.includes(permissionKey))
    );

    if (status === 'paid' && !hasPermission('payroll.mark_paid')) {
      return res.status(403).json({ success: false, error: 'Permission payroll.mark_paid is required.' });
    }

    if ((status === 'approved' || status === 'cancelled') && !hasPermission('payroll.approve')) {
      return res.status(403).json({ success: false, error: 'Permission payroll.approve is required.' });
    }

    next();
  },
  async (req, res) => {
    const tenantId = req.authUser!.tenantId;
    const actorEmployeeId = req.authUser!.employeeId;
    const { id } = req.params;
    const { status } = req.body as UpdatePayrollStatusBody;

    if (!isUuid(id)) {
      return res.status(400).json({ success: false, error: 'Payroll record id must be a valid UUID.' });
    }

    if (!isPayrollStatus(status)) {
      return res.status(400).json({ success: false, error: 'status must be draft, approved, paid, or cancelled.' });
    }

    if (!hasDatabaseConfig()) {
      return res.status(503).json({ success: false, error: 'DATABASE_URL is required for payroll records' });
    }

    try {
      const payrollRecord = await withTenant(tenantId, async (client) => {
        const existingResult = await client.query<{
          id: string;
          employee_id: string;
          pay_period_start: string;
          pay_period_end: string;
          status: PayrollStatus;
        }>(
          `
            SELECT id, employee_id, pay_period_start, pay_period_end, status
            FROM payroll_records
            WHERE tenant_id = $1
              AND id = $2
            LIMIT 1
          `,
          [tenantId, id],
        );

        const existingRecord = existingResult.rows[0];
        if (!existingRecord) {
          return null;
        }

        const allowedTransitions: Record<PayrollStatus, PayrollStatus[]> = {
          draft: ['approved', 'cancelled'],
          approved: ['paid', 'cancelled'],
          paid: [],
          cancelled: [],
        };

        if (existingRecord.status !== status && !allowedTransitions[existingRecord.status].includes(status)) {
          const error = new Error(`Cannot change payroll status from ${existingRecord.status} to ${status}.`);
          (error as { statusCode?: number }).statusCode = 400;
          throw error;
        }

        const updateResult = await client.query(
          `
            UPDATE payroll_records
            SET
              status = $3::varchar,
              approved_by = CASE WHEN $3::varchar = 'approved' THEN $4 ELSE approved_by END,
              approved_at = CASE WHEN $3::varchar = 'approved' THEN NOW() ELSE approved_at END,
              paid_at = CASE WHEN $3::varchar = 'paid' THEN NOW() ELSE paid_at END,
              cancelled_at = CASE WHEN $3::varchar = 'cancelled' THEN NOW() ELSE cancelled_at END,
              updated_at = NOW()
            WHERE tenant_id = $1
              AND id = $2
            RETURNING
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
              approved_by,
              approved_at,
              paid_at,
              cancelled_at
          `,
          [tenantId, id, status, actorEmployeeId],
        );

        const updatedRecord = updateResult.rows[0];

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
            'payroll_status_updated',
            'payroll_record',
            id,
            JSON.stringify({
              previousStatus: existingRecord.status,
              newStatus: status,
              employeeId: existingRecord.employee_id,
              payPeriodStart: existingRecord.pay_period_start,
              payPeriodEnd: existingRecord.pay_period_end,
            }),
          ],
        );

        return updatedRecord;
      });

      if (!payrollRecord) {
        return res.status(404).json({ success: false, error: 'Payroll record not found.' });
      }

      res.json({ success: true, payrollRecord });
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 400) {
        return res.status(400).json({ success: false, error: (error as Error).message });
      }

      console.error('[Payroll] Failed to update payroll status:', error);
      res.status(500).json({ success: false, error: 'Unable to update payroll status' });
    }
  },
);

app.post(
  '/api/payroll/run',
  demoAuth,
  requirePermission('payroll.run'),
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
    const hasFallbackBaseSalary = defaultBaseSalary !== undefined && defaultBaseSalary !== null;
    const fallbackBaseSalary = hasFallbackBaseSalary ? Number(defaultBaseSalary) : null;

    if (
      !isValidDateInput(payPeriodStart) ||
      !isValidDateInput(payPeriodEnd)
    ) {
      return res.status(400).json({
        error: 'payPeriodStart and payPeriodEnd are required.',
      });
    }

    if (
      (hasFallbackBaseSalary && !isNonNegativeAmount(fallbackBaseSalary)) ||
      !isNonNegativeAmount(bonuses) ||
      !isNonNegativeAmount(deductions)
    ) {
      return res.status(400).json({
        error: 'Payroll amounts cannot be negative.',
      });
    }

    if (payPeriodEnd! <= payPeriodStart!) {
      return res.status(400).json({
        error: 'payPeriodEnd must be after payPeriodStart.',
      });
    }

    if (!hasDatabaseConfig()) {
      return res.status(503).json({ error: 'DATABASE_URL is required to run payroll' });
    }

    try {
      const payrollRunResult = await withTenant(tenantId, async (client) => {
        await client.query('BEGIN');

        try {
          const tenantResult = await client.query<{ default_currency: string | null }>(
            `
              SELECT default_currency
              FROM tenants
              WHERE id = $1
              LIMIT 1
            `,
            [tenantId],
          );
          const tenantCurrency = tenantResult.rows[0]?.default_currency || 'USD';
          const employeeResult = await client.query<{
            id: string;
            email: string;
            base_amount: string | null;
            currency: string | null;
            pay_type: CompensationPayType | null;
            compensation_profile_id: string | null;
          }>(
            `
              SELECT
                employees.id,
                employees.email,
                active_profiles.base_amount,
                active_profiles.currency,
                active_profiles.pay_type,
                active_profiles.id AS compensation_profile_id
              FROM employees
              LEFT JOIN LATERAL (
                SELECT id, base_amount, currency, pay_type
                FROM employee_compensation_profiles
                WHERE tenant_id = employees.tenant_id
                  AND employee_id = employees.id
                  AND is_active = true
                  AND effective_from <= $2::date
                  AND (effective_to IS NULL OR effective_to >= $2::date)
                ORDER BY effective_from DESC, created_at DESC
                LIMIT 1
              ) active_profiles ON true
              WHERE employees.tenant_id = $1
            `,
            [
              tenantId,
              payPeriodStart,
            ],
          );

          const skippedEmployees: Array<{ employeeId: string; email: string; reason: string }> = [];
          let generatedCount = 0;
          let fallbackUsed = false;
          let loanDeductionsApplied = 0;

          for (const employee of employeeResult.rows) {
            const profileBaseAmount = employee.base_amount === null ? null : Number(employee.base_amount);
            const usesProfile = profileBaseAmount !== null && Number.isFinite(profileBaseAmount);
            const baseSalary = usesProfile ? profileBaseAmount : fallbackBaseSalary;

            if (baseSalary === null || !Number.isFinite(baseSalary)) {
              skippedEmployees.push({
                employeeId: employee.id,
                email: employee.email,
                reason: 'Missing active compensation profile and no fallback base salary was provided.',
              });
              continue;
            }

            const existingPayrollResult = await client.query<{ id: string; status: PayrollStatus }>(
              `
                SELECT id, status
                FROM payroll_records
                WHERE tenant_id = $1
                  AND employee_id = $2
                  AND pay_period_start = $3::date
                  AND pay_period_end = $4::date
                FOR UPDATE
              `,
              [tenantId, employee.id, payPeriodStart, payPeriodEnd],
            );

            const existingPayrollRecord = existingPayrollResult.rows[0];
            if (existingPayrollRecord && existingPayrollRecord.status !== 'draft') {
              throw Object.assign(
                new Error('Payroll for this employee and period is finalized and cannot be re-run.'),
                { statusCode: 409 },
              );
            }
            let employeeLoanDeduction = 0;
            const loanPayments: Array<{ loanId: string; amount: number }> = [];

            // Loan repayments are applied only when creating a new payroll record
            // for this employee/period. Re-running the same period updates payroll
            // values without double-deducting loan balances.
            if (!existingPayrollRecord) {
              const loanResult = await client.query<{
                id: string;
                outstanding_balance: string;
                repayment_amount: string;
              }>(
                `
                  SELECT id, outstanding_balance, repayment_amount
                  FROM employee_loans
                  WHERE tenant_id = $1
                    AND employee_id = $2
                    AND status = 'active'
                    AND outstanding_balance > 0
                  ORDER BY created_at ASC
                  FOR UPDATE
                `,
                [tenantId, employee.id],
              );

              for (const loan of loanResult.rows) {
                const outstandingBalance = Number(loan.outstanding_balance);
                const repaymentAmount = Number(loan.repayment_amount);
                const paymentAmount = Math.min(
                  Number.isFinite(repaymentAmount) ? repaymentAmount : 0,
                  Number.isFinite(outstandingBalance) ? outstandingBalance : 0,
                );

                if (paymentAmount > 0) {
                  employeeLoanDeduction += paymentAmount;
                  loanPayments.push({ loanId: loan.id, amount: paymentAmount });
                }
              }
            }

            const payrollCurrency = usesProfile ? (employee.currency || tenantCurrency) : tenantCurrency;
            const totalDeductions = deductions + employeeLoanDeduction;
            const netPay = baseSalary + bonuses - totalDeductions;

            if (!usesProfile) {
              fallbackUsed = true;
            }

            const payrollResult = await client.query<{ id: string }>(
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
                VALUES (
                  $1,
                  $2,
                  $3::date,
                  $4::date,
                  $5::numeric,
                  $6::numeric,
                  $7::numeric,
                  $8::numeric,
                  $9::varchar,
                  'draft',
                  $10::uuid,
                  NOW(),
                  NOW()
                )
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
                  approved_by = NULL,
                  approved_at = NULL,
                  paid_at = NULL,
                  cancelled_at = NULL,
                  updated_at = NOW()
                RETURNING id
              `,
              [
                tenantId,
                employee.id,
                payPeriodStart,
                payPeriodEnd,
                baseSalary,
                bonuses,
                totalDeductions,
                netPay,
                payrollCurrency,
                actorEmployeeId,
              ],
            );

            generatedCount += payrollResult.rowCount || 0;
            const payrollRecordId = payrollResult.rows[0]?.id;

            if (!existingPayrollRecord && payrollRecordId) {
              for (const payment of loanPayments) {
                await client.query(
                  `
                    UPDATE employee_loans
                    SET
                      outstanding_balance = GREATEST(outstanding_balance - $3::numeric, 0),
                      status = CASE
                        WHEN GREATEST(outstanding_balance - $3::numeric, 0) = 0 THEN 'paid'
                        ELSE status
                      END,
                      updated_by = $4,
                      updated_at = NOW()
                    WHERE tenant_id = $1
                      AND id = $2
                  `,
                  [tenantId, payment.loanId, payment.amount, actorEmployeeId],
                );

                await client.query(
                  `
                    INSERT INTO employee_loan_payments (
                      tenant_id,
                      loan_id,
                      payroll_record_id,
                      amount
                    )
                    VALUES ($1, $2, $3, $4::numeric)
                  `,
                  [tenantId, payment.loanId, payrollRecordId, payment.amount],
                );

                loanDeductionsApplied += payment.amount;
              }
            }
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
              tenantId,
              actorEmployeeId,
              'payroll_run_generated',
              'payroll',
              actorEmployeeId,
              JSON.stringify({
                payPeriodStart,
                payPeriodEnd,
                fallbackDefaultBaseSalary: hasFallbackBaseSalary ? fallbackBaseSalary : null,
                bonuses,
                deductions,
                loanDeductionsApplied,
                recordsGenerated: generatedCount,
                skippedEmployeesCount: skippedEmployees.length,
                fallbackUsed,
                loanRepaymentsAppliedOnlyToNewRecords: true,
              }),
            ],
          );

          await client.query('COMMIT');
          return { recordsGenerated: generatedCount, skippedEmployees, loanDeductionsApplied };
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      });

      res.json({
        success: true,
        message: 'Payroll run generated successfully.',
        recordsGenerated: payrollRunResult.recordsGenerated,
        skippedEmployees: payrollRunResult.skippedEmployees,
        loanDeductionsApplied: payrollRunResult.loanDeductionsApplied,
      });
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 409) {
        return res.status(409).json({ success: false, error: (error as Error).message });
      }

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

app.get(
  '/api/payroll/:id/pdf',
  demoAuth,
  requirePermission('payroll.export_pdf'),
  async (req, res) => {
    const { id } = req.params;
    const tenantId = req.authUser!.tenantId;
    const employeeId = req.authUser!.employeeId;
    const role = req.authUser!.role;
    const canViewAllPayroll = role === 'hr_admin' || Boolean(req.authUser!.permissions?.includes('payroll.view_all'));

    if (!isUuid(id)) {
      return res.status(400).json({ success: false, error: 'Payroll record id must be a valid UUID.' });
    }

    if (!hasDatabaseConfig()) {
      return res.status(503).json({ success: false, error: 'DATABASE_URL is required for payroll PDF export' });
    }

    try {
      const payrollRecord = await withTenant(tenantId, async (client) => {
        const result = await client.query(
          `
            SELECT
              payroll_records.id,
              payroll_records.employee_id,
              payroll_records.pay_period_start,
              payroll_records.pay_period_end,
              payroll_records.base_salary,
              payroll_records.bonuses,
              payroll_records.deductions,
              payroll_records.net_pay,
              payroll_records.currency,
              payroll_records.status,
              payroll_records.generated_at,
              payroll_records.approved_at,
              payroll_records.paid_at,
              payroll_records.cancelled_at,
              employees.full_name,
              employees.email,
              tenants.company_name,
              tenants.default_currency
            FROM payroll_records
            INNER JOIN employees
              ON employees.id = payroll_records.employee_id
             AND employees.tenant_id = payroll_records.tenant_id
            INNER JOIN tenants
              ON tenants.id = payroll_records.tenant_id
            WHERE payroll_records.tenant_id = $1
              AND payroll_records.id = $2
            LIMIT 1
          `,
          [tenantId, id],
        );

        return result.rows[0];
      });

      if (!payrollRecord) {
        return res.status(404).json({ success: false, error: 'Payroll record not found.' });
      }

      if (!canViewAllPayroll && payrollRecord.employee_id !== employeeId) {
        return res.status(403).json({ success: false, error: 'You do not have permission to export this payroll record.' });
      }

      const currency = payrollRecord.currency || payrollRecord.default_currency || 'USD';
      const pdf = await PDFDocument.create();
      const page = pdf.addPage([595.28, 841.89]);
      const regularFont = await pdf.embedFont(StandardFonts.Helvetica);
      const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
      const { width, height } = page.getSize();
      const left = 56;
      let y = height - 64;

      const drawText = (
        text: string,
        x: number,
        nextY: number,
        options: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb> } = {},
      ) => {
        page.drawText(text, {
          x,
          y: nextY,
          size: options.size || 11,
          font: options.bold ? boldFont : regularFont,
          color: options.color || rgb(0.15, 0.18, 0.22),
        });
      };

      const drawRow = (label: string, value: string) => {
        drawText(label, left, y, { size: 10, bold: true, color: rgb(0.12, 0.35, 0.26) });
        drawText(value, left + 155, y, { size: 10 });
        y -= 22;
      };

      drawText('Stanza', left, y, { size: 13, bold: true, color: rgb(0.02, 0.45, 0.32) });
      y -= 28;
      drawText('Payroll Statement', left, y, { size: 24, bold: true, color: rgb(0.02, 0.22, 0.18) });
      y -= 34;
      page.drawLine({
        start: { x: left, y },
        end: { x: width - left, y },
        thickness: 1,
        color: rgb(0.75, 0.82, 0.78),
      });
      y -= 28;

      drawRow('Company', payrollRecord.company_name);
      drawRow('Employee', payrollRecord.full_name);
      drawRow('Email', payrollRecord.email);
      drawRow('Payroll Record ID', payrollRecord.id);
      drawRow('Period', `${formatPdfDate(payrollRecord.pay_period_start)} to ${formatPdfDate(payrollRecord.pay_period_end)}`);
      drawRow('Status', payrollRecord.status);
      drawRow('Generated', formatPdfDateTime(payrollRecord.generated_at));
      if (payrollRecord.approved_at) {
        drawRow('Approved', formatPdfDateTime(payrollRecord.approved_at));
      }
      if (payrollRecord.paid_at) {
        drawRow('Paid', formatPdfDateTime(payrollRecord.paid_at));
      }
      if (payrollRecord.cancelled_at) {
        drawRow('Cancelled', formatPdfDateTime(payrollRecord.cancelled_at));
      }

      y -= 12;
      drawText('Earnings', left, y, { size: 14, bold: true, color: rgb(0.02, 0.45, 0.32) });
      y -= 26;
      drawRow('Base Salary', formatPdfMoney(payrollRecord.base_salary, currency));
      drawRow('Bonuses', formatPdfMoney(payrollRecord.bonuses, currency));

      y -= 8;
      drawText('Deductions', left, y, { size: 14, bold: true, color: rgb(0.02, 0.45, 0.32) });
      y -= 26;
      drawRow('Deductions', formatPdfMoney(payrollRecord.deductions, currency));

      y -= 8;
      drawText('Net Pay', left, y, { size: 14, bold: true, color: rgb(0.02, 0.45, 0.32) });
      y -= 30;
      drawText(formatPdfMoney(payrollRecord.net_pay, currency), left, y, { size: 20, bold: true, color: rgb(0.02, 0.22, 0.18) });

      const generatedAt = new Date().toISOString();
      drawText('Generated by Stanza', left, 48, { size: 9, color: rgb(0.38, 0.44, 0.42) });
      drawText(`Generated at ${formatPdfDateTime(generatedAt)}`, left, 32, { size: 9, color: rgb(0.38, 0.44, 0.42) });

      const pdfBytes = await pdf.save();
      const periodPart = `${formatPdfDate(payrollRecord.pay_period_start)}-${formatPdfDate(payrollRecord.pay_period_end)}`;
      const filename = `payroll-${sanitizeFilenamePart(periodPart)}-${sanitizeFilenamePart(payrollRecord.full_name)}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.send(Buffer.from(pdfBytes));
    } catch (error) {
      console.error('[Payroll] Failed to export payroll PDF:', error);
      res.status(500).json({ success: false, error: 'Unable to export payroll PDF' });
    }
  },
);

app.post(
  '/api/company-feed/posts',
  demoAuth,
  requirePermission('feed.publish'),
  async (req, res) => {
    const {
      title,
      postType = 'announcement',
      contentText,
      contentJson,
      eventStartsAt,
      eventEndsAt,
      status = 'published',
      visibility,
    } = req.body as CreateFeedPostBody;

    const tenantId = req.authUser!.tenantId;
    const actorEmployeeId = req.authUser!.employeeId;
    const normalizedTitle = title?.trim() || '';
    const normalizedContent = contentText?.trim() || '';
    const normalizedStartsAt = normalizeFeedDate(eventStartsAt);
    const normalizedEndsAt = normalizeFeedDate(eventEndsAt);

    if (!normalizedTitle || !normalizedContent) {
      return res.status(400).json({
        success: false,
        error: 'title and contentText are required.',
      });
    }

    if (normalizedTitle.length > 160 || normalizedContent.length > 20000) {
      return res.status(400).json({
        success: false,
        error: 'title must be 160 characters or fewer and contentText must be 20000 characters or fewer.',
      });
    }

    const serializedContentJson = contentJson == null ? null : JSON.stringify(contentJson);
    if (serializedContentJson && serializedContentJson.length > 50000) {
      return res.status(400).json({
        success: false,
        error: 'contentJson is too large.',
      });
    }

    if (!isFeedPostType(postType)) {
      return res.status(400).json({
        success: false,
        error: 'postType must be announcement, event, policy_update, or general.',
      });
    }

    if (status !== 'draft' && status !== 'published') {
      return res.status(400).json({
        success: false,
        error: 'status must be draft or published.',
      });
    }

    if (normalizedStartsAt === undefined || normalizedEndsAt === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Event dates must be valid date/time values.',
      });
    }

    if (normalizedStartsAt && normalizedEndsAt && new Date(normalizedEndsAt) < new Date(normalizedStartsAt)) {
      return res.status(400).json({
        success: false,
        error: 'eventEndsAt must not be before eventStartsAt.',
      });
    }

    const normalizedVisibility = normalizeFeedVisibility(visibility);
    if (!normalizedVisibility.ok) {
      return res.status(400).json({
        success: false,
        error: normalizedVisibility.error,
      });
    }

    if (!hasDatabaseConfig()) {
      return res.status(503).json({ success: false, error: 'DATABASE_URL is required for company feed' });
    }

    try {
      const post = await withTenant(tenantId, async (client) => {
        const locationIds = normalizedVisibility.visibility
          .filter((rule) => rule.type === 'location')
          .map((rule) => rule.locationId!);

        if (locationIds.length > 0) {
          const locationsResult = await client.query(
            `
              SELECT id
              FROM company_locations
              WHERE tenant_id = $1
                AND id = ANY($2::uuid[])
            `,
            [tenantId, locationIds],
          );

          if (locationsResult.rowCount !== new Set(locationIds).size) {
            throw Object.assign(new Error('One or more locations do not belong to this tenant.'), { statusCode: 400 });
          }
        }

        const postResult = await client.query(
          `
            INSERT INTO company_feed_posts (
              tenant_id,
              author_employee_id,
              title,
              post_type,
              content_text,
              content_json,
              event_starts_at,
              event_ends_at,
              status,
              published_at
            )
            VALUES (
              $1::uuid,
              $2::uuid,
              $3::varchar,
              $4::varchar,
              $5::text,
              $6::jsonb,
              $7::timestamptz,
              $8::timestamptz,
              $9::varchar,
              CASE WHEN $9::varchar = 'published' THEN NOW() ELSE NOW() END
            )
            RETURNING
              id,
              tenant_id,
              author_employee_id,
              title,
              post_type,
              content_text,
              content_json,
              event_starts_at,
              event_ends_at,
              status,
              created_at,
              updated_at,
              published_at,
              archived_at
          `,
          [
            tenantId,
            actorEmployeeId,
            normalizedTitle,
            postType,
            normalizedContent,
            serializedContentJson,
            normalizedStartsAt,
            normalizedEndsAt,
            status,
          ],
        );

        const createdPost = postResult.rows[0];

        for (const rule of normalizedVisibility.visibility) {
          await client.query(
            `
              INSERT INTO company_feed_visibility (
                tenant_id,
                post_id,
                visibility_type,
                role,
                location_id
              )
              VALUES ($1, $2, $3, $4, $5)
              ON CONFLICT DO NOTHING
            `,
            [
              tenantId,
              createdPost.id,
              rule.type,
              rule.type === 'role' ? rule.role : null,
              rule.type === 'location' ? rule.locationId : null,
            ],
          );
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
            tenantId,
            actorEmployeeId,
            'company_feed_post_created',
            'company_feed_post',
            createdPost.id,
            JSON.stringify({
              title: normalizedTitle,
              postType,
              status,
              visibility: normalizedVisibility.visibility,
            }),
          ],
        );

        return {
          ...createdPost,
          contentText: createdPost.content_text,
          contentJson: createdPost.content_json,
          visibility: normalizedVisibility.visibility,
        };
      });

      res.status(201).json({
        success: true,
        postId: post.id,
        post,
      });
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;

      if (statusCode === 400) {
        return res.status(400).json({
          success: false,
          error: (error as Error).message,
        });
      }

      console.error('[Company Feed] Failed to create post:', error);
      res.status(500).json({ success: false, error: 'Unable to create company feed post' });
    }
  },
);

app.get(
  '/api/company-feed',
  demoAuth,
  requirePermission('feed.read'),
  async (req, res) => {
    const tenantId = req.authUser!.tenantId;
    const role = req.authUser!.role;

    if (!hasDatabaseConfig()) {
      return res.status(503).json({ success: false, error: 'DATABASE_URL is required for company feed' });
    }

    try {
      const posts = await withTenant(tenantId, async (client) => {
        const result = await client.query(
          `
            SELECT
              company_feed_posts.id,
              company_feed_posts.author_employee_id,
              author.full_name AS author_name,
              author.email AS author_email,
              company_feed_posts.title,
              company_feed_posts.post_type,
              company_feed_posts.content_text,
              company_feed_posts.content_json,
              company_feed_posts.event_starts_at,
              company_feed_posts.event_ends_at,
              company_feed_posts.status,
              company_feed_posts.created_at,
              company_feed_posts.updated_at,
              company_feed_posts.published_at,
              company_feed_posts.archived_at
            FROM company_feed_posts
            INNER JOIN employees author
              ON author.id = company_feed_posts.author_employee_id
             AND author.tenant_id = company_feed_posts.tenant_id
            WHERE company_feed_posts.tenant_id = $1
              AND company_feed_posts.status = 'published'
              AND (
                EXISTS (
                  SELECT 1
                  FROM company_feed_visibility
                  WHERE company_feed_visibility.tenant_id = company_feed_posts.tenant_id
                    AND company_feed_visibility.post_id = company_feed_posts.id
                    AND company_feed_visibility.visibility_type = 'all'
                )
                OR EXISTS (
                  SELECT 1
                  FROM company_feed_visibility
                  WHERE company_feed_visibility.tenant_id = company_feed_posts.tenant_id
                    AND company_feed_visibility.post_id = company_feed_posts.id
                    AND company_feed_visibility.visibility_type = 'role'
                    AND company_feed_visibility.role = $2
                )
              )
            ORDER BY company_feed_posts.published_at DESC, company_feed_posts.created_at DESC
            LIMIT 50
          `,
          [tenantId, role],
        );

        return result.rows.map((post) => ({
          ...post,
          contentText: post.content_text,
          contentJson: post.content_json,
        }));
      });

      res.json({ success: true, posts });
    } catch (error) {
      console.error('[Company Feed] Failed to load visible posts:', error);
      res.status(500).json({ success: false, error: 'Unable to load company feed' });
    }
  },
);

app.get(
  '/api/company-feed/admin',
  demoAuth,
  requirePermission('feed.publish'),
  async (req, res) => {
    const tenantId = req.authUser!.tenantId;

    if (!hasDatabaseConfig()) {
      return res.status(503).json({ success: false, error: 'DATABASE_URL is required for company feed' });
    }

    try {
      const posts = await withTenant(tenantId, async (client) => {
        const result = await client.query(
          `
            SELECT
              company_feed_posts.id,
              company_feed_posts.author_employee_id,
              author.full_name AS author_name,
              author.email AS author_email,
              company_feed_posts.title,
              company_feed_posts.post_type,
              company_feed_posts.content_text,
              company_feed_posts.content_json,
              company_feed_posts.event_starts_at,
              company_feed_posts.event_ends_at,
              company_feed_posts.status,
              company_feed_posts.created_at,
              company_feed_posts.updated_at,
              company_feed_posts.published_at,
              company_feed_posts.archived_at,
              COALESCE(
                json_agg(
                  json_build_object(
                    'type', company_feed_visibility.visibility_type,
                    'role', company_feed_visibility.role,
                    'locationId', company_feed_visibility.location_id
                  )
                ) FILTER (WHERE company_feed_visibility.id IS NOT NULL),
                '[]'::json
              ) AS visibility
            FROM company_feed_posts
            INNER JOIN employees author
              ON author.id = company_feed_posts.author_employee_id
             AND author.tenant_id = company_feed_posts.tenant_id
            LEFT JOIN company_feed_visibility
              ON company_feed_visibility.post_id = company_feed_posts.id
             AND company_feed_visibility.tenant_id = company_feed_posts.tenant_id
            WHERE company_feed_posts.tenant_id = $1
            GROUP BY company_feed_posts.id, author.full_name, author.email
            ORDER BY company_feed_posts.created_at DESC
            LIMIT 100
          `,
          [tenantId],
        );

        return result.rows.map((post) => ({
          ...post,
          contentText: post.content_text,
          contentJson: post.content_json,
        }));
      });

      res.json({ success: true, posts });
    } catch (error) {
      console.error('[Company Feed] Failed to load admin posts:', error);
      res.status(500).json({ success: false, error: 'Unable to load company feed posts' });
    }
  },
);

app.patch(
  '/api/company-feed/posts/:id/status',
  demoAuth,
  requirePermission('feed.publish'),
  async (req, res) => {
    const { id } = req.params;
    const { status } = req.body as UpdateFeedPostStatusBody;
    const tenantId = req.authUser!.tenantId;
    const actorEmployeeId = req.authUser!.employeeId;

    if (!isFeedPostStatus(status)) {
      return res.status(400).json({
        success: false,
        error: 'status must be draft, published, or archived.',
      });
    }

    if (!hasDatabaseConfig()) {
      return res.status(503).json({ success: false, error: 'DATABASE_URL is required for company feed' });
    }

    try {
      const post = await withTenant(tenantId, async (client) => {
        const existingResult = await client.query<{ status: FeedPostStatus; title: string }>(
          `
            SELECT status, title
            FROM company_feed_posts
            WHERE tenant_id = $1
              AND id = $2
            LIMIT 1
            FOR UPDATE
          `,
          [tenantId, id],
        );

        if (existingResult.rowCount === 0) {
          throw Object.assign(new Error('Company feed post not found.'), { statusCode: 404 });
        }

        const previousStatus = existingResult.rows[0].status;
        const updateResult = await client.query(
          `
            UPDATE company_feed_posts
            SET
              status = $3,
              published_at = CASE
                WHEN $3 = 'published' THEN COALESCE(published_at, NOW())
                ELSE published_at
              END,
              archived_at = CASE
                WHEN $3 = 'archived' THEN NOW()
                WHEN $3 IN ('draft', 'published') THEN NULL
                ELSE archived_at
              END,
              updated_at = NOW()
            WHERE tenant_id = $1
              AND id = $2
            RETURNING
              id,
              author_employee_id,
              title,
              post_type,
              content_text,
              content_json,
              event_starts_at,
              event_ends_at,
              status,
              created_at,
              updated_at,
              published_at,
              archived_at
          `,
          [tenantId, id, status],
        );

        const updatedPost = updateResult.rows[0];

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
            'company_feed_post_status_updated',
            'company_feed_post',
            id,
            JSON.stringify({
              previousStatus,
              newStatus: status,
              title: updatedPost.title,
            }),
          ],
        );

        return updatedPost;
      });

      res.json({ success: true, post });
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;

      if (statusCode === 404) {
        return res.status(404).json({
          success: false,
          error: (error as Error).message,
        });
      }

      console.error('[Company Feed] Failed to update post status:', error);
      res.status(500).json({ success: false, error: 'Unable to update company feed post status' });
    }
  },
);

  app.get('/api/system/health', async (req, res) => {
  if (isProduction()) {
    return res.json({ success: true });
  }

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

  app.use('/api', apiErrorHandler);

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
