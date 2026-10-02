import bcrypt from 'bcryptjs';
import { PERMISSION_REGISTRY, validatePermissionKeys } from '../../src/server/organisation/permission-registry';
import { employeeFixtures, emailFor, COMPANY, demoAmount, type DemoContext } from './core';
export const employeePermissions = ['locations.read', 'attendance.clock', 'break_requests.create', 'break_requests.view_own', 'leave.create', 'leave.view.self', 'leave.cancel.self', 'payroll.view_self', 'payroll.export_pdf', 'loans.view_self', 'grievances.create', 'grievances.view_own', 'feed.read', 'expenses.submit.self', 'expenses.view.self', 'expenses.cancel.self', 'roster.goals.view_self', 'roster.goals.complete_self', 'performance.view', 'performance.review', 'organisation.view'];
export const managerPermissions = [...employeePermissions, 'attendance.view', 'attendance.view_live', 'break_requests.review', 'break_requests.view_all', 'leave.view.scoped', 'leave.approve', 'leave.review', 'roster.view_all', 'roster.goals.view_scoped', 'roster.goals.manage', 'performance.manage_goals', 'performance.view_reports', 'expenses.view.scoped', 'expenses.approve'];
export const customRoles = [{ name: 'Recruitment Coordinator', person: 'recruiter', keys: ['hiring.view', 'hiring.create', 'hiring.edit', 'hiring.add_notes', 'hiring.view_notes', 'hiring.advance_stage'] }, { name: 'Payroll Specialist', person: 'payroll', keys: ['payroll.export_pdf', 'expenses.view.scoped', 'attendance.view'] }, { name: 'Operations Supervisor', person: 'ops', keys: ['attendance.view', 'attendance.view_live', 'break_requests.review', 'break_requests.view_all', 'roster.goals.view_scoped', 'roster.goals.manage'] }];
export async function seedOrganisation(ctx: DemoContext) {
    const { client, tenantId: t } = ctx;
    await client.query('UPDATE tenants SET company_name=$2 WHERE id=$1', [t, COMPANY]);
    // Registry catalogue is shared across tenants: never overwrite it while seeding.
    const catalog = (await client.query('SELECT permission_key FROM tenant_permissions')).rows.map(r => r.permission_key);
    const missing = PERMISSION_REGISTRY.filter(p => !catalog.includes(p.key));
    if (missing.length)
        throw new Error(`Apply permission migrations before seeding: ${missing.map(p => p.key).join(', ')}`);
    const roles = new Map<string, string>();
    for (const [key, name, keys] of [['employee', 'Employee', employeePermissions], ['manager', 'Manager', managerPermissions], ['hr_admin', 'HR Admin', PERMISSION_REGISTRY.map(p => p.key)]] as const) {
        const found = await client.query('SELECT id FROM tenant_roles WHERE tenant_id=$1 AND system_key=$2', [t, key]);
        const id = found.rows[0]?.id ?? await ctx.row('tenant_roles', key, { name, description: `Northstar ${name} access.`, system_key: key, is_system: true, is_active: true });
        roles.set(key, id);
        if (!validatePermissionKeys(keys))
            throw new Error('Invalid built-in fixture permissions');
        await client.query('DELETE FROM tenant_role_permissions WHERE tenant_id=$1 AND role_id=$2', [t, id]);
        for (const permission of keys)
            await client.query('INSERT INTO tenant_role_permissions(tenant_id,role_id,permission_key) VALUES($1,$2,$3)', [t, id, permission]);
    }
    for (const role of customRoles) {
        if (!validatePermissionKeys(role.keys) || role.keys.some(k => { const p = PERMISSION_REGISTRY.find(p => p.key === k)!; return p.protected || !p.delegatable; }))
            throw new Error(`Invalid custom role: ${role.name}`);
        const id = await ctx.row('tenant_roles', role.person, { name: role.name, description: `Supports ${role.name.toLowerCase()} duties without company administration.`, is_system: false, is_active: true });
        roles.set(role.person, id);
        await client.query('DELETE FROM tenant_role_permissions WHERE tenant_id=$1 AND role_id=$2', [t, id]);
        for (const key of role.keys)
            await client.query('INSERT INTO tenant_role_permissions(tenant_id,role_id,permission_key) VALUES($1,$2,$3)', [t, id, key]);
    }
    const password = process.env.DEMO_PASSWORD?.trim();
    if (!password || password.length < 12)
        throw new Error('DEMO_PASSWORD must contain at least 12 characters for new demo employees.');
    const hash = await bcrypt.hash(password, 12);
    for (const [key, name, department, title, role, , salary] of employeeFixtures) {
        const existing = await client.query('SELECT id FROM employees WHERE tenant_id=$1 AND email=$2', [t, emailFor(key)]);
        let id = existing.rows[0]?.id;
        if (!id)
            id = await ctx.row('employees', key, { full_name: name, email: emailFor(key), password_hash: hash, role, job_title: title, created_at: ctx.time(key === 'new' ? -6 : -540), is_active: key !== 'former', employment_status: key === 'former' ? 'terminated' : 'active' });
        else
            await client.query('UPDATE employees SET full_name=$3,role=$4,job_title=$5,is_active=$6,employment_status=$7 WHERE tenant_id=$1 AND id=$2', [t, id, name, role, title, key !== 'former', key === 'former' ? 'terminated' : 'active']);
        ctx.people.set(key, id);
        if (['admin', 'manager', 'employee'].includes(key))
            ctx.tables.get('employees')?.delete(id);
        await ctx.row('employee_compensation_profiles', key, { employee_id: id, pay_type: 'monthly', base_amount: demoAmount(ctx, salary), currency: ctx.currency, effective_from: ctx.date(-180), is_active: true, created_by: null, updated_by: null });
    }
    for (const [key, , department, title, role, manager] of employeeFixtures) {
        const id = ctx.people.get(key)!;
        const head = employeeFixtures.find(e => e[2] === department && (e[4] === 'manager' || e[4] === 'hr_admin'))!;
        let dep = ctx.departments.get(department);
        if (!dep) {
            const existing = await client.query('SELECT id FROM organisation_departments WHERE tenant_id=$1 AND name=$2', [t, department]);
            dep = existing.rows[0]?.id ?? await ctx.row('organisation_departments', department, { name: department, code: department.toUpperCase().replace(/[^A-Z]/g, ''), description: `Northstar ${department} team.`, department_head_id: ctx.people.get(head[0]), grievance_enabled: ['Human Resources', 'Operations', 'IT'].includes(department) });
            ctx.departments.set(department, dep!);
        }
        const team = await ctx.row('organisation_teams', department, { name: `Northstar ${department}`, department_id: dep, description: `Day-to-day ${department.toLowerCase()} delivery.`, team_lead_id: ctx.people.get(head[0]) });
        const job = await ctx.row('organisation_job_titles', title, { name: title, description: `${title} at Northstar Systems.`, level: role === 'employee' ? 2 : 4 });
        await client.query('UPDATE employees SET department_id=$3,team_id=$4,job_title_id=$5,manager_id=$6 WHERE tenant_id=$1 AND id=$2', [t, id, dep, team, job, manager ? ctx.people.get(manager) : null]);
        await ctx.row('organisation_team_memberships', key, { team_id: team, employee_id: id, membership_type: key === head[0] ? 'lead' : 'member', starts_at: ctx.date(-180), ends_at: key === 'former' ? ctx.date(-30) : null });
        await client.query("DELETE FROM employee_role_assignments a USING tenant_roles r WHERE a.tenant_id=$1 AND a.employee_id=$2 AND r.id=a.role_id AND r.tenant_id=a.tenant_id AND r.system_key IN ('employee','manager','hr_admin') AND r.system_key<>$3 AND NOT($3='manager' AND r.system_key='employee')", [t, id, role]);
        if (role !== 'manager')
            await client.query("INSERT INTO employee_role_assignments(tenant_id,employee_id,role_id,assigned_by,scope_type,assigned_at) SELECT $1,$2,$3,$4,'company',$5 WHERE NOT EXISTS(SELECT 1 FROM employee_role_assignments WHERE tenant_id=$1 AND employee_id=$2 AND role_id=$3 AND revoked_at IS NULL)", [t, id, roles.get(role), ctx.people.get('admin'), ctx.time(-180)]);
        else {
            // Personal rights use the Employee role; managerial rights use the direct-report scope.
            for (const [r, scope] of [[roles.get('employee'), 'company'], [roles.get('manager'), 'direct_reports']] as const)
                await client.query('INSERT INTO employee_role_assignments(tenant_id,employee_id,role_id,assigned_by,scope_type,assigned_at) SELECT $1,$2,$3,$4,$5::varchar,$6 WHERE NOT EXISTS(SELECT 1 FROM employee_role_assignments WHERE tenant_id=$1 AND employee_id=$2 AND role_id=$3 AND scope_type=$5 AND revoked_at IS NULL)', [t, id, r, ctx.people.get('admin'), scope, ctx.time(-180)]);
            // Reconcile obsolete company-wide manager assignments from the original seed.
            await client.query("UPDATE employee_role_assignments SET revoked_at=NOW(),revoked_by=$4 WHERE tenant_id=$1 AND employee_id=$2 AND role_id=$3 AND scope_type='company' AND revoked_at IS NULL", [t, id, roles.get('manager'), ctx.people.get('admin')]);
        }
    }
    for (const r of customRoles) {
        const id = ctx.people.get(r.person)!;
        await client.query("INSERT INTO employee_role_assignments(tenant_id,employee_id,role_id,assigned_by,scope_type,assigned_at) SELECT $1,$2,$3,$4,'company',$5 WHERE NOT EXISTS(SELECT 1 FROM employee_role_assignments WHERE tenant_id=$1 AND employee_id=$2 AND role_id=$3 AND revoked_at IS NULL)", [t, id, roles.get(r.person), ctx.people.get('admin'), ctx.time(-90)]);
    }
    await client.query("UPDATE organisation_team_memberships SET ends_at=CURRENT_DATE WHERE tenant_id=$1 AND employee_id=ANY($2::uuid[]) AND ends_at IS NULL AND team_id IN(SELECT id FROM organisation_teams WHERE tenant_id=$1 AND name=ANY($3::text[]))", [t, [ctx.people.get('admin'), ctx.people.get('manager'), ctx.people.get('employee')], ['People Operations', 'Platform Engineering']]);
    for (const table of ['organisation_departments', 'organisation_teams'])
        await client.query(`UPDATE ${table} SET is_active=false WHERE tenant_id=$1 AND name=ANY($2::text[]) AND NOT EXISTS(SELECT 1 FROM employees e WHERE e.tenant_id=$1 AND (e.department_id=${table}.id OR e.team_id=${table}.id))`, [t, table === 'organisation_departments' ? ['People & Operations', 'Product & Engineering', 'Finance & Administration'] : ['People Operations', 'Talent Acquisition', 'Platform Engineering', 'Finance Operations']]);
    const locations = [['Cairo HQ', 'headquarters', 30.0444, 31.2357, true], ['Alexandria Office', 'branch', 31.2001, 29.9187, false]] as const;
    for (const [name, type, lat, lng, primary] of locations) {
        const result = await client.query('SELECT id FROM company_locations WHERE tenant_id=$1 AND name=$2', [t, name]);
        const location = result.rows[0]?.id ?? await ctx.row('company_locations', name, { name, location_type: type, address: `Fictional ${name} worksite`, latitude: lat, longitude: lng, radius_meters: 300, boundary: (await client.query('SELECT ST_AsEWKT(ST_Buffer(ST_SetSRID(ST_MakePoint($1,$2),4326)::geography,300)::geometry) AS boundary', [lng, lat])).rows[0].boundary, is_primary: primary, is_active: true });
        await client.query('UPDATE company_locations SET boundary=ST_Buffer(ST_SetSRID(ST_MakePoint($3,$4),4326)::geography,300)::geometry WHERE tenant_id=$1 AND id=$2', [t, location, lng, lat]);
        await client.query('UPDATE organisation_teams SET location_id=$2 WHERE tenant_id=$1 AND name LIKE $3 AND (name=$4)=$5', [t, location, 'Northstar %', 'Northstar Sales & Success', name === 'Alexandria Office']);
    }
    // Legacy headquarters is retained for any manual records referencing it.
    await client.query("UPDATE company_locations SET is_primary=false WHERE tenant_id=$1 AND name='Headquarters'", [t]);
    const boundary = (await client.query("SELECT ST_AsEWKT(boundary) AS boundary FROM company_locations WHERE tenant_id=$1 AND name='Cairo HQ'", [t])).rows[0].boundary;
    await ctx.row('geofences', 'Cairo HQ', { name: 'Cairo HQ', boundary });
}
