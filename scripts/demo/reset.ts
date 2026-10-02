import type { PoolClient } from 'pg';
import { fixtureId } from './core';
export const FIXTURE_TABLES = new Set(['tenant_roles', 'employees', 'employee_compensation_profiles', 'organisation_departments', 'organisation_teams', 'organisation_job_titles', 'organisation_team_memberships', 'company_locations', 'geofences', 'attendance_break_policies', 'time_logs', 'attendance_breaks', 'break_requests', 'roster_shifts', 'leave_requests', 'leave_request_history', 'assets', 'asset_assignments', 'expense_claims', 'expense_claim_history', 'payroll_records', 'employee_loans', 'employee_loan_payments', 'hiring_applicants', 'hiring_stage_history', 'hiring_applicant_notes', 'performance_review_cycles', 'performance_review_templates', 'performance_review_questions', 'performance_goals', 'performance_goal_updates', 'roster_goals', 'performance_reviews', 'performance_review_assignments', 'performance_review_responses', 'grievances', 'grievance_case_events', 'grievance_messages', 'communication_templates', 'communication_meetings', 'communication_messages', 'company_feed_posts', 'outbox_events', 'audit_logs']);
export function validateFixtureManifest(value: unknown): Record<string, string[]> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid demo fixture manifest');
    const result: Record<string, string[]> = {};
    for (const [table, ids] of Object.entries(value)) {
        if (!FIXTURE_TABLES.has(table) || !Array.isArray(ids) || ids.length > 10000 || ids.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) throw new Error('Invalid demo fixture manifest');
        result[table] = [...new Set(ids)] as string[];
    }
    return result;
}
export async function readManifest(client: PoolClient, tenantId: string) { const r = await client.query("SELECT metadata->'fixtureIds' AS fixtures FROM audit_logs WHERE tenant_id=$1 AND id=$2", [tenantId, fixtureId('audit_logs:fixture-manifest')]); return validateFixtureManifest(r.rows[0]?.fixtures ?? {}); }
export async function resetDemoFixtures(client: PoolClient, tenantId: string) {
    const fixtures = await readManifest(client, tenantId);
    await clearMovingAttendance(client, tenantId);
    const tables = Object.keys(fixtures).filter(t => FIXTURE_TABLES.has(t) && !['grievance_messages', 'grievance_case_events'].includes(t));
    if (!tables.length)
        return 0;
    // Break the existing organisation cycle without touching other employees.
    await client.query('UPDATE employees SET manager_id=NULL,department_id=NULL,team_id=NULL,job_title_id=NULL WHERE tenant_id=$1 AND id=ANY($2::uuid[])', [tenantId, fixtures.employees ?? []]);
    await client.query('UPDATE organisation_departments SET department_head_id=NULL,parent_department_id=NULL WHERE tenant_id=$1 AND id=ANY($2::uuid[])', [tenantId, fixtures.organisation_departments ?? []]);
    await client.query('UPDATE organisation_teams SET team_lead_id=NULL WHERE tenant_id=$1 AND id=ANY($2::uuid[])', [tenantId, fixtures.organisation_teams ?? []]);
    const dependencies = (await client.query("SELECT child.relname AS child,parent.relname AS parent FROM pg_constraint fk JOIN pg_class child ON child.oid=fk.conrelid JOIN pg_class parent ON parent.oid=fk.confrelid WHERE fk.contype='f' AND child.relnamespace='public'::regnamespace")).rows as {
        child: string;
        parent: string;
    }[];
    const remaining = new Set(tables);
    let count = 0;
    while (remaining.size) {
        const leaves = [...remaining].filter(t => !dependencies.some(d => d.parent === t && d.child !== t && remaining.has(d.child) && !(['employees', 'organisation_departments', 'organisation_teams'].includes(d.child) && ['employees', 'organisation_departments', 'organisation_teams', 'organisation_job_titles'].includes(d.parent))));
        if (!leaves.length)
            throw new Error(`Cannot safely order demo reset: ${[...remaining].join(', ')}`);
        for (const table of leaves) {
            const r = await client.query(`DELETE FROM ${table} WHERE tenant_id=$1 AND id=ANY($2::uuid[])`, [tenantId, fixtures[table]]);
            count += r.rowCount ?? 0;
            remaining.delete(table);
        }
    }
    await client.query('DELETE FROM audit_logs WHERE tenant_id=$1 AND id=$2', [tenantId, fixtureId('audit_logs:fixture-manifest')]);
    return count;
}
/** Refresh moving attendance fixtures before inserts, retaining manual/demo-browser records. */
export async function clearMovingAttendance(client: PoolClient, tenantId: string) {
    const f = await readManifest(client, tenantId);
    const requests = (await client.query('SELECT requested_break_id AS id FROM attendance_breaks WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND requested_break_id IS NOT NULL', [tenantId, f.attendance_breaks ?? []])).rows.map(r => r.id);
    const dates = (await client.query("SELECT DISTINCT employee_id,(clock_in_time AT TIME ZONE 'UTC')::date AS work_date FROM time_logs WHERE tenant_id=$1 AND id=ANY($2::uuid[])", [tenantId, f.time_logs ?? []])).rows;
    for (const table of ['attendance_breaks', 'time_logs', 'roster_shifts'])
        if (f[table]?.length)
            await client.query(`DELETE FROM ${table} WHERE tenant_id=$1 AND id=ANY($2::uuid[])`, [tenantId, f[table]]);
    if (requests.length)
        await client.query('DELETE FROM break_requests WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND id=ANY($3::uuid[])', [tenantId, requests, f.break_requests ?? []]);
    for (const date of dates)
        await client.query("DELETE FROM attendance_daily_summaries s WHERE tenant_id=$1 AND employee_id=$2 AND work_date=$3 AND NOT EXISTS(SELECT 1 FROM time_logs l WHERE l.tenant_id=s.tenant_id AND l.employee_id=s.employee_id AND (l.clock_in_time AT TIME ZONE 'UTC')::date=s.work_date)", [tenantId, date.employee_id, date.work_date]);
}
