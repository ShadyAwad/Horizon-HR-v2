import 'dotenv/config';
import bcrypt from 'bcryptjs';
import type { PoolClient } from 'pg';
import { getDbPool } from '../src/lib/hr-background';

const DEMO = {
  companyName: 'Stanza Demo Company',
  slug: 'stanza-demo',
  password: 'StrongPass!123',
  latitude: 30.0444,
  longitude: 31.2357,
  radiusMeters: 300,
} as const;

const permissions = [
  ['locations.read', 'Read locations', 'View company locations.'],
  ['locations.manage', 'Manage locations', 'Create and update company locations and geofences.'],
  ['attendance.clock', 'Clock attendance', 'Clock in and out.'],
  ['attendance.view', 'View attendance', 'View attendance records and summaries.'],
  ['break_requests.create', 'Create break requests', 'Request manager approval for breaks.'],
  ['break_requests.view_own', 'View own break requests', 'View personal break request history.'],
  ['break_requests.review', 'Review break requests', 'Approve or reject pending break requests.'],
  ['break_requests.view_all', 'View all break requests', 'View tenant break request queues.'],
  ['leave.create', 'Create leave requests', 'Create and view personal leave requests.'],
  ['leave.review', 'Review leave requests', 'Review tenant leave requests.'],
  ['payroll.view_self', 'View own payroll', 'View personal payroll records.'],
  ['payroll.view_all', 'View all payroll', 'View tenant payroll records.'],
  ['payroll.run', 'Run payroll', 'Generate tenant payroll.'],
  ['payroll.approve', 'Approve payroll', 'Approve or cancel payroll records.'],
  ['payroll.mark_paid', 'Mark payroll paid', 'Mark approved payroll as paid.'],
  ['payroll.export_pdf', 'Export payroll PDF', 'Export payroll statements as PDF.'],
  ['compensation.manage', 'Manage compensation', 'Create and update compensation profiles.'],
  ['loans.view_self', 'View own loans', 'View personal employee loans.'],
  ['loans.manage', 'Manage loans', 'Create and update employee loans.'],
  ['grievances.create', 'Create grievances', 'File grievance cases.'],
  ['grievances.review', 'Review grievances', 'Review tenant grievance cases.'],
  ['feed.read', 'Read company feed', 'Read company feed posts.'],
  ['feed.publish', 'Publish company feed', 'Create and manage company feed posts.'],
  ['roles.manage', 'Manage roles', 'Manage tenant roles, permissions, and employee titles.'],
] as const;

const rolePermissions: Record<'employee' | 'manager', string[]> = {
  employee: [
    'locations.read', 'attendance.clock', 'break_requests.create', 'break_requests.view_own',
    'leave.create', 'payroll.view_self', 'payroll.export_pdf', 'loans.view_self',
    'grievances.create', 'feed.read',
  ],
  manager: [
    'locations.read', 'attendance.view', 'break_requests.create', 'break_requests.view_own',
    'break_requests.review', 'break_requests.view_all', 'leave.review', 'payroll.view_self',
    'payroll.export_pdf', 'loans.view_self', 'grievances.review', 'feed.read',
  ],
};

async function seedDemo() {
  const pool = getDbPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const tenantResult = await client.query<{ id: string }>(
      `INSERT INTO tenants (company_name, slug, default_currency, capacity_tier, allows_company_loans)
       VALUES ($1, $2, 'USD', '100-500', true)
       ON CONFLICT (slug) DO UPDATE SET
         company_name = EXCLUDED.company_name,
         default_currency = EXCLUDED.default_currency,
         capacity_tier = EXCLUDED.capacity_tier,
         allows_company_loans = EXCLUDED.allows_company_loans,
         updated_at = NOW()
       RETURNING id`,
      [DEMO.companyName, DEMO.slug],
    );
    const tenantId = tenantResult.rows[0].id;
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);

    await client.query(
      `INSERT INTO tenant_permissions (permission_key, label, description)
       SELECT * FROM UNNEST($1::varchar[], $2::varchar[], $3::text[])
       ON CONFLICT (permission_key) DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description`,
      [permissions.map(([key]) => key), permissions.map(([, label]) => label), permissions.map(([, , description]) => description)],
    );

    await client.query(
      `INSERT INTO tenant_roles (tenant_id, name, description, system_key, is_system)
       VALUES
         ($1, 'Employee', 'Default employee access.', 'employee', true),
         ($1, 'Manager', 'Default manager access.', 'manager', true),
         ($1, 'HR Admin', 'Default HR administrator access.', 'hr_admin', true)
       ON CONFLICT (tenant_id, name) DO UPDATE SET is_active = true, updated_at = NOW()`,
      [tenantId],
    );

    for (const [systemKey, permissionKeys] of Object.entries(rolePermissions)) {
      await client.query(
        `INSERT INTO tenant_role_permissions (tenant_id, role_id, permission_key)
         SELECT $1, roles.id, permission_key
         FROM tenant_roles roles
         CROSS JOIN UNNEST($3::varchar[]) AS permission_key
         WHERE roles.tenant_id = $1 AND roles.system_key = $2
         ON CONFLICT (tenant_id, role_id, permission_key) DO NOTHING`,
        [tenantId, systemKey, permissionKeys],
      );
    }
    await client.query(
      `INSERT INTO tenant_role_permissions (tenant_id, role_id, permission_key)
       SELECT $1, roles.id, permissions.permission_key
       FROM tenant_roles roles
       CROSS JOIN tenant_permissions permissions
       WHERE roles.tenant_id = $1 AND roles.system_key = 'hr_admin'
       ON CONFLICT (tenant_id, role_id, permission_key) DO NOTHING`,
      [tenantId],
    );

    const passwordHash = bcrypt.hashSync(DEMO.password, 12);
    const admin = await upsertEmployee(client, tenantId, 'Shady Awad', 'admin@stanza-demo.com', passwordHash, 'hr_admin', 'HR Administrator');
    const manager = await upsertEmployee(client, tenantId, 'Demo Manager', 'manager@stanza-demo.com', passwordHash, 'manager', 'Operations Manager');
    const employee = await upsertEmployee(client, tenantId, 'Demo Employee', 'employee@stanza-demo.com', passwordHash, 'employee', 'Operations Associate', manager.id);

    await client.query(
      `UPDATE employees SET manager_id = $3, updated_at = NOW()
       WHERE id = $2 AND tenant_id = $1`,
      [tenantId, manager.id, admin.id],
    );

    for (const user of [admin, manager, employee]) {
      await client.query(
        `INSERT INTO employee_role_assignments (tenant_id, employee_id, role_id, assigned_by)
         SELECT $1, $2, id, $3
         FROM tenant_roles
         WHERE tenant_id = $1 AND system_key = $4
         ON CONFLICT (tenant_id, employee_id, role_id) DO NOTHING`,
        [tenantId, user.id, admin.id, user.role],
      );
    }

    const updatedLocation = await client.query(
      `UPDATE company_locations SET location_type = 'headquarters', address = 'Cairo demo worksite',
          latitude = $3::numeric, longitude = $4::numeric, radius_meters = $5::integer,
          boundary = ST_Buffer(ST_SetSRID(ST_MakePoint($4::double precision, $3::double precision), 4326)::geography, ($5::integer)::double precision)::geometry,
         is_primary = true, is_active = true, updated_at = NOW()
       WHERE tenant_id = $1 AND name = $2`,
      [tenantId, 'Headquarters', DEMO.latitude, DEMO.longitude, DEMO.radiusMeters],
    );
    if (updatedLocation.rowCount === 0) {
      await client.query(
        `INSERT INTO company_locations (
           tenant_id, name, location_type, address, latitude, longitude, radius_meters, boundary, is_primary, is_active
         ) VALUES (
           $1, 'Headquarters', 'headquarters', 'Cairo demo worksite', $2::numeric, $3::numeric, $4::integer,
           ST_Buffer(ST_SetSRID(ST_MakePoint($3::double precision, $2::double precision), 4326)::geography, ($4::integer)::double precision)::geometry,
           true, true
         )`,
        [tenantId, DEMO.latitude, DEMO.longitude, DEMO.radiusMeters],
      );
    }
    await client.query(
      `INSERT INTO geofences (tenant_id, name, boundary)
       SELECT $1, 'Headquarters', ST_Buffer(ST_SetSRID(ST_MakePoint($3::double precision, $2::double precision), 4326)::geography, ($4::integer)::double precision)::geometry
       WHERE NOT EXISTS (SELECT 1 FROM geofences WHERE tenant_id = $1 AND name = 'Headquarters')`,
      [tenantId, DEMO.latitude, DEMO.longitude, DEMO.radiusMeters],
    );

    await client.query(
      `INSERT INTO company_feed_posts (tenant_id, author_employee_id, title, post_type, content_text, content_json, status)
       SELECT $1, $2, 'Welcome to Stanza Demo', 'announcement',
         'Welcome to the Stanza demo workspace. Explore attendance, payroll, requests, and team communication using fictional data.',
         $3::jsonb, 'published'
       WHERE NOT EXISTS (SELECT 1 FROM company_feed_posts WHERE tenant_id = $1 AND title = 'Welcome to Stanza Demo')`,
      [tenantId, admin.id, JSON.stringify({ root: { children: [{ type: 'paragraph', children: [{ text: 'Welcome to the Stanza demo workspace.' }] }] } })],
    );
    await client.query(
      `INSERT INTO grievances (tenant_id, employee_id, assigned_to, title, description, category, priority, status)
       SELECT $1, $2, $3, 'Demo workplace question', 'This fictional sample grievance demonstrates the review workflow.', 'general', 'normal', 'under_review'
       WHERE NOT EXISTS (SELECT 1 FROM grievances WHERE tenant_id = $1 AND title = 'Demo workplace question')`,
      [tenantId, employee.id, admin.id],
    );
    await client.query(
      `INSERT INTO break_requests (tenant_id, employee_id, requested_start_time, requested_end_time, duration_minutes, reason, status)
       SELECT $1, $2, NOW() + INTERVAL '1 hour', NOW() + INTERVAL '75 minutes', 15, 'Demo break request', 'pending'
       WHERE NOT EXISTS (SELECT 1 FROM break_requests WHERE tenant_id = $1 AND employee_id = $2 AND status = 'pending')`,
      [tenantId, employee.id],
    );
    await client.query(
      `INSERT INTO employee_compensation_profiles (tenant_id, employee_id, pay_type, base_amount, currency, effective_from, is_active, created_by, updated_by)
       VALUES ($1, $2, 'monthly', 2500.00, 'USD', CURRENT_DATE, true, $3, $3)
       ON CONFLICT (tenant_id, employee_id) WHERE is_active DO UPDATE SET
         pay_type = EXCLUDED.pay_type, base_amount = EXCLUDED.base_amount, currency = EXCLUDED.currency,
         updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [tenantId, employee.id, admin.id],
    );

    await client.query('COMMIT');
    console.log('Stanza demo seed completed.');
    console.log(`Admin:    admin@stanza-demo.com / ${DEMO.password}`);
    console.log(`Manager:  manager@stanza-demo.com / ${DEMO.password}`);
    console.log(`Employee: employee@stanza-demo.com / ${DEMO.password}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function upsertEmployee(
  client: PoolClient,
  tenantId: string,
  fullName: string,
  email: string,
  passwordHash: string,
  role: 'hr_admin' | 'manager' | 'employee',
  jobTitle: string,
  managerId: string | null = null,
) {
  const result = await client.query<{ id: string; role: 'hr_admin' | 'manager' | 'employee' }>(
    `INSERT INTO employees (tenant_id, full_name, email, password_hash, role, job_title, manager_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (email, tenant_id) DO UPDATE SET
       full_name = EXCLUDED.full_name, password_hash = EXCLUDED.password_hash, role = EXCLUDED.role,
       job_title = EXCLUDED.job_title, manager_id = EXCLUDED.manager_id, updated_at = NOW()
     RETURNING id, role`,
    [tenantId, fullName, email, passwordHash, role, jobTitle, managerId],
  );
  return result.rows[0];
}

seedDemo().catch((error) => {
  console.error('Failed to seed Stanza demo:', error);
  process.exitCode = 1;
});
