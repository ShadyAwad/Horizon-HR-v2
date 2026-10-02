import 'dotenv/config';
import { ROUTER_FIXTURES } from './semantic-router-fixtures';
import { resolveQuery, aggregateIntents } from '../src/server/intelligent-router/router';
import { INTENTS } from '../src/lib/intelligent-router';
import { createAuthorization,createEmbedding,routerConfig } from '../src/server/intelligent-router/config';
import { PgSemanticSearch } from '../src/server/intelligent-router/store';
import { getDbPool,withTenant } from '../src/lib/hr-background';
import { resolveScopedPermission } from '../src/server/organisation/scoped-permissions';
const live=process.argv.includes('--live'),config=routerConfig(live?process.env:{});
if(live&&(!process.env.STANZA_ROUTER_EVAL_TENANT||!process.env.STANZA_ROUTER_EVAL_EMPLOYEE||!process.env.DATABASE_URL))throw Error('Live evaluation requires DATABASE_URL, STANZA_ROUTER_EVAL_TENANT and STANZA_ROUTER_EVAL_EMPLOYEE for a dedicated fixture identity');
if(live&&process.env.NODE_ENV==='production')throw Error('Live fixture evaluation is development-only');
const embedding=live?createEmbedding(config):undefined;
if(live&&!embedding)throw Error('Live evaluation requires a separately configured embedding provider');
const actor=live?{tenantId:process.env.STANZA_ROUTER_EVAL_TENANT!,employeeId:process.env.STANZA_ROUTER_EVAL_EMPLOYEE!}:{tenantId:'fixture',employeeId:'fixture'};
const reports=[];
for(const f of ROUTER_FIXTURES) {
  let retrieved=live?[]:f.hits??[];
  const r=await resolveQuery(f.query,{actor,allowed:live?async i=>withTenant(actor.tenantId,async c=>{
      if(!(await c.query("SELECT 1 FROM employees WHERE tenant_id=$1 AND id=$2 AND is_active AND employment_status='active'",[actor.tenantId,actor.employeeId])).rowCount)return false;
      if(!i.permissions.length)return true;
      for(const p of i.permissions)if((await resolveScopedPermission(c,{tenantId:actor.tenantId,actorEmployeeId:actor.employeeId,permissionKey:p,targetEmployeeId:actor.employeeId})).allowed)return true;
      return false;
    }):async()=>true,minimumScore:config.minimumScore,minimumMargin:config.minimumMargin,
    embedding:embedding??{model:'mock-only',dimensions:2,version:'fixture-v1',embed:async()=>[1,0]},search:{search:async(vector,provider,keys)=>{retrieved=live?await new PgSemanticSearch(actor.tenantId,config.topK).search(vector,provider,keys):f.hits??[];return retrieved;}},
    authorization:live?createAuthorization(config):{resolve:async()=>f.reasoning?{state:'ready',provider:{interpret:async()=>({status:'resolved',proposedIntentKey:f.reasoning,confidence:'high'})}}:{state:'disabled'}},
  });
  const hits=aggregateIntents(retrieved,INTENTS), selected=r.intentKey??r.outcome;
  const passed=selected===f.expected&&(live||r.method===f.layer);
  reports.push({query:f.query,language:f.language,expected:f.expected,layer:r.method,top: hits[0]?.intentKey??'',score:r.score??'',competing:r.competingScore??'',margin:r.margin??'',reasoningFallback:r.fallbackUsed,final:selected,result:passed?'PASS':'FAIL'});
}
console.table(reports);
console.log(live?'Live synthetic-query evaluation; results reflect configured corpus/provider/thresholds. No candidates are persisted.':'Mock routing contract evaluation only; scores are fixtures, not measured multilingual embedding quality.');
for(const language of new Set(ROUTER_FIXTURES.map(f=>f.language))) console.log(language, reports.filter(r=>r.language===language&&r.result==='PASS').length,'/',reports.filter(r=>r.language===language).length);
if(reports.some(r=>r.result==='FAIL'))process.exitCode=1;
if(live)await getDbPool().end();
