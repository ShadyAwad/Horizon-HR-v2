import 'dotenv/config';
import bcrypt from 'bcryptjs';
import type { PoolClient } from 'pg';
import { getDbPool } from '../src/lib/hr-background';

const DEMO = {
  companyName: 'Stanza Demo Company',
  slug: 'stanza-demo',
  latitude: 30.0444,
  longitude: 31.2357,
  radiusMeters: 500,
} as const;

function assertDemoMutationSafety() {
  if (process.env.NODE_ENV === 'production') throw new Error('Demo seed is disabled in production.');
  if (process.env.STANZA_DEMO_ENV !== 'true') throw new Error('Set STANZA_DEMO_ENV=true to seed demo data.');
  if (process.env.ALLOW_DEMO_DATA_MUTATION !== 'true') throw new Error('Set ALLOW_DEMO_DATA_MUTATION=true to seed demo data.');

  const rawDatabaseUrl = process.env.DATABASE_URL?.trim();
  if (!rawDatabaseUrl) throw new Error('DATABASE_URL is required for demo seeding.');
  let databaseUrl: URL;
  try {
    databaseUrl = new URL(rawDatabaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL.');
  }
  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\/+/, ''));
  const allowlist = (process.env.DEMO_DATABASE_ALLOWLIST || '').split(',').map((value) => value.trim()).filter(Boolean);
  if (!databaseName || !allowlist.includes(databaseName)) {
    throw new Error('The target database is not in DEMO_DATABASE_ALLOWLIST.');
  }
  const password = process.env.DEMO_PASSWORD?.trim();
  if (!password || password.length < 12) throw new Error('Set DEMO_PASSWORD to a strong demo-only password.');

  console.log(`Demo seed target: ${databaseUrl.hostname}:${databaseUrl.port || '5432'}/${databaseName}`);
  return password;
}

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
  ['resignations.create', 'Create resignation requests', 'Submit resignation requests.'],
  ['resignations.view_own', 'View own resignation requests', 'View personal resignation requests.'],
  ['resignations.view_all', 'View all resignation requests', 'View tenant resignation requests.'],
  ['resignations.review', 'Review resignation requests', 'Approve or reject resignation requests.'],
  ['resignations.process', 'Process resignation requests', 'Mark approved resignation requests as processed.'],
  ['feed.read', 'Read company feed', 'Read company feed posts.'],
  ['feed.publish', 'Publish company feed', 'Create and manage company feed posts.'],
  ['roles.manage', 'Manage roles', 'Manage tenant roles, permissions, and employee titles.'],
] as const;

const rolePermissions: Record<'employee' | 'manager', string[]> = {
  employee: [
    'locations.read', 'attendance.clock', 'break_requests.create', 'break_requests.view_own',
    'leave.create', 'payroll.view_self', 'payroll.export_pdf', 'loans.view_self',
    'grievances.create', 'resignations.create', 'resignations.view_own', 'feed.read',
  ],
  manager: [
    'locations.read', 'attendance.view', 'break_requests.create', 'break_requests.view_own',
    'break_requests.review', 'break_requests.view_all', 'leave.review', 'payroll.view_self',
    'payroll.export_pdf', 'loans.view_self', 'grievances.review', 'resignations.view_all', 'resignations.review', 'feed.read',
  ],
};

type HiringStage =
  | 'new'
  | 'screening'
  | 'hr_review'
  | 'hiring_manager_review'
  | 'interview'
  | 'final_review'
  | 'offer'
  | 'hired'
  | 'rejected';

type HiringDemoCandidate = {
  fullName: string;
  email: string;
  phone: string;
  positionTitle: string;
  department: string;
  source: string;
  stage: HiringStage;
  appliedAt: string;
  owner: 'admin' | 'manager';
  updatedBy?: 'admin' | 'manager';
  history: Array<{
    previousStage: HiringStage | null;
    newStage: HiringStage;
    reason: string;
    occurredAt: string;
    actor: 'admin' | 'manager';
  }>;
  notes: Array<{
    text: string;
    type: 'general' | 'screening' | 'interview' | 'decision' | 'handoff';
    visibility: 'hiring_team' | 'hr_only';
    author: 'admin' | 'manager';
    createdAt: string;
  }>;
};

const hiringDemoCandidates: HiringDemoCandidate[] = [
  {
    fullName: 'Amira Hassan', email: 'amira.hassan@stanza-demo.invalid', phone: '+20 100 000 1001',
    positionTitle: 'People Operations Coordinator', department: 'People', source: 'Stanza Careers', stage: 'new', appliedAt: '2026-07-08T09:00:00.000Z', owner: 'admin',
    history: [{ previousStage: null, newStage: 'new', reason: 'Demo candidate created from the careers page.', occurredAt: '2026-07-08T09:00:00.000Z', actor: 'admin' }],
    notes: [{ text: 'Demo seed: Resume received for the next intake review.', type: 'general', visibility: 'hiring_team', author: 'admin', createdAt: '2026-07-08T09:15:00.000Z' }],
  },
  {
    fullName: 'Karim El Masry', email: 'karim.elmasry@stanza-demo.invalid', phone: '+20 100 000 1002',
    positionTitle: 'Frontend Engineer', department: 'Engineering', source: 'LinkedIn', stage: 'screening', appliedAt: '2026-07-04T09:00:00.000Z', owner: 'admin',
    history: [
      { previousStage: null, newStage: 'new', reason: 'Demo candidate created from LinkedIn.', occurredAt: '2026-07-04T09:00:00.000Z', actor: 'admin' },
      { previousStage: 'new', newStage: 'screening', reason: 'Initial profile matched the frontend opening.', occurredAt: '2026-07-05T10:30:00.000Z', actor: 'admin' },
    ],
    notes: [{ text: 'Demo seed: Screening call is scheduled to review React and accessibility experience.', type: 'screening', visibility: 'hiring_team', author: 'admin', createdAt: '2026-07-05T10:45:00.000Z' }],
  },
  {
    fullName: 'Lina Farouk', email: 'lina.farouk@stanza-demo.invalid', phone: '+20 100 000 1003',
    positionTitle: 'Senior Payroll Analyst', department: 'Finance', source: 'Employee referral', stage: 'hr_review', appliedAt: '2026-06-28T09:00:00.000Z', owner: 'admin',
    history: [
      { previousStage: null, newStage: 'new', reason: 'Demo referral entered into the pipeline.', occurredAt: '2026-06-28T09:00:00.000Z', actor: 'admin' },
      { previousStage: 'new', newStage: 'screening', reason: 'Referral profile met baseline requirements.', occurredAt: '2026-06-29T11:00:00.000Z', actor: 'admin' },
      { previousStage: 'screening', newStage: 'hr_review', reason: 'Move to HR review after a positive screening call.', occurredAt: '2026-07-01T13:00:00.000Z', actor: 'admin' },
    ],
    notes: [{ text: 'Demo seed: Compensation expectations and payroll systems experience are ready for HR review.', type: 'screening', visibility: 'hr_only', author: 'admin', createdAt: '2026-07-01T13:15:00.000Z' }],
  },
  {
    fullName: 'Omar Nabil', email: 'omar.nabil@stanza-demo.invalid', phone: '+20 100 000 1004',
    positionTitle: 'Operations Supervisor', department: 'Operations', source: 'Indeed', stage: 'hiring_manager_review', appliedAt: '2026-06-24T09:00:00.000Z', owner: 'manager', updatedBy: 'admin',
    history: [
      { previousStage: null, newStage: 'new', reason: 'Demo application imported from Indeed.', occurredAt: '2026-06-24T09:00:00.000Z', actor: 'admin' },
      { previousStage: 'new', newStage: 'screening', reason: 'Experience aligns with the operations team.', occurredAt: '2026-06-25T09:30:00.000Z', actor: 'admin' },
      { previousStage: 'screening', newStage: 'hr_review', reason: 'Screening references were positive.', occurredAt: '2026-06-26T14:00:00.000Z', actor: 'admin' },
      { previousStage: 'hr_review', newStage: 'hiring_manager_review', reason: 'Pending manager review handoff.', occurredAt: '2026-06-27T10:00:00.000Z', actor: 'admin' },
    ],
    notes: [{ text: 'Demo seed: Please review shift leadership experience before accepting the handoff.', type: 'handoff', visibility: 'hiring_team', author: 'admin', createdAt: '2026-06-27T10:05:00.000Z' }],
  },
  {
    fullName: 'Salma Youssef', email: 'salma.youssef@stanza-demo.invalid', phone: '+20 100 000 1005',
    positionTitle: 'Product Designer', department: 'Product', source: 'Portfolio referral', stage: 'interview', appliedAt: '2026-06-20T09:00:00.000Z', owner: 'manager', updatedBy: 'manager',
    history: [
      { previousStage: null, newStage: 'new', reason: 'Demo portfolio referral entered into the pipeline.', occurredAt: '2026-06-20T09:00:00.000Z', actor: 'admin' },
      { previousStage: 'new', newStage: 'screening', reason: 'Portfolio quality merited an introductory call.', occurredAt: '2026-06-21T10:00:00.000Z', actor: 'admin' },
      { previousStage: 'screening', newStage: 'hr_review', reason: 'HR screening completed successfully.', occurredAt: '2026-06-23T11:00:00.000Z', actor: 'admin' },
      { previousStage: 'hr_review', newStage: 'hiring_manager_review', reason: 'Handoff to the product hiring manager.', occurredAt: '2026-06-24T11:30:00.000Z', actor: 'admin' },
      { previousStage: 'hiring_manager_review', newStage: 'interview', reason: 'Hiring manager accepted the review and requested interviews.', occurredAt: '2026-06-26T15:00:00.000Z', actor: 'manager' },
    ],
    notes: [{ text: 'Demo seed: Portfolio review highlighted strong workflow and mobile product thinking.', type: 'interview', visibility: 'hiring_team', author: 'manager', createdAt: '2026-06-26T15:10:00.000Z' }],
  },
  {
    fullName: 'Youssef Adel', email: 'youssef.adel@stanza-demo.invalid', phone: '+20 100 000 1006',
    positionTitle: 'Customer Success Lead', department: 'Customer Success', source: 'Recruiter outreach', stage: 'final_review', appliedAt: '2026-06-16T09:00:00.000Z', owner: 'admin', updatedBy: 'manager',
    history: [
      { previousStage: null, newStage: 'new', reason: 'Demo sourced profile added to the pipeline.', occurredAt: '2026-06-16T09:00:00.000Z', actor: 'admin' },
      { previousStage: 'new', newStage: 'screening', reason: 'Candidate accepted the introductory call.', occurredAt: '2026-06-17T10:00:00.000Z', actor: 'admin' },
      { previousStage: 'screening', newStage: 'hr_review', reason: 'HR interview met the role requirements.', occurredAt: '2026-06-18T11:30:00.000Z', actor: 'admin' },
      { previousStage: 'hr_review', newStage: 'hiring_manager_review', reason: 'Assigned for leadership review.', occurredAt: '2026-06-19T13:00:00.000Z', actor: 'admin' },
      { previousStage: 'hiring_manager_review', newStage: 'interview', reason: 'Panel interview approved.', occurredAt: '2026-06-21T10:00:00.000Z', actor: 'manager' },
      { previousStage: 'interview', newStage: 'final_review', reason: 'Panel feedback is complete; final decision required.', occurredAt: '2026-06-23T16:00:00.000Z', actor: 'manager' },
    ],
    notes: [{ text: 'Demo seed: Final decision required. Interview panel recommends proceeding to an offer discussion.', type: 'decision', visibility: 'hr_only', author: 'manager', createdAt: '2026-06-23T16:15:00.000Z' }],
  },
  {
    fullName: 'Noor Ibrahim', email: 'noor.ibrahim@stanza-demo.invalid', phone: '+20 100 000 1007',
    positionTitle: 'Finance Specialist', department: 'Finance', source: 'Stanza Careers', stage: 'offer', appliedAt: '2026-06-12T09:00:00.000Z', owner: 'admin',
    history: [
      { previousStage: null, newStage: 'new', reason: 'Demo careers application received.', occurredAt: '2026-06-12T09:00:00.000Z', actor: 'admin' },
      { previousStage: 'new', newStage: 'screening', reason: 'Minimum finance experience confirmed.', occurredAt: '2026-06-13T09:00:00.000Z', actor: 'admin' },
      { previousStage: 'screening', newStage: 'hr_review', reason: 'Screening call completed.', occurredAt: '2026-06-14T10:30:00.000Z', actor: 'admin' },
      { previousStage: 'hr_review', newStage: 'hiring_manager_review', reason: 'Finance manager review completed.', occurredAt: '2026-06-15T11:30:00.000Z', actor: 'manager' },
      { previousStage: 'hiring_manager_review', newStage: 'interview', reason: 'Technical interview scheduled.', occurredAt: '2026-06-17T11:00:00.000Z', actor: 'manager' },
      { previousStage: 'interview', newStage: 'final_review', reason: 'Interview feedback was favorable.', occurredAt: '2026-06-19T14:00:00.000Z', actor: 'manager' },
      { previousStage: 'final_review', newStage: 'offer', reason: 'Demo offer approved for delivery.', occurredAt: '2026-06-20T15:00:00.000Z', actor: 'admin' },
    ],
    notes: [{ text: 'Demo seed: Offer package is prepared and awaiting the candidate response.', type: 'decision', visibility: 'hr_only', author: 'admin', createdAt: '2026-06-20T15:10:00.000Z' }],
  },
  {
    fullName: 'Tarek Samir', email: 'tarek.samir@stanza-demo.invalid', phone: '+20 100 000 1008',
    positionTitle: 'Warehouse Coordinator', department: 'Operations', source: 'Walk-in referral', stage: 'hired', appliedAt: '2026-06-06T09:00:00.000Z', owner: 'manager', updatedBy: 'admin',
    history: [
      { previousStage: null, newStage: 'new', reason: 'Demo referral recorded.', occurredAt: '2026-06-06T09:00:00.000Z', actor: 'admin' },
      { previousStage: 'new', newStage: 'screening', reason: 'Operations experience verified.', occurredAt: '2026-06-07T09:30:00.000Z', actor: 'admin' },
      { previousStage: 'screening', newStage: 'hr_review', reason: 'HR screening completed.', occurredAt: '2026-06-08T10:30:00.000Z', actor: 'admin' },
      { previousStage: 'hr_review', newStage: 'hiring_manager_review', reason: 'Manager interview requested.', occurredAt: '2026-06-09T10:00:00.000Z', actor: 'admin' },
      { previousStage: 'hiring_manager_review', newStage: 'interview', reason: 'Manager interview completed.', occurredAt: '2026-06-10T11:00:00.000Z', actor: 'manager' },
      { previousStage: 'interview', newStage: 'final_review', reason: 'Interview scorecard approved.', occurredAt: '2026-06-11T10:30:00.000Z', actor: 'manager' },
      { previousStage: 'final_review', newStage: 'offer', reason: 'Offer approved.', occurredAt: '2026-06-12T11:30:00.000Z', actor: 'admin' },
      { previousStage: 'offer', newStage: 'hired', reason: 'Candidate accepted the demo offer.', occurredAt: '2026-06-14T09:00:00.000Z', actor: 'admin' },
    ],
    notes: [{ text: 'Demo seed: Candidate accepted and is ready for the onboarding workflow.', type: 'decision', visibility: 'hiring_team', author: 'admin', createdAt: '2026-06-14T09:10:00.000Z' }],
  },
  {
    fullName: 'Hala Mostafa', email: 'hala.mostafa@stanza-demo.invalid', phone: '+20 100 000 1009',
    positionTitle: 'Talent Acquisition Partner', department: 'People', source: 'Agency partner', stage: 'rejected', appliedAt: '2026-06-08T09:00:00.000Z', owner: 'admin',
    history: [
      { previousStage: null, newStage: 'new', reason: 'Demo agency profile added.', occurredAt: '2026-06-08T09:00:00.000Z', actor: 'admin' },
      { previousStage: 'new', newStage: 'screening', reason: 'Initial experience review completed.', occurredAt: '2026-06-09T09:30:00.000Z', actor: 'admin' },
      { previousStage: 'screening', newStage: 'rejected', reason: 'Role scope and candidate availability did not align.', occurredAt: '2026-06-10T12:00:00.000Z', actor: 'admin' },
    ],
    notes: [{ text: 'Demo seed: Rejection recorded after a respectful screening review.', type: 'decision', visibility: 'hr_only', author: 'admin', createdAt: '2026-06-10T12:10:00.000Z' }],
  },
];

async function seedDemo() {
  const demoPassword = assertDemoMutationSafety();
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

    const passwordHash = bcrypt.hashSync(demoPassword, 12);
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
      `INSERT INTO resignation_requests (
         tenant_id, employee_id, resignation_type, requested_last_working_day, reason, status
       )
       SELECT $1, $2, 'career_change', CURRENT_DATE + 30,
         'Demo resignation request for portfolio workflow testing.', 'pending'
       WHERE NOT EXISTS (
         SELECT 1 FROM resignation_requests
         WHERE tenant_id = $1 AND employee_id = $2 AND status = 'pending'
       )`,
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

    const hiringSeed = await seedHiringDemoData(client, tenantId, admin.id, manager.id);

    await client.query('COMMIT');
    console.log('Stanza demo seed completed.');
    console.log(`Hiring demo: ${hiringSeed.created} candidate record(s) created; ${hiringSeed.total} staged candidates available.`);
    console.log('Demo accounts seeded. Passwords are intentionally omitted from output.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function seedHiringDemoData(
  client: PoolClient,
  tenantId: string,
  adminId: string,
  managerId: string,
) {
  const employeeIdFor = (owner: 'admin' | 'manager') => owner === 'manager' ? managerId : adminId;
  const applicantIds = new Map<string, string>();
  let created = 0;

  for (const candidate of hiringDemoCandidates) {
    const ownerId = employeeIdFor(candidate.owner);
    const updatedById = employeeIdFor(candidate.updatedBy || candidate.owner);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO hiring_applicants (
         tenant_id, full_name, email, phone, position_title, department, source, stage, status,
         current_owner_id, created_by, updated_by, applied_at, created_at, updated_at
       )
       SELECT $1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, $10, $11, $12::timestamptz, $12::timestamptz, $12::timestamptz
       WHERE NOT EXISTS (
         SELECT 1 FROM hiring_applicants WHERE tenant_id = $1 AND lower(email) = lower($3)
       )
       RETURNING id`,
      [tenantId, candidate.fullName, candidate.email, candidate.phone, candidate.positionTitle, candidate.department, candidate.source, candidate.stage, ownerId, adminId, updatedById, candidate.appliedAt],
    );
    if (inserted.rowCount) created += 1;

    const applicant = inserted.rows[0] || (await client.query<{ id: string }>(
      `SELECT id FROM hiring_applicants WHERE tenant_id = $1 AND lower(email) = lower($2) ORDER BY created_at ASC LIMIT 1`,
      [tenantId, candidate.email],
    )).rows[0];
    if (!applicant) throw new Error(`Unable to seed hiring candidate ${candidate.email}.`);
    applicantIds.set(candidate.email, applicant.id);

    await client.query(
      `UPDATE hiring_applicants
       SET full_name = $3, phone = $4, position_title = $5, department = $6, source = $7,
           stage = $8, status = 'active', current_owner_id = $9, created_by = $10, updated_by = $11,
           applied_at = $12::timestamptz, updated_at = $12::timestamptz, archived_at = NULL
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, applicant.id, candidate.fullName, candidate.phone, candidate.positionTitle, candidate.department, candidate.source, candidate.stage, ownerId, adminId, updatedById, candidate.appliedAt],
    );

    for (const history of candidate.history) {
      await client.query(
        `INSERT INTO hiring_stage_history (tenant_id, applicant_id, actor_id, previous_stage, new_stage, reason, created_at)
         SELECT $1, $2, $3, $4, $5, $6, $7::timestamptz
         WHERE NOT EXISTS (
           SELECT 1 FROM hiring_stage_history
           WHERE tenant_id = $1 AND applicant_id = $2
             AND previous_stage IS NOT DISTINCT FROM $4::text
             AND new_stage = $5 AND reason = $6
         )`,
        [tenantId, applicant.id, employeeIdFor(history.actor), history.previousStage, history.newStage, history.reason, history.occurredAt],
      );
    }

    for (const note of candidate.notes) {
      await client.query(
        `INSERT INTO hiring_applicant_notes (tenant_id, applicant_id, author_id, note_text, note_type, visibility, created_at)
         SELECT $1, $2, $3, $4, $5, $6, $7::timestamptz
         WHERE NOT EXISTS (
           SELECT 1 FROM hiring_applicant_notes
           WHERE tenant_id = $1 AND applicant_id = $2 AND note_text = $4 AND deleted_at IS NULL
         )`,
        [tenantId, applicant.id, employeeIdFor(note.author), note.text, note.type, note.visibility, note.createdAt],
      );
    }
  }

  const handoffs = [
    {
      applicantEmail: 'omar.nabil@stanza-demo.invalid',
      fromStage: 'hr_review', toStage: 'hiring_manager_review', status: 'pending',
      message: 'Demo seed: Please accept the Operations Supervisor review and assess shift leadership experience.',
      createdAt: '2026-06-27T10:00:00.000Z', acknowledgedAt: null,
    },
    {
      applicantEmail: 'salma.youssef@stanza-demo.invalid',
      fromStage: 'hiring_manager_review', toStage: 'interview', status: 'acknowledged',
      message: 'Demo seed: Product review accepted; proceed with the structured design interview.',
      createdAt: '2026-06-24T11:30:00.000Z', acknowledgedAt: '2026-06-25T09:15:00.000Z',
    },
  ] as const;

  for (const handoff of handoffs) {
    const applicantId = applicantIds.get(handoff.applicantEmail);
    if (!applicantId) throw new Error(`Unable to seed hiring handoff for ${handoff.applicantEmail}.`);
    await client.query(
      `INSERT INTO hiring_handoffs (
         tenant_id, applicant_id, from_user_id, to_user_id, handed_off_by, from_stage, to_stage,
         message, status, created_at, acknowledged_at
       )
       SELECT $1, $2, $3, $4, $3, $5, $6, $7, $8, $9::timestamptz, $10::timestamptz
       WHERE NOT EXISTS (
         SELECT 1 FROM hiring_handoffs
         WHERE tenant_id = $1 AND applicant_id = $2 AND to_user_id = $4 AND message = $7
       )`,
      [tenantId, applicantId, adminId, managerId, handoff.fromStage, handoff.toStage, handoff.message, handoff.status, handoff.createdAt, handoff.acknowledgedAt],
    );
  }

  return { created, total: hiringDemoCandidates.length };
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
