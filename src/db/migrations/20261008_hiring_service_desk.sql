BEGIN;
CREATE TABLE IF NOT EXISTS hiring_jobs (
 id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id uuid NOT NULL REFERENCES tenants(id),
 public_token text NOT NULL UNIQUE, title varchar(160) NOT NULL,department varchar(120),department_id uuid,location_id uuid,
 employment_type text NOT NULL DEFAULT 'full_time' CHECK(employment_type IN('full_time','part_time','contract','internship')),
 description varchar(12000) NOT NULL,requirements varchar(12000) NOT NULL DEFAULT '',manager_id uuid,owner_id uuid NOT NULL,
 headcount integer NOT NULL DEFAULT 1 CHECK(headcount BETWEEN 1 AND 1000),opens_on date,closes_on date,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','open','paused','closed','filled')),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,tenant_id),FOREIGN KEY(manager_id,tenant_id) REFERENCES employees(id,tenant_id),FOREIGN KEY(owner_id,tenant_id) REFERENCES employees(id,tenant_id),
 FOREIGN KEY(department_id,tenant_id) REFERENCES organisation_departments(id,tenant_id),FOREIGN KEY(location_id,tenant_id) REFERENCES company_locations(id,tenant_id),CHECK(closes_on IS NULL OR opens_on IS NULL OR closes_on>=opens_on)
);
ALTER TABLE hiring_applicants ADD COLUMN IF NOT EXISTS job_id uuid;
ALTER TABLE hiring_applicants ADD COLUMN IF NOT EXISTS cover_note varchar(4000);
ALTER TABLE hiring_applicants ADD COLUMN IF NOT EXISTS consent_at timestamptz;
ALTER TABLE hiring_applicants ADD COLUMN IF NOT EXISTS resume_key text;
ALTER TABLE hiring_applicants ADD COLUMN IF NOT EXISTS hired_employee_id uuid;
ALTER TABLE hiring_applicants ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE hiring_stage_history ALTER COLUMN actor_id DROP NOT NULL;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='hiring_applicant_job_tenant') THEN ALTER TABLE hiring_applicants ADD CONSTRAINT hiring_applicant_job_tenant FOREIGN KEY(job_id,tenant_id) REFERENCES hiring_jobs(id,tenant_id); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='hiring_applicant_employee_tenant') THEN ALTER TABLE hiring_applicants ADD CONSTRAINT hiring_applicant_employee_tenant FOREIGN KEY(hired_employee_id,tenant_id) REFERENCES employees(id,tenant_id); END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS hiring_application_job_email ON hiring_applicants(tenant_id,job_id,lower(email)) WHERE job_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS hiring_interviews (
 id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),tenant_id uuid NOT NULL REFERENCES tenants(id),applicant_id uuid NOT NULL,meeting_id uuid NOT NULL,interview_type varchar(100) NOT NULL,
 UNIQUE(id,tenant_id),UNIQUE(tenant_id,meeting_id),FOREIGN KEY(applicant_id,tenant_id) REFERENCES hiring_applicants(id,tenant_id),FOREIGN KEY(meeting_id,tenant_id) REFERENCES communication_meetings(id,tenant_id)
);
CREATE TABLE IF NOT EXISTS hiring_evaluations (
 id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),tenant_id uuid NOT NULL REFERENCES tenants(id),interview_id uuid NOT NULL,author_id uuid NOT NULL,
 recommendation text NOT NULL CHECK(recommendation IN('strong_yes','yes','no','strong_no')),score integer CHECK(score BETWEEN 1 AND 5),strengths varchar(2000),concerns varchar(2000),notes varchar(4000),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,interview_id,author_id),FOREIGN KEY(interview_id,tenant_id) REFERENCES hiring_interviews(id,tenant_id),FOREIGN KEY(author_id,tenant_id) REFERENCES employees(id,tenant_id)
);
CREATE TABLE IF NOT EXISTS hiring_offers (
 id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),tenant_id uuid NOT NULL REFERENCES tenants(id),applicant_id uuid NOT NULL,created_by uuid NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','sent','accepted','rejected','withdrawn','expired')),salary numeric(14,2) NOT NULL CHECK(salary>=0),currency varchar(3) NOT NULL,
 start_date date NOT NULL,expires_on date NOT NULL,notes varchar(4000),response_note varchar(2000),message_id uuid,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,tenant_id),FOREIGN KEY(applicant_id,tenant_id) REFERENCES hiring_applicants(id,tenant_id),FOREIGN KEY(created_by,tenant_id) REFERENCES employees(id,tenant_id),FOREIGN KEY(message_id,tenant_id) REFERENCES communication_messages(id,tenant_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS hiring_one_active_offer ON hiring_offers(tenant_id,applicant_id) WHERE status IN('draft','sent','accepted');
CREATE TABLE IF NOT EXISTS hiring_onboarding_tasks (
 id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),tenant_id uuid NOT NULL REFERENCES tenants(id),employee_id uuid NOT NULL,title varchar(180) NOT NULL,completed_at timestamptz,
 FOREIGN KEY(employee_id,tenant_id) REFERENCES employees(id,tenant_id),UNIQUE(tenant_id,employee_id,title)
);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS employment_start_date date;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS employment_type text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS primary_location_id uuid;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='employee_primary_location_tenant') THEN ALTER TABLE employees ADD CONSTRAINT employee_primary_location_tenant FOREIGN KEY(primary_location_id,tenant_id) REFERENCES company_locations(id,tenant_id); END IF; END $$;
ALTER TABLE support_ticket_events ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'requester' CHECK(visibility IN('requester','internal'));
ALTER TABLE support_ticket_events ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'status' CHECK(kind IN('status','comment','assignment','resolution'));
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS resolution varchar(2000);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['hiring_jobs','hiring_interviews','hiring_evaluations','hiring_offers','hiring_onboarding_tasks'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tab);
 EXECUTE format('DROP POLICY IF EXISTS hiring_tenant ON %I',tab);
 EXECUTE format($policy$CREATE POLICY hiring_tenant ON %I USING(tenant_id=NULLIF(current_setting('app.current_tenant',true),'')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting('app.current_tenant',true),'')::uuid)$policy$,tab);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.stanza_public_job_tenant(token text) RETURNS TABLE(tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT j.tenant_id FROM public.hiring_jobs j WHERE j.public_token=token AND j.status='open' AND (j.opens_on IS NULL OR j.opens_on<=current_date) AND (j.closes_on IS NULL OR j.closes_on>=current_date) LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.stanza_public_job_tenant(text) FROM PUBLIC;
INSERT INTO tenant_permissions(permission_key,label,description) VALUES
('hiring.manage_jobs','Manage job openings','Create, publish and close company jobs.'),('hiring.schedule_interviews','Schedule hiring interviews','Schedule interviews through Communications.'),('hiring.evaluate','Evaluate interviews','Submit feedback for assigned interviews.'),('hiring.manage_offers','Manage hiring offers','Draft offers and record verified candidate responses.'),('hiring.hire','Confirm hires','Convert accepted offers to employees.') ON CONFLICT DO NOTHING;
INSERT INTO tenant_role_permissions(tenant_id,role_id,permission_key) SELECT t.tenant_id,t.id,p.permission_key FROM tenant_roles t JOIN tenant_permissions p ON p.permission_key IN('hiring.manage_jobs','hiring.schedule_interviews','hiring.evaluate','hiring.manage_offers','hiring.hire') WHERE t.system_key='hr_admin' ON CONFLICT DO NOTHING;
ALTER TABLE router_http_metrics DROP CONSTRAINT IF EXISTS router_http_metrics_kind_check;
ALTER TABLE router_http_metrics ADD CONSTRAINT router_http_metrics_kind_check CHECK(kind IN ('http','employee','location','asset','job_opening','candidate'));
COMMIT;
