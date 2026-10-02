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
