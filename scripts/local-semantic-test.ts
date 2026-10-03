import './router-env';
import {INTENTS,normalizeQuery} from '../src/lib/intelligent-router';
import {createEmbedding,routerConfig} from '../src/server/intelligent-router/config';
import {resolveQuery,aggregateIntents} from '../src/server/intelligent-router/router';
import {PgSemanticSearch} from '../src/server/intelligent-router/store';
import {getDbPool,withTenant} from '../src/lib/hr-background';
import {resolveScopedPermission} from '../src/server/organisation/scoped-permissions';
const settings=routerConfig(),provider=createEmbedding(settings)!;
if(settings.embeddingProvider!=='local')throw Error('Local-only evaluation');
const pool=getDbPool();const row=(await pool.query("SELECT id,tenant_id FROM employees WHERE email='admin@stanza-demo.com' AND is_active")).rows[0];
if(!row)throw Error('Existing demo fixture administrator required');
const actor={tenantId:row.tenant_id,employeeId:row.id};
const available=await withTenant(actor.tenantId,async c=>{const result=[];for(const i of INTENTS){if(!i.permissions.length){result.push(i);continue;}for(const p of i.permissions)if((await resolveScopedPermission(c,{tenantId:actor.tenantId,actorEmployeeId:actor.employeeId,permissionKey:p,targetEmployeeId:actor.employeeId})).allowed){result.push(i);break;}}return result;});
export const CASES=[
 ["what's tomorrow's shift?",'tomorrow_shift'],['when is next payday?','next_payday'],['where can I see what I got paid?','payslips'],['show me the equipment assigned to me','my_assets'],['where are my clock-ins?','attendance'],['how much leave do I have left?','leave_balance'],['do I have meetings tomorrow?','tomorrow_meetings'],['who is my manager?','my_manager'],['عايز اعرف شيفتي بكرة','tomorrow_shift'],['المرتب هينزل امتى','next_payday'],['رصيد اجازاتي كام','leave_balance'],['العهدة اللي معايا','my_assets'],['my PTO balance كام','leave_balance'],['مصروفاتي لسه pending؟','pending_expenses'],['tomorow shfit','tomorrow_shift'],['leev balnce','leave_balance'],
 ['At what time am I scheduled to work the following day','tomorrow_shift'],['Can you find the list of company equipment in my custody','my_assets'],['Where do I check the unused days in my annual leave allowance','leave_balance'],['مين المسؤول المباشر عني في الشغل','my_manager'],['عندي ميتنجات بكره ولا لا','tomorrow_meetings'],['Which of my submitted claims have not yet been approved','pending_expenses'],['I want to ask for a vacation day','request_leave'],['How do I record the end of my working day','clock_out_help'],['What is happening with my complaint','grievance_status'],['Help me file a new complaint','submit_grievance'],['Has the expense claim been repaid to me','reimbursement_status'],
 ['show my most recent payslip','latest_payslip'],['what is included in my compensation','compensation_summary'],['I need to submit a new expense','submit_expense'],['show me expenses I filed before','expense_history'],['help me clock in','clock_in_help'],['I would like to request annual leave','request_leave'],
 ['cancel leave','no_match'],['modify salary','no_match'],['close grievance','no_match'],['الغاء الاجازة','no_match'],['اقفل الشكوى','no_match'],['recommend a pizza','no_match'],['Tell me tomorrow stock prices','no_match']
] as const;
const embeddingTimes:number[]=[],searchTimes:number[]=[],endTimes:number[]=[],semanticEndTimes:number[]=[];let authorizationCalls=0;const reports=[];
try{
 await provider.embed('warm up local sentence encoder');
 for(const [query,expected] of CASES){
  let hits:ReturnType<typeof aggregateIntents>=[];
  const r=await resolveQuery(query,{actor,allowed:async i=>available.some(a=>a.key===i.key),available:async()=>available,embedding:{...provider,model:provider.model,dimensions:provider.dimensions,version:provider.version,embed:async text=>{const start=performance.now();const vector=await provider.embed(text);embeddingTimes.push(performance.now()-start);return vector;}},minimumScore:settings.minimumScore,minimumMargin:settings.minimumMargin,search:{search:async(vector,p,keys)=>{const start=performance.now();const found=await new PgSemanticSearch(actor.tenantId,settings.topK).search(vector,p,keys);searchTimes.push(performance.now()-start);hits=aggregateIntents(found,available);return found;}},authorization:{resolve:async()=>{authorizationCalls++;return {state:'disabled'};}}});
  endTimes.push(r.latencyMs!);if(r.method==='semantic')semanticEndTimes.push(r.latencyMs!);reports.push({query,expected,layer:r.method,top:hits[0]?.intentKey??r.intentKey??'',score:hits[0]?.score??'',competing:hits[1]?.intentKey??'',competingScore:hits[1]?.score??'',margin:r.margin??'',final:r.intentKey??r.outcome,action:r.commandId??'',llmInvoked:false,pass:(r.intentKey??r.outcome)===expected});
 }
 console.table(reports);
 const percentile=(v:number[],p:number)=>[...v].sort((a,b)=>a-b)[Math.ceil(v.length*p)-1];
 const summary=(v:number[])=>({samples:v.length,p50:percentile(v,.5),p95:percentile(v,.95)});
 console.log(JSON.stringify({intents:INTENTS.length,allowedIntents:available.length,passed:reports.filter(r=>r.pass).length,total:reports.length,authorizationFallbackChecks:authorizationCalls,embeddingMs:summary(embeddingTimes),vectorSearchWithTelemetryMs:summary(searchTimes),endToEndMsAllQueries:summary(endTimes),semanticEndToEndMs:summary(semanticEndTimes)}));
 if(reports.some((r,i)=>!r.pass&&(i<16||r.final!=='no_match'&&r.final!=='ambiguous')))process.exitCode=1;
 console.log('Held-out low-confidence abstentions are reported, never forced into unsafe matches.');
}finally{await provider.close?.();await pool.end();}
