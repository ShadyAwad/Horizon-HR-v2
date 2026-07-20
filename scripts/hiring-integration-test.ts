import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { getDbPool } from '../src/lib/hr-background';
import { assertDatabaseMutationSafety, assertHttpMutationSafety } from './mutation-safety';

type JsonObject = Record<string, any>;
type Session = { id: string; tenantId: string; sessionCookie?: string; role: string };

const baseUrl = assertHttpMutationSafety(process.env.HIRING_TEST_BASE_URL || 'http://localhost:3000', 'Hiring integration test');
const password = process.env.HIRING_TEST_PASSWORD || process.env.DEMO_PASSWORD;
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const applicantEmail = `hiring-smoke-${runId}@example.com`;
const passed: string[] = [];
const isolationFixture = {
  slug: 'stanza-hiring-integration-isolation',
  companyName: 'Stanza Hiring Integration Isolation',
  email: 'hiring-integration-reader@stanza.test',
  roleName: 'Hiring Integration Reader',
} as const;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function pass(label: string) {
  passed.push(label);
  console.log(`PASS  ${label}`);
}

async function api(path: string, session?: Session, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (session?.sessionCookie) headers.set('Cookie', session.sessionCookie);
  if (init.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const body = await response.json().catch(() => ({})) as JsonObject;
  if (response.status >= 500) throw new Error(`${init.method || 'GET'} ${path} returned ${response.status}: ${body.error || body.code || 'server error'}`);
  return { response, body };
}

async function login(email: string): Promise<Session> {
  const { response, body } = await api('/api/auth/login', undefined, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  const sessionCookie = response.headers.get('set-cookie')?.split(';', 1)[0];
  assert(response.ok && body.user?.id && sessionCookie, `Login failed for ${email}: ${body.error || response.status}`);
  return { ...body.user, sessionCookie };
}

async function setupOtherTenantHiringFixture(
  pool: ReturnType<typeof getDbPool>,
): Promise<{ tenantId: string; email: string }> {
  assert(password, 'Set HIRING_TEST_PASSWORD or DEMO_PASSWORD; no default credential is used.');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const tenant = await client.query<{ id: string }>(
      `INSERT INTO tenants (slug, company_name)
       VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET company_name = EXCLUDED.company_name, updated_at = NOW()
       RETURNING id`,
      [isolationFixture.slug, isolationFixture.companyName],
    );
    const tenantId = tenant.rows[0].id;
    const role = await client.query<{ id: string }>(
      `INSERT INTO tenant_roles (tenant_id, name, description, is_system, is_active)
       VALUES ($1, $2, 'Dedicated cross-tenant Hiring integration-test role.', false, true)
       ON CONFLICT (tenant_id, name) DO UPDATE
       SET description = EXCLUDED.description, is_active = true, updated_at = NOW()
       RETURNING id`,
      [tenantId, isolationFixture.roleName],
    );
    const passwordHash = bcrypt.hashSync(password, 12);
    const employee = await client.query<{ id: string }>(
      `INSERT INTO employees (tenant_id, email, full_name, password_hash, role, job_title, is_active, employment_status)
       VALUES ($1, $2, 'Hiring Integration Reader', $3, 'employee', 'Integration Test Reader', true, 'active')
       ON CONFLICT (email, tenant_id) DO UPDATE
       SET full_name = EXCLUDED.full_name,
           password_hash = EXCLUDED.password_hash,
           role = EXCLUDED.role,
           job_title = EXCLUDED.job_title,
           is_active = true,
           employment_status = 'active',
           updated_at = NOW()
       RETURNING id`,
      [tenantId, isolationFixture.email, passwordHash],
    );
    const permission = await client.query(
      `INSERT INTO tenant_role_permissions (tenant_id, role_id, permission_key)
       SELECT $1, $2, permission_key
       FROM tenant_permissions
       WHERE permission_key = 'hiring.view'
       ON CONFLICT (tenant_id, role_id, permission_key) DO NOTHING
       RETURNING permission_key`,
      [tenantId, role.rows[0].id],
    );
    if (permission.rowCount === 0) {
      const existingPermission = await client.query(
        `SELECT 1 FROM tenant_role_permissions
         WHERE tenant_id = $1 AND role_id = $2 AND permission_key = 'hiring.view'`,
        [tenantId, role.rows[0].id],
      );
      assert(existingPermission.rowCount === 1, 'Hiring permission is unavailable for the integration fixture.');
    }
    await client.query(
      `INSERT INTO employee_role_assignments (tenant_id, employee_id, role_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, employee_id, role_id) DO NOTHING`,
      [tenantId, employee.rows[0].id, role.rows[0].id],
    );
    await client.query('COMMIT');
    return { tenantId, email: isolationFixture.email };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function cleanupOtherTenantHiringFixture(pool: ReturnType<typeof getDbPool>, tenantId: string) {
  await pool.query(
    `DELETE FROM tenants
     WHERE id = $1 AND slug = $2 AND company_name = $3`,
    [tenantId, isolationFixture.slug, isolationFixture.companyName],
  );
}

async function expectStatus(label: string, expected: number, request: Promise<{ response: Response; body: JsonObject }>) {
  const result = await request;
  assert(result.response.status === expected, `${label}: expected ${expected}, received ${result.response.status} (${result.body.code || result.body.error || 'no error'})`);
  pass(label);
  return result.body;
}

async function main() {
  console.log(`Stanza Hiring integration test: ${baseUrl}`);
  assert(password, 'Set HIRING_TEST_PASSWORD or DEMO_PASSWORD; no default credential is used.');
  assertDatabaseMutationSafety(process.env.DATABASE_URL, 'Hiring integration test');
  const admin = await login(process.env.HIRING_TEST_ADMIN_EMAIL || 'admin@stanza-demo.com');
  const manager = await login(process.env.HIRING_TEST_MANAGER_EMAIL || 'manager@stanza-demo.com');
  const employee = await login(process.env.HIRING_TEST_EMPLOYEE_EMAIL || 'employee@stanza-demo.com');
  assert(admin.tenantId === manager.tenantId && manager.tenantId === employee.tenantId, 'Demo users must share a tenant.');
  pass('Demo sessions authenticated');
  const pool = getDbPool();

  const unauthorized = await expectStatus('Ordinary employee is denied Hiring access', 403, api('/api/hiring/applicants', employee));
  assert(unauthorized.success === false, 'Denied response should be unsuccessful.');

  const created = await expectStatus('HR admin creates applicant', 201, api('/api/hiring/applicants', admin, {
    method: 'POST',
    body: JSON.stringify({
      fullName: `Hiring Integration ${runId}`,
      email: applicantEmail.toUpperCase(),
      phone: '+20 100 000 0000',
      positionTitle: 'QA Workflow Engineer',
      department: 'Quality',
      source: 'Integration test',
    }),
  }));
  const applicantId = created.applicant?.id as string;
  assert(applicantId && created.applicant.email === applicantEmail, 'Applicant email was not normalized.');

  const duplicate = await expectStatus('Normalized duplicate email returns a warning', 201, api('/api/hiring/applicants', admin, {
    method: 'POST',
    body: JSON.stringify({ fullName: `Duplicate ${runId}`, email: `  ${applicantEmail.toUpperCase()}  `, positionTitle: 'QA Workflow Engineer' }),
  }));
  assert(duplicate.warnings?.[0]?.code === 'POSSIBLE_DUPLICATE_APPLICANT', 'Duplicate warning was not returned.');
  const duplicateId = duplicate.applicant.id as string;
  await expectStatus('Duplicate test applicant is archived', 200, api(`/api/hiring/applicants/${duplicateId}/archive`, admin, { method: 'POST' }));

  const list = await expectStatus('Applicant pagination and filters work', 200, api(`/api/hiring/applicants?page=1&pageSize=1&search=${encodeURIComponent(runId)}&stage=new`, admin));
  assert(list.page === 1 && list.pageSize === 1 && list.total >= 1 && list.applicants.length === 1, 'Filtered pagination response is incorrect.');

  await expectStatus('Unknown applicant update fields are rejected', 400, api(`/api/hiring/applicants/${applicantId}`, admin, {
    method: 'PATCH', body: JSON.stringify({ stage: 'hired', tenantId: employee.tenantId }),
  }));
  const updated = await expectStatus('Approved applicant fields can be updated', 200, api(`/api/hiring/applicants/${applicantId}`, admin, {
    method: 'PATCH', body: JSON.stringify({ source: 'Updated integration test' }),
  }));
  assert(updated.applicant.source === 'Updated integration test', 'Applicant update was not persisted.');

  const teamNote = await expectStatus('Hiring-team note can be added', 201, api(`/api/hiring/applicants/${applicantId}/notes`, admin, {
    method: 'POST', body: JSON.stringify({ noteText: 'Visible workflow note', noteType: 'screening', visibility: 'hiring_team' }),
  }));
  const hrNote = await expectStatus('HR-only note can be added by HR', 201, api(`/api/hiring/applicants/${applicantId}/notes`, admin, {
    method: 'POST', body: JSON.stringify({ noteText: 'Confidential workflow note', noteType: 'decision', visibility: 'hr_only' }),
  }));
  await expectStatus('Note author can edit own note', 200, api(`/api/hiring/notes/${teamNote.note.id}`, admin, {
    method: 'PATCH', body: JSON.stringify({ noteText: 'Visible workflow note, edited' }),
  }));
  await expectStatus('Other reviewer cannot edit the author note', 403, api(`/api/hiring/notes/${teamNote.note.id}`, manager, {
    method: 'PATCH', body: JSON.stringify({ noteText: 'Unauthorized edit' }),
  }));
  const managerDetail = await expectStatus('Reviewer can load assigned Hiring details', 200, api(`/api/hiring/applicants/${applicantId}`, manager));
  assert(managerDetail.notes.some((note: JsonObject) => note.id === teamNote.note.id), 'Hiring-team note is missing.');
  assert(!managerDetail.notes.some((note: JsonObject) => note.id === hrNote.note.id), 'HR-only note leaked to a reviewer.');

  await expectStatus('Invalid stage jump is rejected', 409, api(`/api/hiring/applicants/${applicantId}/stage`, admin, {
    method: 'POST', body: JSON.stringify({ targetStage: 'interview' }),
  }));
  await expectStatus('Stale expected stage is rejected', 409, api(`/api/hiring/applicants/${applicantId}/stage`, admin, {
    method: 'POST', body: JSON.stringify({ targetStage: 'screening', expectedCurrentStage: 'hr_review' }),
  }));
  await expectStatus('Valid stage transition succeeds', 200, api(`/api/hiring/applicants/${applicantId}/stage`, admin, {
    method: 'POST', body: JSON.stringify({ targetStage: 'screening', expectedCurrentStage: 'new', reason: 'Qualified for screening' }),
  }));

  const managerCountBefore = await api('/api/dashboard/attention-counts', manager);
  const handoff = await expectStatus('Handoff updates owner and stage', 201, api(`/api/hiring/applicants/${applicantId}/handoff`, admin, {
    method: 'POST', body: JSON.stringify({ reviewerId: manager.id, targetStage: 'hr_review', message: 'Please review this candidate.' }),
  }));
  await expectStatus('Duplicate pending handoff is rejected', 409, api(`/api/hiring/applicants/${applicantId}/handoff`, admin, {
    method: 'POST', body: JSON.stringify({ reviewerId: manager.id }),
  }));
  await pool.query('UPDATE employees SET is_active = false WHERE tenant_id = $1 AND id = $2', [admin.tenantId, manager.id]);
  await expectStatus('Inactive reviewer is rejected at handoff time', 422, api(`/api/hiring/applicants/${applicantId}/handoff`, admin, {
    method: 'POST', body: JSON.stringify({ reviewerId: manager.id }),
  }));
  await pool.query('UPDATE employees SET is_active = true WHERE tenant_id = $1 AND id = $2', [admin.tenantId, manager.id]);
  const managerAssignments = await pool.query<{ role_id: string }>(
    'SELECT role_id FROM employee_role_assignments WHERE tenant_id = $1 AND employee_id = $2',
    [admin.tenantId, manager.id],
  );
  await pool.query('DELETE FROM employee_role_assignments WHERE tenant_id = $1 AND employee_id = $2', [admin.tenantId, manager.id]);
  await expectStatus('Permission-revoked reviewer is rejected at handoff time', 422, api(`/api/hiring/applicants/${applicantId}/handoff`, admin, {
    method: 'POST', body: JSON.stringify({ reviewerId: manager.id }),
  }));
  for (const assignment of managerAssignments.rows) {
    await pool.query(
      'INSERT INTO employee_role_assignments (tenant_id, employee_id, role_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [admin.tenantId, manager.id, assignment.role_id],
    );
  }
  const managerCountAfter = await api('/api/dashboard/attention-counts', manager);
  assert(Number(managerCountAfter.body.counts?.hiring) >= Number(managerCountBefore.body.counts?.hiring), 'Hiring attention count did not reflect recipient work.');

  await expectStatus('Unassigned employee cannot acknowledge a handoff', 403, api(`/api/hiring/handoffs/${handoff.handoff.id}/acknowledge`, employee, { method: 'POST' }));
  await expectStatus('Recipient acknowledges handoff', 200, api(`/api/hiring/handoffs/${handoff.handoff.id}/acknowledge`, manager, { method: 'POST' }));
  await expectStatus('Repeated acknowledgement is idempotent', 200, api(`/api/hiring/handoffs/${handoff.handoff.id}/acknowledge`, manager, { method: 'POST' }));

  for (const [from, target] of [['hr_review', 'hiring_manager_review'], ['hiring_manager_review', 'interview'], ['interview', 'final_review']] as const) {
    await expectStatus(`${from} advances to ${target}`, 200, api(`/api/hiring/applicants/${applicantId}/stage`, manager, {
      method: 'POST', body: JSON.stringify({ targetStage: target, expectedCurrentStage: from }),
    }));
  }
  await expectStatus('Final transition requires final-decision permission', 403, api(`/api/hiring/applicants/${applicantId}/stage`, manager, {
    method: 'POST', body: JSON.stringify({ targetStage: 'offer', expectedCurrentStage: 'final_review' }),
  }));
  await expectStatus('HR final-decision transition succeeds', 200, api(`/api/hiring/applicants/${applicantId}/stage`, admin, {
    method: 'POST', body: JSON.stringify({ targetStage: 'offer', expectedCurrentStage: 'final_review' }),
  }));

  const verification = await pool.query<JsonObject>(`
    SELECT
      (SELECT count(*)::int FROM hiring_stage_history WHERE tenant_id=$1 AND applicant_id=$2::uuid) AS history_count,
      (SELECT count(*)::int FROM audit_logs WHERE (tenant_id=$1 AND metadata->>'applicantId'=$2::text) OR (tenant_id=$1 AND entity_id=$2::uuid)) AS audit_count,
      (SELECT count(*)::int FROM outbox_events WHERE tenant_id=$1 AND payload->>'applicantId'=$2::text) AS outbox_count,
      (SELECT count(*)::int FROM outbox_events WHERE tenant_id=$1 AND event_type='hiring.handoff.acknowledged' AND payload->>'handoffId'=$3) AS acknowledge_events
  `, [admin.tenantId, applicantId, handoff.handoff.id]);
  const verified = verification.rows[0];
  assert(verified.history_count >= 6, 'Stage history was not recorded.');
  assert(verified.audit_count >= 8, 'Hiring audit records were not recorded.');
  assert(verified.outbox_count >= 7, 'Hiring outbox records were not recorded.');
  assert(verified.acknowledge_events === 1, 'Repeated acknowledgement emitted duplicate outbox events.');
  pass('History, audit, and idempotent outbox records are present');

  const rlsPolicies = await pool.query<{ table_name: string }>(`
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_policy p ON p.polrelid=c.oid
    WHERE c.relname = ANY($1::text[])
      AND c.relrowsecurity=true
      AND pg_get_expr(p.polqual,p.polrelid) LIKE '%app.current_tenant%'
      AND pg_get_expr(p.polwithcheck,p.polrelid) LIKE '%app.current_tenant%'
  `, [['hiring_applicants', 'hiring_applicant_notes', 'hiring_handoffs', 'hiring_stage_history']]);
  assert(new Set(rlsPolicies.rows.map((row) => row.table_name)).size === 4, 'One or more Hiring tables lack tenant RLS policy enforcement.');
  pass('All Hiring tables have app.current_tenant RLS policies');

  const otherTenantFixture = await setupOtherTenantHiringFixture(pool);
  try {
    assert(otherTenantFixture.tenantId !== admin.tenantId, 'Cross-tenant fixture belongs to the primary tenant.');
    const otherTenantSession = await login(otherTenantFixture.email);
    await expectStatus('Other tenant cannot read applicant', 404, api(`/api/hiring/applicants/${applicantId}`, otherTenantSession));
  } finally {
    await cleanupOtherTenantHiringFixture(pool, otherTenantFixture.tenantId);
  }

  await expectStatus('Applicant soft archive succeeds', 200, api(`/api/hiring/applicants/${applicantId}/archive`, admin, { method: 'POST' }));
  const archivedDetail = await expectStatus('Archive preserves notes and history', 200, api(`/api/hiring/applicants/${applicantId}`, admin));
  assert(archivedDetail.applicant.status === 'archived' && archivedDetail.notes.length >= 2 && archivedDetail.stageHistory.length >= 6, 'Archive removed workflow records.');
  const activeList = await api(`/api/hiring/applicants?search=${encodeURIComponent(runId)}`, admin);
  assert(!activeList.body.applicants.some((applicant: JsonObject) => applicant.id === applicantId), 'Archived applicant remains in default active list.');
  pass('Archived applicant is excluded from default active list');

  const finalManagerCount = await api('/api/dashboard/attention-counts', manager);
  assert(Number(finalManagerCount.body.counts?.hiring) <= Number(managerCountAfter.body.counts?.hiring), 'Hiring attention count did not clear after archive.');
  pass('Hiring attention count clears actionable archived work');

  console.log(`\nCompleted ${passed.length} Hiring integration checks.`);
  await pool.end();
}

main().catch(async (error) => {
  console.error(`\nFAIL  ${error instanceof Error ? error.message : String(error)}`);
  try { await getDbPool().end(); } catch { /* no-op */ }
  process.exitCode = 1;
});
