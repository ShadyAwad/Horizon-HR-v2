import './router-env';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import {randomUUID} from 'node:crypto';
import {getMigrationPool} from './migration-pool';
import {assertDatabaseMutationSafety} from './mutation-safety';
import {getDbPool,withTenant,closeHrResources} from '../src/lib/background-connections';
assertDatabaseMutationSafety(process.env.DATABASE_URL,'Release pooled context');
process.env.DATABASE_POOL_MAX='1';
const db=getMigrationPool(),ids:string[]=[];
try{
 for(let i=0;i<2;i++){
  const id=(await db.query('INSERT INTO tenants(slug,company_name) VALUES($1,$2) RETURNING id',['release-pool-'+randomUUID(),'Disposable release pool'])).rows[0].id;ids.push(id);
  await db.query("INSERT INTO employees(tenant_id,email,full_name,role,password_hash) VALUES($1,$2,'Disposable pool employee','employee',$3)",[id,randomUUID()+'@example.invalid',await bcrypt.hash(randomUUID(),10)]);
 }
 let pid:number|undefined;
 for(const tenant of [...ids,...ids])await withTenant(tenant,async client=>{
  const r=(await client.query("SELECT pg_backend_pid() pid,current_user name,current_setting('app.current_tenant',true) tenant")).rows[0];
  pid??=r.pid;assert.equal(r.pid,pid);assert.equal(r.name,'stanza_runtime');assert.equal(r.tenant,tenant);
  const rows=(await client.query('SELECT tenant_id FROM employees')).rows;assert.equal(rows.length,1);assert.equal(rows[0].tenant_id,tenant);
 });
 await assert.rejects(()=>withTenant(ids[0],async client=>{await client.query('SELECT 1');throw Error('owned fixture rollback');}),/owned fixture rollback/);
 const bare=await getDbPool().connect();
 try{
  assert.equal((await bare.query('SELECT pg_backend_pid() pid')).rows[0].pid,pid);
  assert.equal((await bare.query('SELECT count(*)::int n FROM employees')).rows[0].n,0);
  assert.equal((await bare.query("SELECT NULLIF(current_setting('app.current_tenant',true),'') tenant")).rows[0].tenant,null);
 }finally{bare.release();}
 await withTenant(ids[1],async client=>assert.equal((await client.query('SELECT count(*)::int n FROM employees')).rows[0].n,1));
 console.log('PASS real restricted pooled connection reused for A/B, commit and rollback; missing context denies reads');
}finally{
 for(const id of ids)await db.query('DELETE FROM tenants WHERE id=$1',[id]);
 assert.equal((await db.query('SELECT count(*)::int n FROM tenants WHERE id=ANY($1::uuid[])',[ids])).rows[0].n,0);
 await db.end();await closeHrResources();console.log('PASS pooled fixtures cleaned: zero');
}
