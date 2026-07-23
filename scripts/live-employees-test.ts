import 'dotenv/config';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_LIVE_EMPLOYEE_OVERDUE_HOURS,
  deriveLiveEmployeeStatus,
  getLiveEmployeeOverdueHours,
} from '../src/server/live-employees/live-employees-rules';
import {
  filterLiveEmployees,
  formatElapsedMinutes,
  summarizeLiveEmployees,
} from '../src/lib/live-employees';
import type { LiveEmployee } from '../src/api/live-employees';

const root = new URL('../', import.meta.url);
let passed = 0;

function test(name: string, callback: () => void) {
  callback();
  passed += 1;
  console.log(`PASS ${name}`);
}

const baseEmployee: LiveEmployee = {
  employeeId: '00000000-0000-4000-8000-000000000001',
  displayName: 'Live Test Employee',
  avatarUrl: null,
  department: null,
  role: 'Support Specialist',
  clockInTime: '2026-07-23T08:00:00.000Z',
  elapsedMinutes: 60,
  status: 'clocked_in',
  isValidGeofence: true,
  geofenceName: 'Headquarters',
  currentBreakStartedAt: null,
  lastAttendanceActivityAt: '2026-07-23T08:00:00.000Z',
};

test('status derivation covers clocked in, break, and overdue precedence', () => {
  assert.equal(deriveLiveEmployeeStatus(60, false), 'clocked_in');
  assert.equal(deriveLiveEmployeeStatus(60, true), 'on_break');
  assert.equal(deriveLiveEmployeeStatus(12 * 60, true), 'overdue');
});

test('overdue threshold configuration is bounded and defaults safely', () => {
  assert.equal(getLiveEmployeeOverdueHours('9'), 9);
  assert.equal(getLiveEmployeeOverdueHours('0'), DEFAULT_LIVE_EMPLOYEE_OVERDUE_HOURS);
  assert.equal(getLiveEmployeeOverdueHours('production'), DEFAULT_LIVE_EMPLOYEE_OVERDUE_HOURS);
});

test('summary counts an overdue employee on break in both relevant totals', () => {
  const overdueBreak = { ...baseEmployee, status: 'overdue' as const, currentBreakStartedAt: '2026-07-23T10:00:00.000Z' };
  assert.deepEqual(summarizeLiveEmployees([baseEmployee, overdueBreak]), {
    total: 2,
    clockedIn: 1,
    onBreak: 1,
    overdue: 1,
  });
});

test('search and status/geofence filters are deterministic', () => {
  const onBreak = { ...baseEmployee, employeeId: '2', displayName: 'Mona Hassan', status: 'on_break' as const, currentBreakStartedAt: '2026-07-23T09:00:00.000Z' };
  const invalid = { ...baseEmployee, employeeId: '3', displayName: 'Omar Ali', isValidGeofence: false, geofenceName: null };
  const employees = [baseEmployee, onBreak, invalid];
  assert.deepEqual(filterLiveEmployees(employees, 'on_break', '').map((item) => item.employeeId), ['2']);
  assert.deepEqual(filterLiveEmployees(employees, 'invalid_geofence', '').map((item) => item.employeeId), ['3']);
  assert.deepEqual(filterLiveEmployees(employees, 'all', 'mona').map((item) => item.employeeId), ['2']);
});

test('elapsed duration formatting is stable', () => {
  assert.equal(formatElapsedMinutes(125), '2h 5m');
  assert.equal(formatElapsedMinutes(-1), '0m');
});

const routeSource = await readFile(new URL('../src/server/live-employees/live-employees-routes.ts', import.meta.url), 'utf8');
const dashboardSource = await readFile(new URL('../src/pages/Dashboard.tsx', import.meta.url), 'utf8');
const panelSource = await readFile(new URL('../src/components/live-employees/LiveEmployeesPanel.tsx', import.meta.url), 'utf8');
const languageSource = await readFile(new URL('../src/lib/LanguageContext.tsx', import.meta.url), 'utf8');

test('endpoint requires authentication, exact HR role, and live-attendance permission', () => {
  assert.match(routeSource, /demoAuth,\s*requireRole\(\['hr_admin'\]\),\s*requirePermission\('attendance\.view_live'\)/s);
});

test('query is tenant scoped and excludes inactive or closed-shift employees', () => {
  assert.match(routeSource, /time_log\.tenant_id = \$1/);
  assert.match(routeSource, /time_log\.clock_out_time IS NULL/);
  assert.match(routeSource, /employee\.is_active = TRUE/);
  assert.match(routeSource, /employee\.employment_status = 'active'/);
  assert.match(routeSource, /withTenant\(tenantId/);
});

test('query resolves break and geofence data without N+1 route queries', () => {
  assert.match(routeSource, /LEFT JOIN LATERAL[\s\S]+break_requests/);
  assert.match(routeSource, /LEFT JOIN LATERAL[\s\S]+company_locations/);
  assert.equal((routeSource.match(/client\.query/g) || []).length, 1);
});

test('public contract minimizes employee and location data', () => {
  for (const forbidden of ['email AS', 'salary', 'phone', 'latitude AS', 'longitude AS', 'clock_in_location AS']) {
    assert.equal(routeSource.includes(forbidden), false, `unexpected response projection: ${forbidden}`);
  }
});

test('dashboard exposes the panel only to HR admins with the permission boundary', () => {
  assert.match(dashboardSource, /user\.role === 'hr_admin' && hasPermission\(user, 'attendance\.view_live'\)/);
  assert.match(dashboardSource, /activeTab === 'liveEmployees' && canViewLiveEmployees/);
});

test('polling pauses while hidden, refreshes on visibility, and aborts on cleanup', () => {
  assert.match(panelSource, /POLL_INTERVAL_MS = 30_000/);
  assert.match(panelSource, /document\.visibilityState === 'visible'/);
  assert.match(panelSource, /visibilitychange/);
  assert.match(panelSource, /requestRef\.current\?\.abort\(\)/);
  assert.match(panelSource, /if \(inFlightRef\.current\) return/);
});

test('English and Arabic live employee translations are present', () => {
  assert.match(languageSource, /'liveEmployees\.title': 'Live Employees'/);
  assert.match(languageSource, /'liveEmployees\.title': 'الموظفون المباشرون'/);
});

console.log(`\n${passed} live-employee checks passed from ${root.pathname}`);

if (process.env.LIVE_EMPLOYEES_INTEGRATION === 'true') {
  const baseUrl = process.env.LIVE_EMPLOYEES_TEST_BASE_URL || 'http://localhost:3000';
  const password = process.env.LIVE_EMPLOYEES_TEST_PASSWORD;
  assert(password, 'Set LIVE_EMPLOYEES_TEST_PASSWORD for authenticated integration checks.');

  async function login(email: string) {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const body = await response.json() as { user?: { id: string; tenantId: string }; error?: string };
    const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
    assert(response.ok && body.user && cookie, `Login failed for ${email}: ${body.error || response.status}`);
    return { user: body.user, cookie };
  }

  async function requestLiveEmployees(cookie?: string) {
    return fetch(`${baseUrl}/api/hr/live-employees`, {
      headers: cookie ? { Cookie: cookie } : undefined,
    });
  }

  const admin = await login(process.env.LIVE_EMPLOYEES_TEST_ADMIN_EMAIL || 'admin@stanza-demo.com');
  const manager = await login(process.env.LIVE_EMPLOYEES_TEST_MANAGER_EMAIL || 'manager@stanza-demo.com');
  const employee = await login(process.env.LIVE_EMPLOYEES_TEST_EMPLOYEE_EMAIL || 'employee@stanza-demo.com');

  assert.equal((await requestLiveEmployees()).status, 401, 'anonymous request must return 401');
  assert.equal((await requestLiveEmployees(manager.cookie)).status, 403, 'manager request must return 403');
  assert.equal((await requestLiveEmployees(employee.cookie)).status, 403, 'employee request must return 403');

  const adminResponse = await requestLiveEmployees(admin.cookie);
  const adminBody = await adminResponse.json() as { success: boolean; employees: LiveEmployee[] };
  assert.equal(adminResponse.status, 200, 'HR admin request must return 200');
  assert.equal(adminBody.success, true);
  assert(Array.isArray(adminBody.employees));

  const ids = adminBody.employees.map((item) => item.employeeId);
  assert.equal(new Set(ids).size, ids.length, 'live response must not duplicate employees');
  for (const liveEmployee of adminBody.employees) {
    assert.deepEqual(
      Object.keys(liveEmployee).sort(),
      [
        'avatarUrl', 'clockInTime', 'currentBreakStartedAt', 'department', 'displayName',
        'elapsedMinutes', 'employeeId', 'geofenceName', 'isValidGeofence',
        'lastAttendanceActivityAt', 'role', 'status',
      ].sort(),
      'live response exposed an unexpected field',
    );
  }

  const { getDbPool } = await import('../src/lib/hr-background');
  const tenantRows = await getDbPool().query<{ id: string }>(
    'SELECT id FROM employees WHERE tenant_id = $1',
    [admin.user.tenantId],
  );
  const tenantEmployeeIds = new Set(tenantRows.rows.map((row) => row.id));
  assert(ids.every((id) => tenantEmployeeIds.has(id)), 'response included a cross-tenant employee');

  const rank = { overdue: 0, on_break: 1, clocked_in: 2 } as const;
  const sorted = [...adminBody.employees].sort((left, right) => (
    rank[left.status] - rank[right.status]
    || Date.parse(left.clockInTime) - Date.parse(right.clockInTime)
    || left.employeeId.localeCompare(right.employeeId)
  ));
  assert.deepEqual(ids, sorted.map((item) => item.employeeId), 'response ordering is not deterministic');
  await getDbPool().end();

  console.log('PASS authenticated HR/manager/employee, tenant-isolation, privacy, and ordering checks');
}
