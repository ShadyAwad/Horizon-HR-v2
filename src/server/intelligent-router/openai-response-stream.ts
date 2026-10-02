import { ReasoningUnavailable } from './providers';
import type { ProviderDiagnostics } from '../../lib/intelligent-router';
export function safeProviderDiagnostics(error: any, access: string): ProviderDiagnostics {
  const clean=(value:unknown)=>typeof value==='string' ? value.replaceAll(access || '__no_token__','[redacted]').replace(/Bearer\s+\S+|(?:sk-|ac_|rt_)[A-Za-z0-9_.-]+|eyJ[A-Za-z0-9_.-]+/gi,'[redacted]').replace(/[\r\n\t]+/g,' ').slice(0,1000) : undefined;
  const field=(value:unknown)=>typeof value==='string' && /^[a-zA-Z_][a-zA-Z0-9_.-]{0,119}$/.test(value) && value!==access ? value : undefined;
  return {upstreamCode:field(error?.code),errorType:field(error?.type),parameter:field(error?.param),detail:clean(error?.message ?? error?.detail)};
}
export function providerRequestId(response: Response) {
  const id=response.headers.get('x-request-id');return id && /^[a-zA-Z0-9_-]{1,160}$/.test(id) ? id : undefined;
}
export type CompletedOpenAIResponse = { output?: any[]; status: string };
export async function collectOpenAIResponse(response: Response, access: string, report: (diagnostic: ProviderDiagnostics)=>void = ()=>{}): Promise<{response:CompletedOpenAIResponse;diagnostic:ProviderDiagnostics;texts:string[];refused:boolean}> {
  const base={requestId:providerRequestId(response),contentType:(response.headers.get('content-type') || '(missing)').slice(0,160)};
  const fail=(termination:string,eventType?:string,error?:any,responseStatus?:string):never=>{
    const diagnostic={...base,...safeProviderDiagnostics(error,access),eventType,responseStatus,termination};report(diagnostic);
    throw new ReasoningUnavailable(error?.code==='subscription_sharing_usage_limit_exceeded' ? 'rate_limited' : 'incomplete_response','responses',response.status,diagnostic);
  };
  if(!response.body)fail('missing_body');
  if(response.headers.has('content-type') && !response.headers.get('content-type')!.toLowerCase().includes('text/event-stream')){
    // Diagnose only bounded structured error fields, never raw bodies/headers/credentials.
    const reader=response.body!.getReader(),decoder=new TextDecoder();let body='',bytes=0;
    try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>256_000)break;body+=decoder.decode(part.value,{stream:true});}}
    finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    let object:any;try{object=JSON.parse(body);}catch{}
    if(object)fail('invalid_content_type',typeof object.type==='string'?object.type:undefined,object.error ?? object,typeof object.status==='string'?object.status:undefined);
    // Some gateways buffer SSE while omitting its media type; retain terminal evidence without claiming completion.
    for(const frame of body.split(/\r?\n\r?\n/)){
      const data=frame.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
      try{const event=JSON.parse(data);if(['error','response.failed','response.incomplete'].includes(event.type))fail('invalid_content_type',event.type,event.response?.error ?? event.error ?? event,event.response?.status);}catch(e){if(e instanceof ReasoningUnavailable)throw e;}
    }
    fail('invalid_content_type');
  }
  const reader=response.body!.getReader(),decoder=new TextDecoder();let buffer='',bytes=0,completed:CompletedOpenAIResponse|undefined;
  const streamedText=new Map<string,string>();let refused=false;
  function frame(value:string) {
    const data=value.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
    if(!data || data==='[DONE]')return;
    let event:any;try{event=JSON.parse(data);}catch{fail('malformed_event');}
    if(!event || typeof event.type!=='string')fail('malformed_event');
    if(['error','response.failed','response.incomplete'].includes(event.type))fail(event.type==='response.incomplete'?'incomplete':'provider_error',event.type,event.response?.error ?? event.error ?? event,event.response?.status);
    if(event.type==='response.output_text.delta' || event.type==='response.output_text.done'){
      const key=JSON.stringify([event.output_index ?? 0,event.content_index ?? 0]);
      if(event.type==='response.output_text.delta'){
        if(typeof event.delta!=='string')fail('malformed_event',event.type);
        streamedText.set(key,(streamedText.get(key) ?? '')+event.delta);
      }else{if(typeof event.text!=='string')fail('malformed_event',event.type);streamedText.set(key,event.text);}
    }
    if(event.type==='response.refusal.delta' || event.type==='response.refusal.done')refused=true;
    if(event.type==='response.completed'){
      if(event.response?.status!=='completed')fail('invalid_completed_event',event.type,undefined,event.response?.status);
      completed=event.response;
    }
    // created, in_progress, deltas and documented non-terminal events are not success.
  }
  try {
    while(!completed){
      let chunk:ReadableStreamReadResult<Uint8Array>;try{chunk=await reader.read();}catch{fail('connection_error');}
      if(chunk.done)break;bytes+=chunk.value.length;if(bytes>256_000)fail('stream_too_large');
      buffer+=decoder.decode(chunk.value,{stream:true});let boundary:RegExpExecArray|null;
      while((boundary=/\r?\n\r?\n/.exec(buffer))){const value=buffer.slice(0,boundary.index);buffer=buffer.slice(boundary.index+boundary[0].length);frame(value);if(completed)break;}
    }
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  if(!completed)fail('closed_before_completion');
  const diagnostic={...base,eventType:'response.completed',responseStatus:'completed',termination:'completed'};report(diagnostic);
  const content=(completed!.output ?? []).filter((o:any)=>o.type==='message').flatMap((o:any)=>o.content ?? []);
  const finalTexts=content.filter((c:any)=>c.type==='output_text' && typeof c.text==='string').map((c:any)=>c.text);
  return {response:completed!,diagnostic,texts:finalTexts.length ? finalTexts : [...streamedText.values()],refused:refused || content.some((c:any)=>c.type==='refusal')};
}
