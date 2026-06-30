
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- =========================================================
-- 1. Tenants Table
-- =========================================================

CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug VARCHAR(255) UNIQUE NOT NULL,
    company_name VARCHAR(255) NOT NULL,
    default_currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    capacity_tier VARCHAR(50) NOT NULL DEFAULT '100-500',
    allows_company_loans BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX tenants_slug_idx
ON tenants(slug);

-- =========================================================
-- 2. Employees Table
-- =========================================================

CREATE TABLE employees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- Nullable so top-level bosses can exist
    manager_id UUID REFERENCES employees(id) ON DELETE SET NULL,

    email VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,

    role VARCHAR(50) NOT NULL DEFAULT 'employee'
        CHECK (role IN ('employee', 'manager', 'hr_admin')),

    job_title VARCHAR(120),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Needed so child tables can enforce tenant-safe composite FKs
    UNIQUE (id, tenant_id)
);

CREATE UNIQUE INDEX employees_email_tenant_idx
ON employees(email, tenant_id);

CREATE INDEX employees_tenant_manager_idx
ON employees(tenant_id, manager_id);

ALTER TABLE employees
ADD COLUMN IF NOT EXISTS job_title VARCHAR(120);

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

CREATE POLICY employee_tenant_isolation
ON employees
USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
)
WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
);

-- =========================================================
-- 2a. Tenant Roles & Permission Foundations
-- =========================================================

CREATE TABLE IF NOT EXISTS tenant_roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    name VARCHAR(100) NOT NULL,
    description TEXT,

    system_key VARCHAR(50),
    is_system BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT tenant_roles_name_not_empty CHECK (length(trim(name)) > 0),
    CONSTRAINT tenant_roles_system_key_check CHECK (
        system_key IS NULL OR system_key IN ('employee', 'manager', 'hr_admin')
    ),
    CONSTRAINT tenant_roles_unique_name_per_tenant UNIQUE (tenant_id, name)
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_roles_unique_system_key_idx
ON tenant_roles(tenant_id, system_key)
WHERE system_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS tenant_roles_tenant_active_idx
ON tenant_roles(tenant_id, is_active);

CREATE INDEX IF NOT EXISTS tenant_roles_tenant_system_key_idx
ON tenant_roles(tenant_id, system_key);

ALTER TABLE tenant_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_roles_tenant_isolation ON tenant_roles;

CREATE POLICY tenant_roles_tenant_isolation
ON tenant_roles
USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
)
WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
);

CREATE TABLE IF NOT EXISTS tenant_permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    permission_key VARCHAR(120) NOT NULL UNIQUE,
    label VARCHAR(160) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_role_permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES tenant_roles(id) ON DELETE CASCADE,
    permission_key VARCHAR(120) NOT NULL REFERENCES tenant_permissions(permission_key) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT tenant_role_permissions_unique_rule UNIQUE (tenant_id, role_id, permission_key)
);

CREATE INDEX IF NOT EXISTS tenant_role_permissions_tenant_role_idx
ON tenant_role_permissions(tenant_id, role_id);

CREATE INDEX IF NOT EXISTS tenant_role_permissions_tenant_permission_idx
ON tenant_role_permissions(tenant_id, permission_key);

ALTER TABLE tenant_role_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_role_permissions_tenant_isolation ON tenant_role_permissions;

CREATE POLICY tenant_role_permissions_tenant_isolation
ON tenant_role_permissions
USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
)
WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
);

CREATE TABLE IF NOT EXISTS employee_role_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL,
    role_id UUID NOT NULL REFERENCES tenant_roles(id) ON DELETE CASCADE,
    assigned_by UUID REFERENCES employees(id) ON DELETE SET NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT employee_role_assignments_unique_rule UNIQUE (tenant_id, employee_id, role_id),

    CONSTRAINT employee_role_assignments_employee_tenant_fk
        FOREIGN KEY (employee_id, tenant_id)
        REFERENCES employees(id, tenant_id)
        ON DELETE CASCADE
);

DROP INDEX IF EXISTS employee_role_assignments_one_primary_idx;

CREATE INDEX IF NOT EXISTS employee_role_assignments_tenant_employee_idx
ON employee_role_assignments(tenant_id, employee_id);

CREATE INDEX IF NOT EXISTS employee_role_assignments_tenant_role_idx
ON employee_role_assignments(tenant_id, role_id);

ALTER TABLE employee_role_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employee_role_assignments_tenant_isolation ON employee_role_assignments;

CREATE POLICY employee_role_assignments_tenant_isolation
ON employee_role_assignments
USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
)
WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
);

INSERT INTO tenant_permissions (permission_key, label, description)
VALUES
    ('locations.read', 'Read locations', 'View company locations.'),
    ('locations.manage', 'Manage locations', 'Create and update company locations and geofences.'),
    ('attendance.clock', 'Clock attendance', 'Clock in and out.'),
    ('attendance.view', 'View attendance', 'View attendance records and summaries.'),
    ('leave.create', 'Create leave requests', 'Create and view personal leave requests.'),
    ('leave.review', 'Review leave requests', 'Review tenant leave requests.'),
    ('payroll.view_self', 'View own payroll', 'View personal payroll records.'),
    ('payroll.view_all', 'View all payroll', 'View tenant payroll records.'),
    ('payroll.run', 'Run payroll', 'Generate tenant payroll.'),
    ('payroll.approve', 'Approve payroll', 'Approve or cancel payroll records.'),
    ('payroll.mark_paid', 'Mark payroll paid', 'Mark approved payroll as paid.'),
    ('payroll.export_pdf', 'Export payroll PDF', 'Export payroll statements as PDF.'),
    ('compensation.manage', 'Manage compensation', 'Create and update compensation profiles.'),
    ('loans.view_self', 'View own loans', 'View personal employee loans.'),
    ('loans.manage', 'Manage loans', 'Create and update employee loans.'),
    ('grievances.create', 'Create grievances', 'File grievance cases.'),
    ('grievances.review', 'Review grievances', 'Review tenant grievance cases.'),
    ('feed.read', 'Read company feed', 'Read company feed posts.'),
    ('feed.publish', 'Publish company feed', 'Create and manage company feed posts.'),
    ('roles.manage', 'Manage roles', 'Manage tenant roles, permissions, and employee titles.')
ON CONFLICT (permission_key) DO UPDATE SET
    label = EXCLUDED.label,
    description = EXCLUDED.description;

INSERT INTO tenant_roles (tenant_id, name, description, system_key, is_system)
SELECT tenants.id, role_seed.name, role_seed.description, role_seed.system_key, true
FROM tenants
CROSS JOIN (
    VALUES
        ('Employee', 'Default employee access.', 'employee'),
        ('Manager', 'Default manager access.', 'manager'),
        ('HR Admin', 'Default HR administrator access.', 'hr_admin')
) AS role_seed(name, description, system_key)
ON CONFLICT (tenant_id, name) DO NOTHING;

INSERT INTO tenant_role_permissions (tenant_id, role_id, permission_key)
SELECT tenant_roles.tenant_id, tenant_roles.id, permission_seed.permission_key
FROM tenant_roles
JOIN (
    VALUES
        ('employee', 'locations.read'),
        ('employee', 'attendance.clock'),
        ('employee', 'leave.create'),
        ('employee', 'payroll.view_self'),
        ('employee', 'loans.view_self'),
        ('employee', 'grievances.create'),
        ('employee', 'feed.read'),
        ('manager', 'locations.read'),
        ('manager', 'attendance.view'),
        ('manager', 'leave.review'),
        ('manager', 'payroll.view_self'),
        ('manager', 'loans.view_self'),
        ('manager', 'grievances.review'),
        ('manager', 'feed.read')
) AS permission_seed(system_key, permission_key)
    ON permission_seed.system_key = tenant_roles.system_key
ON CONFLICT (tenant_id, role_id, permission_key) DO NOTHING;

INSERT INTO tenant_role_permissions (tenant_id, role_id, permission_key)
SELECT tenant_roles.tenant_id, tenant_roles.id, tenant_permissions.permission_key
FROM tenant_roles
CROSS JOIN tenant_permissions
WHERE tenant_roles.system_key = 'hr_admin'
ON CONFLICT (tenant_id, role_id, permission_key) DO NOTHING;

INSERT INTO employee_role_assignments (tenant_id, employee_id, role_id)
SELECT employees.tenant_id, employees.id, tenant_roles.id
FROM employees
INNER JOIN tenant_roles
    ON tenant_roles.tenant_id = employees.tenant_id
   AND tenant_roles.system_key = employees.role
ON CONFLICT (tenant_id, employee_id) DO NOTHING;


-- =========================================================
-- 3. Forget Password Tokens Table
-- =========================================================


CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id UUID,

    email VARCHAR(255) NOT NULL,
    recovery_method VARCHAR(30) NOT NULL DEFAULT 'email',

    token_hash TEXT NOT NULL,
    dev_reset_code VARCHAR(12),

    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT password_reset_tokens_employee_tenant_fk
        FOREIGN KEY (employee_id, tenant_id)
        REFERENCES employees(id, tenant_id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_email_idx
ON password_reset_tokens (email);

CREATE INDEX IF NOT EXISTS password_reset_tokens_active_idx
ON password_reset_tokens (email, expires_at)
WHERE used_at IS NULL;

-- =========================================================
-- 4. Geofences / Operating Zones
-- =========================================================

CREATE TABLE geofences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,

    -- Polygon boundary for office / operating zone
    boundary GEOMETRY(Polygon, 4326) NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Spatial index for ST_Contains / ST_Intersects / ST_DWithin-style queries
CREATE INDEX geofences_boundary_gix
ON geofences
USING GIST (boundary);

CREATE INDEX geofences_tenant_idx
ON geofences(tenant_id);

ALTER TABLE geofences ENABLE ROW LEVEL SECURITY;

CREATE POLICY geofence_tenant_isolation
ON geofences
USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
)
WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
);

-- =========================================================
-- 5. Company Locations
-- =========================================================

CREATE TABLE IF NOT EXISTS company_locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    name VARCHAR(255) NOT NULL,
    location_type VARCHAR(50) NOT NULL DEFAULT 'branch',

    address TEXT,

    latitude NUMERIC(10, 7) NOT NULL,
    longitude NUMERIC(10, 7) NOT NULL,
    radius_meters INTEGER NOT NULL DEFAULT 100,

    boundary GEOMETRY(Polygon, 4326) NOT NULL,

    is_primary BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT company_locations_name_not_empty_chk
        CHECK (length(btrim(name)) > 0),

    CONSTRAINT company_locations_radius_chk
        CHECK (radius_meters BETWEEN 25 AND 5000),

    CONSTRAINT company_locations_type_chk
        CHECK (location_type IN ('headquarters', 'branch', 'warehouse', 'remote_site', 'other'))
);

CREATE INDEX IF NOT EXISTS company_locations_tenant_active_idx
ON company_locations(tenant_id, is_active);

CREATE INDEX IF NOT EXISTS company_locations_tenant_primary_idx
ON company_locations(tenant_id, is_primary);

CREATE INDEX IF NOT EXISTS company_locations_boundary_gix
ON company_locations
USING GIST (boundary);

ALTER TABLE company_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_locations_tenant_isolation ON company_locations;

CREATE POLICY company_locations_tenant_isolation
ON company_locations
USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
)
WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
);

-- Existing geofences do not store the original lat/lng/radius, so they are left
-- untouched. New tenants and location management use company_locations.

-- =========================================================
-- 6. Clock-in / Time Logs
-- =========================================================

CREATE TABLE time_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL,

    clock_in_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    clock_out_time TIMESTAMPTZ,

    clock_in_location GEOMETRY(Point, 4326) NOT NULL,
    is_valid_geofence BOOLEAN NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT time_logs_employee_tenant_fk
        FOREIGN KEY (employee_id, tenant_id)
        REFERENCES employees(id, tenant_id)
        ON DELETE CASCADE,

    CONSTRAINT time_logs_clock_order_chk
        CHECK (clock_out_time IS NULL OR clock_out_time > clock_in_time)
);

CREATE INDEX time_logs_tenant_employee_time_idx
ON time_logs(tenant_id, employee_id, clock_in_time DESC);

-- Prevent two open shifts for the same employee in the same tenant
CREATE UNIQUE INDEX time_logs_one_open_shift_per_tenant_idx
ON time_logs(tenant_id, employee_id)
WHERE clock_out_time IS NULL;

ALTER TABLE time_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY time_logs_tenant_isolation
ON time_logs
USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
)
WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
);

-- =========================================================
-- 6. Reporting Chain / Recursive CTE View
-- =========================================================

CREATE OR REPLACE VIEW vw_employee_hierarchy AS
WITH RECURSIVE org_tree AS (
    -- Top-level management
    SELECT
        id,
        tenant_id,
        manager_id,
        full_name,
        1 AS depth_level,
        ARRAY[id] AS reporting_path
    FROM employees
    WHERE manager_id IS NULL

    UNION ALL

    -- Employees reporting into the tree
    SELECT
        e.id,
        e.tenant_id,
        e.manager_id,
        e.full_name,
        ot.depth_level + 1,
        ot.reporting_path || e.id
    FROM employees e
    INNER JOIN org_tree ot
        ON e.manager_id = ot.id
       AND e.tenant_id = ot.tenant_id
)
SELECT *
FROM org_tree;

-- =========================================================
-- 7. Leave Requests
-- =========================================================

CREATE TABLE leave_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL,

    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    reason TEXT NOT NULL,

    status VARCHAR(50) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),

    approved_by UUID REFERENCES employees(id) ON DELETE SET NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT leave_requests_employee_tenant_fk
        FOREIGN KEY (employee_id, tenant_id)
        REFERENCES employees(id, tenant_id)
        ON DELETE CASCADE,

    CONSTRAINT leave_requests_date_order_chk
        CHECK (end_date >= start_date)
);

CREATE INDEX leave_requests_tenant_status_idx
ON leave_requests(tenant_id, status, created_at DESC);

CREATE INDEX leave_requests_tenant_employee_date_idx
ON leave_requests(tenant_id, employee_id, start_date DESC);

ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY leave_requests_tenant_isolation
ON leave_requests
USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
)
WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
);

-- =========================================================
-- 8. Payroll Records
-- =========================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN LATERAL (
            SELECT array_agg(a.attname ORDER BY cols.ordinality) AS column_names
            FROM unnest(c.conkey) WITH ORDINALITY AS cols(attnum, ordinality)
            JOIN pg_attribute a
                ON a.attrelid = c.conrelid
               AND a.attnum = cols.attnum
        ) unique_columns ON true
        WHERE c.conrelid = 'employees'::regclass
          AND c.contype = 'u'
          AND unique_columns.column_names = ARRAY['id', 'tenant_id']::name[]
    ) THEN
        ALTER TABLE employees
        ADD CONSTRAINT employees_id_tenant_unique UNIQUE (id, tenant_id);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS payroll_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL,

    pay_period_start DATE NOT NULL,
    pay_period_end DATE NOT NULL,

    base_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
    bonuses NUMERIC(12,2) NOT NULL DEFAULT 0,
    deductions NUMERIC(12,2) NOT NULL DEFAULT 0,
    net_pay NUMERIC(12,2) NOT NULL DEFAULT 0,

    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    status VARCHAR(30) NOT NULL DEFAULT 'draft',

    generated_by UUID REFERENCES employees(id) ON DELETE SET NULL,
    approved_by UUID REFERENCES employees(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    paid_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT payroll_records_employee_tenant_fk
        FOREIGN KEY (employee_id, tenant_id)
        REFERENCES employees(id, tenant_id)
        ON DELETE CASCADE,

    CONSTRAINT payroll_records_date_order_chk
        CHECK (pay_period_end >= pay_period_start),

    CONSTRAINT payroll_records_status_chk
        CHECK (status IN ('draft', 'approved', 'paid', 'cancelled')),

    UNIQUE (tenant_id, employee_id, pay_period_start, pay_period_end)
);

ALTER TABLE payroll_records
ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES employees(id) ON DELETE SET NULL;

ALTER TABLE payroll_records
ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

ALTER TABLE payroll_records
ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS payroll_records_tenant_period_idx
ON payroll_records(tenant_id, pay_period_start, pay_period_end);

CREATE INDEX IF NOT EXISTS payroll_records_tenant_employee_generated_idx
ON payroll_records(tenant_id, employee_id, generated_at DESC);

ALTER TABLE payroll_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payroll_records_tenant_isolation ON payroll_records;

CREATE POLICY payroll_records_tenant_isolation
ON payroll_records
USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
)
WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
);

-- =========================================================
-- 9. Employee Compensation Profiles
-- =========================================================

CREATE TABLE IF NOT EXISTS employee_compensation_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL,

    pay_type VARCHAR(30) NOT NULL DEFAULT 'monthly',
    base_amount NUMERIC(12,2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',

    effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_to DATE,
    is_active BOOLEAN NOT NULL DEFAULT true,

    created_by UUID REFERENCES employees(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES employees(id) ON DELETE SET NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT employee_compensation_profiles_employee_tenant_fk
        FOREIGN KEY (employee_id, tenant_id)
        REFERENCES employees(id, tenant_id)
        ON DELETE CASCADE,

    CONSTRAINT employee_compensation_profiles_base_amount_chk
        CHECK (base_amount >= 0),

    CONSTRAINT employee_compensation_profiles_pay_type_chk
        CHECK (pay_type IN ('monthly', 'hourly', 'weekly', 'annual')),

    CONSTRAINT employee_compensation_profiles_date_order_chk
        CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS employee_compensation_profiles_one_active_idx
ON employee_compensation_profiles(tenant_id, employee_id)
WHERE is_active = true;

CREATE INDEX IF NOT EXISTS employee_compensation_profiles_tenant_employee_active_idx
ON employee_compensation_profiles(tenant_id, employee_id, is_active);

CREATE INDEX IF NOT EXISTS employee_compensation_profiles_tenant_effective_idx
ON employee_compensation_profiles(tenant_id, effective_from DESC);

CREATE INDEX IF NOT EXISTS employee_compensation_profiles_tenant_pay_type_idx
ON employee_compensation_profiles(tenant_id, pay_type);

ALTER TABLE employee_compensation_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employee_compensation_profiles_tenant_isolation ON employee_compensation_profiles;

CREATE POLICY employee_compensation_profiles_tenant_isolation
ON employee_compensation_profiles
USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
)
WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
);

-- =========================================================
-- 10. Employee Loans
-- =========================================================

CREATE TABLE IF NOT EXISTS employee_loans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL,

    loan_name VARCHAR(160) NOT NULL DEFAULT 'Employee Loan',
    principal_amount NUMERIC(12,2) NOT NULL,
    outstanding_balance NUMERIC(12,2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',

    repayment_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    repayment_frequency VARCHAR(30) NOT NULL DEFAULT 'monthly',

    status VARCHAR(30) NOT NULL DEFAULT 'active',

    issued_at DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE,

    created_by UUID REFERENCES employees(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES employees(id) ON DELETE SET NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT employee_loans_employee_tenant_fk
        FOREIGN KEY (employee_id, tenant_id)
        REFERENCES employees(id, tenant_id)
        ON DELETE CASCADE,

    CONSTRAINT employee_loans_principal_amount_chk
        CHECK (principal_amount > 0),

    CONSTRAINT employee_loans_outstanding_balance_chk
        CHECK (outstanding_balance >= 0),

    CONSTRAINT employee_loans_repayment_amount_chk
        CHECK (repayment_amount >= 0),

    CONSTRAINT employee_loans_status_chk
        CHECK (status IN ('active', 'paid', 'cancelled')),

    CONSTRAINT employee_loans_repayment_frequency_chk
        CHECK (repayment_frequency IN ('monthly', 'weekly', 'one_time'))
);

CREATE INDEX IF NOT EXISTS employee_loans_tenant_employee_status_idx
ON employee_loans(tenant_id, employee_id, status);

CREATE INDEX IF NOT EXISTS employee_loans_tenant_status_created_idx
ON employee_loans(tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS employee_loans_tenant_due_date_idx
ON employee_loans(tenant_id, due_date);

ALTER TABLE employee_loans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employee_loans_tenant_isolation ON employee_loans;

CREATE POLICY employee_loans_tenant_isolation
ON employee_loans
USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
)
WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
);

CREATE TABLE IF NOT EXISTS employee_loan_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    loan_id UUID NOT NULL REFERENCES employee_loans(id) ON DELETE CASCADE,
    payroll_record_id UUID REFERENCES payroll_records(id) ON DELETE SET NULL,
    amount NUMERIC(12,2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT employee_loan_payments_amount_chk
        CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS employee_loan_payments_tenant_loan_idx
ON employee_loan_payments(tenant_id, loan_id, created_at DESC);

CREATE INDEX IF NOT EXISTS employee_loan_payments_tenant_payroll_idx
ON employee_loan_payments(tenant_id, payroll_record_id);

ALTER TABLE employee_loan_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employee_loan_payments_tenant_isolation ON employee_loan_payments;

CREATE POLICY employee_loan_payments_tenant_isolation
ON employee_loan_payments
USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
)
WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
);

-- =========================================================
-- 11. Grievances
-- =========================================================

CREATE TABLE IF NOT EXISTS grievances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL,
    assigned_to UUID REFERENCES employees(id) ON DELETE SET NULL,

    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    category VARCHAR(80) NOT NULL DEFAULT 'general',
    priority VARCHAR(30) NOT NULL DEFAULT 'normal',
    status VARCHAR(30) NOT NULL DEFAULT 'open',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,

    CONSTRAINT grievances_employee_tenant_fk
        FOREIGN KEY (employee_id, tenant_id)
        REFERENCES employees(id, tenant_id)
        ON DELETE CASCADE,

    CONSTRAINT grievances_priority_chk
        CHECK (priority IN ('low', 'normal', 'high', 'urgent')),

    CONSTRAINT grievances_status_chk
        CHECK (status IN ('open', 'under_review', 'resolved', 'rejected', 'closed')),

    CONSTRAINT grievances_title_not_empty_chk
        CHECK (length(btrim(title)) > 0),

    CONSTRAINT grievances_description_not_empty_chk
        CHECK (length(btrim(description)) > 0)
);

CREATE INDEX IF NOT EXISTS grievances_tenant_created_idx
ON grievances(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS grievances_tenant_employee_created_idx
ON grievances(tenant_id, employee_id, created_at DESC);

CREATE INDEX IF NOT EXISTS grievances_tenant_status_created_idx
ON grievances(tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS grievances_tenant_assigned_created_idx
ON grievances(tenant_id, assigned_to, created_at DESC);

ALTER TABLE grievances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS grievances_tenant_isolation ON grievances;

CREATE POLICY grievances_tenant_isolation
ON grievances
USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
)
WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
);

-- =========================================================
-- 12. Company Feed
-- =========================================================

CREATE TABLE IF NOT EXISTS company_feed_posts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    author_employee_id UUID NOT NULL,

    title VARCHAR(200) NOT NULL,
    post_type VARCHAR(40) NOT NULL DEFAULT 'announcement',

    content_text TEXT NOT NULL,
    content_json JSONB,

    event_starts_at TIMESTAMPTZ,
    event_ends_at TIMESTAMPTZ,

    status VARCHAR(30) NOT NULL DEFAULT 'published',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ,

    CONSTRAINT company_feed_posts_author_tenant_fk
        FOREIGN KEY (author_employee_id, tenant_id)
        REFERENCES employees(id, tenant_id)
        ON DELETE CASCADE,

    CONSTRAINT company_feed_posts_title_not_empty_chk
        CHECK (length(btrim(title)) > 0),

    CONSTRAINT company_feed_posts_content_not_empty_chk
        CHECK (length(btrim(content_text)) > 0),

    CONSTRAINT company_feed_posts_type_chk
        CHECK (post_type IN ('announcement', 'event', 'policy_update', 'general')),

    CONSTRAINT company_feed_posts_status_chk
        CHECK (status IN ('draft', 'published', 'archived')),

    CONSTRAINT company_feed_posts_event_order_chk
        CHECK (
            event_starts_at IS NULL
            OR event_ends_at IS NULL
            OR event_ends_at >= event_starts_at
        )
);

CREATE INDEX IF NOT EXISTS company_feed_posts_tenant_status_published_idx
ON company_feed_posts(tenant_id, status, published_at DESC);

CREATE INDEX IF NOT EXISTS company_feed_posts_tenant_type_published_idx
ON company_feed_posts(tenant_id, post_type, published_at DESC);

CREATE INDEX IF NOT EXISTS company_feed_posts_tenant_author_created_idx
ON company_feed_posts(tenant_id, author_employee_id, created_at DESC);

ALTER TABLE company_feed_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_feed_posts_tenant_isolation ON company_feed_posts;

CREATE POLICY company_feed_posts_tenant_isolation
ON company_feed_posts
USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
)
WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
);

CREATE TABLE IF NOT EXISTS company_feed_visibility (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    post_id UUID NOT NULL REFERENCES company_feed_posts(id) ON DELETE CASCADE,

    visibility_type VARCHAR(30) NOT NULL,
    role VARCHAR(50),
    location_id UUID REFERENCES company_locations(id) ON DELETE CASCADE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT company_feed_visibility_type_chk
        CHECK (visibility_type IN ('all', 'role', 'location')),

    CONSTRAINT company_feed_visibility_role_required_chk
        CHECK (visibility_type <> 'role' OR role IS NOT NULL),

    CONSTRAINT company_feed_visibility_location_required_chk
        CHECK (visibility_type <> 'location' OR location_id IS NOT NULL),

    CONSTRAINT company_feed_visibility_role_chk
        CHECK (role IS NULL OR role IN ('employee', 'manager', 'hr_admin'))
);

CREATE UNIQUE INDEX IF NOT EXISTS company_feed_visibility_unique_rule_idx
ON company_feed_visibility(
    tenant_id,
    post_id,
    visibility_type,
    COALESCE(role, ''),
    COALESCE(location_id::text, '')
);

CREATE INDEX IF NOT EXISTS company_feed_visibility_tenant_post_idx
ON company_feed_visibility(tenant_id, post_id);

CREATE INDEX IF NOT EXISTS company_feed_visibility_tenant_type_idx
ON company_feed_visibility(tenant_id, visibility_type);

CREATE INDEX IF NOT EXISTS company_feed_visibility_tenant_role_idx
ON company_feed_visibility(tenant_id, role);

CREATE INDEX IF NOT EXISTS company_feed_visibility_tenant_location_idx
ON company_feed_visibility(tenant_id, location_id);

ALTER TABLE company_feed_visibility ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_feed_visibility_tenant_isolation ON company_feed_visibility;

CREATE POLICY company_feed_visibility_tenant_isolation
ON company_feed_visibility
USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
)
WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
);

-- =========================================================
-- 13. Attendance Daily Summaries
-- Designed for BullMQ / background worker upserts
-- =========================================================

CREATE TABLE attendance_daily_summaries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL,

    work_date DATE NOT NULL,

    first_clock_in TIMESTAMPTZ,
    last_clock_out TIMESTAMPTZ,

    total_minutes INT NOT NULL DEFAULT 0
        CHECK (total_minutes >= 0),

    invalid_geofence_count INT NOT NULL DEFAULT 0
        CHECK (invalid_geofence_count >= 0),

    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT attendance_daily_summaries_employee_tenant_fk
        FOREIGN KEY (employee_id, tenant_id)
        REFERENCES employees(id, tenant_id)
        ON DELETE CASCADE,

    -- Important for idempotent background jobs:
    -- INSERT ... ON CONFLICT (tenant_id, employee_id, work_date) DO UPDATE
    UNIQUE (tenant_id, employee_id, work_date)
);

-- Reporting index for dashboards:
-- "Show all employee summaries for tenant X on date/range Y"
CREATE INDEX attendance_daily_summaries_tenant_date_idx
ON attendance_daily_summaries(tenant_id, work_date DESC);

ALTER TABLE attendance_daily_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY attendance_daily_summaries_tenant_isolation
ON attendance_daily_summaries
USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
)
WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
);

-- =========================================================
-- 14. Audit Logs
-- =========================================================

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- Nullable because actor can be deleted while audit history remains
    actor_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,

    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id UUID,

    metadata JSONB NOT NULL DEFAULT '{}',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX audit_logs_tenant_time_idx
ON audit_logs(tenant_id, created_at DESC);

CREATE INDEX audit_logs_tenant_entity_idx
ON audit_logs(tenant_id, entity_type, entity_id);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_logs_tenant_isolation
ON audit_logs
USING (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
)
WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID
);

CREATE TABLE outbox_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    event_type VARCHAR(100) NOT NULL,

    payload JSONB NOT NULL,

    processed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX outbox_events_unprocessed_idx
ON outbox_events(processed_at)
WHERE processed_at IS NULL;
