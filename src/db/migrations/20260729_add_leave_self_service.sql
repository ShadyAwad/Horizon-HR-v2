BEGIN;

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

ALTER TABLE leave_requests
  ALTER COLUMN reason DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leave_requests_id_tenant_unique'
  ) THEN
    ALTER TABLE leave_requests
      ADD CONSTRAINT leave_requests_id_tenant_unique UNIQUE (id, tenant_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS leave_request_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  leave_request_id UUID NOT NULL,
  actor_employee_id UUID,
  action VARCHAR(60) NOT NULL,
  previous_status VARCHAR(50),
  new_status VARCHAR(50),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT leave_request_history_request_tenant_fk
    FOREIGN KEY (leave_request_id, tenant_id)
    REFERENCES leave_requests(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT leave_request_history_actor_tenant_fk
    FOREIGN KEY (actor_employee_id, tenant_id)
    REFERENCES employees(id, tenant_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS leave_requests_self_service_list_idx
  ON leave_requests(tenant_id, employee_id, submitted_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS leave_requests_self_service_overlap_idx
  ON leave_requests(tenant_id, employee_id, start_date, end_date)
  WHERE status IN ('pending', 'approved');
CREATE INDEX IF NOT EXISTS leave_request_history_request_idx
  ON leave_request_history(tenant_id, leave_request_id, created_at ASC);

ALTER TABLE leave_request_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leave_request_history_tenant_isolation ON leave_request_history;
CREATE POLICY leave_request_history_tenant_isolation ON leave_request_history
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID);

INSERT INTO tenant_permissions (permission_key, label, description)
VALUES
  ('leave.request.self', 'Request personal leave', 'Create personal leave requests.'),
  ('leave.view.self', 'View personal leave', 'View personal leave request history.'),
  ('leave.cancel.self', 'Cancel personal leave', 'Cancel pending personal leave requests.')
ON CONFLICT (permission_key) DO UPDATE
  SET label = EXCLUDED.label, description = EXCLUDED.description;

INSERT INTO tenant_role_permissions (tenant_id, role_id, permission_key)
SELECT role.tenant_id, role.id, permission.permission_key
FROM tenant_roles role
CROSS JOIN (VALUES
  ('leave.request.self'),
  ('leave.view.self'),
  ('leave.cancel.self')
) AS permission(permission_key)
WHERE role.system_key IN ('employee', 'manager', 'hr_admin')
ON CONFLICT (tenant_id, role_id, permission_key) DO NOTHING;

COMMIT;
