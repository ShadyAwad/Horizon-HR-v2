import 'dotenv/config';
import {getMigrationPool as getDbPool, migrationUrl} from './migration-pool';
import { assertDatabaseMutationSafety } from './mutation-safety';
import { identifyDemo, context, emailFor, DEMO_SLUG, type DemoContext } from './demo/core';
import { seedOrganisation } from './demo/organisation';
import { seedAttendance, seedLeave } from './demo/attendance-leave';
import { seedFinanceAssets } from './demo/finance-assets';
import { seedHiringGoals } from './demo/hiring-goals';
import { seedGrievances, seedCommunicationsFeed } from './demo/cases-communications';
import { readManifest, clearMovingAttendance } from './demo/reset';
export async function seedDemo() {
    if (process.env.STANZA_DEMO_ENV !== 'true' || process.env.ALLOW_DEMO_DATA_MUTATION !== 'true')
        throw new Error('Demo seed requires STANZA_DEMO_ENV=true and ALLOW_DEMO_DATA_MUTATION=true.');
    assertDatabaseMutationSafety(migrationUrl(), 'Demo seed', true, true);
    const pool = getDbPool(), client = await pool.connect();
    let phase = 'tenant identification';
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`demo-seed:${DEMO_SLUG}`]);
        const tenant = await identifyDemo(client, true);
        await client.query("SELECT set_config('app.current_tenant',$1,true)", [tenant.id]);
        const policy = (await client.query('SELECT location_mode FROM attendance_policies WHERE tenant_id=$1', [tenant.id])).rows[0];
        const ctx = context(client, tenant, policy?.location_mode ?? 'required');
        const previous = await readManifest(client, tenant.id);
        if (!process.argv.includes('--organisation'))
            await clearMovingAttendance(client, tenant.id);
        const phases: [
            string,
            (ctx: DemoContext) => Promise<void>
        ][] = [['organisation and employees', seedOrganisation], ...process.argv.includes('--organisation') ? [] : [['attendance and breaks', seedAttendance], ['leave', seedLeave], ['assets and finance', seedFinanceAssets], ['hiring and goals', seedHiringGoals], ['grievance cases', seedGrievances], ['communications, feed and audit', seedCommunicationsFeed]] as [
                string,
                (ctx: DemoContext) => Promise<void>
            ][]];
        for (const [name, run] of phases) {
            phase = name;
            await run(ctx);
            console.log(`Ready: ${name}`);
        }
        for (const table of process.argv.includes('--organisation') ? Object.keys(previous) : ['employees', 'organisation_departments', 'company_locations'])
            if (previous[table]) {
                if (!ctx.tables.has(table))
                    ctx.tables.set(table, new Set());
                previous[table].forEach(id => ctx.tables.get(table)!.add(id));
            }
        phase = 'fixture manifest';
        await ctx.row('audit_logs', 'fixture-manifest', { action: 'demo.seed_manifest', entity_type: 'demo_seed', entity_id: tenant.id, metadata: JSON.stringify({ version: 8, fixtureIds: Object.fromEntries([...ctx.tables].map(([table, ids]) => [table, [...ids]])) }) });
        await client.query('COMMIT');
        console.log('Northstar Systems demo tenant seeded.');
        console.log('Reconciled fixture rows:', Object.fromEntries([...ctx.tables].map(([table, ids]) => [table, ids.size])));
        console.log('Employees:', ctx.people.size, 'Departments:', ctx.departments.size, 'Currency:', ctx.currency, 'Attendance location mode:', ctx.mode, 'Company loans:', ctx.loans);
        console.log('Demo login identities:', ['admin', 'manager', 'employee'].map(emailFor).join(', '));
        console.log('Existing passwords preserved. New fixture accounts use DEMO_PASSWORD; passwords omitted. No delivery jobs queued.');
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Demo seed failed in phase "${phase}"; all changes rolled back.`, { cause: error });
    }
    finally {
        client.release();
        await pool.end();
    }
}
seedDemo().catch(error => { console.error('[Demo seed] Failed:', error instanceof Error ? error.message : 'Unknown failure'); process.exitCode = 1; });
