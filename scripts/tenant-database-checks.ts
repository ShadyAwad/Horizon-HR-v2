import assert from 'node:assert/strict';
import type {BusinessFixtures} from './business-scenario-fixtures';
import {getDbPool,withTenant} from '../src/lib/hr-background';

// Catalog identifiers are discovered locally and strictly bounded; object IDs remain parameters.
const identifier=(name:string)=>{assert.match(name,/^[a-z][a-z0-9_]*$/);return '"'+name+'"';};
export async function verifyTenantDatabase(f:BusinessFixtures) {
 const runtime=getDbPool();
 const role=(await runtime.query('SELECT current_user name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
 assert.equal(role.name,process.env.DATABASE_RUNTIME_ROLE||'stanza_runtime');assert.equal(role.rolsuper,false);assert.equal(role.rolbypassrls,false);
 const tables=(await f.db.query(`SELECT c.oid,c.relname,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) owner,
   (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid=c.oid) policies
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')
   AND EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND NOT a.attisdropped)
   AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e') ORDER BY c.relname`)).rows;
 assert(tables.length>0);
 const applicationTables=(await f.db.query(`SELECT c.relname,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')`)).rows;for(const t of applicationTables)if(t.relname!=='tenant_permissions')assert(t.relrowsecurity,t.relname+' application RLS');
 assert.equal((await runtime.query("SELECT has_table_privilege(current_user,'tenant_permissions','INSERT') allowed")).rows[0].allowed,false);
 await assert.rejects(runtime.query("INSERT INTO router_daily_metrics(tenant_id,method,outcome) VALUES($1,'semantic','tenant_audit_missing')",[f.primary]),(e:any)=>e.code==='42501');
 for(const t of tables){
  assert.equal(t.relrowsecurity,true,t.relname+' RLS enabled');assert(t.policies>0,t.relname+' policies');assert.notEqual(t.owner,role.name,t.relname+' runtime cannot own');
  const table='public.'+identifier(t.relname), nonGlobal=t.relname==='router_semantic_examples'?' WHERE tenant_id IS NOT NULL':'';
  assert.equal((await runtime.query(`SELECT count(*)::int n FROM ${table}${nonGlobal}`)).rows[0].n,0,t.relname+' missing context');
  for(const [own,other] of [[f.primary,f.foreignTenant],[f.foreignTenant,f.primary]]){
   const expected=(await f.db.query(`SELECT count(*)::int n FROM ${table} WHERE tenant_id=$1${t.relname==='tenant_role_permissions'?" AND permission_key NOT LIKE 'platform.%'":''}`,[own])).rows[0].n;
   await withTenant(own,async c=>{
    assert.equal((await c.query(`SELECT count(*)::int n FROM ${table} WHERE tenant_id=$1`,[own])).rows[0].n,expected,t.relname+' own visible');
    assert.equal((await c.query(`SELECT * FROM ${table} WHERE tenant_id=$1`,[other])).rowCount,0,t.relname+' foreign hidden');
    if((await c.query("SELECT has_table_privilege(current_user,$1,'UPDATE') allowed",[table])).rows[0].allowed)assert.equal((await c.query(`UPDATE ${table} SET tenant_id=tenant_id WHERE tenant_id=$1`,[other])).rowCount,0,t.relname+' foreign update');
    if((await c.query("SELECT has_table_privilege(current_user,$1,'DELETE') allowed",[table])).rows[0].allowed)assert.equal((await c.query(`DELETE FROM ${table} WHERE tenant_id=$1`,[other])).rowCount,0,t.relname+' foreign delete');
   });
  }
 }
 await withTenant(f.primary,async c=>{
  await c.query('SAVEPOINT foreign_insert');await assert.rejects(c.query("INSERT INTO router_daily_metrics(tenant_id,method,outcome) VALUES($1,'semantic','tenant_audit')",[f.foreignTenant]),(e:any)=>e.code==='42501');await c.query('ROLLBACK TO SAVEPOINT foreign_insert');
  await c.query('SAVEPOINT own_insert');await c.query("INSERT INTO router_daily_metrics(tenant_id,method,outcome) VALUES($1,'semantic','tenant_audit')",[f.primary]);await c.query('ROLLBACK TO SAVEPOINT own_insert');
  assert.equal((await c.query('SELECT id FROM tenants WHERE id=$1',[f.primary])).rowCount,1);assert.equal((await c.query('SELECT id FROM tenants WHERE id=$1',[f.foreignTenant])).rowCount,0);
 });
 let pid:number|undefined;
 for(const tenant of [f.primary,f.foreignTenant,f.primary,f.foreignTenant])await withTenant(tenant,async c=>{
  const row=(await c.query("SELECT pg_backend_pid() pid,current_setting('app.current_tenant',true) tenant")).rows[0];pid??=row.pid;assert.equal(row.pid,pid);assert.equal(row.tenant,tenant);
  await c.query("SELECT set_config('app.semantic_actor',$1,true)",[tenant===f.primary?f.admin.id:f.foreign.id]);
  const employees=(await c.query('SELECT tenant_id FROM employees')).rows;assert(employees.length>0);assert(employees.every(r=>r.tenant_id===tenant));
 });
 await assert.rejects(withTenant(f.primary,async c=>{await c.query("SELECT set_config('app.semantic_actor',$1,true)",[f.admin.id]);await c.query('SELECT 1/0');}),(e:any)=>e.code==='22012');
 const bare=await runtime.connect();try{
  const row=(await bare.query("SELECT pg_backend_pid() pid,NULLIF(current_setting('app.current_tenant',true),'') tenant,NULLIF(current_setting('app.semantic_actor',true),'') actor")).rows[0];assert.equal(row.pid,pid);assert.equal(row.tenant,null);assert.equal(row.actor,null);assert.equal((await bare.query('SELECT * FROM employees')).rowCount,0);
 }finally{bare.release();}
 await withTenant(f.foreignTenant,async c=>assert((await c.query('SELECT tenant_id FROM employees')).rows.every(r=>r.tenant_id===f.foreignTenant)));
 // Nested helper calls borrow separate connections; with a size-one pool they are unsupported, not savepoints.
 // Current callbacks are checked for context before their first tenant query; SQL BEGIN inside an existing transaction does not replace SET LOCAL.
 await withTenant(f.primary,async c=>{await c.query('BEGIN');assert.equal((await c.query("SELECT current_setting('app.current_tenant',true) tenant")).rows[0].tenant,f.primary);await c.query('SAVEPOINT nested_work');await c.query('ROLLBACK TO SAVEPOINT nested_work');});
 console.log(`PASS complete catalog discovery: ${tables.length} tenant tables; ${tables.filter(t=>t.relforcerowsecurity).length} FORCE RLS; all non-owner, enabled policies, A/B/missing reads, foreign UPDATE/DELETE and rejected INSERT`);
 console.log('PASS same physical restricted connection: A/B commit, SQL-error rollback, tenant/semantic actor reset, nested SQL context retained');
}
