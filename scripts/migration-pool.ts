import 'dotenv/config';
import { Pool } from 'pg';

export function migrationUrl() {
  const value = process.env.DATABASE_MIGRATION_URL?.trim();
  if (!value) throw new Error('DATABASE_MIGRATION_URL is required for administrative tooling; runtime credentials are never used as a fallback.');
  try {
    const parsed=new URL(value);
    if (!['postgres:','postgresql:'].includes(parsed.protocol)) throw new Error();
  } catch { throw new Error('DATABASE_MIGRATION_URL must be a valid PostgreSQL URL.'); }
  return value;
}
export function getMigrationPool() {
  // Fixture tooling must never administer a different database from the guarded
  // runtime test target. Normal migrations can run without runtime credentials.
  if (process.env.ALLOW_TEST_DATA_MUTATION==='true' && process.env.DATABASE_URL) {
    let runtime: URL;
    try { runtime=new URL(process.env.DATABASE_URL); } catch { throw new Error('Test DATABASE_URL must be a valid PostgreSQL URL.'); }
    const migration=new URL(migrationUrl());
    if (runtime.hostname!==migration.hostname || (runtime.port||'5432')!==(migration.port||'5432') || runtime.pathname!==migration.pathname)
      throw new Error('Test runtime and migration connections must target the same database.');
  }
  const ca = process.env.DATABASE_SSL_CA?.replace(/\\n/g, '\n').trim();
  return new Pool({ connectionString: migrationUrl(),
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true, ...(ca ? { ca } : {}) } : undefined,
    max: 4, connectionTimeoutMillis: 3000 });
}
