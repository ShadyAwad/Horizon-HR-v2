
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

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Needed so child tables can enforce tenant-safe composite FKs
    UNIQUE (id, tenant_id)
);

CREATE UNIQUE INDEX employees_email_tenant_idx
ON employees(email, tenant_id);

CREATE INDEX employees_tenant_manager_idx
ON employees(tenant_id, manager_id);

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
-- . Forget Password Tokens Table
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
-- 3. Geofences / Operating Zones
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
-- 4. Clock-in / Time Logs
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
-- 5. Reporting Chain / Recursive CTE View
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
-- 6. Leave Requests
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
-- 7. Attendance Daily Summaries
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
-- 8. Audit Logs
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

