import 'dotenv/config';
import { getMigrationPool } from './migration-pool';
import { applyMigrations } from './migration-order';
import { grantRuntimeAccess } from './runtime-role';
const pool = getMigrationPool();
async function migrate() {
    try {
        await applyMigrations(pool);
        const role=process.env.DATABASE_RUNTIME_ROLE;
        if (role) {
            const exists=(await pool.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount;
            if (exists) await grantRuntimeAccess(pool, role);
            else console.log('Migrations applied. Provision the runtime login with db:setup:runtime before starting web/worker.');
        }
    } finally { await pool.end(); }
}
migrate().catch(() => { console.error('Migration failed; inspect the database migration job logs.'); process.exitCode = 1; });
