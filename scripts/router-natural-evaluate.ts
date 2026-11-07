import './router-env';
import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {evaluationCases} from './local-semantic-fixtures';import {CALIBRATION_CHALLENGES} from './semantic-calibration-fixtures';import {ROUTER_BLIND_HOLDOUT} from './router-blind-holdout-fixtures';import {NATURAL_DISCOVERY,NATURAL_BLIND,PREVIOUS_ACCEPTED} from './router-natural-fixtures';
import {INTENTS,normalizeQuery} from '../src/lib/intelligent-router';import {INTENT_EXAMPLES} from '../src/lib/router-examples';
import {createEmbedding,routerConfig} from '../src/server/intelligent-router/config';import {resolveQuery} from '../src/server/intelligent-router/router';import {PgSemanticSearch} from '../src/server/intelligent-router/store';import {getDbPool,withTenant} from '../src/lib/hr-background';import {resolveScopedPermission} from '../src/server/organisation/scoped-permissions';
const training=new Set(INTENTS.flatMap(i=>[...i.aliases,...INTENT_EXAMPLES[i.key]??[]]).map(normalizeQuery));const previous=new Set([...evaluationCases,...CALIBRATION_CHALLENGES,...ROUTER_BLIND_HOLDOUT,...NATURAL_DISCOVERY].map(([q])=>normalizeQuery(q)));
for(const [q] of NATURAL_BLIND){assert(!training.has(normalizeQuery(q)),'Training overlap '+q);assert(!previous.has(normalizeQuery(q)),'Existing evaluation overlap '+q);}
const hash=createHash('sha256').update(JSON.stringify(NATURAL_BLIND)).digest('hex');assert.equal(hash,'42e359da0e41c4e5f385b463d773fda7094758a7e36d1fa8e9aa49b50791b500','Frozen natural holdout changed');
const cfg=routerConfig();assert.equal(cfg.embeddingProvider,'local');assert.equal(cfg.minimumScore,.84);assert.equal(cfg.minimumMargin,.1);const provider=createEmbedding(cfg)!,db=getDbPool();
try{
 const tenant=(await db.query("SELECT tenant_id FROM stanza_auth_tenant('admin@stanza-demo.com')")).rows[0].tenant_id;
 const actor=await withTenant(tenant,async c=>(await c.query("SELECT id,tenant_id FROM employees WHERE email='admin@stanza-demo.com'")).rows[0]);
 const allowed=await withTenant(tenant,async c=>{const keys=[];for(const i of INTENTS){if(!i.permissions.length){keys.push(i.key);continue;}for(const p of i.permissions)if((await resolveScopedPermission(c,{tenantId:tenant,actorEmployeeId:actor.id,permissionKey:p,targetEmployeeId:actor.id})).allowed){keys.push(i.key);break;}}return keys;});
 await provider.embed('warmup sentence');const rows:any[]=[],summary:Record<string,any>={};
 for(const [set,cases] of [['original',evaluationCases],['independent',CALIBRATION_CHALLENGES],['oldBlind',ROUTER_BLIND_HOLDOUT],['discovery',NATURAL_DISCOVERY],['newBlind',NATURAL_BLIND]] as const){
  const available=['original','independent'].includes(set)?INTENTS.filter(i=>allowed.includes(i.key)):[...INTENTS];
  for(const [index,[q,target]] of cases.entries()){
   const expected=target==='no_match'?null:target;
   const r=await resolveQuery(q,{actor:{tenantId:tenant,employeeId:'classification-only'},embedding:provider,search:new PgSemanticSearch(tenant,12),allowed:async i=>available.some(v=>v.key===i.key),available:async()=>available,minimumScore:.84,minimumMargin:.1,authorization:{resolve:async()=>({state:'disabled'})}});
   assert(!r.fallbackUsed);assert.notEqual(r.outcome,'provider_unavailable');rows.push([set,index,expected,r.outcome,r.intentKey??null,r.method,r.latencyMs]);
  }
  const group=rows.filter(r=>r[0]===set),correct=group.filter(r=>r[3]==='matched'&&r[4]===r[2]),sorted=group.map(r=>r[6]).sort((a,b)=>a-b);
  summary[set]={total:group.length,correct:correct.length,deterministic:correct.filter(r=>r[5]==='rule'||r[5]==='exact').length,semantic:correct.filter(r=>r[5]==='semantic').length,clarification:group.filter(r=>r[3]==='ambiguous').length,abstention:group.filter(r=>!['matched','ambiguous'].includes(r[3])).length,wrong:group.filter(r=>r[3]==='matched'&&r[4]!==r[2]).length,p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)]};
 }
 console.log('__EVAL__'+JSON.stringify({hash,summary,rows}));
 if(process.argv.includes('--gate')){assert(rows.every(r=>r[3]!=='matched'||r[4]===r[2]),'Zero wrong accepts');for(const [set,indices] of Object.entries(PREVIOUS_ACCEPTED))for(const index of indices){const r=rows.find(r=>r[0]===set&&r[1]===index);assert(r&&r[3]==='matched'&&r[4]===r[2],`Previously correct ${set}/${index} regressed`);}}
}finally{await provider.close?.();await db.end();}
