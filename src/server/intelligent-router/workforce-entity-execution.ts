import type { PoolClient } from 'pg';
import { normalizeQuery } from '../../lib/router-normalization';
import { entityTokens, findEntitySpan, generalizeEntities, safeEntityTemplate, type EntityType, type EntityResolution, type EntityRoute, type EntityChoices, type EntityParameters } from '../../lib/router-entities';
import { resolveScopedPermission } from '../organisation/scoped-permissions';
import { supportAuthority, listSupportTickets } from '../support/support-routes';
import { hiringAllowed } from '../hiring/ats-routes';
type Actor = {
    tenantId: string;
    employeeId: string;
};
const ignored = new Set(normalizeQuery("what laptop is using equipment does have who has assigned report as damaged broken show open unresolved it support tickets requests my me the a an s for of to in from at jobs applicants candidates application offer screening stage how many are today please معاه لابتوب ايه اعرض وريني طلبات تذاكر دعم تقني مفتوحه الجهاز ده مع مين بلغ ابلغ تالف مكسور في من افتح طلب").split(' '));
/** Fixed registered SQL sources. Never interpolate provider names, fields, IDs or SQL. */
const sources = { employee: { table: 'employees', label: 'full_name', identifier: 'email' }, location: { table: 'company_locations', label: 'name', identifier: 'code' }, asset: { table: 'assets', label: 'name', identifier: 'asset_tag' }, job_opening: { table: 'hiring_jobs', label: 'title', identifier: 'title' }, candidate: { table: 'hiring_applicants', label: 'full_name', identifier: 'email' } } as const;
export async function resolveWorkforceEntity(c: PoolClient, u: Actor, query: string, type: EntityType, choice?: string, employeeId?: string): Promise<EntityResolution> {
    const started = performance.now(), base = { type, status: 'unresolved' as const, evaluated: 0, latencyMs: 0 };
    const hiring = type === 'candidate' || type === 'job_opening';
    const permitted = hiring ? await hiringAllowed(c, u, 'hiring.view') : type === 'asset' ? employeeId === u.employeeId || await supportAuthority(c, u) || await hiringAllowed(c, u, 'assets.view') : await supportAuthority(c, u) || await hiringAllowed(c, u, 'assets.view');
    if (!permitted)
        return { ...base, status: 'forbidden', latencyMs: performance.now() - started };
    const serialAllowed = type === 'asset' && await hiringAllowed(c, u, 'assets.view');
    const source = sources[type], tokens = entityTokens(query).map(t => t.value).filter(v => !ignored.has(v) && v.length > 1).slice(0, 40);
    const ids = [...query.matchAll(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi)].map(m => m[0]);
    const related = type === 'asset' && employeeId ? "AND EXISTS(SELECT 1 FROM asset_assignments x WHERE x.tenant_id=e.tenant_id AND x.asset_id=e.id AND x.employee_id=$5 AND x.status='active')" : '';
    const rows = (await c.query(`SELECT e.id,e.${source.label} label,e.${source.identifier} identifier${serialAllowed ? ',e.serial_number serial' : ''} FROM ${source.table} e WHERE e.tenant_id=$1 ${related} AND (regexp_split_to_array(stanza_entity_normalize(e.${source.label}),' ') && $2::text[] OR e.id=ANY($3::uuid[]) OR position(lower(e.${source.identifier}) in lower($4))>0 ${serialAllowed ? "OR position(lower(e.serial_number) in lower($4))>0" : ''} ${type === 'asset' && employeeId ? "OR e.category='laptop' AND $4~*'laptop|لابتوب'" : ''}) ORDER BY e.${source.label},e.id LIMIT 51`, type === 'asset' && employeeId ? [u.tenantId, tokens, ids, query, employeeId] : [u.tenantId, tokens, ids, query])).rows;
    const candidates = rows.slice(0, 50).map(r => { const serialSpan = serialAllowed ? findEntitySpan(query, r.serial || '', type) : undefined; const span = serialSpan || findEntitySpan(query, r.identifier || '', type) || findEntitySpan(query, r.label, type) || findEntitySpan(query, r.id, type); const partial = entityTokens(r.label).find(t => tokens.includes(t.value)); return { ...r, span: span || (partial ? findEntitySpan(query, partial.value, type) : undefined), tier: ids.includes(r.id) || serialSpan ? 4 : type === 'asset' && employeeId ? (findEntitySpan(query, r.identifier || '', type) ? 4 : 1) : span ? 3 : partial ? 1 : 0 }; }).filter(r => r.tier);
    const top = Math.max(0, ...candidates.map(r => r.tier)), best = candidates.filter(r => r.tier === top), truncated = rows.length > 50;
    const selected = choice ? best.find(r => r.id === choice) : best.length === 1 && !truncated ? best[0] : undefined;
    return { ...base, status: selected ? 'resolved' : best.length ? 'ambiguous' : 'unresolved', ...(selected ? { entityId: selected.id, label: selected.label, span: selected.span } : { candidates: best.slice(0, 8).map(r => ({ id: r.id, label: r.label })) }), truncated, evaluated: Math.min(50, rows.length), latencyMs: performance.now() - started };
}
export function workforceExecutor(key: string) {
    return async (c: PoolClient, u: Actor, query: string, choices: EntityChoices = {}, _parameters: EntityParameters = {}): Promise<EntityRoute> => {
        const entities: EntityResolution[] = [], base = { entities, cases: [], locationMeaning: 'employee_current_team' as const };
        const resolve = async (type: EntityType, employeeId?: string) => { const value = await resolveWorkforceEntity(c, u, query, type, choices[type], employeeId); entities.push(value); return value; };
        const result = (extra: Partial<EntityRoute>): EntityRoute => ({ ...base, status: 'resolved', ...extra });
        const failure = () => { const bad = entities.find(e => e.status !== 'resolved'); return bad ? result({ status: bad.status as 'ambiguous' | 'unresolved' | 'forbidden' }) : undefined; };
        if (key.startsWith('hiring_')) {
            if (!await hiringAllowed(c, u, 'hiring.view'))
                return result({ status: 'forbidden' });
            if (key === 'hiring_jobs_query') {
                const rows = (await c.query("SELECT id,title label,department detail FROM hiring_jobs WHERE tenant_id=$1 AND status='open' ORDER BY created_at DESC LIMIT 6", [u.tenantId])).rows;
                return result({ summary: 'Open roles', items: rows.slice(0, 5), total: Number((await c.query("SELECT count(*) FROM hiring_jobs WHERE tenant_id=$1 AND status='open'", [u.tenantId])).rows[0].count) });
            }
            if (key === 'hiring_interviews_query') {
                const rows = (await c.query("SELECT i.id,m.title label,m.starts_at::text detail,count(*) OVER()::int total FROM hiring_interviews i JOIN communication_meetings m ON m.tenant_id=i.tenant_id AND m.id=i.meeting_id WHERE i.tenant_id=$1 AND m.status='scheduled' AND m.starts_at>=current_date AND m.starts_at<current_date+1 ORDER BY m.starts_at LIMIT 5", [u.tenantId])).rows;
                return result({ summary: 'Interviews today (company database date)', items: rows, total: rows[0]?.total || 0 });
            }
            let jobId: string | null = null, candidateId: string | null = null;
            if (/applicants for|المتقدمين لوظيفة/iu.test(query)) {
                const job = await resolve('job_opening');
                jobId = job.entityId || null;
            }
            if (/^(?:open|افتح)/iu.test(query)) {
                const person = await resolve('candidate');
                candidateId = person.entityId || null;
            }
            const failed = failure();
            if (failed)
                return failed;
            const stage = /\boffer\b|العرض/u.test(query) ? 'offer' : /\bscreening\b|الفحص/u.test(query) ? 'screening' : null;
            const where = 'tenant_id=$1 AND ($2::uuid IS NULL OR job_id=$2) AND ($3::uuid IS NULL OR id=$3) AND ($4::text IS NULL OR stage=$4)';
            const params = [u.tenantId, jobId, candidateId, stage];
            const rows = (await c.query(`SELECT id,full_name label,position_title||' · '||stage detail FROM hiring_applicants WHERE ${where} ORDER BY created_at DESC LIMIT 5`, params)).rows;
            return result({ summary: 'Hiring candidates', items: rows, total: Number((await c.query(`SELECT count(*) FROM hiring_applicants WHERE ${where}`, params)).rows[0].count), candidateId: candidateId || undefined });
        }
        let employeeId: string | undefined, assetId: string | undefined, locationId: string | undefined;
        const own = /\bmy\b|الخاصة بي|عهدتي/u.test(query);
        const employeeMention = key === 'employee_equipment' || /['’]s|for [\p{L}]+['’]s|معاه|show .+ support tickets/iu.test(query) || key === 'support_report' && !own;
        if (own)
            employeeId = u.employeeId;
        else if (employeeMention) {
            const employee = await resolve('employee');
            employeeId = employee.entityId;
            const failed = failure();
            if (failed)
                return failed;
        }
        if (key === 'asset_holder' || key === 'support_report' || /\b[A-Z]{2,}-[A-Z0-9]+-\d+\b|laptop|لابتوب/u.test(query) && key === 'support_lookup') {
            const asset = await resolve('asset', employeeId);
            assetId = asset.entityId;
            const failed = failure();
            if (failed)
                return failed;
        }
        if (key === 'employee_equipment' || key === 'asset_holder') {
            const rows = (await c.query("SELECT count(*) OVER()::int total,a.id,a.name label,a.asset_tag||' · '||COALESCE(e.full_name,'Unassigned') detail FROM assets a LEFT JOIN asset_assignments x ON x.tenant_id=a.tenant_id AND x.asset_id=a.id AND x.status='active' LEFT JOIN employees e ON e.tenant_id=x.tenant_id AND e.id=x.employee_id WHERE a.tenant_id=$1 AND ($2::uuid IS NULL OR x.employee_id=$2) AND ($3::uuid IS NULL OR a.id=$3) ORDER BY a.name LIMIT 6", [u.tenantId, employeeId || null, assetId || null])).rows;
            return result({ summary: 'Equipment assignments', items: rows.slice(0, 5), total: rows[0]?.total || 0 });
        }
        if (key === 'support_report') {
            if (!employeeId) {
                const assignment = (await c.query("SELECT employee_id FROM asset_assignments WHERE tenant_id=$1 AND asset_id=$2 AND status='active'", [u.tenantId, assetId])).rows;
                if (assignment.length !== 1)
                    return result({ status: 'unresolved' });
                employeeId = assignment[0].employee_id;
            }
            if (employeeId !== u.employeeId && !await supportAuthority(c, u, 'support.manage'))
                return result({ status: 'forbidden' });
            return result({ summary: 'Review the prefilled support form; nothing has been submitted.', prefill: { assetId: assetId!, assetName: entities.find(e => e.type === 'asset')?.label || 'Equipment', requesterId: employeeId!, summary: 'Equipment damage', description: query } });
        }
        const queue = !own;
        if (queue && !await supportAuthority(c, u) && !await supportAuthority(c, u, 'support.manage'))
            return result({ status: 'forbidden' });
        if (/\b(?:for|from|at|in) .*(?:warehouse|office)|مخزن|مستودع/iu.test(query)) {
            const location = await resolve('location');
            locationId = location.entityId;
            const failed = failure();
            if (failed)
                return failed;
        }
        const status = /\b(?:open|unresolved)\b|مفتوح/u.test(query) ? 'unresolved' : '';
        const data = await listSupportTickets(c, u, { queue: queue ? 'true' : 'false', status, assignment: /assigned to me/iu.test(query) ? 'mine' : '', assetId, requesterId: employeeId, locationId, pageSize: 5 });
        return result({ summary: 'Support requests', items: data.tickets.map((t: any) => ({ id: t.id, label: t.summary, detail: t.status + ' · ' + t.requester_name })), total: data.total });
    };
}
/** Bounded, authorized template preparation for learned entity examples. No identifiers persist. */
export async function prepareWorkforceSemanticQueries(c: PoolClient, u: Actor, query: string, allowedKeys: string[]) {
    const keys = /laptop|equipment|asset|\b[A-Z]{2,}-[A-Z0-9]+-\d+\b|لابتوب|الجهاز|العهدة/iu.test(query) ? ['employee_equipment', 'asset_holder', 'support_report', 'support_lookup'] : /candidate|applicant|application|مرشح|المتقدم|طلب/iu.test(query) ? ['hiring_candidates_query'] : [];
    const templates = new Set<string>();
    for (const key of keys.filter(k => allowedKeys.includes(k)).slice(0, 4)) {
        const result = await workforceExecutor(key)(c, u, query);
        if (result.status !== 'resolved')
            continue;
        const template = generalizeEntities(query, result.entities);
        if (template && safeEntityTemplate(template))
            templates.add(template.text);
    }
    return [...templates].slice(0, 3);
}
