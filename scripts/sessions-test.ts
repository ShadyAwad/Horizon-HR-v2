import 'dotenv/config';
import { readFile } from 'node:fs/promises';

type Json = Record<string, any>;
const baseUrl = (process.env.SESSIONS_TEST_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const origin = baseUrl;
const passes: string[] = [];
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
const pass = (label: string) => { passes.push(label); console.log(`PASS  ${label}`); };

async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.json().catch(() => ({})) as Json;
  return { response, body };
}

async function demoSession(role: 'hr_admin' | 'manager' | 'employee') {
  const result = await request('/api/auth/demo-session', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ role }) });
  assert(result.response.status === 200, `${role} session setup failed (${result.response.status}). Run against explicit demo mode.`);
  const cookie = result.response.headers.get('set-cookie')?.split(';', 1)[0];
  assert(cookie && /HttpOnly/i.test(result.response.headers.get('set-cookie') || ''), 'Session cookie was not HttpOnly.');
  return { cookie, user: result.body.user as Json };
}

async function run() {
  const [serverSource, dashboardSource, selfPanel, centerPanel, schema, migration] = await Promise.all([
    readFile('server.ts', 'utf8'), readFile('src/pages/Dashboard.tsx', 'utf8'),
    readFile('src/components/sessions/SessionManagementPanel.tsx', 'utf8'), readFile('src/components/sessions/SessionCenterPanel.tsx', 'utf8'),
    readFile('src/db/schema.sql', 'utf8'), readFile('src/db/migrations/20260724_add_active_session_management.sql', 'utf8'),
  ]);
  for (const route of ['/api/auth/sessions', '/api/auth/sessions/revoke-others', '/api/hr/session-center']) assert(serverSource.includes(route), `Missing ${route}.`);
  assert(serverSource.includes("requirePermission('sessions.manage')") && serverSource.includes('requireHrAdminSessionCenter'), 'HR session center is not permission-gated.');
  assert(schema.includes('device_label') && migration.includes('sessions.manage'), 'Safe session metadata or migration is missing.');
  assert(selfPanel.includes('md:hidden') && centerPanel.includes('md:hidden') && dashboardSource.includes('SessionCenterPanel'), 'Responsive session UI is missing.');
  pass('Session APIs, safe metadata migration, and responsive UI contract');

  const anonymous = await request('/api/auth/sessions');
  assert(anonymous.response.status === 401, `Anonymous session list returned ${anonymous.response.status}.`);
  pass('Anonymous session access is denied');

  const adminA = await demoSession('hr_admin');
  const adminB = await demoSession('hr_admin');
  const manager = await demoSession('manager');
  const own = await request('/api/auth/sessions', { headers: { Cookie: adminA.cookie } });
  assert(own.response.status === 200 && Array.isArray(own.body.sessions), 'Self session list failed.');
  assert(own.body.sessions.some((session: Json) => session.isCurrent), 'Current session is not identified.');
  assert(own.body.sessions.every((session: Json) => !('session_token_hash' in session || 'token' in session || 'ip' in session)), 'Sensitive session data leaked.');
  assert(!own.body.sessions.some((session: Json) => session.employeeId === manager.user.id), 'Self session list exposed another employee.');
  pass('Self-only visibility, current identification, masked projection, and no token leakage');

  const current = own.body.sessions.find((session: Json) => session.isCurrent) as Json;
  const currentRevoke = await request(`/api/auth/sessions/${current.id}`, { method: 'DELETE', headers: { Cookie: adminA.cookie, Origin: origin } });
  assert(currentRevoke.response.status === 409, `Current-session protection returned ${currentRevoke.response.status}.`);
  const csrf = await request(`/api/auth/sessions/${adminB.user.id}`, { method: 'DELETE', headers: { Cookie: adminA.cookie, Origin: 'https://attacker.example', 'Sec-Fetch-Site': 'cross-site' } });
  assert(csrf.response.status === 403, `CSRF rejection returned ${csrf.response.status}.`);
  pass('Current-session protection and CSRF enforcement');

  const centerDenied = await request('/api/hr/session-center', { headers: { Cookie: manager.cookie } });
  assert(centerDenied.response.status === 403, `Manager session center returned ${centerDenied.response.status}.`);
  const center = await request('/api/hr/session-center', { headers: { Cookie: adminA.cookie } });
  assert(center.response.status === 200 && Array.isArray(center.body.sessions), 'HR session center failed.');
  const managerSession = (center.body.sessions as Json[]).find((session) => session.employee?.id === manager.user.id && session.status === 'active');
  assert(managerSession, 'HR center did not return manager session.');
  const adminRevoke = await request(`/api/hr/session-center/${managerSession.id}`, { method: 'DELETE', headers: { Cookie: adminA.cookie, Origin: origin } });
  assert(adminRevoke.response.status === 200, `Admin revoke returned ${adminRevoke.response.status}.`);
  const revokedRequest = await request('/api/auth/session', { headers: { Cookie: manager.cookie } });
  assert(revokedRequest.response.status === 401, `Revoked session still authenticated (${revokedRequest.response.status}).`);
  pass('HR permission, tenant session management, and revoked-session rejection');

  const revokeOthers = await request('/api/auth/sessions/revoke-others', { method: 'POST', headers: { Cookie: adminA.cookie, Origin: origin } });
  assert(revokeOthers.response.status === 200, `Revoke others returned ${revokeOthers.response.status}.`);
  const stillCurrent = await request('/api/auth/session', { headers: { Cookie: adminA.cookie } });
  assert(stillCurrent.response.status === 200, 'Revoke others ended the current session.');
  const oldOther = await request('/api/auth/session', { headers: { Cookie: adminB.cookie } });
  assert(oldOther.response.status === 401, 'Revoke others did not revoke another session.');
  pass('Revoke all others preserves current session');

  console.log(`\nSession tests passed: ${passes.length}`);
}

run().catch((error) => { console.error(`FAIL  ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
