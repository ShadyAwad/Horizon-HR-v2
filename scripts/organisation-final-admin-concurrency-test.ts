import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { getDbPool } from '../src/lib/hr-background';
import { assertHrAdminAssignmentsMayBeRevoked, lockFinalHrAdminAuthority } from '../src/server/organisation/final-hr-admin';
import { assertDatabaseMutationSafety } from './mutation-safety';

config({ path: '.env.development.local', override: false });

if (process.env.ORGANISATION_CONCURRENCY_TEST !== 'true') {
  console.log('Organisation final-admin concurrency test skipped. Set ORGANISATION_CONCURRENCY_TEST=true with the mutation-safety flags to run it.');
  process.exit(0);
}

assertDatabaseMutationSafety(process.env.DATABASE_URL, 'Organisation final-admin concurrency test');

const pool = getDbPool();
const runId = randomUUID();
const slug = `organisation-final-admin-${runId}`;
let tenantId = '';

async function beginTenantTransaction() {
  const client = await pool.connect();
  await client.query('BEGIN');
  await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
  return client;
}

try {
  const setup = await pool.connect();
  try {
    await setup.query('BEGIN');
    const tenant = await setup.query<{ id: string }>(
      `INSERT INTO tenants(slug,company_name) VALUES($1,$2) RETURNING id`,
      [slug, 'Organisation Final Admin Concurrency Test'],
    );
    tenantId = tenant.rows[0].id;
    await setup.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
    const role = await setup.query<{ id: string }>(
      `INSERT INTO tenant_roles(tenant_id,name,system_key,is_system,is_active)
       VALUES($1,'HR Admin','hr_admin',true,true) RETURNING id`,
      [tenantId],
    );
    const employees = await setup.query<{ id: string }>(
      `INSERT INTO employees(tenant_id,email,full_name,password_hash,role,is_active,employment_status)
       VALUES
         ($1,$2,'Concurrent Admin One','not-used','employee',true,'active'),
         ($1,$3,'Concurrent Admin Two','not-used','employee',true,'active')
       RETURNING id`,
      [tenantId, `admin-one-${runId}@stanza.test`, `admin-two-${runId}@stanza.test`],
    );
    const assignments = await setup.query<{ id: string; employee_id: string }>(
      `INSERT INTO employee_role_assignments(tenant_id,employee_id,role_id,scope_type)
       VALUES($1,$2,$4,'company'),($1,$3,$4,'company')
       RETURNING id,employee_id`,
      [tenantId, employees.rows[0].id, employees.rows[1].id, role.rows[0].id],
    );
    await setup.query('COMMIT');

    const first = await beginTenantTransaction();
    const second = await beginTenantTransaction();
    try {
      await lockFinalHrAdminAuthority(first, tenantId);
      const secondAttempt = (async () => {
        await lockFinalHrAdminAuthority(second, tenantId);
        try {
          await assertHrAdminAssignmentsMayBeRevoked(second, tenantId, assignments.rows[1].employee_id, [assignments.rows[1].id]);
          throw new Error('Second concurrent final-admin revocation was incorrectly allowed.');
        } catch (error) {
          if ((error as { code?: string }).code !== 'FINAL_HR_ADMIN_REQUIRED') throw error;
        }
      })();

      await assertHrAdminAssignmentsMayBeRevoked(first, tenantId, assignments.rows[0].employee_id, [assignments.rows[0].id]);
      await first.query(`UPDATE employee_role_assignments SET revoked_at=NOW() WHERE tenant_id=$1 AND id=$2`, [tenantId, assignments.rows[0].id]);
      await first.query('COMMIT');
      await secondAttempt;
      await second.query('ROLLBACK');
      console.log('PASS  Concurrent HR Admin revocations preserve one effective administrator.');
    } finally {
      first.release();
      second.release();
    }
  } catch (error) {
    await setup.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    setup.release();
  }
} finally {
  if (tenantId) {
    await pool.query(`DELETE FROM tenants WHERE id=$1 AND slug=$2`, [tenantId, slug]);
  }
  await pool.end();
}
