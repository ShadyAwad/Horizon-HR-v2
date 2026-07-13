BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE leave_requests
ADD COLUMN IF NOT EXISTS leave_type VARCHAR(50) NOT NULL DEFAULT 'annual';

CREATE INDEX IF NOT EXISTS leave_requests_roster_conflict_idx
ON leave_requests(tenant_id, employee_id, status, leave_type, start_date, end_date);

CREATE TABLE IF NOT EXISTS roster_shifts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL,
    created_by UUID NOT NULL,
    updated_by UUID,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled')),
    notes TEXT,
    override_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    override_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT roster_shifts_employee_tenant_fk FOREIGN KEY (employee_id, tenant_id)
        REFERENCES employees(id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT roster_shifts_created_by_tenant_fk FOREIGN KEY (created_by, tenant_id)
        REFERENCES employees(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT roster_shifts_updated_by_tenant_fk FOREIGN KEY (updated_by, tenant_id)
        REFERENCES employees(id, tenant_id) ON DELETE SET NULL,
    CONSTRAINT roster_shifts_time_order_chk CHECK (end_time > start_time),
    CONSTRAINT roster_shifts_override_reason_chk CHECK (cardinality(override_codes) = 0 OR length(trim(COALESCE(override_reason, ''))) > 0)
);

CREATE INDEX IF NOT EXISTS roster_shifts_tenant_employee_time_idx
ON roster_shifts(tenant_id, employee_id, start_time, end_time);

CREATE INDEX IF NOT EXISTS roster_shifts_tenant_start_idx
ON roster_shifts(tenant_id, start_time);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roster_shifts_no_overlap') THEN
        ALTER TABLE roster_shifts
        ADD CONSTRAINT roster_shifts_no_overlap
        EXCLUDE USING gist (tenant_id WITH =, employee_id WITH =, tstzrange(start_time, end_time, '[)') WITH &&)
        WHERE (status = 'scheduled');
    END IF;
END $$;

ALTER TABLE roster_shifts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS roster_shifts_tenant_isolation ON roster_shifts;
CREATE POLICY roster_shifts_tenant_isolation ON roster_shifts
USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID)
WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID);

INSERT INTO tenant_permissions (permission_key, label, description)
VALUES
  ('roster.view_all', 'View tenant rosters', 'View roster shifts for employees in the tenant.'),
  ('roster.manage', 'Manage rosters', 'Create, update, cancel, and override roster shifts.')
ON CONFLICT (permission_key) DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description;

INSERT INTO tenant_role_permissions (tenant_id, role_id, permission_key)
SELECT tenant_roles.tenant_id, tenant_roles.id, permission_seed.permission_key
FROM tenant_roles
JOIN (VALUES
  ('manager', 'roster.view_all'),
  ('manager', 'roster.manage')
) AS permission_seed(system_key, permission_key)
  ON permission_seed.system_key = tenant_roles.system_key
ON CONFLICT (tenant_id, role_id, permission_key) DO NOTHING;

INSERT INTO tenant_role_permissions (tenant_id, role_id, permission_key)
SELECT tenant_roles.tenant_id, tenant_roles.id, tenant_permissions.permission_key
FROM tenant_roles CROSS JOIN tenant_permissions
WHERE tenant_roles.system_key = 'hr_admin'
  AND tenant_permissions.permission_key IN ('roster.view_all', 'roster.manage')
ON CONFLICT (tenant_id, role_id, permission_key) DO NOTHING;

COMMIT;
