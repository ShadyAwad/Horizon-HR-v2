import './router-env';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {evaluationCases} from './local-semantic-fixtures';
import {CALIBRATION_CHALLENGES,BASELINE_MISS_CAUSES} from './semantic-calibration-fixtures';
import {INTENTS, normalizeQuery} from '../src/lib/intelligent-router';
import {INTENT_EXAMPLES,CLOCK_DEPARTURE_EXAMPLES} from '../src/lib/router-examples';
import {createEmbedding,routerConfig} from '../src/server/intelligent-router/config';
import {aggregateIntents,resolveQuery} from '../src/server/intelligent-router/router';
import {PgSemanticSearch} from '../src/server/intelligent-router/store';
import {getDbPool,withTenant} from '../src/lib/hr-background';
import {resolveScopedPermission} from '../src/server/organisation/scoped-permissions';

const fixtureHash=createHash('sha256').update(JSON.stringify(evaluationCases)).digest('hex');
assert.equal(fixtureHash,'e7513bc0c125223d492dcefb79fae6c58b334a831e1cfe7a87e8383c37537cfa','frozen query/expected pairs changed');
for(const phrase of CLOCK_DEPARTURE_EXAMPLES)assert(![...evaluationCases,...CALIBRATION_CHALLENGES].some(([q])=>normalizeQuery(q)===normalizeQuery(phrase)),'new coverage must not copy evaluation fixtures');
const settings=routerConfig();assert.equal(settings.embeddingProvider,'local');
const provider=createEmbedding(settings)!, pool=getDbPool();
const language=(q:string)=>/[\u0600-\u06ff]/u.test(q)?(/[a-z]/i.test(q)?'mixed':'Arabic'):'English';
const family=(key:string)=>/shift|attendance|clock|break|live_employees/.test(key)?'Attendance':/leave/.test(key)?'Leave':/expense|reimbursement/.test(key)?'Expenses':/pay|compensation/.test(key)?'Payroll':/grievance/.test(key)?'Grievances':/hiring|candidate/.test(key)?'Hiring':/equipment|asset/.test(key)?'Assets':/support/.test(key)?'Support':/meeting|communication|feed/.test(key)?'Communications':key==='no_match'?'Unsupported/ambiguous':'Other';
const stats=(values:number[])=>{const v=[...values].sort((a,b)=>a-b);return {samples:v.length,p50:v[Math.ceil(v.length*.5)-1]??null,p95:v[Math.ceil(v.length*.95)-1]??null};};
const corpus=new Map<string,string>();for(const i of INTENTS)for(const q of [...i.aliases,...INTENT_EXAMPLES[i.key]??[]])corpus.set(normalizeQuery(q),i.key);
const rows:Record<string,any>[]=[];const embeddingMs:number[]=[],retrievalMs:number[]=[],classificationMs:number[]=[];
let fallbackChecks=0;
try {
 const located=(await pool.query("SELECT tenant_id FROM stanza_auth_tenant('admin@stanza-demo.com')")).rows[0];assert(located);
 const actor=await withTenant(located.tenant_id,async c=>{const r=(await c.query("SELECT id,tenant_id FROM employees WHERE email='admin@stanza-demo.com' AND is_active")).rows[0];assert(r);return {tenantId:r.tenant_id,employeeId:r.id};});
 const available=await withTenant(actor.tenantId,async c=>{const allowed=[];for(const i of INTENTS){if(!i.permissions.length){allowed.push(i);continue;}for(const permissionKey of i.permissions)if((await resolveScopedPermission(c,{tenantId:actor.tenantId,actorEmployeeId:actor.employeeId,permissionKey,targetEmployeeId:actor.employeeId})).allowed){allowed.push(i);break;}}return allowed;});
 const search=new PgSemanticSearch(actor.tenantId,settings.topK);await provider.embed('warm up local sentence encoder');
 for(const [set,cases] of [['legacy112',evaluationCases],['independent',CALIBRATION_CHALLENGES]] as const)for(const [index,[query,expected]] of cases.entries()) {
  let hits:ReturnType<typeof aggregateIntents>=[],vector:number[]|undefined;
  const r=await resolveQuery(query,{actor,allowed:async i=>available.some(a=>a.key===i.key),available:async()=>available,minimumScore:settings.minimumScore,minimumMargin:settings.minimumMargin,
   embedding:{model:provider.model,dimensions:provider.dimensions,version:provider.version,embed:async q=>{const t=performance.now();vector=await provider.embed(q);embeddingMs.push(performance.now()-t);return vector;}},
   search:{search:async(v,p,keys)=>{const t=performance.now();const found=await search.search(v,p,keys);retrievalMs.push(performance.now()-t);hits=aggregateIntents(found,available);return found;}},authorization:{resolve:async()=>{fallbackChecks++;return {state:'disabled'};}}});
  classificationMs.push(r.latencyMs!);
  let expectedScore=hits.find(h=>h.intentKey===expected)?.score??null;
  // Diagnostic work is outside latency samples and cannot change routing decisions.
  if(vector&&expected!=='no_match'&&expectedScore===null)expectedScore=aggregateIntents(await search.search(vector,provider,[expected]),available)[0]?.score??null;
  const correctAccept=r.outcome==='matched'&&r.intentKey===expected,wrongAccept=r.outcome==='matched'&&r.intentKey!==expected;
  const safeAbstention=r.outcome!=='matched';
  const diagnosis=set==='legacy112'?BASELINE_MISS_CAUSES[index]:{category:expected==='no_match'?'I':language(query)!=='English'?'B':/equipmnet|myy|remaing/.test(query)?'C':r.margin!==undefined&&r.margin<settings.minimumMargin&&r.score!>=settings.minimumScore?'D':'A',reason:expected==='no_match'?'Unsupported or ambiguous capability: preserve abstention.':language(query)!=='English'?'Multilingual/dialect model separation remains insufficient.':/equipmnet|myy|remaing/.test(query)?'Spelling noise lowers the expected intent below the safe gate.':'Generalized vocabulary remains below the score gate or too close to another intent.'};
  rows.push({set,index,diagnosis,query,expected,language:language(query),family:family(expected),entities:/ahmed|ahmd|mona|cairo|NS-LAP|EMP-|احمد|أحمد/i.test(query),entityCapable:!!INTENTS.find(i=>i.key===expected)?.entities,layer:r.method,top:hits[0]?.intentKey??r.intentKey??null,score:hits[0]?.score??null,expectedScore,top2:hits[1]?.intentKey??null,top2Score:hits[1]?.score??null,margin:r.margin??null,final:r.intentKey??r.outcome,correctAccept,wrongAccept,safeAbstention,expectedAbstention:expected==='no_match',unsupported:r.unsupported??false,corpusOverlap:corpus.has(normalizeQuery(query)),thresholdFailure:vector!==undefined&&(r.score??0)<settings.minimumScore,marginFailure:vector!==undefined&&(r.score??0)>=settings.minimumScore&&(r.margin??0)<settings.minimumMargin,fallbackUsed:r.fallbackUsed});
 }
 const summary=(list:typeof rows)=>({total:list.length,correctAccepted:list.filter(r=>r.correctAccept).length,safeAbstained:list.filter(r=>r.safeAbstention).length,wrongAccepted:list.filter(r=>r.wrongAccept).length,expectedAbstentions:list.filter(r=>r.expectedAbstention&&r.safeAbstention).length,thresholdFailures:list.filter(r=>r.thresholdFailure).length,marginFailures:list.filter(r=>r.marginFailure).length,unsupported:list.filter(r=>r.unsupported).length,corpusOverlap:list.filter(r=>r.corpusOverlap).length});
 const groups=(list:typeof rows,key:string)=>Object.fromEntries([...new Set(list.map(r=>r[key]))].map(k=>[k,summary(list.filter(r=>r[key]===k))]));
 const legacy=rows.filter(r=>r.set==='legacy112'), independent=rows.filter(r=>r.set==='independent');
 const report={fixtureHash,model:provider.model,version:provider.version,scoreGate:settings.minimumScore,marginGate:settings.minimumMargin,legacy:summary(legacy),independent:summary(independent),language:groups(legacy,'language'),family:groups(legacy,'family'),independentLanguage:groups(independent,'language'),independentFamily:groups(independent,'family'),performance:{embeddingMs:stats(embeddingMs),retrievalWithTelemetryMs:stats(retrievalMs),localClassificationMs:stats(classificationMs)},fallbackChecks,liveReasoningCalls:0,rows};
 const output=process.argv[process.argv.indexOf('--output')+1];if(process.argv.includes('--output')){assert(output);await writeFile(output,JSON.stringify(report,null,2));}
 console.log(JSON.stringify({...report,rows:undefined},null,2));console.table(rows.filter(r=>r.wrongAccept||r.expected!=='no_match'&&!r.correctAccept).map(r=>({set:r.set,query:r.query,expected:r.expected,top:r.top,score:r.score,expectedScore:r.expectedScore,top2:r.top2,top2Score:r.top2Score,margin:r.margin,final:r.final})));
 if(rows.some(r=>r.wrongAccept))process.exitCode=1;
 assert(!rows.some(r=>r.fallbackUsed));assert(!rows.some(r=>r.final==='provider_unavailable'),'every fixture must run against available local model/database');
} finally {await provider.close?.();await pool.end();}
