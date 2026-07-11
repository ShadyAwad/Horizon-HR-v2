import 'dotenv/config';
import { getDbPool } from '../src/lib/hr-background';

const DEMO_SLUG = 'stanza-demo';

async function resetDemo() {
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
      'time_logs',
      'break_requests',
      'leave_requests',
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
