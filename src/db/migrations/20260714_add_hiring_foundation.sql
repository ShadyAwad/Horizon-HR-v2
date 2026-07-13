BEGIN;

INSERT INTO tenant_permissions (permission_key,label,description) VALUES
('hiring.view','View hiring candidates','View applicants assigned or available to the hiring team.'),
('hiring.create','Create hiring candidates','Create applicant records.'),
('hiring.edit','Edit hiring candidates','Edit applicant details.'),
('hiring.add_notes','Add hiring notes','Add internal applicant notes.'),
('hiring.view_notes','View hiring notes','View internal applicant notes.'),
('hiring.assign','Assign hiring candidates','Assign and hand off applicants.'),
('hiring.advance_stage','Advance hiring stages','Move applicants through permitted stages.'),
('hiring.make_final_decision','Make hiring decisions','Approve offers and final outcomes.'),
('hiring.archive','Archive hiring candidates','Archive applicant records.')
ON CONFLICT(permission_key) DO UPDATE SET label=EXCLUDED.label,description=EXCLUDED.description;

CREATE TABLE IF NOT EXISTS hiring_applicants (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 full_name TEXT NOT NULL, email TEXT, phone TEXT, position_title TEXT NOT NULL, department TEXT, source TEXT,
 stage TEXT NOT NULL DEFAULT 'new', status TEXT NOT NULL DEFAULT 'active', current_owner_id UUID, created_by UUID NOT NULL, updated_by UUID,
 applied_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), archived_at TIMESTAMPTZ,
 CONSTRAINT hiring_applicants_id_tenant_unique UNIQUE(id,tenant_id),
 CONSTRAINT hiring_applicants_owner_tenant_fk FOREIGN KEY(current_owner_id,tenant_id) REFERENCES employees(id,tenant_id) ON DELETE SET NULL (current_owner_id),
 CONSTRAINT hiring_applicants_created_by_tenant_fk FOREIGN KEY(created_by,tenant_id) REFERENCES employees(id,tenant_id) ON DELETE RESTRICT,
 CONSTRAINT hiring_applicants_updated_by_tenant_fk FOREIGN KEY(updated_by,tenant_id) REFERENCES employees(id,tenant_id) ON DELETE SET NULL (updated_by),
 CONSTRAINT hiring_applicants_name_chk CHECK(length(btrim(full_name)) BETWEEN 1 AND 160),
 CONSTRAINT hiring_applicants_position_chk CHECK(length(btrim(position_title)) BETWEEN 1 AND 160),
 CONSTRAINT hiring_applicants_stage_chk CHECK(stage IN('new','screening','hr_review','hiring_manager_review','interview','final_review','offer','hired','rejected','withdrawn')),
 CONSTRAINT hiring_applicants_status_chk CHECK(status IN('active','archived'))
);
CREATE INDEX IF NOT EXISTS hiring_applicants_tenant_stage_created_idx ON hiring_applicants(tenant_id,stage,created_at DESC);
CREATE INDEX IF NOT EXISTS hiring_applicants_tenant_owner_stage_idx ON hiring_applicants(tenant_id,current_owner_id,stage);
CREATE INDEX IF NOT EXISTS hiring_applicants_tenant_status_created_idx ON hiring_applicants(tenant_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS hiring_applicants_tenant_email_idx ON hiring_applicants(tenant_id,lower(email)) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS hiring_applicant_notes (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,applicant_id UUID NOT NULL,author_id UUID NOT NULL,
 note_text TEXT NOT NULL,note_type TEXT NOT NULL DEFAULT 'general',visibility TEXT NOT NULL DEFAULT 'hiring_team',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ,deleted_at TIMESTAMPTZ,
 CONSTRAINT hiring_notes_applicant_tenant_fk FOREIGN KEY(applicant_id,tenant_id) REFERENCES hiring_applicants(id,tenant_id) ON DELETE CASCADE,
 CONSTRAINT hiring_notes_author_tenant_fk FOREIGN KEY(author_id,tenant_id) REFERENCES employees(id,tenant_id) ON DELETE RESTRICT,
 CONSTRAINT hiring_notes_text_chk CHECK(length(btrim(note_text)) BETWEEN 1 AND 5000),
 CONSTRAINT hiring_notes_type_chk CHECK(note_type IN('general','screening','interview','decision','handoff')),
 CONSTRAINT hiring_notes_visibility_chk CHECK(visibility IN('hiring_team','hr_only'))
);
CREATE INDEX IF NOT EXISTS hiring_notes_tenant_applicant_created_idx ON hiring_applicant_notes(tenant_id,applicant_id,created_at DESC);

CREATE TABLE IF NOT EXISTS hiring_handoffs (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,applicant_id UUID NOT NULL,from_user_id UUID,to_user_id UUID NOT NULL,handed_off_by UUID NOT NULL,
 from_stage TEXT,to_stage TEXT,message TEXT,status TEXT NOT NULL DEFAULT 'pending',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),acknowledged_at TIMESTAMPTZ,completed_at TIMESTAMPTZ,
 CONSTRAINT hiring_handoffs_applicant_tenant_fk FOREIGN KEY(applicant_id,tenant_id) REFERENCES hiring_applicants(id,tenant_id) ON DELETE CASCADE,
 CONSTRAINT hiring_handoffs_from_tenant_fk FOREIGN KEY(from_user_id,tenant_id) REFERENCES employees(id,tenant_id) ON DELETE SET NULL (from_user_id),
 CONSTRAINT hiring_handoffs_to_tenant_fk FOREIGN KEY(to_user_id,tenant_id) REFERENCES employees(id,tenant_id) ON DELETE RESTRICT,
 CONSTRAINT hiring_handoffs_by_tenant_fk FOREIGN KEY(handed_off_by,tenant_id) REFERENCES employees(id,tenant_id) ON DELETE RESTRICT,
 CONSTRAINT hiring_handoffs_stage_chk CHECK((from_stage IS NULL OR from_stage IN('new','screening','hr_review','hiring_manager_review','interview','final_review','offer','hired','rejected','withdrawn')) AND (to_stage IS NULL OR to_stage IN('new','screening','hr_review','hiring_manager_review','interview','final_review','offer','hired','rejected','withdrawn'))),
 CONSTRAINT hiring_handoffs_status_chk CHECK(status IN('pending','acknowledged','completed','cancelled')),CONSTRAINT hiring_handoffs_message_chk CHECK(message IS NULL OR length(message)<=2000)
);
CREATE INDEX IF NOT EXISTS hiring_handoffs_tenant_recipient_status_idx ON hiring_handoffs(tenant_id,to_user_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS hiring_handoffs_tenant_applicant_created_idx ON hiring_handoffs(tenant_id,applicant_id,created_at DESC);

CREATE TABLE IF NOT EXISTS hiring_stage_history (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,applicant_id UUID NOT NULL,actor_id UUID NOT NULL,previous_stage TEXT,new_stage TEXT NOT NULL,reason TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CONSTRAINT hiring_stage_history_applicant_tenant_fk FOREIGN KEY(applicant_id,tenant_id) REFERENCES hiring_applicants(id,tenant_id) ON DELETE CASCADE,
 CONSTRAINT hiring_stage_history_actor_tenant_fk FOREIGN KEY(actor_id,tenant_id) REFERENCES employees(id,tenant_id) ON DELETE RESTRICT,
 CONSTRAINT hiring_stage_history_stage_chk CHECK((previous_stage IS NULL OR previous_stage IN('new','screening','hr_review','hiring_manager_review','interview','final_review','offer','hired','rejected','withdrawn')) AND new_stage IN('new','screening','hr_review','hiring_manager_review','interview','final_review','offer','hired','rejected','withdrawn')),
 CONSTRAINT hiring_stage_history_reason_chk CHECK(reason IS NULL OR length(reason)<=2000)
);
CREATE INDEX IF NOT EXISTS hiring_stage_history_tenant_applicant_created_idx ON hiring_stage_history(tenant_id,applicant_id,created_at DESC);

ALTER TABLE hiring_applicants ENABLE ROW LEVEL SECURITY; ALTER TABLE hiring_applicant_notes ENABLE ROW LEVEL SECURITY; ALTER TABLE hiring_handoffs ENABLE ROW LEVEL SECURITY; ALTER TABLE hiring_stage_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hiring_applicants_tenant_isolation ON hiring_applicants; CREATE POLICY hiring_applicants_tenant_isolation ON hiring_applicants USING(tenant_id=NULLIF(current_setting('app.current_tenant',true),'')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting('app.current_tenant',true),'')::uuid);
DROP POLICY IF EXISTS hiring_notes_tenant_isolation ON hiring_applicant_notes; CREATE POLICY hiring_notes_tenant_isolation ON hiring_applicant_notes USING(tenant_id=NULLIF(current_setting('app.current_tenant',true),'')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting('app.current_tenant',true),'')::uuid);
DROP POLICY IF EXISTS hiring_handoffs_tenant_isolation ON hiring_handoffs; CREATE POLICY hiring_handoffs_tenant_isolation ON hiring_handoffs USING(tenant_id=NULLIF(current_setting('app.current_tenant',true),'')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting('app.current_tenant',true),'')::uuid);
DROP POLICY IF EXISTS hiring_stage_history_tenant_isolation ON hiring_stage_history; CREATE POLICY hiring_stage_history_tenant_isolation ON hiring_stage_history USING(tenant_id=NULLIF(current_setting('app.current_tenant',true),'')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting('app.current_tenant',true),'')::uuid);

INSERT INTO tenant_role_permissions(tenant_id,role_id,permission_key)
SELECT tr.tenant_id,tr.id,p.permission_key FROM tenant_roles tr CROSS JOIN tenant_permissions p WHERE tr.system_key='hr_admin' AND p.permission_key LIKE 'hiring.%'
ON CONFLICT(tenant_id,role_id,permission_key) DO NOTHING;
INSERT INTO tenant_role_permissions(tenant_id,role_id,permission_key)
SELECT tr.tenant_id,tr.id,p.key FROM tenant_roles tr JOIN (VALUES('hiring.view'),('hiring.add_notes'),('hiring.view_notes'),('hiring.assign'),('hiring.advance_stage')) p(key) ON true WHERE tr.system_key='manager'
ON CONFLICT(tenant_id,role_id,permission_key) DO NOTHING;

COMMIT;
