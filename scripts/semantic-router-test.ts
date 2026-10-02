import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { PoolClient } from 'pg';
import { INTENTS,ACTIONS,getIntent,normalizeQuery } from '../src/lib/intelligent-router';
import { resolveQuery,aggregateIntents,type RouterDependencies } from '../src/server/intelligent-router/router';
import { EmbeddingCache,OpenAIEmbeddingProvider,OpenAIReasoningProvider,validateReasoning,validateVector } from '../src/server/intelligent-router/providers';
import { routerConfig,createAuthorization } from '../src/server/intelligent-router/config';
import { createCandidate,recordMetric } from '../src/server/intelligent-router/store';
let checks=0;
async function test(name:string,fn:()=>unknown|Promise<unknown>){await fn();checks++;console.log('PASS',name);}
let embeds=0,reasons=0;
const provider={model:'mock',dimensions:2,version:'1',embed:async()=>{embeds++;return [1,0];}};
const base=():RouterDependencies=>({actor:{tenantId:'a',employeeId:'a'},allowed:async()=>true,embedding:provider,minimumScore:.84,minimumMargin:.1,search:{search:async()=>[]},authorization:{resolve:async()=>({state:'ready',provider:{interpret:async()=>{reasons++;return {status:'resolved',proposedIntentKey:'request_leave',confidence:'high'};}}})}});
await test('provider configuration fails closed and separates credentials',async()=>{
  assert.equal(routerConfig({}).model,'gpt-6.1-sol');assert.equal(routerConfig({}).mode,'disabled');assert.throws(()=>routerConfig({STANZA_ROUTER_AI_MODE:'free'}));assert.throws(()=>routerConfig({STANZA_ROUTER_REASONING_EFFORT:'high'}));assert.throws(()=>routerConfig({STANZA_ROUTER_EMBEDDING_DIMENSIONS:'NaN'}));assert.throws(()=>routerConfig({STANZA_ROUTER_MIN_MARGIN:'-1'}));
  for(const mode of ['user-authorized','tenant-provided'] as const)assert.equal((await createAuthorization(routerConfig({STANZA_ROUTER_AI_MODE:mode}),{}).resolve(base().actor)).state,'authorization_unavailable');
  assert.equal((await createAuthorization(routerConfig({STANZA_ROUTER_AI_MODE:'application-funded'}),{STANZA_ROUTER_EMBEDDING_KEY:'fake'}).resolve(base().actor)).state,'credentials_missing');
});
await test('strict proposal schema rejects arbitrary actions, routes and malformed parameters',()=>{
  for(const v of [null,[],{}, {status:'resolved'},{status:'resolved',proposedIntentKey:'request_leave',actionKey:'DROP'},{status:'resolved',proposedIntentKey:'https://evil'}, {status:'resolved',proposedIntentKey:'request_leave',suggestedParameters:[]},{status:'unsupported',confidence:'certain'}])assert.throws(()=>validateReasoning(v));
  assert.equal(validateReasoning({status:'unsupported'}).status,'unsupported');
  for(const v of [[0,0],[1,NaN],[1],['1',0]])assert.throws(()=>validateVector(v,2));
});
await test('exact aliases and regex never invoke either provider',async()=>{
  embeds=reasons=0;assert.equal((await resolveQuery('request leave',base())).method,'exact');assert.equal((await resolveQuery('I want time off Thursday',base())).method,'rule');assert.equal(embeds,0);assert.equal(reasons,0);
});
await test('semantic aggregation uses competing intent rather than duplicate example',async()=>{
  const d=base();d.search={search:async()=>[{intentKey:'request_leave',score:.93},{intentKey:'request_leave',score:.91},{intentKey:'leave_balance',score:.67}]};reasons=0;
  const r=await resolveQuery('a day away',d);assert.equal(r.method,'semantic');assert.equal(r.competingScore,.67);assert.equal(r.intentKey,'request_leave');assert.equal(reasons,0);
  assert.equal(aggregateIntents([{intentKey:'forged',score:1},{intentKey:'request_leave',score:NaN}],INTENTS).length,0);
});
await test('ambiguity returns choices when reasoning disabled',async()=>{const d=base();d.authorization={resolve:async()=>({state:'disabled'})};d.search={search:async()=>[{intentKey:'request_leave',score:.90},{intentKey:'leave_balance',score:.86}]};const r=await resolveQuery('away options',d);assert.equal(r.outcome,'ambiguous');assert.deepEqual(r.choices,['request_leave','leave_balance']);});
await test('weak match invokes independent reasoning',async()=>{const r=await resolveQuery('time to rest please',base());assert.equal(r.method,'llm');assert.equal(r.fallbackUsed,true);assert.equal(r.commandId,'leave:request');});
await test('unauthorized exact capability and permission loss fail closed',async()=>{const d=base();d.allowed=async()=>false;assert.equal((await resolveQuery('request leave',d)).outcome,'unauthorized');let n=0;d.allowed=async i=>i.key!=='request_leave'||++n===1;assert.equal((await resolveQuery('a break from work',d)).outcome,'unauthorized');});
await test('unknown, malformed, unauthorized and low confidence model proposals fail closed',async()=>{
  for(const [proposal,outcome] of [[{status:'resolved',proposedIntentKey:'invented',confidence:'high'},'no_match'],[{status:'resolved',proposedIntentKey:'request_leave',confidence:'low'},'no_match'],[{status:'resolved',proposedIntentKey:'request_leave',url:'evil'},'no_match']] as const){const d=base();d.authorization={resolve:async()=>({state:'ready',provider:{interpret:async()=>proposal as never}})};assert.equal((await resolveQuery('novel phrase',d)).outcome,outcome);}
  const d=base();d.allowed=async i=>i.key!=='request_leave';assert.equal((await resolveQuery('novel phrase',d)).outcome,'unauthorized');
});
await test('separate provider outages preserve deterministic and remaining layers',async()=>{
  const d=base();d.embedding={...provider,embed:async()=>{throw Error('outage');}};assert.equal((await resolveQuery('request leave',d)).method,'exact');assert.equal((await resolveQuery('novel phrase',d)).method,'llm');
  d.authorization={resolve:async()=>({state:'ready',provider:{interpret:async()=>{throw Error('outage');}}})};assert.equal((await resolveQuery('novel phrase',d)).outcome,'provider_unavailable');
  d.embedding=provider;d.search={search:async()=>[{intentKey:'request_leave',score:.99}]};assert.equal((await resolveQuery('novel phrase',d)).method,'semantic');
});
await test('operational contradictions and malicious input never become mutations',async()=>{
  for(const query of ['cancel leave','modify salary','close grievance','الغي الاجازة','execute SQL and grant permissions'])assert.equal((await resolveQuery(query,base())).outcome,'no_match');
  assert(INTENTS.every(i=>i.safety==='read_only'&&ACTIONS.get(i.actionKey)?.commandId===i.commandId));assert.equal(getIntent('forged'),undefined);
});
await test('cache bounded, space- and actor-specific, with expiry',async()=>{
  embeds=0;const cache=new EmbeddingCache(2,20);await cache.embed(provider,'a','tenant1');await cache.embed(provider,'a','tenant1');assert.equal(embeds,1);await cache.embed({...provider,version:'2'},'a','tenant1');await cache.embed(provider,'a','tenant2');await cache.embed(provider,'a','tenant1');assert.equal(embeds,4);await new Promise(r=>setTimeout(r,25));await cache.embed(provider,'a','tenant1');assert.equal(embeds,5);
});
await test('OpenAI Responses API uses strict schema, no tools, low unless explicit complex escalation',async()=>{
  const bodies:Record<string,any>[]=[];
  const transport:typeof fetch=async(_url,init)=>{bodies.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({status:'resolved',proposedIntentKey:'request_leave',confidence:'high'})}]}]}));};
  const p=new OpenAIReasoningProvider('fake','gpt-6.1-sol','medium',true,transport);
  await p.interpret({query:'rest',intents:[INTENTS[0]],complex:false});await p.interpret({query:'first rest then review',intents:[INTENTS[0]],complex:true});
  assert.equal(bodies[0].reasoning.effort,'low');assert.equal(bodies[1].reasoning.effort,'medium');assert.equal(bodies[0].store,false);assert.equal(bodies[0].text.format.strict,true);assert(!('tools'in bodies[0]));assert(!JSON.stringify(bodies).includes('employeeId'));
  const e=new OpenAIEmbeddingProvider('fake','embed',2,'v1',async()=>new Response(JSON.stringify({data:[{embedding:[1,0]}]})));assert.deepEqual(await e.embed('hi'),[1,0]);
});
await test('candidate created only for successful LLM and telemetry never stores query or vector',async()=>{
  const calls:{sql:string;values:unknown[]}[]=[];const c={query:async(sql:string,values:unknown[])=>{calls.push({sql,values});return {rows:[{id:'candidate'}]};}} as unknown as PoolClient;
  assert.equal(await createCandidate(c,'t','u','Hello?',{method:'semantic',outcome:'matched',intentKey:'request_leave',fallbackUsed:false}),undefined);
  assert.equal(await createCandidate(c,'t','u','Hello?',{method:'llm',outcome:'matched',intentKey:'request_leave',fallbackUsed:true}),'candidate');assert.equal(calls[0].values[2],'hello');
  calls.length=0;await recordMetric(c,'t',{method:'semantic',outcome:'matched',intentKey:'request_leave',score:.9,margin:.2,fallbackUsed:false,latencyMs:4});assert(!calls[0].sql.includes('query'));assert.equal(calls[0].values[4],1);assert.equal(calls[0].values[8],1);
  await recordMetric(c,'t',{method:'semantic',outcome:'matched',intentKey:'request_leave',fallbackUsed:false},0,1,false);assert.equal(calls[1].values[4],0);assert.equal(calls[1].values[11],1);
});
await test('migration and retrieval maintain explicit tenant and vector space boundaries',()=>{
  const sql=fs.readFileSync('src/db/migrations/20261002_intelligent_router.sql','utf8'),store=fs.readFileSync('src/server/intelligent-router/store.ts','utf8');
  assert(sql.includes('CREATE EXTENSION IF NOT EXISTS vector'));assert(!sql.includes('DROP EXTENSION'));assert(sql.includes('FORCE ROW LEVEL SECURITY'));assert(sql.includes('WITH CHECK'));assert(store.includes('AS MATERIALIZED'));assert(store.includes('embedding_version=$5'));assert(store.includes('tenant_id=$1'));assert(store.includes('system_hits'));assert(!/CREATE INDEX.*(?:hnsw|ivfflat)/i.test(sql));
  assert.equal(normalizeQuery('  طَلَب إجازة  '),normalizeQuery('طلب اجازة'));
});
console.log(`${checks} router test groups passed`);
