-- Public asset verification is deliberately minimal. Asset data remains tenant scoped.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS asset_label_disclosure_level VARCHAR(32) NOT NULL DEFAULT 'label_only';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tenants_asset_label_disclosure_level_check') THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_asset_label_disclosure_level_check
      CHECK (asset_label_disclosure_level IN ('label_only','label_and_type','label_type_and_model'));
  END IF;
END $$;
