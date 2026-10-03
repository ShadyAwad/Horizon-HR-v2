import {closeHrResources} from '../src/lib/hr-background';
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { once } from 'node:events';
import {getMigrationPool as getDbPool} from './migration-pool';
import { registerCommunicationsRoutes } from '../src/server/communications/communications-routes';
import { processMessage, classifyDelivery, reconcileFailedJob } from '../src/server/communications/communications-queue';
import { calendarInvitation, meetingTimes, renderTemplate, variablesIn, escapeHtml } from '../src/server/communications/communications-rules';
import { deliverEmail } from '../src/lib/email';
import { assertDatabaseMutationSafety } from './mutation-safety';
type TestActor = NonNullable<Express.Request['authUser']>;
assertDatabaseMutationSafety(process.env.DATABASE_URL, 'Communications integration');
const pool = getDbPool(), tag = crypto.randomUUID(), tenants: string[] = [], actors = new Map<string, TestActor>();
const jobs = new Set<string>();
let configured = true, queueAvailable = true;
const app = express();
app.use(express.json());
registerCommunicationsRoutes(app, {
    // Route integration uses fixture identities; session-cookie/CSRF middleware remains owned by server.ts.
    standardAuth: (req, res, next) => { const actor = actors.get(String(req.headers['x-test-actor'])); if (!actor) {
        res.status(401).json({ error: 'Authentication required' });
        return;
    } req.authUser = actor; next(); },
    mutationGuard: (req, res, next) => { if (req.headers.origin !== 'http://localhost') {
        res.status(403).json({ error: 'Origin rejected' });
        return;
    } next(); },
    rateLimiter: (_req, _res, next) => next(), providerConfigured: () => configured,
    dispatch: async (tenant, id) => { if (!queueAvailable)
        throw Error('Unavailable'); jobs.add(tenant + ':' + id); return {} as Awaited<ReturnType<typeof import('../src/server/communications/communications-queue').enqueueMessage>>; },
});
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
assert(address && typeof address !== 'string');
const base = `http://127.0.0.1:${address.port}`;
async function api(actor: string, path: string, body?: unknown, method = 'POST', origin = 'http://localhost') {
    const response = await fetch(base + '/api/communications' + path, { method: body === undefined ? 'GET' : method, headers: { 'x-test-actor': actor, 'Content-Type': 'application/json', Origin: origin }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, ...await response.json() };
}
async function ok(actor: string, path: string, body?: unknown, method = 'POST') { const r = await api(actor, path, body, method); assert.equal(r.status, 200, `${path}: ${JSON.stringify(r)}`); return r; }
async function person(tenant: string, key: string, permissions: string[], role = 'employee') {
    const e = (await pool.query('INSERT INTO employees(tenant_id,email,full_name,password_hash,role) VALUES($1,$2,$3,$4,$5) RETURNING id', [tenant, `${key}-${tag}@example.invalid`, key, 'not-a-login-hash', role])).rows[0];
    const r = (await pool.query('INSERT INTO tenant_roles(tenant_id,name) VALUES($1,$2) RETURNING id', [tenant, key])).rows[0];
    for (const permission of permissions)
        await pool.query('INSERT INTO tenant_role_permissions(tenant_id,role_id,permission_key) VALUES($1,$2,$3)', [tenant, r.id, permission]);
    await pool.query("INSERT INTO employee_role_assignments(tenant_id,employee_id,role_id,scope_type) VALUES($1,$2,$3,'company')", [tenant, e.id, r.id]);
    actors.set(key, { employeeId: e.id, tenantId: tenant, role } as TestActor);
    return e.id as string;
}
const message = { subject: 'Hello {{employee_name}}', body: 'Safe text <script>not executable</script>', category: 'custom', recipientIds: [] as string[], variables: { employee_name: 'Test Employee' } };
try {
    assert.deepEqual(variablesIn('{{employee_name}} {{company_name}}'), ['employee_name', 'company_name']);
    assert.throws(() => variablesIn('{{process.env.SECRET}}'));
    assert.throws(() => renderTemplate('{{employee_name}}', {}));
    assert.equal(renderTemplate('{{employee_name}}', { employee_name: 'Ada' }), 'Ada');
    assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
    assert.throws(() => meetingTimes('2026-10-01T10:00:00Z', '2026-10-01T11:00:00', 'UTC'));
    assert.throws(() => meetingTimes('2026-10-01T10:00:00Z', '2026-10-01T11:00:00Z', 'bad-zone'));
    for (let i = 0; i < 2; i++)
        tenants.push((await pool.query('INSERT INTO tenants(slug,company_name) VALUES($1,$2) RETURNING id', [`communications-test-${tag}-${i}`, 'Communications test'])).rows[0].id);
    const all = ['view', 'send', 'templates.manage', 'history.view', 'meetings.view', 'meetings.manage'].map(p => 'communications.' + p);
    const admin = await person(tenants[0], 'admin', all, 'hr_admin'), employee = await person(tenants[0], 'employee', ['communications.send', 'communications.meetings.view']), manager = await person(tenants[0], 'manager', ['communications.view', 'communications.history.view', 'communications.meetings.view'], 'manager'), outsider = await person(tenants[0], 'outsider', []), foreign = await person(tenants[1], 'foreign', all, 'hr_admin');
    message.recipientIds = [employee];
    assert.equal((await api('', '/messages')).status, 401);
    assert.equal((await api('outsider', '/messages')).status, 403);
    assert.equal((await api('manager', '/drafts', message)).status, 403);
    assert.equal((await api('admin', '/drafts', message, 'POST', 'https://evil.invalid')).status, 403);
    const template = (await ok('admin', '/templates', { name: 'Welcome', subject: 'Hello {{employee_name}}', body: 'Welcome {{company_name}}', category: 'custom' })).template;
    assert.equal((await api('employee', '/templates', { name: 'Denied', subject: 'x', body: 'x', category: 'custom' })).status, 403);
    assert.equal((await api('foreign', '/templates/' + template.id + '/preview', { variables: {} })).status, 404);
    assert.equal((await api('admin', '/templates', { name: 'Unsafe', subject: '{{process.exit()}}', body: 'x', category: 'custom' })).code, 'UNKNOWN_VARIABLE');
    assert.equal((await ok('employee', '/templates/' + template.id + '/preview', { variables: { employee_name: 'A', company_name: 'B' } })).body, 'Welcome B');
    await ok('admin', '/templates/' + template.id, { ...template, name: 'Edited', active: false }, 'PUT');
    assert.equal((await api('employee', '/drafts', { ...message, templateId: template.id })).code, 'INVALID_TEMPLATE');
    await ok('admin', '/templates/' + template.id, { ...template, active: true }, 'PUT');
    const draft = (await ok('employee', '/drafts', { ...message, templateId: template.id })).message;
    assert.equal((await ok('employee', '/messages/' + draft.id)).message.id, draft.id);
    assert.equal((await api('admin', '/messages/' + draft.id)).status, 404);
    assert.equal((await api('foreign', '/messages/' + draft.id)).status, 404);
    assert.equal((await api('employee', '/drafts', { ...message, recipientIds: [foreign] })).code, 'INVALID_RECIPIENT');
    for (const type of ['employee', 'candidate', 'meeting', 'arbitrary'])
        assert((await api('employee', '/drafts', { ...message, related: { type, id: foreign } })).status >= 400);
    assert.equal((await api('employee', '/drafts', { ...message, category: 'payroll_notice' })).status, 403);
    const saved = (await ok('employee', '/drafts/' + draft.id, { ...message, version: draft.version }, 'PUT')).message;
    assert.equal((await api('employee', '/drafts/' + draft.id, { ...message, version: draft.version }, 'PUT')).status, 409);
    configured = false;
    assert.equal((await api('employee', '/messages/' + saved.id + '/send', {})).code, 'PROVIDER_NOT_CONFIGURED');
    assert.equal((await ok('employee', '/messages/' + saved.id)).message.status, 'draft');
    configured = true;
    await Promise.all([ok('employee', '/messages/' + saved.id + '/send', {}), ok('employee', '/messages/' + saved.id + '/send', {})]);
    assert.equal(jobs.size, 1);
    assert.equal((await pool.query("SELECT count(*)::int n FROM communication_message_events WHERE message_id=$1 AND status='queued'", [saved.id])).rows[0].n, 1);
    assert.equal((await api('employee', '/drafts/' + saved.id, { ...message, version: 2 }, 'PUT')).status, 409);
    const list = await ok('manager', '/messages?scope=company');
    assert(list.messages.some((m: {
        id: string;
    }) => m.id === saved.id));
    assert(!('body' in list.messages[0]));
    assert.equal((await ok('foreign', '/messages?scope=company')).messages.length, 0);
    const cancelled = (await ok('employee', '/drafts', message)).message;
    await ok('employee', '/messages/' + cancelled.id + '/cancel', {});
    assert.equal((await api('admin', '/messages/' + cancelled.id)).status, 404);
    let sends = 0;
    await processMessage({ data: { tenantId: tenants[0], messageId: saved.id }, attemptsMade: 0 }, async (input, key) => { sends++; assert.equal(key, `stanza-message-${saved.id}`); assert(!input.html.includes('<script>')); return { ok: true, id: 'fake-provider-id' }; });
    await processMessage({ data: { tenantId: tenants[0], messageId: saved.id }, attemptsMade: 0 }, async () => { sends++; return { ok: true, id: 'duplicate' }; });
    assert.equal(sends, 1);
    assert.equal((await ok('employee', '/messages/' + saved.id)).message.status, 'sent');
    assert.equal((await ok('manager', `/messages?scope=company&status=sent&category=custom&sender=${employee}&employee=${employee}&q=Hello`)).total, 1);
    assert.equal((await ok('manager', '/messages?scope=company&status=failed')).total, 0);
    assert.equal((await api('employee', '/messages?sender=invalid')).status, 400);
    assert.equal((await api('employee', '/messages?from=2020-01-01&to=2026-01-01')).status, 400);
    const today = new Date().toISOString().slice(0, 10);
    assert((await ok('employee', `/messages?from=${today}&to=${today}`)).total > 0, 'Date-only through filter includes records later that day');
    const linked = (await ok('employee', '/drafts', { ...message, related: { type: 'employee', id: employee } })).message;
    assert((await ok('employee', `/messages?related=${employee}`)).messages.some((m: {
        id: string;
    }) => m.id === linked.id));
    for (let i = 0; i < 21; i++)
        await pool.query("INSERT INTO communication_messages(tenant_id,sender_id,subject) VALUES($1,$2,$3)", [tenants[0], employee, 'Pagination ' + i]);
    assert.equal((await ok('employee', '/messages?page=1')).messages.length, 20);
    assert((await ok('employee', '/messages?page=2')).messages.length > 0);
    const retry = (await ok('employee', '/drafts', message)).message;
    await ok('employee', '/messages/' + retry.id + '/send', {});
    await assert.rejects(processMessage({ data: { tenantId: tenants[0], messageId: retry.id }, attemptsMade: 0 }, async () => ({ ok: false, kind: 'transient', code: 'PROVIDER_NETWORK_ERROR' })));
    assert.equal((await ok('employee', '/messages/' + retry.id)).message.status, 'queued');
    await assert.rejects(processMessage({ data: { tenantId: tenants[0], messageId: retry.id }, attemptsMade: 1 }, async () => ({ ok: false, kind: 'permanent', code: 'PROVIDER_REJECTED' })));
    assert.equal((await ok('employee', '/messages/' + retry.id)).message.status, 'failed');
    assert.equal(classifyDelivery({ ok: false, kind: 'transient', code: 'error' }, 4).retry, false);
    const uncertain = (await ok('employee', '/drafts', message)).message;
    queueAvailable = false;
    assert.equal((await api('employee', '/messages/' + uncertain.id + '/send', {})).code, 'QUEUE_UNAVAILABLE');
    queueAvailable = true;
    await ok('employee', '/messages/' + uncertain.id + '/send', {});
    await pool.query("UPDATE communication_messages SET first_attempt_at=now()-interval '21 hours' WHERE id=$1", [uncertain.id]);
    await processMessage({ data: { tenantId: tenants[0], messageId: uncertain.id }, attemptsMade: 1 }, async () => { throw Error('Must not call provider after idempotency safety window'); });
    assert.equal((await ok('employee', '/messages/' + uncertain.id)).message.failure_code, 'RECONCILIATION_REQUIRED');
    const meetingInput = { title: 'Planning', notes: 'Notes, safe; text', location: 'https://example.invalid/meeting', startsAt: '2026-10-01T10:00:00+02:00', endsAt: '2026-10-01T11:00:00+02:00', timezone: 'Africa/Cairo', attendeeIds: [employee], relatedEmployeeId: employee };
    assert.equal((await api('admin', '/meetings', { ...meetingInput, attendeeIds: [foreign] })).code, 'INVALID_RECIPIENT');
    const meeting = (await ok('admin', '/meetings', meetingInput)).meeting;
    assert.equal((await api('manager', '/meetings/' + meeting.id)).status, 404);
    assert.equal((await api('foreign', '/meetings/' + meeting.id)).status, 404);
    const detail = await ok('employee', '/meetings/' + meeting.id);
    assert.match(detail.ics, /DTSTART:20261001T080000Z/);
    assert.match(detail.ics, /ATTENDEE:mailto:/);
    assert.match(detail.ics, /UID:/);
    assert.match(detail.ics, /SUMMARY:Planning/);
    assert.throws(() => calendarInvitation(meeting, 'bad\r\nINJECT:value', []));
    await ok('admin', '/meetings/' + meeting.id, { ...meetingInput, title: 'Updated', version: meeting.version }, 'PUT');
    const requestKey = crypto.randomUUID();
    const invitation = (await ok('admin', '/meetings/' + meeting.id + '/invitation', { requestKey })).message;
    assert.equal((await ok('admin', '/meetings/' + meeting.id + '/invitation', { requestKey })).message.id, invitation.id);
    assert.notEqual((await ok('admin', '/meetings/' + meeting.id + '/invitation', { requestKey: crypto.randomUUID() })).message.id, invitation.id);
    assert.equal((await api('admin', '/drafts/' + invitation.id, { ...message, version: invitation.version }, 'PUT')).code, 'INVITATION_LOCKED');
    await ok('admin', '/meetings/' + meeting.id + '/status', { status: 'cancelled' });
    assert.match((await ok('employee', '/meetings/' + meeting.id)).ics, /METHOD:CANCEL/);
    const audits = (await pool.query("SELECT action,metadata FROM audit_logs WHERE tenant_id=$1 AND action LIKE 'communications.%'", [tenants[0]])).rows;
    assert(audits.some(a => a.action === 'communications.email.queued'));
    assert(audits.some(a => a.action === 'communications.email.failed'));
    assert(audits.some(a => a.action === 'communications.meeting.cancelled'));
    assert(audits.every(a => !('body' in a.metadata)));
    const c = await pool.connect();
    const role = 'comms_probe_' + tag.replaceAll('-', '');
    try {
        await c.query('BEGIN');
        await c.query(`CREATE ROLE ${role} NOLOGIN`);
        await c.query(`GRANT SELECT,INSERT ON communication_templates,communication_messages,communication_message_events,communication_meetings,communication_meeting_attendees TO ${role}`);
        await c.query(`SET LOCAL ROLE ${role}`);
        await c.query("SELECT set_config('app.current_tenant',$1,true)", [tenants[1]]);
        for (const table of ['communication_templates', 'communication_messages', 'communication_message_events', 'communication_meetings', 'communication_meeting_attendees'])
            assert.equal((await c.query(`SELECT count(*)::int n FROM ${table} WHERE tenant_id=$1`, [tenants[0]])).rows[0].n, 0);
        await assert.rejects(c.query('INSERT INTO communication_templates(tenant_id,created_by,name,subject,body,category) VALUES($1,$2,$3,$3,$3,$3)', [tenants[0], admin, 'x']), (e: {
            code: string;
        }) => e.code === '42501');
    }
    finally {
        await c.query('ROLLBACK');
        c.release();
    }
    const queued = (await ok('employee', '/drafts', message)).message;
    await ok('employee', '/messages/' + queued.id + '/send', {});
    const { Queue, Worker, QueueEvents } = await import('bullmq');
    const { redisConnection } = await import('../src/lib/hr-background');
    const queueName = 'stanza-comms-test-' + tag;
    const { default: Redis } = await import('ioredis');
    const probe = new Redis({ ...redisConnection, retryStrategy: () => null, connectTimeout: 2000, maxRetriesPerRequest: 0 });
    probe.on('error', () => { });
    try {
        assert.equal(await probe.ping(), 'PONG');
        console.log('PASS configured Redis PONG');
    }
    finally {
        probe.disconnect();
    }
    const queue = new Queue(queueName, { connection: redisConnection }), events = new QueueEvents(queueName, { connection: redisConnection });
    let attempts = 0, permanentMode = false;
    const lifecycle = new Set<string>();
    const worker = new Worker(queueName, job => processMessage(job, async () => { attempts++; if (permanentMode) return { ok: false, kind: 'permanent', code: 'INVALID_RECIPIENT' }; return attempts === 1 ? { ok: false, kind: 'transient', code: 'PROVIDER_NETWORK_ERROR' } : { ok: true, id: 'fake-bullmq-provider' }; }), { connection: redisConnection, concurrency: 1 });
    worker.on('ready', () => lifecycle.add('ready'));
    worker.on('active', () => lifecycle.add('processing'));
    worker.on('completed', () => lifecycle.add('completed'));
    worker.on('failed', () => lifecycle.add('failed'));
    try {
        await worker.waitUntilReady();
        await events.waitUntilReady();
        const options = { jobId: 'message-' + queued.id, attempts: 4, backoff: { type: 'exponential', delay: 100 } };
        const job = await queue.add('send', { tenantId: tenants[0], messageId: queued.id }, options);
        await queue.add('send', { tenantId: tenants[0], messageId: queued.id }, options);
        await job.waitUntilFinished(events, 15000);
        assert.equal(attempts, 2);
        assert.equal((await ok('employee', '/messages/' + queued.id)).message.status, 'sent');
        await job.remove();
        const rejected = (await ok('employee', '/drafts', message)).message;
        await ok('employee', '/messages/' + rejected.id + '/send', {});
        permanentMode = true;
        const failedJob = await queue.add('send', { tenantId: tenants[0], messageId: rejected.id }, { ...options, jobId: 'message-' + rejected.id });
        await assert.rejects(failedJob.waitUntilFinished(events, 15000), /INVALID_RECIPIENT/);
        assert.equal((await ok('employee', '/messages/' + rejected.id)).message.status, 'failed');
        assert.equal(attempts, 3, 'Permanent failure does not retry');
        assert.deepEqual([...lifecycle].sort(), ['completed', 'failed', 'processing', 'ready']);
        console.log('PASS real BullMQ/Redis: stable job ID, transient backoff, worker retry and final database status (fake provider).');
    }
    finally {
        await worker.close();
        await events.close();
        await queue.obliterate({ force: true });
        await queue.close();
    }
    const crash = (await ok('employee', '/drafts', message)).message;
    await ok('employee', '/messages/' + crash.id + '/send', {});
    await pool.query("UPDATE communication_messages SET status='sending',first_attempt_at=now() WHERE id=$1", [crash.id]);
    await reconcileFailedJob({ data: { tenantId: tenants[0], messageId: crash.id }, attemptsMade: 4, opts: { attempts: 4 }, failedReason: 'Database unavailable after provider call' });
    assert.equal((await ok('employee', '/messages/' + crash.id)).message.failure_code, 'RECONCILIATION_REQUIRED');
    let afterCancel = 0;
    const cancellable = (await ok('employee', '/drafts', message)).message;
    await ok('employee', '/messages/' + cancellable.id + '/send', {});
    await ok('employee', '/messages/' + cancellable.id + '/cancel', {});
    await processMessage({ data: { tenantId: tenants[0], messageId: cancellable.id }, attemptsMade: 0 }, async () => { afterCancel++; return { ok: true, id: 'must-not-send' }; });
    assert.equal(afterCancel, 0);
    const key = process.env.RESEND_API_KEY, from = process.env.EMAIL_FROM;
    delete process.env.RESEND_API_KEY;
    assert.deepEqual(await deliverEmail({ to: 'test@example.invalid', subject: 'x', text: 'x', html: 'x' }), { ok: false, kind: 'unconfigured', code: 'PROVIDER_NOT_CONFIGURED' });
    const realFetch = globalThis.fetch;
    process.env.RESEND_API_KEY = 're_test_communications';
    process.env.EMAIL_FROM = 'Stanza <test@example.invalid>';
    try {
        for (const [status, name, kind] of [[429, 'rate_limit_exceeded', 'transient'], [500, 'internal_server_error', 'transient'], [422, 'validation_error', 'permanent'], [409, 'concurrent_idempotent_requests', 'transient']] as const) {
            globalThis.fetch = async () => new Response(JSON.stringify({ name, message: 'Test rejection' }), { status, headers: { 'Content-Type': 'application/json' } });
            const result = await deliverEmail({ to: 'test@example.invalid', subject: 'x', text: 'x', html: 'x' }, 'test-key');
            assert.equal(result.ok, false);
            if (result.ok === false)
                assert.equal(result.kind, kind);
        }
        globalThis.fetch = async () => new Response(JSON.stringify({ id: 'fake-adapter-id' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        assert.deepEqual(await deliverEmail({ to: 'test@example.invalid', subject: 'x', text: 'x', html: 'x' }, 'test-key'), { ok: true, id: 'fake-adapter-id' });
    }
    finally {
        globalThis.fetch = realFetch;
        if (key)
            process.env.RESEND_API_KEY = key;
        else
            delete process.env.RESEND_API_KEY;
        if (from)
            process.env.EMAIL_FROM = from;
        else
            delete process.env.EMAIL_FROM;
    }
    console.log('PASS Communications: validation, templates, private drafts, grants, tenant isolation, queue deduplication, worker transitions/retries/reconciliation, meetings, ICS, audit, non-superuser RLS, unconfigured provider. No external email sent.');
}
finally {
    for (const tenant of tenants) {
        for (const table of ['communication_message_events', 'communication_messages', 'communication_meeting_attendees', 'communication_meetings', 'communication_templates'])
            await pool.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenant]);
        await pool.query('DELETE FROM tenants WHERE id=$1', [tenant]);
    }
    server.close();
    await pool.end();await closeHrResources();
}
