import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { assertHttpMutationSafety } from './mutation-safety';

type RecordValue = Record<string, any>;
const source = await readFile(new URL('../server.ts', import.meta.url), 'utf8');
const baseUrl = assertHttpMutationSafety(process.env.AUTHZ_TEST_BASE_URL || 'http://localhost:3000', 'Authorization test');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function pass(message: string) {
  console.log(`PASS  ${message}`);
}

assert(source.includes("'roles.assign_privileged'"), 'Privileged assignment permission is not defined.');
assert(source.includes('targetLevel > actorLevel'), 'Server-side privilege rank check is missing.');
assert(source.includes('employeeId === actorEmployeeId && targetLevel > actorLevel'), 'Self-escalation protection is missing.');
assert(source.includes('Only an authorized tenant administrator may assign HR Admin.'), 'HR Admin assignment boundary is missing.');
assert(source.includes('You cannot remove your own privileged role.'), 'Self-removal protection is missing.');
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
  if (init.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const body = await response.json().catch(() => ({})) as RecordValue;
  return { response, body };
}

const admin = await login(adminEmail, adminPassword);
const manager = await login(managerEmail, managerPassword);
const roles = await api('/api/roles', admin);
assert(roles.response.ok, `Unable to load roles: HTTP ${roles.response.status}.`);
const hrRole = (roles.body.roles || []).find((role: RecordValue) => role.systemKey === 'hr_admin');
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
