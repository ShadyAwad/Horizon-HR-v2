import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [migration, routes, registry, audit, server, packageJson] = await Promise.all([
  readFile('src/db/migrations/20260729_add_leave_self_service.sql', 'utf8'),
  readFile('src/server/leave/leave-routes.ts', 'utf8'),
  readFile('src/server/organisation/permission-registry.ts', 'utf8'),
  readFile('src/server/audit/audit-events.ts', 'utf8'),
  readFile('server.ts', 'utf8'),
  readFile('package.json', 'utf8'),
]);

assert.match(migration, /BEGIN;/);
assert.match(migration, /COMMIT;/);
assert.match(migration, /ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1/);
assert.match(migration, /submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/);
assert.match(migration, /cancelled_at TIMESTAMPTZ/);
assert.match(migration, /leave_requests_id_tenant_unique UNIQUE \(id, tenant_id\)/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS leave_request_history/);
assert.match(migration, /REFERENCES leave_requests\(id, tenant_id\)/);
assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
assert.match(migration, /leave_request_history_tenant_isolation/);
assert.match(migration, /leave\.request\.self/);
assert.match(migration, /leave\.view\.self/);
assert.match(migration, /leave\.cancel\.self/);

assert.match(registry, /definePermission\('leave\.request\.self'/);
assert.match(registry, /definePermission\('leave\.view\.self'/);
assert.match(registry, /definePermission\('leave\.cancel\.self'/);
assert.match(server, /registerLeaveRoutes\(app, \{ standardAuth: demoAuth/);
assert.match(routes, /\/api\/me\/leave-requests/);
assert.match(routes, /\/api\/me\/leave-requests\/:requestId/);
assert.match(routes, /\/api\/me\/leave-requests\/:requestId\/cancel/);
assert.match(routes, /strictFields\(req\.body, \['leaveType', 'startDate', 'endDate', 'reason'\]\)/);
assert.match(routes, /LEAVE_TYPES/);
assert.match(routes, /MAX_LEAVE_DAYS/);
assert.match(routes, /status IN \('pending','approved'\)/);
assert.match(routes, /employee_id=\$2/);
assert.match(routes, /ORDER BY submitted_at DESC,id DESC/);
assert.match(routes, /FOR UPDATE/);
assert.match(routes, /expectedVersion/);
assert.match(routes, /version=version\+1/);
assert.match(routes, /Only pending leave requests may be cancelled/);
assert.match(routes, /leave_request_history/);
assert.match(routes, /recordAuditEvent/);
assert.doesNotMatch(routes, /grievance/);
assert.match(audit, /'leave\.requested'/);
assert.match(audit, /'leave\.cancelled'/);
assert.match(packageJson, /"test:leave"/);

console.log('Leave self-service contracts passed: 30');
