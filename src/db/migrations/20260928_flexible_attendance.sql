BEGIN;
CREATE TABLE IF NOT EXISTS attendance_policies (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
 location_mode text NOT NULL DEFAULT 'required' CHECK(location_mode IN ('required','optional','disabled')),
 allow_unfiled_breaks boolean NOT NULL DEFAULT true,
 allow_custom_breaks boolean NOT NULL DEFAULT true,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS attendance_break_policies (
 id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 100),
 duration_minutes integer NOT NULL CHECK(duration_minutes BETWEEN 5 AND 180),
 maximum_uses integer CHECK(maximum_uses BETWEEN 1 AND 20),
 requires_approval boolean NOT NULL DEFAULT false, paid boolean NOT NULL DEFAULT false,
 active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,tenant_id)
);
ALTER TABLE time_logs ALTER COLUMN clock_in_location DROP NOT NULL;
ALTER TABLE time_logs ADD COLUMN IF NOT EXISTS attendance_location_mode text NOT NULL DEFAULT 'required' CHECK(attendance_location_mode IN ('required','optional','disabled'));
ALTER TABLE time_logs ADD COLUMN IF NOT EXISTS location_status text NOT NULL DEFAULT 'verified' CHECK(location_status IN ('verified','outside','unavailable','disabled'));
UPDATE time_logs SET location_status='outside' WHERE NOT is_valid_geofence AND location_status='verified';
CREATE UNIQUE INDEX IF NOT EXISTS time_logs_identity_unique ON time_logs(id,tenant_id,employee_id);
CREATE UNIQUE INDEX IF NOT EXISTS break_requests_identity_unique ON break_requests(id,tenant_id,employee_id);
ALTER TABLE break_requests ADD COLUMN IF NOT EXISTS break_policy_id uuid;
DO $$ BEGIN
 ALTER TABLE break_requests ADD CONSTRAINT break_requests_policy_fk FOREIGN KEY(break_policy_id,tenant_id) REFERENCES attendance_break_policies(id,tenant_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DROP INDEX IF EXISTS break_requests_one_pending_per_employee_idx;
CREATE TABLE IF NOT EXISTS attendance_breaks (
 id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 employee_id uuid NOT NULL, time_log_id uuid NOT NULL,
 started_at timestamptz NOT NULL DEFAULT clock_timestamp(), ended_at timestamptz,
 requested_break_id uuid, break_policy_id uuid,
 policy_name text, planned_minutes integer, paid boolean NOT NULL DEFAULT false,
 source text NOT NULL CHECK(source IN ('approved_request','policy','unfiled')),
 exception_status text NOT NULL DEFAULT 'none' CHECK(exception_status IN ('none','unresolved','resolved')),
 reason text CHECK(length(reason)<=500), resolved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(time_log_id,tenant_id,employee_id) REFERENCES time_logs(id,tenant_id,employee_id) ON DELETE CASCADE,
 FOREIGN KEY(requested_break_id,tenant_id,employee_id) REFERENCES break_requests(id,tenant_id,employee_id),
 FOREIGN KEY(break_policy_id,tenant_id) REFERENCES attendance_break_policies(id,tenant_id),
 CHECK(ended_at IS NULL OR ended_at>=started_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_break_one_active ON attendance_breaks(tenant_id,time_log_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS attendance_break_request_once ON attendance_breaks(tenant_id,requested_break_id) WHERE requested_break_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS attendance_break_shift_idx ON attendance_breaks(tenant_id,time_log_id,started_at);
CREATE INDEX IF NOT EXISTS attendance_break_exception_idx ON attendance_breaks(tenant_id,employee_id) WHERE exception_status='unresolved';
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['attendance_policies','attendance_break_policies','attendance_breaks'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tab);
 EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I',tab);
 EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I USING (tenant_id=NULLIF(current_setting('app.current_tenant',true),'')::uuid) WITH CHECK (tenant_id=NULLIF(current_setting('app.current_tenant',true),'')::uuid)$policy$,tab);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION attendance_break_seconds(p_tenant uuid,p_log uuid,p_end timestamptz)
RETURNS numeric LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT COALESCE(SUM(GREATEST(0,EXTRACT(EPOCH FROM (LEAST(COALESCE(b.ended_at,p_end),p_end)-GREATEST(b.started_at,l.clock_in_time))))),0)
 FROM attendance_breaks b JOIN time_logs l ON l.tenant_id=b.tenant_id AND l.id=b.time_log_id AND l.employee_id=b.employee_id
 WHERE b.tenant_id=p_tenant AND b.time_log_id=p_log
$$;
ALTER TABLE attendance_daily_summaries ADD COLUMN IF NOT EXISTS total_break_minutes integer NOT NULL DEFAULT 0;
INSERT INTO tenant_permissions(permission_key,label,description) VALUES ('attendance.policy.manage','Manage attendance policy','Configure company attendance and break policies.') ON CONFLICT(permission_key) DO NOTHING;
INSERT INTO tenant_role_permissions(tenant_id,role_id,permission_key)
SELECT tenant_id,id,'attendance.policy.manage' FROM tenant_roles WHERE system_key='hr_admin' ON CONFLICT DO NOTHING;

-- Paid pauses retain attendance credit; total break time still includes every pause.
CREATE OR REPLACE FUNCTION attendance_unpaid_break_seconds(p_tenant uuid,p_log uuid,p_end timestamptz)
RETURNS numeric LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT COALESCE(SUM(GREATEST(0,EXTRACT(EPOCH FROM (LEAST(COALESCE(b.ended_at,p_end),p_end)-GREATEST(b.started_at,l.clock_in_time))))),0)
 FROM attendance_breaks b JOIN time_logs l ON l.tenant_id=b.tenant_id AND l.id=b.time_log_id AND l.employee_id=b.employee_id
 WHERE b.tenant_id=p_tenant AND b.time_log_id=p_log AND NOT b.paid
$$;
DO $$ BEGIN
 ALTER TABLE attendance_breaks ADD CONSTRAINT attendance_break_positive_duration CHECK(ended_at IS NULL OR ended_at>started_at) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMIT;
