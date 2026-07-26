-- Private, author-owned recovery drafts for the Company Feed composer.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'company_feed_posts_id_tenant_unique'
  ) THEN
    ALTER TABLE company_feed_posts
      ADD CONSTRAINT company_feed_posts_id_tenant_unique UNIQUE (id, tenant_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS company_feed_drafts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  author_employee_id UUID NOT NULL,
  draft_key VARCHAR(48) NOT NULL DEFAULT 'company_feed_main',
  title VARCHAR(160),
  content_format VARCHAR(32) NOT NULL DEFAULT 'lexical-v1',
  content_json JSONB NOT NULL,
  attachment_references JSONB,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 1,
  published_post_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  discarded_at TIMESTAMPTZ,
  CONSTRAINT company_feed_drafts_id_tenant_unique UNIQUE (id, tenant_id),
  CONSTRAINT company_feed_drafts_author_tenant_fk
    FOREIGN KEY (author_employee_id, tenant_id)
    REFERENCES employees(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT company_feed_drafts_published_post_tenant_fk
    FOREIGN KEY (published_post_id, tenant_id)
    REFERENCES company_feed_posts(id, tenant_id) ON DELETE SET NULL (published_post_id),
  CONSTRAINT company_feed_drafts_key_chk CHECK (draft_key = 'company_feed_main'),
  CONSTRAINT company_feed_drafts_format_chk CHECK (content_format = 'lexical-v1'),
  CONSTRAINT company_feed_drafts_status_chk CHECK (status IN ('active', 'published', 'discarded')),
  CONSTRAINT company_feed_drafts_version_chk CHECK (version >= 1),
  CONSTRAINT company_feed_drafts_lifecycle_chk CHECK (
    (status = 'active' AND published_at IS NULL AND discarded_at IS NULL)
    OR (status = 'published' AND published_at IS NOT NULL AND discarded_at IS NULL AND published_post_id IS NOT NULL)
    OR (status = 'discarded' AND discarded_at IS NOT NULL AND published_at IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS company_feed_drafts_one_active_author_idx
  ON company_feed_drafts (tenant_id, author_employee_id, draft_key)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS company_feed_drafts_author_updated_idx
  ON company_feed_drafts (tenant_id, author_employee_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS company_feed_drafts_abandoned_cleanup_idx
  ON company_feed_drafts (tenant_id, updated_at)
  WHERE status = 'active';

ALTER TABLE company_feed_drafts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_feed_drafts_tenant_isolation ON company_feed_drafts;
CREATE POLICY company_feed_drafts_tenant_isolation ON company_feed_drafts
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID);

-- Pending feed images remain available for a short grace period. Active drafts
-- only retain UUID references; a worker may delete images not referenced by an
-- active draft after the existing pending-image TTL.
