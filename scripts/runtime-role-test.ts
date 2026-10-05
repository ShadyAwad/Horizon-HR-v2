import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { getMigrationPool, migrationUrl } from './migration-pool';
import { getDbPool, withTenant } from '../src/lib/hr-background';
import { assertDatabaseMutationSafety } from './mutation-safety';
import { assertRuntimeRole } from '../src/lib/database-security';
assertDatabaseMutationSafety(process.env.DATABASE_URL, 'Runtime RLS verification');
const savedMigrationUrl=process.env.DATABASE_MIGRATION_URL;
try {
  delete process.env.DATABASE_MIGRATION_URL;
  assert.throws(()=>migrationUrl(),/required.*never used as a fallback/);
  process.env.DATABASE_MIGRATION_URL='invalid URL';
  assert.throws(()=>migrationUrl(),error=>error instanceof Error&&!error.message.includes('invalid URL'));
} finally {
  if(savedMigrationUrl===undefined)delete process.env.DATABASE_MIGRATION_URL;
  else process.env.DATABASE_MIGRATION_URL=savedMigrationUrl;
}
const admin=getMigrationPool(), runtime=getDbPool();
const identifier=(value:string)=>'"'+value.replaceAll('"','""')+'"';
try {
  const client=await runtime.connect();
  try { await assertRuntimeRole(client); } finally { client.release(); }
  const identities=(await admin.query('SELECT id FROM tenants ORDER BY id LIMIT 2')).rows;
  assert.equal(identities.length,2,'Two tenants required for non-vacuous isolation');
  const [own,other]=identities.map(row=>row.id);
  const tables=(await admin.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relrowsecurity AND
    EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND NOT a.attisdropped)`)).rows;
  for (const {relname} of tables) {
    const table=identifier(relname), global=relname==='router_semantic_examples';
    const empty=await runtime.query(`SELECT count(*)::int AS n FROM public.${table}${global?' WHERE tenant_id IS NOT NULL':''}`);
    assert.equal(empty.rows[0].n,0,relname+' must deny missing context');
    const expected=(await admin.query(`SELECT count(*)::int AS n FROM public.${table} WHERE tenant_id=$1`,[own])).rows[0].n;
    await withTenant(own,async c=>{
      assert.equal((await c.query(`SELECT count(*)::int AS n FROM public.${table} WHERE tenant_id=$1`,[own])).rows[0].n,expected,relname+' own rows');
      assert.equal((await c.query(`SELECT * FROM public.${table} WHERE tenant_id=$1`,[other])).rowCount,0,relname+' cross tenant');
      const update=(await c.query("SELECT has_table_privilege(current_user,$1,'UPDATE') AS allowed",['public.'+relname])).rows[0].allowed;
      if(update)assert.equal((await c.query(`UPDATE public.${table} SET tenant_id=tenant_id WHERE tenant_id=$1`,[other])).rowCount,0,relname+' cross-tenant update');
    });
  }
  assert.equal((await runtime.query('SELECT * FROM tenants')).rowCount,0);
  assert.equal((await runtime.query('SELECT * FROM vw_employee_hierarchy')).rowCount,0,'security invoker hierarchy');
  await withTenant(own,async c=>{
    assert.equal((await c.query('SELECT id FROM tenants WHERE id=$1',[own])).rowCount,1);
    assert.equal((await c.query('SELECT id FROM tenants WHERE id=$1',[other])).rowCount,0);
    await c.query('SAVEPOINT rejected_write');
    await assert.rejects(c.query("INSERT INTO router_daily_metrics(tenant_id,method,outcome) VALUES($1,'semantic','runtime_rls_probe')",[other]),(e:unknown)=>(e as {code?:string}).code==='42501');
    await c.query('ROLLBACK TO SAVEPOINT rejected_write');
    await c.query('SAVEPOINT own_write');
    await c.query("INSERT INTO router_daily_metrics(tenant_id,method,outcome) VALUES($1,'semantic','runtime_rls_probe') ON CONFLICT DO NOTHING",[own]);
    await c.query('ROLLBACK TO SAVEPOINT own_write');
  });
  const resetActor=(await admin.query('SELECT id,email,tenant_id FROM employees WHERE tenant_id=$1 LIMIT 1',[own])).rows[0];
  assert(resetActor,'Populated tenant required for authentication write probes');
  await withTenant(own,async c=>{
    await c.query('SAVEPOINT reset_probe');
    const token='runtime-rls-'+crypto.randomUUID();
    await c.query(`INSERT INTO password_reset_tokens(tenant_id,employee_id,email,recovery_method,token_hash,expires_at)
      VALUES($1,$2,$3,'email',$4,now()+interval '5 minutes')`,[own,resetActor.id,resetActor.email,token]);
    assert.equal((await c.query('SELECT tenant_id FROM stanza_reset_tenant($1)',[token])).rows[0]?.tenant_id,own);
    await c.query('UPDATE password_reset_tokens SET used_at=now() WHERE token_hash=$1',[token]);
    assert.equal((await c.query('SELECT tenant_id FROM stanza_reset_tenant($1)',[token])).rowCount,0,'used reset tokens cannot bootstrap context');
    await c.query('ROLLBACK TO SAVEPOINT reset_probe');
  });
  const global=(await admin.query('SELECT count(*)::int AS n FROM router_semantic_examples WHERE tenant_id IS NULL')).rows[0].n;
  assert.equal((await runtime.query('SELECT count(*)::int AS n FROM router_semantic_examples WHERE tenant_id IS NULL')).rows[0].n,global);
  await assert.rejects(runtime.query("CREATE TABLE public.runtime_must_not_create(id int)"),(e:unknown)=>(e as {code?:string}).code==='42501');
  await assert.rejects(runtime.query('TRUNCATE employees'),(e:unknown)=>(e as {code?:string}).code==='42501');
  assert.equal((await runtime.query("SELECT has_table_privilege(current_user,'tenant_permissions','INSERT') AS allowed")).rows[0].allowed,false);
  assert.equal((await runtime.query("SELECT has_sequence_privilege(current_user,'communication_message_events_id_seq','USAGE') AS allowed")).rows[0].allowed,true);
  assert.equal((await runtime.query("SELECT has_sequence_privilege(current_user,'communication_message_events_id_seq','UPDATE') AS allowed")).rows[0].allowed,false);
  const elevated=await admin.connect();try{await assert.rejects(assertRuntimeRole(elevated),/dedicated non-owner/);}finally{elevated.release();}
  assert.equal((await runtime.query("SELECT * FROM stanza_session_identity('invalid')")).rowCount,0);
  const functions=(await admin.query("SELECT proname,prosecdef,proconfig,proacl::text[] AS proacl FROM pg_proc WHERE proname LIKE 'stanza_%' AND prosecdef")).rows;
  const normalizer=(await admin.query("SELECT prosecdef,provolatile,proparallel FROM pg_proc WHERE oid='stanza_entity_normalize(text)'::regprocedure")).rows[0];assert.equal(normalizer.prosecdef,false);assert.equal(normalizer.provolatile,'i');assert.equal(normalizer.proparallel,'s');
  assert.equal(functions.length,5);assert(functions.every(f=>f.prosecdef&&f.proconfig.includes('search_path=pg_catalog')&&!f.proacl.some((a:string)=>a.startsWith('='))));
  console.log(`PASS real restricted login: ${tables.length} tenant tables; own/missing/cross-tenant reads, cross-tenant updates/writes, tenant directory, invoker view, global corpus, sequence/function ACLs and rejected DDL/admin connection.`);
} finally { await runtime.end(); await admin.end(); }
