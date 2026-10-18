import assert from 'node:assert/strict';
import { fixtureId } from './demo/core';
import { validateFixtureManifest } from './demo/reset';
const id = fixtureId('employees:test');
assert.deepEqual(validateFixtureManifest({ employees: [id, id] }), { employees: [id] });
assert.deepEqual(validateFixtureManifest({}), {});
for (const input of [null, [], 42, { employees: 'all' }, { employees: [null] }, { employees: ['not-a-uuid'] }, { tenants: [id] }, { 'employees; DROP TABLE tenants': [id] }, { employees: Array(10001).fill(id) }])
    assert.throws(() => validateFixtureManifest(input), /Invalid demo fixture manifest/);
assert.equal(fixtureId('employees:test'), id);
assert.notEqual(fixtureId('employees:other'), id);
console.log('PASS deterministic fixture IDs and bounded, table-allowlisted manifest validation.');

// Full Demo is an explicit tenant allowlist; new registry keys fail closed.
const {demoAdminPermissions}=await import('./demo/admin-persona');
const {PERMISSION_REGISTRY,validatePermissionKeys}=await import('../src/server/organisation/permission-registry');
const {demoIntegrityPermissions}=await import('./demo/full-demo-permissions');
assert(validatePermissionKeys(demoAdminPermissions));
assert.equal(new Set(demoAdminPermissions).size,demoAdminPermissions.length);
for(const p of PERMISSION_REGISTRY){assert.equal((demoAdminPermissions as readonly string[]).includes(p.key),!p.key.startsWith('platform.'),'Explicitly classify '+p.key);}
for(const key of demoIntegrityPermissions)assert((demoAdminPermissions as readonly string[]).includes(key));
for(const key of ['attendance.view_live','sessions.manage','roles.view','roles.manage','payroll.run','communications.send','hiring.hire','grievances.confidential'])assert((demoAdminPermissions as readonly string[]).includes(key));
console.log('PASS Full Demo explicit tenant capability allowlist, identity-integrity classification and platform exclusions');
