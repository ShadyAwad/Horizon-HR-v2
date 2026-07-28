import 'dotenv/config';

import { readFile } from 'node:fs/promises';
import type { PoolClient } from 'pg';
import { getDbPool } from '../src/lib/hr-background';
import { presentAuditEvent, recordAuditEvent } from '../src/server/audit/audit-events';

type JsonObject = Record<string, any>;

const baseUrl = (process.env.AUDIT_TEST_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const passes: string[] = [];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function pass(label: string) {
  passes.push(label);
  console.log(`PASS  ${label}`);
}

async function api(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.json().catch(() => ({})) as JsonObject;
  return { response, body };
}

async function demoSession(role: 'hr_admin' | 'manager' | 'employee') {
  const email = { hr_admin: 'admin@stanza-demo.com', manager: 'manager@stanza-demo.com', employee: 'employee@stanza-demo.com' }[role];
  const result = await api('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: baseUrl },
    body: JSON.stringify({ email, password: process.env.DEMO_PASSWORD || 'StrongPass!123' }),
  });
  assert(result.response.status === 200, `${role} demo session failed with ${result.response.status}.`);
  const cookie = result.response.headers.get('set-cookie')?.split(';', 1)[0];
  assert(cookie, `${role} demo session did not return a session cookie.`);
  return { cookie, user: result.body.user as JsonObject };
}

async function run() {
  const sensitiveProjection = presentAuditEvent('employee_compensation_updated', 'employee_compensation_profile', {
    baseAmount: 125000,
    salary: 125000,
    employeeId: '00000000-0000-4000-8000-000000000000',
    payType: 'salary',
    currency: 'USD',
    effectiveFrom: '2026-07-01',
  });
  assert(sensitiveProjection.action === 'employee.salary.updated', 'Legacy salary action was not normalized.');
  assert(!('baseAmount' in sensitiveProjection.metadata) && !('salary' in sensitiveProjection.metadata), 'Salary values escaped projection.');

  const coordinateProjection = presentAuditEvent('clock_in', 'time_log', {
    latitude: 30.0444,
    longitude: 31.2357,
    matchedLocation: 'Headquarters',
    locationValid: true,
  });
  assert(!('latitude' in coordinateProjection.metadata) && !('longitude' in coordinateProjection.metadata), 'Precise coordinates escaped projection.');

  const grievanceProjection = presentAuditEvent('grievance_created', 'grievance', {
    title: 'Private grievance title',
    description: 'Private grievance body',
    anonymousEmployeeId: '00000000-0000-4000-8000-000000000000',
  });
  assert(Object.keys(grievanceProjection.metadata).length === 0, 'Private grievance fields escaped projection.');

  const unknownProjection = presentAuditEvent('legacy_unknown_action', 'unknown_record', {
    password: 'not-safe',
    token: 'not-safe',
    details: 'not-safe',
  });
  assert(unknownProjection.summary === 'Audit event recorded' && Object.keys(unknownProjection.metadata).length === 0, 'Unknown actions do not fail closed.');
  pass('Legacy mapping, unknown fallback, and sensitive metadata redaction');

  const roleProjection = presentAuditEvent('organisation.role.duplicated', 'tenant_role', {
    sourceRoleId: '00000000-0000-4000-8000-000000000004',
    isSystem: false,
    permissionCount: 3,
    description: 'Must not be exposed',
  });
  assert(roleProjection.module === 'organisation' && roleProjection.metadata.permissionCount === 3, 'Organisation role audit metadata was not projected.');
  assert(!('description' in roleProjection.metadata), 'Role description escaped audit projection.');
  pass('Organisation role lifecycle audit events expose safe metadata only');

  const permissionProjection = presentAuditEvent('organisation.role.permissions_updated', 'tenant_role', {
    roleId: '00000000-0000-4000-8000-000000000004',
    previousPermissionCount: 2,
    newPermissionCount: 3,
    addedCount: 2,
    removedCount: 1,
    permissionKeys: ['must-not-appear'],
  });
  assert(permissionProjection.metadata.addedCount === 2 && !('permissionKeys' in permissionProjection.metadata), 'Role permission audit must contain counts only.');
  pass('Role permission audit keeps only aggregate counts');

  const capturedWrites: Array<{ query: string; values: unknown[] }> = [];
  const auditClient = {
    query: async (query: string, values: unknown[]) => {
      capturedWrites.push({ query, values });
      return { rows: [], rowCount: 1 };
    },
  } as unknown as PoolClient;
  await recordAuditEvent(auditClient, {
    tenantId: '00000000-0000-4000-8000-000000000001',
    actorId: '00000000-0000-4000-8000-000000000002',
    action: 'employee.salary.updated',
    targetType: 'employee',
    targetId: '00000000-0000-4000-8000-000000000003',
    metadata: { payType: 'monthly', currency: 'USD', effectiveFrom: '2026-07-01' },
  });
  assert(capturedWrites.length === 1, 'Safe audit metadata was not written.');
  let rejectedSensitiveWrite = false;
  try {
    await recordAuditEvent(auditClient, {
      tenantId: '00000000-0000-4000-8000-000000000001',
      actorId: '00000000-0000-4000-8000-000000000002',
      action: 'employee.salary.updated',
      targetType: 'employee',
      targetId: '00000000-0000-4000-8000-000000000003',
      metadata: { payType: 'monthly', baseAmount: 125000 },
    });
  } catch {
    rejectedSensitiveWrite = true;
  }
  assert(rejectedSensitiveWrite && capturedWrites.length === 1, 'Forbidden audit metadata reached SQL.');
  await recordAuditEvent(auditClient, {
    tenantId: '00000000-0000-4000-8000-000000000001',
    actorId: '00000000-0000-4000-8000-000000000002',
    action: 'organisation.role.archived',
    targetType: 'tenant_role',
    targetId: '00000000-0000-4000-8000-000000000003',
    metadata: { isSystem: false, activeAssignmentCount: 0 },
  });
  assert(capturedWrites.at(-1)?.values.includes('organisation.role.archived'), 'Safe organisation role audit metadata was not written.');
  await recordAuditEvent(auditClient, {
    tenantId: '00000000-0000-4000-8000-000000000001',
    actorId: '00000000-0000-4000-8000-000000000002',
    action: 'organisation.role.permissions_updated',
    targetType: 'tenant_role',
    targetId: '00000000-0000-4000-8000-000000000003',
    metadata: { roleId: '00000000-0000-4000-8000-000000000003', previousPermissionCount: 1, newPermissionCount: 2, addedCount: 1, removedCount: 0 },
  });
  assert(capturedWrites.at(-1)?.values.includes('organisation.role.permissions_updated'), 'Safe role permission audit metadata was not written.');
  pass('Audit writer allowlist rejects sensitive metadata before persistence');

  const [dashboardSource, panelSource, translationsSource] = await Promise.all([
    readFile('src/pages/Dashboard.tsx', 'utf8'),
    readFile('src/components/audit/AuditTrailPanel.tsx', 'utf8'),
    readFile('src/lib/LanguageContext.tsx', 'utf8'),
  ]);
  assert(dashboardSource.includes("lazy(() => import('../components/audit/AuditTrailPanel')"), 'Audit panel is not lazy loaded.');
  assert(dashboardSource.includes("hasPermission(user, 'audit.view')"), 'Audit navigation is not permission gated.');
  assert(panelSource.includes("dir={isRtl ? 'rtl' : 'ltr'}"), 'Audit panel does not support RTL.');
  assert(panelSource.includes('md:hidden') && panelSource.includes('hidden overflow-hidden'), 'Responsive table/card layouts are missing.');
  assert(panelSource.includes('audit.empty') && panelSource.includes('audit.error') && panelSource.includes('audit.loading'), 'Audit loading, error, or empty state is missing.');
  assert(translationsSource.includes("'audit.title': 'Audit Trail'") && translationsSource.includes("'audit.title': 'سجل التدقيق'"), 'English or Arabic audit translations are missing.');
  pass('Lazy, permission-gated, responsive, bilingual Audit Trail UI contract');

  const anonymous = await api('/api/hr/audit-events');
  assert(anonymous.response.status === 401, `Anonymous audit request returned ${anonymous.response.status}.`);
  pass('Anonymous access denied');

  const admin = await demoSession('hr_admin');
  const manager = await demoSession('manager');
  const employee = await demoSession('employee');

  for (const [label, session] of [['manager', manager], ['employee', employee]] as const) {
    const denied = await api('/api/hr/audit-events', { headers: { Cookie: session.cookie } });
    assert(denied.response.status === 403, `${label} audit request returned ${denied.response.status}.`);
  }
  pass('Manager and employee denied by default');

  const firstPage = await api('/api/hr/audit-events?page=1&pageSize=5', { headers: { Cookie: admin.cookie } });
  assert(firstPage.response.status === 200 && firstPage.body.success === true, 'HR Admin could not load audit events.');
  assert(firstPage.body.page === 1 && firstPage.body.pageSize === 5, 'Audit pagination response is incorrect.');
  assert(Array.isArray(firstPage.body.events) && firstPage.body.events.length <= 5, 'Audit page size is not enforced.');
  assert(firstPage.body.summary && Number.isFinite(firstPage.body.summary.eventsToday), 'Audit summary is missing.');
  assert(Array.isArray(firstPage.body.filters?.actions) && Array.isArray(firstPage.body.filters?.actors), 'Safe filter facets are missing.');
  assert(!('details' in firstPage.body) && !('audit_logs' in firstPage.body), 'Raw audit details were returned.');
  pass('HR Admin access, summary, and server-side pagination');

  const capped = await api('/api/hr/audit-events?pageSize=500', { headers: { Cookie: admin.cookie } });
  assert(capped.response.status === 200 && capped.body.pageSize === 100, 'Maximum page size was not capped at 100.');
  const malformed = await api('/api/hr/audit-events?page=zero&actorId=invalid', { headers: { Cookie: admin.cookie } });
  assert(malformed.response.status === 400 && malformed.body.code === 'AUDIT_QUERY_INVALID', 'Malformed query values were not rejected safely.');
  pass('Maximum page size and malformed query validation');

  const events = firstPage.body.events as JsonObject[];
  if (events.length > 0) {
    const first = events[0];
    const actionFiltered = await api(`/api/hr/audit-events?action=${encodeURIComponent(first.action)}`, { headers: { Cookie: admin.cookie } });
    assert(actionFiltered.response.status === 200 && actionFiltered.body.events.every((event: JsonObject) => event.action === first.action), 'Action filtering returned unrelated events.');

    const moduleFiltered = await api(`/api/hr/audit-events?module=${encodeURIComponent(first.module)}`, { headers: { Cookie: admin.cookie } });
    assert(moduleFiltered.response.status === 200 && moduleFiltered.body.events.every((event: JsonObject) => event.module === first.module), 'Module filtering returned unrelated events.');

    if (first.actor?.id) {
      const actorFiltered = await api(`/api/hr/audit-events?actorId=${encodeURIComponent(first.actor.id)}`, { headers: { Cookie: admin.cookie } });
      assert(actorFiltered.response.status === 200 && actorFiltered.body.events.every((event: JsonObject) => event.actor.id === first.actor.id), 'Actor filtering returned unrelated events.');

      const searched = await api(`/api/hr/audit-events?search=${encodeURIComponent(first.actor.displayName)}`, { headers: { Cookie: admin.cookie } });
      assert(searched.response.status === 200 && searched.body.total > 0, 'Actor search did not return matching events.');
    }

    const createdDate = String(first.createdAt).slice(0, 10);
    const dateFiltered = await api(`/api/hr/audit-events?dateFrom=${createdDate}&dateTo=${createdDate}`, { headers: { Cookie: admin.cookie } });
    assert(dateFiltered.response.status === 200, 'Date filtering failed.');

    const ordering = events.map((event) => `${event.createdAt}:${event.id}`);
    assert(ordering.every((value, index) => index === 0 || ordering[index - 1] >= value), 'Audit ordering is not deterministic.');
  }
  pass('Action, module, actor, date, search, and deterministic ordering');

  const pool = getDbPool();
  const otherTenantEvent = await pool.query<{ entity_id: string }>(
    `SELECT entity_id FROM audit_logs WHERE tenant_id <> $1 AND entity_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
    [admin.user.tenantId],
  );
  if (otherTenantEvent.rows[0]) {
    const isolated = await api(`/api/hr/audit-events?targetId=${otherTenantEvent.rows[0].entity_id}`, { headers: { Cookie: admin.cookie } });
    assert(isolated.response.status === 200 && isolated.body.total === 0, 'Cross-tenant event was visible.');
  }
  pass('Cross-tenant audit events excluded');

  const serialized = JSON.stringify(firstPage.body);
  for (const forbidden of ['password_hash', 'reset_token', 'session_token', 'database_url', 'redis_url', 'latitude', 'longitude', 'baseAmount', 'description', 'grievanceTitle']) {
    assert(!serialized.includes(forbidden), `Audit response exposed forbidden field ${forbidden}.`);
  }
  pass('API response omits raw and sensitive fields');

  console.log(`\nCompleted ${passes.length} Audit Trail checks.`);
  await pool.end();
}

run().catch((error) => {
  console.error(`FAIL  ${(error as Error).message}`);
  process.exitCode = 1;
});
