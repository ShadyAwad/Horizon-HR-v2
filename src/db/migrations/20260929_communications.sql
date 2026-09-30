BEGIN;
CREATE TABLE IF NOT EXISTS communication_templates (
 id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120), subject text NOT NULL CHECK(length(subject) BETWEEN 1 AND 200),
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 20000), category text NOT NULL,
 active boolean NOT NULL DEFAULT true, allowed_variables text[] NOT NULL DEFAULT '{}', created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,tenant_id), FOREIGN KEY(created_by,tenant_id) REFERENCES employees(id,tenant_id)
);
CREATE TABLE IF NOT EXISTS communication_meetings (
 id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 organizer_id uuid NOT NULL, title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200), notes text NOT NULL DEFAULT '',
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, timezone text NOT NULL,
 location text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','completed','cancelled')),
 related_employee_id uuid, version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(ends_at>starts_at), UNIQUE(id,tenant_id),
 FOREIGN KEY(organizer_id,tenant_id) REFERENCES employees(id,tenant_id),
 FOREIGN KEY(related_employee_id,tenant_id) REFERENCES employees(id,tenant_id)
);
CREATE TABLE IF NOT EXISTS communication_meeting_attendees (
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, meeting_id uuid NOT NULL, employee_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,meeting_id,employee_id),
 FOREIGN KEY(meeting_id,tenant_id) REFERENCES communication_meetings(id,tenant_id) ON DELETE CASCADE,
 FOREIGN KEY(employee_id,tenant_id) REFERENCES employees(id,tenant_id)
);
-- Drafts share the immutable message lifecycle, but remain private to their sender.
CREATE TABLE IF NOT EXISTS communication_messages (
 id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 sender_id uuid NOT NULL, template_id uuid, subject text NOT NULL DEFAULT '', body text NOT NULL DEFAULT '', body_json jsonb,
 category text NOT NULL DEFAULT 'custom', status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','queued','sending','sent','failed','cancelled')),
 recipient_ids uuid[] NOT NULL DEFAULT '{}', recipients text[] NOT NULL DEFAULT '{}',
 related_employee_id uuid, related_candidate_id uuid, related_meeting_id uuid,
 variables jsonb NOT NULL DEFAULT '{}', provider_id text, failure_code text, failure_reason text,
 queued_at timestamptz, scheduled_at timestamptz, sent_at timestamptz, first_attempt_at timestamptz,
 attempts integer NOT NULL DEFAULT 0, version integer NOT NULL DEFAULT 1, invitation_ics text, invitation_key text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,tenant_id), UNIQUE(tenant_id,invitation_key),
 FOREIGN KEY(sender_id,tenant_id) REFERENCES employees(id,tenant_id),
 FOREIGN KEY(template_id,tenant_id) REFERENCES communication_templates(id,tenant_id),
 FOREIGN KEY(related_employee_id,tenant_id) REFERENCES employees(id,tenant_id),
 FOREIGN KEY(related_candidate_id,tenant_id) REFERENCES hiring_applicants(id,tenant_id),
 FOREIGN KEY(related_meeting_id,tenant_id) REFERENCES communication_meetings(id,tenant_id),
 CHECK(num_nonnulls(related_employee_id,related_candidate_id,related_meeting_id)<=1)
);
CREATE TABLE IF NOT EXISTS communication_message_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 message_id uuid NOT NULL, status text NOT NULL, code text, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(message_id,tenant_id) REFERENCES communication_messages(id,tenant_id) ON DELETE CASCADE
);
-- Arrays are bounded and checked against the same tenant, including direct database writes.
CREATE OR REPLACE FUNCTION validate_communication_recipients() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF cardinality(NEW.recipient_ids)>20 OR EXISTS (
  SELECT 1 FROM unnest(NEW.recipient_ids) recipient_id
  WHERE NOT EXISTS (SELECT 1 FROM employees e WHERE e.id=recipient_id AND e.tenant_id=NEW.tenant_id)
 ) THEN RAISE EXCEPTION 'Invalid company recipients' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS communication_recipients_tenant ON communication_messages;
CREATE TRIGGER communication_recipients_tenant BEFORE INSERT OR UPDATE OF recipient_ids,tenant_id ON communication_messages
FOR EACH ROW EXECUTE FUNCTION validate_communication_recipients();
CREATE INDEX IF NOT EXISTS communication_messages_list ON communication_messages(tenant_id,sender_id,created_at DESC);
CREATE INDEX IF NOT EXISTS communication_messages_status ON communication_messages(tenant_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS communication_meetings_list ON communication_meetings(tenant_id,starts_at);
CREATE INDEX IF NOT EXISTS communication_events_message ON communication_message_events(tenant_id,message_id,id);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['communication_templates','communication_messages','communication_message_events','communication_meetings','communication_meeting_attendees'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tab);
 EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I',tab);
 EXECUTE format($p$CREATE POLICY tenant_isolation ON %I USING(tenant_id=NULLIF(current_setting('app.current_tenant',true),'')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting('app.current_tenant',true),'')::uuid)$p$,tab);
 END LOOP;
END $$;
INSERT INTO tenant_permissions(permission_key,label,description) VALUES
 ('communications.view','View own communications','Read own messages and active templates.'),
 ('communications.send','Send communications','Compose and queue company messages.'),
 ('communications.templates.manage','Manage communication templates','Create, edit and deactivate company templates.'),
 ('communications.history.view','View company communication history','View non-draft company messages; contains sensitive HR content.'),
 ('communications.meetings.view','View meetings','View meetings organized by or including you.'),
 ('communications.meetings.manage','Manage meetings','Create and manage company meetings.')
ON CONFLICT(permission_key) DO NOTHING;
INSERT INTO tenant_role_permissions(tenant_id,role_id,permission_key)
SELECT r.tenant_id,r.id,p.permission_key FROM tenant_roles r CROSS JOIN tenant_permissions p
WHERE r.system_key='hr_admin' AND p.permission_key LIKE 'communications.%' ON CONFLICT DO NOTHING;
COMMIT;
