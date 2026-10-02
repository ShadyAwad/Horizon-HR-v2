import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
export const DEMO_SLUG = 'stanza-demo';
export const COMPANY = 'Northstar Systems';
export function fixtureId(key: string) { const h = createHash('sha256').update(`stanza-demo-v8:${key}`).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; }
export type DemoContext = {
    client: PoolClient;
    tenantId: string;
    currency: string;
    loans: boolean;
    mode: string;
    now: Date;
    people: Map<string, string>;
    departments: Map<string, string>;
    tables: Map<string, Set<string>>;
    row: (table: string, key: string, data: Record<string, unknown>, immutable?: boolean) => Promise<string>;
    date: (days: number) => string;
    time: (days: number, hour?: number, minute?: number) => string;
};
export async function identifyDemo(client: PoolClient, create = false) {
    const result = await client.query("SELECT id,slug,default_currency,allows_company_loans,to_jsonb(t)->>'is_demo_tenant' AS demo FROM tenants t WHERE slug=$1 FOR UPDATE", [DEMO_SLUG]);
    const tenant = result.rows[0];
    if (tenant) {
        if (tenant.demo === 'false' || (tenant.demo === null && process.env.DEMO_TENANT_ID !== tenant.id))
            throw new Error('Demo target lacks a positive marker. Apply the demo classification migration or explicitly identify this legacy demo UUID with DEMO_TENANT_ID.');
        if (process.env.DEMO_TENANT_ID && process.env.DEMO_TENANT_ID !== tenant.id)
            throw new Error('DEMO_TENANT_ID does not match stanza-demo.');
        return tenant;
    }
    if (!create)
        return null;
    const inserted = await client.query("INSERT INTO tenants(id,slug,company_name,default_currency,allows_company_loans,is_demo_tenant) VALUES($1,$2,$3,'EGP',true,true) RETURNING *", [fixtureId('tenant'), DEMO_SLUG, COMPANY]);
    return inserted.rows[0];
}
export function context(client: PoolClient, tenant: {
    id: string;
    default_currency: string;
    allows_company_loans: boolean;
}, mode: string): DemoContext {
    const now = new Date();
    now.setUTCHours(0, 0, 0, 0);
    const tables = new Map<string, Set<string>>();
    const ctx: DemoContext = { client, tenantId: tenant.id, currency: tenant.default_currency, loans: tenant.allows_company_loans, mode, now, people: new Map(), departments: new Map(), tables,
        date: (days) => new Date(now.getTime() + days * 86400000).toISOString().slice(0, 10), time: (days, hour = 9, minute = 0) => new Date(now.getTime() + days * 86400000 + hour * 3600000 + minute * 60000).toISOString(),
        async row(table, key, data, immutable = false) {
            if (!/^[a-z_]+$/.test(table) || Object.keys(data).some(k => !/^\w+$/.test(k)))
                throw new Error('Invalid fixture identifier');
            let id = fixtureId(`${table}:${key}`);
            const natural: Record<string, string[]> = { organisation_job_titles: ['name'], organisation_teams: ['name'], company_locations: ['name'], geofences: ['name'], employee_compensation_profiles: ['employee_id', 'is_active'], payroll_records: ['employee_id', 'pay_period_start', 'pay_period_end'] };
            const fields = natural[table];
            if (fields) {
                const existing = await client.query(`SELECT id FROM ${table} WHERE tenant_id=$1 AND ${fields.map((f, i) => `${f}=$${i + 2}`).join(' AND ')}`, [tenant.id, ...fields.map(f => data[f])]);
                if (existing.rows[0])
                    id = existing.rows[0].id;
            }
            const values = { id, tenant_id: tenant.id, ...data };
            const columns = Object.keys(values);
            const assignments = columns.filter(k => !['id', 'tenant_id'].includes(k)).map(k => `${k}=EXCLUDED.${k}`).join(',');
            const q = `INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map((_, i) => '$' + (i + 1)).join(',')}) ON CONFLICT(id) DO ${immutable ? 'NOTHING' : `UPDATE SET ${assignments} WHERE ${table}.tenant_id=EXCLUDED.tenant_id`} RETURNING id`;
            const result = await client.query(q, Object.values(values));
            if (!result.rowCount && !immutable)
                throw new Error(`Fixture ID collision in ${table}`);
            if (!tables.has(table))
                tables.set(table, new Set());
            tables.get(table)!.add(id);
            return id;
        } };
    return ctx;
}
export const employeeFixtures = [
    ['admin', 'Nadia Farouk', 'Human Resources', 'People Director', 'hr_admin', null, 42000],
    ['manager', 'Omar Mansour', 'Engineering', 'Engineering Manager', 'manager', 'admin', 48000],
    ['employee', 'Sarah Hassan', 'Engineering', 'Software Engineer', 'employee', 'manager', 28000],
    ['ceo', 'Rami Selim', 'Executive', 'Managing Director', 'manager', null, 72000],
    ['hr', 'Mariam Nabil', 'Human Resources', 'People Partner', 'employee', 'admin', 27000],
    ['recruiter', 'Lina Adel', 'Human Resources', 'Recruitment Coordinator', 'employee', 'admin', 23000],
    ['finance-head', 'Hassan Karim', 'Finance', 'Finance Manager', 'manager', 'ceo', 40000],
    ['payroll', 'Dina Mostafa', 'Finance', 'Payroll Specialist', 'employee', 'finance-head', 26000],
    ['finance', 'Tamer Sami', 'Finance', 'Finance Analyst', 'employee', 'finance-head', 22000],
    ['ops-head', 'Heba Amin', 'Operations', 'Operations Manager', 'manager', 'ceo', 36000],
    ['ops', 'Youssef Nader', 'Operations', 'Operations Supervisor', 'employee', 'ops-head', 24000],
    ['facilities', 'Salma Maher', 'Operations', 'Facilities Coordinator', 'employee', 'ops-head', 18000],
    ['product-head', 'Kareem Fathy', 'Product', 'Product Manager', 'manager', 'ceo', 39000],
    ['designer', 'Nour Sherif', 'Product', 'Product Designer', 'employee', 'product-head', 29000],
    ['researcher', 'Amira Sobhy', 'Product', 'Product Researcher', 'employee', 'product-head', 26000],
    ['sales-head', 'Ali Gamal', 'Sales & Success', 'Sales Manager', 'manager', 'ceo', 35000],
    ['sales', 'Farida Ashraf', 'Sales & Success', 'Account Executive', 'employee', 'sales-head', 24000],
    ['success', 'Ziad Fawzi', 'Sales & Success', 'Customer Success Specialist', 'employee', 'sales-head', 22000],
    ['it-head', 'Mona Khaled', 'IT', 'IT Manager', 'manager', 'ceo', 34000],
    ['it', 'Ahmed Tarek', 'IT', 'IT Support Specialist', 'employee', 'it-head', 21000],
    ['backend', 'Aya Hamed', 'Engineering', 'Backend Engineer', 'employee', 'manager', 30000],
    ['qa', 'Mostafa Emad', 'Engineering', 'Quality Engineer', 'employee', 'manager', 25000],
    ['new', 'Jana Walid', 'Engineering', 'Junior Engineer', 'employee', 'manager', 19000],
    ['former', 'Fady Essam', 'Sales & Success', 'Account Executive', 'employee', 'sales-head', 22000],
] as const;
export const emailFor = (key: string) => ['admin', 'manager', 'employee'].includes(key) ? `${key}@stanza-demo.com` : `${key}@northstar.example.invalid`;
/** Explicit fixture price cohort, not an exchange-rate or accounting calculation. */
export const demoAmount = (ctx: DemoContext, value: number) => ctx.currency === 'USD' ? Math.round(value * 5) / 100 : value;
