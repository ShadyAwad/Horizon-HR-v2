import 'dotenv/config';

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

type JsonRecord = Record<string, unknown>;

type ApiResult = {
  response: Response;
  body: JsonRecord | null;
  text: string;
};

type TestUser = {
  id: string;
  tenantId: string;
  authToken: string;
  role: string;
};

const baseUrl = (process.env.SECURITY_TEST_BASE_URL || process.env.SMOKE_TEST_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const rootDir = process.cwd();
const failures: string[] = [];
const warnings: string[] = [];
const privateResponsePatterns = [
  /\bstack\b/i,
  /(?:postgres|pg)\w*(?:error|exception)/i,
  /password_hash/i,
  /database_url/i,
  /c:\\games\\/i,
  /at \S+ \([^)]*:\d+:\d+\)/i,
];
const forbiddenClientStrings = [
  'DATABASE_URL',
  'postgres://',
  'password_hash',
  'JWT_SECRET',
  'SESSION_SECRET',
  'REDIS_PASSWORD',
  'PRIVATE_KEY',
  'SERVICE_ROLE',
  'DATABASE_SSL',
];

function configuredPrivateValues() {
  const values = [
    process.env.DATABASE_URL,
    process.env.AUTH_TOKEN_SECRET,
    process.env.SESSION_SECRET,
    process.env.REDIS_PASSWORD,
  ].filter((value): value is string => Boolean(value));

  if (process.env.DATABASE_URL) {
    try {
      const databasePassword = new URL(process.env.DATABASE_URL).password;
      if (databasePassword) values.push(decodeURIComponent(databasePassword));
    } catch {
      // An invalid local DATABASE_URL is handled by the server, not surfaced here.
    }
  }

  return [...new Set(values.filter((value) => value.length >= 4))];
}

function envValue(...keys: string[]) {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function pass(name: string) {
  console.log(`PASS  ${name}`);
}

function warn(name: string, message: string) {
  warnings.push(`${name}: ${message}`);
  console.warn(`WARN  ${name}: ${message}`);
}

function fail(name: string, message: string) {
  failures.push(`${name}: ${message}`);
  console.error(`FAIL  ${name}: ${message}`);
}

async function check(name: string, operation: () => Promise<void>) {
  try {
    await operation();
    pass(name);
  } catch (error) {
    fail(name, error instanceof Error ? error.message : 'Unknown failure');
  }
}

async function request(pathname: string, init: RequestInit = {}): Promise<ApiResult> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const response = await fetch(`${baseUrl}${pathname}`, { ...init, headers });
  const text = await response.text();
  let body: JsonRecord | null = null;

  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as JsonRecord;
  } catch {
    // Some successful document responses are intentionally not JSON.
  }

  return { response, body, text };
}

function message(result: ApiResult) {
  const error = result.body?.error || result.body?.message || result.body?.code;
  return typeof error === 'string' ? error : `HTTP ${result.response.status}`;
}

function expectStatus(result: ApiResult, expected: number | number[], context: string) {
  const statuses = Array.isArray(expected) ? expected : [expected];
  if (!statuses.includes(result.response.status)) {
    throw new Error(`${context} returned ${result.response.status}: ${message(result)}`);
  }
}

function expectSafeError(result: ApiResult, context: string) {
  if (result.response.status >= 500) {
    throw new Error(`${context} returned unexpected ${result.response.status}: ${message(result)}`);
  }

  const leakedPattern = privateResponsePatterns.find((pattern) => pattern.test(result.text));
  if (leakedPattern) throw new Error(`${context} leaked implementation details matching ${leakedPattern}.`);
}

function authHeaders(user: TestUser): HeadersInit {
  return { Authorization: `Bearer ${user.authToken}` };
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

async function filesRecursively(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? filesRecursively(entryPath) : [entryPath];
  }));
  return nested.flat();
}

async function login(email: string, password: string): Promise<TestUser> {
  const result = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  expectStatus(result, 200, 'Credential login');

  const user = asRecord(result.body?.user);
  const id = user?.id;
  const tenantId = user?.tenantId;
  const authToken = user?.authToken;
  const role = user?.role;
  if (typeof id !== 'string' || typeof tenantId !== 'string' || typeof authToken !== 'string' || typeof role !== 'string') {
    throw new Error('Login response did not contain the expected token and identity fields.');
  }

  return { id, tenantId, authToken, role };
}

async function runOptionalAuthenticatedChecks() {
  const adminEmail = envValue('SECURITY_TEST_ADMIN_EMAIL', 'SMOKE_TEST_EMAIL');
  const adminPassword = envValue('SECURITY_TEST_ADMIN_PASSWORD', 'SMOKE_TEST_PASSWORD');

  if (!adminEmail || !adminPassword) {
    warn('Authenticated security checks', 'Set SECURITY_TEST_ADMIN_EMAIL/PASSWORD (or SMOKE_TEST_EMAIL/PASSWORD) to run token-authenticated validation and admin checks.');
    return;
  }

  let admin: TestUser | undefined;
  await check('HR admin authenticated access', async () => {
    admin = await login(adminEmail, adminPassword);
    if (admin.role !== 'hr_admin') throw new Error(`Expected hr_admin fixture, received ${admin.role}.`);

    const result = await request('/api/roles', { headers: authHeaders(admin) });
    expectStatus(result, 200, 'HR admin roles access');
  });

  if (admin) {
    await check('Authenticated invalid coordinates return 400', async () => {
      const result = await request('/api/clock-in', {
        method: 'POST',
        headers: authHeaders(admin!),
        body: JSON.stringify({ latitude: 999, longitude: 999 }),
      });
      expectStatus(result, 400, 'Clock-in invalid coordinates');
      expectSafeError(result, 'Clock-in invalid coordinates');
    });

    await check('Bad payroll status is rejected safely', async () => {
      const result = await request('/api/payroll/00000000-0000-0000-0000-000000000000/status', {
        method: 'PATCH',
        headers: authHeaders(admin!),
        body: JSON.stringify({ status: 'not_a_status' }),
      });
      expectStatus(result, 400, 'Payroll status validation');
      expectSafeError(result, 'Payroll status validation');
    });

    await check('Invalid payroll identifier is rejected safely', async () => {
      const result = await request('/api/payroll/not-a-uuid/pdf', {
        headers: authHeaders(admin!),
      });
      expectStatus(result, 400, 'Payroll PDF identifier validation');
      expectSafeError(result, 'Payroll PDF identifier validation');
    });

    await check('Bad grievance status is rejected safely', async () => {
      const result = await request('/api/grievances/00000000-0000-0000-0000-000000000000/status', {
        method: 'PATCH',
        headers: authHeaders(admin!),
        body: JSON.stringify({ status: 'not_a_status' }),
      });
      expectStatus(result, 400, 'Grievance status validation');
      expectSafeError(result, 'Grievance status validation');
    });
  }

  const employeeEmail = envValue('SECURITY_TEST_EMPLOYEE_EMAIL');
  const employeePassword = envValue('SECURITY_TEST_EMPLOYEE_PASSWORD');
  if (!employeeEmail || !employeePassword) {
    warn('Employee authorization checks', 'Set SECURITY_TEST_EMPLOYEE_EMAIL/PASSWORD for a role=employee fixture to verify permission denials automatically.');
    return;
  }

  await check('Employee cannot manage roles or approve payroll', async () => {
    const employee = await login(employeeEmail, employeePassword);
    if (employee.role !== 'employee') throw new Error(`Expected employee fixture, received ${employee.role}.`);

    const rolesResult = await request('/api/roles', { headers: authHeaders(employee) });
    expectStatus(rolesResult, 403, 'Employee role management denial');
    expectSafeError(rolesResult, 'Employee role management denial');

    const payrollResult = await request('/api/payroll/00000000-0000-0000-0000-000000000000/status', {
      method: 'PATCH',
      headers: authHeaders(employee),
      body: JSON.stringify({ status: 'approved' }),
    });
    expectStatus(payrollResult, 403, 'Employee payroll approval denial');
    expectSafeError(payrollResult, 'Employee payroll approval denial');
  });
}

async function run() {
  console.log(`Stanza security test: ${baseUrl}`);

  await check('Secret scan', async () => {
    const clientRoots = [path.join(rootDir, 'dist', 'assets')];
    const clientFiles = [
      path.join(rootDir, 'dist', 'index.html'),
      path.join(rootDir, 'dist', 'manifest.webmanifest'),
      path.join(rootDir, 'dist', 'service-worker.js'),
      path.join(rootDir, 'dist', 'offline.html'),
    ];

    if (!clientRoots.every(existsSync) || !clientFiles.every(existsSync)) {
      throw new Error('Build output is missing. Run npm run build before npm run test:security.');
    }

    const assetFiles = await filesRecursively(clientRoots[0]);
    const filesToScan = [...clientFiles, ...assetFiles].filter((file) => /\.(?:html|js|css|json|webmanifest|svg)$/i.test(file));
    const leaks: string[] = [];
    const privateValues = configuredPrivateValues();

    for (const file of filesToScan) {
      const contents = await readFile(file, 'utf8');
      for (const forbidden of forbiddenClientStrings) {
        if (contents.includes(forbidden)) leaks.push(`${path.relative(rootDir, file)} contains ${forbidden}`);
      }
      if (privateValues.some((value) => contents.includes(value))) {
        leaks.push(`${path.relative(rootDir, file)} contains a configured backend-only secret value`);
      }
    }

    if (leaks.length > 0) throw new Error(leaks.join('; '));
  });

  await check('.env is not tracked', async () => {
    const trackedFiles = execFileSync('git', ['ls-files'], { cwd: rootDir, encoding: 'utf8' })
      .split(/\r?\n/)
      .filter(Boolean);
    const trackedEnvFile = trackedFiles.find((file) => /^\.env(?:\.(?:local|production|development))?$/i.test(file));
    if (trackedEnvFile) {
      throw new Error(`SECURITY FAIL: ${trackedEnvFile} is tracked by git. Remove with git rm --cached ${trackedEnvFile}`);
    }
  });

  await check('Dev auth headers require development or explicit opt-in', async () => {
    const serverSource = await readFile(path.join(rootDir, 'server.ts'), 'utf8');
    if (!/function allowDevAuthHeaders\(\)\s*\{\s*return !isProduction\(\) \|\| process\.env\.DEV_AUTH_HEADERS === 'true';\s*\}/s.test(serverSource)) {
      throw new Error('Legacy x-employee-id/x-tenant-id headers are not guarded by NODE_ENV or DEV_AUTH_HEADERS.');
    }
  });

  await check('Security headers', async () => {
    const result = await request('/');
    expectStatus(result, 200, 'Home page');
    const headers = result.response.headers;

    if (headers.has('x-powered-by')) throw new Error('x-powered-by header is exposed.');
    if (headers.get('x-content-type-options')?.toLowerCase() !== 'nosniff') {
      throw new Error('x-content-type-options: nosniff is missing.');
    }
    if (!headers.get('referrer-policy')) throw new Error('referrer-policy header is missing.');
    if (!headers.get('x-frame-options') && !headers.get('content-security-policy')?.includes('frame-ancestors')) {
      throw new Error('x-frame-options or CSP frame-ancestors is missing.');
    }
    if (!headers.get('content-security-policy')) warn('Content Security Policy', 'Not enabled for this server mode. Production Helmet CSP is still expected.');
  });

  await check('Auth-required endpoints reject anonymous access', async () => {
    const endpoints = [
      '/api/notification-settings/me',
      '/api/break-requests/me',
      '/api/roles',
      '/api/payroll',
      '/api/grievances',
      '/api/company-feed/admin',
    ];

    for (const endpoint of endpoints) {
      const result = await request(endpoint);
      expectStatus(result, [401, 403], `${endpoint} anonymous access`);
      expectSafeError(result, `${endpoint} anonymous access`);
    }
  });

  await check('Untrusted identity headers do not grant access', async () => {
    const result = await request('/api/roles', {
      headers: {
        'x-employee-id': '00000000-0000-0000-0000-000000000000',
        'x-tenant-id': '00000000-0000-0000-0000-000000000000',
      },
    });
    expectStatus(result, [401, 403], 'Forged development headers');
    expectSafeError(result, 'Forged development headers');
  });

  await check('Input validation returns safe client errors', async () => {
    const tests: Array<{ name: string; path: string; body: JsonRecord }> = [
      { name: 'invalid login email', path: '/api/auth/login', body: { email: 'not-an-email', password: 'invalid' } },
      { name: 'weak signup password', path: '/api/auth/register-tenant', body: { companyName: '', tenantSlug: '', adminFullName: '', adminEmail: 'not-an-email', adminPassword: 'weak' } },
      { name: 'invalid clock-in coordinates without auth', path: '/api/clock-in', body: { latitude: 999, longitude: 999 } },
    ];

    for (const test of tests) {
      const result = await request(test.path, { method: 'POST', body: JSON.stringify(test.body) });
      expectStatus(result, test.name.includes('clock-in') ? 401 : 400, test.name);
      expectSafeError(result, test.name);
    }
  });

  await check('Invalid UUID route parameter is safe', async () => {
    const result = await request('/api/break-requests/not-a-uuid/review', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'approved' }),
    });
    expectStatus(result, 401, 'Anonymous invalid break request review');
    expectSafeError(result, 'Anonymous invalid break request review');
  });

  await check('Rate-limited auth routes are configured', async () => {
    const serverSource = await readFile(path.join(rootDir, 'server.ts'), 'utf8');
    const requiredBindings = [
      /app\.post\('\/api\/auth\/login',\s*sensitiveAuthRateLimiter/s,
      /app\.post\('\/api\/auth\/register-tenant',\s*sensitiveAuthRateLimiter/s,
      /app\.post\('\/api\/auth\/request-password-reset',\s*authRateLimiter/s,
    ];
    if (!requiredBindings.every((pattern) => pattern.test(serverSource))) {
      throw new Error('One or more sensitive auth routes are missing their configured rate limiter.');
    }
  });

  await runOptionalAuthenticatedChecks();

  if (failures.length > 0) {
    console.error(`\nSecurity checks failed: ${failures.length}`);
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exitCode = 1;
    return;
  }

  console.log(`\nSecurity checks passed.${warnings.length ? ` ${warnings.length} warning(s) require fixture or deployment follow-up.` : ''}`);
}

run().catch((error) => {
  console.error(`FAIL  Security test setup: ${error instanceof Error ? error.message : 'Unknown failure'}`);
  process.exitCode = 1;
});
