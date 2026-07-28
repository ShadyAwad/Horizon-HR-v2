import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [migration, approvalMigration, conflictMigration, routes, resolver, scopedPermissions, registry, audit, server, leaveWorkspace, dashboard, packageJson] = await Promise.all([
  readFile('src/db/migrations/20260729_add_leave_self_service.sql', 'utf8'),
  readFile('src/db/migrations/20260729_add_leave_approval_context.sql', 'utf8'),
  readFile('src/db/migrations/20260729_add_leave_roster_conflicts.sql', 'utf8'),
  readFile('src/server/leave/leave-routes.ts', 'utf8'),
  readFile('src/server/organisation/approval-chain.ts', 'utf8'),
  readFile('src/server/organisation/scoped-permissions.ts', 'utf8'),
  readFile('src/server/organisation/permission-registry.ts', 'utf8'),
  readFile('src/server/audit/audit-events.ts', 'utf8'),
  readFile('server.ts', 'utf8'),
  readFile('src/components/roster/LeaveWorkspace.tsx', 'utf8'),
  readFile('src/pages/Dashboard.tsx', 'utf8'),
  readFile('package.json', 'utf8'),
]);

assert.match(migration, /BEGIN;/);
assert.match(migration, /COMMIT;/);
assert.match(migration, /ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1/);
assert.match(migration, /submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/);
assert.match(migration, /cancelled_at TIMESTAMPTZ/);
assert.match(migration, /leave_requests_id_tenant_unique UNIQUE \(id, tenant_id\)/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS leave_request_history/);
assert.match(migration, /REFERENCES leave_requests\(id, tenant_id\)/);
assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
assert.match(migration, /leave_request_history_tenant_isolation/);
assert.match(migration, /leave\.request\.self/);
assert.match(migration, /leave\.view\.self/);
assert.match(migration, /leave\.cancel\.self/);

assert.match(approvalMigration, /BEGIN;/);
assert.match(approvalMigration, /COMMIT;/);
assert.match(approvalMigration, /approver_employee_id UUID/);
assert.match(approvalMigration, /approval_source VARCHAR\(40\)/);
assert.match(approvalMigration, /approval_scope_type VARCHAR\(30\)/);
assert.match(approvalMigration, /approval_scope_id UUID/);
assert.match(approvalMigration, /approval_resolved_at TIMESTAMPTZ/);
assert.match(approvalMigration, /approval_decided_at TIMESTAMPTZ/);
assert.match(approvalMigration, /approved_at TIMESTAMPTZ/);
assert.match(approvalMigration, /rejected_at TIMESTAMPTZ/);
assert.match(approvalMigration, /REFERENCES employees\(id, tenant_id\)/);
assert.match(approvalMigration, /leave_requests_approver_pending_idx/);
assert.match(approvalMigration, /leave_requests_pending_actionable_idx/);
assert.match(approvalMigration, /leave\.view\.scoped/);
assert.match(approvalMigration, /leave\.approve/);
assert.match(approvalMigration, /leave\.manage/);

assert.match(conflictMigration, /BEGIN;/);
assert.match(conflictMigration, /COMMIT;/);
assert.match(conflictMigration, /CREATE TABLE IF NOT EXISTS leave_roster_conflicts/);
assert.match(conflictMigration, /UNIQUE \(id, tenant_id\)/);
assert.match(conflictMigration, /UNIQUE \(tenant_id, leave_request_id, roster_shift_id\)/);
assert.match(conflictMigration, /REFERENCES leave_requests\(id, tenant_id\)/);
assert.match(conflictMigration, /REFERENCES roster_shifts\(id, tenant_id\)/);
assert.match(conflictMigration, /REFERENCES employees\(id, tenant_id\)/);
assert.match(conflictMigration, /status IN \('open','acknowledged','resolved','obsolete'\)/);
assert.match(conflictMigration, /ENABLE ROW LEVEL SECURITY/);
assert.match(conflictMigration, /leave_roster_conflicts_tenant_isolation/);
assert.match(conflictMigration, /leave_roster_conflicts_open_request_idx/);
assert.match(conflictMigration, /leave_roster_conflicts_open_shift_idx/);
assert.match(conflictMigration, /obsolete_leave_roster_conflicts_for_shift/);
assert.match(conflictMigration, /NEW\.status <> 'scheduled'/);
assert.match(conflictMigration, /NEW\.employee_id <> request\.employee_id/);
assert.match(conflictMigration, /NEW\.start_time >= \(\(request\.end_date \+ 1\)::timestamp AT TIME ZONE 'UTC'\)/);

assert.match(registry, /definePermission\('leave\.request\.self'/);
assert.match(registry, /definePermission\('leave\.view\.self'/);
assert.match(registry, /definePermission\('leave\.cancel\.self'/);
assert.match(registry, /definePermission\('leave\.view\.scoped'/);
assert.match(registry, /definePermission\('leave\.approve'/);
assert.match(registry, /definePermission\('leave\.manage'.*companyScope, false/);
assert.match(server, /registerLeaveRoutes\(app, \{ standardAuth: demoAuth/);
assert.match(routes, /\/api\/me\/leave-requests/);
assert.match(routes, /\/api\/me\/leave-requests\/:requestId/);
assert.match(routes, /\/api\/me\/leave-requests\/:requestId\/cancel/);
assert.match(routes, /strictFields\(req\.body, \['leaveType', 'startDate', 'endDate', 'reason'\]\)/);
assert.match(routes, /LEAVE_TYPES/);
assert.match(routes, /MAX_LEAVE_DAYS/);
assert.match(routes, /status IN \('pending','approved'\)/);
assert.match(routes, /employee_id=\$2/);
assert.match(routes, /ORDER BY submitted_at DESC,id DESC/);
assert.match(routes, /FOR UPDATE/);
assert.match(routes, /expectedVersion/);
assert.match(routes, /version=version\+1/);
assert.match(routes, /Only pending leave requests may be cancelled/);
assert.match(routes, /leave_request_history/);
assert.match(routes, /recordAuditEvent/);
assert.doesNotMatch(routes, /grievance/);
assert.match(routes, /resolveApprovalChain/);
assert.match(routes, /requiredPermissionKey: 'leave\.approve'/);
assert.match(routes, /excludedEmployeeIds: \[user\.employeeId\]/);
assert.match(resolver, /direct_manager/);
assert.match(resolver, /team_leader/);
assert.match(resolver, /department_head/);
assert.match(resolver, /reporting_chain/);
assert.match(resolver, /scoped_role/);
assert.match(resolver, /authority\.source === 'delegation'/);
assert.match(resolver, /is_active=true AND employment_status='active'/);
assert.match(resolver, /candidateId === input\.requestingEmployeeId/);
assert.match(scopedPermissions, /delegation\.status='active'/);
assert.match(scopedPermissions, /delegation\.revoked_at IS NULL/);
assert.match(scopedPermissions, /delegation\.starts_at<=NOW\(\)/);
assert.match(scopedPermissions, /delegation\.expires_at>NOW\(\)/);
assert.match(routes, /notification\.leave_approval_required/);
assert.match(routes, /notification\.leave_approver_unconfigured/);
assert.match(routes, /leave-approval-required:\$\{row\.request_id\}/);
assert.match(routes, /leave-approver-unconfigured:\$\{requestId\}/);
assert.match(routes, /\/api\/hr\/leave-requests'/);
assert.match(routes, /\/api\/hr\/leave-requests\/:requestId'/);
assert.match(routes, /\/api\/hr\/leave-requests\/:requestId\/approve/);
assert.match(routes, /\/api\/hr\/leave-requests\/:requestId\/reject/);
assert.match(routes, /leave\.view\.scoped/);
assert.match(routes, /leave\.manage/);
assert.match(routes, /targetEmployeeId: request\.employee_id/);
assert.match(routes, /request\.employee_id === actorId/);
assert.match(routes, /throw fail\(404, 'Leave request not found\.'\)/);
assert.match(routes, /actionableOnly/);
assert.match(routes, /departmentId/);
assert.match(routes, /teamId/);
assert.match(routes, /locationId/);
assert.match(routes, /search/);
assert.match(routes, /visible\.slice\(offset, offset \+ pageSize\)/);
assert.match(routes, /FOR UPDATE OF request/);
assert.match(routes, /current\.status !== 'pending'/);
assert.match(routes, /current\.version !== req\.body\.expectedVersion/);
assert.match(routes, /status='pending' AND version=\$4/);
assert.match(routes, /version=version\+1/);
assert.match(routes, /status='approved'/);
assert.match(routes, /notification\.leave_approved/);
assert.match(routes, /notification\.leave_rejected/);
assert.match(routes, /leave-approved/);
assert.match(routes, /leave-rejected/);
assert.match(routes, /payload->>'idempotencyKey'/);
assert.match(routes, /deepLink: \{ section: 'roster', view: 'leave'/);
assert.doesNotMatch(routes, /UPDATE roster_shifts/);
assert.match(routes, /detectApprovedLeaveConflicts/);
assert.match(routes, /status='scheduled' AND end_time>NOW\(\)/);
assert.match(routes, /start_time < \(\(\$4::date \+ 1\)::timestamp AT TIME ZONE 'UTC'\)/);
assert.match(routes, /end_time > \(\$3::date::timestamp AT TIME ZONE 'UTC'\)/);
assert.match(routes, /ORDER BY id FOR UPDATE/);
assert.match(routes, /INSERT INTO leave_roster_conflicts/);
assert.match(routes, /ON CONFLICT \(tenant_id,leave_request_id,roster_shift_id\)/);
assert.match(routes, /notification\.leave_roster_conflict/);
assert.match(routes, /leave-roster-conflict:\$\{input\.requestId\}:\$\{shift\.id\}/);
assert.match(routes, /leave\.schedule_conflict_detected/);
assert.match(routes, /conflictCount: rosterConflicts\.length/);
assert.match(routes, /schedulerAttentionRequired/);
assert.match(routes, /conflictingShifts/);
assert.match(routes, /shift\.start_time,shift\.end_time,shift\.status AS shift_status/);
assert.doesNotMatch(routes.match(/function conflictSummary[\s\S]*?\n\}/)?.[0] || '', /reason|approval_note|salary|email/);
assert.match(server, /resolveScopedPermission/);
assert.match(server, /async function rosterScopeAccess/);
assert.match(server, /targetEmployeeId/);
assert.match(server, /permissionKeys = requireManage \? \['roster\.manage'\] : \['roster\.manage', 'roster\.view_all'\]/);
assert.match(server, /approved_leave\.leave_request_id/);
assert.match(server, /request\.status='approved'/);
assert.match(server, /AS approved_leave/);
assert.match(server, /AS has_roster_conflict/);
assert.match(server, /leave_start_date/);
assert.match(server, /leave_end_date/);
assert.match(server, /recordApprovedLeaveConflictsForShift/);
assert.match(server, /notification\.leave_roster_conflict/);
assert.match(server, /ON CONFLICT \(tenant_id,leave_request_id,roster_shift_id\)/);
assert.doesNotMatch(
  server.match(/LEFT JOIN LATERAL \(\s*SELECT request\.id AS leave_request_id[\s\S]*?\) approved_leave ON true/)?.[0] || '',
  /reason|approval_note/,
);
assert.match(audit, /'leave\.requested'/);
assert.match(audit, /'leave\.cancelled'/);
assert.match(audit, /'leave\.approver_resolved'/);
assert.match(audit, /'leave\.approver_unconfigured'/);
assert.match(audit, /'leave\.approved'/);
assert.match(audit, /'leave\.rejected'/);
assert.match(audit, /'leave\.schedule_conflict_detected'/);
assert.doesNotMatch(audit.match(/'leave\.schedule_conflict_detected': \[[^\]]*\]/)?.[0] || '', /reason|note|shiftPayload/);
assert.doesNotMatch(audit.match(/'leave\.approved': \[[^\]]*\]/)?.[0] || '', /reason|note/);
assert.match(packageJson, /"test:leave"/);

assert.match(leaveWorkspace, /data-leave-workspace/);
assert.match(leaveWorkspace, /myRequests: 'My Requests'/);
assert.match(leaveWorkspace, /upcoming: 'Upcoming Leave'/);
assert.match(leaveWorkspace, /history: 'History'/);
assert.match(leaveWorkspace, /approvals: 'Approvals'/);
assert.match(leaveWorkspace, /myRequests: 'طلباتي'/);
assert.match(leaveWorkspace, /approvals: 'الموافقات'/);
assert.match(leaveWorkspace, /dir=\{isRtl \? 'rtl' : 'ltr'\}/);
assert.match(leaveWorkspace, /role="tablist"/);
assert.match(leaveWorkspace, /role="tab"/);
assert.match(leaveWorkspace, /aria-selected=\{view === value\}/);
assert.match(leaveWorkspace, /ArrowLeft.*ArrowRight.*Home.*End/);
assert.match(leaveWorkspace, /overflow-x-auto/);
assert.match(leaveWorkspace, /max-h-\[calc\(100dvh-1rem\)\]/);
assert.match(leaveWorkspace, /sm:max-h-\[calc\(100dvh-2rem\)\]/);
assert.match(leaveWorkspace, /role="dialog"/);
assert.match(leaveWorkspace, /aria-modal="true"/);
assert.match(leaveWorkspace, /focusableSelector/);
assert.match(leaveWorkspace, /event\.key === 'Escape'/);
assert.match(leaveWorkspace, /restoreFocusRef\.current\?\.focus\(\)/);

assert.match(leaveWorkspace, /apiFetch\('\/api\/me\/leave-requests'/);
assert.match(leaveWorkspace, /apiFetch\(`\/api\/me\/leave-requests\/\$\{requestId\}`\)/);
assert.match(leaveWorkspace, /apiFetch\(`\/api\/me\/leave-requests\/\$\{detail\.request\.requestId\}\/cancel`/);
assert.match(leaveWorkspace, /leaveType: requestForm\.leaveType/);
assert.match(leaveWorkspace, /startDate: requestForm\.startDate/);
assert.match(leaveWorkspace, /endDate: requestForm\.endDate/);
assert.match(leaveWorkspace, /reason: requestForm\.reason\.trim\(\) \|\| null/);
assert.match(leaveWorkspace, /submittingRef\.current/);
assert.match(leaveWorkspace, /response\.status === 409 \? copy\.conflictError/);
assert.match(leaveWorkspace, /setRequestStep\('review'\)/);
assert.match(leaveWorkspace, /setRequestStep\('success'\)/);
assert.match(leaveWorkspace, /approvalConfigured \? copy\.approvalPending : copy\.noApprover/);
assert.match(leaveWorkspace, /expectedVersion: detail\.request\.version/);
assert.match(leaveWorkspace, /response\.status === 409 \? copy\.staleRequest/);
assert.match(leaveWorkspace, /conflictingShifts/);
assert.match(leaveWorkspace, /onOpenSchedule/);
assert.match(leaveWorkspace, /loadRequests\(\)/);
assert.match(leaveWorkspace, /role="status"/);
assert.match(leaveWorkspace, /role="alert"/);
assert.match(leaveWorkspace, /copy\.retry/);
assert.match(leaveWorkspace, /pageCount/);
assert.match(leaveWorkspace, /approvalPageCount/);

assert.match(leaveWorkspace, /apiFetch\(`\/api\/hr\/leave-requests\?\$\{query\.toString\(\)\}`\)/);
assert.match(leaveWorkspace, /loadApprovals\(true\)/);
assert.match(leaveWorkspace, /hasApproverAuthorityHint/);
assert.match(leaveWorkspace, /approvalVisible/);
assert.doesNotMatch(leaveWorkspace, /role === ['"](?:hr_admin|manager|team_leader)['"]/);
assert.match(leaveWorkspace, /approvalSourceLabel/);
assert.match(leaveWorkspace, /scopeLabel/);
assert.match(leaveWorkspace, /approvalDetail\.request\.canDecide/);
assert.match(leaveWorkspace, /\/\$\{decision\}`/);
assert.match(leaveWorkspace, /expectedVersion: approvalDetail\.request\.version/);
assert.match(leaveWorkspace, /Promise\.all\(\[loadApprovals\(\), loadApprovalDetail\(requestId\), loadRequests\(\)\]\)/);
assert.match(leaveWorkspace, /apiFetch\('\/api\/hr\/organisation\/departments'\)/);
assert.match(leaveWorkspace, /apiFetch\('\/api\/hr\/organisation\/teams'\)/);
assert.match(leaveWorkspace, /apiFetch\('\/api\/company-locations'\)/);
assert.match(leaveWorkspace, /query\.set\('departmentId', approvalDepartmentId\)/);
assert.match(leaveWorkspace, /query\.set\('teamId', approvalTeamId\)/);
assert.match(leaveWorkspace, /query\.set\('locationId', approvalLocationId\)/);
assert.match(leaveWorkspace, /Promise\.allSettled/);
assert.match(leaveWorkspace, /Scoped approval remains usable when optional filter metadata is unavailable/);
assert.match(leaveWorkspace, /item\.isActive !== false/);
assert.match(leaveWorkspace, /item\.is_active !== false/);

assert.match(dashboard, /const LeaveWorkspace = lazy/);
assert.match(dashboard, /rosterSubview === 'leave'/);
assert.match(dashboard, /<LeaveWorkspace/);
assert.match(dashboard, /hasApproverAuthorityHint=\{hasLeaveApproverAuthority\}/);
assert.match(dashboard, /onOpenSchedule=\{\(\) => setRosterSubview\('schedule'\)\}/);
assert.match(dashboard, /void refreshAttentionCounts\(\)/);
assert.match(dashboard, /void loadRosterShifts\(\)/);
assert.match(dashboard, /setActiveTab\('roster'\);\s*setRosterSubview\('leave'\)/);
assert.match(dashboard, /stanza:notification-deep-link/);
assert.match(dashboard, /notification\.leave_approval_required/);
assert.match(dashboard, /leaveView/);
assert.match(dashboard, /requestId/);
assert.match(dashboard, /isUuidString\(navigation\.requestId\)/);
assert.match(dashboard, /approved_leave\?: boolean/);
assert.match(dashboard, /has_roster_conflict\?: boolean/);
assert.match(dashboard, /approvedLeave: Boolean\(shift\.approved_leave\)/);
assert.match(dashboard, /hasRosterConflict: Boolean\(shift\.has_roster_conflict\)/);
assert.match(dashboard, /s\.approvedLeave && s\.leaveRequestId/);
assert.match(dashboard, /setLeaveDeepLink\(\{ view: 'requests', requestId: s\.leaveRequestId \|\| null \}\)/);
assert.doesNotMatch(
  dashboard.match(/const openLeaveRequestFlow[\s\S]*?\n\s*\};/)?.[0] || '',
  /grievance|leave_request/,
);

assert.doesNotMatch(leaveWorkspace, /\/api\/leave-requests(?:[?'`/])/);
assert.doesNotMatch(leaveWorkspace, /category:\s*['"]leave_request['"]/);
assert.doesNotMatch(leaveWorkspace, /salary|password|tokenHash|approval_scope_id|role_assignment/);

console.log('Leave self-service, scoped approval, roster conflict, and UI contracts passed');
