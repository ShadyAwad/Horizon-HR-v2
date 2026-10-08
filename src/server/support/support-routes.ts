import crypto from 'node:crypto';
import type express from 'express';
import type {PoolClient} from 'pg';
import {withTenant} from '../../lib/hr-background';
import {resolveScopedPermission} from '../organisation/scoped-permissions';
import {recordAuditEvent} from '../audit/audit-events';
import {logServerError} from '../../lib/server-logging';
type Actor={tenantId:string;employeeId:string};
export async function supportAuthority(c:PoolClient,u:Actor,key='support.view'){if(!(await c.query("SELECT 1 FROM employees WHERE tenant_id=$1 AND id=$2 AND is_active AND employment_status='active'",[u.tenantId,u.employeeId])).rowCount)return false;return (await resolveScopedPermission(c,{tenantId:u.tenantId,actorEmployeeId:u.employeeId,permissionKey:key})).allowed;}
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const fail=(message:string,statusCode=400)=>{throw Object.assign(Error(message),{statusCode});};
const text=(v:unknown,max:number,required=false)=>{if(v==null&&!required)return null;if(typeof v!=='string'||v.trim().length>max||required&&!v.trim())fail('Invalid support field.');return (v as string).trim()||null;};
function pageSize(value:unknown){if(value===undefined)return 50;const n=Number(value);if(!Number.isInteger(n)||n<1||n>50)fail('Page size must be between 1 and 50.');return n;}
function readCursor(value:unknown):{at:string;id:string}|null {
 if(value===undefined)return null;
 if(typeof value!=='string'||value.length>240)fail('Invalid support cursor.');
 try{const v=JSON.parse(Buffer.from(value as string,'base64url').toString('utf8'));if(!uuid(v.id)||typeof v.at!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(v.at)||!Number.isFinite(Date.parse(v.at)))fail('Invalid support cursor.');return v;}catch{fail('Invalid support cursor.');}
 return null;
}
function writeCursor(row:{cursor_at:string;id:string}){return Buffer.from(JSON.stringify({at:row.cursor_at,id:row.id})).toString('base64url');}
async function event(c:PoolClient,u:Actor,id:string,status:string,note:string|null,visibility='requester',kind='status'){await c.query('INSERT INTO support_ticket_events(tenant_id,ticket_id,actor_id,status,note,visibility,kind) VALUES($1,$2,$3,$4,$5,$6,$7)',[u.tenantId,id,u.employeeId,status,note,visibility,kind]);await recordAuditEvent(c,{tenantId:u.tenantId,actorId:u.employeeId,action:'support.updated',targetType:'support_ticket',targetId:id,metadata:{status,kind,visibility}});}
export async function listSupportTickets(c:PoolClient,u:Actor,query:Record<string,any>){
  const queue=query.queue==='true',view=await supportAuthority(c,u),manage=await supportAuthority(c,u,'support.manage');
  if(queue&&!view&&!manage)fail('Support queue requires permission.',403);
  const cursor=readCursor(query.cursor),limit=pageSize(query.pageSize);
  const status=typeof query.status==='string'?query.status:'',assignment=typeof query.assignment==='string'?query.assignment:'',search=text(query.search,160)||'',category=typeof query.category==='string'?query.category:'',asset=query.assetId?String(query.assetId):null;
  if(status&&!['open','in_progress','waiting_requester','resolved','closed','unresolved'].includes(status)||assignment&&!['mine','unassigned'].includes(assignment)||asset&&!uuid(asset)||category&&!['damage','it_help','equipment_issue'].includes(category))fail('Invalid support filter.');
  const urgency=query.urgency?String(query.urgency):'',sort=query.sort?String(query.sort):'newest';if(urgency&&!['normal','high'].includes(urgency)||!['newest','oldest'].includes(sort))fail('Invalid support sorting or urgency.');const direction=sort==='oldest'?'ASC':'DESC',comparison=sort==='oldest'?'>':'<';
  const where=`t.tenant_id=$1 AND ($2::boolean OR t.requester_id=$3) AND ($4='' OR t.status=$4 OR ($4='unresolved' AND t.status IN('open','in_progress','waiting_requester'))) AND ($5='' OR ($5='mine' AND t.assigned_to=$3) OR ($5='unassigned' AND t.assigned_to IS NULL)) AND ($6='' OR t.summary ILIKE '%'||$6||'%') AND ($7='' OR t.issue_type=$7) AND ($8::uuid IS NULL OR t.asset_id=$8) AND ($9::uuid IS NULL OR t.requester_id=$9) AND ($10::uuid IS NULL OR EXISTS(SELECT 1 FROM employees target JOIN organisation_teams team ON team.tenant_id=target.tenant_id AND team.id=target.team_id WHERE target.tenant_id=t.tenant_id AND target.id=t.requester_id AND team.location_id=$10)) AND ($11='' OR t.urgency=$11)`;
  const requester=query.requesterId?String(query.requesterId):null,location=query.locationId?String(query.locationId):null;if(requester&&!uuid(requester)||location&&!uuid(location))fail('Invalid support entity filter.');
  const filters=[u.tenantId,queue,u.employeeId,status,assignment,search,category,asset,requester,location,urgency];
  const total=Number((await c.query(`SELECT count(*) FROM support_tickets t WHERE ${where}`,filters)).rows[0].count);
  const rows=(await c.query(`SELECT t.*,to_char(t.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_at,a.name asset_name,a.asset_tag,e.full_name requester_name,h.full_name handler_name FROM support_tickets t LEFT JOIN assets a ON a.tenant_id=t.tenant_id AND a.id=t.asset_id JOIN employees e ON e.tenant_id=t.tenant_id AND e.id=t.requester_id LEFT JOIN employees h ON h.tenant_id=t.tenant_id AND h.id=t.assigned_to WHERE ${where} AND ($12::timestamptz IS NULL OR (t.created_at,t.id)${comparison}($12::timestamptz,$13::uuid)) ORDER BY t.created_at ${direction},t.id ${direction} LIMIT $14`,[...filters,cursor?.at??null,cursor?.id??null,limit+1])).rows;
  const hasMore=rows.length>limit,tickets=rows.slice(0,limit);
  return {tickets,total,hasMore,nextCursor:hasMore?writeCursor(tickets.at(-1)):null,canQueue:view||manage,canManage:manage};
 }
export function registerSupportRoutes(app:express.Express,deps:{standardAuth:express.RequestHandler;mutationGuard:express.RequestHandler;rateLimiter:express.RequestHandler}){
 const route=(method:'get'|'post',path:string,fn:(r:express.Request,c:PoolClient,u:Actor)=>Promise<unknown>)=>app[method]('/api/support'+path,deps.standardAuth,...(method==='post'?[deps.rateLimiter,deps.mutationGuard]:[]),async(r,res)=>{res.setHeader('Cache-Control','no-store');try{const data=await withTenant(r.authUser!.tenantId,async c=>{const u=r.authUser!;if(!(await c.query("SELECT 1 FROM employees WHERE tenant_id=$1 AND id=$2 AND is_active AND employment_status='active'",[u.tenantId,u.employeeId])).rowCount)fail('Support unavailable.',403);return fn(r,c,u);});res.status(method==='post'?201:200).json({success:true,...data as object});}catch(e){const status=Number((e as {statusCode?:number}).statusCode)||500;if(status===500)logServerError('support request failed',e);res.status(status).json({success:false,error:status===500?'Support request failed.':(e as Error).message});}});
 route('get','',async(r,c,u)=>listSupportTickets(c,u,r.query));
 route('post','',async(r,c,u)=>{const b=r.body??{};if(Object.keys(b).some(k=>!['assetId','issueType','summary','description','urgency','followUp','evidenceReportId','requesterId'].includes(k)))fail('Unknown support field.');if(!['damage','it_help','equipment_issue'].includes(b.issueType)||!['normal','high'].includes(b.urgency))fail('Invalid issue type or urgency.');const summary=text(b.summary,180,true),description=text(b.description,4000,true),followUp=text(b.followUp,200);
 if(b.assetId&&!uuid(b.assetId)||b.evidenceReportId&&!uuid(b.evidenceReportId))fail('Invalid asset or evidence.');
 if(b.issueType==='damage'&&!b.assetId)fail('Choose affected equipment.');
 const requester=b.requesterId?uuid(b.requesterId)?b.requesterId:fail('Invalid requester.'):u.employeeId;if(requester!==u.employeeId&&!await supportAuthority(c,u,'support.manage'))fail('Reporting for another employee requires support handling permission.',403);
 let assignment:string|null=null;if(b.assetId){assignment=(await c.query("SELECT id FROM asset_assignments WHERE tenant_id=$1 AND asset_id=$2 AND employee_id=$3 AND status='active'",[u.tenantId,b.assetId,requester])).rows[0]?.id??null;if(!assignment)fail('Assigned equipment unavailable.',404);}
 if(b.evidenceReportId&&!(await c.query('SELECT 1 FROM asset_condition_reports WHERE tenant_id=$1 AND id=$2 AND asset_id=$3 AND reported_by=$4 AND evidence_url IS NOT NULL',[u.tenantId,b.evidenceReportId,b.assetId,u.employeeId])).rowCount)fail('Evidence unavailable.',404);
 // Only explicit, active company-scope support handlers are eligible; the API revalidates every assignment.
 const handlers=(await c.query("SELECT e.id FROM employees e WHERE e.tenant_id=$1 AND e.is_active AND e.employment_status='active' AND EXISTS(SELECT 1 FROM employee_role_assignments a JOIN tenant_role_permissions p ON p.tenant_id=a.tenant_id AND p.role_id=a.role_id WHERE a.tenant_id=e.tenant_id AND a.employee_id=e.id AND a.scope_type='company' AND a.revoked_at IS NULL AND a.assigned_at<=now() AND (a.expires_at IS NULL OR a.expires_at>now()) AND p.permission_key='support.manage') ORDER BY (SELECT count(*) FROM support_tickets t WHERE t.tenant_id=e.tenant_id AND t.assigned_to=e.id AND t.status IN ('open','in_progress','waiting_requester')),e.id LIMIT 1",[u.tenantId])).rows;
 const ticket=(await c.query('INSERT INTO support_tickets(tenant_id,requester_id,asset_id,assigned_to,evidence_report_id,issue_type,summary,description,urgency,follow_up) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[u.tenantId,requester,b.assetId||null,handlers[0]?.id||null,b.evidenceReportId||null,b.issueType,summary,description,b.urgency,followUp])).rows[0];
 if(b.issueType==='damage'&&!b.evidenceReportId)await c.query("INSERT INTO asset_condition_reports(tenant_id,asset_id,assignment_id,reported_by,condition,notes) VALUES($1,$2,$3,$4,'damaged',$5)",[u.tenantId,b.assetId,assignment,u.employeeId,description]);await event(c,u,ticket.id,'open',null);return {ticket};});
 route('get','/handlers',async(_r,c,u)=>{
  if(!await supportAuthority(c,u,'support.manage'))fail('Support handling requires permission.',403);
  const handlers=(await c.query(`SELECT e.id,e.full_name name FROM employees e WHERE e.tenant_id=$1 AND e.is_active AND e.employment_status='active' AND (EXISTS(SELECT 1 FROM employee_role_assignments a JOIN tenant_role_permissions p ON p.tenant_id=a.tenant_id AND p.role_id=a.role_id WHERE a.tenant_id=e.tenant_id AND a.employee_id=e.id AND a.scope_type='company' AND a.revoked_at IS NULL AND a.assigned_at<=now() AND (a.expires_at IS NULL OR a.expires_at>now()) AND p.permission_key='support.manage') OR EXISTS(SELECT 1 FROM permission_delegations d WHERE d.tenant_id=e.tenant_id AND d.granted_to_employee_id=e.id AND d.permission_key='support.manage' AND d.scope_type='company' AND d.status='active' AND d.revoked_at IS NULL AND d.starts_at<=now() AND d.expires_at>now())) ORDER BY e.full_name,e.id LIMIT 200`,[u.tenantId])).rows;
  return {handlers};
 });
 route('get','/:id',async(r,c,u)=>{
  if(!uuid(r.params.id))fail('Ticket unavailable.',404);
  const manager=await supportAuthority(c,u)||await supportAuthority(c,u,'support.manage'),internal=await supportAuthority(c,u,'support.manage');
  const ticket=(await c.query('SELECT * FROM support_tickets WHERE tenant_id=$1 AND id=$2 AND ($3::boolean OR requester_id=$4)',[u.tenantId,r.params.id,manager,u.employeeId])).rows[0];if(!ticket)fail('Ticket unavailable.',404);
  const cursor=readCursor(r.query.historyCursor),limit=pageSize(r.query.pageSize);
  const rows=(await c.query(`SELECT v.id,v.status,v.note,v.visibility,v.kind,v.created_at,e.full_name actor_name,to_char(v.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_at FROM support_ticket_events v JOIN employees e ON e.tenant_id=v.tenant_id AND e.id=v.actor_id WHERE v.tenant_id=$1 AND v.ticket_id=$2 AND ($3::timestamptz IS NULL OR (v.created_at,v.id)>($3::timestamptz,$4::uuid)) AND ($6 OR v.visibility='requester') ORDER BY v.created_at,v.id LIMIT $5`,[u.tenantId,ticket.id,cursor?.at??null,cursor?.id??null,limit+1,internal])).rows;
  const historyHasMore=rows.length>limit,history=rows.slice(0,limit);
  let asset=null,assetHistory:unknown[]=[];
  if(ticket.asset_id){const serial=(await resolveScopedPermission(c,{tenantId:u.tenantId,actorEmployeeId:u.employeeId,permissionKey:'assets.view',targetEmployeeId:ticket.requester_id})).allowed;
   asset=(await c.query('SELECT a.id,a.name,a.asset_tag,a.category,a.status,a.condition,CASE WHEN $3 THEN a.serial_number END serial_number,e.full_name assignee FROM assets a LEFT JOIN asset_assignments x ON x.tenant_id=a.tenant_id AND x.asset_id=a.id AND x.status=\'active\' LEFT JOIN employees e ON e.tenant_id=x.tenant_id AND e.id=x.employee_id WHERE a.tenant_id=$1 AND a.id=$2',[u.tenantId,ticket.asset_id,serial])).rows[0];
   assetHistory=(await c.query('SELECT id,summary,status,created_at FROM support_tickets WHERE tenant_id=$1 AND asset_id=$2 AND ($3 OR requester_id=$4) ORDER BY created_at DESC LIMIT 10',[u.tenantId,ticket.asset_id,manager,u.employeeId])).rows;
  }
  return {ticket,history,historyHasMore,historyNextCursor:historyHasMore?writeCursor(history.at(-1)):null,asset,assetHistory,canInternal:internal};
 });
 route('post','/:id/comments',async(r,c,u)=>{
  if(!uuid(r.params.id))fail('Ticket unavailable.',404);const handler=await supportAuthority(c,u,'support.manage');
  const ticket=(await c.query('SELECT * FROM support_tickets WHERE tenant_id=$1 AND id=$2 AND ($3 OR requester_id=$4) FOR UPDATE',[u.tenantId,r.params.id,handler,u.employeeId])).rows[0];if(!ticket)fail('Ticket unavailable.',404);
  if(ticket.status==='closed')fail('Closed tickets cannot receive comments.',409);
  const visibility=r.body.visibility||'requester';if(!['requester','internal'].includes(visibility)||visibility==='internal'&&!handler)fail('Internal notes require support authority.',403);
  await event(c,u,ticket.id,ticket.status,text(r.body.note,2000,true),visibility,'comment');await c.query('UPDATE support_tickets SET updated_at=now() WHERE tenant_id=$1 AND id=$2',[u.tenantId,ticket.id]);return {saved:true};
 });
 route('post','/:id/update',async(r,c,u)=>{
  if(!uuid(r.params.id))fail('Ticket unavailable.',404);if(!await supportAuthority(c,u,'support.manage'))fail('Support handling requires permission.',403);
  const b=r.body??{};if(Object.keys(b).some(k=>!['status','assignedTo','note','expectedStatus'].includes(k))||!['open','in_progress','waiting_requester','resolved','closed'].includes(b.status))fail('Invalid ticket update.');
  const current=(await c.query('SELECT * FROM support_tickets WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[u.tenantId,r.params.id])).rows[0];if(!current)fail('Ticket unavailable.',404);
  if(b.expectedStatus&&b.expectedStatus!==current.status)fail('Ticket changed; reload before saving.',409);
  const transitions:Record<string,string[]>={open:['in_progress','waiting_requester','resolved'],in_progress:['waiting_requester','resolved'],waiting_requester:['in_progress','resolved'],resolved:['closed','in_progress'],closed:[]};
  if(current.status!==b.status&&!transitions[current.status]?.includes(b.status))fail('Status transition unavailable.',409);
  const assigned=Object.hasOwn(b,'assignedTo')?b.assignedTo:current.assigned_to;
  if(assigned!==null&&assigned!==undefined&&!uuid(assigned))fail('Invalid handler.');
  if(assigned&&!await supportAuthority(c,{tenantId:u.tenantId,employeeId:assigned},'support.manage'))fail('Handler is not authorized in this company.',403);
  const note=text(b.note,2000,b.status==='resolved'&&current.status!=='resolved');
  await c.query("UPDATE support_tickets SET status=$3,assigned_to=$4,updated_at=now(),resolution=CASE WHEN $3='resolved' THEN COALESCE($5,resolution) ELSE resolution END WHERE tenant_id=$1 AND id=$2",[u.tenantId,current.id,b.status,assigned??null,note]);
  if(current.assigned_to!==(assigned??null))await event(c,u,current.id,b.status,null,'requester','assignment');
  await event(c,u,current.id,b.status,note,'requester',b.status==='resolved'?'resolution':'status');
  await c.query("INSERT INTO outbox_events(tenant_id,event_type,payload) VALUES($1,'notification.support_updated',$2::jsonb)",[u.tenantId,JSON.stringify({employeeId:current.requester_id,ticketId:current.id,notificationKey:'system_alerts',idempotencyKey:'support-'+crypto.randomUUID()})]);
  return {updated:true};
 });
}
