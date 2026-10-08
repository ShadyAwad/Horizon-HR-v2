import {validateQuestions,validateAnswers,publicQuestions} from '../../lib/hiring-depth';
import path from 'node:path';
import type express from 'express';
import type { PoolClient } from 'pg';
import crypto from 'node:crypto';
import multer from 'multer';
import { PDFDocument } from 'pdf-lib';
import { getDbPool, withTenant } from '../../lib/hr-background';
import { PrivateExtractionStorage } from '../document-extraction/extraction-storage';
import { resolveScopedPermission } from '../organisation/scoped-permissions';
import { recordAuditEvent } from '../audit/audit-events';
import { createCommunicationDraft, saveCommunicationMeeting, createCandidateInterviewInvitation } from '../communications/communications-routes';
import { createHiredEmployee } from './employee-onboarding';
import { logServerError } from '../../lib/server-logging';
type Actor = {
    tenantId: string;
    employeeId: string;
};
const store = new PrivateExtractionStorage(path.join(process.env.GRIEVANCE_ATTACHMENT_DIRECTORY || 'uploads/private-grievances', 'hiring'), Infinity);
const fail = (statusCode: number, message: string) => { throw Object.assign(Error(message), { statusCode }); };
const uuid = (v: unknown) => { if (typeof v !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v))
    fail(404, 'Record unavailable.'); return v as string; };
const text = (v: unknown, max: number, required = false) => { if (v == null && !required)
    return ''; if (typeof v !== 'string' || v.trim().length > max || required && !v.trim())
    fail(400, 'Invalid text field.'); return (v as string).trim(); };
const date = (v: unknown, required = false) => { if (!v && !required)
    return null; if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v)
    fail(400, 'Invalid date.'); return v as string; };
export async function hiringAllowed(c: PoolClient, u: Actor, key: string) { return (await resolveScopedPermission(c, { tenantId: u.tenantId, actorEmployeeId: u.employeeId, permissionKey: key })).allowed; }
async function allowed(c: PoolClient, u: Actor, key: string) { if (!await hiringAllowed(c, u, key))
    fail(403, 'Hiring permission required.'); }
async function candidate(c: PoolClient, u: Actor, id: unknown, lock = false) { const r = (await c.query('SELECT * FROM hiring_applicants WHERE tenant_id=$1 AND id=$2' + (lock ? ' FOR UPDATE' : ''), [u.tenantId, uuid(id)])).rows[0]; if (!r)
    fail(404, 'Candidate unavailable.'); return r; }
async function audit(c: PoolClient, u: Actor, action: string, id: string, status?: string) { await recordAuditEvent(c, { tenantId: u.tenantId, actorId: u.employeeId, action: 'hiring.' + action, targetType: 'hiring_workflow', targetId: id, metadata: status ? { status } : {} }); }
function error(res: express.Response, e: unknown) { const status = (e as {
    statusCode?: number;
}).statusCode || 500; if (status === 500)
    logServerError('hiring workflow failed', e); res.status(status).json({ success: false, error: status === 500 ? 'Hiring request failed.' : (e as Error).message }); }
export function registerAtsRoutes(app: express.Express, deps: {
    standardAuth: express.RequestHandler;
    mutationGuard: express.RequestHandler;
    rateLimiter: express.RequestHandler;
}) {
    const route = (method: 'get' | 'post', path: string, key: string, fn: (r: express.Request, c: PoolClient, u: Actor) => Promise<object>) => app[method]('/api/hiring' + path, deps.standardAuth, ...(method === 'post' ? [deps.mutationGuard, deps.rateLimiter] : []), async (r, res) => { res.setHeader('Cache-Control', 'no-store'); try {
        const data = await withTenant(r.authUser!.tenantId, async (c) => { const u = r.authUser!; await allowed(c, u, key); return fn(r, c, u); });
        res.json({ success: true, ...data });
    }
    catch (e) {
        error(res, e);
    } });
    route('get', '/workflow-capabilities', 'hiring.view', async (_r, c, u) => { const capabilities: Record<string, boolean> = {}; for (const key of ['manage_jobs', 'schedule_interviews', 'evaluate', 'manage_offers', 'hire','review_applications'])
        capabilities[key] = await hiringAllowed(c, u, 'hiring.' + key); capabilities.schedule_interviews = capabilities.schedule_interviews && await hiringAllowed(c, u, 'communications.meetings.manage'); capabilities.send = await hiringAllowed(c, u, 'communications.send'); capabilities.compensation = await hiringAllowed(c, u, 'compensation.manage'); for (const [name, key] of [['people', 'organisation.view'], ['equipment', 'assets.manage'], ['roster', 'roster.manage'], ['roles', 'roles.manage']])
        capabilities[name] = await hiringAllowed(c, u, key);capabilities.onboarding_view=await hiringAllowed(c,u,'hiring.onboarding.view');capabilities.onboarding_manage=await hiringAllowed(c,u,'hiring.onboarding.manage'); return { capabilities }; });
    route('get', '/jobs', 'hiring.view', async (r, c, u) => { const page = Math.max(1, Math.min(100000, Number(r.query.page) || 1)), status = text(r.query.status, 20); if (status && !['draft', 'open', 'paused', 'closed', 'filled'].includes(status))
        fail(400, 'Invalid job status.'); const where = "tenant_id=$1 AND ($2='' OR status=$2)"; return { jobs: (await c.query(`SELECT * FROM hiring_jobs WHERE ${where} ORDER BY created_at DESC,id LIMIT 20 OFFSET $3`, [u.tenantId, status, (page - 1) * 20])).rows, total: Number((await c.query(`SELECT count(*) FROM hiring_jobs WHERE ${where}`, [u.tenantId, status])).rows[0].count), page }; });
    route('get', '/job-options', 'hiring.manage_jobs', async (_r, c, u) => ({ employees: (await c.query("SELECT id,full_name name FROM employees WHERE tenant_id=$1 AND is_active AND employment_status='active' ORDER BY full_name", [u.tenantId])).rows, departments: (await c.query('SELECT id,name FROM organisation_departments WHERE tenant_id=$1 AND is_active ORDER BY name', [u.tenantId])).rows, locations: (await c.query('SELECT id,name FROM company_locations WHERE tenant_id=$1 AND is_active ORDER BY name', [u.tenantId])).rows }));
    route('post', '/jobs', 'hiring.manage_jobs', async (r, c, u) => { const b = r.body, title = text(b.title, 160, true), description = text(b.description, 12000, true), requirements = text(b.requirements, 12000), type = b.employmentType || 'full_time'; if (!['full_time', 'part_time', 'contract', 'internship'].includes(type) || !Number.isInteger(Number(b.headcount || 1)) || Number(b.headcount || 1) < 1 || Number(b.headcount || 1) > 1000)
        fail(400, 'Invalid job fields.'); const open = date(b.opensOn), close = date(b.closesOn); if (open && close && close < open)
        fail(400, 'Closing date precedes opening.'); const manager = b.managerId ? uuid(b.managerId) : null, owner = b.ownerId ? uuid(b.ownerId) : u.employeeId; for (const id of [manager, owner].filter(Boolean))
        if (!(await c.query("SELECT 1 FROM employees WHERE tenant_id=$1 AND id=$2 AND is_active AND employment_status='active'", [u.tenantId, id])).rowCount)
            fail(404, 'Job owner unavailable.'); const department = b.departmentId ? uuid(b.departmentId) : null, location = b.locationId ? uuid(b.locationId) : null; let departmentName = ''; if (department) {
        const d = (await c.query('SELECT name FROM organisation_departments WHERE tenant_id=$1 AND id=$2 AND is_active', [u.tenantId, department])).rows[0];
        if (!d)
            fail(404, 'Department unavailable.');
        departmentName = d.name;
    } if (location && !(await c.query('SELECT 1 FROM company_locations WHERE tenant_id=$1 AND id=$2 AND is_active', [u.tenantId, location])).rowCount)
        fail(404, 'Location unavailable.'); const questions=validateQuestions(b.questions??[]); const job = (await c.query('INSERT INTO hiring_jobs(tenant_id,public_token,title,description,requirements,department,department_id,location_id,manager_id,owner_id,employment_type,headcount,opens_on,closes_on) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *', [u.tenantId, crypto.randomBytes(32).toString('base64url'), title, description, requirements, departmentName, department, location, manager, owner, type, Number(b.headcount || 1), open, close])).rows[0]; await c.query('UPDATE hiring_jobs SET application_questions=$3::jsonb WHERE tenant_id=$1 AND id=$2',[u.tenantId,job.id,JSON.stringify(questions)]); await audit(c, u, 'job_created', job.id, 'draft'); return { job }; });
    route('post', '/jobs/:id/status', 'hiring.manage_jobs', async (r, c, u) => { if (!['draft', 'open', 'paused', 'closed', 'filled'].includes(r.body.status))
        fail(400, 'Invalid job status.'); const job = (await c.query('UPDATE hiring_jobs SET status=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *', [u.tenantId, uuid(r.params.id), r.body.status])).rows[0]; if (!job)
        fail(404, 'Job unavailable.'); await audit(c, u, 'job_status', job.id, job.status); return { job }; });
    route('get', '/applicants/:id/workflow', 'hiring.view', async (r, c, u) => { const a = await candidate(c, u, r.params.id), canOffer = await hiringAllowed(c, u, 'hiring.manage_offers') && await hiringAllowed(c, u, 'compensation.manage'); const interviews = (await c.query('SELECT i.*,m.title,m.starts_at,m.ends_at,m.location,m.status FROM hiring_interviews i JOIN communication_meetings m ON m.tenant_id=i.tenant_id AND m.id=i.meeting_id WHERE i.tenant_id=$1 AND i.applicant_id=$2 ORDER BY m.starts_at DESC', [u.tenantId, a.id])).rows; const evaluations = (await c.query("SELECT v.*,e.full_name author_name FROM hiring_evaluations v JOIN employees e ON e.tenant_id=v.tenant_id AND e.id=v.author_id JOIN hiring_interviews i ON i.tenant_id=v.tenant_id AND i.id=v.interview_id WHERE v.tenant_id=$1 AND i.applicant_id=$2 AND (v.author_id=$3 OR $4)", [u.tenantId, a.id, u.employeeId, await hiringAllowed(c, u, 'hiring.make_final_decision')])).rows; const messages = (await c.query("SELECT id,subject,body,status,failure_code,created_at,(invitation_ics IS NOT NULL) calendar_attached FROM communication_messages WHERE tenant_id=$1 AND related_candidate_id=$2 AND sender_id=$3 ORDER BY created_at DESC LIMIT 30", [u.tenantId, a.id, u.employeeId])).rows; return { resumeAvailable: !!a.resume_key, coverNote: a.cover_note, interviews, evaluations, messages, offers: canOffer ? (await c.query("SELECT *,CASE WHEN status='sent' AND expires_on<current_date THEN 'expired' ELSE status END effective_status FROM hiring_offers WHERE tenant_id=$1 AND applicant_id=$2 ORDER BY created_at DESC", [u.tenantId, a.id])).rows : [], employeeId: a.hired_employee_id, applicationAnswers:a.application_answers, questionSnapshot:a.question_snapshot,screeningFlags:a.screening_flags,reviews:(await c.query('SELECT v.id,v.recommendation,v.score,v.notes,v.created_at,e.full_name reviewer_name FROM hiring_application_reviews v JOIN employees e ON e.tenant_id=v.tenant_id AND e.id=v.reviewer_id WHERE v.tenant_id=$1 AND v.applicant_id=$2 ORDER BY v.created_at DESC LIMIT 30',[u.tenantId,a.id])).rows, tasks: a.hired_employee_id && await hiringAllowed(c,u,'hiring.onboarding.view') ? (await c.query('SELECT id,title,completed_at FROM hiring_onboarding_tasks WHERE tenant_id=$1 AND employee_id=$2', [u.tenantId, a.hired_employee_id])).rows : [] }; });
    route('post', '/applicants/:id/interviews', 'hiring.schedule_interviews', async (r, c, u) => { const a = await candidate(c, u, r.params.id); const ids = r.body.attendeeIds; if (!Array.isArray(ids) || !ids.length)
        fail(400, 'Choose an interviewer.'); const { meeting } = await saveCommunicationMeeting(c, u, { ...r.body, title: ('Interview: ' + a.full_name + ' — ' + a.position_title).slice(0,200) }); const interview = (await c.query('INSERT INTO hiring_interviews(tenant_id,applicant_id,meeting_id,interview_type) VALUES($1,$2,$3,$4) RETURNING *', [u.tenantId, a.id, meeting.id, text(r.body.interviewType, 100, true)])).rows[0]; await audit(c, u, 'interview_scheduled', interview.id); return { interview, meeting }; });
    route('post','/interviews/:id/invitation','hiring.schedule_interviews',async(r,c,u)=>createCandidateInterviewInvitation(c,u,uuid(r.params.id)));
    route('post', '/interviews/:id/evaluations', 'hiring.evaluate', async (r, c, u) => { const id = uuid(r.params.id); if (!(await c.query('SELECT 1 FROM hiring_interviews i JOIN communication_meeting_attendees a ON a.tenant_id=i.tenant_id AND a.meeting_id=i.meeting_id WHERE i.tenant_id=$1 AND i.id=$2 AND a.employee_id=$3', [u.tenantId, id, u.employeeId])).rowCount)
        fail(403, 'Only assigned interviewers can submit feedback.'); const b = r.body; if (!['strong_yes', 'yes', 'no', 'strong_no'].includes(b.recommendation) || !Number.isInteger(Number(b.score)) || Number(b.score) < 1 || Number(b.score) > 5)
        fail(400, 'Invalid evaluation.'); const evaluation = (await c.query('INSERT INTO hiring_evaluations(tenant_id,interview_id,author_id,recommendation,score,strengths,concerns,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(tenant_id,interview_id,author_id) DO UPDATE SET recommendation=EXCLUDED.recommendation,score=EXCLUDED.score,strengths=EXCLUDED.strengths,concerns=EXCLUDED.concerns,notes=EXCLUDED.notes RETURNING id', [u.tenantId, id, u.employeeId, b.recommendation, Number(b.score), text(b.strengths, 2000), text(b.concerns, 2000), text(b.notes, 4000)])).rows[0]; await audit(c, u, 'evaluation_submitted', evaluation.id); return { evaluation }; });
    route('post', '/applicants/:id/message', 'hiring.view', async (r, c, u) => { const a = await candidate(c, u, r.params.id); if (!a.email)
        fail(400, 'Candidate has no email.'); const result = await createCommunicationDraft(c, u, { ...r.body, category: 'hiring', recipientIds: [], related: { type: 'candidate', id: a.id } }); await audit(c, u, 'message_drafted', result.message.id); return result; });
    route('post', '/applicants/:id/offers', 'hiring.manage_offers', async (r, c, u) => { await allowed(c, u, 'compensation.manage'); const a = await candidate(c, u, r.params.id, true); if (a.stage !== 'offer' || a.hired_employee_id)
        fail(409, 'Move the candidate to Offer first.'); const b = r.body; if (typeof b.salary !== 'string' || !/^\d{1,12}(\.\d{1,2})?$/.test(b.salary))
        fail(400, 'Enter a valid compensation amount.'); const currency = text(b.currency, 3, true).toUpperCase(); if (!/^[A-Z]{3}$/.test(currency))
        fail(400, 'Invalid currency.'); const start = date(b.startDate, true), expires = date(b.expiresOn, true); if (expires! < new Date().toISOString().slice(0, 10))
        fail(400, 'Offer expiry is in the past.'); await c.query("UPDATE hiring_offers SET status='expired' WHERE tenant_id=$1 AND applicant_id=$2 AND status='sent' AND expires_on<current_date", [u.tenantId, a.id]); const offer = (await c.query('INSERT INTO hiring_offers(tenant_id,applicant_id,created_by,salary,currency,start_date,expires_on,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [u.tenantId, a.id, u.employeeId, b.salary, currency, start, expires, text(b.notes, 4000)])).rows[0]; await c.query("UPDATE hiring_offers o SET terms=jsonb_build_object('title',j.title,'department',j.department,'departmentId',j.department_id,'managerId',j.manager_id,'locationId',j.location_id,'location',l.name,'employmentType',j.employment_type) FROM hiring_jobs j LEFT JOIN company_locations l ON l.tenant_id=j.tenant_id AND l.id=j.location_id WHERE o.tenant_id=$1 AND o.id=$2 AND j.tenant_id=$1 AND j.id=$3",[u.tenantId,offer.id,a.job_id]); await audit(c, u, 'offer_created', offer.id, 'draft'); return { offer }; });
    route('post', '/offers/:id/status', 'hiring.manage_offers', async (r, c, u) => { await allowed(c, u, 'compensation.manage'); const offer = (await c.query('SELECT * FROM hiring_offers WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [u.tenantId, uuid(r.params.id)])).rows[0]; if (!offer)
        fail(404, 'Offer unavailable.'); const target = r.body.status, transitions: Record<string, string[]> = { draft: ['sent', 'withdrawn'], sent: ['accepted', 'rejected', 'withdrawn', 'expired'] }; if (!transitions[offer.status]?.includes(target))
        fail(409, 'Offer transition unavailable.'); if (['sent', 'accepted'].includes(target) && new Date(offer.expires_on).getTime() < new Date(new Date().toISOString().slice(0, 10)).getTime())
        fail(409, 'Offer expired.'); let messageId = offer.message_id; if (target === 'sent') {
        messageId = uuid(r.body.messageId);
        if (!(await c.query("SELECT 1 FROM communication_messages WHERE tenant_id=$1 AND id=$2 AND related_candidate_id=$3 AND sender_id=$4 AND status='sent' AND sent_at>=$5", [u.tenantId, messageId, offer.applicant_id, u.employeeId,offer.created_at])).rowCount)
            fail(409, 'Offer email must have confirmed delivery first.');
    } if (['accepted', 'rejected'].includes(target) && r.body.confirmed !== true)
        fail(400, 'Confirm the candidate response explicitly.'); const note = text(r.body.responseNote, 2000, ['accepted', 'rejected'].includes(target)); await c.query('UPDATE hiring_offers SET status=$3,message_id=$4,response_note=$5,updated_at=now() WHERE tenant_id=$1 AND id=$2', [u.tenantId, offer.id, target, messageId, note]); await audit(c, u, 'offer_status', offer.id, target); return { status: target }; });
    route('post', '/applicants/:id/hire', 'hiring.hire', async (r, c, u) => { await allowed(c, u, 'compensation.manage'); if (r.body.confirmed !== true)
        fail(400, 'Explicit hire confirmation required.'); const a = await candidate(c, u, r.params.id, true); if (a.hired_employee_id)
        return { employeeId: a.hired_employee_id }; const offer = (await c.query("SELECT * FROM hiring_offers WHERE tenant_id=$1 AND applicant_id=$2 AND status='accepted' FOR UPDATE", [u.tenantId, a.id])).rows[0]; if (!offer || a.stage !== 'offer' || !a.email || !a.job_id)
        fail(409, 'An accepted offer and linked job are required.'); const job = (await c.query('SELECT * FROM hiring_jobs WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [u.tenantId, a.job_id])).rows[0]; if (!job || !['open', 'paused'].includes(job.status))
        fail(409, 'Job no longer accepts hires.'); const terms=offer.terms;const hireJob={...job,title:terms.title||job.title,department_id:terms.departmentId??job.department_id,manager_id:terms.managerId??job.manager_id,location_id:terms.locationId??job.location_id,employment_type:terms.employmentType||job.employment_type};const employee = await createHiredEmployee(c, u.tenantId, a, hireJob, offer.start_date); await c.query("UPDATE hiring_applicants SET stage='hired',hired_employee_id=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2", [u.tenantId, a.id, employee.id]); await c.query("INSERT INTO hiring_stage_history(tenant_id,applicant_id,actor_id,previous_stage,new_stage,reason) VALUES($1,$2,$3,'offer','hired','Accepted offer conversion')", [u.tenantId, a.id, u.employeeId]); await audit(c, u, 'hire_confirmed', a.id, 'hired'); await c.query("UPDATE hiring_jobs SET status='filled' WHERE tenant_id=$1 AND id=$2 AND headcount<=(SELECT count(*) FROM hiring_applicants WHERE tenant_id=$1 AND job_id=$2 AND hired_employee_id IS NOT NULL)", [u.tenantId, job.id]); return { employeeId: employee.id }; });
    route('post', '/onboarding/:id/complete', 'hiring.onboarding.manage', async (r, c, u) => { const result = await c.query("UPDATE hiring_onboarding_tasks SET completed_at=now(),status='completed' WHERE tenant_id=$1 AND id=$2 AND (dependency_id IS NULL OR EXISTS(SELECT 1 FROM hiring_onboarding_tasks d WHERE d.tenant_id=$1 AND d.id=hiring_onboarding_tasks.dependency_id AND d.status='completed')) RETURNING id", [u.tenantId, uuid(r.params.id)]); if (!result.rowCount)
        fail(404, 'Task unavailable.'); return { completed: true }; });
    route('get', '/summary', 'hiring.view', async (_r, c, u) => ({ jobs: (await c.query("SELECT id,title,status FROM hiring_jobs WHERE tenant_id=$1 AND status='open' ORDER BY created_at DESC LIMIT 5", [u.tenantId])).rows, openRoles: Number((await c.query("SELECT count(*) FROM hiring_jobs WHERE tenant_id=$1 AND status='open'", [u.tenantId])).rows[0].count), pipeline: (await c.query("SELECT stage,count(*)::int count FROM hiring_applicants WHERE tenant_id=$1 AND status='active' GROUP BY stage", [u.tenantId])).rows, interviews: (await c.query("SELECT i.id,m.title,m.starts_at FROM hiring_interviews i JOIN communication_meetings m ON m.tenant_id=i.tenant_id AND m.id=i.meeting_id WHERE i.tenant_id=$1 AND m.status='scheduled' AND m.starts_at>=now() ORDER BY m.starts_at LIMIT 5", [u.tenantId])).rows, offersPending: await hiringAllowed(c, u, 'hiring.manage_offers') ? Number((await c.query("SELECT count(*) FROM hiring_offers WHERE tenant_id=$1 AND status='sent' AND expires_on>=current_date", [u.tenantId])).rows[0].count) : null }));
    app.get('/api/hiring/applicants/:id/resume', deps.standardAuth, async (r, res) => { res.setHeader('Cache-Control', 'no-store'); try {
        const key = await withTenant(r.authUser!.tenantId, async (c) => { await allowed(c, r.authUser!, 'hiring.view'); return (await candidate(c, r.authUser!, r.params.id)).resume_key; });
        if (!key)
            fail(404, 'Resume unavailable.');
        res.setHeader('Content-Disposition', 'attachment; filename="resume.pdf"');
        res.type('application/pdf').send(await store.read(key));
    }
    catch (e) {
        error(res, e);
    } });
    async function publicJob(token: string) { if (!/^[A-Za-z0-9_-]{43}$/.test(token))
        fail(404, 'Job unavailable.'); const row = (await getDbPool().query('SELECT tenant_id FROM stanza_public_job_tenant($1)', [token])).rows[0]; if (!row)
        fail(404, 'Job unavailable.'); return row.tenant_id as string; }
    app.get('/api/public/jobs/:token', deps.rateLimiter, async (r, res) => { res.setHeader('Cache-Control', 'no-store'); try {
        const tenant = await publicJob(r.params.token);
        const job = await withTenant(tenant, async (c) => (await c.query("SELECT j.application_questions,j.title,j.description,j.requirements,j.department,j.employment_type,j.closes_on,l.name location,t.company_name FROM hiring_jobs j JOIN tenants t ON t.id=j.tenant_id LEFT JOIN company_locations l ON l.tenant_id=j.tenant_id AND l.id=j.location_id WHERE j.tenant_id=$1 AND j.public_token=$2 AND j.status='open' AND (j.opens_on IS NULL OR j.opens_on<=current_date) AND (j.closes_on IS NULL OR j.closes_on>=current_date)", [tenant, r.params.token])).rows[0]);
        if (!job)
            fail(404, 'Job unavailable.');
        const {application_questions,...safeJob}=job;res.json({ success: true, job:{...safeJob,questions:publicQuestions(application_questions)} });
    }
    catch (e) {
        error(res, e);
    } });
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 6 * 1024 * 1024, files: 1, fields: 7 } }).single('resume');
    app.post('/api/public/jobs/:token/apply', deps.rateLimiter, deps.mutationGuard, async (r, res) => { let key: string | undefined; res.setHeader('Cache-Control', 'no-store'); try {
        const tenant = await publicJob(r.params.token);
        await new Promise<void>((resolve, reject) => upload(r, res, e => e ? reject(Object.assign(e, { statusCode: 400 })) : resolve()));
        const b = r.body;
        if (Object.keys(b).some(k => !['fullName', 'email', 'phone', 'coverNote', 'consent','answers'].includes(k)))
            fail(400, 'Unknown application field.');
        const name = text(b.fullName, 160, true), email = text(b.email, 254, true).toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || b.consent !== 'true')
            fail(400, 'Valid email and privacy consent required.');
        if (!r.file || r.file.mimetype !== 'application/pdf' || !r.file.buffer.subarray(0, 5).equals(Buffer.from('%PDF-')))
            fail(400, 'Upload a PDF resume up to 6 MB.');
        try {
            const pdf = await PDFDocument.load(r.file.buffer);
            if (pdf.getPageCount() > 50 || pdf.getPageCount() < 1)
                fail(400, 'Resume must have 1–50 pages.');
        }
        catch {
            fail(400, 'Invalid PDF resume.');
        }
        key = await store.write(r.file.buffer);
        let saved = false;
        await withTenant(tenant, async (c) => { const job = (await c.query("SELECT * FROM hiring_jobs WHERE tenant_id=$1 AND public_token=$2 AND status='open' AND (opens_on IS NULL OR opens_on<=current_date) AND (closes_on IS NULL OR closes_on>=current_date) FOR SHARE", [tenant, r.params.token])).rows[0]; if (!job)
            fail(404, 'Job unavailable.'); let rawAnswers:unknown={};try{rawAnswers=b.answers?JSON.parse(b.answers):{};}catch{fail(400,'Invalid answers.');}const screening=validateAnswers(job.application_questions,rawAnswers); const a = (await c.query("INSERT INTO hiring_applicants(tenant_id,job_id,full_name,email,phone,position_title,department,source,current_owner_id,applied_at,cover_note,consent_at,resume_key) VALUES($1,$2,$3,$4,$5,$6,$7,'public_application',$8,now(),$9,now(),$10) ON CONFLICT(tenant_id,job_id,lower(email)) WHERE job_id IS NOT NULL DO NOTHING RETURNING id", [tenant, job.id, name, email, text(b.phone, 40), job.title, job.department, job.owner_id, text(b.coverNote, 4000), key])).rows[0]; if (a) {
            saved = true;await c.query('UPDATE hiring_applicants SET application_answers=$3::jsonb,question_snapshot=$4::jsonb,screening_flags=$5::jsonb WHERE tenant_id=$1 AND id=$2',[tenant,a.id,JSON.stringify(screening.answers),JSON.stringify(publicQuestions(job.application_questions)),JSON.stringify(screening.flags)]);
            await c.query("INSERT INTO hiring_stage_history(tenant_id,applicant_id,new_stage,reason) VALUES($1,$2,'new','Public application')", [tenant, a.id]);
            await recordAuditEvent(c, { tenantId: tenant, actorId: null, action: 'hiring.application_received', targetType: 'hiring_applicant', targetId: a.id, metadata: { status: 'new' } });
            if (await hiringAllowed(c, { tenantId: tenant, employeeId: job.owner_id }, 'communications.send') && await hiringAllowed(c, { tenantId: tenant, employeeId: job.owner_id }, 'hiring.view'))
                await createCommunicationDraft(c, { tenantId: tenant, employeeId: job.owner_id }, { subject: 'Application received: ' + job.title, body: 'Thank you for applying. Your application has been received for review.', category: 'hiring', recipientIds: [], related: { type: 'candidate', id: a.id } });
            await c.query("INSERT INTO outbox_events(tenant_id,event_type,payload) VALUES($1,'hiring.applicant.created',$2::jsonb)", [tenant, JSON.stringify({ applicantId: a.id, ownerId: job.owner_id })]);
        } });
        if (!saved)
            await store.remove(key);
        key = undefined;
        res.status(201).json({ success: true, message: 'Application received. Duplicate submissions do not create another application.' });
    }
    catch (e) {
        await store.remove(key).catch(() => undefined);
        error(res, e);
    } });
}
