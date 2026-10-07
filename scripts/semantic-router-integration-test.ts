import {closeHrResources} from '../src/lib/hr-background';
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { once } from 'node:events';
import {withTenant} from '../src/lib/hr-background';
import {getMigrationPool as getDbPool} from './migration-pool';
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
  const tables=['router_semantic_examples','router_candidates','router_daily_metrics','router_vector_metrics','router_embedding_metrics'];
  const flags=(await pool.query('SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1::text[])',[tables])).rows;
  assert.equal(flags.length,5);assert(flags.every(r=>r.relrowsecurity&&r.relforcerowsecurity),'every router table forces RLS');
  for(const name of ['a','b'])tenants.push((await pool.query('INSERT INTO tenants(slug,company_name) VALUES($1,$2) RETURNING id',[`router-${name}-${tag}`,name])).rows[0].id);
  const [tenant,other]=tenants;
  await employee(tenant,'user',['leave.request.self']);await employee(tenant,'admin',['roles.manage','semantic.review_candidates','leave.request.self']);await employee(other,'other',['roles.manage','semantic.review_candidates','leave.request.self']);await employee(tenant,'denied',[]);
  await employee(tenant,'presence-only',['attendance.view_live']);
  const presenceDenied=await api('presence-only','/resolve',{query:'live employees',allowReasoning:false});assert.equal(presenceDenied.result.outcome,'unauthorized');assert.equal(presenceDenied.result.answer,undefined,'presence permission alone never bypasses existing HR-admin boundary');
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
  for(const space of [{...embedding,model:'different-model'},{...embedding,version:'different-version'},{...embedding,dimensions:2}]) {
    assert.equal((await new PgSemanticSearch(tenant,32).search(space.dimensions===2?[1,0]:[1,0,0],space,['request_leave'])).length,0,'incompatible embedding spaces never reach cosine operator');
  }
  const vectorMetrics=(await pool.query('SELECT queries,semantic_row_count,latency_samples FROM router_vector_metrics WHERE tenant_id=$1 AND embedding_model=$2',[tenant,embedding.model])).rows[0];
  assert(Number(vectorMetrics.queries)>0);assert(vectorMetrics.latency_samples.length>0&&vectorMetrics.latency_samples.length<=256);
  assert(vectorMetrics.latency_samples.every((n:number)=>Number.isFinite(n)&&n>=0),'real database vector timing is persisted');
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
    await roleClient.query(`GRANT SELECT ON router_privacy_settings,router_platform_authorities,employees TO ${role}`);
    await roleClient.query(`GRANT SELECT,INSERT,UPDATE ON router_candidates,router_semantic_examples,router_daily_metrics,router_vector_metrics,router_embedding_metrics TO ${role}`);
    await roleClient.query("INSERT INTO router_semantic_examples(intent_key,example_text,normalized_text,embedding,embedding_model,embedding_dimensions,embedding_version,source,approval_state) VALUES('request_leave','rls shared fixture','rls shared fixture','[1,0,0]',$1,3,'1','system','approved')",['rls-'+tag]);
    await roleClient.query(`SET LOCAL ROLE ${role}`);await roleClient.query("SELECT set_config('app.current_tenant',$1,true)",[other]);
    assert.equal((await roleClient.query('SELECT * FROM router_candidates WHERE tenant_id=$1',[tenant])).rowCount,0);
    assert.equal((await roleClient.query('SELECT * FROM router_semantic_examples WHERE tenant_id=$1',[tenant])).rowCount,0);
    for(const table of ['router_daily_metrics','router_vector_metrics','router_embedding_metrics']) {
      assert.equal((await roleClient.query('SELECT * FROM '+table+' WHERE tenant_id=$1',[tenant])).rowCount,0,'cross-tenant metrics are invisible');
      assert.equal((await roleClient.query('UPDATE '+table+' SET tenant_id=$2 WHERE tenant_id=$1',[tenant,other])).rowCount,0,'cross-tenant updates affect no rows');
    }
    await roleClient.query('SAVEPOINT metric_write');
    await assert.rejects(roleClient.query("INSERT INTO router_daily_metrics(tenant_id,method,outcome) VALUES($1,'semantic','rls_fixture')",[tenant]),/row-level security/);
    await roleClient.query('ROLLBACK TO SAVEPOINT metric_write');
    await roleClient.query('SAVEPOINT vector_metric_write');
    await assert.rejects(roleClient.query("INSERT INTO router_vector_metrics(tenant_id,embedding_model,embedding_dimensions,embedding_version) VALUES($1,'rls-fixture',3,'1')",[tenant]),/row-level security/);
    await roleClient.query('ROLLBACK TO SAVEPOINT vector_metric_write');
    assert.equal((await roleClient.query('SELECT * FROM router_semantic_examples WHERE tenant_id IS NULL AND embedding_model=$1',['rls-'+tag])).rowCount,1,'shared system examples are readable by tenants');
    await roleClient.query("SELECT set_config('app.current_tenant','',true)");
    assert.equal((await roleClient.query('SELECT * FROM router_candidates')).rowCount,0,'missing tenant context fails closed');
    assert.equal((await roleClient.query('SELECT * FROM router_semantic_examples WHERE embedding_model=$1',['rls-'+tag])).rowCount,1,'system examples remain readable without tenant context');
    await roleClient.query("SELECT set_config('app.current_tenant',$1,true)",[other]);
    await roleClient.query('SAVEPOINT dimensions');
    await assert.rejects(roleClient.query("INSERT INTO router_semantic_examples(tenant_id,intent_key,example_text,normalized_text,embedding,embedding_model,embedding_dimensions,embedding_version,source,approval_state) VALUES($1,'request_leave','bad dimensions','bad dimensions','[1,0,0]','test',2,'1','tenant','approved')",[other]),(e:unknown)=>(e as {code?:string}).code==='23514','stored vector dimensions must match declared space');
    await roleClient.query('ROLLBACK TO SAVEPOINT dimensions');
    await roleClient.query('SAVEPOINT cross_tenant');
    await assert.rejects(roleClient.query("INSERT INTO router_candidates(tenant_id,employee_id,normalized_query,proposed_intent) VALUES($1,$2,'forged','request_leave')",[tenant,actors.get('user')!.employeeId]),/row-level security/);await roleClient.query('ROLLBACK TO SAVEPOINT cross_tenant');
    await roleClient.query('SAVEPOINT system_write');
    await assert.rejects(roleClient.query("INSERT INTO router_semantic_examples(intent_key,example_text,normalized_text,embedding,embedding_model,embedding_dimensions,embedding_version,source,approval_state) VALUES('request_leave','forged','forged','[1,0,0]','test',3,'v1','system','approved')"),/row-level security/);await roleClient.query('ROLLBACK TO SAVEPOINT system_write');
    await roleClient.query('ROLLBACK');
  }finally{await roleClient.query('ROLLBACK');roleClient.release();}
  const metrics=await api('admin','/metrics');assert.equal(metrics.status,200);assert(metrics.metrics.some((m:{promotions:string})=>Number(m.promotions)===1));
  console.log('PASS router API authorization, candidate lifecycle, duplicate handling, promotion avoids LLM, cross-tenant filtering and non-bypass RLS');
}finally{server.close();for(const t of tenants)await pool.query('DELETE FROM tenants WHERE id=$1',[t]);await pool.end();await closeHrResources();}
