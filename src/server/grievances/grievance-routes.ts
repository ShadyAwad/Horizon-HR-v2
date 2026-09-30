import type express from 'express';
import multer from 'multer';
import { createCommunicationDraft } from '../communications/communications-routes';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import path from 'node:path';
import type { PoolClient } from 'pg';
import { withTenant } from '../../lib/hr-background';
import { CASE_PRIORITIES, CASE_STATUSES, caseFail, CaseError, caseId, caseText, caseVersion, caseTransition, casePage, caseObject, type CaseStatus } from '../../lib/grievance-contract';
import { resolveScopedPermission } from '../organisation/scoped-permissions';
import { recordAuditEvent } from '../audit/audit-events';
import { PrivateExtractionStorage } from '../document-extraction/extraction-storage';
import { detectImageMime } from '../document-extraction/extraction-validation';
import { activeCaseActor, caseAccess, caseAction, casePermissionSql, handlerVisibilitySql, publicCase, type CaseActor, type CaseRow } from './grievance-policy';
type Dependencies = {
    standardAuth: express.RequestHandler;
    mutationGuard: express.RequestHandler;
    rateLimiter: express.RequestHandler;
};
const storage = new PrivateExtractionStorage(path.resolve(process.env.GRIEVANCE_ATTACHMENT_DIRECTORY || 'uploads/private-grievances'), Infinity);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 1 } }).single('file');
const identity = (req: express.Request): CaseActor => ({ tenantId: req.authUser!.tenantId, employeeId: req.authUser!.employeeId });
async function ownPermission(c: PoolClient, u: CaseActor, key: string) { if (!(await resolveScopedPermission(c, { tenantId: u.tenantId, actorEmployeeId: u.employeeId, permissionKey: key, targetEmployeeId: u.employeeId })).allowed)
    throw caseFail(403, 'PERMISSION_DENIED', 'Permission required.'); }
async function event(c: PoolClient, u: CaseActor, row: CaseRow, kind: string, visibility = 'internal', metadata: Record<string, unknown> = {}) {
    await c.query('INSERT INTO grievance_case_events(tenant_id,case_id,actor_id,kind,visibility,metadata) VALUES($1,$2,$3,$4,$5,$6::jsonb)', [u.tenantId, row.id, u.employeeId, kind, visibility, JSON.stringify(metadata)]);
    await recordAuditEvent(c, { tenantId: u.tenantId, actorId: u.employeeId, action: `grievance.${kind}`, targetType: 'grievance', targetId: row.id, metadata });
}
async function notify(c: PoolClient, u: CaseActor, row: CaseRow, type: string, recipients: string[]) {
    for (const employeeId of [...new Set(recipients)]) {
        const payload = { employeeId, notificationKey: 'grievance_updates', workspace: 'grievances', caseId: row.id, idempotencyKey: `grievance-${row.id}-${row.version}-${type}-${employeeId}`, deepLink: { section: 'grievances', caseId: row.id } };
        await c.query('INSERT INTO outbox_events(tenant_id,event_type,payload) SELECT $1::uuid,$2::varchar,$3::jsonb WHERE NOT EXISTS(SELECT 1 FROM outbox_events WHERE tenant_id=$1 AND event_type=$2 AND payload->>\'idempotencyKey\'=$4)', [u.tenantId, `notification.grievance_${type}`, JSON.stringify(payload), payload.idempotencyKey]);
    }
}
async function eligibleHandlers(c: PoolClient, u: CaseActor, row: CaseRow) { return (await c.query(`SELECT e.id,e.full_name FROM employees e CROSS JOIN grievances g WHERE e.tenant_id=$1 AND e.is_active AND e.employment_status='active' AND g.tenant_id=e.tenant_id AND g.id=$2 AND ${handlerVisibilitySql('g', 'e.id')} ORDER BY e.full_name,e.id LIMIT 200`, [u.tenantId, row.id])).rows; }
async function bump(c: PoolClient, u: CaseActor, id: string) { return (await c.query('UPDATE grievances SET version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *', [u.tenantId, id])).rows[0]; }
function expected(row: CaseRow, value: unknown) { if (row.version !== caseVersion(value))
    throw caseFail(409, 'CASE_CONFLICT', 'This case changed. Reload and retry.'); }
async function destination(c: PoolClient, u: CaseActor, value: unknown) { const id = caseId(value); if (!(await c.query('SELECT 1 FROM organisation_departments WHERE tenant_id=$1 AND id=$2 AND is_active AND grievance_enabled', [u.tenantId, id])).rowCount)
    throw caseFail(400, 'INVALID_DESTINATION', 'Choose an enabled department in this company.'); return id; }
export function registerGrievanceRoutes(app: express.Express, d: Dependencies) {
    const route = (method: 'get' | 'post' | 'patch', url: string, fn: (c: PoolClient, u: CaseActor, req: express.Request) => Promise<unknown>) => {
        app[method](url, d.standardAuth, ...(method === 'get' ? [] : [d.mutationGuard, d.rateLimiter]), async (req, res) => { try {
            const result = await withTenant(identity(req).tenantId, async (c) => { await activeCaseActor(c, identity(req)); return fn(c, identity(req), req); });
            res.status(method === 'post' && url === '/api/grievances' ? 201 : 200).json({ success: true, ...result as object });
        }
        catch (error) {
            if (error instanceof CaseError)
                return res.status(error.statusCode).json({ success: false, code: error.code, error: error.message });
            const known = error as { statusCode?: number; code?: string; message?: string };
            if (known.statusCode && known.statusCode >= 400 && known.statusCode < 500 && known.code) return res.status(known.statusCode).json({ success: false, code: known.code, error: known.message });
            console.error('[Grievances] request failed:', (error as {
                code?: string;
            }).code || 'internal');
            res.status(500).json({ success: false, error: 'Unable to process grievance request.' });
        } });
    };
    route('get', '/api/grievances/options', async (c, u) => {
        const configure = (await resolveScopedPermission(c, { tenantId: u.tenantId, actorEmployeeId: u.employeeId, permissionKey: 'grievances.configure' })).allowed;
        const departments = (await c.query(`SELECT id,name,grievance_enabled FROM organisation_departments WHERE tenant_id=$1 AND is_active AND ($2 OR grievance_enabled) ORDER BY name LIMIT 200`, [u.tenantId, configure])).rows;
        return { departments, configure };
    });
    route('patch', '/api/grievances/departments/:id', async (c, u, req) => {
        if (!(await resolveScopedPermission(c, { tenantId: u.tenantId, actorEmployeeId: u.employeeId, permissionKey: 'grievances.configure' })).allowed)
            throw caseFail(403, 'PERMISSION_DENIED', 'Company configuration authority is required.');
        const b = caseObject(req.body, ['enabled']);
        if (typeof b.enabled !== 'boolean')
            throw caseFail(400, 'INVALID_SETTING', 'Specify whether this department receives grievances.');
        const id = caseId(req.params.id);
        const row = (await c.query('UPDATE organisation_departments SET grievance_enabled=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND is_active RETURNING id,name,grievance_enabled', [u.tenantId, id, b.enabled])).rows[0];
        if (!row)
            throw caseFail(404, 'DEPARTMENT_UNAVAILABLE', 'Department unavailable.');
        await recordAuditEvent(c, { tenantId: u.tenantId, actorId: u.employeeId, action: 'grievance.department_configured', targetType: 'department', targetId: id, metadata: { enabled: b.enabled } });
        return { department: row };
    });
    route('post', '/api/grievances', async (c, u, req) => {
        await ownPermission(c, u, 'grievances.create');
        const b = caseObject(req.body, ['title', 'subject', 'description', 'category', 'priority', 'destinationDepartmentId', 'confidentiality']);
        const title = caseText(b.subject ?? b.title, 200), description = caseText(b.description, 20000), category = caseText(b.category ?? 'general', 80), priority = b.priority ?? 'normal', confidentiality = b.confidentiality ?? 'standard';
        if (!(CASE_PRIORITIES as readonly unknown[]).includes(priority) || !['standard', 'confidential'].includes(String(confidentiality)))
            throw caseFail(400, 'INVALID_CASE', 'Invalid priority or confidentiality.');
        let department: string | null = null;
        if (b.destinationDepartmentId)
            department = await destination(c, u, b.destinationDepartmentId);
        else if ((await c.query('SELECT 1 FROM organisation_departments WHERE tenant_id=$1 AND is_active AND grievance_enabled LIMIT 1', [u.tenantId])).rowCount)
            throw caseFail(400, 'DESTINATION_REQUIRED', 'Select a destination department.');
        const n = (await c.query('INSERT INTO grievance_case_counters(tenant_id,last_number) VALUES($1,1) ON CONFLICT(tenant_id) DO UPDATE SET last_number=grievance_case_counters.last_number+1 RETURNING last_number', [u.tenantId])).rows[0].last_number;
        const number = `GRV-${new Date().getUTCFullYear()}-${String(n).padStart(6, '0')}`;
        const row = (await c.query("INSERT INTO grievances(tenant_id,employee_id,title,description,category,priority,status,case_number,destination_department_id,assigned_department_id,confidentiality) VALUES($1,$2,$3,$4,$5,$6,'submitted',$7,$8,$8,$9) RETURNING *", [u.tenantId, u.employeeId, title, description, category, priority, number, department, confidentiality])).rows[0];
        await event(c, u, row, 'submitted', 'employee');
        await notify(c, u, row, 'submitted', (await eligibleHandlers(c, u, row)).map(e => e.id));
        return { grievanceId: row.id, grievance: publicCase(row) };
    });
    const list = (own: boolean) => async (c: PoolClient, u: CaseActor, req: express.Request) => {
        if (own) {
            const allowed = (await resolveScopedPermission(c, { tenantId: u.tenantId, actorEmployeeId: u.employeeId, permissionKey: 'grievances.view_own', targetEmployeeId: u.employeeId })).allowed;
            if (!allowed)
                await ownPermission(c, u, 'grievances.create');
        }
        else if (!(await c.query("SELECT 1 FROM employee_role_assignments a JOIN tenant_role_permissions p ON p.tenant_id=a.tenant_id AND p.role_id=a.role_id WHERE a.tenant_id=$1 AND a.employee_id=$2 AND p.permission_key IN ('grievances.view','grievances.review') AND a.revoked_at IS NULL AND a.assigned_at<=now() AND (a.expires_at IS NULL OR a.expires_at>now()) UNION ALL SELECT 1 FROM permission_delegations WHERE tenant_id=$1 AND granted_to_employee_id=$2 AND permission_key IN ('grievances.view','grievances.review') AND status='active' AND revoked_at IS NULL AND starts_at<=now() AND expires_at>now() LIMIT 1", [u.tenantId, u.employeeId])).rowCount)
            throw caseFail(403, 'INBOX_DENIED', 'Grievance inbox permission required.');
        const page = casePage(req.query.page), q = caseText(req.query.q ?? '', 120, false), status = String(req.query.status || ''), priority = String(req.query.priority || ''), category = caseText(req.query.category ?? '', 80, false), department = req.query.department ? caseId(req.query.department) : null, assignee = req.query.assignee ? caseId(req.query.assignee) : null, view = String(req.query.view || 'all');
        if (status && !(CASE_STATUSES as readonly string[]).includes(status) || priority && !(CASE_PRIORITIES as readonly string[]).includes(priority) || !['all', 'mine', 'unassigned'].includes(view))
            throw caseFail(400, 'INVALID_FILTER', 'Invalid filter.');
        const from = req.query.from ? String(req.query.from) : null, to = req.query.to ? String(req.query.to) : null;
        for (const v of [from, to])
            if (v && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v))))
                throw caseFail(400, 'INVALID_DATE', 'Invalid date.');
        const params = [u.tenantId, u.employeeId, q, status, priority, department, assignee, category, view, from, to];
        const where = `g.tenant_id=$1 AND ${own ? 'g.employee_id=$2' : `(${handlerVisibilitySql()})`} AND ($3='' OR g.case_number ILIKE '%'||$3||'%' OR g.title ILIKE '%'||$3||'%' OR e.full_name ILIKE '%'||$3||'%') AND ($4='' OR g.status=$4) AND ($5='' OR g.priority=$5) AND ($6::uuid IS NULL OR COALESCE(g.assigned_department_id,g.destination_department_id)=$6) AND ($7::uuid IS NULL OR g.assigned_to=$7) AND ($8='' OR g.category=$8) AND ($9='all' OR ($9='mine' AND g.assigned_to=$2) OR ($9='unassigned' AND g.assigned_to IS NULL)) AND ($10::date IS NULL OR g.created_at>=$10::date) AND ($11::date IS NULL OR g.created_at<$11::date+interval '1 day')`;
        const base = `FROM grievances g JOIN employees e ON e.tenant_id=g.tenant_id AND e.id=g.employee_id`;
        const rows = (await c.query(`SELECT g.*,e.full_name AS reporter_name,department.name AS department_name,assignee.full_name AS assigned_to_name ${base} LEFT JOIN organisation_departments department ON department.tenant_id=g.tenant_id AND department.id=COALESCE(g.assigned_department_id,g.destination_department_id) LEFT JOIN employees assignee ON assignee.tenant_id=g.tenant_id AND assignee.id=g.assigned_to WHERE ${where} ORDER BY g.updated_at DESC,g.id LIMIT 20 OFFSET $12`, [...params, (page - 1) * 20])).rows;
        const counts = (await c.query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE g.assigned_to IS NULL AND g.status NOT IN ('resolved','closed'))::int AS unassigned,count(*) FILTER(WHERE g.priority IN ('high','urgent') AND g.status NOT IN ('resolved','closed'))::int AS high,count(*) FILTER(WHERE g.status='waiting')::int AS waiting,count(*) FILTER(WHERE g.assigned_to=$2 AND g.status NOT IN ('resolved','closed'))::int AS mine ${base} WHERE ${where}`, params)).rows[0];
        return { grievances: rows.map(r => publicCase(r, !own)), page, pageSize: 20, total: counts.total, summary: counts };
    };
    route('get', '/api/grievances/me', list(true));
    route('get', '/api/grievances', list(false));
    route('get', '/api/grievances/:id', async (c, u, req) => {
        const row = await caseAccess(c, u, caseId(req.params.id));
        const page = casePage(req.query.page), offset = (page - 1) * 40;
        const events = (await c.query("SELECT ev.id,ev.actor_id,actor.full_name AS actor_name,ev.kind,ev.visibility,ev.metadata,ev.created_at FROM grievance_case_events ev LEFT JOIN employees actor ON actor.tenant_id=ev.tenant_id AND actor.id=ev.actor_id WHERE ev.tenant_id=$1 AND ev.case_id=$2 AND ($3 OR ev.visibility='employee') ORDER BY ev.created_at,ev.id LIMIT 41 OFFSET $4", [u.tenantId, row.id, row.handler, offset])).rows;
        const messages = (await c.query("SELECT m.id,m.actor_id,e.full_name AS actor_name,m.kind,m.body,m.created_at FROM grievance_messages m JOIN employees e ON e.tenant_id=m.tenant_id AND e.id=m.actor_id WHERE m.tenant_id=$1 AND m.case_id=$2 AND ($3 OR m.kind<>'internal') ORDER BY m.created_at,m.id LIMIT 41 OFFSET $4", [u.tenantId, row.id, row.handler, offset])).rows;
        const attachments = (await c.query('SELECT id,filename,mime_type,size_bytes,created_at FROM grievance_attachments WHERE tenant_id=$1 AND case_id=$2 ORDER BY created_at,id LIMIT 20', [u.tenantId, row.id])).rows;
        const capabilities: Record<string, boolean> = {};
        for (const key of ['triage', 'assign', 'respond', 'internal_notes', 'resolve', 'close', 'confidential'])
            capabilities[key] = Boolean(row.handler && (await c.query(`SELECT 1 FROM grievances g WHERE g.tenant_id=$1 AND g.id=$3 AND ${casePermissionSql(['grievances.' + key])}`, [u.tenantId, u.employeeId, row.id])).rowCount);
        const names = (await c.query('SELECT e.full_name AS reporter_name,d.name AS department_name,dest.name AS destination_name,a.full_name AS assigned_to_name FROM grievances g JOIN employees e ON e.tenant_id=g.tenant_id AND e.id=g.employee_id LEFT JOIN organisation_departments d ON d.tenant_id=g.tenant_id AND d.id=COALESCE(g.assigned_department_id,g.destination_department_id) LEFT JOIN organisation_departments dest ON dest.tenant_id=g.tenant_id AND dest.id=g.destination_department_id LEFT JOIN employees a ON a.tenant_id=g.tenant_id AND a.id=g.assigned_to WHERE g.tenant_id=$1 AND g.id=$2', [u.tenantId, row.id])).rows[0];
        return { grievance: publicCase({ ...row, ...names }, row.handler), owner: row.owner, handler: row.handler, capabilities, events: events.slice(0, 40), messages: messages.slice(0, 40), attachments, page, hasMore: events.length > 40 || messages.length > 40, assignees: capabilities.assign ? await eligibleHandlers(c, u, row) : [] };
    });
    route('get', '/api/grievances/:id/assignees', async (c, u, req) => { const row = await caseAccess(c, u, caseId(req.params.id)); await caseAction(c, u, row, 'grievances.assign'); const department = req.query.department ? await destination(c, u, req.query.department) : row.assigned_department_id; const allowed = (await c.query(`SELECT 1 FROM grievances g WHERE g.tenant_id=$1 AND g.id=$3 AND ${casePermissionSql(['grievances.assign']).replaceAll('COALESCE(g.assigned_department_id,g.destination_department_id)', '$4::uuid')}`, [u.tenantId, u.employeeId, row.id, department])).rowCount; if (!allowed)
        throw caseFail(403, 'TARGET_SCOPE_DENIED', 'Destination is outside your assignment scope.'); const assignees = (await c.query(`SELECT e.id,e.full_name FROM employees e CROSS JOIN (SELECT g.*,$3::uuid AS target_department FROM grievances g WHERE tenant_id=$1 AND id=$2) g WHERE e.tenant_id=$1 AND e.is_active AND e.employment_status='active' AND ${handlerVisibilitySql('g', 'e.id').replaceAll('COALESCE(g.assigned_department_id,g.destination_department_id)', 'g.target_department')} ORDER BY e.full_name,e.id LIMIT 200`, [u.tenantId, row.id, department])).rows; return { assignees }; });
    route('patch', '/api/grievances/:id/assignment', async (c, u, req) => {
        const b = caseObject(req.body, ['version', 'employeeId', 'departmentId']), row = await caseAccess(c, u, caseId(req.params.id), true);
        await caseAction(c, u, row, 'grievances.assign');
        expected(row, b.version);
        if (row.status === 'closed')
            throw caseFail(409, 'CASE_CLOSED', 'Closed cases cannot be assigned.');
        const department = b.departmentId ? await destination(c, u, b.departmentId) : row.assigned_department_id;
        // Authority is required in both the source and target department; assignment cannot escape scope.
        if (department !== row.assigned_department_id) {
            const allowed = (await c.query(`SELECT 1 FROM grievances g WHERE g.tenant_id=$1 AND g.id=$3 AND ${casePermissionSql(['grievances.assign']).replaceAll('COALESCE(g.assigned_department_id,g.destination_department_id)', '$4::uuid')}`, [u.tenantId, u.employeeId, row.id, department])).rowCount;
            if (!allowed)
                throw caseFail(403, 'TARGET_SCOPE_DENIED', 'Assignment authority is required in the destination department.');
        }
        const employee = b.employeeId === null ? null : b.employeeId === undefined ? row.assigned_to : caseId(b.employeeId);
        if (employee) {
            const candidate = (await c.query(`SELECT 1 FROM employees e CROSS JOIN (SELECT g.*, $4::uuid AS target_department FROM grievances g WHERE tenant_id=$1 AND id=$3) g WHERE e.tenant_id=$1 AND e.id=$2 AND e.is_active AND e.employment_status='active' AND ${handlerVisibilitySql('g', 'e.id').replaceAll('COALESCE(g.assigned_department_id,g.destination_department_id)', 'g.target_department')}`, [u.tenantId, employee, row.id, department])).rowCount;
            if (!candidate)
                throw caseFail(400, 'INVALID_ASSIGNEE', 'Choose an active authorized handler in this company.');
        }
        await c.query('UPDATE grievances SET assigned_to=$3,assigned_department_id=$4 WHERE tenant_id=$1 AND id=$2', [u.tenantId, row.id, employee, department]);
        const updated = await bump(c, u, row.id);
        if (department !== row.assigned_department_id)
            await event(c, u, updated, 'department_changed', 'internal', { previousDepartment: row.assigned_department_id, department });
        await event(c, u, updated, row.assigned_to ? 'reassigned' : 'assigned', 'internal', { previousAssignee: row.assigned_to, assignee: employee, previousDepartment: row.assigned_department_id, department });
        await notify(c, u, updated, 'assigned', employee ? [employee] : []);
        return { grievance: publicCase(updated, true) };
    });
    route('patch', '/api/grievances/:id/status', async (c, u, req) => {
        const b = caseObject(req.body, ['version', 'status', 'resolutionSummary', 'response']);
        if (!(CASE_STATUSES as readonly unknown[]).includes(b.status))
            throw caseFail(400, 'INVALID_STATUS', 'Invalid case status.');
        const row = await caseAccess(c, u, caseId(req.params.id), true);
        const next = caseTransition(row.status as CaseStatus, b.status);
        await caseAction(c, u, row, next === 'resolved' ? 'grievances.resolve' : next === 'closed' ? 'grievances.close' : 'grievances.triage');
        expected(row, b.version);
        if (next === 'assigned' && !row.assigned_to)
            throw caseFail(409, 'ASSIGNEE_REQUIRED', 'Assign an authorized handler before marking assigned.');
        const summary = next === 'resolved' ? caseText(b.resolutionSummary, 10000) : null;
        if (summary)
            await c.query("INSERT INTO grievance_messages(tenant_id,case_id,actor_id,kind,body) VALUES($1,$2,$3,'resolution',$4)", [u.tenantId, row.id, u.employeeId, summary]);
        if (b.response) {
            await caseAction(c, u, row, 'grievances.respond');
            await c.query("INSERT INTO grievance_messages(tenant_id,case_id,actor_id,kind,body) VALUES($1,$2,$3,'response',$4)", [u.tenantId, row.id, u.employeeId, caseText(b.response, 20000)]);
        }
        await c.query("UPDATE grievances SET status=$3::varchar,resolved_at=CASE WHEN $3='resolved' THEN now() ELSE resolved_at END,resolved_by=CASE WHEN $3='resolved' THEN $4 ELSE resolved_by END,resolution_summary=COALESCE($5,resolution_summary),closed_at=CASE WHEN $3='closed' THEN now() ELSE closed_at END WHERE tenant_id=$1 AND id=$2", [u.tenantId, row.id, next, u.employeeId, summary]);
        const updated = await bump(c, u, row.id);
        const kind = next === 'resolved' ? 'resolved' : next === 'closed' ? 'closed' : row.status === 'resolved' ? 'reopened' : next === 'triaged' ? 'triaged' : 'status_changed';
        await event(c, u, updated, kind, 'employee', { previousStatus: row.status, newStatus: next });
        await notify(c, u, updated, kind, [row.employee_id, ...(row.assigned_to ? [row.assigned_to] : [])]);
        return { grievance: publicCase(updated, true) };
    });
    route('post', '/api/grievances/:id/email-draft', async (c, u, req) => { const b = caseObject(req.body, ['messageId']), row = await caseAccess(c, u, caseId(req.params.id), true); await caseAction(c, u, row, 'grievances.respond'); await ownPermission(c, u, 'communications.send'); const message = (await c.query("SELECT body FROM grievance_messages WHERE tenant_id=$1 AND case_id=$2 AND id=$3 AND kind IN ('response','resolution')", [u.tenantId, row.id, caseId(b.messageId)])).rows[0]; if (!message)
        throw caseFail(404, 'MESSAGE_UNAVAILABLE', 'Employee-visible response unavailable.'); const existing = (await c.query("SELECT id FROM communication_messages WHERE tenant_id=$1 AND sender_id=$2 AND related_grievance_id=$3 AND body=$4 AND status='draft' ORDER BY created_at DESC LIMIT 1", [u.tenantId, u.employeeId, row.id, message.body])).rows[0]; if (existing)
        return { draftId: existing.id }; const draft = await createCommunicationDraft(c, u, { subject: row.case_number + ' · ' + row.title, body: message.body, category: 'grievance_update', recipientIds: [row.employee_id], related: { type: 'grievance', id: row.id } }); return { draftId: draft.message.id }; });
    route('patch', '/api/grievances/:id/settings', async (c, u, req) => {
        const b = caseObject(req.body, ['version', 'priority', 'confidentiality']), row = await caseAccess(c, u, caseId(req.params.id), true);
        expected(row, b.version);
        if (row.status === 'closed')
            throw caseFail(409, 'CASE_CLOSED', 'Closed cases cannot be edited.');
        await caseAction(c, u, row, 'grievances.triage');
        if (b.priority !== undefined && !(CASE_PRIORITIES as readonly unknown[]).includes(b.priority))
            throw caseFail(400, 'INVALID_PRIORITY', 'Invalid priority.');
        if (b.confidentiality !== undefined) {
            if (!['standard', 'confidential'].includes(String(b.confidentiality)))
                throw caseFail(400, 'INVALID_CONFIDENTIALITY', 'Invalid confidentiality.');
            await caseAction(c, u, row, 'grievances.confidential');
        }
        // Confidentiality escalation cannot leave an unauthorized assignee with access.
        if (b.confidentiality === 'confidential' && row.assigned_to) {
            const permitted = (await c.query(`SELECT 1 FROM grievances g WHERE tenant_id=$1 AND id=$3 AND ${casePermissionSql(['grievances.confidential'], 'g', '$2')}`, [u.tenantId, row.assigned_to, row.id])).rowCount;
            if (!permitted)
                throw caseFail(409, 'REASSIGN_REQUIRED', 'Reassign to a confidential handler before changing confidentiality.');
        }
        await c.query('UPDATE grievances SET priority=COALESCE($3,priority),confidentiality=COALESCE($4,confidentiality) WHERE tenant_id=$1 AND id=$2', [u.tenantId, row.id, b.priority ?? null, b.confidentiality ?? null]);
        const updated = await bump(c, u, row.id);
        if (b.priority !== undefined)
            await event(c, u, updated, 'priority_changed', 'internal', { previousPriority: row.priority, priority: b.priority });
        if (b.confidentiality !== undefined)
            await event(c, u, updated, 'confidentiality_changed', 'internal', { confidentiality: b.confidentiality });
        return { grievance: publicCase(updated, true) };
    });
    route('post', '/api/grievances/:id/messages', async (c, u, req) => {
        const b = caseObject(req.body, ['version', 'kind', 'body']), row = await caseAccess(c, u, caseId(req.params.id), true);
        expected(row, b.version);
        if (row.status === 'closed')
            throw caseFail(409, 'CASE_CLOSED', 'Closed cases do not accept replies.');
        const kind = b.kind;
        if (row.owner) {
            if (kind !== 'follow_up')
                throw caseFail(403, 'HANDLER_ONLY', 'Reporters may only add employee-visible follow-ups.');
        }
        else {
            if (kind !== 'response' && kind !== 'internal')
                throw caseFail(400, 'INVALID_MESSAGE', 'Choose a response or internal note.');
            await caseAction(c, u, row, kind === 'internal' ? 'grievances.internal_notes' : 'grievances.respond');
        }
        const body = caseText(b.body, 20000);
        const message = (await c.query('INSERT INTO grievance_messages(tenant_id,case_id,actor_id,kind,body) VALUES($1,$2,$3,$4,$5) RETURNING id', [u.tenantId, row.id, u.employeeId, kind, body])).rows[0];
        const updated = await bump(c, u, row.id);
        await event(c, u, updated, kind === 'internal' ? 'internal_note_added' : kind === 'follow_up' ? 'employee_follow_up' : 'employee_response', kind === 'internal' ? 'internal' : 'employee', { messageId: message.id });
        if (kind !== 'internal')
            await notify(c, u, updated, String(kind), kind === 'follow_up' ? (await eligibleHandlers(c, u, row)).map(e => e.id) : [row.employee_id]);
        return { messageId: message.id };
    });
    app.post('/api/grievances/:id/attachments', d.standardAuth, d.mutationGuard, d.rateLimiter, (req, res) => upload(req, res, async (error) => {
        if (error)
            return res.status(413).json({ success: false, error: 'One attachment up to 10 MB is allowed.' });
        let key: string | undefined;
        try {
            const result = await withTenant(identity(req).tenantId, async (c) => {
                const u = identity(req);
                await activeCaseActor(c, u);
                const row = await caseAccess(c, u, caseId(req.params.id), true);
                expected(row, Number(req.body.version));
                if (row.status === 'closed')
                    throw caseFail(409, 'CASE_CLOSED', 'Closed cases do not accept attachments.');
                if (!row.owner)
                    await caseAction(c, u, row, 'grievances.respond');
                if (Number((await c.query('SELECT count(*) FROM grievance_attachments WHERE tenant_id=$1 AND case_id=$2', [u.tenantId, row.id])).rows[0].count) >= 20)
                    throw caseFail(409, 'ATTACHMENT_LIMIT', 'A case supports up to 20 attachments.');
                const file = req.file as {
                    buffer: Buffer;
                    mimetype: string;
                    originalname: string;
                } | undefined;
                if (!file?.buffer.length)
                    throw caseFail(400, 'FILE_REQUIRED', 'Choose an attachment.');
                const detected = detectImageMime(file.buffer);
                let mime: string, buffer: Buffer;
                if (detected) {
                    if (detected !== file.mimetype)
                        throw caseFail(415, 'INVALID_FILE', 'File content and type do not match.');
                    buffer = await sharp(file.buffer, { limitInputPixels: 40000000 }).rotate().toBuffer();
                    mime = detected;
                }
                else if (file.mimetype === 'application/pdf' && file.buffer.subarray(0, 5).toString() === '%PDF-' && file.buffer.subarray(-2048).toString().includes('%%EOF')) {
                    await PDFDocument.load(file.buffer, { ignoreEncryption: false });
                    buffer = file.buffer;
                    mime = 'application/pdf';
                }
                else
                    throw caseFail(415, 'INVALID_FILE', 'Select a valid JPEG, PNG, WebP or PDF file.');
                if (buffer.length > 10485760)
                    throw caseFail(413, 'FILE_TOO_LARGE', 'Attachment exceeds 10 MB.');
                key = await storage.write(buffer);
                const name = path.basename(file.originalname).replace(/[\r\n\u0000-\u001f]/g, '').slice(0, 180) || 'Attachment';
                const attachment = (await c.query('INSERT INTO grievance_attachments(tenant_id,case_id,actor_id,filename,mime_type,size_bytes,storage_key) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,filename,mime_type,size_bytes', [u.tenantId, row.id, u.employeeId, name, mime, buffer.length, key])).rows[0];
                const updated = await bump(c, u, row.id);
                await event(c, u, updated, 'attachment_added', 'employee', { attachmentId: attachment.id });
                return { attachment };
            });
            res.json({ success: true, ...result });
        }
        catch (error) {
            await storage.remove(key);
            res.status(error instanceof CaseError ? error.statusCode : 400).json({ success: false, error: error instanceof CaseError ? error.message : 'Unable to store this attachment.' });
        }
    }));
    app.get('/api/grievances/:id/attachments/:attachmentId', d.standardAuth, async (req, res) => { try {
        const contents = await withTenant(identity(req).tenantId, async (c) => { const u = identity(req); await activeCaseActor(c, u); await caseAccess(c, u, caseId(req.params.id)); const file = (await c.query('SELECT filename,mime_type,storage_key FROM grievance_attachments WHERE tenant_id=$1 AND case_id=$2 AND id=$3', [u.tenantId, req.params.id, caseId(req.params.attachmentId)])).rows[0]; if (!file)
            throw caseFail(404, 'FILE_UNAVAILABLE', 'Attachment unavailable.'); return { file, buffer: await storage.read(file.storage_key) }; });
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
        res.attachment(contents.file.filename).type(contents.file.mime_type).send(contents.buffer);
    }
    catch (error) {
        res.status(error instanceof CaseError ? error.statusCode : 404).json({ success: false, error: 'Attachment unavailable.' });
    } });
}
