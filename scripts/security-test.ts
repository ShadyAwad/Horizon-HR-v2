import 'dotenv/config';

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  assertPortfolioDemoSessionStartup,
  getPortfolioDemoSessionConfig,
  parsePortfolioDemoRole,
} from '../src/server/portfolio-demo-session';
import {
  assertTryCloudflareDevOriginsStartup,
  isAllowedTryCloudflareDevOrigin,
  isTryCloudflareDevOriginsEnabled,
  shouldTrustTryCloudflareDevProxy,
} from '../src/server/trycloudflare-dev';

type JsonRecord = Record<string, unknown>;

type ApiResult = {
  response: Response;
  body: JsonRecord | null;
  text: string;
};

type TestUser = {
  id: string;
  tenantId: string;
  sessionCookie: string;
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
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

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
  return { Cookie: user.sessionCookie };
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
  const role = user?.role;
  const sessionCookie = result.response.headers.get('set-cookie')?.split(';', 1)[0];
  if (typeof id !== 'string' || typeof tenantId !== 'string' || typeof role !== 'string' || !sessionCookie) {
    throw new Error('Login response did not establish an authenticated session cookie.');
  }

  return { id, tenantId, sessionCookie, role };
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

    await check('Company Feed rejects malformed editor documents', async () => {
      const result = await request('/api/company-feed/posts', {
        method: 'POST',
        headers: authHeaders(admin!),
        body: JSON.stringify({
          title: 'Security validation probe',
          postType: 'announcement',
          contentText: 'Visible text',
          contentJson: {
            root: {
              type: 'root',
              children: [{ type: 'script', children: [{ type: 'text', text: 'Visible text' }] }],
            },
          },
          status: 'draft',
          visibility: [{ type: 'all' }],
          editorFormat: 'lexical-v1',
          editorSchemaVersion: 1,
        }),
      });
      expectStatus(result, 400, 'Company Feed malformed editor document');
      expectSafeError(result, 'Company Feed malformed editor document');
    });

    await check('Company Feed image upload rejects decoded SVG input', async () => {
      const form = new FormData();
      form.append('image', new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], { type: 'image/png' }), 'forged.png');
      form.append('altText', 'Forged image');
      const result = await request('/api/company-feed/images', {
        method: 'POST',
        headers: authHeaders(admin!),
        body: form,
      });
      expectStatus(result, [415, 422], 'Company Feed decoded SVG rejection');
      expectSafeError(result, 'Company Feed decoded SVG rejection');
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

async function runOptionalPortfolioDemoSessionChecks() {
  if (process.env.PORTFOLIO_DEMO_SESSION_TEST !== 'true') {
    const disabled = await request('/api/auth/demo-session', {
      method: 'POST',
      body: JSON.stringify({ role: 'employee' }),
    });
    expectStatus(disabled, 404, 'Portfolio demo session disabled by default');
    pass('Portfolio demo session is unavailable without demo mode');
    warn('Portfolio demo session runtime checks', 'Set PORTFOLIO_DEMO_SESSION_TEST=true against the isolated demo target to verify session cookies and rate limiting.');
    return;
  }

  const tenantIds = new Set<string>();
  for (const role of ['hr_admin', 'manager', 'employee'] as const) {
    const result = await request('/api/auth/demo-session', {
      method: 'POST',
      headers: { Origin: baseUrl },
      body: JSON.stringify({ role }),
    });
    expectStatus(result, 200, `Portfolio demo ${role} session`);
    const user = asRecord(result.body?.user);
    const cookie = result.response.headers.get('set-cookie') || '';
    if (user?.role !== role || typeof user?.tenantId !== 'string') {
      throw new Error(`Portfolio demo ${role} response returned an unexpected identity.`);
    }
    if (!/HttpOnly/i.test(cookie) || !/SameSite=Lax/i.test(cookie) || !/stanza_session=/i.test(cookie)) {
      throw new Error(`Portfolio demo ${role} session did not set the hardened cookie.`);
    }
    if (baseUrl.startsWith('https://') && !/;\s*Secure/i.test(cookie)) {
      throw new Error(`Portfolio demo ${role} HTTPS session did not set Secure.`);
    }
    if (/\bDomain=/i.test(cookie)) {
      throw new Error(`Portfolio demo ${role} session set an explicit cookie domain.`);
    }
    if (/password|token|hash/i.test(JSON.stringify(result.body))) {
      throw new Error(`Portfolio demo ${role} response exposed credential material.`);
    }
    tenantIds.add(user.tenantId);

    const sessionResult = await request('/api/auth/session', {
      headers: { Cookie: cookie.split(';', 1)[0] },
    });
    expectStatus(sessionResult, 200, `Portfolio demo ${role} session restore`);
    const restoredUser = asRecord(sessionResult.body?.user);
    if (restoredUser?.role !== role || restoredUser?.tenantId !== user.tenantId) {
      throw new Error(`Portfolio demo ${role} session did not restore the same tenant identity.`);
    }

    const logoutResult = await request('/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: cookie.split(';', 1)[0] },
    });
    expectStatus(logoutResult, 200, `Portfolio demo ${role} logout`);
    if (!/stanza_session=;.*Max-Age=0/i.test(logoutResult.response.headers.get('set-cookie') || '')) {
      throw new Error(`Portfolio demo ${role} logout did not clear the session cookie.`);
    }

    const revokedSession = await request('/api/auth/session', {
      headers: { Cookie: cookie.split(';', 1)[0] },
    });
    expectStatus(revokedSession, 401, `Portfolio demo ${role} revoked session`);
  }
  if (tenantIds.size !== 1) throw new Error('Portfolio demo roles were not scoped to one tenant.');

  const arbitraryFields = await request('/api/auth/demo-session', {
    method: 'POST',
    headers: { Origin: baseUrl },
    body: JSON.stringify({ role: 'employee', email: 'attacker@example.test', tenantId: '00000000-0000-0000-0000-000000000000' }),
  });
  expectStatus(arbitraryFields, 400, 'Portfolio demo arbitrary identity fields');

  const crossOrigin = await request('/api/auth/demo-session', {
    method: 'POST',
    headers: { Origin: 'https://attacker.example', 'Sec-Fetch-Site': 'cross-site' },
    body: JSON.stringify({ role: 'employee' }),
  });
  expectStatus(crossOrigin, 403, 'Portfolio demo cross-origin request');

  let rateLimited = false;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const result = await request('/api/auth/demo-session', {
      method: 'POST',
      headers: { Origin: baseUrl },
      body: JSON.stringify({ role: 'employee' }),
    });
    if (result.response.status === 429) {
      rateLimited = true;
      break;
    }
  }
  if (!rateLimited) throw new Error('Portfolio demo session rate limiting did not activate.');
  pass('Portfolio demo session cookies, tenant isolation, origin checks, and rate limiting');
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
    if (!/function allowDevAuthHeaders\(\)\s*\{\s*return !isProduction\(\) && process\.env\.DEV_AUTH_HEADERS === 'true';/s.test(serverSource)) {
      throw new Error('Legacy x-employee-id/x-tenant-id headers are not guarded by NODE_ENV or DEV_AUTH_HEADERS.');
    }
  });

  await check('Portfolio demo session is explicitly gated', async () => {
    if (getPortfolioDemoSessionConfig({}) !== null) {
      throw new Error('Portfolio demo session is enabled without explicit configuration.');
    }
    if (getPortfolioDemoSessionConfig({
      STANZA_DEMO_ENV: 'true',
      ENABLE_PORTFOLIO_DEMO_SESSION: 'true',
    }) === null) {
      throw new Error('Valid isolated demo configuration was rejected.');
    }
    if (parsePortfolioDemoRole({ role: 'hr_admin', email: 'attacker@example.test' }) !== null
      || parsePortfolioDemoRole({ role: 'owner' }) !== null
      || parsePortfolioDemoRole({ tenantId: 'attacker' }) !== null) {
      throw new Error('Portfolio demo session accepts caller-controlled identity fields.');
    }
    let startupBlocked = false;
    try {
      assertPortfolioDemoSessionStartup({ NODE_ENV: 'production', ENABLE_PORTFOLIO_DEMO_SESSION: 'true', STANZA_DEMO_ENV: 'false' });
    } catch {
      startupBlocked = true;
    }
    if (!startupBlocked) throw new Error('Production startup permits portfolio demo sessions outside demo mode.');
  });

  await check('Cloudflare Quick Tunnel origin support is explicit and development-only', async () => {
    const enabledDevelopment = {
      NODE_ENV: 'development',
      ALLOW_TRYCLOUDFLARE_DEV_ORIGINS: 'true',
    };
    const allowedOrigin = 'https://stanza-random-quick-tunnel.trycloudflare.com';

    if (isTryCloudflareDevOriginsEnabled({}) || isAllowedTryCloudflareDevOrigin(allowedOrigin, {})) {
      throw new Error('Quick Tunnel origins are enabled by default.');
    }
    if (!isAllowedTryCloudflareDevOrigin(allowedOrigin, enabledDevelopment)) {
      throw new Error('An explicitly enabled HTTPS Quick Tunnel origin was rejected.');
    }
    for (const rejectedOrigin of [
      'http://stanza-random-quick-tunnel.trycloudflare.com',
      'https://trycloudflare.com',
      'https://trycloudflare.com.evil.example',
      'https://stanza-random-quick-tunnel.trycloudflare.com.evil.example',
      'https://attacker.example',
    ]) {
      if (isAllowedTryCloudflareDevOrigin(rejectedOrigin, enabledDevelopment)) {
        throw new Error(`Unsafe tunnel origin was accepted: ${rejectedOrigin}`);
      }
    }
    if (!shouldTrustTryCloudflareDevProxy('127.0.0.1', 0, enabledDevelopment)
      || !shouldTrustTryCloudflareDevProxy('::1', 0, enabledDevelopment)
      || shouldTrustTryCloudflareDevProxy('203.0.113.10', 0, enabledDevelopment)
      || shouldTrustTryCloudflareDevProxy('127.0.0.1', 1, enabledDevelopment)) {
      throw new Error('Quick Tunnel proxy trust is not restricted to one loopback hop.');
    }

    let productionBlocked = false;
    try {
      assertTryCloudflareDevOriginsStartup({
        NODE_ENV: 'production',
        ALLOW_TRYCLOUDFLARE_DEV_ORIGINS: 'true',
      });
    } catch {
      productionBlocked = true;
    }
    if (!productionBlocked || isTryCloudflareDevOriginsEnabled({
      NODE_ENV: 'production',
      ALLOW_TRYCLOUDFLARE_DEV_ORIGINS: 'true',
    })) {
      throw new Error('Production permits the development Quick Tunnel origin bypass.');
    }

    const viteConfig = await readFile(path.join(rootDir, 'vite.config.ts'), 'utf8');
    if (!viteConfig.includes("allowedHosts: allowTryCloudflareDevOrigins ? ['.trycloudflare.com'] : []")
      || /[a-z]+(?:-[a-z]+){2,}\.trycloudflare\.com/.test(viteConfig)) {
      throw new Error('Vite does not gate dynamic Quick Tunnel hosts or still hardcodes a random tunnel hostname.');
    }
  });

  await check('Original dashboard lanyard is demo-independent and ships its production asset', async () => {
    const dashboardSource = await readFile(path.join(rootDir, 'src', 'pages', 'Dashboard.tsx'), 'utf8');
    const lanyardSource = await readFile(path.join(rootDir, 'src', 'components', 'lanyard', 'Lanyard.tsx'), 'utf8');
    if (dashboardSource.includes('VITE_ENABLE_DEMO_LOGIN')) {
      throw new Error('Dashboard lanyard visibility is coupled to the demo-login build flag.');
    }
    if (dashboardSource.includes('DashboardLanyardFallback') || dashboardSource.includes('data-lanyard-visibility="fallback"')) {
      throw new Error('A static dashboard fallback is replacing or competing with the original lanyard.');
    }
    const requiredSceneFeatures = ['<Canvas', '<Physics', 'useRopeJoint(', 'useSphericalJoint(', 'onPointerDown=', 'cardGLB'];
    if (!dashboardSource.includes('<StanzaDashboardLanyard')
      || !requiredSceneFeatures.every((feature) => lanyardSource.includes(feature))) {
      throw new Error('The original Canvas, Rapier joints, GLB card, or drag interaction is missing.');
    }
    const assetFiles = await filesRecursively(path.join(rootDir, 'dist', 'assets'));
    if (!assetFiles.some((file) => /^card-[\w-]+\.glb$/i.test(path.basename(file)))) {
      throw new Error('The production build does not include the lanyard GLB asset.');
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
    const contentSecurityPolicy = headers.get('content-security-policy') || '';
    if (contentSecurityPolicy && contentSecurityPolicy.includes("'unsafe-eval'")) {
      throw new Error('Content Security Policy enables unrestricted JavaScript eval.');
    }
    if (process.env.NODE_ENV === 'production' && !contentSecurityPolicy.includes("'wasm-unsafe-eval'")) {
      throw new Error('Production CSP does not permit the Rapier WebAssembly runtime.');
    }
    if (process.env.NODE_ENV === 'production' && !/connect-src[^;]*\bblob:/i.test(contentSecurityPolicy)) {
      throw new Error('Production CSP does not permit GLTF embedded-texture decoding.');
    }
  });

  await check('Auth-required endpoints reject anonymous access', async () => {
    const endpoints = [
      '/api/notification-settings/me',
      '/api/break-requests/me',
      '/api/roles',
      '/api/payroll',
      '/api/grievances',
      '/api/company-feed/admin',
      '/api/company-feed/images/00000000-0000-0000-0000-000000000000',
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

  await check('Login and recovery responses do not enumerate accounts', async () => {
    const unknownEmail = `security-check-${Date.now()}@example.test`;
    const loginResult = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: unknownEmail, password: 'not-the-password' }),
    });
    expectStatus(loginResult, 401, 'Unknown account login');
    expectSafeError(loginResult, 'Unknown account login');
    if (loginResult.body?.error !== 'Invalid email or password.') {
      throw new Error('Unknown account login did not use the generic credential error.');
    }

    const recoveryResult = await request('/api/auth/request-password-reset', {
      method: 'POST',
      body: JSON.stringify({ email: unknownEmail, method: 'email' }),
    });
    expectStatus(recoveryResult, 200, 'Unknown account recovery');
    expectSafeError(recoveryResult, 'Unknown account recovery');
    if (recoveryResult.body?.message !== 'If an account exists, password reset instructions have been sent.') {
      throw new Error('Unknown account recovery did not use the generic response.');
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
      /app\.post\('\/api\/auth\/register-tenant',\s*signupRateLimiter/s,
      /app\.post\('\/api\/auth\/request-password-reset',\s*passwordResetRequestRateLimiter/s,
      /app\.post\('\/api\/auth\/reset-password',\s*passwordResetConfirmRateLimiter/s,
      /app\.post\('\/api\/auth\/passkeys\/login\/options',\s*passkeyLoginRateLimiter/s,
      /app\.post\('\/api\/auth\/passkeys\/login\/verify',\s*passkeyLoginRateLimiter/s,
      /app\.post\('\/api\/auth\/demo-session',\s*portfolioDemoSessionRateLimiter/s,
    ];
    if (!requiredBindings.every((pattern) => pattern.test(serverSource))) {
      throw new Error('One or more sensitive auth routes are missing their configured rate limiter.');
    }
  });

  await runOptionalAuthenticatedChecks();
  await runOptionalPortfolioDemoSessionChecks();

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
