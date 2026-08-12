BEGIN;

CREATE TABLE IF NOT EXISTS roster_goals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL,
  created_by UUID NOT NULL,
  updated_by UUID,
  team_id UUID,
  roster_week_start DATE NOT NULL,
  due_date DATE,
  title VARCHAR(240) NOT NULL,
  description TEXT,
  priority VARCHAR(20) NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high')),
  status VARCHAR(30) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  completion_note TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT roster_goals_id_tenant_unique UNIQUE (id, tenant_id),
  CONSTRAINT roster_goals_employee_tenant_fk FOREIGN KEY (employee_id, tenant_id)
    REFERENCES employees(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT roster_goals_created_by_tenant_fk FOREIGN KEY (created_by, tenant_id)
    REFERENCES employees(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT roster_goals_updated_by_tenant_fk FOREIGN KEY (updated_by, tenant_id)
    REFERENCES employees(id, tenant_id) ON DELETE SET NULL (updated_by),
  CONSTRAINT roster_goals_team_tenant_fk FOREIGN KEY (team_id, tenant_id)
    REFERENCES organisation_teams(id, tenant_id) ON DELETE SET NULL (team_id),
  CONSTRAINT roster_goals_week_monday_chk
    CHECK (EXTRACT(ISODOW FROM roster_week_start) = 1),
  CONSTRAINT roster_goals_due_week_chk
    CHECK (due_date IS NULL OR due_date BETWEEN roster_week_start AND roster_week_start + 6),
  CONSTRAINT roster_goals_completion_chk
    CHECK ((status = 'completed' AND completed_at IS NOT NULL) OR (status <> 'completed' AND completed_at IS NULL))
);

CREATE INDEX IF NOT EXISTS roster_goals_tenant_employee_week_idx
  ON roster_goals(tenant_id, employee_id, roster_week_start, status);

CREATE INDEX IF NOT EXISTS roster_goals_tenant_team_week_idx
  ON roster_goals(tenant_id, team_id, roster_week_start, status)
  WHERE team_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS roster_goals_open_carry_forward_idx
  ON roster_goals(tenant_id, employee_id, roster_week_start)
  WHERE status IN ('pending', 'in_progress');

ALTER TABLE roster_goals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS roster_goals_tenant_isolation ON roster_goals;
CREATE POLICY roster_goals_tenant_isolation ON roster_goals
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

INSERT INTO tenant_permissions(permission_key, label, description) VALUES
  ('roster.goals.view_self', 'View own roster goals', 'View personal weekly roster goals and tasks.'),
  ('roster.goals.view_scoped', 'View scoped roster goals', 'View weekly roster goals for employees in an authorised scope.'),
  ('roster.goals.manage', 'Manage roster goals', 'Assign and manage weekly roster goals within an authorised scope.'),
  ('roster.goals.complete_self', 'Complete own roster goals', 'Update progress and complete personal weekly roster goals.')
ON CONFLICT (permission_key) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description;

INSERT INTO tenant_role_permissions(tenant_id, role_id, permission_key)
SELECT role.tenant_id, role.id, seed.permission_key
FROM tenant_roles role
JOIN (VALUES
  ('employee', 'roster.goals.view_self'),
  ('employee', 'roster.goals.complete_self'),
  ('manager', 'roster.goals.view_self'),
  ('manager', 'roster.goals.complete_self'),
  ('manager', 'roster.goals.view_scoped'),
  ('manager', 'roster.goals.manage')
) AS seed(system_key, permission_key) ON seed.system_key = role.system_key
WHERE role.is_active = true
ON CONFLICT (tenant_id, role_id, permission_key) DO NOTHING;

INSERT INTO tenant_role_permissions(tenant_id, role_id, permission_key)
SELECT role.tenant_id, role.id, permission.permission_key
FROM tenant_roles role
CROSS JOIN tenant_permissions permission
WHERE role.system_key = 'hr_admin'
  AND role.is_active = true
  AND permission.permission_key LIKE 'roster.goals.%'
ON CONFLICT (tenant_id, role_id, permission_key) DO NOTHING;

COMMIT;
