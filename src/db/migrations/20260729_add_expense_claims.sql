BEGIN;

INSERT INTO tenant_permissions(permission_key, label, description) VALUES
  ('expenses.submit.self', 'Submit personal expenses', 'Submit personal expense reimbursement claims.'),
  ('expenses.view.self', 'View personal expenses', 'View personal expense reimbursement claims.'),
  ('expenses.cancel.self', 'Cancel personal expenses', 'Cancel personal pending expense claims.'),
  ('expenses.view.scoped', 'View scoped expenses', 'View expense claims within an explicitly authorised employee scope.'),
  ('expenses.approve', 'Approve scoped expenses', 'Approve or reject expense claims within an explicitly authorised employee scope.'),
  ('expenses.reimburse', 'Reimburse approved expenses', 'Mark approved expense claims as reimbursed within an explicitly authorised scope.'),
  ('expenses.manage', 'Manage expense reimbursements', 'Administer expense claims within an explicitly authorised scope.')
ON CONFLICT (permission_key) DO UPDATE
SET label=EXCLUDED.label, description=EXCLUDED.description;

CREATE TABLE IF NOT EXISTS expense_claims (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL,
  extraction_id UUID,
  merchant_name TEXT NOT NULL,
  expense_date DATE NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  currency CHAR(3) NOT NULL,
  category VARCHAR(40) NOT NULL,
  business_reason TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  approver_employee_id UUID,
  approval_source VARCHAR(40),
  approval_scope_type VARCHAR(30),
  approval_scope_id UUID,
  decision_note TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approval_decided_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  reimbursed_at TIMESTAMPTZ,
  reimbursed_by_employee_id UUID,
  reimbursement_external_reference VARCHAR(120),
  reimbursement_note TEXT,
  cancelled_at TIMESTAMPTZ,
  idempotency_key VARCHAR(100),
  request_fingerprint CHAR(64) NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT expense_claims_id_tenant_unique UNIQUE(id, tenant_id),
  CONSTRAINT expense_claims_employee_tenant_fk FOREIGN KEY(employee_id, tenant_id)
    REFERENCES employees(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT expense_claims_extraction_tenant_fk FOREIGN KEY(extraction_id, tenant_id)
    REFERENCES document_extraction_jobs(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT expense_claims_approver_tenant_fk FOREIGN KEY(approver_employee_id, tenant_id)
    REFERENCES employees(id, tenant_id) ON DELETE SET NULL (approver_employee_id),
  CONSTRAINT expense_claims_reimburser_tenant_fk FOREIGN KEY(reimbursed_by_employee_id, tenant_id)
    REFERENCES employees(id, tenant_id) ON DELETE SET NULL (reimbursed_by_employee_id),
  CONSTRAINT expense_claims_amount_check CHECK(amount > 0 AND amount <= 9999999999.99),
  CONSTRAINT expense_claims_currency_check CHECK(currency ~ '^[A-Z]{3}$'),
  CONSTRAINT expense_claims_category_check CHECK(category IN (
    'travel','meals','accommodation','transport','office_supplies',
    'software','training','communications','other'
  )),
  CONSTRAINT expense_claims_status_check CHECK(status IN (
    'pending','approved','rejected','cancelled','reimbursed'
  )),
  CONSTRAINT expense_claims_approval_source_check CHECK(
    approval_source IS NULL OR approval_source IN (
      'direct_manager','team_leader','department_head','reporting_chain',
      'scoped_role','delegation','hr_admin'
    )
  ),
  CONSTRAINT expense_claims_approval_scope_check CHECK(
    approval_scope_type IS NULL OR approval_scope_type IN (
      'company','location','department','team','direct_reports','self'
    )
  ),
  CONSTRAINT expense_claims_text_lengths_check CHECK(
    length(merchant_name) BETWEEN 1 AND 200
    AND length(business_reason) BETWEEN 1 AND 2000
    AND (decision_note IS NULL OR length(decision_note) <= 1000)
    AND (reimbursement_note IS NULL OR length(reimbursement_note) <= 1000)
  ),
  CONSTRAINT expense_claims_version_check CHECK(version >= 1),
  CONSTRAINT expense_claims_fingerprint_check CHECK(request_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT expense_claims_employee_idempotency_unique UNIQUE(tenant_id, employee_id, idempotency_key),
  CONSTRAINT expense_claims_extraction_unique UNIQUE(tenant_id, extraction_id)
);

CREATE TABLE IF NOT EXISTS expense_claim_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  expense_claim_id UUID NOT NULL,
  actor_employee_id UUID,
  action VARCHAR(60) NOT NULL,
  previous_status VARCHAR(20),
  new_status VARCHAR(20),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT expense_claim_history_id_tenant_unique UNIQUE(id, tenant_id),
  CONSTRAINT expense_claim_history_claim_tenant_fk FOREIGN KEY(expense_claim_id, tenant_id)
    REFERENCES expense_claims(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT expense_claim_history_actor_tenant_fk FOREIGN KEY(actor_employee_id, tenant_id)
    REFERENCES employees(id, tenant_id) ON DELETE SET NULL (actor_employee_id),
  CONSTRAINT expense_claim_history_status_check CHECK(
    (previous_status IS NULL OR previous_status IN ('pending','approved','rejected','cancelled','reimbursed'))
    AND (new_status IS NULL OR new_status IN ('pending','approved','rejected','cancelled','reimbursed'))
  )
);

CREATE INDEX IF NOT EXISTS expense_claims_employee_submitted_idx
  ON expense_claims(tenant_id, employee_id, submitted_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS expense_claims_approver_pending_idx
  ON expense_claims(tenant_id, approver_employee_id, submitted_at DESC)
  WHERE status='pending';
CREATE INDEX IF NOT EXISTS expense_claims_status_submitted_idx
  ON expense_claims(tenant_id, status, submitted_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS expense_claims_expense_date_idx
  ON expense_claims(tenant_id, expense_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS expense_claims_reimbursed_idx
  ON expense_claims(tenant_id, reimbursed_at DESC, id DESC)
  WHERE status='reimbursed';
CREATE INDEX IF NOT EXISTS expense_claims_duplicate_check_idx
  ON expense_claims(tenant_id, employee_id, expense_date, amount, currency, lower(merchant_name))
  WHERE status IN ('pending','approved','reimbursed');
CREATE INDEX IF NOT EXISTS expense_claim_history_claim_idx
  ON expense_claim_history(tenant_id, expense_claim_id, created_at ASC, id ASC);

ALTER TABLE expense_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_claim_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS expense_claims_tenant_isolation ON expense_claims;
CREATE POLICY expense_claims_tenant_isolation ON expense_claims
  USING (tenant_id=NULLIF(current_setting('app.current_tenant', true), '')::UUID)
  WITH CHECK (tenant_id=NULLIF(current_setting('app.current_tenant', true), '')::UUID);

DROP POLICY IF EXISTS expense_claim_history_tenant_isolation ON expense_claim_history;
CREATE POLICY expense_claim_history_tenant_isolation ON expense_claim_history
  USING (tenant_id=NULLIF(current_setting('app.current_tenant', true), '')::UUID)
  WITH CHECK (tenant_id=NULLIF(current_setting('app.current_tenant', true), '')::UUID);

-- Baseline roles receive only personal self-service grants. Finance authority is
-- never inferred from a role name and must be assigned explicitly.
INSERT INTO tenant_role_permissions(tenant_id, role_id, permission_key)
SELECT role.tenant_id, role.id, permission.permission_key
FROM tenant_roles role
CROSS JOIN (VALUES
  ('expenses.submit.self'),
  ('expenses.view.self'),
  ('expenses.cancel.self')
) permission(permission_key)
WHERE role.system_key IN ('employee','manager','hr_admin')
ON CONFLICT(tenant_id, role_id, permission_key) DO NOTHING;

COMMIT;
