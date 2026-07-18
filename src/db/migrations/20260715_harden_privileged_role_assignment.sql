BEGIN;

INSERT INTO tenant_permissions (permission_key, label, description)
VALUES (
  'roles.assign_privileged',
  'Assign privileged roles',
  'Assign system administrator and equivalent privileged roles.'
)
ON CONFLICT (permission_key) DO UPDATE
SET label = EXCLUDED.label,
    description = EXCLUDED.description;

INSERT INTO tenant_role_permissions (tenant_id, role_id, permission_key)
SELECT tenant_roles.tenant_id, tenant_roles.id, 'roles.assign_privileged'
FROM tenant_roles
WHERE tenant_roles.system_key = 'hr_admin'
ON CONFLICT (tenant_id, role_id, permission_key) DO NOTHING;

COMMIT;
