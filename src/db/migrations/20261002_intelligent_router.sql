BEGIN;
CREATE EXTENSION IF NOT EXISTS vector;
-- Variable dimensions support provider changes; retrieval must filter the complete space.
CREATE TABLE IF NOT EXISTS router_semantic_examples (
 id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
 intent_key varchar(64) NOT NULL, example_text varchar(500) NOT NULL, normalized_text varchar(500) NOT NULL,
 embedding vector NOT NULL, embedding_model varchar(120) NOT NULL, embedding_dimensions integer NOT NULL CHECK(embedding_dimensions BETWEEN 1 AND 2000), embedding_version varchar(80) NOT NULL,
 source varchar(24) NOT NULL CHECK(source IN ('system','tenant','promoted_query')),
 approval_state varchar(24) NOT NULL CHECK(approval_state IN ('approved','disabled')),
 created_at timestamptz NOT NULL DEFAULT now(), approved_at timestamptz NOT NULL DEFAULT now(), approved_by uuid,
 CHECK(vector_dims(embedding)=embedding_dimensions), CHECK(length(normalized_text)>0),
 CHECK((tenant_id IS NULL AND source='system') OR (tenant_id IS NOT NULL AND source<>'system')),
 FOREIGN KEY(approved_by,tenant_id) REFERENCES employees(id,tenant_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS router_example_duplicate ON router_semantic_examples(COALESCE(tenant_id,'00000000-0000-0000-0000-000000000000'::uuid),normalized_text,embedding_model,embedding_dimensions,embedding_version);
CREATE INDEX IF NOT EXISTS router_example_space ON router_semantic_examples(tenant_id,embedding_model,embedding_dimensions,embedding_version) WHERE approval_state='approved';
ALTER TABLE router_semantic_examples ENABLE ROW LEVEL SECURITY;
ALTER TABLE router_semantic_examples FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS router_examples_read ON router_semantic_examples;
CREATE POLICY router_examples_read ON router_semantic_examples FOR SELECT USING(tenant_id IS NULL OR tenant_id=NULLIF(current_setting('app.current_tenant',true),'')::uuid);
DROP POLICY IF EXISTS router_examples_write ON router_semantic_examples;
CREATE POLICY router_examples_write ON router_semantic_examples FOR ALL USING(tenant_id=NULLIF(current_setting('app.current_tenant',true),'')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting('app.current_tenant',true),'')::uuid);
CREATE TABLE IF NOT EXISTS router_candidates (
 id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, employee_id uuid NOT NULL,
 normalized_query varchar(500) NOT NULL CHECK(length(normalized_query)>0), proposed_intent varchar(64) NOT NULL,
 resolution_source varchar(10) NOT NULL DEFAULT 'llm' CHECK(resolution_source='llm'),
 confirmation_state varchar(20) NOT NULL DEFAULT 'pending' CHECK(confirmation_state IN ('pending','confirmed')),
 review_state varchar(20) NOT NULL DEFAULT 'pending' CHECK(review_state IN ('pending','approved','rejected')),
 embedding_status varchar(20) NOT NULL DEFAULT 'pending' CHECK(embedding_status IN ('pending','embedded')),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '30 days', reviewed_at timestamptz, reviewed_by uuid,
 FOREIGN KEY(employee_id,tenant_id) REFERENCES employees(id,tenant_id), FOREIGN KEY(reviewed_by,tenant_id) REFERENCES employees(id,tenant_id),
 UNIQUE(tenant_id,employee_id,normalized_query,proposed_intent)
);
CREATE TABLE IF NOT EXISTS router_daily_metrics (
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, day date NOT NULL DEFAULT current_date, method varchar(10) NOT NULL, outcome varchar(32) NOT NULL, intent_key varchar(64) NOT NULL DEFAULT '',
 requests bigint NOT NULL DEFAULT 0, latency_ms double precision NOT NULL DEFAULT 0, semantic_score_sum double precision NOT NULL DEFAULT 0, semantic_margin_sum double precision NOT NULL DEFAULT 0, semantic_samples bigint NOT NULL DEFAULT 0,
 fallbacks bigint NOT NULL DEFAULT 0, candidates bigint NOT NULL DEFAULT 0, promotions bigint NOT NULL DEFAULT 0,
 PRIMARY KEY(tenant_id,day,method,outcome,intent_key)
);
CREATE TABLE IF NOT EXISTS router_vector_metrics (
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, day date NOT NULL DEFAULT current_date,
 embedding_model varchar(120) NOT NULL, embedding_dimensions integer NOT NULL, embedding_version varchar(80) NOT NULL,
 queries bigint NOT NULL DEFAULT 0, semantic_row_count bigint NOT NULL DEFAULT 0,
 latency_samples double precision[] NOT NULL DEFAULT '{}', CHECK(cardinality(latency_samples)<=256),
 PRIMARY KEY(tenant_id,day,embedding_model,embedding_dimensions,embedding_version)
);
DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['router_candidates','router_daily_metrics','router_vector_metrics'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',n);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',n);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I',n);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(tenant_id=NULLIF(current_setting(''app.current_tenant'',true),'''')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting(''app.current_tenant'',true),'''')::uuid)',n);
 END LOOP;
END $$;
-- No ANN indexes by default. Development harness builds each strategy in a temp corpus.
COMMIT;
