import 'dotenv/config';

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import express from 'express';
import type { PoolClient } from 'pg';
import { getDbPool } from '../src/lib/hr-background';
import { presentAuditEvent, recordAuditEvent } from '../src/server/audit/audit-events';
import { assertQrIssuePermission } from '../src/server/qr/qr-token-permissions';
import { registerQrTokenRoutes } from '../src/server/qr/qr-token-routes';
import { QrTokenService } from '../src/server/qr/qr-token-service';
import { QrTokenError, type QrTokenPurpose } from '../src/server/qr/qr-token-types';
import {
  QR_TOKEN_BYTES,
  QR_TOKEN_PATTERN,
  generateOpaqueQrToken,
  getCanonicalQrOrigin,
  hashQrToken,
  isValidQrToken,
} from '../src/server/qr/qr-token-validation';

const TENANT_A = '00000000-0000-4000-8000-000000000001';
const EMPLOYEE_A = '00000000-0000-4000-8000-000000000002';
const EMPLOYEE_B = '00000000-0000-4000-8000-000000000003';
const passes: string[] = [];

function pass(label: string) {
  passes.push(label);
  console.log(`PASS  ${label}`);
}

async function expectQrError(task: Promise<unknown>, code: string) {
  let caught: unknown;
  try {
    await task;
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof QrTokenError, `Expected QrTokenError ${code}.`);
  assert.equal(caught.code, code);
}

const generated = new Set(Array.from({ length: 128 }, () => generateOpaqueQrToken()));
assert.equal(generated.size, 128);
for (const token of generated) {
  assert.match(token, QR_TOKEN_PATTERN);
  assert.equal(Buffer.from(token, 'base64url').byteLength, QR_TOKEN_BYTES);
  assert.equal(hashQrToken(token).length, 64);
}
assert.equal(isValidQrToken('short'), false);
assert.equal(isValidQrToken(`${'a'.repeat(42)}!`), false);
pass('Tokens use 256 bits of cryptographic randomness and URL-safe encoding');

assert.equal(getCanonicalQrOrigin({ NODE_ENV: 'development', APP_BASE_URL: 'http://localhost:3000' }), 'http://localhost:3000');
assert.equal(getCanonicalQrOrigin({ NODE_ENV: 'test', APP_BASE_URL: 'https://example.test' }), 'https://example.test');
assert.throws(() => getCanonicalQrOrigin({ NODE_ENV: 'production', APP_BASE_URL: 'http://example.com' }), /configured safely/);
assert.throws(() => getCanonicalQrOrigin({ NODE_ENV: 'production', APP_BASE_URL: 'https://localhost:3000' }), /configured safely/);
assert.throws(() => getCanonicalQrOrigin({ NODE_ENV: 'production', APP_BASE_URL: 'javascript:alert(1)' }), /configured safely/);
assert.throws(() => getCanonicalQrOrigin({ NODE_ENV: 'production', APP_BASE_URL: 'https://example.com/path' }), /configured safely/);
pass('Canonical origins require configured HTTPS in production and local HTTP only outside production');

type PermissionClientOptions = {
  permissions?: Record<string, { source: 'role_assignment' | 'delegation'; scope: 'company' | 'self' }>;
  activeEmployeeIds?: string[];
  assetEmployeeId?: string | null;
  assetExists?: boolean;
};

function permissionClient(options: PermissionClientOptions): PoolClient {
  return {
    query: async (sql: string, params: unknown[] = []) => {
      if (/SELECT 1 FROM employees/.test(sql)) {
        return { rows: options.activeEmployeeIds?.includes(String(params[1])) ? [{ '?column?': 1 }] : [] };
      }
      if (/FROM assets asset/.test(sql)) {
        return { rows: options.assetExists === false ? [] : [{ id: params[1], employee_id: options.assetEmployeeId || null }] };
      }
      if (/FROM employee_role_assignments/.test(sql) && /UNION ALL/.test(sql)) {
        const permission = options.permissions?.[String(params[2])];
        return {
          rows: permission ? [{
            id: `${permission.source}-fixture`,
            source: permission.source,
            scope_type: permission.scope,
            scope_id: null,
          }] : [],
        };
      }
      return { rows: [] };
    },
  } as unknown as PoolClient;
}

const selfClient = permissionClient({
  activeEmployeeIds: [EMPLOYEE_A, EMPLOYEE_B],
  permissions: { 'qr.employee_badge.self': { source: 'role_assignment', scope: 'self' } },
});
await assertQrIssuePermission(
  selfClient,
  { tenantId: TENANT_A, employeeId: EMPLOYEE_A },
  'employee_verification',
  { employeeId: EMPLOYEE_A },
);
await expectQrError(
  assertQrIssuePermission(
    selfClient,
    { tenantId: TENANT_A, employeeId: EMPLOYEE_A },
    'employee_verification',
    { employeeId: EMPLOYEE_B },
  ),
  'QR_PERMISSION_DENIED',
);
await expectQrError(
  assertQrIssuePermission(
    permissionClient({ activeEmployeeIds: [EMPLOYEE_A] }),
    { tenantId: TENANT_A, employeeId: EMPLOYEE_A },
    'employee_verification',
    { employeeId: EMPLOYEE_A },
  ),
  'QR_PERMISSION_DENIED',
);
await assertQrIssuePermission(
  permissionClient({
    assetExists: true,
    permissions: {
      'assets.manage': { source: 'delegation', scope: 'company' },
      'qr.asset_label.manage': { source: 'delegation', scope: 'company' },
    },
  }),
  { tenantId: TENANT_A, employeeId: EMPLOYEE_A },
  'asset_lookup',
  { assetId: '00000000-0000-4000-8000-000000000004' },
);
await expectQrError(
  assertQrIssuePermission(
    permissionClient({
      assetExists: true,
      permissions: { 'qr.asset_label.manage': { source: 'role_assignment', scope: 'company' } },
    }),
    { tenantId: TENANT_A, employeeId: EMPLOYEE_A },
    'asset_lookup',
    { assetId: '00000000-0000-4000-8000-000000000004' },
  ),
  'QR_PERMISSION_DENIED',
);
await assertQrIssuePermission(
  permissionClient({
    permissions: {
      'hiring.create': { source: 'role_assignment', scope: 'company' },
      'qr.onboarding_invite.manage': { source: 'role_assignment', scope: 'company' },
    },
  }),
  { tenantId: TENANT_A, employeeId: EMPLOYEE_A },
  'onboarding_invite',
  {},
);
pass('Self, managed, delegated, asset, onboarding, and role-name-independent permissions are enforced');

const employeeToken = generateOpaqueQrToken();
const assetToken = generateOpaqueQrToken();
const inviteToken = generateOpaqueQrToken();
const purposeHashes = new Map<string, QrTokenPurpose>([
  [hashQrToken(employeeToken), 'employee_verification'],
  [hashQrToken(assetToken), 'asset_lookup'],
  [hashQrToken(inviteToken), 'onboarding_invite'],
]);
const fakeService = {
  issue: async (_identity: unknown, input: { purpose: QrTokenPurpose }) => ({
    tokenRecordId: '00000000-0000-4000-8000-000000000010',
    purpose: input.purpose,
    encodedUrl: `https://example.test/${input.purpose}/opaque`,
    label: 'Fixture',
    expiresAt: null,
    status: 'active',
    rotatable: true,
    revocable: true,
  }),
  resolvePublic: async (purpose: QrTokenPurpose, tokenHash: string) => (
    purposeHashes.get(tokenHash) === purpose ? { valid: true, purpose } : null
  ),
  rotate: async () => ({ tokenRecordId: 'fixture', purpose: 'employee_verification', encodedUrl: 'https://example.test/opaque' }),
  revoke: async () => ({ success: true, status: 'revoked', alreadyRevoked: false }),
  consumeOnboardingInvite: async (tokenHash: string) => (
    purposeHashes.get(tokenHash) === 'onboarding_invite' ? { consumed: true } : null
  ),
} as unknown as QrTokenService;

const app = express();
app.use(express.json());
const standardAuth: express.RequestHandler = (req, res, next) => {
  if (req.header('x-test-auth') !== 'true') return res.status(401).json({ success: false });
  req.authUser = {
    employeeId: EMPLOYEE_A,
    tenantId: TENANT_A,
    email: 'fixture@example.invalid',
    role: 'employee',
    permissions: [],
  };
  return next();
};
const mutationGuard: express.RequestHandler = (req, res, next) => (
  req.header('origin') === `http://${req.header('host')}`
    ? next()
    : res.status(403).json({ success: false, code: 'CSRF_REJECTED' })
);
let publicLookups = 0;
const publicRateLimiter: express.RequestHandler = (_req, res, next) => {
  publicLookups += 1;
  return publicLookups > 7 ? res.status(429).json({ success: false, code: 'RATE_LIMITED' }) : next();
};
let issuanceAttempts = 0;
const issuanceRateLimiter: express.RequestHandler = (_req, res, next) => {
  issuanceAttempts += 1;
  return issuanceAttempts > 4 ? res.status(429).json({ success: false, code: 'RATE_LIMITED' }) : next();
};
registerQrTokenRoutes(app, {
  standardAuth,
  mutationGuard,
  issuanceRateLimiter,
  publicRateLimiter,
  service: fakeService,
});
const server = http.createServer(app);
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert(address && typeof address === 'object');
const baseUrl = `http://127.0.0.1:${address.port}`;

async function request(pathname: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, init);
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  return { response, body };
}

try {
  const anonymous = await request('/api/qr/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: baseUrl },
    body: JSON.stringify({ purpose: 'employee_verification' }),
  });
  assert.equal(anonymous.response.status, 401);
  const noCsrf = await request('/api/qr/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-auth': 'true' },
    body: JSON.stringify({ purpose: 'employee_verification' }),
  });
  assert.equal(noCsrf.response.status, 403);
  const identityInjection = await request('/api/qr/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: baseUrl, 'x-test-auth': 'true' },
    body: JSON.stringify({ purpose: 'employee_verification', tenantId: TENANT_A, email: 'private@example.com' }),
  });
  assert.equal(identityInjection.response.status, 400);
  const validIssue = await request('/api/qr/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: baseUrl, 'x-test-auth': 'true' },
    body: JSON.stringify({ purpose: 'employee_verification' }),
  });
  assert.equal(validIssue.response.status, 201);
  const issueLimited = await request('/api/qr/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: baseUrl, 'x-test-auth': 'true' },
    body: JSON.stringify({ purpose: 'employee_verification' }),
  });
  assert.equal(issueLimited.response.status, 429);

  const correctEmployee = await request(`/api/public/verify/employee/${employeeToken}`);
  assert.equal(correctEmployee.response.status, 200);
  assert.equal(correctEmployee.response.headers.get('cache-control'), 'no-store');
  assert.equal(correctEmployee.response.headers.get('referrer-policy'), 'no-referrer');
  const wrongEmployeeAsAsset = await request(`/api/public/assets/${employeeToken}`);
  const wrongAssetAsInvite = await request(`/api/public/onboarding-invites/${assetToken}`);
  const wrongInviteAsEmployee = await request(`/api/public/verify/employee/${inviteToken}`);
  assert.equal(wrongEmployeeAsAsset.response.status, 404);
  assert.equal(wrongAssetAsInvite.response.status, 404);
  assert.equal(wrongInviteAsEmployee.response.status, 404);
  assert.deepEqual(wrongEmployeeAsAsset.body, wrongAssetAsInvite.body);
  const malformed = await request('/api/public/verify/employee/not-a-token');
  assert.equal(malformed.response.status, 404);
  assert.deepEqual(malformed.body, wrongEmployeeAsAsset.body);
  assert.equal(malformed.response.headers.get('cache-control'), 'no-store');
  assert.equal(malformed.response.headers.get('referrer-policy'), 'no-referrer');
  await request(`/api/public/verify/employee/${employeeToken}`);
  await request(`/api/public/verify/employee/${employeeToken}`);
  const limited = await request(`/api/public/verify/employee/${employeeToken}`);
  assert.equal(limited.response.status, 429);
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
pass('Public routes are purpose-bound, enumeration-safe, no-store, no-referrer, authenticated for issuance, and rate limited');

const migration = await readFile('src/db/migrations/20260729_add_qr_token_foundation.sql', 'utf8');
const serviceSource = await readFile('src/server/qr/qr-token-service.ts', 'utf8');
const routesSource = await readFile('src/server/qr/qr-token-routes.ts', 'utf8');
const validationSource = await readFile('src/server/qr/qr-token-validation.ts', 'utf8');
const serverSource = await readFile('server.ts', 'utf8');
const workerSource = await readFile('src/workers/hr-worker.ts', 'utf8');
assert.match(migration, /UNIQUE \(id, tenant_id\)/);
assert.match(migration, /UNIQUE \(token_hash\)/);
assert.match(migration, /FOREIGN KEY \(employee_id, tenant_id\)/);
assert.match(migration, /FOREIGN KEY \(asset_id, tenant_id\)/);
assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
assert.match(migration, /current_setting\('app\.current_tenant'/);
assert.doesNotMatch(migration, /qr_(?:image|base64)|data:image/i);
assert.match(serviceSource, /FOR UPDATE/);
assert.match(serviceSource, /status='used'/);
assert.match(serviceSource, /status='revoked'/);
assert.match(serviceSource, /status='expired'/);
assert.match(serviceSource, /token_hash/);
assert.doesNotMatch(serviceSource, /Math\.random/);
assert.doesNotMatch(serviceSource, /INSERT INTO (?:employees|assets|hiring_applicants|tenants)\b/i);
assert.doesNotMatch(routesSource, /req\.(?:hostname|host)|x-forwarded-host/i);
assert.doesNotMatch(validationSource, /stanza\.pages\.dev/i);
assert.match(serverSource, /qrPublicResolutionRateLimiter/);
assert.match(serverSource, /qrIssuanceRateLimiter/);
assert.match(workerSource, /expireQrAccessToken/);
pass('Schema, RLS, hashing, rate limits, worker cleanup, and no-business-mutation contracts hold');

const projection = presentAuditEvent('qr.token_issued', 'qr_access_token', {
  tokenRecordId: '00000000-0000-4000-8000-000000000010',
  purpose: 'employee_verification',
  subjectType: 'employee',
  issuerEmployeeId: EMPLOYEE_A,
  status: 'active',
  expiresAt: null,
  singleUse: false,
  token: employeeToken,
  tokenHash: hashQrToken(employeeToken),
  encodedUrl: `https://example.test/verify/employee/${employeeToken}`,
  email: 'private@example.com',
  assetSerial: 'PRIVATE-SERIAL',
});
assert(!('token' in projection.metadata));
assert(!('tokenHash' in projection.metadata));
assert(!('encodedUrl' in projection.metadata));
assert(!('email' in projection.metadata));
assert(!('assetSerial' in projection.metadata));

const auditClient = { query: async () => ({ rows: [], rowCount: 1 }) } as unknown as PoolClient;
await assert.rejects(() => recordAuditEvent(auditClient, {
  tenantId: TENANT_A,
  actorId: EMPLOYEE_A,
  action: 'qr.token_issued',
  targetType: 'qr_access_token',
  targetId: '00000000-0000-4000-8000-000000000010',
  metadata: {
    tokenRecordId: '00000000-0000-4000-8000-000000000010',
    purpose: 'employee_verification',
    subjectType: 'employee',
    issuerEmployeeId: EMPLOYEE_A,
    status: 'active',
    expiresAt: null,
    singleUse: false,
    token: employeeToken,
  },
}));
await recordAuditEvent(auditClient, {
  tenantId: TENANT_A,
  actorId: EMPLOYEE_A,
  action: 'qr.token_issued',
  targetType: 'qr_access_token',
  targetId: '00000000-0000-4000-8000-000000000010',
  metadata: {
    tokenRecordId: '00000000-0000-4000-8000-000000000010',
    purpose: 'employee_verification',
    subjectType: 'employee',
    issuerEmployeeId: EMPLOYEE_A,
    status: 'active',
    expiresAt: null,
    singleUse: false,
  },
});
pass('Audit projection and writer reject token material and sensitive subject data');

if (process.env.DATABASE_URL) {
  const pool = getDbPool();
  const tenant = await pool.query('SELECT id FROM tenants ORDER BY created_at LIMIT 1');
  assert(tenant.rows[0], 'Local QR concurrency test requires one existing tenant.');
  const tenantId = tenant.rows[0].id as string;
  const service = new QrTokenService();
  const cleanupTokenRecordIds: string[] = [];
  const raw = generateOpaqueQrToken();
  const tokenHash = hashQrToken(raw);
  const inserted = await pool.query(
    `INSERT INTO qr_access_tokens (
       tenant_id,purpose,subject_type,token_hash,status,expires_at,single_use,metadata
     ) VALUES ($1,'onboarding_invite','onboarding_invite',$2,'active',NOW()+INTERVAL '15 minutes',true,NULL)
     RETURNING id`,
    [tenantId, tokenHash],
  );
  const tokenRecordId = inserted.rows[0].id as string;
  cleanupTokenRecordIds.push(tokenRecordId);
  try {
    const concurrent = await Promise.all([
      service.consumeOnboardingInvite(tokenHash),
      service.consumeOnboardingInvite(tokenHash),
    ]);
    assert.equal(concurrent.filter(Boolean).length, 1);
    assert.equal(await service.consumeOnboardingInvite(tokenHash), null);
    const state = await pool.query('SELECT status,used_at FROM qr_access_tokens WHERE id=$1', [tokenRecordId]);
    assert.equal(state.rows[0].status, 'used');
    assert(state.rows[0].used_at);

    const expiredRaw = generateOpaqueQrToken();
    const expired = await pool.query(
      `INSERT INTO qr_access_tokens (
         tenant_id,purpose,subject_type,token_hash,status,expires_at,single_use,metadata
       ) VALUES ($1,'onboarding_invite','onboarding_invite',$2,'active',NOW()-INTERVAL '1 minute',true,NULL)
       RETURNING id`,
      [tenantId, hashQrToken(expiredRaw)],
    );
    const expiredTokenRecordId = expired.rows[0].id as string;
    cleanupTokenRecordIds.push(expiredTokenRecordId);
    assert.equal(await service.expireToken(tenantId, expiredTokenRecordId), true);
    assert.equal(await service.expireToken(tenantId, expiredTokenRecordId), false);
    assert.equal(await service.resolvePublic('onboarding_invite', hashQrToken(expiredRaw)), null);

    const badgeActor = (await pool.query(
      `SELECT employee.tenant_id AS "tenantId",employee.id AS "employeeId"
       FROM employees employee
       JOIN employee_role_assignments assignment
         ON assignment.tenant_id=employee.tenant_id AND assignment.employee_id=employee.id
       JOIN tenant_role_permissions permission
         ON permission.tenant_id=assignment.tenant_id AND permission.role_id=assignment.role_id
       WHERE employee.is_active=true AND employee.employment_status='active'
         AND assignment.revoked_at IS NULL
         AND assignment.assigned_at<=NOW()
         AND (assignment.expires_at IS NULL OR assignment.expires_at>NOW())
         AND permission.permission_key='qr.employee_badge.self'
         AND NOT EXISTS (
           SELECT 1 FROM qr_access_tokens token
           WHERE token.tenant_id=employee.tenant_id
             AND token.employee_id=employee.id
             AND token.purpose='employee_verification'
             AND token.status='active'
         )
       ORDER BY employee.created_at
       LIMIT 1`,
    )).rows[0] as { tenantId: string; employeeId: string } | undefined;
    assert(badgeActor, 'Local QR lifecycle test requires one active employee with self-badge authority.');
    const oldBadgeRaw = generateOpaqueQrToken();
    const oldBadge = (await pool.query(
      `INSERT INTO qr_access_tokens (
         tenant_id,purpose,subject_type,employee_id,token_hash,status,single_use,metadata
       ) VALUES ($1,'employee_verification','employee',$2,$3,'active',false,NULL)
       RETURNING id`,
      [badgeActor.tenantId, badgeActor.employeeId, hashQrToken(oldBadgeRaw)],
    )).rows[0];
    cleanupTokenRecordIds.push(oldBadge.id);

    const rotated = await service.rotate(badgeActor, oldBadge.id);
    cleanupTokenRecordIds.push(rotated.tokenRecordId);
    const rotatedRaw = new URL(rotated.encodedUrl).pathname.split('/').at(-1);
    assert(rotatedRaw && isValidQrToken(rotatedRaw));
    assert.equal(await service.resolvePublic('employee_verification', hashQrToken(oldBadgeRaw)), null);
    assert(await service.resolvePublic('employee_verification', hashQrToken(rotatedRaw)));
    await expectQrError(service.rotate(badgeActor, oldBadge.id), 'QR_TOKEN_NOT_ACTIVE');

    const otherTenant = (await pool.query(
      'SELECT id FROM tenants WHERE id<>$1 ORDER BY created_at LIMIT 1',
      [badgeActor.tenantId],
    )).rows[0]?.id as string | undefined;
    assert(otherTenant, 'Local QR isolation test requires a second tenant.');
    await expectQrError(
      service.revoke({ tenantId: otherTenant, employeeId: badgeActor.employeeId }, rotated.tokenRecordId),
      'QR_TOKEN_NOT_FOUND',
    );

    const revoked = await service.revoke(badgeActor, rotated.tokenRecordId);
    assert.equal(revoked.alreadyRevoked, false);
    assert.equal(await service.resolvePublic('employee_verification', hashQrToken(rotatedRaw)), null);
    const repeatedRevoke = await service.revoke(badgeActor, rotated.tokenRecordId);
    assert.equal(repeatedRevoke.alreadyRevoked, true);
  } finally {
    await pool.query(
      'DELETE FROM audit_logs WHERE entity_type=$1 AND entity_id=ANY($2::uuid[])',
      ['qr_access_token', cleanupTokenRecordIds],
    );
    await pool.query('DELETE FROM qr_access_tokens WHERE id=ANY($1::uuid[])', [cleanupTokenRecordIds]);
    await pool.end();
  }
  pass('PostgreSQL enforces atomic consumption, tenant isolation, rotation, revocation, and idempotent expiry');
} else {
  console.warn('WARN  DATABASE_URL is not set; PostgreSQL concurrency probe was deferred.');
}

console.log(`\nQR security contracts passed: ${passes.length}`);
