import {DEMO_ADMIN_EMAIL} from '../src/lib/demo-personas';
import 'dotenv/config';
import {getMigrationPool as getDbPool, migrationUrl} from './migration-pool';
import { assertDatabaseMutationSafety } from './mutation-safety';
import { identifyDemo, emailFor, DEMO_SLUG } from './demo/core';
import {seedDemoContents} from './demo/seed';
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
        const ctx = await seedDemoContents(client,tenant,process.argv.includes('--organisation'),name=>{phase=name;});
        await client.query('COMMIT');
        console.log('Northstar Systems demo tenant seeded.');
        console.log('Reconciled fixture rows:', Object.fromEntries([...ctx.tables].map(([table, ids]) => [table, ids.size])));
        console.log('Employees:', ctx.people.size, 'Departments:', ctx.departments.size, 'Currency:', ctx.currency, 'Attendance location mode:', ctx.mode, 'Company loans:', ctx.loans);
        console.log('Demo login identities:', [DEMO_ADMIN_EMAIL,...['admin', 'manager', 'employee'].map(emailFor)].join(', '));
        console.log('Existing passwords preserved. New fixture accounts use DEMO_PASSWORD except the published Login Demo Admin; passwords omitted. No delivery jobs queued.');
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
