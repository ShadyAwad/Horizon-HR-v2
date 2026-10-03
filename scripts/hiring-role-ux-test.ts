import { toggleHiringStage, defaultHiringFilters, hasHiringFilters } from '../src/lib/hiring-filters';
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import {getMigrationPool} from './migration-pool';
import { spawnSync } from 'node:child_process';
import { assertDatabaseMutationSafety, assertHttpMutationSafety } from './mutation-safety';
import { filterCapabilities, groupCapabilities, selectedCapabilities } from '../src/lib/role-capabilities';
import { PERMISSION_REGISTRY } from '../src/server/organisation/permission-registry';
assertDatabaseMutationSafety(process.env.DATABASE_URL, 'Hiring role integration integration');
const base = assertHttpMutationSafety(process.env.HIRING_ROLE_TEST_BASE_URL || 'http://localhost:3000', 'Hiring role integration integration');
const pool = getMigrationPool();
let tenants: string[] = [];
let legacyCreated = false;
const password = crypto.randomBytes(24).toString('base64url');
const tag = crypto.randomUUID().slice(0, 8);
try {
    const initial = { ...defaultHiringFilters(), page: 3, search: 'Ahmed', department: 'Engineering' };
    const chosen = toggleHiringStage(initial, 'hr_review');
    assert.equal(chosen.stage, 'hr_review');
    assert.equal(chosen.search, 'Ahmed');
    assert.equal(chosen.department, 'Engineering');
    assert.equal(chosen.page, 1);
    assert.equal(toggleHiringStage(chosen, 'hr_review').stage, '');
    assert.equal(hasHiringFilters(chosen), true);
    assert.equal(hasHiringFilters(defaultHiringFilters()), false);
    const items = PERMISSION_REGISTRY.map((item, i) => ({ ...item, selected: i % 3 === 0 }));
    for (const item of items)
        assert.ok(item.label && item.description && item.category && item.label !== item.key);
    assert.equal(filterCapabilities(items, '  ATTENDANCE ', true).every(item => item.selected && `${item.label} ${item.description} ${item.category} ${item.key}`.toLowerCase().includes('attendance')), true);
    assert.equal(filterCapabilities(items, 'communications.templates.manage').length, 1);
    assert.equal(selectedCapabilities(items).flatMap(([, group]) => group).length, items.filter(item => item.selected).length);
    assert.equal(groupCapabilities(items).flatMap(([, group]) => group).length, items.length);
    const people: Record<string, {
        id: string;
        email: string;
        cookie: string;
    }> = {};
    let adminRole = '';
    for (let index = 0; index < 2; index++) {
        const tenant = (await pool.query('INSERT INTO tenants(slug,company_name) VALUES($1,$2) RETURNING id', [`hiring-role-test-${tag}-${index}`, 'Hiring role integration disposable verification'])).rows[0].id;
        tenants.push(tenant);
        for (const role of index ? ['foreign'] : ['hr_admin', 'manager', 'employee']) {
            const email = `hiring-role-test-${role}-${tag}@example.invalid`, id = (await pool.query('INSERT INTO employees(tenant_id,email,full_name,password_hash,role) VALUES($1,$2,$3,$4,$5) RETURNING id', [tenant, email, 'Verification ' + role, await bcrypt.hash(password, 10), role === 'foreign' ? 'employee' : role])).rows[0].id;
            const r = (await pool.query('INSERT INTO tenant_roles(tenant_id,name,system_key,is_system) VALUES($1,$2,$3,true) RETURNING id', [tenant, role, role === 'foreign' ? null : role])).rows[0].id;
            if (role === 'foreign')
                await pool.query('INSERT INTO tenant_role_permissions(tenant_id,role_id,permission_key) SELECT $1,$2,permission_key FROM tenant_permissions', [tenant, r]);
            if (role === 'hr_admin') {
                adminRole = r;
                await pool.query('INSERT INTO tenant_role_permissions(tenant_id,role_id,permission_key) SELECT $1,$2,permission_key FROM tenant_permissions', [tenant, r]);
            }
            if (role === 'manager')
                await pool.query("INSERT INTO tenant_role_permissions(tenant_id,role_id,permission_key) SELECT $1,$2,permission_key FROM tenant_permissions WHERE permission_key LIKE 'hiring.%' AND permission_key NOT IN ('hiring.make_final_decision','hiring.edit')", [tenant, r]);
            await pool.query("INSERT INTO employee_role_assignments(tenant_id,employee_id,role_id,scope_type) VALUES($1,$2,$3,'company')", [tenant, id, r]);
            const response = await fetch(base + '/api/auth/login', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
            assert.equal(response.status, 200);
            people[role] = { id, email, cookie: response.headers.get('set-cookie')!.split(';')[0] };
        }
    }
    const call = async (path: string, body?: unknown, method = 'POST', who = 'hr_admin') => { const response = await fetch(base + path, { method: body === undefined ? 'GET' : method, headers: { Cookie: people[who].cookie, Origin: base, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
    for (const [i, stage] of ['new', 'hr_review', 'final_review', 'new'].entries())
        await pool.query('INSERT INTO hiring_applicants(tenant_id,full_name,position_title,department,stage,created_by) VALUES($1,$2,$3,$4,$5,$6)', [tenants[0], i === 3 ? 'Other candidate' : 'Ahmed ' + stage, 'Verification engineer', i === 3 ? 'Other' : 'Engineering', stage, people.hr_admin.id]);
    const counts = await call('/api/hiring/applicants?pageSize=1');
    assert.equal(counts.body.stageCounts.new, 2);
    assert.equal(counts.body.stageCounts.hr_review, 1);
    for (const stage of ['new', 'hr_review', 'final_review']) {
        const r = await call(`/api/hiring/applicants?stage=${stage}&search=Ahmed&department=Engineering`);
        assert.equal(r.body.total, 1);
        assert.equal(r.body.applicants[0].stage, stage);
        assert.equal(r.body.stageCounts.new, 1);
    }
    assert.equal((await call('/api/hiring/applicants?stage=new&search=missing')).body.total, 0);
    assert.equal((await call('/api/hiring/applicants')).body.total, 4);
    const prose = 'Coordinates attendance reviews and responds to employees.';
    const created = await call('/api/hr/organisation/roles', { name: 'Verification support role', description: prose });
    assert.equal(created.status, 201);
    const role = created.body.role.id;
    assert.equal((await call(`/api/hr/organisation/roles/${role}/permissions`, { permissionKeys: ['attendance.view', 'hiring.view'] }, 'PUT')).status, 200);
    assert.equal((await call(`/api/hr/organisation/roles/${role}`)).body.role.description, prose);
    assert.equal((await call(`/api/hr/organisation/roles/${role}`, { description: prose + ' Updated.' }, 'PATCH')).status, 200);
    assert.equal((await call(`/api/hr/organisation/roles/${role}/permissions`, { permissionKeys: ['hiring.view'] }, 'PUT')).status, 200);
    const legacy = 'hiring-role-test.legacy.' + tag;
    await pool.query('INSERT INTO tenant_permissions(permission_key,label,description) VALUES($1,$2::varchar,$2::varchar)', [legacy, 'Disposable legacy permission']);
    legacyCreated = true;
    await pool.query('INSERT INTO tenant_role_permissions(tenant_id,role_id,permission_key) VALUES($1,$2,$3)', [tenants[0], role, legacy]);
    assert.ok((await call(`/api/hr/organisation/roles/${role}/permissions`)).body.permissions.some((p: {
        key: string;
        legacy: boolean;
        selected: boolean;
    }) => p.key === legacy && p.legacy && p.selected));
    assert.equal((await call(`/api/hr/organisation/roles/${role}/permissions`, { permissionKeys: ['hiring.view', legacy] }, 'PUT')).status, 200);
    assert.equal((await call(`/api/hr/organisation/roles/${role}/permissions`, { permissionKeys: [legacy + '.unknown'] }, 'PUT')).status, 400);
    assert.equal((await call(`/api/hr/organisation/roles/${role}/permissions`, { permissionKeys: ['hiring.view'] }, 'PUT')).status, 200);
    assert.equal((await call(`/api/hr/organisation/roles/${role}/permissions`, { permissionKeys: [legacy] }, 'PUT')).status, 400);
    await pool.query('DELETE FROM tenant_permissions WHERE permission_key=$1', [legacy]);
    assert.equal((await call(`/api/hr/organisation/roles/${adminRole}/permissions`, { permissionKeys: ['hiring.view'] }, 'PUT')).status, 403);
    assert.equal((await call(`/api/hr/organisation/roles/${role}/permissions`, { permissionKeys: ['payroll.run'] }, 'PUT')).status, 403);
    assert.equal((await call('/api/hr/organisation/roles', { name: 'Denied' }, 'POST', 'employee')).status, 403);
    assert.equal((await call(`/api/hr/organisation/roles/${role}`, undefined, 'GET', 'foreign')).status, 404);
    assert.equal((await call(`/api/hr/organisation/roles/${crypto.randomUUID()}/permissions`, { permissionKeys: ['hiring.view'] }, 'PUT')).status, 404);
    if (process.argv.includes('--with-hiring-integration')) {
        const child = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/hiring-integration-test.ts'], { stdio: 'inherit', env: { ...process.env, HIRING_TEST_BASE_URL: base, HIRING_TEST_ADMIN_EMAIL: people.hr_admin.email, HIRING_TEST_MANAGER_EMAIL: people.manager.email, HIRING_TEST_EMPLOYEE_EMAIL: people.employee.email, HIRING_TEST_PASSWORD: password } });
        assert.equal(child.status, 0, 'Hiring integration failed');
    }
    console.log('PASS Hiring role integration: canonical full stage counts, stage/search/department composition, empty/reset, metadata/search/group/selected summary, role create/edit prose, legacy preservation/removal/new-key rejection, protected/system roles, unauthorized and tenant boundaries.');
}
finally {
    if (tenants.length)
        await pool.query('DELETE FROM tenants WHERE id=ANY($1::uuid[])', [tenants]);
    if (legacyCreated)
        await pool.query('DELETE FROM tenant_permissions WHERE permission_key=$1', ['hiring-role-test.legacy.' + tag]);
    await pool.end();
}
