import type { PoolClient } from 'pg';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
/** Server-owned conversion. No caller can inject privileges or candidate fields. */
export async function createHiredEmployee(c: PoolClient, tenantId: string, candidate: {
    full_name: string;
    email: string;
}, job: {
    title: string;
    manager_id: string | null;
    department_id: string | null;
    location_id: string | null;
    employment_type: string;
}, startDate: string) {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [candidate.email.toLowerCase()]);
    if ((await c.query('SELECT 1 FROM stanza_auth_tenant($1)', [candidate.email])).rowCount)
        throw Object.assign(Error('An employee account already uses this email.'), { statusCode: 409 });
    if (job.manager_id && !(await c.query("SELECT 1 FROM employees WHERE tenant_id=$1 AND id=$2 AND is_active AND employment_status='active'", [tenantId, job.manager_id])).rowCount)
        throw Object.assign(Error('Hiring manager unavailable.'), { statusCode: 409 });
    const hash = await bcrypt.hash(crypto.randomBytes(48).toString('base64url'), 12);
    const employee = (await c.query("INSERT INTO employees(tenant_id,full_name,email,password_hash,role,job_title,manager_id,department_id,primary_location_id,employment_type,employment_start_date) VALUES($1,$2,$3,$4,'employee',$5,$6,$7,$8,$9,$10) RETURNING id", [tenantId, candidate.full_name, candidate.email, hash, job.title, job.manager_id, job.department_id, job.location_id, job.employment_type, startDate])).rows[0];
    await c.query("INSERT INTO employee_role_assignments(tenant_id,employee_id,role_id,scope_type) SELECT $1,$2,id,'company' FROM tenant_roles WHERE tenant_id=$1 AND system_key='employee'", [tenantId, employee.id]);
    for (const title of ['Review employee profile', 'Arrange equipment', 'Plan first shift', 'Review digital badge and role access'])
        await c.query('INSERT INTO hiring_onboarding_tasks(tenant_id,employee_id,title) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [tenantId, employee.id, title]);
    return employee;
}
