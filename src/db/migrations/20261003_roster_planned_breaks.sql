-- Planned schedule windows are separate from recorded attendance breaks.
ALTER TABLE roster_shifts ADD COLUMN IF NOT EXISTS planned_breaks jsonb NOT NULL DEFAULT '[]'::jsonb;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='roster_shifts'::regclass AND conname='roster_planned_breaks_shape') THEN
  ALTER TABLE roster_shifts ADD CONSTRAINT roster_planned_breaks_shape CHECK (jsonb_typeof(planned_breaks)='array' AND jsonb_array_length(planned_breaks)<=8);
 END IF;
END $$;
