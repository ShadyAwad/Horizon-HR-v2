import 'dotenv/config';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { getDbPool } from '../src/lib/hr-background';
import { assertDatabaseMutationSafety } from './mutation-safety';
import { identifyDemo, fixtureId, DEMO_SLUG } from './demo/core';
import { readManifest, resetDemoFixtures, FIXTURE_TABLES } from './demo/reset';
import { caseTransition } from '../src/lib/grievance-contract';
import { PERMISSION_REGISTRY } from '../src/server/organisation/permission-registry';
import { demoWorkspace } from '../src/components/workspace-composer/demo-workspace';
import { canUseWidget, widgetDefinition } from '../src/components/workspace-composer/widget-catalog';
assertDatabaseMutationSafety(process.env.DATABASE_URL, 'Demo seed tests', true, true);
const pool = getDbPool();
const client = await pool.connect();
async function snapshot(exclude: string) { const tables = (await client.query("SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='tenant_id' ORDER BY table_name")).rows; const result: Record<string, string> = {}; for (const { table_name: t } of tables)
    if (/^[a-z_]+$/.test(t))
        result[t] = (await client.query(`SELECT md5(COALESCE(string_agg(row_data::text,'' ORDER BY row_data::text),'')) AS hash FROM (SELECT to_jsonb(r) AS row_data FROM ${t} r WHERE tenant_id<>$1) records`, [exclude])).rows[0].hash; return result; }
async function counts(t: string) { const result: Record<string, number> = {}; for (const table of FIXTURE_TABLES)
    result[table] = Number((await client.query(`SELECT count(*) FROM ${table} WHERE tenant_id=$1`, [t])).rows[0].count); return result; }
async function zero(sql: string, t: string, label: string) { assert.equal(Number((await client.query(sql, [t])).rows[0].count), 0, label); console.log('PASS', label); }
try {
    const tenant = await identifyDemo(client);
    assert(tenant);
    const t = tenant.id;
    await client.query("SELECT set_config('app.current_tenant',$1,false)", [t]);
    const other = await snapshot(t), before = await counts(t);
    const passwordHashes = (await client.query('SELECT id,password_hash FROM employees WHERE tenant_id=$1 ORDER BY id', [t])).rows;
    const run = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/seed-demo.ts'], { env: process.env, encoding: 'utf8' });
    if (run.status !== 0)
        throw new Error(run.stderr || run.stdout);
    console.log(run.stdout);
    assert.deepEqual(await counts(t), before, 'second seed must not duplicate rows');
    assert.deepEqual(await snapshot(t), other, 'other tenants remain byte-for-byte unchanged');
    assert.deepEqual((await client.query('SELECT id,password_hash FROM employees WHERE tenant_id=$1 ORDER BY id', [t])).rows, passwordHashes, 'existing password hashes preserved');
    console.log('PASS rerun counts, non-demo isolation and passwords');
    const manifest = await readManifest(client, t);
    assert(manifest.employees?.length === 21);
    assert(manifest.grievances?.length === 6);
    await zero("SELECT count(*) FROM employee_role_assignments a JOIN tenant_roles r ON r.id=a.role_id JOIN employees e ON e.id=a.employee_id WHERE a.tenant_id=$1 AND e.email='employee@stanza-demo.com' AND a.revoked_at IS NULL AND r.system_key IN ('manager','hr_admin')", t, 'regular employee has no stale privileged built-in assignment');
    const keys = (await client.query('SELECT p.permission_key FROM tenant_role_permissions p WHERE tenant_id=$1', [t])).rows;
    assert(keys.every(r => PERMISSION_REGISTRY.some(p => p.key === r.permission_key)));
    console.log('PASS fixture permission registry');
    assert.equal(Number((await client.query("SELECT count(*) FROM company_feed_visibility WHERE tenant_id=$1 AND post_id=ANY($2::uuid[]) AND visibility_type='all'", [t, manifest.company_feed_posts])).rows[0].count), 6, 'all six demo posts visible to employees');
    await zero("SELECT count(*) FROM employees e LEFT JOIN employees m ON m.id=e.manager_id AND m.tenant_id=e.tenant_id WHERE e.tenant_id=$1 AND e.manager_id IS NOT NULL AND m.id IS NULL", t, 'valid manager references');
    await zero("WITH RECURSIVE chain AS (SELECT id,manager_id,ARRAY[id] AS path,false AS cycle FROM employees WHERE tenant_id=$1 UNION ALL SELECT e.id,e.manager_id,c.path||e.id,e.id=ANY(c.path) FROM chain c JOIN employees e ON e.tenant_id=$1 AND e.id=c.manager_id WHERE NOT c.cycle) SELECT count(*) FROM chain WHERE cycle", t, 'acyclic reporting hierarchy');
    await zero('SELECT count(*) FROM company_locations WHERE tenant_id=$1 AND (NOT ST_IsValid(boundary) OR ST_SRID(boundary)<>4326)', t, 'valid PostGIS locations');
    await zero('SELECT count(*) FROM time_logs WHERE tenant_id=$1 AND clock_out_time<=clock_in_time', t, 'attendance chronological constraints');
    await zero('SELECT count(*) FROM (SELECT employee_id FROM time_logs WHERE tenant_id=$1 AND clock_out_time IS NULL GROUP BY employee_id HAVING count(*)>1) bad', t, 'unique open shift');
    await zero('SELECT count(*) FROM attendance_breaks b JOIN time_logs l ON l.tenant_id=b.tenant_id AND l.id=b.time_log_id WHERE b.tenant_id=$1 AND (b.started_at<l.clock_in_time OR b.ended_at>l.clock_out_time OR b.ended_at<=b.started_at)', t, 'breaks stay within source shifts');
    await zero("SELECT count(*) FROM attendance_daily_summaries s WHERE s.tenant_id=$1 AND s.work_date>=CURRENT_DATE-14 AND s.work_date<CURRENT_DATE AND s.total_minutes <> (SELECT floor(COALESCE(sum(extract(epoch FROM(l.clock_out_time-l.clock_in_time))-attendance_unpaid_break_seconds(l.tenant_id,l.id,l.clock_out_time)),0)/60) FROM time_logs l WHERE l.tenant_id=s.tenant_id AND l.employee_id=s.employee_id AND l.clock_in_time>=s.work_date::timestamp AT TIME ZONE 'UTC' AND l.clock_in_time<(s.work_date+1)::timestamp AT TIME ZONE 'UTC')", t, 'rollups match source and unpaid breaks');
    await zero('SELECT count(*) FROM leave_requests WHERE tenant_id=$1 AND end_date<start_date', t, 'valid leave ranges');
    await zero('SELECT count(*) FROM payroll_records WHERE tenant_id=$1 AND net_pay<>base_salary+bonuses-deductions', t, 'payroll totals');
    await zero('SELECT count(*) FROM employee_loans l WHERE tenant_id=$1 AND principal_amount-outstanding_balance <> (SELECT COALESCE(sum(amount),0) FROM employee_loan_payments p WHERE p.tenant_id=l.tenant_id AND p.loan_id=l.id)', t, 'loan balances reconcile to repayments');
    await zero("SELECT count(*) FROM grievances WHERE tenant_id=$1 AND id=ANY(ARRAY['" + manifest.grievances.join("'::uuid,'") + "'::uuid]) AND ((status='resolved' AND (resolved_by IS NULL OR resolution_summary IS NULL)) OR (status IN ('assigned','in_progress','waiting') AND assigned_to IS NULL))", t, 'grievance lifecycle fields');
    await zero("SELECT count(*) FROM communication_messages WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND status IN ('queued','sending')".replace('id=ANY($2::uuid[])', "body LIKE 'Clearly fictional Northstar communication.%'"), t, 'communications have no pending delivery');
    await zero("SELECT count(*) FROM outbox_events WHERE tenant_id=$1 AND payload->>'demoFixture'='true' AND processed_at IS NULL", t, 'seed outbox cannot dispatch');
    for (const role of ['hr_admin', 'manager', 'employee'] as const) {
        const permissions = role === 'hr_admin' ? PERMISSION_REGISTRY.map(p => p.key) : (await client.query('SELECT permission_key FROM tenant_role_permissions p JOIN tenant_roles r ON r.id=p.role_id AND r.tenant_id=p.tenant_id WHERE p.tenant_id=$1 AND r.system_key=$2', [t, role])).rows.map(r => r.permission_key);
        const user = { id: 'u', email: 'demo@example.invalid', name: 'Fixture', role, tenantId: t, isDemoTenant: true, permissions };
        const w = demoWorkspace(user)!;
        assert(w.workspaces[0].widgets.length >= 3);
        assert(w.workspaces[0].widgets.every(v => canUseWidget(user, widgetDefinition(v.widgetId)!)));
        assert.equal(demoWorkspace({ ...user, isDemoTenant: false }), null);
    }
    console.log('PASS role-specific demo workspaces and non-demo default');
    const events = (await client.query("SELECT metadata FROM grievance_case_events WHERE tenant_id=$1 AND case_id=ANY($2::uuid[]) AND kind='status_changed'", [t, manifest.grievances])).rows;
    for (const event of events)
        caseTransition(event.metadata.previousStatus, event.metadata.newStatus);
    console.log('PASS case history follows canonical transitions');
    const original = process.env.DEMO_TENANT_ID;
    process.env.DEMO_TENANT_ID = fixtureId('wrong-tenant');
    await assert.rejects(() => identifyDemo(client), /does not match|positive marker/);
    process.env.DEMO_TENANT_ID = original;
    console.log('PASS explicit demo UUID safety');
    await client.query('BEGIN');
    try {
        const removed = await resetDemoFixtures(client, t);
        assert(removed > 0);
        for (const table of FIXTURE_TABLES)
            if (manifest[table]?.length)
                assert.equal((await client.query(`SELECT count(*) FROM ${table} WHERE tenant_id=$1 AND id=ANY($2::uuid[])`, [t, manifest[table]])).rows[0].count, '0', `reset clears all owned ${table} fixtures`);
        assert.equal((await client.query('SELECT count(*) FROM grievances WHERE tenant_id=$1 AND id=ANY($2::uuid[])', [t, manifest.grievances])).rows[0].count, '0');
        assert.equal((await client.query('SELECT count(*) FROM tenants WHERE id=$1 AND slug=$2', [t, DEMO_SLUG])).rows[0].count, '1');
        assert.equal((await client.query("SELECT count(*) FROM employees WHERE tenant_id=$1 AND email IN ('admin@stanza-demo.com','manager@stanza-demo.com','employee@stanza-demo.com')", [t])).rows[0].count, '3');
        assert.deepEqual(await snapshot(t), other);
        console.log('PASS transactional reset scope and credentials');
    }
    finally {
        await client.query('ROLLBACK');
    }
    console.log('Demo integrity and reset tests passed. Reset probe rolled back.');
}
finally {
    client.release();
    await pool.end();
}
