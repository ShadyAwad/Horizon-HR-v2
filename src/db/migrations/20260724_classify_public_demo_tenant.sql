ALTER TABLE tenants ADD COLUMN IF NOT EXISTS is_demo_tenant BOOLEAN NOT NULL DEFAULT false;
UPDATE tenants SET is_demo_tenant = true WHERE slug = 'stanza-demo';
