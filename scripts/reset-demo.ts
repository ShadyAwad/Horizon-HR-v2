import 'dotenv/config';
import { getDbPool } from '../src/lib/hr-background';
import { assertDatabaseMutationSafety, requireDestructiveConfirmation } from './mutation-safety';
import { identifyDemo, DEMO_SLUG } from './demo/core';
import { resetDemoFixtures } from './demo/reset';
async function resetDemo() {
    if (process.env.STANZA_DEMO_ENV !== 'true' || process.env.ALLOW_DEMO_DATA_MUTATION !== 'true')
        throw new Error('Demo reset requires STANZA_DEMO_ENV=true and ALLOW_DEMO_DATA_MUTATION=true.');
    assertDatabaseMutationSafety(process.env.DATABASE_URL, 'Demo reset', false, true);
    await requireDestructiveConfirmation(DEMO_SLUG, 'demo fixture reset');
    const pool = getDbPool(), client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`demo-seed:${DEMO_SLUG}`]);
        const tenant = await identifyDemo(client);
        if (!tenant) {
            await client.query('COMMIT');
            console.log('No demo tenant found.');
            return;
        }
        await client.query("SELECT set_config('app.current_tenant',$1,true)", [tenant.id]);
        const removed = await resetDemoFixtures(client, tenant.id);
        await client.query('COMMIT');
        console.log(`Removed ${removed} owned demo fixture rows. Tenant, existing login credentials, policies and unrelated records preserved.`);
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
        await pool.end();
    }
}
resetDemo().catch(error => { console.error('Demo reset rolled back:', error instanceof Error ? error.message : 'Unknown failure'); process.exitCode = 1; });
