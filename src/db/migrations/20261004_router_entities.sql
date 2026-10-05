BEGIN;
-- Pure invoker function: no data access and no RLS bypass.
CREATE OR REPLACE FUNCTION stanza_entity_normalize(value text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
 SELECT btrim(regexp_replace(regexp_replace(translate(lower(normalize(value,NFKC)), 'أإآىة', 'ااايه'), '[ً-ٰٟـ]', '', 'g'), '[^[:alnum:]]+', ' ', 'g'))
$$;
CREATE INDEX IF NOT EXISTS employee_entity_tokens ON employees USING gin (regexp_split_to_array(stanza_entity_normalize(full_name),' '));
CREATE INDEX IF NOT EXISTS location_entity_tokens ON company_locations USING gin (regexp_split_to_array(stanza_entity_normalize(name),' '));
ALTER TABLE router_candidates ADD COLUMN IF NOT EXISTS entity_template jsonb;
ALTER TABLE router_semantic_examples ADD COLUMN IF NOT EXISTS entity_template jsonb;
ALTER TABLE router_candidates DROP CONSTRAINT IF EXISTS router_candidates_resolution_source_check;
ALTER TABLE router_candidates ADD CONSTRAINT router_candidates_resolution_source_check CHECK(resolution_source IN ('llm','entity'));
COMMIT;
