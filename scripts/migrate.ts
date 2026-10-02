import 'dotenv/config';
import { getDbPool } from '../src/lib/hr-background';
import { applyMigrations } from './migration-order';
if (!process.env.DATABASE_URL)
    throw new Error('Set DATABASE_URL before applying migrations.');
const pool = getDbPool();
try {
    await applyMigrations(pool);
}
finally {
    await pool.end();
}
