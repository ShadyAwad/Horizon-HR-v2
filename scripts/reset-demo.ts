import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { getDbPool } from '../src/lib/hr-background';

const DEMO_SLUG = 'stanza-demo';

function assertDemoMutationSafety() {
  if (process.env.NODE_ENV === 'production') throw new Error('Demo reset is disabled in production.');
  if (process.env.STANZA_DEMO_ENV !== 'true') throw new Error('Set STANZA_DEMO_ENV=true to reset demo data.');
  if (process.env.ALLOW_DEMO_DATA_MUTATION !== 'true') throw new Error('Set ALLOW_DEMO_DATA_MUTATION=true to reset demo data.');
  const rawDatabaseUrl = process.env.DATABASE_URL?.trim();
  if (!rawDatabaseUrl) throw new Error('DATABASE_URL is required for demo reset.');
  let databaseUrl: URL;
  try {
    databaseUrl = new URL(rawDatabaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL.');
  }
  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\/+/, ''));
  const allowlist = (process.env.DEMO_DATABASE_ALLOWLIST || '').split(',').map((value) => value.trim()).filter(Boolean);
  if (!databaseName || !allowlist.includes(databaseName)) throw new Error('The target database is not in DEMO_DATABASE_ALLOWLIST.');
  console.log(`Demo reset target: ${databaseUrl.hostname}:${databaseUrl.port || '5432'}/${databaseName}`);
}

async function confirmReset() {
  if (process.env.DEMO_RESET_CONFIRM === DEMO_SLUG) return;
  if (!input.isTTY) throw new Error(`Set DEMO_RESET_CONFIRM=${DEMO_SLUG} for non-interactive demo reset.`);
  const readline = createInterface({ input, output });
  try {
    const answer = await readline.question(`Type ${DEMO_SLUG} to confirm deleting only the demo tenant: `);
    if (answer.trim() !== DEMO_SLUG) throw new Error('Demo reset confirmation did not match.');
  } finally {
    readline.close();
  }
}

async function resetDemo() {
  assertDemoMutationSafety();
  await confirmReset();
  const pool = getDbPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const tenantResult = await client.query<{ id: string }>(
      'SELECT id FROM tenants WHERE slug = $1 FOR UPDATE',
      [DEMO_SLUG],
    );
    const tenant = tenantResult.rows[0];

    if (!tenant) {
      await client.query('COMMIT');
      console.log('No Stanza demo tenant found. Nothing to reset.');
      return;
    }

    await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenant.id]);

    // Delete leaf rows first so this remains safe even if future schema changes reduce CASCADE coverage.
    const dependentTables = [
      'company_feed_visibility',
      'employee_loan_payments',
      'attendance_daily_summaries',
      'user_notification_settings',
      'user_webauthn_credentials',
      'webauthn_challenges',
      'password_reset_tokens',
      'auth_sessions',
      'time_logs',
      'break_requests',
      'leave_requests',
      'resignation_requests',
      'payroll_records',
      'employee_compensation_profiles',
      'employee_loans',
      'grievances',
      'company_feed_posts',
      'audit_logs',
      'outbox_events',
      'employee_role_assignments',
      'tenant_role_permissions',
      'company_locations',
      'geofences',
      'tenant_roles',
    ];

    for (const table of dependentTables) {
      await client.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenant.id]);
    }

    await client.query('UPDATE employees SET manager_id = NULL WHERE tenant_id = $1', [tenant.id]);
    await client.query('DELETE FROM employees WHERE tenant_id = $1', [tenant.id]);
    await client.query('DELETE FROM tenants WHERE id = $1 AND slug = $2', [tenant.id, DEMO_SLUG]);
    await client.query('COMMIT');
    console.log('Stanza demo tenant and demo-only data removed.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

resetDemo().catch((error) => {
  console.error('Failed to reset Stanza demo:', error);
  process.exitCode = 1;
});
