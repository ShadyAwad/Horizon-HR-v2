import { createEmbedding, routerConfig } from '../src/server/intelligent-router/config';
import { registerSemanticAdminRoutes } from '../src/server/intelligent-router/semantic-admin';
import { createCandidate, PgSemanticSearch } from '../src/server/intelligent-router/store';
import './router-env';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { once } from 'node:events';
import { PDFDocument } from 'pdf-lib';
import { getMigrationPool } from './migration-pool';
import { assertDatabaseMutationSafety } from './mutation-safety';
import { withTenant, closeHrResources } from '../src/lib/hr-background';
import { registerAtsRoutes } from '../src/server/hiring/ats-routes';
import { registerHiringRoutes } from '../src/server/hiring/hiring-routes';
import { registerSupportRoutes } from '../src/server/support/support-routes';
import { registerCommunicationsRoutes } from '../src/server/communications/communications-routes';
import { workforceExecutor, resolveWorkforceEntity, prepareWorkforceSemanticQueries } from '../src/server/intelligent-router/workforce-entity-execution';
import { generalizeEntities, safeEntityTemplate } from '../src/lib/router-entities';
import { resolveQuery } from '../src/server/intelligent-router/router';
import { EmbeddingCache } from '../src/server/intelligent-router/providers';
import { getIntent, INTENTS } from '../src/lib/intelligent-router';
import { PrivateExtractionStorage } from '../src/server/document-extraction/extraction-storage';
import path from 'node:path';
assertDatabaseMutationSafety(process.env.DATABASE_URL, 'ATS workflow integration');
const db = getMigrationPool(), tag = randomUUID(), tenants: string[] = [], actors = new Map<string, NonNullable<express.Request['authUser']>>();
const embedding = createEmbedding(routerConfig());
assert(embedding, 'Configured real embedding provider required');
const learningProvider = { model: embedding.model, dimensions: embedding.dimensions, version: 'ats-real-fixture-' + tag, embed: (text: string) => embedding.embed(text) };
const app = express();
app.use(express.json());
const auth: express.RequestHandler = (r, s, n) => { const u = actors.get(String(r.headers['x-test-actor'])); if (!u) {
    s.sendStatus(401);
    return;
} r.authUser = u; n(); };
const deps = { standardAuth: auth, mutationGuard: ((_r, _s, n) => n()) as express.RequestHandler, rateLimiter: ((_r, _s, n) => n()) as express.RequestHandler };
registerSemanticAdminRoutes(app, deps, learningProvider);
registerAtsRoutes(app, deps);
registerSupportRoutes(app, deps);
let testProviderConfigured=false;
registerCommunicationsRoutes(app, { ...deps, providerConfigured: () => testProviderConfigured });
registerHiringRoutes(app, { demoAuth: auth, requirePermission: key => (r, s, n) => { if (!r.authUser?.permissions?.includes(key)) {
        s.sendStatus(403);
        return;
    } n(); } });
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const addr = server.address();
assert(addr && typeof addr !== 'string');
const base = 'http://127.0.0.1:' + addr.port;
async function request(actor: string, url: string, body?: unknown) { const r = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: { 'x-test-actor': actor, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const d = await r.json(); return { ...d, status: r.status }; }
async function person(tenant: string, name: string, keys: string[]) { const id = (await db.query("INSERT INTO employees(tenant_id,full_name,email,password_hash,role) VALUES($1,$2,$3,'fixture-no-login','employee') RETURNING id", [tenant, name, name + '-' + tag + '@example.invalid'])).rows[0].id; const role = (await db.query('INSERT INTO tenant_roles(tenant_id,name,is_system) VALUES($1,$2,false) RETURNING id', [tenant, name])).rows[0].id; for (const key of keys)
    await db.query('INSERT INTO tenant_role_permissions(tenant_id,role_id,permission_key) VALUES($1,$2,$3)', [tenant, role, key]); await db.query("INSERT INTO employee_role_assignments(tenant_id,employee_id,role_id,scope_type) VALUES($1,$2,$3,'company')", [tenant, id, role]); actors.set(name, { tenantId: tenant, employeeId: id, email: name + '-' + tag + '@example.invalid', role: 'employee', permissions: keys }); return id; }
try {
    for (const label of ['a', 'b'])
        tenants.push((await db.query('INSERT INTO tenants(slug,company_name) VALUES($1,$2) RETURNING id', ['ats-' + label + '-' + tag, 'ATS Fixture ' + label])).rows[0].id);
    const [a, b] = tenants, keys = (await db.query("SELECT permission_key FROM tenant_permissions WHERE permission_key LIKE 'hiring.%' OR permission_key LIKE 'semantic.%' OR permission_key IN('compensation.manage','communications.send','communications.view','communications.meetings.manage','communications.meetings.view','support.view','support.manage','assets.view')")).rows.map(r => r.permission_key);
    const recruiter = await person(a, 'recruiter', keys), reader = await person(a, 'reader', ['hiring.view']), worker = await person(a, 'Ahmed Hassan', []), outsider = await person(b, 'outsider', keys);
    await db.query("INSERT INTO tenant_roles(tenant_id,name,system_key,is_system) VALUES($1,'Employee','employee',true)", [a]);
    const dept = (await db.query("INSERT INTO organisation_departments(tenant_id,name) VALUES($1,'Engineering') RETURNING id", [a])).rows[0].id;
    const location = (await db.query("INSERT INTO company_locations(tenant_id,name,latitude,longitude,boundary) VALUES($1,'Cairo Warehouse',30,31,ST_Buffer(ST_SetSRID(ST_MakePoint(31,30),4326)::geography,100)::geometry) RETURNING id", [a])).rows[0].id;
    const team = (await db.query("INSERT INTO organisation_teams(tenant_id,name,location_id) VALUES($1,'Warehouse team',$2) RETURNING id", [a, location])).rows[0].id;
    await db.query('UPDATE employees SET team_id=$2 WHERE id=$1', [worker, team]);
    const create = await request('recruiter', '/api/hiring/jobs', { title: 'Backend Engineer', description: 'Build tenant-safe services.', requirements: 'API engineering', managerId: recruiter, ownerId: recruiter, departmentId: dept, locationId: location, employmentType: 'full_time', headcount: '1' });
    assert.equal(create.status, 200, JSON.stringify(create));
    const job = create.job;
    assert.equal((await request('reader', '/api/hiring/jobs', { title: 'Unauthorized', description: 'No' })).status, 403);
    assert.equal((await request('outsider', '/api/hiring/jobs/' + job.id + '/status', { status: 'open' })).status, 404);
    assert.equal((await request('recruiter', '/api/public/jobs/' + job.public_token)).status, 404);
    assert.equal((await request('recruiter', '/api/hiring/jobs/' + job.id + '/status', { status: 'open' })).status, 200);
    const publicPage = await request('', '/api/public/jobs/' + job.public_token);
    assert.equal(publicPage.status, 200);
    assert(!('tenant_id' in publicPage.job));
    assert(!('id' in publicPage.job));
    assert(!('owner_id' in publicPage.job));
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const bytes = await pdf.save();
    const email = 'candidate-' + tag + '@example.invalid';
    async function apply(extra?: string) { const f = new FormData(); f.set('fullName', 'Sarah Application'); f.set('email', email); f.set('consent', 'true'); f.set('coverNote', 'Fictional verification application'); f.set('resume', new Blob([bytes as BlobPart], { type: 'application/pdf' }), 'resume.pdf'); if (extra)
        f.set('tenantId', extra); const r = await fetch(base + '/api/public/jobs/' + job.public_token + '/apply', { method: 'POST', body: f }); return { status: r.status, ...await r.json() }; }
    assert.equal((await apply(b)).status, 400);
    assert.equal((await apply()).status, 201);
    assert.equal((await apply()).status, 201);
    const applicant = (await db.query('SELECT * FROM hiring_applicants WHERE tenant_id=$1 AND job_id=$2', [a, job.id])).rows;
    assert.equal(applicant.length, 1);
    const candidate = applicant[0];
    assert.equal(candidate.created_by, null);
    assert(candidate.resume_key);
    assert.equal((await request('outsider', '/api/hiring/applicants/' + candidate.id + '/workflow')).status, 404);
    assert.equal((await fetch(base + '/api/hiring/applicants/' + candidate.id + '/resume', { headers: { 'x-test-actor': 'reader' } })).status, 200);
    assert.equal((await fetch(base + '/api/hiring/applicants/' + candidate.id + '/resume', { headers: { 'x-test-actor': 'outsider' } })).status, 404);
    const interview = await request('recruiter', '/api/hiring/applicants/' + candidate.id + '/interviews', { startsAt: new Date(Date.now() + 3600000).toISOString(), endsAt: new Date(Date.now() + 7200000).toISOString(), timezone: 'Africa/Cairo', location: 'https://example.invalid/interview', attendeeIds: [recruiter], interviewType: 'Technical' });
    assert.equal(interview.status, 200, JSON.stringify(interview));
    assert.equal((await request('reader', '/api/hiring/interviews/' + interview.interview.id + '/evaluations', { recommendation: 'yes', score: '4' })).status, 403);
    assert.equal((await request('recruiter', '/api/hiring/interviews/' + interview.interview.id + '/evaluations', { recommendation: 'yes', score: '4', strengths: 'Clear reasoning', concerns: 'None', notes: 'Private interviewer fixture' })).status, 200);
    assert.equal((await request('reader','/api/hiring/interviews/'+interview.interview.id+'/invitation',{})).status,403);
    const invitation=await request('recruiter','/api/hiring/interviews/'+interview.interview.id+'/invitation',{});assert.equal(invitation.status,200,JSON.stringify(invitation));assert(invitation.message.invitation_ics.includes('BEGIN:VCALENDAR'));assert(invitation.message.invitation_ics.replace(/\r\n[ \t]/g, '').includes(email));assert.equal(invitation.message.related_candidate_id,candidate.id);assert.equal(invitation.message.related_meeting_id,null);
    assert.equal((await request('recruiter','/api/hiring/interviews/'+interview.interview.id+'/invitation',{})).message.id,invitation.message.id,'candidate calendar draft idempotency');
    await db.query('UPDATE communication_meetings SET version=version+1 WHERE id=$1',[interview.meeting.id]);testProviderConfigured=true;
    assert.equal((await request('recruiter','/api/communications/messages/'+invitation.message.id+'/send',{})).status,409,'stale candidate ICS snapshot rejected before queuing');testProviderConfigured=false;
    const readerWorkflow = await request('reader', '/api/hiring/applicants/' + candidate.id + '/workflow');
    assert.equal(readerWorkflow.evaluations.length, 0, 'interviewer private feedback hidden');
    assert.equal(readerWorkflow.offers.length, 0);
    const draft = await request('recruiter', '/api/hiring/applicants/' + candidate.id + '/message', { subject: 'Interview invitation', body: 'Please attend the scheduled interview.' });
    assert.equal(draft.status, 200);
    assert.equal((await request('recruiter', '/api/communications/messages/' + draft.message.id + '/send', {})).status, 503, 'unconfigured provider retains draft');
    assert.equal((await db.query('SELECT status FROM communication_messages WHERE id=$1', [draft.message.id])).rows[0].status, 'draft');
    for (const stage of ['screening', 'hr_review', 'hiring_manager_review', 'interview', 'final_review', 'offer'])
        assert.equal((await request('recruiter', '/api/hiring/applicants/' + candidate.id + '/stage', { targetStage: stage })).status, 200);
    assert.equal((await request('recruiter', '/api/hiring/applicants/' + candidate.id + '/stage', { targetStage: 'hired' })).status, 409, 'stage UI cannot bypass conversion');
    const dates = { startDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), expiresOn: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10) };
    assert.equal((await request('reader', '/api/hiring/applicants/' + candidate.id + '/offers', { salary: '5000', currency: 'EGP', ...dates })).status, 403);
    const offer = await request('recruiter', '/api/hiring/applicants/' + candidate.id + '/offers', { salary: '5000.00', currency: 'EGP', ...dates });
    assert.equal(offer.status, 200, JSON.stringify(offer));
    assert.equal((await request('recruiter', '/api/hiring/offers/' + offer.offer.id + '/status', { status: 'sent', messageId: draft.message.id })).status, 409);
    // Delivery state is an explicit database fixture, not a claimed provider send.
    await db.query("UPDATE communication_messages SET status='sent',sent_at=now() WHERE id=$1", [draft.message.id]);
    assert.equal((await request('recruiter', '/api/hiring/offers/' + offer.offer.id + '/status', { status: 'sent', messageId: draft.message.id })).status, 200);
    assert.equal((await request('recruiter', '/api/hiring/offers/' + offer.offer.id + '/status', { status: 'accepted', confirmed: true, responseNote: 'Fixture verified acceptance, recorded for test' })).status, 200);
    const hire = await request('recruiter', '/api/hiring/applicants/' + candidate.id + '/hire', { confirmed: true });
    assert.equal(hire.status, 200, JSON.stringify(hire));
    assert.equal((await request('recruiter', '/api/hiring/applicants/' + candidate.id + '/hire', { confirmed: true })).employeeId, hire.employeeId);
    const employee = (await db.query('SELECT * FROM employees WHERE id=$1', [hire.employeeId])).rows[0];
    assert.equal(employee.role, 'employee');
    assert.equal(employee.tenant_id, a);
    assert.equal(employee.manager_id, recruiter);
    assert.equal(employee.department_id, dept);
    assert.equal(employee.primary_location_id, location);
    assert.equal(employee.employment_type, 'full_time');
    assert.equal((await db.query('SELECT count(*)::int n FROM hiring_onboarding_tasks WHERE employee_id=$1', [hire.employeeId])).rows[0].n, 4);
    assert.equal((await request('', '/api/public/jobs/' + job.public_token)).status, 404, 'filled job is unpublished');
    const asset = (await db.query("INSERT INTO assets(tenant_id,name,asset_tag,category,status) VALUES($1,'Ahmed laptop','NS-LAP-003','laptop','assigned') RETURNING id", [a])).rows[0].id;
    await db.query('INSERT INTO asset_assignments(tenant_id,asset_id,employee_id) VALUES($1,$2,$3)', [a, asset, worker]);
    const ticket = await request('Ahmed Hassan', '/api/support', { assetId: asset, issueType: 'damage', summary: 'Screen damage', description: 'Fixture damaged screen', urgency: 'normal' });
    assert.equal(ticket.status, 201);
    assert.equal((await request('recruiter', '/api/support/' + ticket.ticket.id + '/comments', { note: 'Internal diagnosis fixture', visibility: 'internal' })).status, 201);
    assert.equal((await request('Ahmed Hassan', '/api/support/' + ticket.ticket.id + '/comments', { note: 'Requester reply', visibility: 'requester' })).status, 201);
    const own = await request('Ahmed Hassan', '/api/support/' + ticket.ticket.id), handled = await request('recruiter', '/api/support/' + ticket.ticket.id);
    assert(own.history.every((e: any) => e.visibility === 'requester'));
    assert(handled.history.some((e: any) => e.visibility === 'internal'));
    assert.equal(handled.asset.asset_tag, 'NS-LAP-003');
    assert.equal((await request('Ahmed Hassan', '/api/support/' + ticket.ticket.id + '/comments', { note: 'Forbidden', visibility: 'internal' })).status, 403);
    assert.equal((await request('recruiter', '/api/support/' + ticket.ticket.id + '/update', { status: 'in_progress', assignedTo: null })).status, 201);
    assert.equal((await request('recruiter', '/api/support?queue=true&assignment=unassigned')).total, 1);
    assert.equal((await request('recruiter', '/api/support/' + ticket.ticket.id + '/update', { status: 'resolved', note: 'Replaced screen', assignedTo: recruiter })).status, 201);
    const actor = actors.get('recruiter')!;
    for (const [key, query] of [['employee_equipment', 'what laptop is Ahmed using?'], ['asset_holder', 'who has NS-LAP-003?'], ['support_lookup', "show open tickets for Ahmed's laptop"], ['support_lookup', 'show support issues for Cairo Warehouse'], ['hiring_candidates_query', 'show candidates in offer stage'], ['hiring_candidates_query', "open Sarah's application"], ['support_report', "report Ahmed Hassan's NS-LAP-003 as damaged"], ['employee_equipment', 'Ahmed معاه لابتوب ايه؟']]) {
        const classified = await resolveQuery(query, { actor, allowed: async () => true, available: async () => [...INTENTS], search: { search: async () => [] }, authorization: { resolve: async () => ({ state: 'disabled' }) }, cache: new EmbeddingCache(), minimumScore: .84, minimumMargin: .10 });
        assert.equal(classified.intentKey, key, JSON.stringify({ query, classified }));
        const routed = await withTenant(a, c => workforceExecutor(key)(c, actor, query));
        assert.equal(routed.status, 'resolved', JSON.stringify({ key, query, routed }));
        if (key === 'support_report') {
            assert.equal(routed.prefill?.assetId, asset);
            const template = generalizeEntities(query, routed.entities);
            assert(template && safeEntityTemplate(template));
            assert(!template.text.includes('Ahmed'));
            assert(!template.text.includes('NS-LAP-003'));
        }
    }
    const learningQuery = "please report Ahmed Hassan's NS-LAP-003 as damaged";
    const learningRoute = await withTenant(a, c => workforceExecutor('support_report')(c, actor, learningQuery));
    assert.equal(learningRoute.status, 'resolved');
    const learningTemplate = generalizeEntities(learningQuery, learningRoute.entities)!;
    assert(safeEntityTemplate(learningTemplate));
    const learnedCandidate = await withTenant(a, c => createCandidate(c, a, recruiter, learningQuery, { outcome: 'matched', method: 'rule', intentKey: 'support_report', fallbackUsed: false, entityRoute: learningRoute, entityTemplate: learningTemplate }));
    assert(learnedCandidate);
    await db.query("UPDATE router_candidates SET confirmation_state='confirmed' WHERE tenant_id=$1 AND id=$2", [a, learnedCandidate]);
    const approved = await request('recruiter', '/api/semantic-intelligence/candidates/' + learnedCandidate + '/review', { decision: 'approve' });
    assert.equal(approved.status, 200, JSON.stringify(approved));
    assert.equal(approved.promoted, true);
    const stored = (await db.query('SELECT example_text FROM router_semantic_examples WHERE source_candidate_id=$1', [learnedCandidate])).rows[0];
    assert(!stored.example_text.includes('Ahmed'));
    assert(!stored.example_text.includes('NS-LAP-003'));
    let reasoningCalls = 0;
    const second = await resolveQuery(learningQuery, { actor, allowed: async () => true, available: async () => [getIntent('support_report')!, getIntent('support_lookup')!], search: new PgSemanticSearch(a, 12), embedding: learningProvider, authorization: { resolve: async () => { reasoningCalls++; return { state: 'disabled' }; } }, prepareEntityQueries: (query, keys) => withTenant(a, c => prepareWorkforceSemanticQueries(c, actor, query, keys)), cache: new EmbeddingCache(), minimumScore: .84, minimumMargin: .10 });
    assert.equal(second.intentKey, 'support_report', JSON.stringify(second));
    assert.equal(second.method, 'semantic');
    assert.equal(second.promotedSemanticHit, true);
    assert.equal(reasoningCalls, 0);
    console.log('PASS real local embeddings: private typed asset candidate → admin approval → PostgreSQL cosine hit, unchanged thresholds and zero LLM calls');
    await db.query('UPDATE assets SET serial_number=$2 WHERE id=$1', [asset, 'ATS-SERIAL-' + tag]);
    const bySerial = await withTenant(a, c => resolveWorkforceEntity(c, actor, 'who has ATS-SERIAL-' + tag + '?', 'asset'));
    assert.equal(bySerial.entityId, asset);
    const high = await request('Ahmed Hassan', '/api/support', { issueType: 'it_help', summary: 'Urgent network help', description: 'Fictional priority filter fixture', urgency: 'high' });
    assert.equal(high.status, 201);
    assert.equal((await request('recruiter', '/api/support?queue=true&urgency=high&category=it_help')).tickets[0].id, high.ticket.id);
    assert.equal((await request('recruiter', '/api/support?queue=true&sort=oldest')).tickets[0].id, ticket.ticket.id);
    const unauthorized = await withTenant(a, c => workforceExecutor('asset_holder')(c, actors.get('Ahmed Hassan')!, 'who has NS-LAP-003?'));
    assert.equal(unauthorized.status, 'forbidden');
    await db.query("INSERT INTO assets(tenant_id,name,asset_tag,category,status) VALUES($1,'Ahmed second laptop','NS-LAP-004','laptop','assigned') RETURNING id", [a]).then(async (r) => db.query('INSERT INTO asset_assignments(tenant_id,asset_id,employee_id) VALUES($1,$2,$3)', [a, r.rows[0].id, worker]));
    const ambiguous = await withTenant(a, c => workforceExecutor('support_report')(c, actor, 'report Ahmed laptop as damaged'));
    assert.equal(ambiguous.status, 'ambiguous');
    await withTenant(b, async (c) => { for (const table of ['hiring_jobs', 'hiring_applicants', 'hiring_interviews', 'hiring_evaluations', 'hiring_offers', 'hiring_onboarding_tasks'])
        assert.equal((await c.query(`SELECT 1 FROM ${table} WHERE tenant_id=$1`, [a])).rowCount, 0); });
    await withTenant(a, async (c) => { for (const kind of ['asset', 'job_opening', 'candidate'])
        await c.query('INSERT INTO router_http_metrics(tenant_id,kind,latency_samples) VALUES($1,$2,ARRAY[1.0]::double precision[]) ON CONFLICT(tenant_id,day,kind) DO UPDATE SET latency_samples=EXCLUDED.latency_samples', [a, kind]); });
    const samples: number[] = [];
    for (let n = 0; n < 15; n++) {
        const begin = performance.now();
        await withTenant(a, c => resolveWorkforceEntity(c, actor, 'who has NS-LAP-003?', 'asset'));
        samples.push(performance.now() - begin);
    }
    samples.sort((a, b) => a - b);
    console.log('Asset resolver real fixture p50/p95 ms', samples[7].toFixed(2), samples[14].toFixed(2));
    for (const query of ['hire Sarah', 'reject Sarah', 'send offer to Sarah', 'change salary', 'change compensation', 'close support ticket', 'ارفض المرشح']) {
        const r = await resolveQuery(query, { actor: { tenantId: a, employeeId: recruiter }, allowed: async () => true, available: async () => [...INTENTS], search: new PgSemanticSearch(a, 32), embedding, authorization: { resolve: async () => ({ state: 'disabled' }) }, cache: new EmbeddingCache(), minimumScore: .84, minimumMargin: .10 });
        assert.notEqual(r.outcome, 'matched', query);
    }
    for (const [label, url] of [['jobList', '/api/hiring/jobs'], ['candidatePipeline', '/api/hiring/applicants?page=1&pageSize=20'], ['supportQueue', '/api/support?queue=true'], ['supportFilters', '/api/support?queue=true&status=resolved&assignment=mine']]) {
        const times: number[] = [];
        for (let n = 0; n < 20; n++) {
            const start = performance.now();
            const r = await request('recruiter', url);
            assert.equal(r.status, 200);
            times.push(performance.now() - start);
        }
        times.sort((a, b) => a - b);
        console.log(JSON.stringify({ label, samples: times.length, p50Ms: times[10], p95Ms: times[18] }));
    }
    const compositeTimes: number[] = [];
    for (let n = 0; n < 20; n++) {
        const start = performance.now();
        await withTenant(a, c => workforceExecutor('support_lookup')(c, actor, "show open tickets for Ahmed's NS-LAP-003"));
        compositeTimes.push(performance.now() - start);
    }
    compositeTimes.sort((a, b) => a - b);
    console.log(JSON.stringify({ label: 'employeeAssetSupportComposition', samples: 20, p50Ms: compositeTimes[10], p95Ms: compositeTimes[18] }));
    await withTenant(a, async (c) => { for (const table of ['hiring_jobs', 'hiring_applicants', 'support_tickets']) {
        const plan = (await c.query(`EXPLAIN (ANALYZE,FORMAT JSON) SELECT id FROM ${table} WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20`, [a])).rows[0]['QUERY PLAN'][0];
        console.log(JSON.stringify({ table, executionMs: plan['Execution Time'], rows: plan.Plan['Actual Rows'] }));
    } });
    console.log('PASS real ATS jobs/public applications/PDF privacy/idempotency/stages/interviews/evaluation visibility/offers/conversion/onboarding; real service desk/internal notes/assignment/resolution; English/Arabic composed entities/privacy/ambiguity and tenant RLS. Email delivery was a labeled fixture; no external email sent.');
}
finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    const storage = new PrivateExtractionStorage(path.join(process.env.GRIEVANCE_ATTACHMENT_DIRECTORY || 'uploads/private-grievances', 'hiring'), Infinity);
    for (const row of (await db.query('SELECT resume_key FROM hiring_applicants WHERE tenant_id=ANY($1::uuid[]) AND resume_key IS NOT NULL', [tenants])).rows)
        await storage.remove(row.resume_key);
    for (const table of ['hiring_evaluations', 'hiring_interviews', 'hiring_offers', 'hiring_onboarding_tasks', 'support_tickets', 'asset_condition_reports', 'communication_messages', 'hiring_applicants', 'hiring_jobs'])
        await db.query(`DELETE FROM ${table} WHERE tenant_id=ANY($1::uuid[])`, [tenants]);
    await db.query('DELETE FROM tenants WHERE id=ANY($1::uuid[])', [tenants]);
    await embedding.close?.();
    await closeHrResources();
    await db.end();
}
