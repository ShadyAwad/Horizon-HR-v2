import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { once } from 'node:events';
import sharp from 'sharp';
import fs from 'node:fs';
import { registerAuditRoutes } from '../src/server/audit/audit-routes';
import { registerDashboardAttentionRoutes } from '../src/server/dashboard/attention-routes';
import { resolveScopedPermission } from '../src/server/organisation/scoped-permissions';
import { withTenant } from '../src/lib/hr-background';
import { getDbPool } from '../src/lib/hr-background';
import { registerCommunicationsRoutes } from '../src/server/communications/communications-routes';
import { processMessage } from '../src/server/communications/communications-queue';
import { registerGrievanceRoutes } from '../src/server/grievances/grievance-routes';
import { CASE_TRANSITIONS, caseTransition, caseVersion } from '../src/lib/grievance-contract';
import { assertDatabaseMutationSafety } from './mutation-safety';
assertDatabaseMutationSafety(process.env.DATABASE_URL, 'Grievance integration');
const pool = getDbPool(), tag = crypto.randomUUID(), tenants: string[] = [], actors = new Map<string, NonNullable<Express.Request['authUser']>>();
const stored: string[] = [];
const app = express();
app.use(express.json());
registerGrievanceRoutes(app, { standardAuth: (req, res, next) => { const actor = actors.get(String(req.headers['x-test-actor'])); if (!actor) {
        res.status(401).json({ error: 'Authentication required' });
        return;
    } req.authUser = actor; next(); }, mutationGuard: (req, res, next) => { if (req.headers.origin !== 'http://localhost') {
        res.status(403).json({ error: 'Origin rejected' });
        return;
    } next(); }, rateLimiter: (_req, _res, next) => next() });
registerCommunicationsRoutes(app, { standardAuth: (req, res, next) => { const actor = actors.get(String(req.headers['x-test-actor'])); if (!actor) {
        res.status(401).json({ error: 'Authentication required' });
        return;
    } req.authUser = actor; next(); }, mutationGuard: (_req, _res, next) => next(), rateLimiter: (_req, _res, next) => next(), providerConfigured: () => false });
const fixtureAuth: express.RequestHandler = (req, res, next) => { const actor = actors.get(String(req.headers['x-test-actor'])); if (!actor) {
    res.status(401).json({ error: 'Authentication required' });
    return;
} req.authUser = actor; next(); };
registerDashboardAttentionRoutes(app, { standardAuth: fixtureAuth });
registerAuditRoutes(app, { demoAuth: fixtureAuth, requirePermission: key => async (req, res, next) => { const u = req.authUser!; if (!(await withTenant(u.tenantId, c => resolveScopedPermission(c, { tenantId: u.tenantId, actorEmployeeId: u.employeeId, permissionKey: key }))).allowed) {
        res.status(403).json({ error: 'Permission required' });
        return;
    } next(); } });
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
assert(address && typeof address !== 'string');
const base = `http://127.0.0.1:${address.port}/api/grievances`;
async function api(actor: string, path: string, body?: unknown, method = 'POST') { const response = await fetch(base + path, { method: body === undefined ? 'GET' : method, headers: { 'x-test-actor': actor, 'Content-Type': 'application/json', Origin: 'http://localhost' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { http: response.status, ...await response.json() }; }
async function ok(actor: string, path: string, body?: unknown, method = 'POST') { const r = await api(actor, path, body, method); assert.equal(r.http, path === '' && body !== undefined && method === 'POST' ? 201 : 200, `${path}: ${JSON.stringify(r)}`); return r; }
async function person(tenant: string, key: string, permissions: string[], scope = 'company', scopeId: string | null = null, role = 'employee') { const e = (await pool.query('INSERT INTO employees(tenant_id,email,full_name,password_hash,role) VALUES($1,$2,$3,$4,$5) RETURNING id', [tenant, `${key}-${tag}@example.invalid`, key, 'not-a-login-hash', role])).rows[0]; const r = (await pool.query('INSERT INTO tenant_roles(tenant_id,name) VALUES($1,$2) RETURNING id', [tenant, key])).rows[0]; for (const permission of permissions)
    await pool.query('INSERT INTO tenant_role_permissions(tenant_id,role_id,permission_key) VALUES($1,$2,$3)', [tenant, r.id, permission]); await pool.query('INSERT INTO employee_role_assignments(tenant_id,employee_id,role_id,scope_type,scope_id) VALUES($1,$2,$3,$4,$5)', [tenant, e.id, r.id, scope, scopeId]); actors.set(key, { employeeId: e.id, tenantId: tenant, role } as NonNullable<Express.Request['authUser']>); return e.id as string; }
const all = ['view', 'triage', 'assign', 'respond', 'internal_notes', 'resolve', 'close', 'confidential', 'configure'].map(k => 'grievances.' + k).concat(['communications.send', 'communications.view', 'communications.history.view', 'audit.view']);
try {
    for (let i = 0; i < 2; i++)
        tenants.push((await pool.query('INSERT INTO tenants(slug,company_name) VALUES($1,$2) RETURNING id', [`grievance-test-${tag}-${i}`, 'Grievance fixture'])).rows[0].id);
    const departments = [];
    for (let i = 0; i < 2; i++)
        departments.push((await pool.query('INSERT INTO organisation_departments(tenant_id,name,code,grievance_enabled) VALUES($1,$2,$2,true) RETURNING id', [tenants[0], `Destination ${i}`])).rows[0].id);
    const employee = await person(tenants[0], 'reporter', ['grievances.create', 'grievances.view_own'], 'self'), handler = await person(tenants[0], 'handler', all), second = await person(tenants[0], 'second', all), manager = await person(tenants[0], 'manager', all.filter(k => !k.endsWith('confidential')), 'department', departments[0], 'manager'), other = await person(tenants[0], 'other', ['grievances.create'], 'self'), foreign = await person(tenants[1], 'foreign', all);
    const auditRole = (await pool.query('INSERT INTO tenant_roles(tenant_id,name) VALUES($1,$2) RETURNING id', [tenants[0], 'Communication history reader'])).rows[0].id;
    for (const permission of ['communications.view', 'communications.history.view', 'audit.view'])
        await pool.query('INSERT INTO tenant_role_permissions(tenant_id,role_id,permission_key) VALUES($1,$2,$3)', [tenants[0], auditRole, permission]);
    await pool.query("INSERT INTO employee_role_assignments(tenant_id,employee_id,role_id,scope_type) VALUES($1,$2,$3,'company')", [tenants[0], manager, auditRole]);
    const submit = { title: 'Fixture workplace issue', description: 'Private detailed grievance text', category: 'workplace', priority: 'high', destinationDepartmentId: departments[0], confidentiality: 'standard' };
    assert.equal((await api('', '/me')).http, 401);
    assert.equal((await api('other', '')).http, 403);
    assert.equal((await api('reporter', '', { ...submit, destinationDepartmentId: foreign })).http, 400);
    let row = (await ok('reporter', '', submit)).grievance;
    const id = row.id;
    assert.match(row.case_number, /^GRV-\d{4}-\d{6,}$/);
    assert.equal(row.status, 'submitted');
    assert.equal((await ok('reporter', '/me')).total, 1);
    assert.equal((await ok('manager', '')).total, 1);
    assert.equal((await api('other', '/' + id)).http, 404);
    assert.equal((await api('foreign', '/' + id)).http, 404);
    assert.equal((await api('reporter', '/' + id + '/assignment', { version: 1, employeeId: handler }, 'PATCH')).http, 403);
    assert.equal((await api('handler', '/' + id + '/status', { version: 1, status: 'closed' }, 'PATCH')).http, 409);
    row = (await ok('handler', '/' + id + '/status', { version: 1, status: 'triaged' }, 'PATCH')).grievance;
    const assignments = await Promise.all([api('handler', '/' + id + '/assignment', { version: row.version, employeeId: handler }, 'PATCH'), api('second', '/' + id + '/assignment', { version: row.version, employeeId: second }, 'PATCH')]);
    assert.deepEqual(assignments.map(r => r.http).sort(), [200, 409]);
    row = (await ok('handler', '/' + id)).grievance;
    assert.equal((await api('handler', '/' + id + '/assignment', { version: row.version, employeeId: foreign }, 'PATCH')).http, 400);
    await ok('handler', '/' + id + '/messages', { version: row.version, kind: 'internal', body: 'SECRET INTERNAL NOTE' });
    row = (await ok('handler', '/' + id)).grievance;
    const ownerDetail = await ok('reporter', '/' + id);
    assert(!JSON.stringify(ownerDetail).includes('SECRET INTERNAL NOTE'));
    assert(!ownerDetail.messages.some((m: any) => m.kind === 'internal'));
    assert(!('assigned_to' in ownerDetail.grievance));
    assert(!ownerDetail.events.some((e: any) => e.kind === 'internal_note_added'));
    await ok('handler', '/' + id + '/messages', { version: row.version, kind: 'response', body: 'VISIBLE HANDLER RESPONSE' });
    row = (await ok('handler', '/' + id)).grievance;
    assert((await ok('reporter', '/' + id)).messages.some((m: any) => m.body === 'VISIBLE HANDLER RESPONSE'));
    await ok('reporter', '/' + id + '/messages', { version: row.version, kind: 'follow_up', body: 'EMPLOYEE FOLLOWUP' });
    row = (await ok('handler', '/' + id)).grievance;
    assert((await ok('handler', '/' + id)).messages.some((m: any) => m.body === 'EMPLOYEE FOLLOWUP'));
    assert.equal((await api('reporter', '/' + id + '/messages', { version: row.version, kind: 'internal', body: 'Denied' })).http, 403);
    const file = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const form = new FormData();
    form.append('version', String(row.version));
    form.append('file', new Blob([new Uint8Array(file)], { type: 'image/png' }), 'fixture.png');
    const uploaded = await fetch(base + '/' + id + '/attachments', { method: 'POST', headers: { 'x-test-actor': 'reporter', Origin: 'http://localhost' }, body: form });
    assert.equal(uploaded.status, 200);
    const fileId = (await uploaded.json()).attachment.id;
    assert.equal((await fetch(base + '/' + id + '/attachments/' + fileId, { headers: { 'x-test-actor': 'other' } })).status, 404);
    assert.equal((await fetch(base + '/' + id + '/attachments/' + fileId, { headers: { 'x-test-actor': 'foreign' } })).status, 404);
    const download = await fetch(base + '/' + id + '/attachments/' + fileId, { headers: { 'x-test-actor': 'reporter' } });
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
    row = (await ok('handler', '/' + id)).grievance;
    const bad = new FormData();
    bad.append('version', String(row.version));
    bad.append('file', new Blob(['%PDF-invalid %%EOF'], { type: 'application/pdf' }), 'bad.pdf');
    assert.equal((await fetch(base + '/' + id + '/attachments', { method: 'POST', headers: { 'x-test-actor': 'reporter', Origin: 'http://localhost' }, body: bad })).status, 400);
    row = (await ok('handler', '/' + id + '/assignment', { version: row.version, employeeId: handler, departmentId: departments[1] }, 'PATCH')).grievance;
    assert.equal((await api('manager', '/' + id)).http, 404);
    assert.equal((await ok('manager', '')).total, 0);
    for (const status of ['assigned', 'in_progress', 'waiting', 'in_progress', 'resolved', 'in_progress', 'resolved', 'closed']) {
        row = (await ok('handler', '/' + id + '/status', { version: row.version, status, ...(status === 'resolved' ? { resolutionSummary: 'Outcome was recorded' } : {}) }, 'PATCH')).grievance;
    }
    assert.equal((await api('reporter', '/' + id + '/messages', { version: row.version, kind: 'follow_up', body: 'After closure' })).http, 409);
    const history = await ok('reporter', '/' + id);
    assert.equal(history.messages.filter((m: any) => m.kind === 'resolution').length, 2);
    assert(history.events.some((e: any) => e.kind === 'reopened'));
    assert(history.events.every((e: any, i: number) => !i || new Date(e.created_at) >= new Date(history.events[i - 1].created_at)));
    const confidential = (await ok('reporter', '', { ...submit, title: 'CONFIDENTIAL SUBJECT', confidentiality: 'confidential' })).grievance;
    assert.equal((await api('manager', '/' + confidential.id)).http, 404);
    assert.equal((await ok('manager', '?q=CONFIDENTIAL')).total, 0);
    assert.equal((await ok('handler', '?q=CONFIDENTIAL')).total, 1);
    const race = (await ok('reporter', '', submit)).grievance;
    let raceRow = race;
    for (const status of ['triaged', 'in_progress', 'resolved'])
        raceRow = (await ok('handler', '/' + race.id + '/status', { version: raceRow.version, status, ...(status === 'resolved' ? { resolutionSummary: 'Race fixture resolution' } : {}) }, 'PATCH')).grievance;
    const closing = await Promise.all([api('handler', '/' + race.id + '/status', { version: raceRow.version, status: 'closed' }, 'PATCH'), api('reporter', '/' + race.id + '/messages', { version: raceRow.version, kind: 'follow_up', body: 'Concurrent followup' })]);
    assert.deepEqual(closing.map(r => r.http).sort(), [200, 409]);
    const results = await Promise.all(Array.from({ length: 24 }, (_, i) => ok('reporter', '', { ...submit, title: 'Concurrent ' + i })));
    assert.equal(new Set(results.map(r => r.grievance.case_number)).size, 24);
    assert.equal((await ok('handler', '?page=1')).grievances.length, 20);
    assert((await ok('handler', '?page=2')).grievances.length >= 6);
    // Linked drafts stay private, retain their link, and inherit case authorization even in company history.
    const visibleMessage = (await ok('handler', '/' + id)).messages.find((m: any) => m.kind === 'response');
    const draft = (await ok('handler', '/' + id + '/email-draft', { messageId: visibleMessage.id })).draftId;
    assert.equal((await ok('handler', '/' + id + '/email-draft', { messageId: visibleMessage.id })).draftId, draft);
    const note = (await ok('handler', '/' + id)).messages.find((m: any) => m.kind === 'internal');
    assert.equal((await api('handler', '/' + id + '/email-draft', { messageId: note.id })).http, 404);
    async function comms(actor: string, path: string, body?: unknown, method = 'POST') { const response = await fetch(base.replace('/api/grievances', '/api/communications') + path, { method: body === undefined ? 'GET' : method, headers: { 'x-test-actor': actor, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { http: response.status, ...await response.json() }; }
    assert.equal((await comms('handler', '/messages/' + draft)).http, 200);
    assert.equal((await comms('foreign', '/messages/' + draft)).http, 404);
    const draftBody = { subject: 'Case response', body: 'Visible', category: 'grievance_update', recipientIds: [employee], related: { type: 'grievance', id }, version: 1 };
    assert.equal((await comms('handler', '/drafts/' + draft, { ...draftBody, related: null }, 'PUT')).code, 'CASE_LINK_LOCKED');
    assert.equal((await comms('handler', '/drafts', { ...draftBody, recipientIds: [employee, other] })).http, 400);
    assert.equal((await comms('handler', '/messages/' + draft + '/send', {})).code, 'PROVIDER_NOT_CONFIGURED');
    await pool.query("UPDATE communication_messages SET status='queued',queued_at=now() WHERE id=$1", [draft]);
    assert.equal((await comms('manager', '/messages?scope=company')).total, 0);
    assert.equal((await comms('manager', '/messages/' + draft)).http, 404);
    await ok('handler', '/' + confidential.id + '/messages', { version: 1, kind: 'response', body: 'Confidential visible response' });
    const secretMessage = (await ok('handler', '/' + confidential.id)).messages.find((m: any) => m.kind === 'response');
    const secretDraft = (await ok('handler', '/' + confidential.id + '/email-draft', { messageId: secretMessage.id })).draftId;
    await pool.query("UPDATE communication_messages SET status='queued',queued_at=now() WHERE id=$1", [secretDraft]);
    assert.equal((await comms('manager', '/messages?scope=company&q=CONFIDENTIAL')).total, 0);
    await pool.query("DELETE FROM tenant_role_permissions p USING employee_role_assignments a WHERE p.tenant_id=a.tenant_id AND p.role_id=a.role_id AND a.employee_id=$1 AND p.permission_key='grievances.confidential'", [handler]);
    let delivered = 0;
    await processMessage({ data: { tenantId: tenants[0], messageId: secretDraft }, attemptsMade: 0 }, async () => { delivered++; return { ok: true, id: 'fake' }; });
    assert.equal(delivered, 0);
    assert.equal((await pool.query('SELECT failure_code FROM communication_messages WHERE id=$1', [secretDraft])).rows[0].failure_code, 'SEND_PERMISSION_REVOKED');
    async function extra(actor: string, path: string) { const response = await fetch(base.replace('/api/grievances', '') + path, { headers: { 'x-test-actor': actor } }); return { http: response.status, ...await response.json() }; }
    const visibleCount = (await ok('manager', '?status=submitted')).total;
    const managerAttention = await extra('manager', '/api/dashboard/attention-counts');
    assert.equal(managerAttention.http, 200);
    assert.equal(managerAttention.counts.grievances, visibleCount);
    const handlerAudit = await extra('handler', '/api/hr/audit-events?module=grievances&pageSize=100');
    assert.equal(handlerAudit.http, 200);
    const managerAudit = await extra('manager', '/api/hr/audit-events?module=grievances&pageSize=100');
    assert.equal(managerAudit.http, 200);
    assert(!JSON.stringify(managerAudit).includes(confidential.id));
    assert(!JSON.stringify(managerAudit).includes('SECRET INTERNAL NOTE'));
    assert.equal((await extra('reporter', '/api/hr/audit-events')).http, 403);
    const notifications = (await pool.query('SELECT event_type,payload FROM outbox_events WHERE tenant_id=$1', [tenants[0]])).rows;
    assert(!JSON.stringify(notifications).includes('SECRET INTERNAL NOTE'));
    assert(!JSON.stringify(notifications).includes(submit.description));
    assert(!JSON.stringify(notifications).includes('CONFIDENTIAL SUBJECT'));
    assert(notifications.some(n => n.event_type === 'notification.grievance_follow_up'));
    assert(!notifications.some(n => n.event_type.includes('internal')));
    const audit = (await pool.query('SELECT action,metadata FROM audit_logs WHERE tenant_id=$1', [tenants[0]])).rows;
    assert(audit.length > 10);
    assert(!JSON.stringify(audit).includes('SECRET INTERNAL NOTE'));
    const c = await pool.connect();
    try {
        await c.query('BEGIN');
        const role = 'grv_rls_' + tag.replaceAll('-', '');
        await c.query(`CREATE ROLE ${role} NOLOGIN`);
        await c.query(`GRANT SELECT,INSERT ON grievances,grievance_case_counters,grievance_case_events,grievance_messages,grievance_attachments TO ${role}`);
        await c.query(`SET LOCAL ROLE ${role}`);
        await c.query("SELECT set_config('app.current_tenant',$1,true)", [tenants[1]]);
        for (const table of ['grievances', 'grievance_case_counters', 'grievance_case_events', 'grievance_messages', 'grievance_attachments'])
            assert.equal((await c.query(`SELECT count(*)::int n FROM ${table} WHERE tenant_id=$1`, [tenants[0]])).rows[0].n, 0);
        await assert.rejects(c.query('INSERT INTO grievance_case_counters(tenant_id,last_number) VALUES($1,0)', [tenants[0]]), (e: any) => e.code === '42501');
    }
    finally {
        await c.query('ROLLBACK');
        c.release();
    }
    await assert.rejects(pool.query("UPDATE grievance_messages SET body='changed' WHERE tenant_id=$1", [tenants[0]]));
    await assert.rejects(pool.query('DELETE FROM grievance_case_events WHERE tenant_id=$1', [tenants[0]]));
    assert.equal(caseVersion(1), 1);
    assert.throws(() => caseVersion(0));
    for (const [from, to] of Object.entries(CASE_TRANSITIONS))
        for (const next of to)
            assert.equal(caseTransition(from as any, next), next);
    console.log('PASS Grievances: submission, routing, scope, confidentiality, internal privacy, messages, attachments, assignment conflict, lifecycle, resolution history, pagination, numbering concurrency, audit, outbox, non-superuser RLS, immutable history, private linked email drafts, company-history privacy and worker permission revocation.');
}
finally {
    for (const tenant of tenants) {
        stored.push(...(await pool.query('SELECT storage_key FROM grievance_attachments WHERE tenant_id=$1', [tenant])).rows.map(r => r.storage_key));
        await pool.query('DELETE FROM tenants WHERE id=$1', [tenant]);
    }
    for (const key of stored)
        fs.rmSync('uploads/private-grievances/' + key, { force: true });
    server.close();
    await pool.end();
}
