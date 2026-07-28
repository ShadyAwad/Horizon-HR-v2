BEGIN;

-- Extend the existing signup/attendance location model; do not introduce a
-- second location source. Geometry remains the authoritative geofence value.
ALTER TABLE company_locations
  ADD COLUMN IF NOT EXISTS code VARCHAR(60),
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by UUID;

DO $$ BEGIN
  ALTER TABLE company_locations
    ADD CONSTRAINT company_locations_created_by_tenant_fk
    FOREIGN KEY (created_by, tenant_id) REFERENCES employees(id, tenant_id)
    ON DELETE SET NULL (created_by);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS company_locations_active_name_unique
  ON company_locations(tenant_id, lower(name)) WHERE is_active;
CREATE UNIQUE INDEX IF NOT EXISTS company_locations_active_code_unique
  ON company_locations(tenant_id, lower(code)) WHERE is_active AND code IS NOT NULL;
CREATE INDEX IF NOT EXISTS company_locations_archived_idx
  ON company_locations(tenant_id, archived_at DESC);

INSERT INTO tenant_permissions(permission_key, label, description) VALUES
  ('locations.view', 'View locations', 'View authorised company location information.'),
  ('geofences.manage', 'Manage geofences', 'Create and update company geofence boundaries.')
ON CONFLICT (permission_key) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description;

INSERT INTO tenant_role_permissions(tenant_id, role_id, permission_key)
SELECT role.tenant_id, role.id, permission.permission_key
FROM tenant_roles role
JOIN tenant_permissions permission ON permission.permission_key IN ('locations.view', 'locations.manage', 'geofences.manage')
WHERE role.system_key='hr_admin'
ON CONFLICT (tenant_id, role_id, permission_key) DO NOTHING;

COMMIT;
