import 'dotenv/config';
import { assertHttpMutationSafety } from './mutation-safety';

type JsonRecord = Record<string, unknown>;

type ApiResult = {
  response: Response;
  body: JsonRecord | null;
};

type SmokeUser = {
  id: string;
  tenantId: string;
  role: string;
};

const baseUrl = assertHttpMutationSafety(process.env.SMOKE_TEST_BASE_URL || 'http://localhost:3000', 'Smoke test');
const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}`;
const smokePrefix = `Smoke Test ${runId}`;
const failures: string[] = [];
let authenticatedHeaders: HeadersInit | undefined;
let sessionCookie: string | undefined;
let createdBreakRequestId: string | undefined;

function getRequiredEnv(...keys: string[]) {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }

  return undefined;
}

async function request(path: string, init: RequestInit = {}): Promise<ApiResult> {
  const headers = new Headers(init.headers);

  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (sessionCookie && !headers.has('Cookie')) headers.set('Cookie', sessionCookie);

  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) sessionCookie = setCookie.split(';', 1)[0];
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json')
    ? await response.json().catch(() => null) as JsonRecord | null
    : null;

  return { response, body };
}

function responseMessage(result: ApiResult) {
  const message = result.body?.error || result.body?.message || result.body?.code;
  return typeof message === 'string' ? message : `HTTP ${result.response.status}`;
}

function pass(name: string) {
  console.log(`PASS  ${name}`);
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

function expectStatus(result: ApiResult, expected: number | number[], context: string) {
  const statuses = Array.isArray(expected) ? expected : [expected];
  if (!statuses.includes(result.response.status)) {
    throw new Error(`${context} returned ${result.response.status}: ${responseMessage(result)}`);
  }
}

function expectNoServerError(result: ApiResult, context: string) {
  if (result.response.status >= 500) {
    throw new Error(`${context} returned ${result.response.status}: ${responseMessage(result)}`);
  }
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

async function cleanupBreakRequest() {
  if (!createdBreakRequestId || !authenticatedHeaders) return;

  const result = await request(`/api/break-requests/${createdBreakRequestId}/cancel`, {
    method: 'POST',
    headers: authenticatedHeaders,
  });

  if (result.response.ok || result.response.status === 409 || result.response.status === 404) {
    console.log('CLEAN  Created break request removed or already closed.');
    return;
  }

  console.warn(`WARN   Unable to remove smoke break request: ${responseMessage(result)}`);
}

async function run() {
  const email = getRequiredEnv('SMOKE_TEST_EMAIL', 'SMOKE_TEST_ADMIN_EMAIL', 'DEMO_ADMIN_EMAIL');
  const password = getRequiredEnv('SMOKE_TEST_PASSWORD', 'SMOKE_TEST_ADMIN_PASSWORD', 'DEMO_ADMIN_PASSWORD');

  console.log(`Stanza backend smoke test: ${baseUrl}`);

  if (!email || !password) {
    throw new Error(
      'Set SMOKE_TEST_EMAIL and SMOKE_TEST_PASSWORD for a local hr_admin account before running the smoke test.',
    );
  }

  await check('System health', async () => {
    const result = await request('/api/system/health');
    expectStatus(result, 200, 'System health');
    if (result.body?.success !== true) throw new Error('System health did not return success: true');
  });

  let user: SmokeUser | undefined;
  await check('Admin login', async () => {
    const result = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    expectStatus(result, 200, 'Login');

    const loginUser = asRecord(result.body?.user);
    const id = loginUser?.id;
    const tenantId = loginUser?.tenantId;
    const role = loginUser?.role;

    if (typeof id !== 'string' || typeof tenantId !== 'string' || typeof role !== 'string' || !sessionCookie) {
      throw new Error('Login response did not establish an authenticated session cookie.');
    }

    if (role !== 'hr_admin') {
      throw new Error(`Smoke credentials must belong to an hr_admin account; received ${role}.`);
    }

    user = { id, tenantId, role };
    authenticatedHeaders = {
      'x-employee-id': id,
      'x-tenant-id': tenantId,
    };
  });

  if (!user || !authenticatedHeaders) {
    throw new Error('Authenticated smoke checks were skipped because login failed.');
  }

  await check('Duplicate signup email is rejected without creating a workspace', async () => {
    const result = await request('/api/auth/register-tenant', {
      method: 'POST',
      body: JSON.stringify({
        companyName: 'Smoke Test Duplicate Email',
        tenantSlug: `smoke-duplicate-${runId}`.slice(0, 60),
        adminFullName: 'Smoke Test Admin',
        adminEmail: email,
        adminPassword: password,
        adminRole: 'hr_admin',
        currency: 'USD',
        capacity: '100-500',
        locations: [{
          name: 'Smoke Test Worksite',
          locationType: 'headquarters',
          latitude: 30.0444,
          longitude: 31.2357,
          radius: 100,
          isPrimary: true,
          isActive: true,
        }],
      }),
    });
    expectStatus(result, 409, 'Duplicate signup email');
    if (result.body?.code !== 'EMAIL_UNAVAILABLE') {
      throw new Error('Duplicate signup did not return EMAIL_UNAVAILABLE.');
    }
  });

  await check('Notification settings load', async () => {
    const result = await request('/api/notification-settings/me', { headers: authenticatedHeaders });
    expectStatus(result, 200, 'Notification settings');
  });

  await check('Break request create and list', async () => {
    const createResult = await request('/api/break-requests', {
      method: 'POST',
      headers: authenticatedHeaders,
      body: JSON.stringify({
        requestedStartTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        durationMinutes: 15,
        reason: `${smokePrefix} break request`,
      }),
    });
    expectStatus(createResult, 201, 'Break request create');

    const breakRequest = asRecord(createResult.body?.breakRequest);
    if (typeof breakRequest?.id !== 'string') throw new Error('Break request response did not include an id.');
    createdBreakRequestId = breakRequest.id;

    const listResult = await request('/api/break-requests/me', { headers: authenticatedHeaders });
    expectStatus(listResult, 200, 'Break request list');
    const breakRequests = Array.isArray(listResult.body?.breakRequests) ? listResult.body.breakRequests : [];
    const found = breakRequests.some((item) => asRecord(item)?.id === createdBreakRequestId);
    if (!found) throw new Error('Created break request was not returned by /api/break-requests/me.');
  });

  await check('Clock-in rejects invalid coordinates', async () => {
    const result = await request('/api/clock-in', {
      method: 'POST',
      headers: authenticatedHeaders,
      body: JSON.stringify({ latitude: 91, longitude: 181 }),
    });
    expectStatus(result, 400, 'Clock-in invalid coordinate validation');
  });

  await check('Clock-in rejects missing authentication', async () => {
    const result = await request('/api/clock-in', {
      method: 'POST',
      body: JSON.stringify({ latitude: 30.0444, longitude: 31.2357 }),
    });
    expectStatus(result, 401, 'Clock-in missing authentication');
  });

  await check('Payroll list', async () => {
    const result = await request('/api/payroll', { headers: authenticatedHeaders });
    expectStatus(result, 200, 'Payroll list');
    if (!Array.isArray(result.body?.payroll)) throw new Error('Payroll response did not include a payroll array.');
  });

  await check('Payroll validation rejects invalid identifiers and periods', async () => {
    const invalidIdResult = await request('/api/payroll/not-a-uuid/pdf', { headers: authenticatedHeaders });
    expectStatus(invalidIdResult, 400, 'Payroll PDF invalid id');

    const today = new Date().toISOString().slice(0, 10);
    const invalidPeriodResult = await request('/api/payroll/run', {
      method: 'POST',
      headers: authenticatedHeaders,
      body: JSON.stringify({ payPeriodStart: today, payPeriodEnd: today, bonuses: 0, deductions: 0 }),
    });
    expectStatus(invalidPeriodResult, 400, 'Payroll same-day period validation');
  });

  await check('Company feed list and draft creation', async () => {
    const listResult = await request('/api/company-feed', { headers: authenticatedHeaders });
    expectStatus(listResult, 200, 'Company feed list');

    const createResult = await request('/api/company-feed/posts', {
      method: 'POST',
      headers: authenticatedHeaders,
      body: JSON.stringify({
        title: `${smokePrefix} draft`,
        postType: 'announcement',
        contentText: 'Harmless automated smoke-test draft. It may be safely archived from the Company Feed admin panel.',
        contentJson: null,
        status: 'draft',
        visibility: [{ type: 'all' }],
      }),
    });
    expectStatus(createResult, 201, 'Company feed draft create');
  });

  await check('Grievance create and tenant list', async () => {
    const createResult = await request('/api/grievances', {
      method: 'POST',
      headers: authenticatedHeaders,
      body: JSON.stringify({
        title: `${smokePrefix} grievance`,
        description: 'Harmless automated smoke-test grievance. It may be resolved from the Grievances panel.',
        category: 'general',
        priority: 'low',
      }),
    });
    expectStatus(createResult, 201, 'Grievance create');

    const grievance = asRecord(createResult.body?.grievance);
    const grievanceId = grievance?.id;
    if (typeof grievanceId !== 'string') throw new Error('Grievance response did not include an id.');

    const listResult = await request('/api/grievances', { headers: authenticatedHeaders });
    expectStatus(listResult, 200, 'Grievance list');
    const grievances = Array.isArray(listResult.body?.grievances) ? listResult.body.grievances : [];
    const found = grievances.some((item) => asRecord(item)?.id === grievanceId);
    if (!found) throw new Error('Created grievance was not returned by /api/grievances.');
  });

  await check('Signup validation rejects malformed payload safely', async () => {
    const result = await request('/api/auth/register-tenant', {
      method: 'POST',
      body: JSON.stringify({ companyName: '', adminEmail: 'not-an-email', adminPassword: 'weak', locations: [] }),
    });
    expectStatus(result, 400, 'Signup validation');
    if (result.body?.code !== 'VALIDATION_ERROR') throw new Error('Signup validation did not return VALIDATION_ERROR.');
  });

  await cleanupBreakRequest();

  if (failures.length > 0) {
    console.error(`\nSmoke test failed with ${failures.length} check(s):`);
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exitCode = 1;
    return;
  }

  console.log('\nSmoke test completed successfully.');
}

run()
  .catch(async (error) => {
    await cleanupBreakRequest();
    console.error(`FAIL  Smoke test setup: ${error instanceof Error ? error.message : 'Unknown failure'}`);
    process.exitCode = 1;
  });
