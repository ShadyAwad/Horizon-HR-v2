import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { once } from 'node:events';
import { getDbPool,withTenant } from '../src/lib/hr-background';
import { routerConfig } from '../src/server/intelligent-router/config';
import { registerIntelligentRouterRoutes } from '../src/server/intelligent-router/routes';
import { PgSemanticSearch } from '../src/server/intelligent-router/store';
import { assertDatabaseMutationSafety } from './mutation-safety';
assertDatabaseMutationSafety(process.env.DATABASE_URL,'Router integration');
const pool=getDbPool(),tag=randomUUID(),tenants:string[]=[],actors=new Map<string,NonNullable<Express.Request['authUser']>>();
let reasoningCalls=0;
const embedding={model:'router-test-only',dimensions:3,version:'1',embed:async()=>[1,0,0]};
const app=express();app.use(express.json());
registerIntelligentRouterRoutes(app,{standardAuth:(req,res,next)=>{const u=actors.get(String(req.headers['x-test-actor']));if(!u){res.status(401).json({});return;}req.authUser=u;next();},mutationGuard:(req,res,next)=>{if(req.headers.origin!=='http://localhost'){res.status(403).json({});return;}next();},rateLimiter:(_req,_res,next)=>next()},
  {config:{...routerConfig({}),learning:true},embedding,authorization:{resolve:async()=>({state:'ready',provider:{interpret:async()=>{reasoningCalls++;return {status:'resolved',proposedIntentKey:'request_leave',confidence:'high'};}}})}});
const server=app.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
async function api(who:string,path:string,body?:object){const res=await fetch(base+'/api/command-router'+path,{method:body?'POST':'GET',headers:{'x-test-actor':who,Origin:'http://localhost','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:res.status,...await res.json()};}
async function employee(tenant:string,name:string,permissions:string[]){
  const id=(await pool.query("INSERT INTO employees(tenant_id,email,full_name,password_hash) VALUES($1,$2,$3,'fixture-no-login') RETURNING id",[tenant,`${name}-${tag}@example.invalid`,name])).rows[0].id;
  const role=(await pool.query('INSERT INTO tenant_roles(tenant_id,name) VALUES($1,$2) RETURNING id',[tenant,name])).rows[0].id;
  for(const key of permissions)await pool.query('INSERT INTO tenant_role_permissions(tenant_id,role_id,permission_key) VALUES($1,$2,$3)',[tenant,role,key]);
  await pool.query("INSERT INTO employee_role_assignments(tenant_id,employee_id,role_id,scope_type) VALUES($1,$2,$3,'company')",[tenant,id,role]);
  actors.set(name,{tenantId:tenant,employeeId:id,role:'employee',email:`${name}-${tag}@example.invalid`});return id;
}
try{
  assert((await pool.query("SELECT 1 FROM pg_extension WHERE extname='vector'")).rowCount,'pgvector migration must be applied');
  for(const name of ['a','b'])tenants.push((await pool.query('INSERT INTO tenants(slug,company_name) VALUES($1,$2) RETURNING id',[`router-${name}-${tag}`,name])).rows[0].id);
  const [tenant,other]=tenants;
  await employee(tenant,'user',['leave.request.self']);await employee(tenant,'admin',['roles.manage','leave.request.self']);await employee(other,'other',['roles.manage','leave.request.self']);await employee(tenant,'denied',[]);
  assert.equal((await api('','/resolve',{query:'request leave'})).status,401);
  assert.equal((await api('user','/resolve',{query:'request leave',actionKey:'FORGED'})).status,400);
  assert.equal((await api('denied','/resolve',{query:'request leave'})).result.outcome,'unauthorized');
  const r=await api('user','/resolve',{query:'a quiet day away please',allowReasoning:true,learn:true});assert.equal(r.result.method,'llm');assert(r.result.candidateId);const id=r.result.candidateId;
  assert.equal((await api('other',`/candidates/${id}/confirm`,{})).status,404);
  assert.equal((await api('admin',`/candidates/${id}/review`,{decision:'approve'})).status,404,'unconfirmed candidates cannot promote');
  assert.equal((await api('user',`/candidates/${id}/confirm`,{})).status,200);
  assert.equal((await api('user',`/candidates/${id}/review`,{decision:'approve'})).status,403);
  assert.equal((await api('other',`/candidates/${id}/review`,{decision:'approve'})).status,404);
  assert.equal((await api('admin',`/candidates/${id}/review`,{decision:'approve'})).promoted,true);
  reasoningCalls=0;assert.equal((await api('user','/resolve',{query:'a quiet day away please',allowReasoning:true})).result.method,'semantic');assert.equal(reasoningCalls,0,'promoted query resolves without LLM');
  assert.equal((await api('user','/resolve',{query:'a quiet break tomorrow',allowReasoning:true})).result.method,'semantic');assert.equal(reasoningCalls,0,'similar mock embedding also avoids LLM');
  assert.equal((await new PgSemanticSearch(other,32).search([1,0,0],embedding,['request_leave'])).length,0);
  assert.equal((await api('admin',`/candidates/${id}/review`,{decision:'approve'})).status,404,'repeat review is unavailable');
  // Duplicate phrase approved by a second employee remains one active vector.
  const second=await withTenant(tenant,async c=>(await c.query("INSERT INTO router_candidates(tenant_id,employee_id,normalized_query,proposed_intent,confirmation_state) VALUES($1,$2,'a quiet day away please','request_leave','confirmed') RETURNING id",[tenant,actors.get('admin')!.employeeId])).rows[0].id);
  assert.equal((await api('admin',`/candidates/${second}/review`,{decision:'approve'})).duplicate,true);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM router_semantic_examples WHERE tenant_id=$1',[tenant])).rows[0].n,1);
  const roleClient=await pool.connect();
  try{
    await roleClient.query('BEGIN');const role='router_rls_'+tag.replaceAll('-','');assert.match(role,/^router_rls_[a-f0-9]+$/);
    await roleClient.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
    await roleClient.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await roleClient.query(`GRANT SELECT,INSERT,UPDATE ON router_candidates,router_semantic_examples,router_daily_metrics TO ${role}`);
    await roleClient.query(`SET LOCAL ROLE ${role}`);await roleClient.query("SELECT set_config('app.current_tenant',$1,true)",[other]);
    assert.equal((await roleClient.query('SELECT * FROM router_candidates WHERE tenant_id=$1',[tenant])).rowCount,0);
    assert.equal((await roleClient.query('SELECT * FROM router_semantic_examples WHERE tenant_id=$1',[tenant])).rowCount,0);
    await roleClient.query('SAVEPOINT cross_tenant');
    await assert.rejects(roleClient.query("INSERT INTO router_candidates(tenant_id,employee_id,normalized_query,proposed_intent) VALUES($1,$2,'forged','request_leave')",[tenant,actors.get('user')!.employeeId]),/row-level security/);await roleClient.query('ROLLBACK TO SAVEPOINT cross_tenant');
    await roleClient.query('SAVEPOINT system_write');
    await assert.rejects(roleClient.query("INSERT INTO router_semantic_examples(intent_key,example_text,normalized_text,embedding,embedding_model,embedding_dimensions,embedding_version,source,approval_state) VALUES('request_leave','forged','forged','[1,0,0]','test',3,'v1','system','approved')"),/row-level security/);await roleClient.query('ROLLBACK TO SAVEPOINT system_write');
    await roleClient.query('ROLLBACK');
  }finally{await roleClient.query('ROLLBACK');roleClient.release();}
  const metrics=await api('admin','/metrics');assert.equal(metrics.status,200);assert(metrics.metrics.some((m:{promotions:string})=>Number(m.promotions)===1));
  console.log('PASS router API authorization, candidate lifecycle, duplicate handling, promotion avoids LLM, cross-tenant filtering and non-bypass RLS');
}finally{server.close();for(const t of tenants)await pool.query('DELETE FROM tenants WHERE id=$1',[t]);await pool.end();}
