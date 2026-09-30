BEGIN;
ALTER TABLE organisation_departments ADD COLUMN IF NOT EXISTS grievance_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE grievances ADD COLUMN IF NOT EXISTS case_number varchar(40);
ALTER TABLE grievances ADD COLUMN IF NOT EXISTS destination_department_id uuid;
ALTER TABLE grievances ADD COLUMN IF NOT EXISTS assigned_department_id uuid;
ALTER TABLE grievances ADD COLUMN IF NOT EXISTS confidentiality varchar(20) NOT NULL DEFAULT 'standard';
ALTER TABLE grievances ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE grievances ADD COLUMN IF NOT EXISTS resolved_by uuid;
ALTER TABLE grievances ADD COLUMN IF NOT EXISTS resolution_summary text;
ALTER TABLE grievances ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE grievances ADD COLUMN IF NOT EXISTS legacy_status varchar(30);
CREATE TABLE IF NOT EXISTS grievance_case_counters(tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,last_number bigint NOT NULL CHECK(last_number>=0),permissions_migrated boolean NOT NULL DEFAULT false);
ALTER TABLE grievance_case_counters ADD COLUMN IF NOT EXISTS permissions_migrated boolean NOT NULL DEFAULT false;
-- Tenant row locking serializes numbering and also protects migration against case creation.
INSERT INTO grievance_case_counters(tenant_id,last_number) SELECT t.id,count(g.id) FROM tenants t LEFT JOIN grievances g ON g.tenant_id=t.id GROUP BY t.id ON CONFLICT(tenant_id) DO NOTHING;
WITH numbered AS (SELECT id,tenant_id,row_number() OVER(PARTITION BY tenant_id ORDER BY created_at,id) AS n FROM grievances)
UPDATE grievances g SET case_number='GRV-'||extract(year FROM g.created_at)::integer||'-'||lpad(numbered.n::text,greatest(6,length(numbered.n::text)),'0') FROM numbered WHERE g.id=numbered.id AND g.case_number IS NULL;
ALTER TABLE grievances ALTER COLUMN case_number SET NOT NULL;
ALTER TABLE grievances DROP CONSTRAINT IF EXISTS grievances_status_chk;
UPDATE grievances SET legacy_status=status,status=CASE status WHEN 'open' THEN 'submitted' WHEN 'under_review' THEN 'triaged' WHEN 'rejected' THEN 'closed' ELSE status END WHERE status IN ('open','under_review','rejected');
UPDATE grievances SET closed_at=COALESCE(closed_at,updated_at) WHERE status='closed';
ALTER TABLE grievances ALTER COLUMN status SET DEFAULT 'submitted';
ALTER TABLE grievances ADD CONSTRAINT grievances_status_chk CHECK(status IN ('submitted','triaged','assigned','in_progress','waiting','resolved','closed'));
CREATE UNIQUE INDEX IF NOT EXISTS grievance_case_number_unique ON grievances(tenant_id,case_number);
CREATE UNIQUE INDEX IF NOT EXISTS grievance_id_tenant_unique ON grievances(id,tenant_id);
CREATE INDEX IF NOT EXISTS grievance_inbox_idx ON grievances(tenant_id,assigned_department_id,status,updated_at DESC,id);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='grievance_case_confidentiality_chk' AND conrelid='grievances'::regclass) THEN
  ALTER TABLE grievances ADD CONSTRAINT grievance_case_confidentiality_chk CHECK(confidentiality IN ('standard','confidential'));
  ALTER TABLE grievances ADD CONSTRAINT grievance_destination_tenant_fk FOREIGN KEY(destination_department_id,tenant_id) REFERENCES organisation_departments(id,tenant_id);
  ALTER TABLE grievances ADD CONSTRAINT grievance_department_tenant_fk FOREIGN KEY(assigned_department_id,tenant_id) REFERENCES organisation_departments(id,tenant_id);
  ALTER TABLE grievances ADD CONSTRAINT grievance_assignee_tenant_fk FOREIGN KEY(assigned_to,tenant_id) REFERENCES employees(id,tenant_id);
  ALTER TABLE grievances ADD CONSTRAINT grievance_resolver_tenant_fk FOREIGN KEY(resolved_by,tenant_id) REFERENCES employees(id,tenant_id);
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS grievance_case_events(
 id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,case_id uuid NOT NULL,actor_id uuid,kind varchar(60) NOT NULL,visibility varchar(20) NOT NULL CHECK(visibility IN ('employee','internal')),metadata jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(case_id,tenant_id) REFERENCES grievances(id,tenant_id) ON DELETE CASCADE,FOREIGN KEY(actor_id,tenant_id) REFERENCES employees(id,tenant_id));
CREATE TABLE IF NOT EXISTS grievance_messages(
 id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,case_id uuid NOT NULL,actor_id uuid NOT NULL,kind varchar(20) NOT NULL CHECK(kind IN ('internal','response','follow_up','resolution')),body text NOT NULL CHECK(length(body) BETWEEN 1 AND 20000),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(case_id,tenant_id) REFERENCES grievances(id,tenant_id) ON DELETE CASCADE,FOREIGN KEY(actor_id,tenant_id) REFERENCES employees(id,tenant_id));
CREATE TABLE IF NOT EXISTS grievance_attachments(
 id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,case_id uuid NOT NULL,actor_id uuid NOT NULL,filename varchar(180) NOT NULL,mime_type varchar(100) NOT NULL,size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 10485760),storage_key varchar(80) NOT NULL UNIQUE,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(case_id,tenant_id) REFERENCES grievances(id,tenant_id) ON DELETE CASCADE,FOREIGN KEY(actor_id,tenant_id) REFERENCES employees(id,tenant_id));
CREATE INDEX IF NOT EXISTS grievance_events_page_idx ON grievance_case_events(tenant_id,case_id,created_at,id);
CREATE INDEX IF NOT EXISTS grievance_messages_page_idx ON grievance_messages(tenant_id,case_id,created_at,id);
CREATE INDEX IF NOT EXISTS grievance_attachments_case_idx ON grievance_attachments(tenant_id,case_id);
CREATE OR REPLACE FUNCTION grievance_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP='DELETE' AND pg_trigger_depth()>1 THEN RETURN OLD; END IF; RAISE EXCEPTION 'Grievance history is append-only'; END $$;
DROP TRIGGER IF EXISTS grievance_events_immutable ON grievance_case_events;
CREATE TRIGGER grievance_events_immutable BEFORE UPDATE OR DELETE ON grievance_case_events FOR EACH ROW EXECUTE FUNCTION grievance_append_only();
DROP TRIGGER IF EXISTS grievance_messages_immutable ON grievance_messages;
CREATE TRIGGER grievance_messages_immutable BEFORE UPDATE OR DELETE ON grievance_messages FOR EACH ROW EXECUTE FUNCTION grievance_append_only();
DO $$ DECLARE table_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['grievance_case_counters','grievance_case_events','grievance_messages','grievance_attachments'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I',table_name);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(tenant_id=NULLIF(current_setting(''app.current_tenant'',true),'''')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting(''app.current_tenant'',true),'''')::uuid)',table_name);
 END LOOP;
END $$;
INSERT INTO grievance_case_events(tenant_id,case_id,actor_id,kind,visibility,metadata,created_at)
 SELECT tenant_id,id,employee_id,'submitted','employee',jsonb_build_object('legacy',true),created_at FROM grievances g WHERE NOT EXISTS(SELECT 1 FROM grievance_case_events e WHERE e.case_id=g.id AND e.tenant_id=g.tenant_id);
-- Per-tenant migration state lives in the existing RLS-protected counter row.
  INSERT INTO tenant_permissions(permission_key,label,description) SELECT 'grievances.'||p.key,p.label,p.label FROM (VALUES('view_own','View own grievances'),('view','View scoped grievances'),('triage','Triage grievances'),('assign','Assign grievances'),('respond','Respond to grievances'),('internal_notes','Add internal notes'),('resolve','Resolve grievances'),('close','Close grievances'),('confidential','Handle confidential grievances'),('configure','Configure grievance destinations')) AS p(key,label) ON CONFLICT(permission_key) DO NOTHING;
  INSERT INTO tenant_role_permissions(tenant_id,role_id,permission_key) SELECT r.tenant_id,r.id,p.permission_key FROM tenant_roles r JOIN grievance_case_counters migration ON migration.tenant_id=r.tenant_id AND NOT migration.permissions_migrated JOIN tenant_permissions p ON p.permission_key LIKE 'grievances.%' WHERE (r.system_key='hr_admin' OR (p.permission_key='grievances.view_own' AND EXISTS(SELECT 1 FROM tenant_role_permissions x WHERE x.role_id=r.id AND x.tenant_id=r.tenant_id AND x.permission_key='grievances.create')) OR (p.permission_key IN ('grievances.view','grievances.triage','grievances.assign','grievances.respond','grievances.internal_notes','grievances.resolve','grievances.close') AND EXISTS(SELECT 1 FROM tenant_role_permissions x WHERE x.role_id=r.id AND x.tenant_id=r.tenant_id AND x.permission_key='grievances.review'))) ON CONFLICT DO NOTHING;
UPDATE grievance_case_counters SET permissions_migrated=true WHERE NOT permissions_migrated;
-- Optional Communications linkage; company history still requires case visibility.
ALTER TABLE communication_messages ADD COLUMN IF NOT EXISTS related_grievance_id uuid;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='communication_grievance_tenant_fk' AND conrelid='communication_messages'::regclass) THEN ALTER TABLE communication_messages ADD CONSTRAINT communication_grievance_tenant_fk FOREIGN KEY(related_grievance_id,tenant_id) REFERENCES grievances(id,tenant_id) ON DELETE CASCADE; END IF; END $$;
CREATE INDEX IF NOT EXISTS communication_grievance_idx ON communication_messages(tenant_id,related_grievance_id) WHERE related_grievance_id IS NOT NULL;
COMMIT;

