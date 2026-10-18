import {demoAdminPermissions} from './demo/admin-persona';
import './router-env';
import assert from 'node:assert/strict';
import {getMigrationPool} from './migration-pool';
import {DEMO_SLUG} from './demo/core';
import {readManifest} from './demo/reset';
import {readCaseHistory,verifyDemoBackups,listDemoFiles,assertDemoFileOwnership} from './demo/files';
const pool=getMigrationPool();
try{
 const t=(await pool.query("SELECT id,company_name,is_demo_tenant FROM tenants WHERE slug=$1",[DEMO_SLUG])).rows[0];
 assert(t?.is_demo_tenant&&t.id===process.env.DEMO_TENANT_ID,'Set the exact DEMO_TENANT_ID for the marked demo tenant.');
 const accounts=(await pool.query("SELECT id,email,is_active FROM employees WHERE tenant_id=$1 AND email=ANY($2::text[])",[t.id,['admin@stanza-demo.com','manager@stanza-demo.com','employee@stanza-demo.com','tenant-admin@stanza-demo.com']])).rows;
 assert.equal(accounts.length,4);assert(accounts.every(r=>r.is_active===true));
 const forbidden=(await pool.query("SELECT p.permission_key FROM employee_role_assignments a JOIN tenant_role_permissions p ON p.tenant_id=a.tenant_id AND p.role_id=a.role_id WHERE a.tenant_id=$1 AND a.employee_id=ANY($2::uuid[]) AND a.revoked_at IS NULL AND (a.expires_at IS NULL OR a.expires_at>now()) AND p.permission_key=ANY($3::text[])",[t.id,accounts.filter(r=>r.email!=='tenant-admin@stanza-demo.com').map(r=>r.id),['roles.manage','roles.assign_privileged','organisation.manage','sessions.manage','communications.send']])).rows;
 assert.equal(forbidden.length,0,'Scoped personas must retain their existing permission boundaries');
 const broad=accounts.find(r=>r.email==='tenant-admin@stanza-demo.com')!;const actual=(await pool.query('SELECT DISTINCT p.permission_key FROM employee_role_assignments a JOIN tenant_role_permissions p ON p.tenant_id=a.tenant_id AND p.role_id=a.role_id WHERE a.tenant_id=$1 AND a.employee_id=$2 AND a.revoked_at IS NULL',[t.id,broad.id])).rows.map(r=>r.permission_key).sort();assert.deepEqual(actual,[...demoAdminPermissions].sort());
 assert.equal((await pool.query('SELECT 1 FROM router_platform_authorities WHERE employee_id=ANY($1::uuid[])',[accounts.map(r=>r.id)])).rowCount,0);
 const counts:Record<string,number>={};for(const table of ['employees','assets','time_logs','leave_requests','support_tickets','hiring_jobs','hiring_interviews','hiring_offers','company_feed_posts'])counts[table]=Number((await pool.query(`SELECT count(*) FROM ${table} WHERE tenant_id=$1`,[t.id])).rows[0].count);
 assert(counts.support_tickets>=3&&counts.hiring_jobs>=2&&counts.hiring_interviews>=1&&counts.hiring_offers>=1,'Curated story incomplete');
 const client=await pool.connect();try{const files=await listDemoFiles(client,t.id);await assertDemoFileOwnership(client,files,t.id);const manifest=await readManifest(client,t.id);for(const [table,ids]of Object.entries(manifest)){const count=Number((await client.query(`SELECT count(*) FROM ${table} WHERE tenant_id=$1 AND id=ANY($2::uuid[])`,[t.id,ids])).rows[0].count);assert.equal(count,ids.length,'Missing seeded records in '+table);}const checkpoint=(await client.query("SELECT metadata FROM audit_logs WHERE tenant_id=$1 AND action='demo.recovery_checkpoint'",[t.id])).rows;assert.equal(checkpoint.length,1);await verifyDemoBackups(checkpoint[0].metadata.files,t.id);await readCaseHistory(t.id,checkpoint[0].metadata.caseHistoryChecksum);console.log('Demo verified:',{company:t.company_name,personas:accounts.length,counts,privateFiles:files.length});}finally{client.release();}
 console.log('Recovery checkpoints:',(await pool.query("SELECT count(*)::int n FROM audit_logs WHERE tenant_id=$1 AND action='demo.recovery_checkpoint'",[t.id])).rows[0].n);
 console.log('Use existing /api/system/live and /api/system/ready for runtime health. Recovery requires explicit target, mutation flags, confirmation and maintenance.');
}finally{await pool.end();}

