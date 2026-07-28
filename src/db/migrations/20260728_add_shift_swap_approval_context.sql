BEGIN;

ALTER TABLE shift_swap_requests ADD COLUMN IF NOT EXISTS approver_employee_id UUID;
ALTER TABLE shift_swap_requests ADD COLUMN IF NOT EXISTS approval_source VARCHAR(40);
ALTER TABLE shift_swap_requests ADD COLUMN IF NOT EXISTS approval_scope_type VARCHAR(30);
ALTER TABLE shift_swap_requests ADD COLUMN IF NOT EXISTS approval_scope_id UUID;
ALTER TABLE shift_swap_requests ADD COLUMN IF NOT EXISTS approval_decided_at TIMESTAMPTZ;
ALTER TABLE shift_swap_requests ADD COLUMN IF NOT EXISTS approval_note TEXT;
ALTER TABLE shift_swap_requests ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE shift_swap_requests ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;
ALTER TABLE shift_swap_requests DROP CONSTRAINT IF EXISTS shift_swap_requests_status_check;
ALTER TABLE shift_swap_requests ADD CONSTRAINT shift_swap_requests_status_check CHECK (status IN ('pending_target','target_declined','pending_approval','approved','rejected','cancelled','expired'));
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='shift_swap_requests_approver_tenant_fk') THEN
    ALTER TABLE shift_swap_requests ADD CONSTRAINT shift_swap_requests_approver_tenant_fk FOREIGN KEY (approver_employee_id, tenant_id) REFERENCES employees(id, tenant_id) ON DELETE SET NULL (approver_employee_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS shift_swap_requests_approver_actionable_idx ON shift_swap_requests(tenant_id, approver_employee_id, status) WHERE status='pending_approval';
INSERT INTO tenant_permissions(permission_key, label, description) VALUES
  ('roster.swap.view_scoped', 'View shift swaps', 'View authorised shift swaps.'),
  ('roster.swap.approve', 'Approve shift swaps', 'Approve authorised shift swaps.'),
  ('roster.swap.manage', 'Manage shift swaps', 'Manage shift swaps tenant-wide.')
ON CONFLICT (permission_key) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description;
INSERT INTO tenant_role_permissions(tenant_id,role_id,permission_key)
SELECT role.tenant_id,role.id,permission.permission_key
FROM tenant_roles role
JOIN tenant_permissions permission ON permission.permission_key IN ('roster.swap.view_scoped','roster.swap.approve','roster.swap.manage')
WHERE role.system_key='hr_admin'
ON CONFLICT DO NOTHING;

COMMIT;
