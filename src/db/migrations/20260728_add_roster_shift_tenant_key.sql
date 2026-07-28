BEGIN;

-- Composite tenant foreign keys must reference an exact unique parent key.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'roster_shifts'::regclass
      AND conname = 'roster_shifts_id_tenant_unique'
  ) THEN
    ALTER TABLE roster_shifts
      ADD CONSTRAINT roster_shifts_id_tenant_unique UNIQUE (id, tenant_id);
  END IF;
END $$;

COMMIT;
