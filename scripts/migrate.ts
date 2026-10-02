import 'dotenv/config';
import { getDbPool } from '../src/lib/hr-background';
import { applyMigrations } from './migration-order';
if (!process.env.DATABASE_URL)
    throw new Error('Set DATABASE_URL before applying migrations.');
const pool = getDbPool();
async function migrate() {
    try {
        await applyMigrations(pool);
    }
    finally {
        await pool.end();
    }
}
migrate().catch(() => { console.error("Migration failed; inspect the database migration job logs."); process.exitCode = 1; });
