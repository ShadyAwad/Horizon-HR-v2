import type { CommunicationMessage, CommunicationTemplate, CommunicationMeeting, CommunicationPerson, TemplateValues } from '../../lib/communications-contract';
import type express from 'express';
import {caseAccess,caseAction,handlerVisibilitySql} from '../grievances/grievance-policy';
import type { PoolClient } from 'pg';
import { withTenant } from '../../lib/hr-background';
import { emailProviderConfigured } from '../../lib/email';
import { validateFeedEditorDocument } from '../../lib/feed-editor-contract';
import { resolveScopedPermission } from '../organisation/scoped-permissions';
import { recordAuditEvent } from '../audit/audit-events';
import { enqueueMessage } from './communications-queue';
import { category, text, uuid, fail, recipients, variablesIn, renderTemplate, meetingTimes, calendarInvitation, TEMPLATE_VARIABLES } from './communications-rules';
type Dependencies = {
    standardAuth: express.RequestHandler;
    mutationGuard: express.RequestHandler;
    rateLimiter: express.RequestHandler;
    providerConfigured?: typeof emailProviderConfigured;
    dispatch?: typeof enqueueMessage;
};
type Actor = {
    tenantId: string;
    employeeId: string;
};
async function permitted(c: PoolClient, u: Actor, key: string) { return (await resolveScopedPermission(c, { tenantId: u.tenantId, actorEmployeeId: u.employeeId, permissionKey: key })).allowed; }
async function requirePermission(c: PoolClient, u: Actor, key: string) { if (!await permitted(c, u, key))
    throw fail(403, 'PERMISSION_DENIED', 'You do not have permission for this communication action.'); }
async function audit(c: PoolClient, u: Actor, action: string, id: string, status: string) { await recordAuditEvent(c, { tenantId: u.tenantId, actorId: u.employeeId, action: `communications.${action}`, targetType: action.startsWith('meeting') ? 'communication_meeting' : action.startsWith('template') ? 'communication_template' : 'communication_message', targetId: id, metadata: { status } }); }
const safeId = (value: unknown) => { if (!uuid(value))
    throw fail(400, 'VALIDATION_ERROR', 'Invalid record identifier.'); return value; };
async function employeeEmails(c: PoolClient, u: Actor, ids: string[]) { if (!ids.length)
    return []; const rows = (await c.query<CommunicationPerson>("SELECT id,email,full_name FROM employees WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND is_active=true AND employment_status='active'", [u.tenantId, ids])).rows; if (rows.length !== ids.length)
    throw fail(400, 'INVALID_RECIPIENT', 'Recipients must be active employees in this company.'); if (rows.some(r => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email) || /[\r\n]/.test(r.email)))
    throw fail(400, 'INVALID_RECIPIENT', 'A recipient email is invalid.'); return rows; }
async function categoryAccess(c: PoolClient, u: Actor, value: string) { const key: Record<string, string> = { payroll_notice: 'payroll.view_all', grievance_update: 'grievances.review', hiring: 'hiring.view', leave_status: 'leave.view.scoped' }; if (key[value])
    await requirePermission(c, u, key[value]); }
async function related(c: PoolClient, u: Actor, value: unknown) {
    const input = value && typeof value === 'object' ? value as Record<string, unknown> : null;
    if (input == null || !input.type)
        return { employee: null, candidate: null, meeting: null, grievance: null, reporter: null };
    const id = safeId(input.id);
    const type = input.type;
    if (type === 'employee') {
        if (!(await c.query('SELECT id FROM employees WHERE tenant_id=$1 AND id=$2', [u.tenantId, id])).rowCount)
            throw fail(400, 'INVALID_ENTITY', 'Related employee is unavailable.');
        return { employee: id, candidate: null, meeting: null, grievance: null, reporter: null };
    }
    if (type === 'candidate') {
        await requirePermission(c, u, 'hiring.view');
        if (!(await c.query('SELECT id FROM hiring_applicants WHERE tenant_id=$1 AND id=$2', [u.tenantId, id])).rowCount)
            throw fail(400, 'INVALID_ENTITY', 'Related candidate is unavailable.');
        return { employee: null, candidate: id, meeting: null, grievance: null, reporter: null };
    }
    if (type === 'meeting') {
        await requirePermission(c, u, 'communications.meetings.manage');
        if (!(await c.query('SELECT id FROM communication_meetings WHERE tenant_id=$1 AND id=$2', [u.tenantId, id])).rowCount)
            throw fail(400, 'INVALID_ENTITY', 'Related meeting is unavailable.');
        return { employee: null, candidate: null, meeting: id, grievance: null, reporter: null };
    }
    if(type==='grievance'){const row=await caseAccess(c,u,id);await caseAction(c,u,row,'grievances.respond');return {employee:null,candidate:null,meeting:null,grievance:id,reporter:row.employee_id as string};}
    throw fail(400, 'INVALID_ENTITY', 'Supported links are employee, candidate, meeting and grievance.');
}
async function draftInput(c: PoolClient, u: Actor, b: Record<string, unknown>) {
    const kind = category(b.category || 'custom');
    const link = await related(c,u,b.related);
    if(!link.grievance)await categoryAccess(c,u,kind);
    else if(kind!=='grievance_update')throw fail(400,'INVALID_CATEGORY','Linked grievance messages must use grievance_update.');
    const ids=recipients(b.recipientIds||[]);
    await employeeEmails(c,u,ids);
    if(link.grievance&&(ids.length!==1||ids[0]!==link.reporter))throw fail(400,'INVALID_RECIPIENT','A grievance message may only be sent to its reporter.');
    let subject=text(b.subject??'','Subject',200,false),body=text(b.body??'','Body',20000,false),bodyJson=null;
    let templateId: string | null = null;
    const vars: TemplateValues = {};
    if (b.variables && typeof b.variables === 'object')
        for (const [key, value] of Object.entries(b.variables)) {
            if (!(TEMPLATE_VARIABLES as readonly string[]).includes(key) || typeof value !== 'string' || value.length > 300)
                throw fail(400, 'VALIDATION_ERROR', 'Invalid template variable.');
            vars[key] = value;
        }
    if (b.templateId) {
        templateId = safeId(b.templateId);
        const t = (await c.query<CommunicationTemplate>('SELECT * FROM communication_templates WHERE tenant_id=$1 AND id=$2 AND active', [u.tenantId, templateId])).rows[0];
        if (!t)
            throw fail(400, 'INVALID_TEMPLATE', 'Template is inactive or unavailable.');
        await categoryAccess(c, u, t.category);
        if (t.category !== kind)
            throw fail(400, 'INVALID_TEMPLATE', 'Message type must match its template.');
    }
    if (b.bodyJson) {
        const v = validateFeedEditorDocument(b.bodyJson, body);
        if (v.ok === false)
            throw fail(400, 'INVALID_BODY', v.error);
        bodyJson = v.document;
    }
    variablesIn(subject);
    variablesIn(body);
    return { kind, ids, subject, body, bodyJson, link, templateId, vars };
}
export async function createCommunicationDraft(c:PoolClient,u:Actor,body:Record<string,unknown>){await requirePermission(c, u, 'communications.send'); const d = await draftInput(c, u, body); const row = (await c.query('INSERT INTO communication_messages(tenant_id,sender_id,subject,body,body_json,category,recipient_ids,template_id,related_employee_id,related_candidate_id,related_meeting_id,variables,related_grievance_id) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12::jsonb,$13) RETURNING *', [u.tenantId, u.employeeId, d.subject, d.body, JSON.stringify(d.bodyJson), d.kind, d.ids, d.templateId, d.link.employee, d.link.candidate, d.link.meeting, JSON.stringify(d.vars),d.link.grievance])).rows[0]; return { message: row };}
export function registerCommunicationsRoutes(app: express.Express, { standardAuth, mutationGuard, rateLimiter, providerConfigured = emailProviderConfigured, dispatch = enqueueMessage }: Dependencies) {
    const route = (method: 'get' | 'post' | 'put', path: string, handler: (req: express.Request, c: PoolClient, u: Actor) => Promise<Record<string, unknown>>) => {
        app[method]('/api/communications' + path, standardAuth, ...(method === 'get' ? [] : [mutationGuard, rateLimiter]), async (req, res) => { try {
            const data = await withTenant(req.authUser!.tenantId, c => handler(req, c, req.authUser!));
            res.json({ success: true, ...data });
        }
        catch (error) {
            const e = error as {
                statusCode?: number;
                code?: string;
                message?: string;
            };
            if (!e.statusCode)
                console.error('[Communications]', e.code || 'internal');
            res.status(e.statusCode || 500).json({ success: false, code: e.code && e.statusCode ? e.code : 'COMMUNICATIONS_ERROR', error: e.statusCode ? e.message : 'Communications service is unavailable.' });
        } });
    };
    route('get', '/status', async (_req, c, u) => { const keys = ['view', 'send', 'templates.manage', 'history.view', 'meetings.view', 'meetings.manage']; const capabilities: Record<string, boolean> = {}; for (const key of keys)
        capabilities[key] = await permitted(c, u, 'communications.' + key); return { capabilities, providerConfigured: providerConfigured(), variables: TEMPLATE_VARIABLES }; });
    route('get', '/recipients', async (req, c, u) => { if (!await permitted(c, u, 'communications.send') && !await permitted(c, u, 'communications.meetings.manage'))
        throw fail(403, 'PERMISSION_DENIED', 'Recipient lookup requires send or meeting management permission.'); const search = String(req.query.q || '').slice(0, 120); return { employees: (await c.query("SELECT id,full_name AS name,email FROM employees WHERE tenant_id=$1 AND is_active=true AND employment_status='active' AND (full_name ILIKE '%'||$2||'%' OR email ILIKE '%'||$2||'%') ORDER BY full_name LIMIT 30", [u.tenantId, search])).rows }; });
    route('get', '/templates', async (_req, c, u) => { const manage = await permitted(c, u, 'communications.templates.manage'); if (!manage && !await permitted(c, u, 'communications.view') && !await permitted(c, u, 'communications.send'))
        throw fail(403, 'PERMISSION_DENIED', 'Templates are unavailable.'); const rows = (await c.query<CommunicationTemplate>('SELECT * FROM communication_templates WHERE tenant_id=$1 AND ($2 OR active) ORDER BY updated_at DESC LIMIT 100', [u.tenantId, manage])).rows; const templates = []; for (const r of rows) {
        try {
            await categoryAccess(c, u, r.category);
            templates.push(r);
        }
        catch { }
    } return { templates }; });
    const saveTemplate = async (req: express.Request, c: PoolClient, u: Actor) => {
        await requirePermission(c, u, 'communications.templates.manage');
        const b = req.body || {}, name = text(b.name, 'Name', 120), subject = text(b.subject, 'Subject', 200), body = text(b.body, 'Body', 20000), kind = category(b.category);
        await categoryAccess(c, u, kind);
        const variables = [...new Set([...variablesIn(subject), ...variablesIn(body)])];
        const active = b.active !== false;
        let row;
        if (req.params.id) {
            const existing = (await c.query('SELECT category FROM communication_templates WHERE tenant_id=$1 AND id=$2', [u.tenantId, safeId(req.params.id)])).rows[0];
            if (!existing)
                throw fail(404, 'NOT_FOUND', 'Template not found.');
            await categoryAccess(c, u, existing.category);
            row = (await c.query('UPDATE communication_templates SET name=$3,subject=$4,body=$5,category=$6,active=$7,allowed_variables=$8,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *', [u.tenantId, safeId(req.params.id), name, subject, body, kind, active, variables])).rows[0];
            if (!row)
                throw fail(404, 'NOT_FOUND', 'Template not found.');
        }
        else
            row = (await c.query('INSERT INTO communication_templates(tenant_id,created_by,name,subject,body,category,active,allowed_variables) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [u.tenantId, u.employeeId, name, subject, body, kind, active, variables])).rows[0];
        await audit(c, u, !active ? 'template.deactivated' : req.params.id ? 'template.updated' : 'template.created', row.id, active ? 'active' : 'inactive');
        return { template: row };
    };
    route('post', '/templates', saveTemplate);
    route('put', '/templates/:id', saveTemplate);
    route('post', '/templates/:id/preview', async (req, c, u) => { if (!await permitted(c, u, 'communications.view') && !await permitted(c, u, 'communications.send') && !await permitted(c, u, 'communications.templates.manage'))
        throw fail(403, 'PERMISSION_DENIED', 'Communications are unavailable.'); const t = (await c.query<CommunicationTemplate>('SELECT * FROM communication_templates WHERE tenant_id=$1 AND id=$2', [u.tenantId, safeId(req.params.id)])).rows[0]; if (!t)
        throw fail(404, 'NOT_FOUND', 'Template not found.'); await categoryAccess(c, u, t.category); return { subject: renderTemplate(t.subject, req.body.variables || {}), body: renderTemplate(t.body, req.body.variables || {}) }; });
    route('post','/drafts',async(req,c,u)=>createCommunicationDraft(c,u,req.body||{}));
    route('put', '/drafts/:id', async (req, c, u) => { await requirePermission(c, u, 'communications.send'); const current = (await c.query('SELECT invitation_ics,related_grievance_id FROM communication_messages WHERE tenant_id=$1 AND id=$2 AND sender_id=$3', [u.tenantId, safeId(req.params.id), u.employeeId])).rows[0]; if (current?.invitation_ics)
        throw fail(409, 'INVITATION_LOCKED', 'Calendar invitations are snapshots. Edit the meeting and prepare a new invitation instead.'); if(current?.related_grievance_id){await caseAction(c,u,await caseAccess(c,u,current.related_grievance_id),'grievances.respond');if(req.body.related?.type!=='grievance'||req.body.related?.id!==current.related_grievance_id)throw fail(409,'CASE_LINK_LOCKED','A grievance draft must retain its case link.');} const d = await draftInput(c, u, req.body || {}); const row = (await c.query("UPDATE communication_messages SET subject=$4,body=$5,body_json=$6::jsonb,category=$7,recipient_ids=$8,template_id=$9,related_employee_id=$10,related_candidate_id=$11,related_meeting_id=$12,variables=$13::jsonb,related_grievance_id=$15,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND sender_id=$3 AND status='draft' AND version=$14 RETURNING *", [u.tenantId, safeId(req.params.id), u.employeeId, d.subject, d.body, JSON.stringify(d.bodyJson), d.kind, d.ids, d.templateId, d.link.employee, d.link.candidate, d.link.meeting, JSON.stringify(d.vars), req.body.version,d.link.grievance])).rows[0]; if (!row)
        throw fail(409, 'DRAFT_CONFLICT', 'Draft changed, was queued, or is unavailable. Reopen it.'); return { message: row }; });
    route('get', '/messages', async (req, c, u) => {
        if (!await permitted(c, u, 'communications.view') && !await permitted(c, u, 'communications.send') && !await permitted(c, u, 'communications.history.view'))
            throw fail(403, 'PERMISSION_DENIED', 'Messages are unavailable.');
        const company = req.query.scope === 'company' && await permitted(c, u, 'communications.history.view');
        const page = Math.max(1, Math.min(1000, Math.floor(Number(req.query.page)) || 1));
        const from = new Date(String(req.query.from || new Date(Date.now() - 90 * 86400000).toISOString()));
        const toValue = String(req.query.to || new Date(Date.now() + 86400000).toISOString());
        const to = new Date(toValue);
        // Date-only filters include the entire selected UTC day.
        if (/^\d{4}-\d{2}-\d{2}$/.test(toValue)) to.setUTCDate(to.getUTCDate() + 1);
        if (!Number.isFinite(+from) || !Number.isFinite(+to) || to < from || +to - +from > 366 * 86400000)
            throw fail(400, 'VALIDATION_ERROR', 'Choose a date range up to one year.');
        if ([req.query.related, req.query.employee, req.query.sender].some(value => value && !uuid(value)))
            throw fail(400, 'VALIDATION_ERROR', 'Invalid related record ID.');
        const params = [u.tenantId, u.employeeId, company, from.toISOString(), to.toISOString(), String(req.query.q || '').slice(0, 120), String(req.query.status || ''), String(req.query.category || ''), uuid(req.query.sender) ? req.query.sender : null, uuid(req.query.employee) ? req.query.employee : null, req.query.related || null, 20, (page - 1) * 20];
        const where = `m.tenant_id=$1 AND (m.related_grievance_id IS NULL OR EXISTS(SELECT 1 FROM grievances g WHERE g.tenant_id=m.tenant_id AND g.id=m.related_grievance_id AND ${handlerVisibilitySql()})) AND (m.sender_id=$2 OR ($3 AND m.status<>'draft' AND m.queued_at IS NOT NULL)) AND m.created_at >= $4 AND m.created_at < $5 AND ($6='' OR m.subject ILIKE '%'||$6||'%' OR array_to_string(m.recipients,',') ILIKE '%'||$6||'%') AND ($7='' OR m.status=$7) AND ($8='' OR m.category=$8) AND ($9::uuid IS NULL OR m.sender_id=$9) AND ($10::uuid IS NULL OR m.related_employee_id=$10 OR $10=ANY(m.recipient_ids)) AND ($11::uuid IS NULL OR m.related_employee_id=$11 OR m.related_candidate_id=$11 OR m.related_meeting_id=$11 OR m.related_grievance_id=$11)`;
        return { messages: (await c.query(`SELECT m.id,m.subject,m.category,m.status,m.recipients,m.recipient_ids,m.sender_id,e.full_name AS sender_name,m.template_id,m.related_employee_id,m.related_candidate_id,m.related_meeting_id,m.related_grievance_id,m.created_at,m.queued_at,m.sent_at,m.scheduled_at,m.failure_code FROM communication_messages m JOIN employees e ON e.tenant_id=m.tenant_id AND e.id=m.sender_id WHERE ${where} ORDER BY m.created_at DESC LIMIT $12 OFFSET $13`, params)).rows, total: Number((await c.query(`SELECT count(*) FROM communication_messages m WHERE ${where}`, params.slice(0, 11))).rows[0].count), page };
    });
    route('get', '/messages/:id', async (req, c, u) => { if (!await permitted(c, u, 'communications.view') && !await permitted(c, u, 'communications.send') && !await permitted(c, u, 'communications.history.view'))
        throw fail(403, 'PERMISSION_DENIED', 'Communications are unavailable.'); const company = await permitted(c, u, 'communications.history.view'); const row = (await c.query<CommunicationMessage>("SELECT * FROM communication_messages WHERE tenant_id=$1 AND id=$2 AND (sender_id=$3 OR ($4 AND status<>'draft' AND queued_at IS NOT NULL))", [u.tenantId, safeId(req.params.id), u.employeeId, company])).rows[0]; if (!row)
        throw fail(404, 'NOT_FOUND', 'Message not found.'); if(row.related_grievance_id){const access=await caseAccess(c,u,row.related_grievance_id);if(!access.handler)throw fail(404,'NOT_FOUND','Message not found.');} if (!company)
        delete row.provider_id; row.sender_name = (await c.query('SELECT full_name FROM employees WHERE tenant_id=$1 AND id=$2', [u.tenantId, row.sender_id])).rows[0]?.full_name; return { message: row, events: (await c.query('SELECT status,code,created_at FROM communication_message_events WHERE tenant_id=$1 AND message_id=$2 ORDER BY id', [u.tenantId, row.id])).rows }; });
    // Persist the immutable snapshot before dispatch; queued messages can safely retry dispatch after Redis interruption.
    app.post('/api/communications/messages/:id/send', standardAuth, mutationGuard, rateLimiter, async (req, res) => {
        try {
            const u = req.authUser!;
            if (!providerConfigured())
                throw fail(503, 'PROVIDER_NOT_CONFIGURED', 'Email sending is not configured. Your draft is retained.');
            const row = await withTenant(u.tenantId, async (c) => {
                await requirePermission(c, u, 'communications.send');
                const current = (await c.query<CommunicationMessage>('SELECT * FROM communication_messages WHERE tenant_id=$1 AND id=$2 AND sender_id=$3 FOR UPDATE', [u.tenantId, safeId(req.params.id), u.employeeId])).rows[0];
                if (!current)
                    throw fail(404, 'NOT_FOUND', 'Message not found.');
                if(current.related_grievance_id){const access=await caseAccess(c,u,current.related_grievance_id);await caseAction(c,u,access,'grievances.respond');if(current.recipient_ids.length!==1||current.recipient_ids[0]!==access.employee_id)throw fail(400,'INVALID_RECIPIENT','A grievance message may only be sent to its reporter.');}
                if (['queued', 'sending', 'sent'].includes(current.status))
                    return current;
                if (current.status !== 'draft')
                    throw fail(409, 'MESSAGE_LOCKED', 'This message cannot be sent again.');
                if(!current.related_grievance_id)await categoryAccess(c, u, current.category);
                if (current.template_id) {
                    const t = (await c.query('SELECT category FROM communication_templates WHERE tenant_id=$1 AND id=$2 AND active', [u.tenantId, current.template_id])).rows[0];
                    if (!t)
                        throw fail(400, 'INVALID_TEMPLATE', 'Template was deactivated.');
                    await categoryAccess(c, u, t.category);
                }
                if (current.invitation_ics) {
                    const m = (await c.query('SELECT version FROM communication_meetings WHERE tenant_id=$1 AND id=$2', [u.tenantId, current.related_meeting_id])).rows[0];
                    if (!m || !current.invitation_key.startsWith(`${current.related_meeting_id}-${m.version}-`))
                        throw fail(409, 'STALE_INVITATION', 'Meeting changed. Prepare a new invitation.');
                }
                const people = await employeeEmails(c, u, current.recipient_ids);
                let addresses = people.map(r => r.email);
                if (current.related_candidate_id) {
                    await requirePermission(c, u, 'hiring.view');
                    const candidate = (await c.query('SELECT email FROM hiring_applicants WHERE tenant_id=$1 AND id=$2', [u.tenantId, current.related_candidate_id])).rows[0];
                    if (candidate?.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate.email))
                        addresses.push(candidate.email);
                }
                addresses = [...new Set(addresses)];
                if (!addresses.length)
                    throw fail(400, 'INVALID_RECIPIENT', 'Choose at least one valid recipient.');
                const subject = text(renderTemplate(current.subject, current.variables), 'Subject', 200), body = text(renderTemplate(current.body, current.variables), 'Body', 20000);
                if (/[\r\n]/.test(subject))
                    throw fail(400, 'VALIDATION_ERROR', 'Subject cannot contain line breaks.');
                let scheduled: string | null = null;
                if (req.body.scheduledAt) {
                    const date = new Date(req.body.scheduledAt);
                    if (!Number.isFinite(+date) || +date < Date.now() || +date > Date.now() + 30 * 86400000)
                        throw fail(400, 'VALIDATION_ERROR', 'Schedule within the next 30 days.');
                    scheduled = date.toISOString();
                }
                const updated = (await c.query("UPDATE communication_messages SET subject=$3,body=$4,recipients=$5,status='queued',queued_at=now(),scheduled_at=$6,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *", [u.tenantId, current.id, subject, body, addresses, scheduled])).rows[0];
                await c.query("INSERT INTO communication_message_events(tenant_id,message_id,status) VALUES($1,$2,'queued')", [u.tenantId, current.id]);
                await audit(c, u, 'email.queued', current.id, 'queued');
                return updated;
            });
            if (row.status === 'queued') {
                try {
                    await dispatch(u.tenantId, row.id, row.scheduled_at);
                }
                catch {
                    throw fail(503, 'QUEUE_UNAVAILABLE', 'Message is saved as queued but dispatch is unavailable. Retry dispatch with the same message.');
                }
            }
            res.json({ success: true, message: row });
        }
        catch (error) {
            const e = error as {
                statusCode?: number;
                code?: string;
                message?: string;
            };
            res.status(e.statusCode || 500).json({ success: false, code: e.statusCode ? e.code : 'COMMUNICATIONS_ERROR', error: e.statusCode ? e.message : 'Unable to queue message.' });
        }
    });
    route('post', '/messages/:id/cancel', async (req, c, u) => { await requirePermission(c, u, 'communications.send'); const row = (await c.query(`UPDATE communication_messages SET status='cancelled',updated_at=now() WHERE tenant_id=$1 AND id=$2 AND sender_id=$3 AND status IN ('draft','queued') AND (related_grievance_id IS NULL OR EXISTS(SELECT 1 FROM grievances g WHERE g.tenant_id=communication_messages.tenant_id AND g.id=communication_messages.related_grievance_id AND ${handlerVisibilitySql('g','$3')})) RETURNING *`, [u.tenantId, safeId(req.params.id), u.employeeId])).rows[0]; if (!row)
        throw fail(409, 'MESSAGE_LOCKED', 'Only your draft or not-yet-sending message can be cancelled.'); await c.query("INSERT INTO communication_message_events(tenant_id,message_id,status) VALUES($1,$2,'cancelled')", [u.tenantId, row.id]); await audit(c, u, 'email.cancelled', row.id, 'cancelled'); return { message: row }; });
    registerMeetings(route);
}
type Route = (method: 'get' | 'post' | 'put', path: string, handler: (req: express.Request, c: PoolClient, u: Actor) => Promise<Record<string, unknown>>) => void;
function registerMeetings(route: Route) {
    const accessible = async (c: PoolClient, u: Actor, id: string) => { const manage = await permitted(c, u, 'communications.meetings.manage'); if (!manage)
        await requirePermission(c, u, 'communications.meetings.view'); const m = (await c.query<CommunicationMeeting>('SELECT * FROM communication_meetings m WHERE tenant_id=$1 AND id=$2 AND ($4 OR organizer_id=$3 OR EXISTS(SELECT 1 FROM communication_meeting_attendees a WHERE a.tenant_id=m.tenant_id AND a.meeting_id=m.id AND a.employee_id=$3))', [u.tenantId, id, u.employeeId, manage])).rows[0]; if (!m)
        throw fail(404, 'NOT_FOUND', 'Meeting not found.'); return m; };
    route('get', '/meetings', async (req, c, u) => { const manage = await permitted(c, u, 'communications.meetings.manage'); if (!manage)
        await requirePermission(c, u, 'communications.meetings.view'); const page = Math.max(1, Math.min(1000, Math.floor(Number(req.query.page)) || 1)); return { meetings: (await c.query("SELECT m.*,e.full_name AS organizer_name FROM communication_meetings m JOIN employees e ON e.tenant_id=m.tenant_id AND e.id=m.organizer_id WHERE m.tenant_id=$1 AND ($3 OR m.organizer_id=$2 OR EXISTS(SELECT 1 FROM communication_meeting_attendees a WHERE a.tenant_id=m.tenant_id AND a.meeting_id=m.id AND a.employee_id=$2)) AND m.starts_at>now()-interval '1 year' AND ($5::boolean=false OR (m.status='scheduled' AND m.starts_at>=now())) ORDER BY CASE WHEN $5 THEN m.starts_at END ASC,m.starts_at DESC LIMIT 20 OFFSET $4", [u.tenantId, u.employeeId, manage, (page - 1) * 20, req.query.upcoming === 'true'])).rows, page }; });
    route('get', '/meetings/:id', async (req, c, u) => { const m = await accessible(c, u, safeId(req.params.id)); const attendees = (await c.query('SELECT e.id,e.full_name AS name,e.email FROM communication_meeting_attendees a JOIN employees e ON e.id=a.employee_id AND e.tenant_id=a.tenant_id WHERE a.tenant_id=$1 AND a.meeting_id=$2', [u.tenantId, m.id])).rows; const organizer = (await c.query('SELECT email,full_name FROM employees WHERE tenant_id=$1 AND id=$2', [u.tenantId, m.organizer_id])).rows[0]; m.organizer_name = organizer.full_name; return { meeting: m, attendees, ics: calendarInvitation(m, organizer.email, attendees.map(a => a.email)) }; });
    const save = async (req: express.Request, c: PoolClient, u: Actor) => {
        await requirePermission(c, u, 'communications.meetings.manage');
        const b = req.body || {}, times = meetingTimes(b.startsAt, b.endsAt, b.timezone), title = text(b.title, 'Title', 200), notes = text(b.notes || '', 'Notes', 10000, false), location = text(b.location || '', 'Location', 500, false), ids = recipients(b.attendeeIds || []);
        await employeeEmails(c, u, ids);
        const link = await related(c, u, b.relatedEmployeeId ? { type: 'employee', id: b.relatedEmployeeId } : null);
        if (/^\w+:/.test(location) && !/^https:\/\//i.test(location))
            throw fail(400, 'VALIDATION_ERROR', 'Meeting links must use HTTPS.');
        let row;
        if (req.params.id) {
            row = (await c.query("UPDATE communication_meetings SET title=$3,notes=$4,starts_at=$5,ends_at=$6,timezone=$7,location=$8,related_employee_id=$9,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND status='scheduled' AND version=$10 RETURNING *", [u.tenantId, safeId(req.params.id), title, notes, times.startsAt, times.endsAt, times.timezone, location, link.employee, b.version])).rows[0];
            if (!row)
                throw fail(409, 'MEETING_CONFLICT', 'Meeting changed or is unavailable.');
            await c.query('DELETE FROM communication_meeting_attendees WHERE tenant_id=$1 AND meeting_id=$2', [u.tenantId, row.id]);
        }
        else
            row = (await c.query('INSERT INTO communication_meetings(tenant_id,organizer_id,title,notes,starts_at,ends_at,timezone,location,related_employee_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *', [u.tenantId, u.employeeId, title, notes, times.startsAt, times.endsAt, times.timezone, location, link.employee])).rows[0];
        for (const id of ids)
            await c.query('INSERT INTO communication_meeting_attendees(tenant_id,meeting_id,employee_id) VALUES($1,$2,$3)', [u.tenantId, row.id, id]);
        await audit(c, u, req.params.id ? 'meeting.updated' : 'meeting.created', row.id, row.status);
        for (const employeeId of ids)
            await c.query("INSERT INTO outbox_events(tenant_id,event_type,payload) VALUES($1,'notification.meeting_scheduled',$2::jsonb)", [u.tenantId, JSON.stringify({ meetingId: row.id, employeeId, notificationKey: 'system_alerts', idempotencyKey: `meeting-${row.id}-${row.version}-${employeeId}` })]);
        return { meeting: row };
    };
    route('post', '/meetings', save);
    route('put', '/meetings/:id', save);
    route('post', '/meetings/:id/status', async (req, c, u) => { await requirePermission(c, u, 'communications.meetings.manage'); if (!['completed', 'cancelled'].includes(req.body.status))
        throw fail(400, 'VALIDATION_ERROR', 'Invalid meeting status.'); const m = (await c.query("UPDATE communication_meetings SET status=$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND status='scheduled' RETURNING *", [u.tenantId, safeId(req.params.id), req.body.status])).rows[0]; if (!m)
        throw fail(409, 'MEETING_CONFLICT', 'Meeting is no longer scheduled.'); await audit(c, u, m.status === 'cancelled' ? 'meeting.cancelled' : 'meeting.updated', m.id, m.status); if (m.status === 'cancelled')
        for (const attendee of (await c.query('SELECT employee_id FROM communication_meeting_attendees WHERE tenant_id=$1 AND meeting_id=$2', [u.tenantId, m.id])).rows)
            await c.query("INSERT INTO outbox_events(tenant_id,event_type,payload) VALUES($1,'notification.meeting_cancelled',$2::jsonb)", [u.tenantId, JSON.stringify({ meetingId: m.id, employeeId: attendee.employee_id, notificationKey: 'system_alerts', idempotencyKey: `meeting-cancelled-${m.id}-${attendee.employee_id}` })]); return { meeting: m }; });
    // Creates one private invitation draft per meeting revision. Sending uses the same message queue endpoint.
    route('post', '/meetings/:id/invitation', async (req, c, u) => { await requirePermission(c, u, 'communications.meetings.manage'); await requirePermission(c, u, 'communications.send'); const m = await accessible(c, u, safeId(req.params.id)); const attendees = (await c.query('SELECT e.id,e.email FROM communication_meeting_attendees a JOIN employees e ON e.tenant_id=a.tenant_id AND e.id=a.employee_id WHERE a.tenant_id=$1 AND a.meeting_id=$2', [u.tenantId, m.id])).rows; const organizer = (await c.query('SELECT email FROM employees WHERE tenant_id=$1 AND id=$2', [u.tenantId, m.organizer_id])).rows[0]; const requestKey = req.body.requestKey ? safeId(req.body.requestKey) : 'initial'; const key = `${m.id}-${m.version}-${u.employeeId}-${requestKey}`; const row = (await c.query("INSERT INTO communication_messages(tenant_id,sender_id,subject,body,category,recipient_ids,related_meeting_id,invitation_ics,invitation_key) VALUES($1,$2,$3,$4,'meeting_invitation',$5,$6,$7,$8) ON CONFLICT(tenant_id,invitation_key) DO UPDATE SET invitation_key=EXCLUDED.invitation_key RETURNING *", [u.tenantId, u.employeeId, `${m.status === 'cancelled' ? 'Cancelled: ' : ''}${m.title}`, `${m.title}\n${new Date(m.starts_at).toISOString()} — ${new Date(m.ends_at).toISOString()}\nTimezone: ${m.timezone}\n${m.location}\n${m.notes}`, attendees.map(a => a.id), m.id, calendarInvitation(m, organizer.email, attendees.map(a => a.email)), key])).rows[0]; return { message: row }; });
}
