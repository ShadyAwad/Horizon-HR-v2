-- Active Session Management: deliberately stores only presentation-safe metadata.
ALTER TABLE auth_sessions
  ADD COLUMN IF NOT EXISTS device_label VARCHAR(160) NOT NULL DEFAULT 'Unknown device',
  ADD COLUMN IF NOT EXISTS ip_masked VARCHAR(64) NOT NULL DEFAULT 'IP unavailable',
  ADD COLUMN IF NOT EXISTS location_label VARCHAR(160) NOT NULL DEFAULT 'Location unavailable';

CREATE INDEX IF NOT EXISTS auth_sessions_tenant_employee_lifecycle_idx
  ON auth_sessions (tenant_id, employee_id, last_used_at DESC)
  WHERE revoked_at IS NULL;

INSERT INTO tenant_permissions (permission_key, label, description)
VALUES ('sessions.manage', 'Manage sessions', 'Manage active sessions for employees in the tenant.')
ON CONFLICT (permission_key) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description;

-- HR Admin receives this tenant capability by default. The session-center route
-- separately enforces HR Admin status so a custom manager role cannot gain it.
INSERT INTO tenant_role_permissions (tenant_id, role_id, permission_key)
SELECT tenant_roles.tenant_id, tenant_roles.id, 'sessions.manage'
FROM tenant_roles
WHERE tenant_roles.system_key = 'hr_admin'
ON CONFLICT (tenant_id, role_id, permission_key) DO NOTHING;
