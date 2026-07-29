import type { PoolClient } from 'pg';

export type AuditSeverity = 'neutral' | 'informational' | 'warning' | 'critical';

type AuditPresentation = {
  action: string;
  module: string;
  summary: string;
  severity: AuditSeverity;
  metadata: Record<string, unknown>;
};

type AuditDefinition = {
  canonicalAction: string;
  module: string;
  summary: string;
  severity?: AuditSeverity;
  metadataKeys?: readonly string[];
};

const DEFINITIONS: Record<string, AuditDefinition> = {
  'asset.created': { canonicalAction: 'asset.created', module: 'assets', summary: 'Asset created', metadataKeys: ['assetTag', 'category'] },
  'asset.assigned': { canonicalAction: 'asset.assigned', module: 'assets', summary: 'Asset assigned', metadataKeys: ['assetTag', 'targetEmployeeId'] },
  'asset.returned': { canonicalAction: 'asset.returned', module: 'assets', summary: 'Asset returned', metadataKeys: ['assetTag', 'condition'] },
  'asset.updated': { canonicalAction: 'asset.updated', module: 'assets', summary: 'Asset updated', metadataKeys: ['assetTag'] },
  'asset.condition_reported': { canonicalAction: 'asset.condition_reported', module: 'assets', summary: 'Asset condition reported', metadataKeys: ['assetTag', 'condition'] },
  'asset.lost': { canonicalAction: 'asset.lost', module: 'assets', summary: 'Asset marked lost', severity: 'warning', metadataKeys: ['assetTag'] },
  'asset.retired': { canonicalAction: 'asset.retired', module: 'assets', summary: 'Asset retired', metadataKeys: ['assetTag'] },
  'software_license.created': { canonicalAction: 'software_license.created', module: 'assets', summary: 'Software license created', metadataKeys: ['licenseName'] },
  'software_license.updated': { canonicalAction: 'software_license.updated', module: 'assets', summary: 'Software license updated', metadataKeys: ['licenseName'] },
  'software_license.assigned': { canonicalAction: 'software_license.assigned', module: 'assets', summary: 'Software license assigned', metadataKeys: ['licenseName', 'targetEmployeeId'] },
  'software_license.revoked': { canonicalAction: 'software_license.revoked', module: 'assets', summary: 'Software license revoked', metadataKeys: ['licenseName'] },
  'document_extraction.requested': { canonicalAction: 'document_extraction.requested', module: 'document_extraction', summary: 'Document extraction requested', metadataKeys: ['extractionId', 'mode', 'inputMimeType', 'inputSizeBytes', 'provider', 'status'] },
  'document_extraction.completed': { canonicalAction: 'document_extraction.completed', module: 'document_extraction', summary: 'Document extraction completed', metadataKeys: ['extractionId', 'mode', 'provider', 'status', 'fieldNames', 'warningCount'] },
  'document_extraction.failed': { canonicalAction: 'document_extraction.failed', module: 'document_extraction', summary: 'Document extraction failed', severity: 'warning', metadataKeys: ['extractionId', 'mode', 'provider', 'status'] },
  'document_extraction.deleted': { canonicalAction: 'document_extraction.deleted', module: 'document_extraction', summary: 'Document extraction deleted', metadataKeys: ['extractionId', 'mode', 'provider', 'status'] },
  'expense.claim_submitted': { canonicalAction: 'expense.claim_submitted', module: 'expenses', summary: 'Expense claim submitted', metadataKeys: ['claimId', 'employeeId', 'category', 'currency', 'status', 'extractionAssociated'] },
  'expense.approver_resolved': { canonicalAction: 'expense.approver_resolved', module: 'expenses', summary: 'Expense approver resolved', metadataKeys: ['claimId', 'employeeId', 'approverEmployeeId', 'category', 'currency', 'status', 'extractionAssociated'] },
  'expense.approver_unconfigured': { canonicalAction: 'expense.approver_unconfigured', module: 'expenses', summary: 'Expense approver requires configuration', severity: 'warning', metadataKeys: ['claimId', 'employeeId', 'category', 'currency', 'status', 'extractionAssociated'] },
  'expense.claim_approved': { canonicalAction: 'expense.claim_approved', module: 'expenses', summary: 'Expense claim approved', metadataKeys: ['claimId', 'employeeId', 'approverEmployeeId', 'category', 'currency', 'status', 'extractionAssociated'] },
  'expense.claim_rejected': { canonicalAction: 'expense.claim_rejected', module: 'expenses', summary: 'Expense claim rejected', severity: 'warning', metadataKeys: ['claimId', 'employeeId', 'approverEmployeeId', 'category', 'currency', 'status', 'extractionAssociated'] },
  'expense.claim_cancelled': { canonicalAction: 'expense.claim_cancelled', module: 'expenses', summary: 'Expense claim cancelled', metadataKeys: ['claimId', 'employeeId', 'approverEmployeeId', 'category', 'currency', 'status', 'extractionAssociated'] },
  'expense.claim_reimbursed': { canonicalAction: 'expense.claim_reimbursed', module: 'expenses', summary: 'Expense claim reimbursed', metadataKeys: ['claimId', 'employeeId', 'approverEmployeeId', 'category', 'currency', 'status', 'extractionAssociated'] },
  tenant_registered: { canonicalAction: 'tenant.registered', module: 'workspace', summary: 'Workspace registered', metadataKeys: ['companyName', 'tenantSlug', 'adminRole', 'customRoles'] },
  tenant_role_created: { canonicalAction: 'employee.role.created', module: 'employees', summary: 'Role created', metadataKeys: ['name'] },
  tenant_role_permissions_updated: { canonicalAction: 'employee.role.permissions_updated', module: 'employees', summary: 'Role permissions updated', metadataKeys: ['roleName'] },
  employee_role_assigned: { canonicalAction: 'employee.role.assigned', module: 'employees', summary: 'Employee role assigned', metadataKeys: ['roleName', 'systemKey', 'privileged'] },
  'employee.role.assigned': { canonicalAction: 'employee.role.assigned', module: 'employees', summary: 'Employee role assigned', metadataKeys: ['roleName', 'systemKey', 'privileged'] },
  privileged_role_assigned: { canonicalAction: 'employee.role.privileged_assigned', module: 'employees', summary: 'Privileged employee role assigned', severity: 'critical', metadataKeys: ['roleName', 'systemKey', 'privileged'] },
  'employee.role.privileged_assigned': { canonicalAction: 'employee.role.privileged_assigned', module: 'employees', summary: 'Privileged employee role assigned', severity: 'critical', metadataKeys: ['roleName', 'systemKey', 'privileged'] },
  employee_role_removed: { canonicalAction: 'employee.role.removed', module: 'employees', summary: 'Employee role removed', metadataKeys: ['roleName', 'systemKey', 'privileged'] },
  'employee.role.removed': { canonicalAction: 'employee.role.removed', module: 'employees', summary: 'Employee role removed', metadataKeys: ['roleName', 'systemKey', 'privileged'] },
  privileged_role_removed: { canonicalAction: 'employee.role.privileged_removed', module: 'employees', summary: 'Privileged employee role removed', severity: 'warning', metadataKeys: ['roleName', 'systemKey', 'privileged'] },
  'employee.role.privileged_removed': { canonicalAction: 'employee.role.privileged_removed', module: 'employees', summary: 'Privileged employee role removed', severity: 'warning', metadataKeys: ['roleName', 'systemKey', 'privileged'] },
  employee_title_updated: { canonicalAction: 'employee.updated', module: 'employees', summary: 'Employee title updated', metadataKeys: ['jobTitle'] },
  employee_compensation_updated: { canonicalAction: 'employee.salary.updated', module: 'employees', summary: 'Salary updated', metadataKeys: ['payType', 'currency', 'effectiveFrom'] },
  'employee.salary.updated': { canonicalAction: 'employee.salary.updated', module: 'employees', summary: 'Salary updated', metadataKeys: ['payType', 'currency', 'effectiveFrom'] },
  'organisation.role.created': { canonicalAction: 'organisation.role.created', module: 'organisation', summary: 'Custom role created', metadataKeys: ['isSystem', 'permissionCount'] },
  'organisation.role.updated': { canonicalAction: 'organisation.role.updated', module: 'organisation', summary: 'Custom role updated', metadataKeys: ['isSystem'] },
  'organisation.role.permissions_updated': { canonicalAction: 'organisation.role.permissions_updated', module: 'organisation', summary: 'Custom role permissions updated', metadataKeys: ['roleId', 'previousPermissionCount', 'newPermissionCount', 'addedCount', 'removedCount'] },
  'organisation.role.assigned': { canonicalAction: 'organisation.role.assigned', module: 'organisation', summary: 'Role assigned', metadataKeys: ['assignmentId', 'employeeId', 'roleId', 'scopeType', 'scopeId', 'hasExpiry'] },
  'organisation.role.revoked': { canonicalAction: 'organisation.role.revoked', module: 'organisation', summary: 'Role assignment revoked', metadataKeys: ['assignmentId', 'employeeId', 'roleId', 'scopeType', 'scopeId', 'hasExpiry'] },
  'organisation.role.duplicated': { canonicalAction: 'organisation.role.duplicated', module: 'organisation', summary: 'Custom role duplicated', metadataKeys: ['sourceRoleId', 'isSystem', 'permissionCount'] },
  'organisation.role.archived': { canonicalAction: 'organisation.role.archived', module: 'organisation', summary: 'Custom role archived', metadataKeys: ['isSystem', 'activeAssignmentCount'] },
  company_location_created: { canonicalAction: 'geofence.created', module: 'geofence', summary: 'Company location created', metadataKeys: ['name', 'locationType', 'radius', 'isPrimary'] },
  'geofence.created': { canonicalAction: 'geofence.created', module: 'geofence', summary: 'Company location created', metadataKeys: ['name', 'locationType', 'radius', 'isPrimary'] },
  company_location_updated: { canonicalAction: 'geofence.updated', module: 'geofence', summary: 'Company location updated', metadataKeys: ['name', 'locationType', 'radius', 'isPrimary', 'isActive'] },
  'geofence.updated': { canonicalAction: 'geofence.updated', module: 'geofence', summary: 'Company location updated', metadataKeys: ['name', 'locationType', 'radius', 'isPrimary', 'isActive'] },
  'location.created': { canonicalAction: 'location.created', module: 'geofence', summary: 'Company location created', metadataKeys: ['locationId', 'geofenceType', 'active'] },
  'location.updated': { canonicalAction: 'location.updated', module: 'geofence', summary: 'Company location updated', metadataKeys: ['locationId', 'geofenceType', 'active'] },
  'location.archived': { canonicalAction: 'location.archived', module: 'geofence', summary: 'Company location archived', metadataKeys: ['locationId', 'active', 'usageCounts'] },
  'location.restored': { canonicalAction: 'location.restored', module: 'geofence', summary: 'Company location restored', metadataKeys: ['locationId', 'active', 'usageCounts'] },
  clock_in: { canonicalAction: 'attendance.clock_in', module: 'attendance', summary: 'Employee clocked in', metadataKeys: ['locationValid', 'matchedLocation', 'workDate'] },
  clock_out: { canonicalAction: 'attendance.clock_out', module: 'attendance', summary: 'Employee clocked out', metadataKeys: ['workDate'] },
  attendance_geofence_rejected: { canonicalAction: 'attendance.geofence_rejected', module: 'attendance', summary: 'Clock-in rejected outside geofence', severity: 'warning', metadataKeys: ['workDate'] },
  leave_requested: { canonicalAction: 'leave.requested', module: 'leave', summary: 'Leave requested', metadataKeys: ['startDate', 'endDate'] },
  'leave.requested': { canonicalAction: 'leave.requested', module: 'leave', summary: 'Leave requested', metadataKeys: ['leaveType', 'startDate', 'endDate'] },
  'leave.cancelled': { canonicalAction: 'leave.cancelled', module: 'leave', summary: 'Leave request cancelled', metadataKeys: ['leaveType', 'startDate', 'endDate', 'status'] },
  'leave.approver_resolved': { canonicalAction: 'leave.approver_resolved', module: 'leave', summary: 'Leave approver resolved', metadataKeys: ['requestId', 'employeeId', 'approverEmployeeId', 'leaveType', 'startDate', 'endDate', 'approvalSource', 'scopeType', 'status'] },
  'leave.approver_unconfigured': { canonicalAction: 'leave.approver_unconfigured', module: 'leave', summary: 'Leave approver requires configuration', severity: 'warning', metadataKeys: ['requestId', 'employeeId', 'leaveType', 'startDate', 'endDate', 'status'] },
  'leave.approved': { canonicalAction: 'leave.approved', module: 'leave', summary: 'Leave request approved', metadataKeys: ['requestId', 'employeeId', 'approverEmployeeId', 'leaveType', 'startDate', 'endDate', 'approvalSource', 'scopeType', 'status'] },
  'leave.rejected': { canonicalAction: 'leave.rejected', module: 'leave', summary: 'Leave request rejected', severity: 'warning', metadataKeys: ['requestId', 'employeeId', 'approverEmployeeId', 'leaveType', 'startDate', 'endDate', 'approvalSource', 'scopeType', 'status'] },
  'leave.schedule_conflict_detected': { canonicalAction: 'leave.schedule_conflict_detected', module: 'leave', summary: 'Approved leave overlaps scheduled work', severity: 'warning', metadataKeys: ['leaveRequestId', 'employeeId', 'conflictCount', 'status'] },
  leave_status_changed: { canonicalAction: 'leave.status_changed', module: 'leave', summary: 'Leave request status changed', metadataKeys: ['status'] },
  'break_request.created': { canonicalAction: 'break.requested', module: 'breaks', summary: 'Break requested', metadataKeys: ['durationMinutes', 'status'] },
  'break_request.approved': { canonicalAction: 'break.approved', module: 'breaks', summary: 'Break request approved', metadataKeys: ['status'] },
  'break_request.rejected': { canonicalAction: 'break.rejected', module: 'breaks', summary: 'Break request rejected', severity: 'warning', metadataKeys: ['status'] },
  'break_request.cancelled': { canonicalAction: 'break.cancelled', module: 'breaks', summary: 'Break request cancelled', metadataKeys: ['status'] },
  'roster.warning_overridden': { canonicalAction: 'roster.warning_overridden', module: 'roster', summary: 'Roster warning overridden', severity: 'warning', metadataKeys: ['warningCodes'] },
  payroll_run_generated: { canonicalAction: 'payroll.generated', module: 'payroll', summary: 'Payroll run generated', metadataKeys: ['payPeriodStart', 'payPeriodEnd', 'recordsGenerated', 'skippedEmployeesCount', 'fallbackUsed'] },
  payroll_status_updated: { canonicalAction: 'payroll.status_changed', module: 'payroll', summary: 'Payroll status changed', metadataKeys: ['previousStatus', 'newStatus', 'payPeriodStart', 'payPeriodEnd'] },
  'payroll.approved': { canonicalAction: 'payroll.approved', module: 'payroll', summary: 'Payroll approved', metadataKeys: ['previousStatus', 'newStatus', 'payPeriodStart', 'payPeriodEnd'] },
  'payroll.paid': { canonicalAction: 'payroll.paid', module: 'payroll', summary: 'Payroll marked paid', metadataKeys: ['previousStatus', 'newStatus', 'payPeriodStart', 'payPeriodEnd'] },
  'payroll.cancelled': { canonicalAction: 'payroll.cancelled', module: 'payroll', summary: 'Payroll cancelled', severity: 'warning', metadataKeys: ['previousStatus', 'newStatus', 'payPeriodStart', 'payPeriodEnd'] },
  grievance_created: { canonicalAction: 'grievance.created', module: 'grievances', summary: 'Grievance submitted' },
  grievance_status_updated: { canonicalAction: 'grievance.status_changed', module: 'grievances', summary: 'Grievance status changed', metadataKeys: ['previousStatus', 'newStatus'] },
  'grievance.status_changed': { canonicalAction: 'grievance.status_changed', module: 'grievances', summary: 'Grievance status changed', metadataKeys: ['previousStatus', 'newStatus'] },
  'hiring.applicant.created': { canonicalAction: 'hiring.applicant.created', module: 'hiring', summary: 'Hiring applicant created', metadataKeys: ['stage'] },
  'hiring.applicant.updated': { canonicalAction: 'hiring.applicant.updated', module: 'hiring', summary: 'Hiring applicant updated', metadataKeys: ['changedFields'] },
  'hiring.applicant.archived': { canonicalAction: 'hiring.applicant.archived', module: 'hiring', summary: 'Hiring applicant archived' },
  'hiring.stage.changed': { canonicalAction: 'hiring.stage_changed', module: 'hiring', summary: 'Hiring stage changed', metadataKeys: ['previousStage', 'newStage'] },
  'hiring.stage_changed': { canonicalAction: 'hiring.stage_changed', module: 'hiring', summary: 'Hiring stage changed', metadataKeys: ['previousStage', 'newStage'] },
  'hiring.handoff.created': { canonicalAction: 'hiring.handoff.created', module: 'hiring', summary: 'Hiring handoff created', metadataKeys: ['fromStage', 'toStage'] },
  'hiring.handoff.acknowledged': { canonicalAction: 'hiring.handoff.acknowledged', module: 'hiring', summary: 'Hiring handoff acknowledged' },
  'hiring.note.created': { canonicalAction: 'hiring.note.created', module: 'hiring', summary: 'Hiring note added', metadataKeys: ['noteType', 'visibility'] },
  'hiring.note.updated': { canonicalAction: 'hiring.note.updated', module: 'hiring', summary: 'Hiring note updated' },
  'profile.avatar_updated': { canonicalAction: 'employee.avatar.updated', module: 'employees', summary: 'Profile photo updated' },
  'profile.avatar_removed': { canonicalAction: 'employee.avatar.removed', module: 'employees', summary: 'Profile photo removed' },
  'passkey.registered': { canonicalAction: 'auth.passkey.registered', module: 'auth', summary: 'Passkey registered', severity: 'informational', metadataKeys: ['deviceLabel'] },
  'passkey.login': { canonicalAction: 'auth.passkey.login', module: 'auth', summary: 'Signed in with passkey', severity: 'informational' },
  'auth.session.revoked': { canonicalAction: 'auth.session.revoked', module: 'auth', summary: 'Authentication session revoked', severity: 'informational' },
  'auth.sessions.revoked_all': { canonicalAction: 'auth.sessions.revoked_all', module: 'auth', summary: 'Other authentication sessions revoked', severity: 'informational', metadataKeys: ['revokedCount', 'revocationType'] },
  'auth.session.revoked_by_admin': { canonicalAction: 'auth.session.revoked_by_admin', module: 'auth', summary: 'Authentication session revoked by administrator', severity: 'warning', metadataKeys: ['revocationType'] },
  notification_settings_updated: { canonicalAction: 'notifications.settings_updated', module: 'notifications', summary: 'Notification settings updated', metadataKeys: ['updatedSettingCount'] },
  'resignation.created': { canonicalAction: 'resignation.created', module: 'resignations', summary: 'Resignation requested', metadataKeys: ['requestedLastWorkingDay', 'resignationType'] },
  'resignation.approved': { canonicalAction: 'resignation.approved', module: 'resignations', summary: 'Resignation approved' },
  'resignation.rejected': { canonicalAction: 'resignation.rejected', module: 'resignations', summary: 'Resignation rejected', severity: 'warning' },
  'resignation.withdrawn': { canonicalAction: 'resignation.withdrawn', module: 'resignations', summary: 'Resignation withdrawn' },
  'resignation.processed': { canonicalAction: 'resignation.processed', module: 'resignations', summary: 'Resignation processed' },
  'offboarding.completed_with_assets': { canonicalAction: 'offboarding.completed_with_assets', module: 'resignations', summary: 'Offboarding completed with assigned assets', severity: 'warning', metadataKeys: ['outstandingAssetCount'] },
  'performance.cycle.created': { canonicalAction: 'performance.cycle.created', module: 'performance', summary: 'Performance review cycle created', metadataKeys: ['cycleName'] },
  'performance.cycle.started': { canonicalAction: 'performance.cycle.started', module: 'performance', summary: 'Performance review cycle started', metadataKeys: ['cycleName'] },
  'performance.cycle.finalised': { canonicalAction: 'performance.cycle.finalised', module: 'performance', summary: 'Performance review cycle finalised', metadataKeys: ['cycleName'] },
  'performance.review.assigned': { canonicalAction: 'performance.review.assigned', module: 'performance', summary: 'Performance review assigned', metadataKeys: ['reviewerType'] },
  'performance.review.submitted': { canonicalAction: 'performance.review.submitted', module: 'performance', summary: 'Performance review submitted', metadataKeys: ['reviewerType'] },
  'performance.review.reopened': { canonicalAction: 'performance.review.reopened', module: 'performance', summary: 'Performance review reopened' },
  'performance.review.finalised': { canonicalAction: 'performance.review.finalised', module: 'performance', summary: 'Performance review finalised' },
  'performance.goal.created': { canonicalAction: 'performance.goal.created', module: 'performance', summary: 'Performance goal created', metadataKeys: ['goalType'] },
  'performance.goal.updated': { canonicalAction: 'performance.goal.updated', module: 'performance', summary: 'Performance goal updated', metadataKeys: ['progressPercent'] },
  'performance.goal.completed': { canonicalAction: 'performance.goal.completed', module: 'performance', summary: 'Performance goal completed' },
  'performance.peer.assigned': { canonicalAction: 'performance.peer.assigned', module: 'performance', summary: 'Confidential peer feedback assigned' },
  'performance.recognition.awarded': { canonicalAction: 'performance.recognition.awarded', module: 'performance', summary: 'Employee recognition awarded', metadataKeys: ['recognitionMonth'] },
  'performance.recognition.replaced': { canonicalAction: 'performance.recognition.replaced', module: 'performance', summary: 'Employee recognition replaced', metadataKeys: ['recognitionMonth'] },
  'performance.recognition.revoked': { canonicalAction: 'performance.recognition.revoked', module: 'performance', summary: 'Employee recognition revoked', metadataKeys: ['recognitionMonth'] },
  'performance.recognition.delivered': { canonicalAction: 'performance.recognition.delivered', module: 'performance', summary: 'Employee recognition delivered', metadataKeys: ['deliveredVia'] },
  'roster.shift_swap.requested': { canonicalAction: 'roster.shift_swap.requested', module: 'roster', summary: 'Shift swap requested', metadataKeys: ['status'] },
  'roster.shift_swap.target_accepted': { canonicalAction: 'roster.shift_swap.target_accepted', module: 'roster', summary: 'Shift swap accepted by target', metadataKeys: ['status'] },
  'roster.shift_swap.target_declined': { canonicalAction: 'roster.shift_swap.target_declined', module: 'roster', summary: 'Shift swap declined by target', metadataKeys: ['status'] },
  'roster.shift_swap.cancelled': { canonicalAction: 'roster.shift_swap.cancelled', module: 'roster', summary: 'Shift swap cancelled', metadataKeys: ['status'] },
  'roster.shift_swap.approver_resolved': { canonicalAction: 'roster.shift_swap.approver_resolved', module: 'roster', summary: 'Shift swap approver resolved', metadataKeys: ['approvalSource', 'scopeType', 'status'] },
  'roster.shift_swap.approved': { canonicalAction: 'roster.shift_swap.approved', module: 'roster', summary: 'Shift swap approved', metadataKeys: ['approvalSource', 'scopeType', 'status'] },
  'roster.shift_swap.applied': { canonicalAction: 'roster.shift_swap.applied', module: 'roster', summary: 'Shift swap applied', metadataKeys: ['approvalSource', 'scopeType', 'status'] },
  'roster.shift_swap.rejected': { canonicalAction: 'roster.shift_swap.rejected', module: 'roster', summary: 'Shift swap rejected', metadataKeys: ['approvalSource', 'scopeType', 'status'] },
  'roster.shift_swap.approval_conflict': { canonicalAction: 'roster.shift_swap.approval_conflict', module: 'roster', summary: 'Shift swap approval conflict', severity: 'warning', metadataKeys: ['status'] },
  company_feed_post_created: { canonicalAction: 'feed.post.created', module: 'feed', summary: 'Company Feed post created', metadataKeys: ['postType', 'status'] },
  company_feed_post_status_updated: { canonicalAction: 'feed.post.status_changed', module: 'feed', summary: 'Company Feed post status changed', metadataKeys: ['previousStatus', 'newStatus'] },
};

const SECRET_KEY_PATTERN = /(password|secret|token|cookie|authorization|database.?url|redis.?url|api.?key|private.?key|reset|credential|passkey|latitude|longitude|coordinates?|salary|amount|balance|description|reason|body|content|headers?|ip.?address)/i;

export const AUDIT_MODULES = [
  'auth',
  'attendance',
  'assets',
  'breaks',
  'employees',
  'feed',
  'expenses',
  'geofence',
  'grievances',
  'hiring',
  'leave',
  'notifications',
  'organisation',
  'payroll',
  'performance',
  'resignations',
  'roster',
  'workspace',
] as const;

export function presentAuditEvent(
  storedAction: string,
  entityType: string,
  metadataValue: unknown,
): AuditPresentation {
  const definition = DEFINITIONS[storedAction];
  if (!definition) {
    return {
      action: storedAction,
      module: inferAuditModule(storedAction, entityType),
      summary: 'Audit event recorded',
      severity: storedAction.includes('rejected') || storedAction.includes('failed') ? 'warning' : 'neutral',
      metadata: {},
    };
  }

  const source = metadataValue && typeof metadataValue === 'object' && !Array.isArray(metadataValue)
    ? metadataValue as Record<string, unknown>
    : {};
  const metadata = Object.fromEntries(
    (definition.metadataKeys || [])
      .filter((key) => !SECRET_KEY_PATTERN.test(key) && source[key] !== undefined)
      .map((key) => [key, source[key]]),
  );

  return {
    action: definition.canonicalAction,
    module: definition.module,
    summary: definition.summary,
    severity: definition.severity || 'informational',
    metadata,
  };
}

export function inferAuditModule(action: string, entityType: string) {
  const prefix = action.split(/[._]/, 1)[0];
  const direct: Record<string, string> = {
    passkey: 'auth',
    asset: 'assets',
    software: 'assets',
    clock: 'attendance',
    company: entityType === 'company_location' ? 'geofence' : 'feed',
    employee: 'employees',
    grievance: 'grievances',
    hiring: 'hiring',
    leave: 'leave',
    payroll: 'payroll',
    performance: 'performance',
    profile: 'employees',
    resignation: 'resignations',
    roster: 'roster',
    offboarding: 'resignations',
    tenant: 'workspace',
  };
  return direct[prefix] || 'workspace';
}

export function storedActionsForFilter(action: string) {
  const matches = Object.entries(DEFINITIONS)
    .filter(([storedAction, definition]) => storedAction === action || definition.canonicalAction === action)
    .map(([storedAction]) => storedAction);
  return matches.length > 0 ? [...new Set(matches)] : [action];
}

const WRITE_METADATA_ALLOWLIST: Record<string, readonly string[]> = {
  'asset.created': ['assetTag', 'category'],
  'asset.assigned': ['assetTag', 'targetEmployeeId'],
  'asset.returned': ['assetTag', 'condition'],
  'asset.updated': ['assetTag'],
  'asset.condition_reported': ['assetTag', 'condition'],
  'asset.lost': ['assetTag'],
  'asset.retired': ['assetTag'],
  'software_license.created': ['licenseName'],
  'software_license.updated': ['licenseName'],
  'software_license.assigned': ['licenseName', 'targetEmployeeId'],
  'software_license.revoked': ['licenseName'],
  'document_extraction.requested': ['extractionId', 'mode', 'inputMimeType', 'inputSizeBytes', 'provider', 'status'],
  'document_extraction.completed': ['extractionId', 'mode', 'provider', 'status', 'fieldNames', 'warningCount'],
  'document_extraction.failed': ['extractionId', 'mode', 'provider', 'status'],
  'document_extraction.deleted': ['extractionId', 'mode', 'provider', 'status'],
  'expense.claim_submitted': ['claimId', 'employeeId', 'category', 'currency', 'status', 'extractionAssociated'],
  'expense.approver_resolved': ['claimId', 'employeeId', 'approverEmployeeId', 'category', 'currency', 'status', 'extractionAssociated'],
  'expense.approver_unconfigured': ['claimId', 'employeeId', 'category', 'currency', 'status', 'extractionAssociated'],
  'expense.claim_approved': ['claimId', 'employeeId', 'approverEmployeeId', 'category', 'currency', 'status', 'extractionAssociated'],
  'expense.claim_rejected': ['claimId', 'employeeId', 'approverEmployeeId', 'category', 'currency', 'status', 'extractionAssociated'],
  'expense.claim_cancelled': ['claimId', 'employeeId', 'approverEmployeeId', 'category', 'currency', 'status', 'extractionAssociated'],
  'expense.claim_reimbursed': ['claimId', 'employeeId', 'approverEmployeeId', 'category', 'currency', 'status', 'extractionAssociated'],
  'employee.role.assigned': ['roleName', 'systemKey', 'privileged'],
  'employee.role.privileged_assigned': ['roleName', 'systemKey', 'privileged'],
  'employee.role.removed': ['roleName', 'systemKey', 'privileged'],
  'employee.role.privileged_removed': ['roleName', 'systemKey', 'privileged'],
  'employee.salary.updated': ['payType', 'currency', 'effectiveFrom'],
  'organisation.role.created': ['isSystem', 'permissionCount'],
  'organisation.role.updated': ['isSystem'],
  'organisation.role.permissions_updated': ['roleId', 'previousPermissionCount', 'newPermissionCount', 'addedCount', 'removedCount'],
  'organisation.role.assigned': ['assignmentId', 'employeeId', 'roleId', 'scopeType', 'scopeId', 'hasExpiry'],
  'organisation.role.revoked': ['assignmentId', 'employeeId', 'roleId', 'scopeType', 'scopeId', 'hasExpiry'],
  'organisation.role.duplicated': ['sourceRoleId', 'isSystem', 'permissionCount'],
  'organisation.role.archived': ['isSystem', 'activeAssignmentCount'],
  'geofence.created': ['name', 'locationType', 'radius', 'isPrimary'],
  'geofence.updated': ['name', 'locationType', 'radius', 'isPrimary', 'isActive'],
  'location.created': ['locationId', 'geofenceType', 'active'],
  'location.updated': ['locationId', 'geofenceType', 'active'],
  'location.archived': ['locationId', 'active', 'usageCounts'],
  'location.restored': ['locationId', 'active', 'usageCounts'],
  'payroll.approved': ['previousStatus', 'newStatus', 'payPeriodStart', 'payPeriodEnd'],
  'payroll.paid': ['previousStatus', 'newStatus', 'payPeriodStart', 'payPeriodEnd'],
  'payroll.cancelled': ['previousStatus', 'newStatus', 'payPeriodStart', 'payPeriodEnd'],
  'leave.requested': ['leaveType', 'startDate', 'endDate'],
  'leave.cancelled': ['leaveType', 'startDate', 'endDate', 'status'],
  'leave.approver_resolved': ['requestId', 'employeeId', 'approverEmployeeId', 'leaveType', 'startDate', 'endDate', 'approvalSource', 'scopeType', 'status'],
  'leave.approver_unconfigured': ['requestId', 'employeeId', 'leaveType', 'startDate', 'endDate', 'status'],
  'leave.approved': ['requestId', 'employeeId', 'approverEmployeeId', 'leaveType', 'startDate', 'endDate', 'approvalSource', 'scopeType', 'status'],
  'leave.rejected': ['requestId', 'employeeId', 'approverEmployeeId', 'leaveType', 'startDate', 'endDate', 'approvalSource', 'scopeType', 'status'],
  'leave.schedule_conflict_detected': ['leaveRequestId', 'employeeId', 'conflictCount', 'status'],
  'grievance.status_changed': ['previousStatus', 'newStatus'],
  'hiring.stage_changed': ['previousStage', 'newStage'],
  'auth.session.revoked': ['revocationType'],
  'auth.sessions.revoked_all': ['revokedCount', 'revocationType'],
  'auth.session.revoked_by_admin': ['revocationType'],
  'performance.cycle.created': ['cycleName'],
  'performance.cycle.started': ['cycleName'],
  'performance.cycle.finalised': ['cycleName'],
  'performance.review.assigned': ['reviewerType'],
  'performance.review.submitted': ['reviewerType'],
  'performance.review.reopened': [],
  'performance.review.finalised': [],
  'performance.goal.created': ['goalType'],
  'performance.goal.updated': ['progressPercent'],
  'performance.goal.completed': [],
  'performance.peer.assigned': [],
  'performance.recognition.awarded': ['recognitionMonth'],
  'performance.recognition.replaced': ['recognitionMonth'],
  'performance.recognition.revoked': ['recognitionMonth'],
  'performance.recognition.delivered': ['deliveredVia'],
  'roster.shift_swap.requested': ['swapId', 'requesterEmployeeId', 'targetEmployeeId', 'status'],
  'roster.shift_swap.target_accepted': ['swapId', 'requesterEmployeeId', 'targetEmployeeId', 'status'],
  'roster.shift_swap.target_declined': ['swapId', 'requesterEmployeeId', 'targetEmployeeId', 'status'],
  'roster.shift_swap.cancelled': ['swapId', 'requesterEmployeeId', 'targetEmployeeId', 'status'],
  'roster.shift_swap.approver_resolved': ['swapId', 'requesterEmployeeId', 'targetEmployeeId', 'approverEmployeeId', 'approvalSource', 'scopeType', 'status'],
  'roster.shift_swap.approved': ['swapId', 'requesterEmployeeId', 'targetEmployeeId', 'approverEmployeeId', 'approvalSource', 'scopeType', 'status'],
  'roster.shift_swap.applied': ['swapId', 'requesterEmployeeId', 'targetEmployeeId', 'approverEmployeeId', 'approvalSource', 'scopeType', 'status'],
  'roster.shift_swap.rejected': ['swapId', 'requesterEmployeeId', 'targetEmployeeId', 'approverEmployeeId', 'approvalSource', 'scopeType', 'status'],
  'roster.shift_swap.approval_conflict': ['swapId', 'requesterEmployeeId', 'targetEmployeeId', 'approverEmployeeId', 'status'],
};

export async function recordAuditEvent(
  client: PoolClient,
  event: {
    tenantId: string;
    actorId: string | null;
    action: keyof typeof WRITE_METADATA_ALLOWLIST;
    targetType: string;
    targetId: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  const allowedKeys = WRITE_METADATA_ALLOWLIST[event.action];
  const source = event.metadata || {};
  const rejectedKey = Object.keys(source).find((key) => SECRET_KEY_PATTERN.test(key) || !allowedKeys.includes(key));
  if (rejectedKey) throw new Error(`Audit metadata key is not allowed for ${event.action}.`);

  await client.query(
    `INSERT INTO audit_logs (tenant_id, actor_employee_id, action, entity_type, entity_id, metadata)
     VALUES ($1, $2, $3::varchar, $4::varchar, $5, $6::jsonb)`,
    [event.tenantId, event.actorId, event.action, event.targetType, event.targetId, JSON.stringify(source)],
  );
}
