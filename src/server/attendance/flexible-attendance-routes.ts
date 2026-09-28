import type express from 'express';
import type { PoolClient } from 'pg';
import { withTenant, enqueueAttendanceRollup } from '../../lib/hr-background';
import { resolveScopedPermission } from '../organisation/scoped-permissions';
import { attendancePolicy, lockAttendancePolicy, attendanceAudit, attendanceError as fail } from './attendance-policy';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
type Identity = { tenantId: string; employeeId: string };
async function allowed(c: PoolClient, u: Identity, key: string, target?: string) {
  return (await resolveScopedPermission(c,{tenantId:u.tenantId,actorEmployeeId:u.employeeId,permissionKey:key,targetEmployeeId:target})).allowed;
}
async function requireAuthority(c: PoolClient,u: Identity,key: string,target?: string) {
  if (!await allowed(c,u,key,target)) throw fail(403,'You do not have permission for this attendance action.');
}
async function visibleRows(c: PoolClient,u: Identity,rows: any[],permission: string) {
  const cache = new Map<string,boolean>();
  for (const row of rows) if (!cache.has(row.employee_id)) cache.set(row.employee_id, row.employee_id === u.employeeId || await allowed(c,u,permission,row.employee_id));
  return rows.filter(row=>cache.get(row.employee_id));
}
export function registerFlexibleAttendanceRoutes(app: express.Express, deps: {standardAuth: express.RequestHandler; mutationGuard: express.RequestHandler; rateLimiter: express.RequestHandler}) {
  const {standardAuth,mutationGuard,rateLimiter} = deps;
  const route = (handler: (req: express.Request,c: PoolClient,u: Identity)=>Promise<unknown>): express.RequestHandler => async(req,res)=>{
    try { const data = await withTenant(req.authUser!.tenantId,c=>handler(req,c,req.authUser!)); if (req.path.endsWith('/resume') && (data as any).rollup) { try { await enqueueAttendanceRollup((data as any).rollup); } catch (error) { console.error('[Attendance rollup enqueue]',error); } }
      const {rollup, ...response} = data as any; res.json({success:true,...response}); }
    catch(error) { const e=error as {statusCode?:number;code?:string;message?:string}; const status=e.statusCode || (e.code==='23505'?409:500); if(status===500) console.error('[Attendance]',error); res.status(status).json({success:false,error:status===500?'Attendance service is unavailable.':status===409?'This attendance action has already been recorded.':e.message}); }
  };
  app.get('/api/attendance/policy',standardAuth,route(async(_req,c,u)=>({
    ...await attendancePolicy(c,u.tenantId), canManage:await allowed(c,u,'attendance.policy.manage'),
    breakPolicies:(await c.query('SELECT * FROM attendance_break_policies WHERE tenant_id=$1 ORDER BY created_at,id',[u.tenantId])).rows,
  })));
  app.put('/api/attendance/policy',rateLimiter,standardAuth,mutationGuard,route(async(req,c,u)=>{
    await requireAuthority(c,u,'attendance.policy.manage');
    const b=req.body;
    if(!b || !['required','optional','disabled'].includes(b.attendanceLocationMode) || typeof b.allowUnfiledBreaks!=='boolean' || typeof b.allowCustomBreaks!=='boolean' || !Array.isArray(b.breakPolicies) || b.breakPolicies.length>30) throw fail(400,'Invalid attendance policy.');
    const ids=new Set<string>();
    for(const p of b.breakPolicies) {
      if(!p || typeof p.name!=='string' || !p.name.trim() || p.name.length>100 || !Number.isInteger(p.duration_minutes) || p.duration_minutes<5 || p.duration_minutes>180 || (p.maximum_uses!==null && (!Number.isInteger(p.maximum_uses) || p.maximum_uses<1 || p.maximum_uses>20)) || ['requires_approval','paid','active'].some(k=>typeof p[k]!=='boolean') || (p.id!==undefined && (!uuid(p.id)||ids.has(p.id)))) throw fail(400,'Invalid break policy entry.');
      if(p.id) ids.add(p.id);
    }
    await lockAttendancePolicy(c,u.tenantId);
    const previousPolicy=await attendancePolicy(c,u.tenantId);
    await c.query(`INSERT INTO attendance_policies(tenant_id,location_mode,allow_unfiled_breaks,allow_custom_breaks) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id) DO UPDATE SET location_mode=EXCLUDED.location_mode,allow_unfiled_breaks=EXCLUDED.allow_unfiled_breaks,allow_custom_breaks=EXCLUDED.allow_custom_breaks,updated_at=NOW()`,[u.tenantId,b.attendanceLocationMode,b.allowUnfiledBreaks,b.allowCustomBreaks]);
    const previous=(await c.query('SELECT * FROM attendance_break_policies WHERE tenant_id=$1',[u.tenantId])).rows;
    await c.query('UPDATE attendance_break_policies SET active=false WHERE tenant_id=$1',[u.tenantId]);
    for(const p of b.breakPolicies) {
      if(p.id) {
        const updated=await c.query(`UPDATE attendance_break_policies SET name=$3,duration_minutes=$4,maximum_uses=$5,requires_approval=$6,paid=$7,active=$8 WHERE tenant_id=$1 AND id=$2 RETURNING id`,[u.tenantId,p.id,p.name.trim(),p.duration_minutes,p.maximum_uses,p.requires_approval,p.paid,p.active]);
        if(!updated.rowCount) throw fail(404,'Break policy not found.');
      } else await c.query(`INSERT INTO attendance_break_policies(tenant_id,name,duration_minutes,maximum_uses,requires_approval,paid,active) VALUES($1,$2,$3,$4,$5,$6,$7)`,[u.tenantId,p.name.trim(),p.duration_minutes,p.maximum_uses,p.requires_approval,p.paid,p.active]);
    }
    await attendanceAudit(c,u.tenantId,u.employeeId,'attendance.policy.updated',u.tenantId,{previousPolicy,attendanceLocationMode:b.attendanceLocationMode,allowUnfiledBreaks:b.allowUnfiledBreaks,allowCustomBreaks:b.allowCustomBreaks,previousBreakPolicies:previous,breakPolicies:b.breakPolicies});
    return {saved:true};
  }));
  app.get('/api/attendance/breaks',standardAuth,route(async(req,c,u)=>{
    const team=req.query.team==='true';
    const candidates=(await c.query('SELECT id AS employee_id FROM employees WHERE tenant_id=$1 AND ($2::boolean OR id=$3)',[u.tenantId,team,u.employeeId])).rows;
    const ids=(await visibleRows(c,u,candidates,'break_requests.view_all')).map(r=>r.employee_id);
    const breaks=(await c.query(`SELECT b.*,e.full_name AS employee_name FROM attendance_breaks b JOIN employees e ON e.tenant_id=b.tenant_id AND e.id=b.employee_id WHERE b.tenant_id=$1 AND b.employee_id=ANY($2::uuid[]) AND (b.started_at>NOW()-INTERVAL '30 days' OR b.exception_status='unresolved' OR b.ended_at IS NULL) ORDER BY b.started_at DESC LIMIT 1000`,[u.tenantId,ids])).rows;
    const requests=(await c.query(`SELECT r.*,e.full_name AS employee_name,b.id AS attendance_break_id,b.ended_at FROM break_requests r JOIN employees e ON e.tenant_id=r.tenant_id AND e.id=r.employee_id LEFT JOIN attendance_breaks b ON b.tenant_id=r.tenant_id AND b.requested_break_id=r.id WHERE r.tenant_id=$1 AND r.employee_id=ANY($2::uuid[]) AND (r.created_at>NOW()-INTERVAL '30 days' OR r.status='pending' OR (r.status='approved' AND b.id IS NULL)) ORDER BY r.created_at DESC LIMIT 1000`,[u.tenantId,ids])).rows;
    const visibleBreaks=await visibleRows(c,u,breaks,'break_requests.view_all');
    const visibleRequests=await visibleRows(c,u,requests,'break_requests.view_all');
    for(const r of visibleRequests) r.canReview=await allowed(c,u,'break_requests.review',r.employee_id);
    return {breaks:visibleBreaks,requests:visibleRequests};
  }));
  app.post('/api/attendance/breaks/start',rateLimiter,standardAuth,mutationGuard,route(async(req,c,u)=>{
    await requireAuthority(c,u,'attendance.clock',u.employeeId);
    await lockAttendancePolicy(c,u.tenantId);
    const config=await attendancePolicy(c,u.tenantId);
    const shift=(await c.query('SELECT id,clock_in_time FROM time_logs WHERE tenant_id=$1 AND employee_id=$2 AND clock_out_time IS NULL FOR UPDATE',[u.tenantId,u.employeeId])).rows[0];
    if(!shift) throw fail(409,'Clock in before starting a break.');
    if((await c.query('SELECT 1 FROM attendance_breaks WHERE tenant_id=$1 AND time_log_id=$2 AND ended_at IS NULL',[u.tenantId,shift.id])).rowCount) throw fail(409,'You are already on a break.');
    let request:any=null;
    if(req.body.requestedBreakId) {
      if(!uuid(req.body.requestedBreakId)) throw fail(400,'Invalid break request.');
      request=(await c.query(`SELECT * FROM break_requests WHERE tenant_id=$1 AND employee_id=$2 AND id=$3 AND status='approved' FOR UPDATE`,[u.tenantId,u.employeeId,req.body.requestedBreakId])).rows[0];
      if(!request) throw fail(403,'An approved personal break request is required.');
      if(request.requested_end_time && new Date(request.requested_end_time).getTime()<Date.now()) throw fail(409,'This approved break request has expired.');
      if(request.requested_start_time && new Date(request.requested_start_time).getTime()>Date.now()) throw fail(409,'This approved break has not started yet.');
    }
    const policyId=req.body.breakPolicyId || request?.break_policy_id;
    if(request && policyId && policyId!==request.break_policy_id) throw fail(400,'Break policy does not match the approved request.');
    let policy:any=null;
    if(policyId) {
      if(!uuid(policyId)) throw fail(400,'Invalid break policy.');
      policy=(await c.query('SELECT * FROM attendance_break_policies WHERE tenant_id=$1 AND id=$2 AND active=true',[u.tenantId,policyId])).rows[0];
      if(!policy) throw fail(400,'This break policy is not active.');
      const used=Number((await c.query('SELECT count(*) FROM attendance_breaks WHERE tenant_id=$1 AND time_log_id=$2 AND break_policy_id=$3',[u.tenantId,shift.id,policy.id])).rows[0].count);
      if(policy.maximum_uses!==null && used>=policy.maximum_uses) throw fail(409,'The maximum uses for this break in the shift has been reached.');
    } else if(!config.allowCustomBreaks) throw fail(403,'Custom breaks are disabled by company policy.');
    if(!request && policy?.requires_approval) throw fail(403,'This break policy requires an approved request.');
    if(!request && !config.allowUnfiledBreaks) throw fail(403,'Company policy requires an approved break request.');
    const source=request?'approved_request':'unfiled';
    const row=(await c.query(`INSERT INTO attendance_breaks(tenant_id,employee_id,time_log_id,requested_break_id,break_policy_id,policy_name,planned_minutes,paid,source,exception_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[u.tenantId,u.employeeId,shift.id,request?.id||null,policy?.id||null,policy?.name||null,policy?.duration_minutes||request?.duration_minutes||null,policy?.paid||false,source,source==='unfiled'?'unresolved':'none'])).rows[0];
    await attendanceAudit(c,u.tenantId,u.employeeId,'attendance.break.started',row.id,{source,paid:row.paid,timeLogId:shift.id,exceptionStatus:row.exception_status,requestedBreakId:row.requested_break_id,breakPolicyId:row.break_policy_id});
    return {break:row};
  }));
  app.post('/api/attendance/breaks/resume',rateLimiter,standardAuth,mutationGuard,route(async(_req,c,u)=>{
    await requireAuthority(c,u,'attendance.clock',u.employeeId);
    const shift=(await c.query('SELECT id,clock_in_time FROM time_logs WHERE tenant_id=$1 AND employee_id=$2 AND clock_out_time IS NULL FOR UPDATE',[u.tenantId,u.employeeId])).rows[0];
    if(!shift) throw fail(409,'No open shift.');
    const row=(await c.query("UPDATE attendance_breaks SET ended_at=GREATEST(clock_timestamp(),started_at+INTERVAL '1 microsecond') WHERE tenant_id=$1 AND time_log_id=$2 AND ended_at IS NULL RETURNING *",[u.tenantId,shift.id])).rows[0];
    if(!row) throw fail(409,'No active break to resume.');
    await attendanceAudit(c,u.tenantId,u.employeeId,'attendance.break.resumed',row.id);
    return {break:row,rollup:{tenantId:u.tenantId,employeeId:u.employeeId,workDate:new Date(shift.clock_in_time).toISOString().slice(0,10)}};
  }));
  app.post('/api/attendance/breaks/:id/resolve',rateLimiter,standardAuth,mutationGuard,route(async(req,c,u)=>{
    await requireAuthority(c,u,'attendance.clock',u.employeeId);
    if(!uuid(req.params.id) || typeof req.body.reason!=='string' || !req.body.reason.trim() || req.body.reason.length>500) throw fail(400,'Add a reason of 1–500 characters.');
    const row=(await c.query(`UPDATE attendance_breaks SET reason=$4,exception_status='resolved',resolved_at=NOW() WHERE tenant_id=$1 AND employee_id=$2 AND id=$3 AND ended_at IS NOT NULL AND exception_status='unresolved' RETURNING id`,[u.tenantId,u.employeeId,req.params.id,req.body.reason.trim()])).rows[0];
    if(!row) throw fail(404,'Unresolved completed break not found.');
    await attendanceAudit(c,u.tenantId,u.employeeId,'attendance.break.exception_resolved',row.id);
    return {resolved:true};
  }));
  app.get('/api/attendance/history',standardAuth,route(async(req,c,u)=>{
    const from=typeof req.query.from==='string'?req.query.from:new Date(Date.now()-30*86400000).toISOString().slice(0,10);
    const to=typeof req.query.to==='string'?req.query.to:new Date().toISOString().slice(0,10);
    const validDate=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
    if(!validDate(from)||!validDate(to)||from>to||Date.parse(to)-Date.parse(from)>366*86400000) throw fail(400,'Choose a valid date range of up to one year.');
    const target=typeof req.query.employeeId==='string'?req.query.employeeId:null;
    if(target && !uuid(target)) throw fail(400,'Invalid employee.');
    const page=Number(req.query.page||0);
    if(!Number.isInteger(page)||page<0||page>10000) throw fail(400,'Invalid history page.');
    const location=String(req.query.location||'');
    const state=String(req.query.state||'');
    if(location&&!['verified','outside','unavailable','disabled'].includes(location)) throw fail(400,'Invalid location filter.');
    if(state&&!['working','on_break','completed'].includes(state)) throw fail(400,'Invalid attendance state.');
    // Resolve authority before limiting results so other employees cannot crowd out own history.
    const candidates=(await c.query('SELECT id AS employee_id FROM employees WHERE tenant_id=$1 AND ($2::uuid IS NULL OR id=$2)',[u.tenantId,target])).rows;
    const ids=(await visibleRows(c,u,candidates,'attendance.view')).map(r=>r.employee_id);
    const result=await c.query(`WITH shifts AS (
      SELECT l.*,e.full_name AS employee_name,
        attendance_break_seconds(l.tenant_id,l.id,COALESCE(l.clock_out_time,NOW())) AS break_seconds,
        GREATEST(0,EXTRACT(EPOCH FROM (COALESCE(l.clock_out_time,NOW())-l.clock_in_time))-attendance_unpaid_break_seconds(l.tenant_id,l.id,COALESCE(l.clock_out_time,NOW()))) AS worked_seconds,
        EXISTS(SELECT 1 FROM attendance_breaks b WHERE b.tenant_id=l.tenant_id AND b.time_log_id=l.id AND b.ended_at IS NULL) AS on_break,
        EXISTS(SELECT 1 FROM attendance_breaks b WHERE b.tenant_id=l.tenant_id AND b.time_log_id=l.id AND b.exception_status='unresolved') AS exception,
        (SELECT string_agg(b.reason,'; ') FROM attendance_breaks b WHERE b.tenant_id=l.tenant_id AND b.time_log_id=l.id) AS reason
      FROM time_logs l JOIN employees e ON e.tenant_id=l.tenant_id AND e.id=l.employee_id
      WHERE l.tenant_id=$1 AND l.employee_id=ANY($4::uuid[])
        AND l.clock_in_time >= ($2::date::timestamp AT TIME ZONE 'UTC') AND l.clock_in_time < (($3::date+1)::timestamp AT TIME ZONE 'UTC')
        AND e.full_name ILIKE '%' || $5 || '%'
    ), days AS (
      SELECT employee_id,employee_name,to_char(clock_in_time AT TIME ZONE 'UTC','YYYY-MM-DD') AS date,
        MIN(clock_in_time) AS clock_in_time,MAX(clock_out_time) AS clock_out_time,
        SUM(worked_seconds)::float8 AS worked_seconds,SUM(break_seconds)::float8 AS break_seconds,
        string_agg(DISTINCT location_status,', ') AS location_status,
        bool_or(exception) AS exception,string_agg(reason,'; ') AS reason,
        CASE WHEN bool_or(on_break) THEN 'on_break' WHEN bool_or(clock_out_time IS NULL) THEN 'working' ELSE 'completed' END AS state
      FROM shifts GROUP BY employee_id,employee_name,to_char(clock_in_time AT TIME ZONE 'UTC','YYYY-MM-DD')
    ) SELECT * FROM days WHERE ($6='' OR state=$6) AND ($7='' OR $7=ANY(string_to_array(location_status,', ')))
      AND (NOT $8::boolean OR exception OR 'outside'=ANY(string_to_array(location_status,', ')))
      ORDER BY date DESC,employee_id LIMIT 101 OFFSET $9`,[u.tenantId,from,to,ids,String(req.query.employee||'').slice(0,100),state,location,req.query.exceptions==='true',page*100]);
    return {logs:result.rows.slice(0,100),hasMore:result.rows.length>100,page};
  }));
}
