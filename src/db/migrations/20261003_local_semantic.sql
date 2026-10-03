BEGIN;
ALTER TABLE router_daily_metrics ADD COLUMN IF NOT EXISTS semantic_after_promotion bigint NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS router_embedding_metrics (
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, day date NOT NULL DEFAULT current_date,
 embedding_model varchar(120) NOT NULL, embedding_dimensions integer NOT NULL, embedding_version varchar(80) NOT NULL,
 queries bigint NOT NULL DEFAULT 0, latency_samples double precision[] NOT NULL DEFAULT '{}', CHECK(cardinality(latency_samples)<=256),
 PRIMARY KEY(tenant_id,day,embedding_model,embedding_dimensions,embedding_version)
);
ALTER TABLE router_embedding_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE router_embedding_metrics FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON router_embedding_metrics;
CREATE POLICY tenant_isolation ON router_embedding_metrics USING(tenant_id=NULLIF(current_setting('app.current_tenant',true),'')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting('app.current_tenant',true),'')::uuid);
COMMIT;
