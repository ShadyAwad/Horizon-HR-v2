BEGIN;
-- Authentication needs a narrow tenant locator before a tenant transaction exists.
-- These functions return identity/context only, never password hashes or tokens.
CREATE OR REPLACE FUNCTION public.stanza_auth_tenant(email_address text)
RETURNS TABLE(tenant_id uuid) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog AS $$
  SELECT e.tenant_id FROM public.employees e WHERE lower(e.email)=lower(email_address) LIMIT 1
$$;
CREATE OR REPLACE FUNCTION public.stanza_session_identity(token_hash text)
RETURNS TABLE(id uuid,employee_id uuid,tenant_id uuid) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog AS $$
  SELECT s.id,s.employee_id,s.tenant_id FROM public.auth_sessions s
  WHERE s.session_token_hash=token_hash AND s.revoked_at IS NULL AND s.expires_at>now() LIMIT 1
$$;
CREATE OR REPLACE FUNCTION public.stanza_reset_tenant(token_hash text)
RETURNS TABLE(tenant_id uuid) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog AS $$
  SELECT t.tenant_id FROM public.password_reset_tokens t
  WHERE t.token_hash=stanza_reset_tenant.token_hash AND t.used_at IS NULL AND t.expires_at>now()
  ORDER BY t.created_at DESC LIMIT 1
$$;
CREATE OR REPLACE FUNCTION public.stanza_qr_tenant(token_hash text,token_purpose text)
RETURNS TABLE(tenant_id uuid) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog AS $$
  SELECT t.tenant_id FROM public.qr_access_tokens t
  WHERE t.token_hash=stanza_qr_tenant.token_hash AND t.purpose=token_purpose LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.stanza_auth_tenant(text), public.stanza_session_identity(text),
 public.stanza_reset_tenant(text),public.stanza_qr_tenant(text,text) FROM PUBLIC;
ALTER TABLE public.auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS runtime_tenant_auth_sessions ON public.auth_sessions;
CREATE POLICY runtime_tenant_auth_sessions ON public.auth_sessions
 USING (tenant_id=NULLIF(current_setting('app.current_tenant',true),'')::uuid)
 WITH CHECK (tenant_id=NULLIF(current_setting('app.current_tenant',true),'')::uuid);
DROP POLICY IF EXISTS runtime_tenant_password_reset_tokens ON public.password_reset_tokens;
CREATE POLICY runtime_tenant_password_reset_tokens ON public.password_reset_tokens
 USING (tenant_id=NULLIF(current_setting('app.current_tenant',true),'')::uuid)
 WITH CHECK (tenant_id=NULLIF(current_setting('app.current_tenant',true),'')::uuid);
-- A definer view otherwise bypasses underlying employees RLS.
ALTER VIEW public.vw_employee_hierarchy SET (security_invoker=true);

      INSERT INTO tenant_permissions (permission_key, label, description)
      VALUES
        ('locations.read', 'Read locations', 'View company locations.'),
        ('locations.manage', 'Manage locations', 'Create and update company locations and geofences.'),
        ('geofences.manage', 'Manage geofences', 'Create and update company geofence boundaries.'),
        ('attendance.policy.manage', 'Manage attendance policy', 'Configure company attendance and break policies.'),
        ('attendance.clock', 'Clock attendance', 'Clock in and out.'),
        ('attendance.view', 'View attendance', 'View attendance records and summaries.'),
        ('attendance.view_live', 'View live employees', 'View tenant employees with currently open attendance shifts.'),
        ('break_requests.create', 'Create break requests', 'Request manager approval for breaks.'),
        ('break_requests.view_own', 'View own break requests', 'View personal break request history.'),
        ('break_requests.review', 'Review break requests', 'Approve or reject pending break requests.'),
        ('break_requests.view_all', 'View all break requests', 'View tenant break request queues.'),
        ('leave.create', 'Create leave requests', 'Create and view personal leave requests.'),
        ('leave.request.self', 'Request personal leave', 'Create personal leave requests.'),
        ('leave.view.self', 'View personal leave', 'View personal leave request history.'),
        ('leave.cancel.self', 'Cancel personal leave', 'Cancel pending personal leave requests.'),
        ('leave.view.scoped', 'View scoped leave requests', 'View leave requests within an authorised employee scope.'),
        ('leave.approve', 'Approve scoped leave requests', 'Approve or reject leave requests within an authorised employee scope.'),
        ('leave.manage', 'Manage tenant leave', 'Manage leave requests across an explicitly authorised company scope.'),
        ('leave.review', 'Review leave requests', 'Review tenant leave requests.'),
        ('roster.view_all', 'View tenant rosters', 'View roster shifts for employees in the tenant.'),
        ('roster.manage', 'Manage rosters', 'Create, update, cancel, and override roster shifts.'),
        ('roster.goals.view_self', 'View own roster goals', 'View personal weekly roster goals and tasks.'),
        ('roster.goals.view_scoped', 'View scoped roster goals', 'View weekly roster goals for employees in an authorised scope.'),
        ('roster.goals.manage', 'Manage roster goals', 'Assign and manage weekly roster goals within an authorised scope.'),
        ('roster.goals.complete_self', 'Complete own roster goals', 'Update progress and complete personal weekly roster goals.'),
        ('payroll.view_self', 'View own payroll', 'View personal payroll records.'),
        ('payroll.view_all', 'View all payroll', 'View tenant payroll records.'),
        ('payroll.run', 'Run payroll', 'Generate tenant payroll.'),
        ('payroll.approve', 'Approve payroll', 'Approve or cancel payroll records.'),
        ('payroll.mark_paid', 'Mark payroll paid', 'Mark approved payroll as paid.'),
        ('payroll.export_pdf', 'Export payroll PDF', 'Export payroll statements as PDF.'),
        ('compensation.manage', 'Manage compensation', 'Create and update compensation profiles.'),
        ('loans.view_self', 'View own loans', 'View personal employee loans.'),
        ('loans.manage', 'Manage loans', 'Create and update employee loans.'),
        ('grievances.create', 'Create grievances', 'File grievance cases.'),
        ('grievances.review', 'Review grievances', 'Review scoped grievance cases.'),
        ('grievances.view_own', 'Grievances view own', 'Authorized grievance case access.'),
        ('grievances.view', 'Grievances view', 'Authorized grievance case access.'),
        ('grievances.triage', 'Grievances triage', 'Authorized grievance case access.'),
        ('grievances.assign', 'Grievances assign', 'Authorized grievance case access.'),
        ('grievances.respond', 'Grievances respond', 'Authorized grievance case access.'),
        ('grievances.internal_notes', 'Grievances internal notes', 'Authorized grievance case access.'),
        ('grievances.resolve', 'Grievances resolve', 'Authorized grievance case access.'),
        ('grievances.close', 'Grievances close', 'Authorized grievance case access.'),
        ('grievances.confidential', 'Grievances confidential', 'Authorized grievance case access.'),
        ('grievances.configure', 'Grievances configure', 'Authorized grievance case access.'),
        ('resignations.create', 'Create resignation requests', 'Submit resignation requests.'),
        ('resignations.view_own', 'View own resignation requests', 'View personal resignation requests.'),
        ('resignations.view_all', 'View all resignation requests', 'View tenant resignation requests.'),
        ('resignations.review', 'Review resignation requests', 'Approve or reject resignation requests.'),
        ('resignations.process', 'Process resignation requests', 'Mark approved resignation requests as processed.'),
        ('feed.read', 'Read company feed', 'Read company feed posts.'),
        ('feed.publish', 'Publish company feed', 'Create and manage company feed posts.'),
        ('audit.view', 'View audit trail', 'View tenant-scoped audit events.'),
        ('roles.manage', 'Manage roles', 'Manage tenant roles, permissions, and employee titles.'),
        ('roles.assign_privileged', 'Assign privileged roles', 'Assign system administrator and equivalent privileged roles.')
      ON CONFLICT (permission_key) DO UPDATE SET
        label = EXCLUDED.label,
        description = EXCLUDED.description
    ;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS runtime_tenant_directory ON public.tenants;
CREATE POLICY runtime_tenant_directory ON public.tenants
 USING (id=NULLIF(current_setting('app.current_tenant',true),'')::uuid)
 WITH CHECK (id=NULLIF(current_setting('app.current_tenant',true),'')::uuid);
-- Workers enumerate only identifiers, then enter the same tenant-scoped transactions.
CREATE OR REPLACE FUNCTION public.stanza_maintenance_tenants(after_id uuid)
RETURNS TABLE(id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT t.id FROM public.tenants t WHERE t.id>after_id ORDER BY t.id LIMIT 100
$$;
REVOKE ALL ON FUNCTION public.stanza_maintenance_tenants(uuid) FROM PUBLIC;
COMMIT;
