import 'dotenv/config';
import { getMigrationPool } from './migration-pool';
import { grantRuntimeAccess, runtimeRoleName } from './runtime-role';
const role = process.env.DATABASE_RUNTIME_ROLE;
if (!role) throw new Error('Set DATABASE_RUNTIME_ROLE for the dedicated application login.');
const quoted = runtimeRoleName(role), pool = getMigrationPool();
try {
  const existing = (await pool.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount;
  if (!existing) {
    const password = process.env.DATABASE_RUNTIME_PASSWORD;
    if (!password || password.length<24) throw new Error('New runtime roles require DATABASE_RUNTIME_PASSWORD with at least 24 characters; no default is provided.');
    // Role identifiers and literals cannot be SQL bind parameters. Validate identifier,
    // quote password as a literal, and never print query text or underlying errors.
    const escaped = password.replaceAll("'", "''").replaceAll('\\','\\\\');
    await pool.query(`CREATE ROLE ${quoted} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD E'${escaped}'`);
  }
  await grantRuntimeAccess(pool, role);
  console.log('Runtime role verified and least-privilege grants applied. Existing passwords are preserved.');
} catch { console.error('Runtime role setup failed. Verify the explicit migration connection, role name and secure password configuration.'); process.exitCode=1; }
finally { await pool.end(); }
