import assert from 'node:assert/strict';
import { collectOpenAIResponse,safeProviderDiagnostics } from '../src/server/intelligent-router/openai-response-stream';
import { ReasoningUnavailable } from '../src/server/intelligent-router/providers';
const completed={type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:'connected'}]}]}};
function stream(events:unknown[],chunks=1){const bytes=new TextEncoder().encode(events.map(e=>'data: '+JSON.stringify(e)+'\r\n\r\n').join(''));return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=chunks)c.enqueue(bytes.slice(i,i+chunks));c.close();}}),{headers:{'Content-Type':'text/event-stream','x-request-id':'req_fixture'},status:200});}
const result=await collectOpenAIResponse(stream([{type:'response.created',response:{status:'in_progress'}},{type:'response.in_progress'},{type:'response.output_text.delta',delta:'connécted'},completed],1),'fixture-access');
assert.equal(result.response.status,'completed');assert.equal(result.diagnostic.requestId,'req_fixture');assert.equal(result.diagnostic.termination,'completed');
for(const fixture of [
  {response:stream([{type:'response.failed',response:{status:'failed',error:{type:'server_error',code:'subscription_sharing_usage_limit_exceeded',message:'Problem fixture-access Bearer fixture-access',param:'model'}}}]),termination:'provider_error',code:'subscription_sharing_usage_limit_exceeded'},
  {response:stream([{type:'error',code:'server_error',message:'Upstream temporarily unavailable'}]),termination:'provider_error',code:'server_error'},
  {response:stream([{type:'response.incomplete',response:{status:'incomplete'}}]),termination:'incomplete'},
  {response:new Response('data: {broken}\n\n',{headers:{'Content-Type':'text/event-stream'}}),termination:'malformed_event'},
  {response:stream([{type:'response.created'},{type:'response.output_text.delta',delta:'connected'}]),termination:'closed_before_completion'},
  {response:stream([{type:'response.completed',response:{status:'failed'}}]),termination:'invalid_completed_event'},
  {response:stream([{type:'response.output_text.done',text:'connected'}]),termination:'closed_before_completion'}
]){
  await assert.rejects(()=>collectOpenAIResponse(fixture.response,'fixture-access'),(e:any)=>{assert(e instanceof ReasoningUnavailable);assert.equal(e.diagnostics.termination,fixture.termination);assert.equal(e.httpStatus,200);if(fixture.code)assert.equal(e.diagnostics.upstreamCode,fixture.code);assert(!JSON.stringify(e.diagnostics).includes('fixture-access'));return true;});
}
assert(!JSON.stringify(safeProviderDiagnostics({message:'fixture-access sk-secret ac_secret rt_secret eyJsecret.token',code:'server_error'},'fixture-access')).includes('secret'));
console.log('PASS Responses stream: one-byte UTF8/CRLF framing, created/progress/deltas, completed, failed/error codes, incomplete, malformed JSON, early EOF, false terminals and credential redaction. Deterministic fixtures only.');

await assert.rejects(()=>collectOpenAIResponse(Response.json({error:{code:'subscription_sharing_user_not_eligible',type:'permission_error',message:'Plan access unavailable'}}),'fixture-access'),(e:any)=>{assert.equal(e.diagnostics.contentType,'application/json');assert.equal(e.diagnostics.upstreamCode,'subscription_sharing_user_not_eligible');assert.equal(e.diagnostics.detail,'Plan access unavailable');assert.equal(e.httpStatus,200);return true;});

const withoutMediaType=stream([completed]);withoutMediaType.headers.delete('content-type');assert.equal((await collectOpenAIResponse(withoutMediaType,'fixture-access')).response.status,'completed','absent media type does not discard valid completed SSE');
const emptyNoMediaType=new Response(new Uint8Array());await assert.rejects(()=>collectOpenAIResponse(emptyNoMediaType,'fixture-access'),(e:any)=>e.diagnostics.termination==='closed_before_completion');

const thin=stream([{type:'response.output_text.delta',delta:'con'},{type:'response.output_text.delta',delta:'nected'},{type:'response.output_text.done',text:'connected'},{type:'response.completed',response:{status:'completed',output:[]}}],1);thin.headers.delete('content-type');assert.deepEqual((await collectOpenAIResponse(thin,'fixture-access')).texts,['connected'],'streamed text is retained through a thin completed event without duplication');
