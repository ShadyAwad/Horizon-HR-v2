-- Horizon HR: Enterprise PostgreSQL Architecture Blueprint
-- Requirements Met: PostGIS via GiST, RLS for multi-tenancy, Recursive CTEs, B-Tree defaults

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- 1. Tenants Table (Multi-tenancy anchor)
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug VARCHAR(255) UNIQUE NOT NULL,
    company_name VARCHAR(255) NOT NULL,
    default_currency VARCHAR(3) DEFAULT 'USD',
    capacity_tier VARCHAR(50) DEFAULT '100-500',
    allows_company_loans BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX tenants_slug_idx ON tenants(slug);

-- 2. Employees Table
CREATE TABLE employees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, 
    manager_id UUID REFERENCES employees(id) ON DELETE SET NULL, -- Kept nullable so top bosses can exist
    email VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'employee'
    CHECK (role IN ('employee', 'manager', 'hr_admin')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX employees_email_tenant_idx ON employees(email, tenant_id);
CREATE INDEX employees_tenant_manager_idx ON employees(tenant_id, manager_id); -- B-Tree for hierarchy lookups

ALTER TABLE employees
ADD CONSTRAINT employees_id_tenant_unique UNIQUE (id, tenant_id);

-- Enforce Strict Row-Level Security (RLS)
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY employee_tenant_isolation ON employees
    USING (tenant_id = current_setting('app.current_tenant', true)::UUID);

-- 3. Geofences / Operating Zones (PostGIS Integration)
CREATE TABLE geofences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    boundary GEOMETRY(Polygon, 4326) NOT NULL, -- ST_DWithin & Intersects logic
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- GiST index for ultra-fast spatial querying
CREATE INDEX geofences_boundary_gix ON geofences USING GIST (boundary);
CREATE INDEX geofences_tenant_idx ON geofences(tenant_id);

ALTER TABLE geofences ENABLE ROW LEVEL SECURITY;
CREATE POLICY geofence_tenant_isolation ON geofences
    USING (tenant_id = current_setting('app.current_tenant', true)::UUID);

-- 4. Clock-in Logs
CREATE TABLE time_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE, -- Added missing column & Made NOT NULL
    clock_in_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    clock_out_time TIMESTAMPTZ,
    clock_in_location GEOMETRY(Point, 4326) NOT NULL,
    is_valid_geofence BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX time_logs_tenant_employee_time_idx
ON time_logs(tenant_id, employee_id, clock_in_time DESC);

ALTER TABLE time_logs
ADD CONSTRAINT time_logs_clock_order_chk
CHECK (clock_out_time IS NULL OR clock_out_time > clock_in_time);

ALTER TABLE time_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY time_logs_tenant_isolation ON time_logs
USING (tenant_id = current_setting('app.current_tenant', true)::UUID);

CREATE UNIQUE INDEX time_logs_one_open_shift_per_tenant_idx
ON time_logs(tenant_id, employee_id)
WHERE clock_out_time IS NULL;

-- 5. Reporting Chain (Recursive CTE View)
CREATE OR REPLACE VIEW vw_employee_hierarchy AS
WITH RECURSIVE org_tree AS (
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
SELECT * FROM org_tree;

-- 6. Leave Requests (Workflow)
CREATE TABLE leave_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    reason TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    CHECK (end_date >= start_date),
    approved_by UUID REFERENCES employees(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX leave_requests_tenant_status_idx
ON leave_requests(tenant_id, status, created_at DESC);

ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY leave_requests_tenant_isolation ON leave_requests
USING (tenant_id = current_setting('app.current_tenant', true)::UUID);

CREATE TABLE attendance_daily_summaries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    work_date DATE NOT NULL,
    first_clock_in TIMESTAMPTZ,
    last_clock_out TIMESTAMPTZ,
    total_minutes INT NOT NULL DEFAULT 0,
    invalid_geofence_count INT NOT NULL DEFAULT 0,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (tenant_id, employee_id, work_date)
);

CREATE INDEX attendance_daily_summaries_tenant_date_idx
ON attendance_daily_summaries(tenant_id, work_date DESC);

ALTER TABLE attendance_daily_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY attendance_daily_summaries_tenant_isolation
ON attendance_daily_summaries
USING (tenant_id = current_setting('app.current_tenant', true)::UUID);

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    actor_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id UUID,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX audit_logs_tenant_time_idx
ON audit_logs(tenant_id, created_at DESC);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_logs_tenant_isolation
ON audit_logs
USING (tenant_id = current_setting('app.current_tenant', true)::UUID);