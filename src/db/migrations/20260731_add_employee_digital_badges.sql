BEGIN;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS badge_disclosure_level VARCHAR(32) NOT NULL DEFAULT 'name_only';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tenants_badge_disclosure_level_check') THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_badge_disclosure_level_check
      CHECK (badge_disclosure_level IN ('name_only', 'name_and_title', 'name_title_and_department'));
  END IF;
END $$;

-- The hash is still used for public lookup. Ciphertext is AES-256-GCM protected
-- server-side material used only to re-render an authorised employee's stable badge.
ALTER TABLE qr_access_tokens
  ADD COLUMN IF NOT EXISTS token_ciphertext TEXT;

COMMIT;
