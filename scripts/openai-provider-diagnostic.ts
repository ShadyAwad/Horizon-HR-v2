import { config } from 'dotenv';
import { Pool } from 'pg';
import { LocalOpenAIProfileStore } from '../src/server/intelligent-router/openai-profile-store';
import { localOpenAIEnabled } from '../src/server/intelligent-router/openai-local-auth';
import { collectOpenAIResponse,providerRequestId } from '../src/server/intelligent-router/openai-response-stream';
if(process.env.NODE_ENV==='production')throw Error('LOCAL_DIAGNOSTIC_ONLY');
config({quiet:true});config({path:'.env.development.local',override:true,quiet:true});
if(process.env.NODE_ENV==='production')throw Error('LOCAL_DIAGNOSTIC_ONLY');
if(!['localhost','127.0.0.1','[::1]'].includes(new URL(process.env.DATABASE_URL!).hostname))throw Error('LOCAL_DATABASE_REQUIRED');
process.env.NODE_ENV='development';process.env.STANZA_RUNTIME_PROFILE='local-preview';
if(process.env.STANZA_OPENAI_DIAGNOSTIC_CONSENT!=='true' || !localOpenAIEnabled())throw Error('LOCAL_DIAGNOSTIC_CONSENT_REQUIRED');
const pool=new Pool({connectionString:process.env.DATABASE_URL});
try {
  const row=(await pool.query("SELECT id,tenant_id FROM employees WHERE email=$1 AND is_active AND employment_status='active'",['admin@stanza-demo.com'])).rows[0];if(!row)throw Error('AUTHENTICATED_STANZA_USER_REQUIRED');
  const actor={tenantId:row.tenant_id,employeeId:row.id};
  const profile=await new LocalOpenAIProfileStore(process.env.STANZA_ROUTER_OPENAI_HOST_ID!).snapshot(actor),c=profile.credentials;
  if(!c || c.actor.tenantId!==actor.tenantId || c.actor.employeeId!==actor.employeeId || !c.actor.sessionId || !(await pool.query('SELECT 1 FROM auth_sessions WHERE tenant_id=$1 AND employee_id=$2 AND id=$3 AND revoked_at IS NULL AND expires_at>now()',[actor.tenantId,actor.employeeId,c.actor.sessionId])).rowCount)throw Error('AUTHENTICATED_STANZA_USER_REQUIRED');
  if(c.expires<Date.now()+120_000 || !['resource.invoke','chatgpt.tokens.use.direct'].every(s=>c.scopes.includes(s)))throw Error('FRESH_AUTHORIZED_GRANT_REQUIRED');
  if(c.model!=='gpt-5.6-sol')throw Error('SELECTED_MODEL_CHANGED');
  const structured=process.env.STANZA_OPENAI_DIAGNOSTIC_MODE==='structured';
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',redirect:'error',signal:AbortSignal.timeout(30_000),headers:{Authorization:'Bearer '+c.access,'Content-Type':'application/json'},body:JSON.stringify({model:c.model,input:[{role:'user',content:'Reply with exactly: connected'}],store:false,stream:true,...(structured ? {text:{format:{type:'json_schema',name:'connection_check',strict:true,schema:{type:'object',properties:{reply:{type:'string',enum:['connected']}},required:['reply'],additionalProperties:false}}}} : {})})});
  const reader=response.body?.getReader(),decoder=new TextDecoder();let body='',bytes=0,truncated=false;
  if(reader)try{while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.length;if(bytes>64_000){truncated=true;break;}body+=decoder.decode(chunk.value,{stream:true});}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const copiedHeaders=new Headers();if(response.headers.has('content-type'))copiedHeaders.set('content-type',response.headers.get('content-type')!);
  const originalId=providerRequestId(response);if(originalId)copiedHeaders.set('x-request-id',originalId);
  const events=body.split(/\r?\n\r?\n/).map(frame=>{try{return JSON.parse(frame.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n'));}catch{return null;}}).filter(Boolean);
  console.log(JSON.stringify({eventTypes:[...new Set(events.map(e=>e.type))],outputTextDeltas:events.filter(e=>e.type==='response.output_text.delta').map(e=>typeof e.delta==='string'?e.delta:'').join('').slice(0,100),outputTextDone:events.filter(e=>e.type==='response.output_text.done').map(e=>typeof e.text==='string'?e.text.slice(0,100):''),completedOutputKinds:events.filter(e=>e.type==='response.completed').flatMap(e=>(e.response?.output ?? []).map((o:any)=>({type:o.type,contentTypes:(o.content ?? []).map((c:any)=>c.type)})))}));
  const result=await collectOpenAIResponse(new Response(new TextEncoder().encode(body),{status:response.status,headers:copiedHeaders}),c.access);
  const text=result.texts.join('').trim();
  const working=structured ? JSON.parse(text).reply==='connected' : text==='connected';
  console.log(JSON.stringify({httpStatus:response.status,contentType:response.headers.get('content-type'),requestId:originalId,model:c.model,scopes:c.scopes,expiresAt:new Date(c.expires).toISOString(),refreshedAt:c.refreshedAt ? new Date(c.refreshedAt).toISOString() : null,refreshPerformed:false,bytes,truncated,mode:structured?'structured':'raw',working,text:text.slice(0,100),...result.diagnostic}));

}finally{await pool.end();}
