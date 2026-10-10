import './router-env';
import {INTENTS,normalizeQuery} from '../src/lib/intelligent-router';
import {createEmbedding,routerConfig} from '../src/server/intelligent-router/config';
import {resolveQuery,aggregateIntents} from '../src/server/intelligent-router/router';
import {PgSemanticSearch} from '../src/server/intelligent-router/store';
import {getDbPool,withTenant} from '../src/lib/hr-background';
import {resolveScopedPermission} from '../src/server/organisation/scoped-permissions';
const settings=routerConfig(),provider=createEmbedding(settings)!;
if(settings.embeddingProvider!=='local')throw Error('Local-only evaluation');
const pool=getDbPool();const located=(await pool.query("SELECT tenant_id FROM stanza_auth_tenant('admin@stanza-demo.com')")).rows[0];const row=located&&await withTenant(located.tenant_id,async c=>(await c.query("SELECT id,tenant_id FROM employees WHERE email='admin@stanza-demo.com' AND is_active")).rows[0]);
if(!row)throw Error('Existing demo fixture administrator required');
const actor={tenantId:row.tenant_id,employeeId:row.id};
const available=await withTenant(actor.tenantId,async c=>{const result=[];for(const i of INTENTS){if(!i.permissions.length){result.push(i);continue;}for(const p of i.permissions)if((await resolveScopedPermission(c,{tenantId:actor.tenantId,actorEmployeeId:actor.employeeId,permissionKey:p,targetEmployeeId:actor.employeeId})).allowed){result.push(i);break;}}return result;});
import {CASES,COVERAGE_CASES,PRODUCT_CASES,evaluationCases} from './local-semantic-fixtures';
export {CASES} from './local-semantic-fixtures';
const embeddingTimes:number[]=[],searchTimes:number[]=[],endTimes:number[]=[],semanticEndTimes:number[]=[];let authorizationCalls=0;const reports=[];
try{
 await provider.embed('warm up local sentence encoder');
 for(const [query,expected] of evaluationCases){
  let hits:ReturnType<typeof aggregateIntents>=[];
  const r=await resolveQuery(query,{actor,allowed:async i=>available.some(a=>a.key===i.key),available:async()=>available,embedding:{...provider,model:provider.model,dimensions:provider.dimensions,version:provider.version,embed:async text=>{const start=performance.now();const vector=await provider.embed(text);embeddingTimes.push(performance.now()-start);return vector;}},minimumScore:settings.minimumScore,minimumMargin:settings.minimumMargin,search:{search:async(vector,p,keys)=>{const start=performance.now();const found=await new PgSemanticSearch(actor.tenantId,settings.topK).search(vector,p,keys);searchTimes.push(performance.now()-start);hits=aggregateIntents(found,available);return found;}},authorization:{resolve:async()=>{authorizationCalls++;return {state:'disabled'};}}});
  endTimes.push(r.latencyMs!);if(r.method==='semantic')semanticEndTimes.push(r.latencyMs!);reports.push({query,expected,layer:r.method,top:hits[0]?.intentKey??r.intentKey??'',score:hits[0]?.score??'',competing:hits[1]?.intentKey??'',competingScore:hits[1]?.score??'',margin:r.margin??'',final:r.intentKey??r.outcome,action:r.commandId??'',llmInvoked:false,pass:(r.intentKey??r.outcome)===expected});
 }
 console.table(reports);
 const percentile=(v:number[],p:number)=>[...v].sort((a,b)=>a-b)[Math.ceil(v.length*p)-1];
 const summary=(v:number[])=>({samples:v.length,p50:percentile(v,.5),p95:percentile(v,.95)});
 console.log(JSON.stringify({intents:INTENTS.length,allowedIntents:available.length,passed:reports.filter(r=>r.pass).length,total:reports.length,authorizationFallbackChecks:authorizationCalls,embeddingMs:summary(embeddingTimes),vectorSearchWithTelemetryMs:summary(searchTimes),endToEndMsAllQueries:summary(endTimes),semanticEndToEndMs:summary(semanticEndTimes)}));
 if(reports.some((r,i)=>!r.pass&&(i<16||i>=CASES.length&&i<CASES.length+20||i>=CASES.length+COVERAGE_CASES.length&&i<CASES.length+COVERAGE_CASES.length+22||i>=CASES.length+COVERAGE_CASES.length+PRODUCT_CASES.length||r.final!=='no_match'&&r.final!=='ambiguous')))process.exitCode=1;
 console.log('Held-out low-confidence abstentions are reported, never forced into unsafe matches.');
}finally{await provider.close?.();await pool.end();}
