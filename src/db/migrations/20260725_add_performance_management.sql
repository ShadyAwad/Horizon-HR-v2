BEGIN;

INSERT INTO tenant_permissions (permission_key, label, description) VALUES
  ('performance.view', 'View performance', 'View authorised performance records.'),
  ('performance.manage_cycles', 'Manage review cycles', 'Create and manage performance review cycles.'),
  ('performance.manage_templates', 'Manage review templates', 'Create and manage reusable review templates.'),
  ('performance.review', 'Complete performance reviews', 'Complete assigned performance evaluations.'),
  ('performance.view_reports', 'View performance reports', 'View authorised direct-report performance reports.'),
  ('performance.manage_goals', 'Manage performance goals', 'Create and manage authorised employee goals.'),
  ('performance.manage_recognition', 'Manage recognition', 'Award and manage employee recognition.')
ON CONFLICT (permission_key) DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description;

CREATE TABLE IF NOT EXISTS performance_review_cycles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  review_period_start DATE NOT NULL,
  review_period_end DATE NOT NULL,
  self_review_opens_at TIMESTAMPTZ,
  self_review_due_at TIMESTAMPTZ,
  peer_review_due_at TIMESTAMPTZ,
  manager_review_due_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by UUID,
  finalised_by UUID,
  finalised_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT performance_review_cycles_tenant_unique UNIQUE (id, tenant_id),
  CONSTRAINT performance_review_cycles_created_by_fk FOREIGN KEY (created_by, tenant_id) REFERENCES employees(id, tenant_id) ON DELETE SET NULL (created_by),
  CONSTRAINT performance_review_cycles_finalised_by_fk FOREIGN KEY (finalised_by, tenant_id) REFERENCES employees(id, tenant_id) ON DELETE SET NULL (finalised_by),
  CONSTRAINT performance_review_cycles_name_chk CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  CONSTRAINT performance_review_cycles_period_chk CHECK (review_period_end >= review_period_start),
  CONSTRAINT performance_review_cycles_status_chk CHECK (status IN ('draft', 'scheduled', 'active', 'calibration', 'finalised', 'cancelled'))
);
CREATE INDEX IF NOT EXISTS performance_review_cycles_tenant_status_period_idx ON performance_review_cycles(tenant_id, status, review_period_start DESC);

CREATE TABLE IF NOT EXISTS performance_review_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT performance_review_templates_tenant_unique UNIQUE (id, tenant_id),
  CONSTRAINT performance_review_templates_created_by_fk FOREIGN KEY (created_by, tenant_id) REFERENCES employees(id, tenant_id) ON DELETE SET NULL (created_by),
  CONSTRAINT performance_review_templates_name_chk CHECK (length(btrim(name)) BETWEEN 1 AND 160)
);
CREATE INDEX IF NOT EXISTS performance_review_templates_tenant_active_idx ON performance_review_templates(tenant_id, is_active, created_at DESC);

CREATE TABLE IF NOT EXISTS performance_review_questions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  template_id UUID NOT NULL,
  prompt TEXT NOT NULL,
  question_type TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  min_score NUMERIC(6,2),
  max_score NUMERIC(6,2),
  weight NUMERIC(10,4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT performance_review_questions_template_fk FOREIGN KEY (template_id, tenant_id) REFERENCES performance_review_templates(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT performance_review_questions_prompt_chk CHECK (length(btrim(prompt)) BETWEEN 1 AND 2000),
  CONSTRAINT performance_review_questions_type_chk CHECK (question_type IN ('rating', 'text', 'long_text', 'yes_no')),
  CONSTRAINT performance_review_questions_order_chk CHECK (sort_order >= 0),
  CONSTRAINT performance_review_questions_score_chk CHECK ((question_type = 'rating' AND min_score IS NOT NULL AND max_score IS NOT NULL AND min_score < max_score) OR (question_type <> 'rating' AND min_score IS NULL AND max_score IS NULL)),
  CONSTRAINT performance_review_questions_weight_chk CHECK (weight IS NULL OR weight >= 0),
  CONSTRAINT performance_review_questions_unique_order UNIQUE (tenant_id, template_id, sort_order)
);

CREATE TABLE IF NOT EXISTS performance_reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cycle_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  manager_id UUID,
  template_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  overall_score NUMERIC(8,3),
  final_summary TEXT,
  finalised_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT performance_reviews_cycle_fk FOREIGN KEY (cycle_id, tenant_id) REFERENCES performance_review_cycles(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT performance_reviews_employee_fk FOREIGN KEY (employee_id, tenant_id) REFERENCES employees(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT performance_reviews_manager_fk FOREIGN KEY (manager_id, tenant_id) REFERENCES employees(id, tenant_id) ON DELETE SET NULL (manager_id),
  CONSTRAINT performance_reviews_template_fk FOREIGN KEY (template_id, tenant_id) REFERENCES performance_review_templates(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT performance_reviews_status_chk CHECK (status IN ('pending', 'self_review', 'peer_review', 'manager_review', 'calibration', 'completed', 'cancelled')),
  CONSTRAINT performance_reviews_unique_employee_cycle UNIQUE (tenant_id, cycle_id, employee_id)
);
CREATE INDEX IF NOT EXISTS performance_reviews_tenant_cycle_employee_status_idx ON performance_reviews(tenant_id, cycle_id, employee_id, status);
CREATE INDEX IF NOT EXISTS performance_reviews_tenant_manager_status_idx ON performance_reviews(tenant_id, manager_id, status);

CREATE TABLE IF NOT EXISTS performance_review_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  review_id UUID NOT NULL,
  reviewer_employee_id UUID NOT NULL,
  reviewer_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  due_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  confidential_to_subject BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT performance_assignments_review_fk FOREIGN KEY (review_id, tenant_id) REFERENCES performance_reviews(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT performance_assignments_reviewer_fk FOREIGN KEY (reviewer_employee_id, tenant_id) REFERENCES employees(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT performance_assignments_type_chk CHECK (reviewer_type IN ('self', 'manager', 'peer')),
  CONSTRAINT performance_assignments_status_chk CHECK (status IN ('pending', 'in_progress', 'submitted', 'overdue', 'cancelled')),
  CONSTRAINT performance_assignments_unique_reviewer UNIQUE (tenant_id, review_id, reviewer_employee_id)
);
CREATE INDEX IF NOT EXISTS performance_assignments_tenant_reviewer_status_due_idx ON performance_review_assignments(tenant_id, reviewer_employee_id, status, due_at);

CREATE TABLE IF NOT EXISTS performance_review_responses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  assignment_id UUID NOT NULL,
  question_id UUID NOT NULL,
  score NUMERIC(8,3),
  response_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT performance_responses_assignment_fk FOREIGN KEY (assignment_id, tenant_id) REFERENCES performance_review_assignments(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT performance_responses_question_fk FOREIGN KEY (question_id, tenant_id) REFERENCES performance_review_questions(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT performance_responses_unique_question UNIQUE (tenant_id, assignment_id, question_id),
  CONSTRAINT performance_responses_content_chk CHECK (score IS NOT NULL OR response_text IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS performance_responses_tenant_assignment_idx ON performance_review_responses(tenant_id, assignment_id);

CREATE TABLE IF NOT EXISTS performance_goals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL,
  cycle_id UUID,
  title TEXT NOT NULL,
  description TEXT,
  goal_type TEXT NOT NULL DEFAULT 'goal',
  progress_percent INTEGER NOT NULL DEFAULT 0,
  target_value NUMERIC,
  current_value NUMERIC,
  unit TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  starts_at DATE,
  due_at DATE,
  created_by UUID,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT performance_goals_employee_fk FOREIGN KEY (employee_id, tenant_id) REFERENCES employees(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT performance_goals_cycle_fk FOREIGN KEY (cycle_id, tenant_id) REFERENCES performance_review_cycles(id, tenant_id) ON DELETE SET NULL (cycle_id),
  CONSTRAINT performance_goals_created_by_fk FOREIGN KEY (created_by, tenant_id) REFERENCES employees(id, tenant_id) ON DELETE SET NULL (created_by),
  CONSTRAINT performance_goals_title_chk CHECK (length(btrim(title)) BETWEEN 1 AND 240),
  CONSTRAINT performance_goals_type_chk CHECK (goal_type IN ('goal', 'objective', 'key_result')),
  CONSTRAINT performance_goals_progress_chk CHECK (progress_percent BETWEEN 0 AND 100),
  CONSTRAINT performance_goals_status_chk CHECK (status IN ('planned', 'active', 'at_risk', 'completed', 'cancelled')),
  CONSTRAINT performance_goals_dates_chk CHECK (due_at IS NULL OR starts_at IS NULL OR due_at >= starts_at)
);
CREATE INDEX IF NOT EXISTS performance_goals_tenant_employee_status_due_idx ON performance_goals(tenant_id, employee_id, status, due_at);

CREATE TABLE IF NOT EXISTS performance_goal_updates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  goal_id UUID NOT NULL,
  updated_by UUID,
  previous_progress INTEGER,
  new_progress INTEGER NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT performance_goal_updates_goal_fk FOREIGN KEY (goal_id, tenant_id) REFERENCES performance_goals(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT performance_goal_updates_updated_by_fk FOREIGN KEY (updated_by, tenant_id) REFERENCES employees(id, tenant_id) ON DELETE SET NULL (updated_by),
  CONSTRAINT performance_goal_updates_progress_chk CHECK (new_progress BETWEEN 0 AND 100 AND (previous_progress IS NULL OR previous_progress BETWEEN 0 AND 100))
);
CREATE INDEX IF NOT EXISTS performance_goal_updates_tenant_goal_created_idx ON performance_goal_updates(tenant_id, goal_id, created_at DESC);

CREATE TABLE IF NOT EXISTS employee_recognitions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL,
  recognition_type TEXT NOT NULL,
  recognition_month DATE,
  title TEXT NOT NULL,
  message TEXT,
  cycle_id UUID,
  awarded_by UUID,
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT employee_recognitions_employee_fk FOREIGN KEY (employee_id, tenant_id) REFERENCES employees(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT employee_recognitions_cycle_fk FOREIGN KEY (cycle_id, tenant_id) REFERENCES performance_review_cycles(id, tenant_id) ON DELETE SET NULL (cycle_id),
  CONSTRAINT employee_recognitions_awarded_by_fk FOREIGN KEY (awarded_by, tenant_id) REFERENCES employees(id, tenant_id) ON DELETE SET NULL (awarded_by),
  CONSTRAINT employee_recognitions_revoked_by_fk FOREIGN KEY (revoked_by, tenant_id) REFERENCES employees(id, tenant_id) ON DELETE SET NULL (revoked_by),
  CONSTRAINT employee_recognitions_type_chk CHECK (recognition_type IN ('employee_of_month')),
  CONSTRAINT employee_recognitions_month_chk CHECK (recognition_month IS NULL OR recognition_month = date_trunc('month', recognition_month)::date),
  CONSTRAINT employee_recognitions_title_chk CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  CONSTRAINT employee_recognitions_message_chk CHECK (message IS NULL OR length(message) <= 1000)
);
CREATE UNIQUE INDEX IF NOT EXISTS employee_recognitions_one_active_month_idx ON employee_recognitions(tenant_id, recognition_type, recognition_month) WHERE revoked_at IS NULL AND recognition_month IS NOT NULL;

CREATE TABLE IF NOT EXISTS employee_recognition_deliveries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  recognition_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  delivery_status TEXT NOT NULL DEFAULT 'pending',
  delivered_via TEXT,
  claimed_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT recognition_deliveries_recognition_fk FOREIGN KEY (recognition_id, tenant_id) REFERENCES employee_recognitions(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT recognition_deliveries_employee_fk FOREIGN KEY (employee_id, tenant_id) REFERENCES employees(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT recognition_deliveries_status_chk CHECK (delivery_status IN ('pending', 'claimed', 'dismissed')),
  CONSTRAINT recognition_deliveries_unique_recognition UNIQUE (tenant_id, recognition_id, employee_id)
);
CREATE INDEX IF NOT EXISTS recognition_deliveries_tenant_employee_pending_idx ON employee_recognition_deliveries(tenant_id, employee_id, created_at) WHERE delivery_status = 'pending';

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'performance_review_cycles', 'performance_review_templates', 'performance_review_questions',
    'performance_reviews', 'performance_review_assignments', 'performance_review_responses',
    'performance_goals', 'performance_goal_updates', 'employee_recognitions', 'employee_recognition_deliveries'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_tenant_isolation', table_name);
    EXECUTE format('CREATE POLICY %I ON %I USING (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid)', table_name || '_tenant_isolation', table_name);
  END LOOP;
END $$;

INSERT INTO tenant_role_permissions (tenant_id, role_id, permission_key)
SELECT roles.tenant_id, roles.id, permissions.permission_key
FROM tenant_roles roles
JOIN tenant_permissions permissions ON permissions.permission_key LIKE 'performance.%'
WHERE roles.system_key = 'hr_admin'
ON CONFLICT (tenant_id, role_id, permission_key) DO NOTHING;

INSERT INTO tenant_role_permissions (tenant_id, role_id, permission_key)
SELECT roles.tenant_id, roles.id, allowed.permission_key
FROM tenant_roles roles
JOIN (VALUES ('performance.view'), ('performance.review'), ('performance.view_reports'), ('performance.manage_goals')) AS allowed(permission_key) ON TRUE
WHERE roles.system_key = 'manager'
ON CONFLICT (tenant_id, role_id, permission_key) DO NOTHING;

COMMIT;
