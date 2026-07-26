BEGIN;

-- Organisation and access management extends the existing tenant role model.
-- Every composite reference below has a matching parent (id, tenant_id) key.
ALTER TABLE tenant_roles
  ADD CONSTRAINT tenant_roles_id_tenant_unique UNIQUE (id, tenant_id);

ALTER TABLE company_locations
  ADD CONSTRAINT company_locations_id_tenant_unique UNIQUE (id, tenant_id);

CREATE TABLE IF NOT EXISTS organisation_job_titles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL,
  description TEXT,
  level INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT organisation_job_titles_id_tenant_unique UNIQUE (id, tenant_id),
  CONSTRAINT organisation_job_titles_name_unique UNIQUE (tenant_id, name),
  CONSTRAINT organisation_job_titles_name_not_empty CHECK (length(trim(name)) > 0)
);

CREATE TABLE IF NOT EXISTS organisation_departments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL,
  code VARCHAR(60),
  description TEXT,
  department_head_id UUID,
  parent_department_id UUID,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT organisation_departments_id_tenant_unique UNIQUE (id, tenant_id),
  CONSTRAINT organisation_departments_name_unique UNIQUE (tenant_id, name),
  CONSTRAINT organisation_departments_code_unique UNIQUE NULLS NOT DISTINCT (tenant_id, code),
  CONSTRAINT organisation_departments_name_not_empty CHECK (length(trim(name)) > 0),
  CONSTRAINT organisation_departments_not_self_parent CHECK (parent_department_id IS NULL OR parent_department_id <> id),
  CONSTRAINT organisation_departments_head_tenant_fk FOREIGN KEY (department_head_id, tenant_id)
    REFERENCES employees(id, tenant_id) ON DELETE SET NULL (department_head_id),
  CONSTRAINT organisation_departments_parent_tenant_fk FOREIGN KEY (parent_department_id, tenant_id)
    REFERENCES organisation_departments(id, tenant_id) ON DELETE SET NULL (parent_department_id)
);

CREATE TABLE IF NOT EXISTS organisation_teams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  department_id UUID,
  name VARCHAR(160) NOT NULL,
  description TEXT,
  team_lead_id UUID,
  location_id UUID,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT organisation_teams_id_tenant_unique UNIQUE (id, tenant_id),
  CONSTRAINT organisation_teams_name_unique UNIQUE (tenant_id, name),
  CONSTRAINT organisation_teams_name_not_empty CHECK (length(trim(name)) > 0),
  CONSTRAINT organisation_teams_department_tenant_fk FOREIGN KEY (department_id, tenant_id)
    REFERENCES organisation_departments(id, tenant_id) ON DELETE SET NULL (department_id),
  CONSTRAINT organisation_teams_lead_tenant_fk FOREIGN KEY (team_lead_id, tenant_id)
    REFERENCES employees(id, tenant_id) ON DELETE SET NULL (team_lead_id),
  CONSTRAINT organisation_teams_location_tenant_fk FOREIGN KEY (location_id, tenant_id)
    REFERENCES company_locations(id, tenant_id) ON DELETE SET NULL (location_id)
);

CREATE TABLE IF NOT EXISTS organisation_team_memberships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  team_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  membership_type VARCHAR(30) NOT NULL DEFAULT 'member' CHECK (membership_type IN ('member', 'lead')),
  starts_at DATE,
  ends_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT organisation_team_memberships_id_tenant_unique UNIQUE (id, tenant_id),
  CONSTRAINT organisation_team_memberships_date_order CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at >= starts_at),
  CONSTRAINT organisation_team_memberships_team_tenant_fk FOREIGN KEY (team_id, tenant_id)
    REFERENCES organisation_teams(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT organisation_team_memberships_employee_tenant_fk FOREIGN KEY (employee_id, tenant_id)
    REFERENCES employees(id, tenant_id) ON DELETE CASCADE
);

ALTER TABLE employees ADD COLUMN IF NOT EXISTS job_title_id UUID;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS department_id UUID;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS team_id UUID;
ALTER TABLE employees ADD CONSTRAINT employees_job_title_tenant_fk FOREIGN KEY (job_title_id, tenant_id)
  REFERENCES organisation_job_titles(id, tenant_id) ON DELETE SET NULL (job_title_id);
ALTER TABLE employees ADD CONSTRAINT employees_department_tenant_fk FOREIGN KEY (department_id, tenant_id)
  REFERENCES organisation_departments(id, tenant_id) ON DELETE SET NULL (department_id);
ALTER TABLE employees ADD CONSTRAINT employees_team_tenant_fk FOREIGN KEY (team_id, tenant_id)
  REFERENCES organisation_teams(id, tenant_id) ON DELETE SET NULL (team_id);

ALTER TABLE employee_role_assignments ADD COLUMN IF NOT EXISTS scope_type VARCHAR(30) NOT NULL DEFAULT 'company';
ALTER TABLE employee_role_assignments ADD COLUMN IF NOT EXISTS scope_id UUID;
ALTER TABLE employee_role_assignments ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE employee_role_assignments ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
ALTER TABLE employee_role_assignments ADD COLUMN IF NOT EXISTS revoked_by UUID;
ALTER TABLE employee_role_assignments ADD COLUMN IF NOT EXISTS scope_target_key UUID GENERATED ALWAYS AS (COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED;
ALTER TABLE employee_role_assignments ADD CONSTRAINT employee_role_assignments_scope_type_chk
  CHECK (scope_type IN ('company', 'location', 'department', 'team', 'direct_reports', 'self'));
ALTER TABLE employee_role_assignments ADD CONSTRAINT employee_role_assignments_scope_target_chk
  CHECK ((scope_type IN ('company', 'direct_reports', 'self') AND scope_id IS NULL) OR (scope_type IN ('location', 'department', 'team') AND scope_id IS NOT NULL));
ALTER TABLE employee_role_assignments ADD CONSTRAINT employee_role_assignments_role_tenant_fk FOREIGN KEY (role_id, tenant_id)
  REFERENCES tenant_roles(id, tenant_id) ON DELETE CASCADE;
ALTER TABLE employee_role_assignments ADD CONSTRAINT employee_role_assignments_revoked_by_tenant_fk FOREIGN KEY (revoked_by, tenant_id)
  REFERENCES employees(id, tenant_id) ON DELETE SET NULL (revoked_by);
ALTER TABLE employee_role_assignments DROP CONSTRAINT IF EXISTS employee_role_assignments_unique_rule;
CREATE UNIQUE INDEX IF NOT EXISTS employee_role_assignments_active_scope_unique
  ON employee_role_assignments(tenant_id, employee_id, role_id, scope_type, scope_target_key)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS employee_role_assignments_active_scope_idx
  ON employee_role_assignments(tenant_id, employee_id, scope_type, scope_id)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS permission_delegations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  granted_by_employee_id UUID NOT NULL,
  granted_to_employee_id UUID NOT NULL,
  permission_key VARCHAR(120) NOT NULL REFERENCES tenant_permissions(permission_key) ON DELETE RESTRICT,
  scope_type VARCHAR(30) NOT NULL CHECK (scope_type IN ('company', 'location', 'department', 'team', 'direct_reports', 'self')),
  scope_id UUID,
  reason TEXT,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT permission_delegations_id_tenant_unique UNIQUE (id, tenant_id),
  CONSTRAINT permission_delegations_not_self CHECK (granted_by_employee_id <> granted_to_employee_id),
  CONSTRAINT permission_delegations_time_order CHECK (expires_at > starts_at),
  CONSTRAINT permission_delegations_scope_target_chk CHECK ((scope_type IN ('company', 'direct_reports', 'self') AND scope_id IS NULL) OR (scope_type IN ('location', 'department', 'team') AND scope_id IS NOT NULL)),
  CONSTRAINT permission_delegations_granter_tenant_fk FOREIGN KEY (granted_by_employee_id, tenant_id)
    REFERENCES employees(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT permission_delegations_grantee_tenant_fk FOREIGN KEY (granted_to_employee_id, tenant_id)
    REFERENCES employees(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT permission_delegations_revoker_tenant_fk FOREIGN KEY (revoked_by, tenant_id)
    REFERENCES employees(id, tenant_id) ON DELETE SET NULL (revoked_by)
);

CREATE INDEX IF NOT EXISTS organisation_departments_tenant_parent_idx ON organisation_departments(tenant_id, parent_department_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS organisation_teams_tenant_department_idx ON organisation_teams(tenant_id, department_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS organisation_team_memberships_tenant_employee_idx ON organisation_team_memberships(tenant_id, employee_id);
CREATE INDEX IF NOT EXISTS permission_delegations_active_idx ON permission_delegations(tenant_id, granted_to_employee_id, permission_key, expires_at) WHERE status='active' AND revoked_at IS NULL;

ALTER TABLE organisation_job_titles ENABLE ROW LEVEL SECURITY;
ALTER TABLE organisation_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE organisation_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE organisation_team_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE permission_delegations ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['organisation_job_titles','organisation_departments','organisation_teams','organisation_team_memberships','permission_delegations'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_isolation ON %I', table_name, table_name);
    EXECUTE format('CREATE POLICY %I_tenant_isolation ON %I USING (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid)', table_name, table_name);
  END LOOP;
END $$;

INSERT INTO tenant_permissions(permission_key,label,description) VALUES
  ('organisation.view','View organisation','View authorised organisation details.'),
  ('organisation.manage','Manage organisation','Manage company-wide organisation settings.'),
  ('departments.manage','Manage departments','Create and update departments.'),
  ('teams.manage','Manage teams','Create and update teams and memberships.'),
  ('job_titles.manage','Manage job titles','Create and update job titles.'),
  ('roles.view','View roles','View assigned access roles.'),
  ('permissions.manage','Manage permissions','Change custom role permissions.'),
  ('hierarchy.manage','Manage hierarchy','Update reporting lines and employee placement.'),
  ('delegations.manage','Manage delegations','Grant and revoke temporary scoped permissions.'),
  ('roster.propose_changes','Propose roster changes','Propose roster changes within an authorised scope.'),
  ('roster.manage_scoped','Manage scoped rosters','Manage roster shifts within an authorised scope.'),
  ('roster.approve_changes','Approve roster changes','Approve roster changes within an authorised scope.')
ON CONFLICT(permission_key) DO UPDATE SET label=EXCLUDED.label,description=EXCLUDED.description;

INSERT INTO tenant_role_permissions(tenant_id,role_id,permission_key)
SELECT role.tenant_id,role.id,permission.permission_key
FROM tenant_roles role CROSS JOIN tenant_permissions permission
WHERE role.system_key='hr_admin' AND permission.permission_key IN (
  'organisation.view','organisation.manage','departments.manage','teams.manage','job_titles.manage','roles.view','permissions.manage','hierarchy.manage','delegations.manage','roster.propose_changes','roster.manage_scoped','roster.approve_changes'
)
ON CONFLICT DO NOTHING;

COMMIT;
