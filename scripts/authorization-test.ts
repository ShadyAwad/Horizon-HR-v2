import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { assertHttpMutationSafety } from './mutation-safety';

type RecordValue = Record<string, any>;
const source = await readFile(new URL('../server.ts', import.meta.url), 'utf8');
const guards = await readFile(new URL('../src/server/organisation/legacy-role-routes.ts', import.meta.url), 'utf8');
assert(source.includes('registerLegacyRoleMutationRoutes(app'), 'Legacy authorization routes are not mounted.');
const baseUrl = assertHttpMutationSafety(process.env.AUTHZ_TEST_BASE_URL || 'http://localhost:3000', 'Authorization test');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function pass(message: string) {
  console.log(`PASS  ${message}`);
}

const permissionMigration = await readFile(new URL('../src/db/migrations/20261003_runtime_database_role.sql', import.meta.url), 'utf8');
assert(permissionMigration.includes("'roles.assign_privileged'"), 'Privileged assignment permission is not defined.');
assert(guards.includes('targetLevel > actorLevel'), 'Server-side privilege rank check is missing.');
assert(guards.includes('employeeId === actorEmployeeId && targetLevel > actorLevel'), 'Self-escalation protection is missing.');
assert(guards.includes('Only an authorized tenant administrator may assign HR Admin.'), 'HR Admin assignment boundary is missing.');
assert(guards.includes('You cannot remove your own privileged role.'), 'Self-removal protection is missing.');
pass('Privileged role authorization guards are present in server source');

const adminEmail = process.env.AUTHZ_ADMIN_EMAIL;
const adminPassword = process.env.AUTHZ_ADMIN_PASSWORD;
const managerEmail = process.env.AUTHZ_MANAGER_EMAIL;
const managerPassword = process.env.AUTHZ_MANAGER_PASSWORD;

if (!adminEmail || !adminPassword || !managerEmail || !managerPassword) {
  console.log('SKIP  Live authorization checks (set AUTHZ_ADMIN_EMAIL/PASSWORD and AUTHZ_MANAGER_EMAIL/PASSWORD).');
  process.exit(0);
}

async function login(email: string, password: string) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json() as RecordValue;
  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
  assert(response.ok && cookie && body.user?.id, `Login failed with HTTP ${response.status}.`);
  return { user: body.user as RecordValue, cookie };
}

async function api(path: string, session: { cookie: string }, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Cookie', session.cookie);
  headers.set('Origin', baseUrl);
  if (init.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const body = await response.json().catch(() => ({})) as RecordValue;
  return { response, body };
}

const admin = await login(adminEmail, adminPassword);
const manager = await login(managerEmail, managerPassword);
const roles = await api('/api/roles', admin);
assert(roles.response.ok, `Unable to load roles: HTTP ${roles.response.status}.`);
// The legacy /api/roles contract returns PostgreSQL snake_case fields.
const hrRole = (roles.body.roles || []).find((role: RecordValue) => role.system_key === 'hr_admin');
assert(hrRole?.id, 'HR Admin system role was not returned.');

const managerAttempt = await api(`/api/employees/${manager.user.id}/roles`, manager, {
  method: 'POST',
  body: JSON.stringify({ roleId: hrRole.id }),
});
assert(managerAttempt.response.status === 403, `Manager privilege escalation returned HTTP ${managerAttempt.response.status}.`);
pass('Manager cannot assign HR Admin to self');

if (process.env.AUTHZ_OTHER_TENANT_EMPLOYEE_ID) {
  const crossTenantAttempt = await api(`/api/employees/${process.env.AUTHZ_OTHER_TENANT_EMPLOYEE_ID}/roles`, admin, {
    method: 'POST',
    body: JSON.stringify({ roleId: hrRole.id }),
  });
  assert([403, 404].includes(crossTenantAttempt.response.status), `Cross-tenant assignment returned HTTP ${crossTenantAttempt.response.status}.`);
  pass('Cross-tenant role assignment is rejected');
} else {
  console.log('SKIP  Cross-tenant assignment check (set AUTHZ_OTHER_TENANT_EMPLOYEE_ID).');
}
