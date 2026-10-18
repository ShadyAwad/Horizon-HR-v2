import './router-env';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {ROUTER_BLIND_HOLDOUT} from './router-blind-holdout-fixtures';
import {evaluationCases} from './local-semantic-fixtures';
import {CALIBRATION_CHALLENGES} from './semantic-calibration-fixtures';
import {INTENTS,normalizeQuery} from '../src/lib/intelligent-router';
import {INTENT_EXAMPLES} from '../src/lib/router-examples';
import {createEmbedding,routerConfig} from '../src/server/intelligent-router/config';
import {PgSemanticSearch} from '../src/server/intelligent-router/store';
import {resolveQuery} from '../src/server/intelligent-router/router';
import {getDbPool} from '../src/lib/hr-background';
const training=new Set(INTENTS.flatMap(i=>[...i.aliases,...INTENT_EXAMPLES[i.key]??[]]).map(normalizeQuery));
const old=new Set([...evaluationCases,...CALIBRATION_CHALLENGES].map(([q])=>normalizeQuery(q)));
assert(ROUTER_BLIND_HOLDOUT.length>=100);assert.equal(new Set(ROUTER_BLIND_HOLDOUT.map(([q])=>normalizeQuery(q))).size,ROUTER_BLIND_HOLDOUT.length);
for(const [q,key] of ROUTER_BLIND_HOLDOUT){assert(!training.has(normalizeQuery(q)),'Training overlap: '+q);assert(!old.has(normalizeQuery(q)),'Prior fixture overlap: '+q);if(key)assert(INTENTS.some(i=>i.key===key),key);}
const hash=createHash('sha256').update(JSON.stringify(ROUTER_BLIND_HOLDOUT)).digest('hex');
assert.equal(hash,'3bde8af3e9ceb6a931784631397326388db24eff7d92440a5017255b5dd5bc7d','Frozen blind fixtures changed');
const p=createEmbedding(routerConfig())!,db=getDbPool();
try{
 const tenant=(await db.query("SELECT tenant_id FROM stanza_auth_tenant('admin@stanza-demo.com')")).rows[0].tenant_id;
 const rows=[];await p.embed('encoder warm up');
 for(const [q,expected] of ROUTER_BLIND_HOLDOUT){const r=await resolveQuery(q,{actor:{tenantId:tenant,employeeId:'blind-classification-only'},embedding:p,search:new PgSemanticSearch(tenant,12),allowed:async()=>true,available:async()=>[...INTENTS],minimumScore:.84,minimumMargin:.1,authorization:{resolve:async()=>({state:'disabled'})}});assert(!r.fallbackUsed);assert.notEqual(r.outcome,'provider_unavailable');rows.push({q,expected,outcome:r.outcome,intent:r.intentKey??null,method:r.method,correct:r.outcome==='matched'&&r.intentKey===expected,wrong:r.outcome==='matched'&&r.intentKey!==expected});}
 const report={fixtureHash:hash,total:rows.length,positive:rows.filter(r=>r.expected).length,correctAccepted:rows.filter(r=>r.correct).length,wrongAccepted:rows.filter(r=>r.wrong).length,safeAbstained:rows.filter(r=>r.outcome!=='matched').length,expectedAbstained:rows.filter(r=>!r.expected&&r.outcome!=='matched').length,language:Object.fromEntries(['English','Arabic','mixed'].map(l=>{const group=rows.filter(r=>(/[\u0600-\u06ff]/u.test(r.q)?/[a-z]/i.test(r.q)?'mixed':'Arabic':'English')===l);return[l,{total:group.length,correct:group.filter(r=>r.correct).length,wrong:group.filter(r=>r.wrong).length}]})),rows};
 console.log(JSON.stringify({...report,rows:undefined}));console.table(rows.filter(r=>r.wrong));
 const n=process.argv.indexOf('--output');if(n>=0)await writeFile(process.argv[n+1],JSON.stringify(report,null,2));assert.equal(report.wrongAccepted,0,'Blind wrong accepts release gate');
}finally{await p.close?.();await db.end();}
