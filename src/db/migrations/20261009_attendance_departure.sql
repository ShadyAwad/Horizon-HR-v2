BEGIN;
ALTER TABLE time_logs ADD COLUMN IF NOT EXISTS attendance_method text NOT NULL DEFAULT 'legacy' CHECK(attendance_method IN ('legacy','geofenced','location_optional','location_disabled','no_location'));
ALTER TABLE time_logs ADD COLUMN IF NOT EXISTS clock_in_note text CHECK(length(clock_in_note)<=500);
ALTER TABLE time_logs ADD COLUMN IF NOT EXISTS roster_shift_id uuid;
ALTER TABLE time_logs ADD COLUMN IF NOT EXISTS scheduled_end_time timestamptz;
ALTER TABLE time_logs ADD COLUMN IF NOT EXISTS scheduled_breaks jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE time_logs ADD COLUMN IF NOT EXISTS early_departure_seconds integer NOT NULL DEFAULT 0 CHECK(early_departure_seconds>=0);
ALTER TABLE time_logs ADD COLUMN IF NOT EXISTS effective_end_time timestamptz;
ALTER TABLE time_logs ADD COLUMN IF NOT EXISTS early_departure_note text CHECK(length(early_departure_note)<=500);
DO $$ BEGIN
 ALTER TABLE time_logs ADD CONSTRAINT attendance_roster_tenant_fk FOREIGN KEY(roster_shift_id,tenant_id) REFERENCES roster_shifts(id,tenant_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS attendance_early_leave_requests (
 id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 employee_id uuid NOT NULL, time_log_id uuid NOT NULL,
 scheduled_end_time timestamptz NOT NULL, requested_departure_time timestamptz NOT NULL,
 reason text CHECK(length(reason)<=500), status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), reviewer_id uuid, reviewed_at timestamptz, review_note text CHECK(length(review_note)<=500),
 FOREIGN KEY(time_log_id,tenant_id,employee_id) REFERENCES time_logs(id,tenant_id,employee_id) ON DELETE CASCADE,
 FOREIGN KEY(reviewer_id,tenant_id) REFERENCES employees(id,tenant_id),
 CHECK(requested_departure_time<scheduled_end_time),
 CHECK((status='pending' AND reviewer_id IS NULL AND reviewed_at IS NULL) OR (status<>'pending' AND reviewer_id IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_early_leave_open ON attendance_early_leave_requests(tenant_id,time_log_id) WHERE status IN ('pending','approved');
CREATE INDEX IF NOT EXISTS attendance_early_leave_queue ON attendance_early_leave_requests(tenant_id,employee_id,created_at DESC);
ALTER TABLE attendance_early_leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_early_leave_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON attendance_early_leave_requests;
CREATE POLICY tenant_isolation ON attendance_early_leave_requests USING(tenant_id=NULLIF(current_setting('app.current_tenant',true),'')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting('app.current_tenant',true),'')::uuid);
ALTER TABLE attendance_breaks ADD COLUMN IF NOT EXISTS planned_start_time timestamptz;
ALTER TABLE attendance_breaks ADD COLUMN IF NOT EXISTS planned_end_time timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS attendance_planned_break_once ON attendance_breaks(tenant_id,time_log_id,planned_start_time) WHERE planned_start_time IS NOT NULL;
INSERT INTO tenant_permissions(permission_key,label,description) VALUES('attendance.early_leave.review','Review early departure requests','Approve or reject attendance departure requests within assigned employee scope.') ON CONFLICT DO NOTHING;
-- Retain the same assigned scope as existing break reviewers; no broader role assignment.
INSERT INTO tenant_role_permissions(tenant_id,role_id,permission_key) SELECT tenant_id,role_id,'attendance.early_leave.review' FROM tenant_role_permissions WHERE permission_key='break_requests.review' ON CONFLICT DO NOTHING;
COMMIT;
