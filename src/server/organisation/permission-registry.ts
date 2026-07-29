import { ORGANISATION_SCOPE_TYPES, type OrganisationScopeType } from './scoped-permissions';

export type PermissionRiskLevel = 'low' | 'medium' | 'high';

export type PermissionMetadata = {
  key: string;
  label: string;
  description: string;
  category: string;
  riskLevel: PermissionRiskLevel;
  allowedScopeTypes: OrganisationScopeType[];
  delegatable: boolean;
  protected: boolean;
};

const allScopes = [...ORGANISATION_SCOPE_TYPES];
const companyScope: OrganisationScopeType[] = ['company'];
const peopleScopes: OrganisationScopeType[] = ['company', 'location', 'department', 'team', 'direct_reports'];

const definePermission = (
  key: string,
  label: string,
  description: string,
  category: string,
  riskLevel: PermissionRiskLevel = 'medium',
  allowedScopeTypes: OrganisationScopeType[] = allScopes,
  delegatable = true,
  protectedPermission = false,
): PermissionMetadata => ({
  key,
  label,
  description,
  category,
  riskLevel,
  allowedScopeTypes,
  delegatable,
  protected: protectedPermission,
});

// This is deliberately fixed: role APIs never turn arbitrary database strings into permissions.
export const PERMISSION_REGISTRY: readonly PermissionMetadata[] = [
  definePermission('locations.read', 'View locations', 'View company locations.', 'Locations', 'low'),
  definePermission('locations.manage', 'Manage locations', 'Create and update company locations and geofences.', 'Locations', 'high', companyScope, false),
  definePermission('geofences.manage', 'Manage geofences', 'Create and update company geofence boundaries.', 'Locations', 'high', companyScope, false),
  definePermission('attendance.clock', 'Clock attendance', 'Clock in and out.', 'Attendance', 'low', ['self']),
  definePermission('attendance.view', 'View attendance', 'View attendance records and summaries.', 'Attendance', 'medium', peopleScopes),
  definePermission('attendance.view_live', 'View live employees', 'View employees with open attendance shifts.', 'Attendance', 'medium', peopleScopes),
  definePermission('break_requests.create', 'Create break requests', 'Create personal break requests.', 'Leave and breaks', 'low', ['self']),
  definePermission('break_requests.view_own', 'View own break requests', 'View personal break request history.', 'Leave and breaks', 'low', ['self']),
  definePermission('break_requests.review', 'Review break requests', 'Approve or reject pending break requests.', 'Leave and breaks', 'medium', peopleScopes),
  definePermission('break_requests.view_all', 'View all break requests', 'View tenant break request queues.', 'Leave and breaks', 'medium', peopleScopes),
  definePermission('leave.create', 'Create leave requests', 'Create and view personal leave requests.', 'Leave and breaks', 'low', ['self']),
  definePermission('leave.request.self', 'Request personal leave', 'Create personal leave requests.', 'Leave and breaks', 'low', ['self']),
  definePermission('leave.view.self', 'View personal leave', 'View personal leave request history.', 'Leave and breaks', 'low', ['self']),
  definePermission('leave.cancel.self', 'Cancel personal leave', 'Cancel pending personal leave requests.', 'Leave and breaks', 'low', ['self']),
  definePermission('leave.view.scoped', 'View scoped leave requests', 'View leave requests within an authorised employee scope.', 'Leave and breaks', 'medium', peopleScopes),
  definePermission('leave.approve', 'Approve scoped leave requests', 'Approve or reject leave requests within an authorised employee scope.', 'Leave and breaks', 'high', peopleScopes),
  definePermission('leave.manage', 'Manage tenant leave', 'Manage leave requests across an explicitly authorised company scope.', 'Leave and breaks', 'high', companyScope, false),
  definePermission('leave.review', 'Review leave requests', 'Review tenant leave requests.', 'Leave and breaks', 'medium', peopleScopes),
  definePermission('roster.view_all', 'View tenant rosters', 'View roster shifts for authorised employees.', 'Rosters', 'medium', peopleScopes),
  definePermission('roster.manage', 'Manage rosters', 'Create, update, cancel, and override roster shifts.', 'Rosters', 'high', peopleScopes, false),
  definePermission('roster.swap.view_scoped', 'View shift swaps', 'View shift swaps within an authorised scope.', 'Rosters', 'medium', peopleScopes),
  definePermission('roster.swap.approve', 'Approve shift swaps', 'Approve or reject shift swaps within an authorised scope.', 'Rosters', 'high', peopleScopes),
  definePermission('roster.swap.manage', 'Manage shift swaps', 'Manage tenant shift-swap approvals.', 'Rosters', 'high', companyScope, false),
  definePermission('payroll.view_self', 'View own payroll', 'View personal payroll records.', 'Payroll', 'medium', ['self']),
  definePermission('payroll.view_all', 'View all payroll', 'View tenant payroll records.', 'Payroll', 'high', peopleScopes, false),
  definePermission('payroll.run', 'Run payroll', 'Generate tenant payroll.', 'Payroll', 'high', companyScope, false, true),
  definePermission('payroll.approve', 'Approve payroll', 'Approve or cancel payroll records.', 'Payroll', 'high', companyScope, false, true),
  definePermission('payroll.mark_paid', 'Mark payroll paid', 'Mark approved payroll as paid.', 'Payroll', 'high', companyScope, false, true),
  definePermission('payroll.export_pdf', 'Export payroll PDF', 'Export payroll statements as authorised.', 'Payroll', 'medium', peopleScopes),
  definePermission('compensation.manage', 'Manage compensation', 'Create and update compensation profiles.', 'Payroll', 'high', peopleScopes, false),
  definePermission('loans.view_self', 'View own loans', 'View personal employee loans.', 'Payroll', 'low', ['self']),
  definePermission('loans.manage', 'Manage loans', 'Create and update employee loans.', 'Payroll', 'high', peopleScopes, false),
  definePermission('grievances.create', 'Create grievances', 'File grievance cases.', 'Employee relations', 'low', ['self']),
  definePermission('grievances.review', 'Review grievances', 'Review tenant grievance cases.', 'Employee relations', 'medium', peopleScopes),
  definePermission('resignations.create', 'Create resignation requests', 'Submit resignation requests.', 'Employee relations', 'low', ['self']),
  definePermission('resignations.view_own', 'View own resignations', 'View personal resignation requests.', 'Employee relations', 'low', ['self']),
  definePermission('resignations.view_all', 'View all resignations', 'View tenant resignation requests.', 'Employee relations', 'medium', peopleScopes),
  definePermission('resignations.review', 'Review resignations', 'Approve or reject resignation requests.', 'Employee relations', 'medium', peopleScopes),
  definePermission('resignations.process', 'Process resignations', 'Process approved resignation requests.', 'Employee relations', 'high', peopleScopes, false),
  definePermission('feed.read', 'Read company feed', 'Read company feed posts.', 'Company feed', 'low'),
  definePermission('feed.publish', 'Publish company feed', 'Create and manage company feed posts.', 'Company feed', 'medium', peopleScopes),
  definePermission('hiring.view', 'View hiring candidates', 'View authorised hiring candidates.', 'Hiring', 'medium', peopleScopes),
  definePermission('hiring.create', 'Create hiring candidates', 'Create applicant records.', 'Hiring', 'medium', peopleScopes),
  definePermission('hiring.edit', 'Edit hiring candidates', 'Edit applicant details.', 'Hiring', 'medium', peopleScopes),
  definePermission('hiring.add_notes', 'Add hiring notes', 'Add internal applicant notes.', 'Hiring', 'medium', peopleScopes),
  definePermission('hiring.view_notes', 'View hiring notes', 'View internal applicant notes.', 'Hiring', 'medium', peopleScopes),
  definePermission('hiring.assign', 'Assign hiring candidates', 'Assign and hand off applicants.', 'Hiring', 'high', peopleScopes, false),
  definePermission('hiring.advance_stage', 'Advance hiring stages', 'Move applicants through permitted stages.', 'Hiring', 'medium', peopleScopes),
  definePermission('hiring.make_final_decision', 'Make hiring decisions', 'Approve offers and final outcomes.', 'Hiring', 'high', peopleScopes, false, true),
  definePermission('hiring.archive', 'Archive hiring candidates', 'Archive applicant records.', 'Hiring', 'high', peopleScopes, false),
  definePermission('performance.view', 'View performance', 'View authorised performance records.', 'Performance', 'medium', peopleScopes),
  definePermission('performance.review', 'Complete performance reviews', 'Complete assigned performance reviews.', 'Performance', 'medium', peopleScopes),
  definePermission('performance.manage_cycles', 'Manage review cycles', 'Manage performance review cycles.', 'Performance', 'high', companyScope, false),
  definePermission('performance.manage_templates', 'Manage review templates', 'Manage performance review templates.', 'Performance', 'high', companyScope, false),
  definePermission('performance.manage_goals', 'Manage performance goals', 'Manage goals and OKRs.', 'Performance', 'medium', peopleScopes),
  definePermission('performance.manage_recognition', 'Manage recognition', 'Manage employee recognition.', 'Performance', 'medium', peopleScopes),
  definePermission('performance.view_reports', 'View performance reports', 'View performance reporting.', 'Performance', 'medium', peopleScopes),
  definePermission('assets.view', 'View assets', 'View tenant assets.', 'Assets', 'low', peopleScopes),
  definePermission('assets.manage', 'Manage assets', 'Create and update inventory.', 'Assets', 'high', peopleScopes, false),
  definePermission('assets.assign', 'Assign assets', 'Assign equipment and licenses.', 'Assets', 'high', peopleScopes, false),
  definePermission('assets.return', 'Return assets', 'Return tenant equipment.', 'Assets', 'medium', peopleScopes),
  definePermission('document_extraction.expense.self', 'Extract personal expense receipts', 'Extract editable candidate fields from personal expense receipts.', 'Document extraction', 'medium', ['self'], false),
  definePermission('document_extraction.candidate.manage', 'Extract candidate documents', 'Extract editable candidate fields from documents within an authorised Hiring scope.', 'Document extraction', 'high', peopleScopes),
  definePermission('document_extraction.asset.manage', 'Extract asset labels', 'Extract editable identifiers from labels within an authorised Asset scope.', 'Document extraction', 'medium', peopleScopes),
  definePermission('qr.employee_badge.self', 'Manage own employee badge QR', 'Issue and rotate a personal employee verification token.', 'QR access', 'medium', ['self'], false),
  definePermission('qr.employee_badge.manage', 'Manage employee badge QR', 'Manage employee verification tokens within an authorised scope.', 'QR access', 'high', peopleScopes),
  definePermission('qr.asset_label.manage', 'Manage asset label QR', 'Manage asset lookup tokens with existing asset authority.', 'QR access', 'high', peopleScopes),
  definePermission('qr.onboarding_invite.manage', 'Manage onboarding invite QR', 'Manage short-lived onboarding invitation tokens with existing Hiring authority.', 'QR access', 'high', companyScope, false),
  definePermission('qr.tokens.revoke', 'Revoke QR tokens', 'Revoke QR tokens within an authorised scope.', 'QR access', 'high', peopleScopes, false),
  definePermission('expenses.submit.self', 'Submit personal expenses', 'Submit personal expense reimbursement claims.', 'Expenses', 'medium', ['self'], false),
  definePermission('expenses.view.self', 'View personal expenses', 'View personal expense reimbursement claims.', 'Expenses', 'medium', ['self'], false),
  definePermission('expenses.cancel.self', 'Cancel personal expenses', 'Cancel personal pending expense claims.', 'Expenses', 'medium', ['self'], false),
  definePermission('expenses.view.scoped', 'View scoped expenses', 'View expense claims within an explicitly authorised employee scope.', 'Expenses', 'high', peopleScopes),
  definePermission('expenses.approve', 'Approve scoped expenses', 'Approve or reject expense claims within an explicitly authorised employee scope.', 'Expenses', 'high', peopleScopes),
  definePermission('expenses.reimburse', 'Reimburse approved expenses', 'Mark approved expense claims as reimbursed within an explicitly authorised scope.', 'Expenses', 'high', peopleScopes, false, true),
  definePermission('expenses.manage', 'Manage expense reimbursements', 'Administer expense claims within an explicitly authorised scope.', 'Expenses', 'high', peopleScopes, false, true),
  definePermission('audit.view', 'View audit trail', 'View tenant audit events.', 'Audit', 'high', companyScope, false, true),
  definePermission('sessions.manage', 'Manage sessions', 'Manage active sessions for employees.', 'Sessions', 'high', companyScope, false, true),
  definePermission('roles.manage', 'Manage roles', 'Manage tenant roles and permissions.', 'Organisation', 'high', companyScope, false, true),
  definePermission('roles.assign_privileged', 'Assign privileged roles', 'Assign protected privileged roles.', 'Organisation', 'high', companyScope, false, true),
  definePermission('organisation.view', 'View organisation', 'View authorised organisation data.', 'Organisation', 'low'),
  definePermission('organisation.manage', 'Manage organisation', 'Manage company-wide organisation settings.', 'Organisation', 'high', companyScope, false, true),
  definePermission('departments.manage', 'Manage departments', 'Create and update departments.', 'Organisation', 'high', companyScope, false),
  definePermission('teams.manage', 'Manage teams', 'Manage teams and memberships.', 'Organisation', 'high', ['company', 'department', 'team'], false),
  definePermission('job_titles.manage', 'Manage job titles', 'Manage job titles.', 'Organisation', 'high', companyScope, false),
  definePermission('roles.view', 'View roles', 'View tenant roles and permissions.', 'Organisation', 'medium', companyScope, false, true),
  definePermission('permissions.manage', 'Manage permissions', 'Change custom role permissions.', 'Organisation', 'high', companyScope, false, true),
  definePermission('hierarchy.manage', 'Manage hierarchy', 'Manage employee placement and reporting lines.', 'Organisation', 'high', peopleScopes, false),
  definePermission('delegations.manage', 'Manage delegations', 'Grant and revoke temporary scoped permissions.', 'Organisation', 'high', peopleScopes, false, true),
  definePermission('roster.propose_changes', 'Propose roster changes', 'Propose roster changes.', 'Rosters', 'medium'),
  definePermission('roster.manage_scoped', 'Manage scoped rosters', 'Manage roster shifts in scope.', 'Rosters', 'high', peopleScopes, false),
  definePermission('roster.approve_changes', 'Approve roster changes', 'Approve roster changes in scope.', 'Rosters', 'high', peopleScopes, false),
];

const registry = new Map(PERMISSION_REGISTRY.map((definition) => [definition.key, definition]));

if (registry.size !== PERMISSION_REGISTRY.length) {
  throw new Error('Duplicate permission registry keys.');
}

if (PERMISSION_REGISTRY.some((definition) => definition.allowedScopeTypes.some(
  (scope) => !(ORGANISATION_SCOPE_TYPES as readonly string[]).includes(scope),
))) {
  throw new Error('Invalid permission registry scope.');
}

export function getPermissionDefinition(key: string): PermissionMetadata | null {
  return registry.get(key) ?? null;
}

export function listPermissionDefinitions(): PermissionMetadata[] {
  return [...PERMISSION_REGISTRY];
}

export function isKnownPermission(key: string): boolean {
  return registry.has(key);
}

export function validatePermissionKeys(keys: unknown): string[] | null {
  if (!Array.isArray(keys) || !keys.every((key): key is string => typeof key === 'string' && registry.has(key))) {
    return null;
  }

  return [...new Set(keys)];
}

// Compatibility aliases for the already-started Organisation integration.
export const getPermissionMetadata = getPermissionDefinition;
export const isRegisteredPermission = isKnownPermission;
