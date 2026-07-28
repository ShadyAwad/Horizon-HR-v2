BEGIN;

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS approver_employee_id UUID,
  ADD COLUMN IF NOT EXISTS approval_source VARCHAR(40),
  ADD COLUMN IF NOT EXISTS approval_scope_type VARCHAR(30),
  ADD COLUMN IF NOT EXISTS approval_scope_id UUID,
  ADD COLUMN IF NOT EXISTS approval_resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approval_decided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approval_note TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leave_requests_approver_tenant_fk'
  ) THEN
    ALTER TABLE leave_requests
      ADD CONSTRAINT leave_requests_approver_tenant_fk
      FOREIGN KEY (approver_employee_id, tenant_id)
      REFERENCES employees(id, tenant_id) ON DELETE SET NULL (approver_employee_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leave_requests_approval_source_chk'
  ) THEN
    ALTER TABLE leave_requests
      ADD CONSTRAINT leave_requests_approval_source_chk CHECK (
        approval_source IS NULL OR approval_source IN (
          'direct_manager','team_leader','department_head','reporting_chain',
          'scoped_role','delegation','hr_admin'
        )
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leave_requests_approval_scope_chk'
  ) THEN
    ALTER TABLE leave_requests
      ADD CONSTRAINT leave_requests_approval_scope_chk CHECK (
        approval_scope_type IS NULL OR approval_scope_type IN (
          'company','location','department','team','direct_reports','self'
        )
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leave_requests_approval_note_length_chk'
  ) THEN
    ALTER TABLE leave_requests
      ADD CONSTRAINT leave_requests_approval_note_length_chk
      CHECK (approval_note IS NULL OR length(approval_note) <= 1000);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS leave_requests_approver_pending_idx
  ON leave_requests(tenant_id, approver_employee_id, submitted_at DESC)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS leave_requests_pending_actionable_idx
  ON leave_requests(tenant_id, submitted_at DESC, id DESC)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS leave_requests_status_submitted_idx
  ON leave_requests(tenant_id, status, submitted_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS leave_requests_tenant_dates_idx
  ON leave_requests(tenant_id, start_date, end_date);

INSERT INTO tenant_permissions(permission_key, label, description)
VALUES
  ('leave.view.scoped', 'View scoped leave requests', 'View leave requests within an authorised employee scope.'),
  ('leave.approve', 'Approve scoped leave requests', 'Approve or reject leave requests within an authorised employee scope.'),
  ('leave.manage', 'Manage tenant leave', 'Manage leave requests across an explicitly authorised company scope.')
ON CONFLICT (permission_key) DO UPDATE
  SET label = EXCLUDED.label, description = EXCLUDED.description;

INSERT INTO tenant_role_permissions(tenant_id, role_id, permission_key)
SELECT role.tenant_id, role.id, permission.permission_key
FROM tenant_roles role
CROSS JOIN (VALUES
  ('leave.view.scoped'),
  ('leave.approve'),
  ('leave.manage')
) AS permission(permission_key)
WHERE role.system_key = 'hr_admin'
ON CONFLICT (tenant_id, role_id, permission_key) DO NOTHING;

COMMIT;
