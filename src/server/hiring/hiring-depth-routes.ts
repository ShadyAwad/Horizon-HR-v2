import {offerCalendarDate} from '../../lib/hiring-offer-presentation';
import type express from 'express';
import crypto from 'node:crypto';
import { resolveDateWindow } from '../../lib/operational-plan';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { getDbPool, withTenant } from '../../lib/hr-background';
import { validateQuestions, validateTemplate, TASK_KINDS } from '../../lib/hiring-depth';
import { recordAuditEvent } from '../audit/audit-events';
import { requireHiring, hiringError, applyOnboardingTemplate, onboardingReadiness, type HiringActor } from './onboarding-service';
import { logServerError } from '../../lib/server-logging';
const id = (v: unknown): string => { if (typeof v !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v))
    hiringError('Record unavailable.', 404); return v as string; };
const text = (v: unknown, max: number, required = false) => { if (v == null && !required)
    return ''; if (typeof v !== 'string' || v.length > max || required && !v.trim())
    hiringError('Invalid field.'); return (v as string).trim(); };
const only = (v: Record<string, unknown>, keys: string[]) => { if (!v || Object.keys(v).some(k => !keys.includes(k)))
    hiringError('Unsupported field.'); };
const audit = async (c: any, u: HiringActor, action: string, targetId: string, status?: string) => recordAuditEvent(c, { tenantId: u.tenantId, actorId: u.employeeId, action: 'hiring.' + action, targetType: 'hiring_workflow', targetId, metadata: status ? { status } : {} });
const failure = (res: express.Response, e: any) => { if (!e.statusCode)
    logServerError('Hiring depth request failed', e); res.status(e.statusCode || 500).json({ success: false, error: e.statusCode ? e.message : 'Hiring request failed.' }); };
async function offer(c: any, tenant: string, offerId: string, lock = false) { const row = (await c.query('SELECT o.*,a.full_name candidate_name,t.company_name FROM hiring_offers o JOIN hiring_applicants a ON a.tenant_id=o.tenant_id AND a.id=o.applicant_id JOIN tenants t ON t.id=o.tenant_id WHERE o.tenant_id=$1 AND o.id=$2' + (lock ? ' FOR UPDATE OF o' : ''), [tenant, offerId])).rows[0]; if (!row)
    hiringError('Offer unavailable.', 404); return row; }
function safeOffer(o: any) { return { version: o.version, candidate: o.candidate_name, company: o.company_name, title: o.terms.title, department: o.terms.department, location: o.terms.location, employmentType: o.terms.employmentType, salary: o.salary, currency: o.currency, startDate: offerCalendarDate(o.start_date), expiresOn: offerCalendarDate(o.expires_on), status: o.status, acknowledgedAt: o.acknowledged_at, signatureStatus: o.signature_status }; }
export async function offerPdf(o: any) { const doc = await PDFDocument.create(), safe = safeOffer(o); doc.setTitle('Offer version ' + o.version); const lines = ['Employment offer — ' + safe.company, 'Candidate: ' + safe.candidate, 'Version: ' + safe.version, 'Role: ' + safe.title, 'Department: ' + (safe.department || ''), 'Location: ' + (safe.location || ''), 'Employment type: ' + (safe.employmentType || ''), 'Compensation: ' + safe.salary + ' ' + safe.currency, 'Start date: ' + safe.startDate, 'Expires: ' + safe.expiresOn, 'Current record status: ' + safe.status, 'Explicit acknowledgement is not a digital signature.', 'The Stanza offer record remains authoritative.']; const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!)); const wrapped = lines.flatMap(s => Array.from({ length: Math.max(1, Math.ceil(s.length / 65)) }, (_, i) => s.slice(i * 65, (i + 1) * 65))); const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1240" height="1754"><rect width="100%" height="100%" fill="white"/>${wrapped.map((s, i) => `<text x="80" y="${110 + i * 45}" font-family="sans-serif" font-size="26" fill="black">${esc(s)}</text>`).join('')}</svg>`; const png = await sharp(Buffer.from(svg)).png().toBuffer(), img = await doc.embedPng(png); doc.addPage([620, 877]).drawImage(img, { x: 0, y: 0, width: 620, height: 877 }); return Buffer.from(await doc.save()); }
export function registerHiringDepthRoutes(app: express.Express, deps: {
    standardAuth: express.RequestHandler;
    mutationGuard: express.RequestHandler;
    rateLimiter: express.RequestHandler;
}) {
    const route = (method: 'get' | 'post', path: string, key: string, fn: (r: express.Request, c: any, u: HiringActor) => Promise<object>) => app[method]('/api/hiring' + path, deps.standardAuth, ...(method === 'post' ? [deps.mutationGuard, deps.rateLimiter] : []), async (r, res) => { res.setHeader('Cache-Control', 'no-store'); try {
        res.json({ success: true, ...await withTenant(r.authUser!.tenantId, async (c) => { await requireHiring(c, r.authUser!, key); return fn(r, c, r.authUser!); }) });
    }
    catch (e) {
        failure(res, e);
    } });
    route('post', '/jobs/:id/questions', 'hiring.manage_jobs', async (r, c, u) => { only(r.body, ['questions']); const questions = validateQuestions(r.body.questions); const job = (await c.query('UPDATE hiring_jobs SET application_questions=$3::jsonb,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING id', [u.tenantId, id(r.params.id), JSON.stringify(questions)])).rows[0]; if (!job)
        hiringError('Job unavailable.', 404); await audit(c, u, 'questions_updated', job.id); return { questions }; });
    route('post', '/applicants/:id/reviews', 'hiring.review_applications', async (r, c, u) => { await requireHiring(c, u, 'hiring.view'); only(r.body, ['recommendation', 'score', 'notes']); if (!['advance', 'hold', 'reject'].includes(r.body.recommendation) || !Number.isInteger(Number(r.body.score)) || Number(r.body.score) < 1 || Number(r.body.score) > 5)
        hiringError('Invalid review.'); const applicant = id(r.params.id); if (!(await c.query('SELECT id FROM hiring_applicants WHERE tenant_id=$1 AND id=$2', [u.tenantId, applicant])).rowCount)
        hiringError('Candidate unavailable.', 404); const review = (await c.query('INSERT INTO hiring_application_reviews(tenant_id,applicant_id,reviewer_id,recommendation,score,notes) VALUES($1,$2,$3,$4,$5,$6) RETURNING id', [u.tenantId, applicant, u.employeeId, r.body.recommendation, Number(r.body.score), text(r.body.notes, 4000)])).rows[0]; await audit(c, u, 'application_reviewed', review.id); return { review }; });
    route('post', '/offers/:id/revise', 'hiring.manage_offers', async (r, c, u) => { await requireHiring(c, u, 'compensation.manage'); only(r.body, ['version', 'salary', 'currency', 'startDate', 'expiresOn', 'notes']); const o = await offer(c, u.tenantId, id(r.params.id), true); if (!['draft', 'sent'].includes(o.status) || r.body.version !== o.version)
        hiringError('Offer version changed or cannot be revised.', 409); const salary = text(r.body.salary, 16, true), currency = text(r.body.currency, 3, true).toUpperCase(), start = text(r.body.startDate, 10, true), expires = text(r.body.expiresOn, 10, true); if (!/^\d{1,12}(\.\d{1,2})?$/.test(salary) || !/^[A-Z]{3}$/.test(currency) || [start, expires].some(d => !/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(Date.parse(d)) || new Date(d).toISOString().slice(0, 10) !== d) || expires < new Date().toISOString().slice(0, 10))
        hiringError('Invalid revised terms.'); const notes = text(r.body.notes, 4000), changed = [['salary', salary, o.salary], ['currency', currency, o.currency], ['start_date', start, String(o.start_date).slice(0, 10)], ['expires_on', expires, String(o.expires_on).slice(0, 10)], ['notes', notes, o.notes || '']].filter(([, a, b]) => a !== b).map(([key]) => key); if (!changed.length)
        hiringError('Change at least one field.'); await c.query("UPDATE hiring_offers SET status='superseded',public_token_hash=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2", [u.tenantId, o.id]); const revised = (await c.query('INSERT INTO hiring_offers(tenant_id,applicant_id,created_by,salary,currency,start_date,expires_on,notes,root_id,version,supersedes_id,changed_fields,terms) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *', [u.tenantId, o.applicant_id, u.employeeId, salary, currency, start, expires, notes, o.root_id, o.version + 1, o.id, changed, o.terms])).rows[0]; await audit(c, u, 'offer_revised', revised.id, 'draft'); return { offer: revised }; });
    route('post', '/offers/:id/candidate-link', 'hiring.manage_offers', async (r, c, u) => { await requireHiring(c, u, 'compensation.manage'); only(r.body, ['confirmed']); if (r.body.confirmed !== true)
        hiringError('Confirm creating a confidential candidate link.'); const o = await offer(c, u.tenantId, id(r.params.id), true); if (!['draft', 'sent'].includes(o.status) || new Date(o.expires_on) < new Date(new Date().toISOString().slice(0, 10)))
        hiringError('Offer is unavailable.', 409); const token = crypto.randomBytes(32).toString('base64url'); await c.query('UPDATE hiring_offers SET public_token_hash=$3 WHERE tenant_id=$1 AND id=$2', [u.tenantId, o.id, crypto.createHash('sha256').update(token).digest('hex')]); await audit(c, u, 'offer_link_created', o.id); return { path: '/offers/' + token, version: o.version, notice: 'Confidential bearer link. Share only with the intended candidate. It becomes active after confirmed offer delivery.' }; });
    route('get', '/onboarding/owners', 'hiring.onboarding.manage', async (_r, c, u) => ({ employees: (await c.query("SELECT id,full_name name FROM employees WHERE tenant_id=$1 AND is_active AND employment_status='active' ORDER BY full_name,id", [u.tenantId])).rows }));
    route('get', '/onboarding/summary', 'hiring.onboarding.view', async (_r, c, u) => { const today = (await c.query('SELECT current_date::text today')).rows[0].today, dates = resolveDateWindow({ window: 'this_week' }, today); const week = await onboardingReadiness(c, u, dates), risk = await onboardingReadiness(c, u, { state: 'needs_attention' }), blocked = await onboardingReadiness(c, u, { state: 'blocked' }), equipment = await onboardingReadiness(c, u, { kind: 'equipment' }), access = await onboardingReadiness(c, u, { kind: 'access' }); return { newHires: week, onboardingRisk: { hires: [...blocked.hires, ...risk.hires].slice(0, 5), total: blocked.total + risk.total }, equipmentPending: equipment, accessPending: access, firstDayReadiness: week }; });
    route('get', '/onboarding/templates', 'hiring.onboarding.view', async (_r, c, u) => ({ templates: (await c.query('SELECT id,name,tasks FROM hiring_onboarding_templates WHERE tenant_id=$1 ORDER BY name LIMIT 100', [u.tenantId])).rows }));
    route('post', '/onboarding/templates', 'hiring.onboarding.manage', async (r, c, u) => { only(r.body, ['name', 'tasks']); const tasks = validateTemplate(r.body.tasks); const row = (await c.query('INSERT INTO hiring_onboarding_templates(tenant_id,name,tasks,created_by) VALUES($1,$2,$3,$4) RETURNING id', [u.tenantId, text(r.body.name, 160, true), JSON.stringify(tasks), u.employeeId])).rows[0]; await audit(c, u, 'onboarding_template_created', row.id); return { template: row }; });
    route('post', '/onboarding/employees/:id/template', 'hiring.onboarding.manage', async (r, c, u) => { only(r.body, ['templateId']); const result = await applyOnboardingTemplate(c, u, id(r.params.id), id(r.body.templateId)); await audit(c, u, 'onboarding_template_applied', id(r.params.id)); return result; });
    route('get', '/onboarding/readiness', 'hiring.onboarding.view', async (r, c, u) => { only(r.query, ['employeeId', 'state', 'kind', 'overdue']); if (r.query.state && !['ready', 'needs_attention', 'blocked'].includes(String(r.query.state)) || r.query.kind && !TASK_KINDS.includes(r.query.kind as any) || r.query.overdue !== undefined && r.query.overdue !== 'true')
        hiringError('Invalid readiness filter.'); return onboardingReadiness(c, u, { employeeId: r.query.employeeId ? id(r.query.employeeId) : undefined, state: r.query.state as string, kind: r.query.kind as string, overdue: r.query.overdue === 'true' }); });
    route('post', '/onboarding/tasks/:id', 'hiring.onboarding.manage', async (r, c, u) => { only(r.body, ['status', 'ownerId', 'dueOn', 'notes']); const b = r.body; if (!['pending', 'in_progress', 'blocked', 'completed'].includes(b.status))
        hiringError('Invalid task state.'); const t = (await c.query('SELECT * FROM hiring_onboarding_tasks WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [u.tenantId, id(r.params.id)])).rows[0]; if (!t)
        hiringError('Task unavailable.', 404); if (t.dependency_id && b.status === 'completed' && !(await c.query("SELECT 1 FROM hiring_onboarding_tasks WHERE tenant_id=$1 AND id=$2 AND employee_id=$3 AND status='completed'", [u.tenantId, t.dependency_id, t.employee_id])).rowCount)
        hiringError('Complete the prerequisite first.', 409); const owner = b.ownerId ? id(b.ownerId) : null; if (owner && !(await c.query("SELECT 1 FROM employees WHERE tenant_id=$1 AND id=$2 AND is_active AND employment_status='active'", [u.tenantId, owner])).rowCount)
        hiringError('Owner unavailable.', 404); const due = b.dueOn || null; if (due && (!/^\d{4}-\d{2}-\d{2}$/.test(due) || !Number.isFinite(Date.parse(due)) || new Date(due).toISOString().slice(0, 10) !== due))
        hiringError('Invalid due date.'); await c.query("UPDATE hiring_onboarding_tasks SET status=$3,owner_id=$4,due_on=$5,notes=$6,completed_at=CASE WHEN $3='completed' THEN now() ELSE NULL END WHERE tenant_id=$1 AND id=$2", [u.tenantId, t.id, b.status, owner, due, text(b.notes, 4000)]); await audit(c, u, 'onboarding_task_updated', t.id, b.status); return { updated: true }; });
    app.get('/api/hiring/offers/:id/document', deps.standardAuth, async (r, res) => { res.setHeader('Cache-Control', 'no-store'); try {
        const o = await withTenant(r.authUser!.tenantId, async (c) => { await requireHiring(c, r.authUser!, 'hiring.manage_offers'); await requireHiring(c, r.authUser!, 'compensation.manage'); return offer(c, r.authUser!.tenantId, id(r.params.id)); });
        res.type('application/pdf').setHeader('Content-Disposition', 'attachment; filename="offer-v' + o.version + '.pdf"');
        res.send(await offerPdf(o));
    }
    catch (e) {
        failure(res, e);
    } });
    async function publicOffer(token: string, fn: (c: any, tenant: string, hash: string) => Promise<any>) { if (!/^[A-Za-z0-9_-]{43}$/.test(token))
        hiringError('Offer unavailable.', 404); const hash = crypto.createHash('sha256').update(token).digest('hex'), tenant = (await getDbPool().query('SELECT tenant_id FROM stanza_public_offer_tenant($1)', [hash])).rows[0]?.tenant_id; if (!tenant)
        hiringError('Offer unavailable or expired.', 404); return withTenant(tenant, c => fn(c, tenant, hash)); }
    const readPublic = async (c: any, tenant: string, hash: string, lock = false) => { const row = (await c.query("SELECT o.id FROM hiring_offers o WHERE o.tenant_id=$1 AND o.public_token_hash=$2 AND o.status IN('sent','accepted','rejected') AND o.expires_on>=current_date" + (lock ? ' FOR UPDATE' : ''), [tenant, hash])).rows[0]; if (!row)
        hiringError('Offer unavailable or expired.', 404); return offer(c, tenant, row.id, lock); };
    app.get('/api/public/offers/:token', deps.rateLimiter, async (r, res) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); try {
        res.json({ success: true, offer: await publicOffer(r.params.token, async (c, t, h) => safeOffer(await readPublic(c, t, h))) });
    }
    catch (e) {
        failure(res, e);
    } });
    app.post('/api/public/offers/:token/respond', deps.rateLimiter, deps.mutationGuard, async (r, res) => { res.setHeader('Cache-Control', 'no-store'); try {
        only(r.body, ['version', 'response', 'acknowledged']);
        if (!['accepted', 'rejected'].includes(r.body.response) || r.body.acknowledged !== true)
            hiringError('Explicit acknowledgement required.');
        const result = await publicOffer(r.params.token, async (c, t, h) => { const o = await readPublic(c, t, h, true); if (r.body.version !== o.version)
            hiringError('Offer version changed.', 409); if (o.status === r.body.response)
            return { status: o.status }; if (o.status !== 'sent')
            hiringError('Response already recorded.', 409); await c.query('UPDATE hiring_offers SET status=$3,acknowledged_at=now(),response_note=$4,updated_at=now() WHERE tenant_id=$1 AND id=$2', [t, o.id, r.body.response, 'Candidate explicit acknowledgement; no digital signature.']); await recordAuditEvent(c, { tenantId: t, actorId: null, action: 'hiring.offer_acknowledged', targetType: 'hiring_offer', targetId: o.id, metadata: { status: r.body.response } }); return { status: r.body.response }; });
        res.json({ success: true, ...result });
    }
    catch (e) {
        failure(res, e);
    } });
    app.get('/api/public/offers/:token/document', deps.rateLimiter, async (r, res) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); try {
        const o = await publicOffer(r.params.token, (c, t, h) => readPublic(c, t, h));
        res.type('application/pdf').setHeader('Content-Disposition', 'attachment; filename="offer-v' + o.version + '.pdf"');
        res.send(await offerPdf(o));
    }
    catch (e) {
        failure(res, e);
    } });
}
