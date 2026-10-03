import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { spawnSync } from 'node:child_process';
import {getMigrationPool} from './migration-pool';
import { assertDatabaseMutationSafety, assertHttpMutationSafety } from './mutation-safety';
assertDatabaseMutationSafety(process.env.DATABASE_URL, 'Communications session checks');
const base = assertHttpMutationSafety(process.env.COMMUNICATIONS_TEST_BASE_URL || 'http://localhost:3000', 'Communications session checks');
const pool = getMigrationPool();
const tag = crypto.randomUUID(), password = crypto.randomBytes(24).toString('base64url');
let tenant: string | undefined;
let foreignTenant: string | undefined;
try {
    tenant = (await pool.query('INSERT INTO tenants(slug,company_name) VALUES($1,$2) RETURNING id', ['communications-session-' + tag, 'Disposable communications verification'])).rows[0].id;
    foreignTenant = (await pool.query('INSERT INTO tenants(slug,company_name) VALUES($1,$2) RETURNING id', ['communications-foreign-' + tag, 'Disposable foreign tenant'])).rows[0].id;
    const foreignEmployee = (await pool.query('INSERT INTO employees(tenant_id,email,full_name,password_hash,role) VALUES($1,$2,$3,$4,$5) RETURNING id', [foreignTenant, 'foreign-' + tag + '@example.invalid', 'Foreign fixture', await bcrypt.hash(password, 10), 'employee'])).rows[0].id;
    const people: Record<string, {
        id: string;
        email: string;
        cookie: string;
    }> = {};
    for (const role of ['hr_admin', 'manager', 'employee']) {
        const email = `communications-${role}-${tag}@example.invalid`;
        const id = (await pool.query('INSERT INTO employees(tenant_id,email,full_name,password_hash,role) VALUES($1,$2,$3,$4,$5) RETURNING id', [tenant, email, 'Communications ' + role, await bcrypt.hash(password, 10), role])).rows[0].id;
        const r = (await pool.query('INSERT INTO tenant_roles(tenant_id,name,system_key,is_system) VALUES($1,$2,$2,true) RETURNING id', [tenant, role])).rows[0].id;
        if (role === 'hr_admin')
            await pool.query('INSERT INTO tenant_role_permissions(tenant_id,role_id,permission_key) SELECT $1,$2,permission_key FROM tenant_permissions', [tenant, r]);
        if (role === 'employee')
            await pool.query("INSERT INTO tenant_role_permissions(tenant_id,role_id,permission_key) VALUES($1,$2,'communications.send')", [tenant, r]);
        await pool.query("INSERT INTO employee_role_assignments(tenant_id,employee_id,role_id,scope_type) VALUES($1,$2,$3,'company')", [tenant, id, r]);
        if (role === 'employee') {
            for (const state of ['revoked','expired','future','inactive']) {
                const invalidRole=(await pool.query('INSERT INTO tenant_roles(tenant_id,name,is_active) VALUES($1,$2,$3) RETURNING id',[tenant,'Invalid authority '+state,state!=='inactive'])).rows[0].id;
                await pool.query("INSERT INTO tenant_role_permissions(tenant_id,role_id,permission_key) VALUES($1,$2,'payroll.run')",[tenant,invalidRole]);
                await pool.query("INSERT INTO employee_role_assignments(tenant_id,employee_id,role_id,scope_type,assigned_at,revoked_at,expires_at) VALUES($1,$2,$3,'company',CASE WHEN $4='future' THEN now()+interval '1 day' ELSE now() END,CASE WHEN $4='revoked' THEN now() END,CASE WHEN $4='expired' THEN now()-interval '1 minute' END)",[tenant,id,invalidRole,state]);
            }
        }
        const response = await fetch(base + '/api/auth/login', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
        assert.equal(response.status, 200);
        people[role] = { id, email, cookie: response.headers.get('set-cookie')!.split(';')[0] };
        if (role === 'employee') {
            const login=await response.json();
            assert(!login.user.permissions.includes('payroll.run'),'Login excludes inactive authority');
            assert(!login.user.roleNames.some((name:string)=>name.startsWith('Invalid authority')),'Login excludes inactive role names');
            const session=await fetch(base+'/api/auth/session',{headers:{Cookie:people[role].cookie}});
            assert.equal(session.status,200);
            assert(!(await session.json()).user.permissions.includes('payroll.run'),'Session refresh excludes inactive authority');
            console.log('PASS login/session exclude revoked, expired, future and inactive role grants.');
        }

    }
    const call = async (role: string, path: string, body?: unknown, origin = base) => { const r = await fetch(base + '/api/communications' + path, { method: body ? 'POST' : 'GET', headers: { Cookie: people[role].cookie, Origin: origin, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json() }; };
    assert.equal((await call('manager', '/messages')).status, 403);
    const draft = { subject: 'Session regression', body: 'Fictional test, not sent', category: 'custom', recipientIds: [people.employee.id] };
    assert.equal((await call('employee', '/drafts', draft, 'https://evil.invalid')).status, 403);
    const saved = await call('employee', '/drafts', draft);
    assert.equal(saved.status, 200);
    assert.equal((await call('employee', '/messages/' + saved.body.message.id)).status, 200);
    assert.equal((await call('hr_admin', '/messages/' + saved.body.message.id)).status, 404);
    console.log('PASS real cookie sessions: HR/manager/employee permissions, private drafts, same-origin rejection.');
    const env = { ...process.env, SECURITY_TEST_BASE_URL: base, SECURITY_TEST_ADMIN_EMAIL: people.hr_admin.email, SECURITY_TEST_ADMIN_PASSWORD: password, SECURITY_TEST_EMPLOYEE_EMAIL: people.employee.email, SECURITY_TEST_EMPLOYEE_PASSWORD: password, AUTHZ_TEST_BASE_URL: base, AUTHZ_OTHER_TENANT_EMPLOYEE_ID: foreignEmployee, AUTHZ_ADMIN_EMAIL: people.hr_admin.email, AUTHZ_ADMIN_PASSWORD: password, AUTHZ_MANAGER_EMAIL: people.manager.email, AUTHZ_MANAGER_PASSWORD: password };
    for (const script of ['scripts/security-test.ts', 'scripts/authorization-test.ts']) {
        const result = spawnSync(process.execPath, ['--import', 'tsx', script], { env, stdio: 'inherit' });
        assert.equal(result.status, 0, script);
    }
}
finally {
    if (tenant) {
        await pool.query('DELETE FROM communication_messages WHERE tenant_id=$1', [tenant]);
        await pool.query('DELETE FROM tenants WHERE id=$1', [tenant]);
    }
    if (foreignTenant) await pool.query('DELETE FROM tenants WHERE id=$1', [foreignTenant]);
    await pool.end();
}
