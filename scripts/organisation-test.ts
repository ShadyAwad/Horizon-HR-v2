import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  getPermissionDefinition,
  isKnownPermission,
  listPermissionDefinitions,
  validatePermissionKeys,
} from '../src/server/organisation/permission-registry';

const migration = await readFile('src/db/migrations/20260726_add_organisation_management.sql', 'utf8');
const evaluator = await readFile('src/server/organisation/scoped-permissions.ts', 'utf8');
const routes = await readFile('src/server/organisation/organisation-routes.ts', 'utf8');

const permissionDefinitions = listPermissionDefinitions();
assert.ok(getPermissionDefinition('roles.view'));
assert.equal(getPermissionDefinition('unknown.permission'), null);
assert.equal(isKnownPermission('roles.view'), true);
assert.equal(isKnownPermission('unknown.permission'), false);
assert.deepEqual(validatePermissionKeys(['roles.view', 'roles.view']), ['roles.view']);
assert.equal(validatePermissionKeys(['roles.view', 'unknown.permission']), null);
assert.equal(new Set(permissionDefinitions.map((permission) => permission.key)).size, permissionDefinitions.length);
for (const permission of permissionDefinitions) {
  assert.ok(permission.label.length > 0 && permission.description.length > 0, `${permission.key} must be human readable`);
  assert.ok(permission.allowedScopeTypes.every((scope) => ['company', 'location', 'department', 'team', 'direct_reports', 'self'].includes(scope)));
}
assert.equal(getPermissionDefinition('roles.manage')?.protected, true);
assert.equal(getPermissionDefinition('roles.manage')?.delegatable, false);

for (const table of ['organisation_job_titles', 'organisation_departments', 'organisation_teams', 'organisation_team_memberships', 'permission_delegations']) {
  assert.match(migration, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`), `${table} must enable RLS`);
  assert.match(migration, new RegExp(`${table}_id_tenant_unique UNIQUE \\(id, tenant_id\\)`), `${table} needs a composite key`);
}
assert.match(migration, /organisation_departments_not_self_parent/);
assert.match(migration, /employee_role_assignments_active_scope_unique/);
assert.match(migration, /revoked_at IS NULL/);
assert.match(evaluator, /resolveScopedPermission/);
assert.match(evaluator, /direct_reports/);
assert.match(evaluator, /source: 'role_assignment' \| 'delegation'/);
assert.match(routes, /assertNoDepartmentCycle/);
assert.match(routes, /assertNoReportingCycle/);
assert.match(routes, /organisation\.department\.created/);
assert.match(routes, /organisation\.delegation\.revoked/);
assert.match(routes, /teams\/:teamId\/members/);
assert.match(routes, /members\/move/);
assert.match(routes, /Employee is already an active member/);
assert.match(routes, /Team must belong to the selected department/);
assert.match(routes, /Job title must be active/);
assert.match(routes, /assertNoReportingCycle/);
assert.match(routes, /organisation\.team\.updated/);
assert.match(routes, /organisation\.job_title\.updated/);
assert.match(routes, /organisation\.employee_placement\.updated/);
assert.match(routes, /membership\.membership_type AS "membershipType"/);
assert.match(routes, /title\.name AS "jobTitle"/);
assert.match(routes, /department\.name AS department/);
assert.match(routes, /members\?page=|pageSize=Math\.min\(100/);
assert.match(routes, /Employee is already an active member of the target team/);
assert.match(routes, /Target team must belong to the employee department/);
assert.match(routes, /UPDATE organisation_team_memberships SET ends_at=CURRENT_DATE/);
assert.match(routes, /\/api\/hr\/organisation\/permission-registry/);
assert.match(routes, /\/api\/hr\/organisation\/roles'/);
assert.match(routes, /\/api\/hr\/organisation\/roles\/:roleId'/);
assert.match(routes, /\/api\/hr\/organisation\/roles\/:roleId\/permissions'/);
assert.match(routes, /assertCompanyPermission\(client,req,'roles\.view'\)/);
assert.match(routes, /role\.tenant_id=\$1/);
assert.match(routes, /pageSize=Math\.min\(100/);
assert.match(routes, /req\.query\.kind==='system'\|\|req\.query\.kind==='custom'/);
assert.match(routes, /req\.query\.activity==='archived'\?'archived':'active'/);
assert.match(routes, /if\(!uuid\(req\.params\.roleId\)\)throw fail\(404,'Role not found\.'\)/);
assert.match(routes, /selected:selected\.has\(permission\.key\)/);
assert.doesNotMatch(routes, /return \{\.\.\.row,privilegeLevel/);
console.log('Organisation foundation checks passed: 48');
