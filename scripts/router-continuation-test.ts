import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { generateKeyPair,exportJWK,createLocalJWKSet,SignJWT } from 'jose';
import { LocalOpenAIAuth,localOpenAIEnabled,verifyOpenAIIdentity,ChatGPTReasoningProvider } from '../src/server/intelligent-router/openai-local-auth';
import { RouterTelemetry } from '../src/server/intelligent-router/telemetry';
import { resolveQuery } from '../src/server/intelligent-router/router';
import { INTENTS } from '../src/lib/intelligent-router';

const env={NODE_ENV:'development',STANZA_RUNTIME_PROFILE:'local-preview',STANZA_ROUTER_AI_MODE:'user-authorized',STANZA_ROUTER_OPENAI_LOCAL_AUTH:'true',STANZA_ROUTER_OPENAI_HOST_ID:'urn:uuid:11111111-1111-4111-8111-111111111111'};
assert(localOpenAIEnabled(env));assert(!localOpenAIEnabled({...env,STANZA_RUNTIME_PROFILE:''}));assert(!localOpenAIEnabled({...env,STANZA_ROUTER_OPENAI_HOST_ID:'made-up'}));assert.throws(()=>localOpenAIEnabled({...env,NODE_ENV:'production'}));
const {privateKey,publicKey}=await generateKeyPair('RS256'),jwk=await exportJWK(publicKey);jwk.kid='test-key';
const jwks=createLocalJWKSet({keys:[jwk]});
const jwt=(aud:string,nonce:string,sub='openai-subject')=>new SignJWT({nonce}).setProtectedHeader({alg:'RS256',kid:'test-key'}).setIssuer('https://auth.openai.com').setAudience(aud).setSubject(sub).setIssuedAt().setExpirationTime('5m').sign(privateKey);
const signed=await jwt('issued-client','nonce');assert.equal(await verifyOpenAIIdentity(signed,'issued-client','nonce',undefined,jwks),'openai-subject');
for(const [aud,nonce,sub] of [['bad','nonce',undefined],['issued-client','bad',undefined],['issued-client','nonce','other']])await assert.rejects(()=>verifyOpenAIIdentity(signed,aud!,nonce,sub,jwks));
let time=0,writes=0,logs=0;const telemetry=new RouterTelemetry(()=>logs++,()=>time);
for(let i=0;i<10;i++)await telemetry.record(async()=>{writes++;throw Object.assign(Error(),{code:'42P01'});});
assert.equal(writes,1);assert.equal(logs,1);time=60_000;assert(await telemetry.record(async()=>{writes++;}));assert.equal(writes,2);
let release!:()=>void;const pending=telemetry.record(()=>new Promise<void>(r=>release=r));assert(await telemetry.record(async()=>{writes++;}),'healthy concurrent writes are preserved');release();await pending;
const cold=new RouterTelemetry(()=>{});const coldPending=cold.record(()=>new Promise<void>(r=>release=r));assert.equal(await cold.record(async()=>{throw Error('must not run');}),false,'only one initial/recovery probe');release();await coldPending;

const actor={tenantId:'tenant',employeeId:'employee',sessionId:'session'}, calls:{url:string;body:URLSearchParams}[]=[];
let authorize:URL,active=true,refreshCount=0,revokeOk=true,tokenScopes='openid resource.invoke chatgpt.tokens.use.direct';
const transport=async(url:any,options:any={})=>{
  const body=new URLSearchParams(options.body);calls.push({url:String(url),body});
  if(String(url).endsWith('/models'))return Response.json({models:[{slug:'available-model',display_name:'Available model',visibility:'list'},{slug:'hidden-model',visibility:'hidden'}]});
  if(String(url).endsWith('/oauth/token')){
    if(body.get('grant_type')==='refresh_token'){refreshCount++;assert.equal(body.get('scope'),null);assert.equal(body.get('client_id'),'issued-client');return Response.json({access_token:'renewed',refresh_token:'rotated',token_type:'Bearer',expires_in:3600});}
    assert.equal(body.get('redirect_uri'),authorize.searchParams.get('redirect_uri'));assert.equal(body.get('client_id'),'issued-client');
    assert.equal(createHash('sha256').update(body.get('code_verifier')!).digest('base64url'),authorize.searchParams.get('code_challenge'));
    return Response.json({id_token:await jwt('issued-client',authorize.searchParams.get('nonce')!),access_token:'access',refresh_token:'refresh',token_type:'Bearer',expires_in:3600,scope:tokenScopes});
  }
  if(String(url).endsWith('/openid-configuration'))return Response.json({issuer:'https://auth.openai.com',revocation_endpoint:'https://auth.openai.com/revoke'});
  if(String(url).endsWith('/revoke'))return new Response('',{status:revokeOk?200:500});
  throw Error('Unexpected transport');
};
const auth=new LocalOpenAIAuth(env.STANZA_ROUTER_OPENAI_HOST_ID,'gpt-6.1-sol',async a=>active&&a.sessionId===actor.sessionId,transport as typeof fetch);(auth as any).jwks=jwks;
assert.equal((await auth.resolve(actor)).state,'authorization_unavailable');assert.equal((await auth.resolve({...actor,sessionId:undefined})).state,'authorization_unavailable');
authorize=new URL((await auth.start(actor)).authorizationUrl);assert.equal(authorize.searchParams.get('client_id'),'dynamic_agent_client');assert.equal(authorize.searchParams.get('code_challenge_method'),'S256');
let callback=new URL(authorize.searchParams.get('redirect_uri')!);callback.searchParams.set('state','wrong');callback.searchParams.set('code','code');callback.searchParams.set('client_id','issued-client');
assert.equal((await fetch(callback)).status,400);assert.equal(calls.length,0,'invalid state never exchanges');
callback.searchParams.set('state',authorize.searchParams.get('state')!);assert.equal((await fetch(callback)).status,200);assert.equal((await auth.resolve(actor)).state,'ready');
assert.equal((await auth.resolve({...actor,tenantId:'other'})).state,'authorization_unavailable');
assert.deepEqual(await auth.models(actor),[{id:'available-model',label:'Available model'}]);await assert.rejects(()=>auth.selectModel(actor,'arbitrary-model'));await auth.selectModel(actor,'available-model');assert.equal((await auth.status(actor)).model,'available-model');
const c=[...(auth as any).connections.values()][0] as any;c.expires=0;
await Promise.all([auth.resolve(actor),auth.resolve(actor)]);assert.equal(refreshCount,1,'refresh rotation serialized');assert.equal((await auth.status(actor)).model,'available-model','model selection survives refresh');
authorize=new URL((await auth.start(actor)).authorizationUrl);assert.equal(authorize.searchParams.get('client_id'),'issued-client');callback=new URL(authorize.searchParams.get('redirect_uri')!);callback.searchParams.set('state',authorize.searchParams.get('state')!);callback.searchParams.set('code','code');callback.searchParams.set('client_id','different-client');const before=calls.length;assert.equal((await fetch(callback)).status,400);assert.equal(calls.length,before,'mismatched registration never exchanges');
revokeOk=false;assert.equal((await auth.disconnect(actor)).remoteRevoked,false);assert.equal((await auth.resolve(actor)).state,'authorization_unavailable');
authorize=new URL((await auth.start(actor)).authorizationUrl);callback=new URL(authorize.searchParams.get('redirect_uri')!);callback.searchParams.set('state',authorize.searchParams.get('state')!);callback.searchParams.set('code','code');callback.searchParams.set('client_id','issued-client');tokenScopes='openid profile';assert.equal((await fetch(callback)).status,200);assert.equal((await auth.resolve(actor)).state,'authorization_unavailable','identity scopes do not grant inference');active=false;await auth.resolve(actor);assert.equal((auth as any).connections.size,0,'revoked Stanza session clears credentials');

let requests=0;const inference=async(url:any,options:any={})=>{
  requests++;if(String(url).endsWith('/models'))return Response.json({models:[{slug:'gpt-6.1-sol',visibility:'list'}]});
  const body=JSON.parse(options.body);assert.equal(body.stream,true);assert.equal(body.store,false);assert(Array.isArray(body.input));assert.equal(body.reasoning.effort,'low');assert.equal(body.max_output_tokens,undefined);assert.equal(body.tools,undefined);assert.equal(body.text.format.strict,true);
  const proposal={status:'resolved',proposedIntentKey:'request_leave',confidence:'high',explanation:null,suggestedParameters:null};
  const data='data: '+JSON.stringify({type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(proposal)}]}]}})+'\n\n';
  const bytes=new TextEncoder().encode(data);return new Response(new ReadableStream({start(c){c.enqueue(bytes.slice(0,31));c.enqueue(bytes.slice(31));c.close();}}),{headers:{'Content-Type':'text/event-stream'}});
};
const provider=new ChatGPTReasoningProvider(async()=>'test-token','gpt-6.1-sol',inference as typeof fetch);assert.equal((await provider.interpret({query:'a restful day',intents:INTENTS,complex:false})).proposedIntentKey,'request_leave');assert.equal(requests,2);
const broken=new ChatGPTReasoningProvider(async()=>'test-token','gpt-6.1-sol',(async(url:any)=>String(url).endsWith('/models')?Response.json({models:[{slug:'gpt-6.1-sol',visibility:'list'}]}):new Response('data: {"type":"response.incomplete"}\n\n',{headers:{'Content-Type':'text/event-stream'}})) as typeof fetch);await assert.rejects(()=>broken.interpret({query:'test',intents:INTENTS,complex:false}));

const streamedFailure=new ChatGPTReasoningProvider(async()=>'secret-token','gpt-6.1-sol',(async(url:any)=>String(url).endsWith('/models')?Response.json({models:[{slug:'gpt-6.1-sol',visibility:'list'}]}):new Response('data: '+JSON.stringify({type:'response.failed',response:{error:{code:'subscription_sharing_usage_limit_exceeded',message:'secret-token'}}})+'\n\n',{headers:{'Content-Type':'text/event-stream'}})) as typeof fetch);
const streamedResult=await resolveQuery('where did my compensation go',{actor,allowed:async()=>true,available:async()=>[...INTENTS],search:{search:async()=>[]},authorization:{resolve:async()=>({state:'ready',provider:streamedFailure})},minimumScore:.84,minimumMargin:.1});
assert.equal(streamedResult.providerFailure?.upstreamCode,'subscription_sharing_usage_limit_exceeded');assert.equal(streamedResult.providerFailure?.reason,'rate_limited');assert(!JSON.stringify(streamedResult).includes('secret-token'));

// Provider diagnostics carry bounded categories/status only, never upstream bodies or credentials.
for(const [kind,expected] of [['401','authorization_rejected'],['429','rate_limited'],['400','request_rejected'],['model','model_unavailable'],['catalog','catalog_invalid'],['network','network_error']] as const) {
  const failureTransport=async()=>{if(kind==='network')throw Error('secret upstream message');if(kind==='model')return Response.json({models:[]});if(kind==='catalog')return Response.json({unexpected:'secret'});return new Response('secret access token',{status:Number(kind)});};
  const failed=new ChatGPTReasoningProvider(async()=>'secret-token','gpt-6.1-sol',failureTransport as typeof fetch);
  const result=await resolveQuery('where did my compensation go',{actor,allowed:async()=>true,available:async()=>[...INTENTS],search:{search:async()=>[]},authorization:{resolve:async()=>({state:'ready',provider:failed})},minimumScore:.84,minimumMargin:.1});
  assert.equal(result.outcome,'provider_unavailable');assert.equal(result.providerFailure?.reason,expected);assert(!JSON.stringify(result).includes('secret'));
}

// Owner-bound persistence is loaded only after Stanza session authentication; rotation survives restart.
let profile:any={registration:{clientId:'issued-client',subject:'openai-subject'},credentials:{actor,clientId:'issued-client',subject:'openai-subject',access:'persisted-access',refresh:'persisted-refresh',expires:0,scopes:['resource.invoke','chatgpt.tokens.use.direct'],idleExpiry:0,model:'available-model'}};
const profileStore={read:async(a:typeof actor)=>a.tenantId===actor.tenantId && a.employeeId===actor.employeeId ? structuredClone(profile) : null,write:async(_a:typeof actor,p:any)=>{profile=JSON.parse(JSON.stringify(p));},close:async()=>{}};
active=true;const restored=new LocalOpenAIAuth(env.STANZA_ROUTER_OPENAI_HOST_ID,'gpt-6.1-sol',async a=>active&&a.sessionId==='session',transport as typeof fetch,profileStore);
assert.equal((await restored.resolve({...actor,sessionId:'invalid'})).state,'authorization_unavailable');
assert.equal((await restored.resolve(actor)).state,'ready');assert.equal(profile.credentials.refresh,'rotated');assert(profile.credentials.refreshedAt);
await restored.close();assert(profile.credentials.access,'shutdown retains encrypted-store record');
const restarted=new LocalOpenAIAuth(env.STANZA_ROUTER_OPENAI_HOST_ID,'gpt-6.1-sol',async a=>active&&a.sessionId==='session',transport as typeof fetch,profileStore);
assert.equal((await restarted.status(actor)).connected,true);assert.equal((await restarted.status(actor)).persistent,true);
assert.equal((await restarted.resolve({...actor,employeeId:'other'})).state,'authorization_unavailable');
await restarted.disconnectSession(actor.sessionId,actor);assert.equal(profile.credentials,undefined);assert.equal(profile.registration.clientId,'issued-client');
await restarted.close();

// Invalid-client/configuration refresh failures must retain renewable credentials; confirmed terminal errors clear them.
for(const code of ['invalid_client','invalid_grant']){
  let stored:any={registration:{clientId:'issued-client',subject:'openai-subject'},credentials:{actor,clientId:'issued-client',subject:'openai-subject',access:'fixture-access',refresh:'fixture-refresh',expires:0,scopes:['resource.invoke','chatgpt.tokens.use.direct'],idleExpiry:0}};
  const store={read:async()=>structuredClone(stored),write:async(_a:any,p:any)=>stored=JSON.parse(JSON.stringify(p)),close:async()=>{}};
  const failedRefresh=new LocalOpenAIAuth(env.STANZA_ROUTER_OPENAI_HOST_ID,'available-model',async()=>true,(async()=>Response.json({error:code},{status:400})) as typeof fetch,store);
  assert.equal((await failedRefresh.resolve(actor)).state,'authorization_unavailable');
  assert.equal(Boolean(stored.credentials),code==='invalid_client');await failedRefresh.close();
}

// Exercise the actual Leave signal effect across first mount, acknowledgement, repeats, remounts.
const source=readFileSync('src/components/roster/LeaveWorkspace.tsx','utf8'),effect=source.slice(source.indexOf('    if (openRequestSignal === lastOpenSignal.current)'),source.indexOf('  }, [openRequestSignal, onOpenRequestHandled]'));
const signalEffect=new Function('openRequestSignal','lastOpenSignal','onOpenRequestHandled','setRequestStep','setRequestError','setRequestDialogOpen',effect);
let opens=0,ack=0;const last={current:0};const run=(signal:number)=>signalEffect(signal,last,(n:number)=>ack=n,()=>{},()=>{},()=>opens++);
run(1);assert.equal(opens,1);assert.equal(ack,1);run(1);assert.equal(opens,1);run(0);run(1);assert.equal(opens,2);run(0);assert.equal(opens,2);
assert(source.includes('const lastOpenSignal = useRef(0)'));assert(readFileSync('src/pages/Dashboard.tsx','utf8').includes('current === signal ? 0 : current'));
console.log('PASS continuation: real JWT signature/issuer/audience/nonce validation; deterministic OAuth callback, PKCE, tenant/session isolation, refresh rotation, disconnect, revoked sessions and granted scopes; mocked SSE contract; telemetry retry; Leave acknowledgement. No real provider inference claimed.');

// Optional store outages are safely classified and recover on a subsequent request.
const {ReasoningStatusDiagnostics}=await import('../src/server/intelligent-router/reasoning-status-diagnostics');
const diagnostics:string[]=[];let clock=0;
const statusDiagnostics=new ReasoningStatusDiagnostics(line=>diagnostics.push(line),()=>clock);
statusDiagnostics.unavailable('OPENAI_STORE_BUSY');statusDiagnostics.unavailable('OPENAI_STORE_BUSY');
statusDiagnostics.unavailable('secret fixture query');assert.equal(diagnostics.length,1);
assert.equal(JSON.parse(diagnostics[0]).level,'warn');assert.equal(JSON.parse(diagnostics[0]).code,'OPENAI_STORE_BUSY');
clock=60_000;statusDiagnostics.unavailable('OPENAI_STORE_BUSY');assert.equal(diagnostics.length,2);
statusDiagnostics.recovered();statusDiagnostics.unavailable('OPENAI_STORE_BUSY');assert.equal(diagnostics.length,3);
let reads=0;
const retryAuth=new LocalOpenAIAuth(env.STANZA_ROUTER_OPENAI_HOST_ID,'gpt-6.1-sol',async()=>true,transport as typeof fetch,{read:async()=>{reads++;if(reads===1)throw Error('OPENAI_STORE_BUSY');return null;},write:async()=>{},close:async()=>{}});
await assert.rejects(()=>retryAuth.status(actor),/OPENAI_STORE_BUSY/);
assert.equal((await retryAuth.status(actor)).connected,false);assert.equal(reads,2);
console.log('PASS optional authorization classification, bounded redacted warnings, explicit hydration retry');

let unavailableAuthReads=0;
const unavailableDependencies={actor,embedding:{model:'status-fixture',dimensions:2,version:'1',embed:async()=>[1,0]},allowed:async()=>true,available:async()=>[...INTENTS],search:{search:async()=>[{intentKey:'request_leave',score:.99}]},authorization:{resolve:async()=>{unavailableAuthReads++;throw Error('OPENAI_STORE_BUSY');}},minimumScore:.84,minimumMargin:.10};
assert.equal((await resolveQuery('request leave',unavailableDependencies)).method,'exact');
assert.equal((await resolveQuery('a break from work',unavailableDependencies)).method,'semantic');
assert.equal(unavailableAuthReads,0,'local matches never read the optional busy credential store');
const unavailableResult=await resolveQuery('unsupported fixture phrase',{...unavailableDependencies,search:{search:async()=>[]}});
assert.equal(unavailableResult.outcome,'no_match');assert.equal(unavailableResult.reasoningUnavailable,true);assert.equal(unavailableResult.actionKey,undefined);
console.log('PASS exact/semantic routing bypasses unavailable authorization; unsupported requests abstain without actions');
