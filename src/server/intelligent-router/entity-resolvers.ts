import type { PoolClient } from 'pg';
import { handlerVisibilitySql, type CaseActor } from '../grievances/grievance-policy';
import { normalizeQuery } from '../../lib/intelligent-router';
import { entityTokens, findEntitySpan, type EntityResolution, type EntityType } from '../../lib/router-entities';
const LIMIT = 50;
const ignored = new Set(normalizeQuery('show me find open grievance grievances disciplinary complaint case for from at in employee the a an s please وريني اعرض افتح شوف شكوى شكوي شكوه شكاوى قضية قضيه تاديبيه للموظف الموظف بتاعت بتاعة بتاع من في').split(' '));
type Context = { client: PoolClient; actor: CaseActor; query: string; proposed?: string; choice?: string };
// Syntax locates mention spans, not capitalisation or an assertion that the text is a name.
function mentionText(query:string,type:EntityType) {
 if(type==='location')return query.match(/(?:\b(?:from|at|in)|(?:من|في))\s+(.+)$/iu)?.[1];
 return query.match(/(?:show(?: me)?|find|open)\s+(.+?)(?:['’]s)?\s+(?:disciplinary\s+)?(?:grievance|complaint|case)\b/iu)?.[1]
  ?? query.match(/(?:grievance|complaint|case)(?:\s+case)?\s+for\s+(.+?)(?=\s+(?:from|at|in)\s|$)/iu)?.[1]
  ?? query.match(/(?:الشكوى|شكوى|شكوي|قضية|قضيه)\s+(?:بتاعت\s+|بتاع\s+|للموظف\s+)?(.+?)(?=\s+(?:من|في)\s|$)/u)?.[1];
}
type Candidate = { id: string; label: string; identifier?: string; exact: boolean };
export async function hasGrievanceLookupAuthority(c: PoolClient, u: CaseActor) {
 return Boolean((await c.query(`SELECT 1 FROM employees actor WHERE actor.tenant_id=$1 AND actor.id=$2 AND actor.is_active AND actor.employment_status='active' AND EXISTS (
 SELECT 1 FROM employee_role_assignments a JOIN tenant_role_permissions p ON p.tenant_id=a.tenant_id AND p.role_id=a.role_id WHERE a.tenant_id=$1 AND a.employee_id=$2 AND p.permission_key IN ('grievances.view','grievances.review') AND a.revoked_at IS NULL AND a.assigned_at<=now() AND (a.expires_at IS NULL OR a.expires_at>now())
 UNION ALL SELECT 1 FROM permission_delegations d WHERE d.tenant_id=$1 AND d.granted_to_employee_id=$2 AND d.permission_key IN ('grievances.view','grievances.review') AND d.status='active' AND d.revoked_at IS NULL AND d.starts_at<=now() AND d.expires_at>now())`, [u.tenantId, u.employeeId])).rowCount);
}
async function resolve(type: EntityType, { client: c, actor: u, query, proposed, choice }: Context): Promise<EntityResolution> {
 const start = performance.now();
 const result = (extra: Partial<EntityResolution>): EntityResolution => ({ type, status: 'unresolved', evaluated: 0, latencyMs: performance.now() - start, ...extra });
 if (!await hasGrievanceLookupAuthority(c, u)) return result({ status: 'forbidden' });
 if(proposed&&!findEntitySpan(query,proposed,type))return result({status:'unresolved'});
 const text = proposed ?? mentionText(query,type) ?? query, normalized = normalizeQuery(text);
 const tokens = [...new Set(entityTokens(text).map(t => t.value).filter(t => !ignored.has(t) && t.length >= 2))].slice(0, 40);
 const ids = [...text.matchAll(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi)].map(m => m[0].toLowerCase());
 const emails = [...text.matchAll(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi)].map(m => m[0].toLowerCase());
 // Fixed SQL per registered type. Visibility uses the grievance module's scope/confidential policy.
 const employee = type === 'employee', table = employee ? 'employees' : 'company_locations', label = employee ? 'full_name' : 'name';
 const visibility = employee
 ? `EXISTS(SELECT 1 FROM grievances g WHERE g.tenant_id=e.tenant_id AND g.employee_id=e.id AND ${handlerVisibilitySql()})`
 : `EXISTS(SELECT 1 FROM organisation_teams team JOIN employees target ON target.tenant_id=team.tenant_id AND target.team_id=team.id JOIN grievances g ON g.tenant_id=target.tenant_id AND g.employee_id=target.id WHERE team.tenant_id=e.tenant_id AND team.location_id=e.id AND ${handlerVisibilitySql()})`;
 const rows = (await c.query<Candidate>(`SELECT e.id,e.${label} AS label,${employee ? 'e.email' : 'e.code'} AS identifier,position(' '||stanza_entity_normalize(e.${label})||' ' in ' '||$3||' ')>0 AS exact
 FROM ${table} e WHERE e.tenant_id=$1 AND ${employee ? 'true' : 'e.is_active'} AND ${visibility}
 AND (regexp_split_to_array(stanza_entity_normalize(e.${label}),' ') && $4::text[] OR e.id=ANY($5::uuid[]) ${employee ? 'OR lower(e.email)=ANY($6::text[])' : ''})
 ORDER BY exact DESC,e.${label},e.id LIMIT 51`, employee ? [u.tenantId, u.employeeId, normalized, tokens, ids, emails] : [u.tenantId, u.employeeId, normalized, tokens, ids])).rows;
 const evaluated = Math.min(rows.length, LIMIT), truncated = rows.length > LIMIT;
 const matches = rows.slice(0, LIMIT).map(row => {
  const full = findEntitySpan(text, row.label, type);
  const identifier = ids.includes(row.id) ? row.id : employee && emails.includes(row.identifier?.toLowerCase() ?? '') ? row.identifier : undefined;
  const labelTokens=entityTokens(row.label);
  const partial = tokens.length&&tokens.every(v=>labelTokens.some(t=>t.value===v))?labelTokens.find(t => tokens.includes(t.value)):undefined;
  return { ...row, span: full ?? (identifier ? findEntitySpan(text, identifier, type) : partial ? findEntitySpan(text, partial.value, type) : undefined), tier: full ? 3 : identifier ? 2 : partial ? 1 : 0 };
 }).filter(r => r.tier > 0);
 const tier = Math.max(0, ...matches.map(r => r.tier)), best = matches.filter(r => r.tier === tier);
 const selected = choice ? best.find(r => r.id === choice) : best.length === 1 && !truncated ? best[0] : undefined;
 if (selected) {
  const rawSpan = selected.span ? findEntitySpan(query, text.slice(selected.span.start, selected.span.end), type) : undefined;
  return result({ status: 'resolved', entityId: selected.id, label: selected.label, span: rawSpan, evaluated, truncated });
 }
 if (choice) return result({ evaluated, truncated });
 return result({ status: best.length ? 'ambiguous' : 'unresolved', candidates: best.slice(0, 8).map(r => ({ id: r.id, label: r.label })), evaluated, truncated });
}
export const entityResolvers = {
 employee: (context: Context) => resolve('employee', context),
 location: (context: Context) => resolve('location', context),
} satisfies Record<EntityType, (context: Context) => Promise<EntityResolution>>;
