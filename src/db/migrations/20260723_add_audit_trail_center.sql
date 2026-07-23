INSERT INTO tenant_permissions (permission_key, label, description)
VALUES ('audit.view', 'View audit trail', 'View tenant-scoped audit events.')
ON CONFLICT (permission_key) DO UPDATE SET
    label = EXCLUDED.label,
    description = EXCLUDED.description;

INSERT INTO tenant_role_permissions (tenant_id, role_id, permission_key)
SELECT tenant_roles.tenant_id, tenant_roles.id, 'audit.view'
FROM tenant_roles
WHERE tenant_roles.system_key = 'hr_admin'
ON CONFLICT (tenant_id, role_id, permission_key) DO NOTHING;

CREATE INDEX IF NOT EXISTS audit_logs_tenant_action_time_idx
ON audit_logs(tenant_id, action, created_at DESC);
