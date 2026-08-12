import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getPermissionDefinition } from '../src/server/organisation/permission-registry';

const [migration, routes, evaluator, server, audit, dashboard, panel, language, performanceMigration] = await Promise.all([
  readFile('src/db/migrations/20260811_add_roster_goals.sql', 'utf8'),
  readFile('src/server/roster/roster-goal-routes.ts', 'utf8'),
  readFile('src/server/organisation/scoped-permissions.ts', 'utf8'),
  readFile('server.ts', 'utf8'),
  readFile('src/server/audit/audit-events.ts', 'utf8'),
  readFile('src/pages/Dashboard.tsx', 'utf8'),
  readFile('src/components/roster/RosterGoalsPanel.tsx', 'utf8'),
  readFile('src/lib/LanguageContext.tsx', 'utf8'),
  readFile('src/db/migrations/20260725_add_performance_management.sql', 'utf8'),
]);

assert.match(migration, /^BEGIN;/);
assert.match(migration, /COMMIT;\s*$/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS roster_goals/);
assert.match(migration, /roster_goals_id_tenant_unique UNIQUE \(id, tenant_id\)/);
for (const constraint of ['employee_tenant_fk', 'created_by_tenant_fk', 'updated_by_tenant_fk', 'team_tenant_fk']) {
  assert.match(migration, new RegExp(`roster_goals_${constraint}`));
}
assert.match(migration, /CHECK \(EXTRACT\(ISODOW FROM roster_week_start\) = 1\)/);
assert.match(migration, /due_date BETWEEN roster_week_start AND roster_week_start \+ 6/);
assert.match(migration, /roster_goals_open_carry_forward_idx/);
assert.match(migration, /ALTER TABLE roster_goals ENABLE ROW LEVEL SECURITY/);
assert.match(migration, /tenant_id = NULLIF\(current_setting\('app\.current_tenant', true\), ''\)::uuid/);

const goalPermissionKeys = [
  'roster.goals.view_self',
  'roster.goals.view_scoped',
  'roster.goals.manage',
  'roster.goals.complete_self',
] as const;
for (const key of goalPermissionKeys) {
  assert.match(migration, new RegExp(`'${key.replaceAll('.', '\\.')}'`));
  assert.ok(getPermissionDefinition(key), `${key} must be present in the fixed permission registry`);
}
assert.equal(getPermissionDefinition('roster.goals.manage')?.delegatable, true);
assert.deepEqual(getPermissionDefinition('roster.goals.manage')?.allowedScopeTypes, ['company', 'location', 'department', 'team', 'direct_reports']);

assert.match(server, /registerRosterGoalRoutes/);
assert.match(server, /standardAuth: demoAuth/);
assert.match(routes, /type Dependencies = \{ standardAuth: Middleware;/);
assert.doesNotMatch(routes, /\b(?:hr_admin|manager|team_leader)\b/i);
for (const endpoint of [
  "app.get('/api/roster/goals'",
  "app.get('/api/roster/goals/assignees'",
  "app.post('/api/roster/goals'",
  "app.patch('/api/roster/goals/:goalId'",
  "app.post('/api/roster/goals/:goalId/status'",
  "app.post('/api/roster/goals/:goalId/cancel'",
]) assert.ok(routes.includes(endpoint), `${endpoint} must be registered`);
assert.match(routes, /resolveScopedPermission/);
assert.match(routes, /permissionKey: 'roster\.goals\.manage'/);
assert.match(routes, /permissionKey: 'roster\.goals\.view_scoped'/);
assert.match(routes, /permissionKey: 'roster\.goals\.view_self'/);
assert.match(routes, /permissionKey: 'roster\.goals\.complete_self'/);
assert.match(evaluator, /FROM permission_delegations delegation/);
assert.match(evaluator, /delegation\.status='active'/);
assert.match(evaluator, /delegation\.revoked_at IS NULL/);
assert.match(evaluator, /delegation\.starts_at<=NOW\(\) AND delegation\.expires_at>NOW\(\)/);
assert.match(evaluator, /assignment\.revoked_at IS NULL/);
assert.match(evaluator, /assignment\.expires_at IS NULL OR assignment\.expires_at>NOW\(\)/);

assert.match(routes, /withTenant\(user\.tenantId/);
assert.ok((routes.match(/goal\.tenant_id=\$1/g) || []).length >= 4, 'goal reads and writes must include the authenticated tenant');
assert.match(routes, /employee\.tenant_id=\$1 AND employee\.is_active=true AND employee\.employment_status='active'/);
assert.match(routes, /The selected active team does not include this employee/);
assert.match(routes, /FOR UPDATE/);
assert.match(routes, /current\.status === 'pending'/);
assert.match(routes, /new Set\(\['in_progress', 'completed'\]\)/);
assert.match(routes, /current\.status === 'in_progress' \? new Set\(\['completed'\]\)/);
assert.match(routes, /LIMIT 200/);
assert.match(routes, /goal\.roster_week_start<\$3::date AND goal\.status IN \('pending','in_progress'\)/);
assert.match(routes, /overdueCarryForward: includeOverdue/);
assert.match(routes, /strictFields\(req\.body, \['employeeId', 'teamId', 'weekStart', 'dueDate', 'title', 'description', 'priority'\]\)/);
assert.match(routes, /strictFields\(req\.body, \['status', 'completionNote'\]\)/);

for (const action of [
  'roster.goal.created',
  'roster.goal.updated',
  'roster.goal.reassigned',
  'roster.goal.status_changed',
  'roster.goal.completed',
  'roster.goal.cancelled',
]) {
  assert.match(audit, new RegExp(action.replaceAll('.', '\\.')));
  assert.match(routes, new RegExp(action.replaceAll('.', '\\.')));
}
const auditCalls = routes.match(/recordAuditEvent\(client, \{[^\n]+/g) || [];
assert.ok(auditCalls.length >= 6);
assert.equal(auditCalls.some((call) => /(?:title|description|completionNote):/.test(call)), false, 'audit metadata must not copy goal text');

assert.match(performanceMigration, /CREATE TABLE IF NOT EXISTS performance_goals/);
assert.match(performanceMigration, /cycle_id UUID/);
assert.doesNotMatch(migration, /review_cycle_id|weight|target_value/);
assert.match(dashboard, /const RosterGoalsPanel = lazy/);
assert.match(dashboard, /\['goals', t\('rosterGoals\.title'\)\]/);
assert.match(dashboard, /rosterSubview === 'goals'/);
assert.match(dashboard, /<RosterGoalsPanel employeeId=\{selectedRosterEmployeeId\} weekStart=\{rosterGoalWeekStart\}/);
assert.match(dashboard, /compact[\s\S]{0,120}onOpenFull=\{\(\) => setRosterSubview\('goals'\)\}/);

assert.match(panel, /capabilities\.canManage/);
assert.match(panel, /capabilities\.canComplete/);
assert.match(panel, /status: 'in_progress' \| 'completed'/);
assert.match(panel, /completionNote/);
assert.match(panel, /stanza-roster-goal-card/);
assert.match(panel, /visibleOverdue/);
assert.match(panel, /sm:items-center/);
assert.match(panel, /max-h-\[calc\(100dvh/);
assert.match(panel, /dir=\{isRtl \? 'rtl' : 'ltr'\}/);
assert.match(panel, /event\.key !== 'Escape'/);
assert.match(panel, /returnFocusRef\.current\?\.focus/);
assert.match(panel, /const loadAssignees = useCallback/);
assert.match(panel, /setEditing\('new'\);\s*void loadAssignees\(\)/);
assert.match(panel, /setEditing\(goal\);\s*void loadAssignees\(\)/);
assert.doesNotMatch(panel, /useEffect\(\(\) => \{\s*if \(!capabilities\.canManage\)/, 'assignees must not load until the manager opens the goal dialog');
assert.doesNotMatch(panel, /\b(?:hr_admin|manager|team_leader)\b/i);

for (const key of [
  'rosterGoals.title',
  'rosterGoals.assign',
  'rosterGoals.complete',
  'rosterGoals.overdueTitle',
  'rosterGoals.assigneesError',
]) {
  assert.equal((language.match(new RegExp(`'${key.replaceAll('.', '\\.')}':`, 'g')) || []).length, 2, `${key} must have English and Arabic translations`);
}

console.log('Roster goal data, scope, audit, UI, and localisation contracts passed.');
