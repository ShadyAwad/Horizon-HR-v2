BEGIN;

CREATE TABLE IF NOT EXISTS leave_roster_conflicts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  leave_request_id UUID NOT NULL,
  roster_shift_id UUID NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','acknowledged','resolved','obsolete')),
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by_employee_id UUID,
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT leave_roster_conflicts_id_tenant_unique UNIQUE (id, tenant_id),
  CONSTRAINT leave_roster_conflicts_leave_tenant_fk
    FOREIGN KEY (leave_request_id, tenant_id)
    REFERENCES leave_requests(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT leave_roster_conflicts_shift_tenant_fk
    FOREIGN KEY (roster_shift_id, tenant_id)
    REFERENCES roster_shifts(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT leave_roster_conflicts_resolver_tenant_fk
    FOREIGN KEY (resolved_by_employee_id, tenant_id)
    REFERENCES employees(id, tenant_id) ON DELETE SET NULL (resolved_by_employee_id),
  CONSTRAINT leave_roster_conflicts_unique_pair
    UNIQUE (tenant_id, leave_request_id, roster_shift_id),
  CONSTRAINT leave_roster_conflicts_resolution_note_length_chk
    CHECK (resolution_note IS NULL OR length(resolution_note) <= 1000)
);

CREATE INDEX IF NOT EXISTS leave_roster_conflicts_open_request_idx
  ON leave_roster_conflicts(tenant_id, leave_request_id, detected_at DESC)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS leave_roster_conflicts_open_shift_idx
  ON leave_roster_conflicts(tenant_id, roster_shift_id)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS leave_roster_conflicts_status_idx
  ON leave_roster_conflicts(tenant_id, status, updated_at DESC);

ALTER TABLE leave_roster_conflicts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leave_roster_conflicts_tenant_isolation ON leave_roster_conflicts;
CREATE POLICY leave_roster_conflicts_tenant_isolation ON leave_roster_conflicts
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::UUID);

CREATE OR REPLACE FUNCTION obsolete_leave_roster_conflicts_for_shift()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE leave_roster_conflicts conflict
  SET status = 'obsolete', resolved_at = NOW(), updated_at = NOW()
  FROM leave_requests request
  WHERE conflict.tenant_id = NEW.tenant_id
    AND conflict.roster_shift_id = NEW.id
    AND conflict.leave_request_id = request.id
    AND conflict.tenant_id = request.tenant_id
    AND conflict.status IN ('open','acknowledged')
    AND (
      NEW.status <> 'scheduled'
      OR NEW.employee_id <> request.employee_id
      OR request.status <> 'approved'
      OR NEW.start_time >= ((request.end_date + 1)::timestamp AT TIME ZONE 'UTC')
      OR NEW.end_time <= (request.start_date::timestamp AT TIME ZONE 'UTC')
    );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS roster_shift_obsolete_leave_conflicts ON roster_shifts;
CREATE TRIGGER roster_shift_obsolete_leave_conflicts
AFTER UPDATE OF employee_id, start_time, end_time, status ON roster_shifts
FOR EACH ROW EXECUTE FUNCTION obsolete_leave_roster_conflicts_for_shift();

COMMIT;
