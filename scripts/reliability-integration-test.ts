import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { ASSET_CATEGORIES } from '../src/lib/asset-categories';
import { assertDatabaseMutationSafety, assertHttpMutationSafety } from './mutation-safety';

for (const file of ['src/components/assets/AssetFormDialog.tsx', 'src/components/organisation/RolesPermissionsPanel.tsx']) {
  const source = await readFile(file, 'utf8');
  assert.match(source, /headers:[^\n]*'Content-Type': 'application\/json'/, `${file} must identify its serialized JSON body`);
}
const base = assertHttpMutationSafety(process.env.RELIABILITY_TEST_BASE_URL || 'http://localhost:3002', 'Reliability integration');
assertDatabaseMutationSafety(process.env.DATABASE_URL, 'Reliability integration');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const roleIds: string[] = [], assetIds: string[] = [];
let cookie = '', tenantId = '';
async function request(path: string, body?: unknown, origin = base, authenticated = true) {
  const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { Origin: origin, ...(authenticated ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json(), response };
}
try {
  assert(process.env.RELIABILITY_ADMIN_EMAIL && process.env.RELIABILITY_ADMIN_PASSWORD, 'Supply isolated HR admin credentials.');
  const login = await request('/api/auth/login', { email: process.env.RELIABILITY_ADMIN_EMAIL, password: process.env.RELIABILITY_ADMIN_PASSWORD });
  assert.equal(login.status, 200);
  cookie = login.response.headers.get('set-cookie')!.split(';')[0];
  tenantId = login.body.user.tenantId;
  assert(cookie && tenantId);
  const session = await request('/api/auth/session');
  assert.equal(session.status, 200);
  const reviews = await request('/api/me/performance/reviews');
  assert.equal(reviews.status, 200, JSON.stringify(reviews.body));
  assert(Array.isArray(reviews.body.reviews));
  console.log('PASS actual personal-review PostgreSQL route: no 42P01, response preserved');

  const payload = { name: `Reliability fixture ${randomUUID()}`, description: 'Temporary regression fixture' };
  assert.equal((await request('/api/hr/organisation/roles', payload, base, false)).status, 401);
  assert.equal((await request('/api/hr/organisation/roles', payload, 'https://untrusted.invalid')).status, 403);
  const untyped = await fetch(base + '/api/hr/organisation/roles', { method: 'POST', headers: { Origin: base, Cookie: cookie }, body: JSON.stringify(payload) });
  assert.equal(untyped.status, 400, 'Untyped JSON reproduces parsing failure, not a session 401');
  if (process.env.RELIABILITY_EMPLOYEE_EMAIL && process.env.RELIABILITY_EMPLOYEE_PASSWORD) {
    const employeeLogin = await request('/api/auth/login', { email: process.env.RELIABILITY_EMPLOYEE_EMAIL, password: process.env.RELIABILITY_EMPLOYEE_PASSWORD });
    assert.equal(employeeLogin.status, 200);
    const adminCookie = cookie;
    cookie = employeeLogin.response.headers.get('set-cookie')!.split(';')[0];
    try { assert.equal((await request('/api/hr/organisation/roles', payload)).status, 403); }
    finally { await request('/api/auth/logout', {}); cookie = adminCookie; }
    console.log('PASS employee without roles.manage cannot create roles');
  }
  const created = await request('/api/hr/organisation/roles', payload);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  roleIds.push(created.body.role.id);
  const audit = await pool.query("SELECT 1 FROM audit_logs WHERE tenant_id=$1 AND entity_id=$2 AND action='organisation.role.created'", [tenantId, roleIds[0]]);
  assert.equal(audit.rowCount, 1);
  console.log('PASS cookie-authenticated HR role creation, same-origin guard and transactional audit');

  for (const category of ASSET_CATEGORIES) {
    const result = await request('/api/hr/assets', { category, assetTag: `TEST-${randomUUID()}`, name: `Reliability ${category}` });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    assetIds.push(result.body.asset.id);
    assert.equal(result.body.asset.category, category);
  }
  assert.equal((await request('/api/hr/assets', { category: 'arbitrary', assetTag: 'invalid', name: 'invalid' })).status, 400);
  console.log('PASS all nine asset categories accepted through JSON API; unknown category rejected');
  const status = await request('/api/document-extractions/status');
  assert.equal(status.status, 200);
  assert.equal(status.body.state, 'unavailable');
  assert.equal(status.body.configured, false);
  const badge = await request('/api/me/digital-badge');
  assert.equal(badge.status, 200, JSON.stringify(badge.body));
  assert.equal(badge.body.badge.verificationUnavailable, true);
  assert.equal(badge.body.badge.verificationUrl, null);
  console.log('PASS honest extraction and QR origin configuration status');
} finally {
  if (tenantId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_tenant',$1,true)", [tenantId]);
      await client.query('DELETE FROM assets WHERE tenant_id=$1 AND id=ANY($2::uuid[])', [tenantId, assetIds]);
      await client.query('DELETE FROM tenant_roles WHERE tenant_id=$1 AND id=ANY($2::uuid[])', [tenantId, roleIds]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  if (cookie) await request('/api/auth/logout', {});
  await pool.end();
}
