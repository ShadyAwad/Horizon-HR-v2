BEGIN;

INSERT INTO tenant_permissions (permission_key, label, description) VALUES
  ('document_extraction.expense.self', 'Extract personal expense receipts', 'Extract candidate fields from receipts for the requesting employee.'),
  ('document_extraction.candidate.manage', 'Extract candidate documents', 'Extract candidate fields from documents within an authorised Hiring scope.'),
  ('document_extraction.asset.manage', 'Extract asset labels', 'Extract asset identifiers from labels within an authorised Asset scope.')
ON CONFLICT (permission_key) DO UPDATE
SET label = EXCLUDED.label,
    description = EXCLUDED.description;

CREATE TABLE IF NOT EXISTS document_extraction_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  requested_by_employee_id UUID NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('expense_receipt', 'candidate_document', 'asset_label')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'expired', 'deleted')),
  provider TEXT,
  storage_key TEXT,
  input_mime_type TEXT NOT NULL CHECK (input_mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  input_size_bytes INTEGER NOT NULL CHECK (input_size_bytes > 0 AND input_size_bytes <= 10485760),
  input_sha256 CHAR(64) NOT NULL CHECK (input_sha256 ~ '^[0-9a-f]{64}$'),
  result_json JSONB CHECK (result_json IS NULL OR jsonb_typeof(result_json) = 'object'),
  error_code TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT document_extraction_jobs_id_tenant_unique UNIQUE (id, tenant_id),
  CONSTRAINT document_extraction_jobs_requester_tenant_fk
    FOREIGN KEY (requested_by_employee_id, tenant_id)
    REFERENCES employees(id, tenant_id)
    ON DELETE CASCADE,
  CONSTRAINT document_extraction_jobs_expiry_check CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS document_extraction_jobs_requester_created_idx
  ON document_extraction_jobs (tenant_id, requested_by_employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS document_extraction_jobs_dedup_idx
  ON document_extraction_jobs (tenant_id, requested_by_employee_id, mode, input_sha256, created_at DESC);
CREATE INDEX IF NOT EXISTS document_extraction_jobs_status_created_idx
  ON document_extraction_jobs (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS document_extraction_jobs_expiry_idx
  ON document_extraction_jobs (expires_at)
  WHERE status IN ('pending', 'processing', 'completed', 'failed');

ALTER TABLE document_extraction_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_extraction_jobs_tenant_isolation ON document_extraction_jobs;
CREATE POLICY document_extraction_jobs_tenant_isolation ON document_extraction_jobs
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

-- Existing baseline roles receive only the personal receipt helper. Sensitive
-- Hiring and Asset extraction follow the permissions already granted to each
-- tenant role rather than role names.
INSERT INTO tenant_role_permissions (tenant_id, role_id, permission_key)
SELECT role.tenant_id, role.id, 'document_extraction.expense.self'
FROM tenant_roles role
WHERE role.system_key IN ('employee', 'manager', 'hr_admin')
ON CONFLICT (tenant_id, role_id, permission_key) DO NOTHING;

INSERT INTO tenant_role_permissions (tenant_id, role_id, permission_key)
SELECT DISTINCT role_permission.tenant_id, role_permission.role_id, 'document_extraction.candidate.manage'
FROM tenant_role_permissions role_permission
WHERE role_permission.permission_key IN ('hiring.create', 'hiring.edit')
ON CONFLICT (tenant_id, role_id, permission_key) DO NOTHING;

INSERT INTO tenant_role_permissions (tenant_id, role_id, permission_key)
SELECT DISTINCT role_permission.tenant_id, role_permission.role_id, 'document_extraction.asset.manage'
FROM tenant_role_permissions role_permission
WHERE role_permission.permission_key = 'assets.manage'
ON CONFLICT (tenant_id, role_id, permission_key) DO NOTHING;

COMMIT;
