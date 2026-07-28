BEGIN;

CREATE TABLE IF NOT EXISTS shift_swap_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  requester_employee_id UUID NOT NULL,
  target_employee_id UUID NOT NULL,
  requester_shift_id UUID NOT NULL,
  target_shift_id UUID NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending_target' CHECK (status IN ('pending_target','target_declined','pending_approval','cancelled','expired')),
  reason TEXT,
  requester_submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  target_responded_at TIMESTAMPTZ,
  target_response_note TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT shift_swap_requests_id_tenant_unique UNIQUE (id, tenant_id),
  CONSTRAINT shift_swap_requests_distinct_employees CHECK (requester_employee_id <> target_employee_id),
  CONSTRAINT shift_swap_requests_distinct_shifts CHECK (requester_shift_id <> target_shift_id),
  CONSTRAINT shift_swap_requests_requester_tenant_fk FOREIGN KEY (requester_employee_id, tenant_id) REFERENCES employees(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT shift_swap_requests_target_tenant_fk FOREIGN KEY (target_employee_id, tenant_id) REFERENCES employees(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT shift_swap_requests_requester_shift_tenant_fk FOREIGN KEY (requester_shift_id, tenant_id) REFERENCES roster_shifts(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT shift_swap_requests_target_shift_tenant_fk FOREIGN KEY (target_shift_id, tenant_id) REFERENCES roster_shifts(id, tenant_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS shift_swap_requests_requester_active_shift_unique ON shift_swap_requests(tenant_id, requester_shift_id) WHERE status IN ('pending_target','pending_approval');
CREATE UNIQUE INDEX IF NOT EXISTS shift_swap_requests_target_active_shift_unique ON shift_swap_requests(tenant_id, target_shift_id) WHERE status IN ('pending_target','pending_approval');
CREATE INDEX IF NOT EXISTS shift_swap_requests_participant_idx ON shift_swap_requests(tenant_id, requester_employee_id, target_employee_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS shift_swap_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  shift_swap_request_id UUID NOT NULL, actor_employee_id UUID, action VARCHAR(80) NOT NULL,
  previous_status VARCHAR(30), new_status VARCHAR(30), metadata JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT shift_swap_history_request_tenant_fk FOREIGN KEY (shift_swap_request_id, tenant_id) REFERENCES shift_swap_requests(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT shift_swap_history_actor_tenant_fk FOREIGN KEY (actor_employee_id, tenant_id) REFERENCES employees(id, tenant_id) ON DELETE SET NULL (actor_employee_id)
);
CREATE INDEX IF NOT EXISTS shift_swap_history_request_idx ON shift_swap_history(tenant_id, shift_swap_request_id, created_at);
ALTER TABLE shift_swap_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_swap_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shift_swap_requests_tenant_isolation ON shift_swap_requests;
CREATE POLICY shift_swap_requests_tenant_isolation ON shift_swap_requests USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
DROP POLICY IF EXISTS shift_swap_history_tenant_isolation ON shift_swap_history;
CREATE POLICY shift_swap_history_tenant_isolation ON shift_swap_history USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
INSERT INTO tenant_permissions(permission_key, label, description) VALUES
  ('roster.swap.request', 'Request shift swaps', 'Request shift swaps.'),
  ('roster.swap.respond', 'Respond to shift swaps', 'Respond to shift swaps.')
ON CONFLICT (permission_key) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description;

COMMIT;
