import type { PoolClient } from 'pg';
import { caseAccess, handlerVisibilitySql, type CaseActor } from './grievance-policy';
/** Read-only projection of the existing inbox policy; details reauthorize via caseAccess. */
export async function lookupEmployeeGrievances(c: PoolClient, u: CaseActor, employeeId: string, options: { locationId?: string; status?: string; reference?: string; category?: string }) {
 const rows = (await c.query(`SELECT g.id,g.case_number AS reference,g.title,g.status FROM grievances g
 JOIN employees e ON e.tenant_id=g.tenant_id AND e.id=g.employee_id
 LEFT JOIN organisation_teams team ON team.tenant_id=e.tenant_id AND team.id=e.team_id
 WHERE g.tenant_id=$1 AND g.employee_id=$3 AND ${handlerVisibilitySql()}
 AND ($4::uuid IS NULL OR team.location_id=$4) AND ($5::text IS NULL OR g.status=$5)
 AND ($6::text IS NULL OR g.case_number=$6) AND ($7::text IS NULL OR g.category=$7)
 ORDER BY g.updated_at DESC,g.id LIMIT 9`, [u.tenantId, u.employeeId, employeeId, options.locationId ?? null, options.status ?? null, options.reference ?? null, options.category ?? null])).rows;
 for (const row of rows) await caseAccess(c, u, row.id);
 return rows as { id: string; reference: string; title: string; status: string }[];
}
