BEGIN;
ALTER TABLE router_semantic_examples ADD COLUMN IF NOT EXISTS scope text;
UPDATE router_semantic_examples SET scope=CASE WHEN tenant_id IS NULL THEN 'SYSTEM' ELSE 'TENANT_PRIVATE' END WHERE scope IS NULL;
ALTER TABLE router_semantic_examples ALTER COLUMN scope SET DEFAULT 'TENANT_PRIVATE';
ALTER TABLE router_semantic_examples ALTER COLUMN scope SET NOT NULL;
DO $$ DECLARE x record; BEGIN FOR x IN SELECT conname FROM pg_constraint WHERE conrelid='router_semantic_examples'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%source%' LOOP EXECUTE format('ALTER TABLE router_semantic_examples DROP CONSTRAINT %I',x.conname); END LOOP; END $$;
ALTER TABLE router_semantic_examples ADD CONSTRAINT router_scope_source CHECK((scope='SYSTEM' AND tenant_id IS NULL AND source='system') OR (scope='SHARED' AND tenant_id IS NULL AND source='shared') OR (scope='TENANT_PRIVATE' AND tenant_id IS NOT NULL AND source IN ('tenant','promoted_query')));
CREATE TABLE IF NOT EXISTS router_privacy_settings(tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE, mode text NOT NULL DEFAULT 'PRIVATE' CHECK(mode IN ('SHARED','PRIVATE','STRICT_PRIVATE')),updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS router_platform_authorities(tenant_id uuid NOT NULL,employee_id uuid NOT NULL,capabilities text[] NOT NULL,revoked_at timestamptz,PRIMARY KEY(tenant_id,employee_id),FOREIGN KEY(employee_id,tenant_id) REFERENCES employees(id,tenant_id) ON DELETE CASCADE,CHECK(capabilities <@ ARRAY['view_all','review_global','manage_global','view_tenants','manage_models']::text[]));
ALTER TABLE router_platform_authorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE router_platform_authorities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_authority_read ON router_platform_authorities;
CREATE POLICY platform_authority_read ON router_platform_authorities FOR SELECT USING(tenant_id=NULLIF(current_setting('app.current_tenant',true),'')::uuid);
-- No runtime write policy: authority is provisioned exclusively by the operator connection.
CREATE OR REPLACE FUNCTION stanza_semantic_platform(capability text) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.router_platform_authorities a JOIN public.employees e ON e.tenant_id=a.tenant_id AND e.id=a.employee_id WHERE a.tenant_id=NULLIF(current_setting('app.current_tenant',true),'')::uuid AND a.employee_id=NULLIF(current_setting('app.semantic_actor',true),'')::uuid AND a.revoked_at IS NULL AND capability=ANY(a.capabilities) AND e.is_active AND e.employment_status='active')
$$;
CREATE TABLE IF NOT EXISTS router_shared_candidates(id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,source_example_id uuid REFERENCES router_semantic_examples(id) ON DELETE SET NULL,generalized_text varchar(500) NOT NULL,intent_key varchar(64) NOT NULL,entity_template jsonb,generalization_method text NOT NULL CHECK(generalization_method IN ('typed_entities','generic_vocabulary')),classification text NOT NULL DEFAULT 'needs_review',analysis jsonb NOT NULL DEFAULT '{}',state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','rejected')),shared_example_id uuid REFERENCES router_semantic_examples(id) ON DELETE SET NULL,created_at timestamptz NOT NULL DEFAULT now(),reviewed_at timestamptz,reviewer_reference uuid,UNIQUE(source_example_id));
CREATE TABLE IF NOT EXISTS router_review_history(id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,actor_reference uuid NOT NULL,target_id uuid NOT NULL,action text NOT NULL,metadata jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS router_example_hits(tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,example_id uuid NOT NULL REFERENCES router_semantic_examples(id) ON DELETE CASCADE,day date NOT NULL DEFAULT current_date,hits bigint NOT NULL DEFAULT 0,last_hit timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,example_id,day));
CREATE TABLE IF NOT EXISTS router_http_metrics(tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,day date NOT NULL DEFAULT current_date,kind text NOT NULL CHECK(kind IN ('http','employee','location')),latency_samples double precision[] NOT NULL DEFAULT '{}',CHECK(cardinality(latency_samples)<=256),PRIMARY KEY(tenant_id,day,kind));
ALTER TABLE router_candidates ADD COLUMN IF NOT EXISTS classification text NOT NULL DEFAULT 'needs_review';
ALTER TABLE router_candidates ADD COLUMN IF NOT EXISTS analysis jsonb NOT NULL DEFAULT '{}';
ALTER TABLE router_candidates ADD COLUMN IF NOT EXISTS private_only boolean NOT NULL DEFAULT false;
ALTER TABLE router_candidates ALTER COLUMN private_only SET DEFAULT false;
ALTER TABLE router_semantic_examples ADD COLUMN IF NOT EXISTS source_candidate_id uuid REFERENCES router_candidates(id) ON DELETE SET NULL;
DO $$ DECLARE n text; BEGIN FOREACH n IN ARRAY ARRAY['router_privacy_settings','router_review_history','router_example_hits','router_http_metrics'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',n); EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',n);
 EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I',n);
 EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(tenant_id=NULLIF(current_setting(''app.current_tenant'',true),'''')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting(''app.current_tenant'',true),'''')::uuid)',n);
END LOOP; END $$;
ALTER TABLE router_shared_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE router_shared_candidates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shared_candidate_read ON router_shared_candidates;
DROP POLICY IF EXISTS shared_candidate_insert ON router_shared_candidates;
DROP POLICY IF EXISTS shared_candidate_update ON router_shared_candidates;
CREATE POLICY shared_candidate_read ON router_shared_candidates FOR SELECT USING(tenant_id=NULLIF(current_setting('app.current_tenant',true),'')::uuid OR stanza_semantic_platform('view_all') OR stanza_semantic_platform('review_global'));
CREATE POLICY shared_candidate_insert ON router_shared_candidates FOR INSERT WITH CHECK(tenant_id=NULLIF(current_setting('app.current_tenant',true),'')::uuid AND EXISTS(SELECT 1 FROM router_privacy_settings p WHERE p.tenant_id=router_shared_candidates.tenant_id AND p.mode='SHARED'));
CREATE POLICY shared_candidate_update ON router_shared_candidates FOR UPDATE USING(stanza_semantic_platform('review_global')) WITH CHECK(stanza_semantic_platform('review_global'));
DROP POLICY IF EXISTS router_examples_read ON router_semantic_examples;
CREATE POLICY router_examples_read ON router_semantic_examples FOR SELECT USING(scope='SYSTEM' OR (scope='SHARED' AND (stanza_semantic_platform('view_all') OR stanza_semantic_platform('review_global') OR NOT EXISTS(SELECT 1 FROM router_privacy_settings p WHERE p.tenant_id=NULLIF(current_setting('app.current_tenant',true),'')::uuid AND p.mode='STRICT_PRIVATE'))) OR tenant_id=NULLIF(current_setting('app.current_tenant',true),'')::uuid);
DROP POLICY IF EXISTS platform_examples_write ON router_semantic_examples;
CREATE POLICY platform_examples_write ON router_semantic_examples FOR ALL USING(scope IN ('SYSTEM','SHARED') AND stanza_semantic_platform('manage_global')) WITH CHECK(scope IN ('SYSTEM','SHARED') AND tenant_id IS NULL AND stanza_semantic_platform('manage_global'));
DROP POLICY IF EXISTS semantic_platform_tenants ON tenants;
CREATE POLICY semantic_platform_tenants ON tenants FOR SELECT USING(stanza_semantic_platform('view_tenants') OR stanza_semantic_platform('view_all'));
INSERT INTO tenant_permissions(permission_key,label,description) VALUES
('semantic.view_analytics','View semantic analytics','Read tenant semantic analytics.'),('semantic.review_candidates','Review semantic candidates','Review tenant learned examples.'),('semantic.manage_examples','Manage semantic examples','Manage tenant-private learned examples.'),('semantic.manage_privacy','Manage semantic privacy','Change tenant semantic learning privacy.'),
('platform.semantic.view_all','View platform semantic intelligence','Operator authority only.'),('platform.semantic.review_global','Review shared learning','Operator authority only.'),('platform.semantic.manage_global','Manage global corpus','Operator authority only.'),('platform.semantic.view_tenants','View platform tenants','Operator authority only.'),('platform.semantic.manage_models','Inspect platform models','Operator authority only.') ON CONFLICT(permission_key) DO NOTHING;
INSERT INTO tenant_role_permissions(tenant_id,role_id,permission_key) SELECT r.tenant_id,r.id,p.permission_key FROM tenant_roles r CROSS JOIN tenant_permissions p WHERE r.system_key='hr_admin' AND p.permission_key LIKE 'semantic.%' ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION stanza_semantic_scope_default() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$ BEGIN IF NEW.tenant_id IS NULL AND NEW.source='system' AND NEW.scope='TENANT_PRIVATE' THEN NEW.scope='SYSTEM'; END IF; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS router_scope_default ON router_semantic_examples;
CREATE TRIGGER router_scope_default BEFORE INSERT ON router_semantic_examples FOR EACH ROW EXECUTE FUNCTION stanza_semantic_scope_default();
DELETE FROM tenant_role_permissions WHERE permission_key LIKE 'platform.semantic.%';
DROP POLICY IF EXISTS semantic_platform_grant_guard ON tenant_role_permissions;
CREATE POLICY semantic_platform_grant_guard ON tenant_role_permissions AS RESTRICTIVE FOR ALL USING(permission_key NOT LIKE 'platform.%') WITH CHECK(permission_key NOT LIKE 'platform.%');
COMMIT;
