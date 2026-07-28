BEGIN;

ALTER TABLE shift_swap_requests ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ;
ALTER TABLE shift_swap_requests DROP CONSTRAINT IF EXISTS shift_swap_requests_status_check;
ALTER TABLE shift_swap_requests
  ADD CONSTRAINT shift_swap_requests_status_check
  CHECK (status IN ('pending_target','target_declined','pending_approval','approved','applied','rejected','cancelled','expired'));

CREATE TABLE IF NOT EXISTS roster_shift_assignment_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  roster_shift_id UUID NOT NULL,
  previous_employee_id UUID NOT NULL,
  new_employee_id UUID NOT NULL,
  shift_swap_request_id UUID NOT NULL,
  applied_by_employee_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT roster_shift_assignment_history_shift_tenant_fk
    FOREIGN KEY (roster_shift_id, tenant_id) REFERENCES roster_shifts(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT roster_shift_assignment_history_previous_employee_tenant_fk
    FOREIGN KEY (previous_employee_id, tenant_id) REFERENCES employees(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT roster_shift_assignment_history_new_employee_tenant_fk
    FOREIGN KEY (new_employee_id, tenant_id) REFERENCES employees(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT roster_shift_assignment_history_swap_tenant_fk
    FOREIGN KEY (shift_swap_request_id, tenant_id) REFERENCES shift_swap_requests(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT roster_shift_assignment_history_actor_tenant_fk
    FOREIGN KEY (applied_by_employee_id, tenant_id) REFERENCES employees(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT roster_shift_assignment_history_swap_shift_unique UNIQUE (shift_swap_request_id, roster_shift_id)
);

CREATE INDEX IF NOT EXISTS roster_shift_assignment_history_shift_idx
  ON roster_shift_assignment_history(tenant_id, roster_shift_id, created_at DESC);
ALTER TABLE roster_shift_assignment_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS roster_shift_assignment_history_tenant_isolation ON roster_shift_assignment_history;
CREATE POLICY roster_shift_assignment_history_tenant_isolation ON roster_shift_assignment_history
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

COMMIT;
