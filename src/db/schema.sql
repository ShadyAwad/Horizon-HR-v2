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
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    manager_id UUID REFERENCES employees(id) ON DELETE SET NULL, -- Self-referential for org chart
    email VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'employee', -- 'employee', 'manager', 'hr_admin'
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX employees_email_tenant_idx ON employees(email, tenant_id);
CREATE INDEX employees_manager_idx ON employees(manager_id); -- B-Tree for hierarchy lookups

-- Enforce Strict Row-Level Security (RLS)
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY employee_tenant_isolation ON employees
    USING (tenant_id = current_setting('app.current_tenant', true)::UUID);

-- 3. Geofences / Operating Zones (PostGIS Integration)
CREATE TABLE geofences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    boundary GEOMETRY(Polygon, 4326) NOT NULL, -- ST_DWithin & Intersects logic
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- GiST index for ultra-fast spatial querying
CREATE INDEX geofences_boundary_gix ON geofences USING GIST (boundary);

ALTER TABLE geofences ENABLE ROW LEVEL SECURITY;
CREATE POLICY geofence_tenant_isolation ON geofences
    USING (tenant_id = current_setting('app.current_tenant', true)::UUID);

-- 4. Clock-in Logs
CREATE TABLE time_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    clock_in_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    clock_out_time TIMESTAMPTZ,
    clock_in_location GEOMETRY(Point, 4326) NOT NULL,
    is_valid_geofence BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX time_logs_employee_time_idx ON time_logs(employee_id, clock_in_time DESC);

-- 5. Reporting Chain (Recursive CTE View)
CREATE OR REPLACE VIEW vw_employee_hierarchy AS
WITH RECURSIVE org_tree AS (
    -- Base case: Top level management (no manager)
    SELECT 
        id, 
        manager_id, 
        full_name, 
        1 AS depth_level,
        ARRAY[id] AS reporting_path
    FROM employees
    WHERE manager_id IS NULL
    
    UNION ALL
    
    -- Recursive case: Employees reporting to the tree
    SELECT 
        e.id, 
        e.manager_id, 
        e.full_name, 
        ot.depth_level + 1,
        ot.reporting_path || e.id
    FROM employees e
    INNER JOIN org_tree ot ON e.manager_id = ot.id
)
SELECT * FROM org_tree;

-- 6. Leave Requests (Workflow)
CREATE TABLE leave_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    reason TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
    approved_by UUID REFERENCES employees(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
