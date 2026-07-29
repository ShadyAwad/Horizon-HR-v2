BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS assets_tenant_serial_unique
  ON assets (tenant_id, serial_number)
  WHERE serial_number IS NOT NULL;

COMMIT;
