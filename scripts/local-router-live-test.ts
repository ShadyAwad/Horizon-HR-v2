import './router-env';
import assert from 'node:assert/strict';
import {getDbPool,withTenant} from '../src/lib/hr-background';
import {dataAnswer} from '../src/server/intelligent-router/data-answers';
import {LOCAL_MODEL,LOCAL_VERSION,LOCAL_DIMENSIONS} from '../src/server/intelligent-router/local-embedding';
// Read-only proof against the running full preview, after the explicit browser learning loop.
// Login credentials are supplied through the environment, never persisted by this script.
const base=(process.env.ROUTER_TEST_BASE_URL||'http://localhost:3001').replace(/\/$/,'');
assert(['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname),'Local preview only');
assert(process.env.ROUTER_TEST_EMAIL&&process.env.ROUTER_TEST_PASSWORD,'Set ROUTER_TEST_EMAIL/PASSWORD');
const pool=getDbPool();
try{
 const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:process.env.ROUTER_TEST_EMAIL,password:process.env.ROUTER_TEST_PASSWORD})});
 assert(login.ok,'Standard login required');const cookie=login.headers.get('set-cookie')?.split(';',1)[0];assert(cookie);
 const employee=(await pool.query('SELECT id,tenant_id FROM employees WHERE email=$1 AND is_active',[process.env.ROUTER_TEST_EMAIL])).rows[0];assert(employee);
 const actor={tenantId:employee.tenant_id,employeeId:employee.id};
 const api=async(path:string,body?:object)=>{const response=await fetch(base+'/api/command-router/'+path,{method:body?'POST':'GET',headers:{Cookie:cookie,Origin:base,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});assert(response.ok,`HTTP ${response.status} for ${path}`);return response.json();};
 const before=(await api('metrics')).metrics.reduce((n:number,r:any)=>n+Number(r.fallbacks),0);
 const phrase='Can you find the list of company equipment in my custody';
 const promotion=await withTenant(actor.tenantId,async c=>(await c.query("SELECT example.intent_key,example.embedding_model,example.embedding_version,example.embedding_dimensions,example.source,candidate.confirmation_state,candidate.review_state FROM router_semantic_examples example JOIN router_candidates candidate ON candidate.normalized_query=example.normalized_text AND candidate.proposed_intent=example.intent_key AND candidate.tenant_id=example.tenant_id WHERE example.tenant_id=$1 AND example.normalized_text=$2 AND example.approval_state='approved'",[actor.tenantId,phrase.toLowerCase()])).rows[0]);
 assert(promotion,'Complete browser learning loop first');assert.equal(promotion.confirmation_state,'confirmed');assert.equal(promotion.review_state,'approved');assert.equal(promotion.source,'promoted_query');assert.equal(promotion.embedding_model,LOCAL_MODEL);assert.equal(promotion.embedding_version,LOCAL_VERSION);assert.equal(promotion.embedding_dimensions,LOCAL_DIMENSIONS);
 for(const query of [phrase,phrase+' please']){const {result}=await api('resolve',{query,allowReasoning:true,learn:false,timeZone:'Africa/Cairo'});assert.equal(result.method,'semantic');assert.equal(result.intentKey,'my_assets');assert.equal(result.fallbackUsed,false);assert.equal(result.promotedSemanticHit,true);console.log('PASS promoted same/similar query: semantic, GPT calls 0');}
 for(const [query,key] of [["what's tomorrow's shift?",'tomorrow_shift'],['when is my next scheduled shift','next_shift'],['who is my manager?','my_manager'],['what department am I in','my_department'],['which team am I assigned to','my_team']]){
  const {result}=await api('resolve',{query,allowReasoning:false,timeZone:'Africa/Cairo'});assert.equal(result.intentKey,key);const expected=await withTenant(actor.tenantId,c=>dataAnswer(c,actor,key,'Africa/Cairo'));assert.deepEqual(result.answer,expected);console.log(`PASS ${key}: authoritative own records, no GPT`);
 }
 const absent=await withTenant(actor.tenantId,c=>dataAnswer(c,{...actor,tenantId:'00000000-0000-4000-8000-000000000000'},'my_manager','Africa/Cairo'));assert.equal(absent?.kind==='profile'?absent.value:'unexpected',null);console.log('PASS data answer rejects cross-tenant employee identity');
 const {result:payday}=await api('resolve',{query:'when is next payday?',allowReasoning:false});assert.equal(payday.intentKey,'next_payday');assert.equal(payday.answer,undefined);console.log('PASS payday navigates, no fabricated date');
 const httpTimes:number[]=[];for(let i=0;i<20;i++){const start=performance.now();const {result}=await api('resolve',{query:["what's tomorrow's shift?",'who is my manager?','what department am I in','which team am I assigned to'][i%4],allowReasoning:false,timeZone:'Africa/Cairo'});assert.equal(result.method,'semantic');httpTimes.push(performance.now()-start);}httpTimes.sort((a,b)=>a-b);console.log(JSON.stringify({warmHttpSemanticMs:{samples:httpTimes.length,p50:httpTimes[Math.ceil(httpTimes.length*.5)-1],p95:httpTimes[Math.ceil(httpTimes.length*.95)-1]},includes:'authentication, live permission filtering, embedding cache, PostgreSQL, data answer, telemetry and JSON roundtrip'}));
 const metrics=await api('metrics');const after=metrics.metrics.reduce((n:number,r:any)=>n+Number(r.fallbacks),0);assert.equal(after,before);assert(metrics.summary.semanticAfterPromotion>=2);assert(metrics.embeddingMetrics.length&&metrics.vectorMetrics.length);console.log(JSON.stringify({summary:metrics.summary,vectorMetrics:metrics.vectorMetrics,embeddingMetrics:metrics.embeddingMetrics}));
 console.log('PASS real HTTP local routing, learning persistence and telemetry; GPT fallback count unchanged');
}finally{await pool.end();}
