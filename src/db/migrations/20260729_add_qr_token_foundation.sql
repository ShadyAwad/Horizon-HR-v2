BEGIN;

INSERT INTO tenant_permissions (permission_key, label, description) VALUES
  ('qr.employee_badge.self', 'Manage own employee badge QR', 'Issue and rotate a personal employee verification token.'),
  ('qr.employee_badge.manage', 'Manage employee badge QR', 'Manage employee verification tokens within an authorised scope.'),
  ('qr.asset_label.manage', 'Manage asset label QR', 'Manage asset lookup tokens with existing asset authority.'),
  ('qr.onboarding_invite.manage', 'Manage onboarding invite QR', 'Manage short-lived onboarding invitation tokens with existing Hiring authority.'),
  ('qr.tokens.revoke', 'Revoke QR tokens', 'Revoke QR tokens within an authorised scope.')
ON CONFLICT (permission_key) DO UPDATE
SET label=EXCLUDED.label,
    description=EXCLUDED.description;

CREATE TABLE IF NOT EXISTS qr_access_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('employee_verification', 'asset_lookup', 'onboarding_invite')),
  subject_type TEXT NOT NULL CHECK (subject_type IN ('employee', 'asset', 'onboarding_invite')),
  employee_id UUID,
  asset_id UUID,
  token_hash CHAR(64) NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'used', 'expired', 'revoked')),
  expires_at TIMESTAMPTZ,
  single_use BOOLEAN NOT NULL DEFAULT false,
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by_employee_id UUID,
  created_by_employee_id UUID,
  last_scanned_at TIMESTAMPTZ,
  scan_count INTEGER NOT NULL DEFAULT 0 CHECK (scan_count >= 0),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT qr_access_tokens_id_tenant_unique UNIQUE (id, tenant_id),
  CONSTRAINT qr_access_tokens_token_hash_unique UNIQUE (token_hash),
  CONSTRAINT qr_access_tokens_employee_tenant_fk
    FOREIGN KEY (employee_id, tenant_id) REFERENCES employees(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT qr_access_tokens_asset_tenant_fk
    FOREIGN KEY (asset_id, tenant_id) REFERENCES assets(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT qr_access_tokens_revoker_tenant_fk
    FOREIGN KEY (revoked_by_employee_id, tenant_id) REFERENCES employees(id, tenant_id) ON DELETE SET NULL (revoked_by_employee_id),
  CONSTRAINT qr_access_tokens_creator_tenant_fk
    FOREIGN KEY (created_by_employee_id, tenant_id) REFERENCES employees(id, tenant_id) ON DELETE SET NULL (created_by_employee_id),
  CONSTRAINT qr_access_tokens_subject_shape_check CHECK (
    (purpose='employee_verification' AND subject_type='employee' AND employee_id IS NOT NULL AND asset_id IS NULL AND single_use=false)
    OR
    (purpose='asset_lookup' AND subject_type='asset' AND asset_id IS NOT NULL AND employee_id IS NULL AND single_use=false)
    OR
    (purpose='onboarding_invite' AND subject_type='onboarding_invite' AND employee_id IS NULL AND asset_id IS NULL AND single_use=true AND expires_at IS NOT NULL)
  ),
  CONSTRAINT qr_access_tokens_used_shape_check CHECK (
    (status='used' AND single_use=true AND used_at IS NOT NULL)
    OR
    (status<>'used' AND used_at IS NULL)
  ),
  CONSTRAINT qr_access_tokens_revoked_shape_check CHECK (
    (status='revoked' AND revoked_at IS NOT NULL)
    OR status<>'revoked'
  ),
  CONSTRAINT qr_access_tokens_metadata_object_check CHECK (
    metadata IS NULL OR jsonb_typeof(metadata)='object'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS qr_access_tokens_employee_active_unique
  ON qr_access_tokens (tenant_id, purpose, employee_id)
  WHERE status='active' AND employee_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS qr_access_tokens_asset_active_unique
  ON qr_access_tokens (tenant_id, purpose, asset_id)
  WHERE status='active' AND asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS qr_access_tokens_purpose_status_idx
  ON qr_access_tokens (tenant_id, purpose, status, created_at DESC);
CREATE INDEX IF NOT EXISTS qr_access_tokens_subject_idx
  ON qr_access_tokens (tenant_id, subject_type, employee_id, asset_id, status);
CREATE INDEX IF NOT EXISTS qr_access_tokens_expiry_idx
  ON qr_access_tokens (expires_at)
  WHERE status='active' AND expires_at IS NOT NULL;

ALTER TABLE qr_access_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS qr_access_tokens_tenant_isolation ON qr_access_tokens;
CREATE POLICY qr_access_tokens_tenant_isolation ON qr_access_tokens
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

-- Personal badge access is a baseline self-service permission. Management
-- permissions are intentionally not granted by system role name.
INSERT INTO tenant_role_permissions (tenant_id, role_id, permission_key)
SELECT role.tenant_id, role.id, 'qr.employee_badge.self'
FROM tenant_roles role
WHERE role.system_key IN ('employee', 'manager', 'hr_admin')
ON CONFLICT (tenant_id, role_id, permission_key) DO NOTHING;

COMMIT;
