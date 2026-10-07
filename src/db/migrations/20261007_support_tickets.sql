BEGIN;
CREATE TABLE IF NOT EXISTS support_tickets (
 id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 requester_id uuid NOT NULL,asset_id uuid,assigned_to uuid,evidence_report_id uuid,
 issue_type text NOT NULL CHECK(issue_type IN ('damage','it_help','equipment_issue')),
 summary varchar(180) NOT NULL,description varchar(4000) NOT NULL,urgency text NOT NULL CHECK(urgency IN ('normal','high')),
 follow_up varchar(200),status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','waiting_requester','resolved','closed')),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,tenant_id),FOREIGN KEY(requester_id,tenant_id) REFERENCES employees(id,tenant_id) ON DELETE CASCADE,
 FOREIGN KEY(asset_id,tenant_id) REFERENCES assets(id,tenant_id),FOREIGN KEY(assigned_to,tenant_id) REFERENCES employees(id,tenant_id)
);
CREATE TABLE IF NOT EXISTS support_ticket_events (
 id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 ticket_id uuid NOT NULL,actor_id uuid NOT NULL,status text NOT NULL,note varchar(2000),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(ticket_id,tenant_id) REFERENCES support_tickets(id,tenant_id) ON DELETE CASCADE,
 FOREIGN KEY(actor_id,tenant_id) REFERENCES employees(id,tenant_id)
);
CREATE INDEX IF NOT EXISTS support_tickets_queue ON support_tickets(tenant_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_requester ON support_tickets(tenant_id,requester_id,created_at DESC);
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;ALTER TABLE support_tickets FORCE ROW LEVEL SECURITY;
ALTER TABLE support_ticket_events ENABLE ROW LEVEL SECURITY;ALTER TABLE support_ticket_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS support_tenant ON support_tickets;
CREATE POLICY support_tenant ON support_tickets USING(tenant_id=NULLIF(current_setting('app.current_tenant',true),'')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting('app.current_tenant',true),'')::uuid);
DROP POLICY IF EXISTS support_tenant ON support_ticket_events;
CREATE POLICY support_tenant ON support_ticket_events USING(tenant_id=NULLIF(current_setting('app.current_tenant',true),'')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting('app.current_tenant',true),'')::uuid);
INSERT INTO tenant_permissions(permission_key,label,description) VALUES('support.view','View support queue','View same-company IT and equipment requests.'),('support.manage','Handle support tickets','Assign and update same-company support requests.') ON CONFLICT DO NOTHING;
INSERT INTO tenant_role_permissions(tenant_id,role_id,permission_key) SELECT t.tenant_id,t.id,p.key FROM tenant_roles t CROSS JOIN (VALUES('support.view'),('support.manage')) p(key) WHERE t.system_key='hr_admin' ON CONFLICT DO NOTHING;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='asset_reports_id_tenant_unique') THEN ALTER TABLE asset_condition_reports ADD CONSTRAINT asset_reports_id_tenant_unique UNIQUE(id,tenant_id); END IF;
IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='support_evidence_tenant_fk') THEN ALTER TABLE support_tickets ADD CONSTRAINT support_evidence_tenant_fk FOREIGN KEY(evidence_report_id,tenant_id) REFERENCES asset_condition_reports(id,tenant_id); END IF;END $$;

COMMIT;
