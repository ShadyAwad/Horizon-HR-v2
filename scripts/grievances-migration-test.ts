import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { Pool } from 'pg';
import { assertDatabaseMutationSafety } from './mutation-safety';
assertDatabaseMutationSafety(process.env.DATABASE_URL, 'Grievance legacy migration test');
const pool = new Pool({ connectionString: process.env.DATABASE_URL }), schema = 'grv_migration_' + crypto.randomUUID().replaceAll('-', ''), c = await pool.connect();
try {
    await c.query(`CREATE SCHEMA ${schema}`);
    await c.query(`SET search_path TO ${schema},public`);
    await c.query(`CREATE TABLE tenants(id uuid PRIMARY KEY);CREATE TABLE employees(id uuid PRIMARY KEY,tenant_id uuid,UNIQUE(id,tenant_id));CREATE TABLE organisation_departments(id uuid PRIMARY KEY,tenant_id uuid,UNIQUE(id,tenant_id));CREATE TABLE tenant_permissions(permission_key varchar(120) PRIMARY KEY,label text,description text);CREATE TABLE tenant_roles(id uuid PRIMARY KEY,tenant_id uuid,system_key text);CREATE TABLE tenant_role_permissions(tenant_id uuid,role_id uuid,permission_key text,UNIQUE(tenant_id,role_id,permission_key));CREATE TABLE communication_messages(id uuid PRIMARY KEY,tenant_id uuid);CREATE TABLE grievances(id uuid PRIMARY KEY,tenant_id uuid,employee_id uuid,assigned_to uuid,title text,description text,category text,priority text,status varchar(30) DEFAULT 'open',created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),resolved_at timestamptz,CONSTRAINT grievances_status_chk CHECK(status IN ('open','under_review','resolved','rejected','closed')));`);
    const tenant = crypto.randomUUID(), employee = crypto.randomUUID();
    await c.query('INSERT INTO tenants VALUES($1)', [tenant]);
    await c.query('INSERT INTO employees VALUES($1,$2)', [employee, tenant]);
    const originals = [];
    for (const status of ['open', 'under_review', 'resolved', 'rejected', 'closed']) {
        const id = crypto.randomUUID();
        originals.push({ id, status });
        await c.query("INSERT INTO grievances(id,tenant_id,employee_id,title,description,category,priority,status) VALUES($1,$2,$3,'Legacy subject','Original legacy description','other','normal',$4)", [id, tenant, employee, status]);
    }
    const sql = fs.readFileSync('src/db/migrations/20260930_grievance_cases.sql', 'utf8');
    await c.query(sql);
    const rows = (await c.query('SELECT * FROM grievances')).rows;
    assert.equal(rows.length, 5);
    assert.equal(new Set(rows.map(r => r.case_number)).size, 5);
    for (const original of originals) {
        const row = rows.find(r => r.id === original.id);
        assert.equal(row.description, 'Original legacy description');
        assert.equal(row.confidentiality, 'standard');
        assert.equal(row.version, 1);
        assert.equal(row.status, { open: 'submitted', under_review: 'triaged', rejected: 'closed' }[original.status] || original.status);
        assert.equal(row.destination_department_id, null);
    }
    assert.equal((await c.query('SELECT count(*)::int n FROM grievance_case_events')).rows[0].n, 5);
    await c.query(sql);
    assert.equal((await c.query('SELECT count(*)::int n FROM grievance_case_events')).rows[0].n, 5);
    assert.deepEqual((await c.query('SELECT id,case_number FROM grievances ORDER BY id')).rows, rows.map(r => ({ id: r.id, case_number: r.case_number })).sort((a, b) => a.id.localeCompare(b.id)));
    console.log('PASS Grievance migration: original UUID/content, legacy statuses, safe defaults, unique case numbers, history backfill, rerun idempotence.');
}
finally {
    await c.query('ROLLBACK');
    await c.query('SET search_path TO public');
    await c.query(`DROP SCHEMA ${schema} CASCADE`);
    c.release();
    await pool.end();
}
