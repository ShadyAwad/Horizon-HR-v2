import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { assertDatabaseMutationSafety, assertHttpMutationSafety } from './mutation-safety';
import { rollupAttendanceDailySummary } from '../src/server/attendance/attendance-rollup';
import { getDbPool, getHrQueue, enqueueAttendanceRollup } from '../src/lib/hr-background';
const base=assertHttpMutationSafety(process.env.ATTENDANCE_TEST_BASE_URL||'http://localhost:3003','Attendance integration');
assertDatabaseMutationSafety(process.env.DATABASE_URL,'Attendance integration');
const pool=new Pool({connectionString:process.env.DATABASE_URL});
const tenants:string[]=[];const password=crypto.randomBytes(20).toString('base64url');const tag=crypto.randomUUID();
type Person={id:string;tenantId:string;email:string;cookie:string};
async function call(u:Person|null,path:string,body?:unknown,method='POST',origin=base) {
 const r=await fetch(base+path,{method:body===undefined?'GET':method,headers:{...(u?{Cookie:u.cookie}:{}),Origin:origin,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 assert.match(r.headers.get('content-type') || '', /^application\/json\b/, `${path} must return API JSON, not the SPA document`);
 return {status:r.status,body:await r.json()};
}
async function ok(u:Person,path:string,body?:unknown,method='POST') {const r=await call(u,path,body,method);assert(r.status<300,`${path}: ${r.status} ${JSON.stringify(r.body)}`);return r.body;}
async function person(tenantId:string,name:string,permissions:string[],scope='company',manager?:Person):Promise<Person> {
 const email=`${name}-${tag}@example.invalid`;
 const row=(await pool.query(`INSERT INTO employees(tenant_id,email,full_name,password_hash,role,manager_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[tenantId,email,'Attendance test '+name,await bcrypt.hash(password,10),name==='admin'?'hr_admin':name==='manager'?'manager':'employee',manager?.id||null])).rows[0];
 const role=(await pool.query(`INSERT INTO tenant_roles(tenant_id,name) VALUES($1,$2) RETURNING id`,[tenantId,name])).rows[0];
 for(const permission of permissions)await pool.query('INSERT INTO tenant_role_permissions(tenant_id,role_id,permission_key) VALUES($1,$2,$3)',[tenantId,role.id,permission]);
 await pool.query('INSERT INTO employee_role_assignments(tenant_id,employee_id,role_id,scope_type) VALUES($1,$2,$3,$4)',[tenantId,row.id,role.id,scope]);
 const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({email,password})});assert.equal(r.status,200,'Fixture login');
 return {id:row.id,tenantId,email,cookie:r.headers.get('set-cookie')!.split(';')[0]};
}
try {
 for(let i=0;i<2;i++)tenants.push((await pool.query('INSERT INTO tenants(slug,company_name) VALUES($1,$2) RETURNING id',[`attendance-test-${tag}-${i}`,'Attendance test'])).rows[0].id);
 const all=['attendance.clock','attendance.view','attendance.policy.manage','break_requests.create','break_requests.view_own','break_requests.view_all','break_requests.review'];
 const admin=await person(tenants[0],'admin',all);
 const manager=await person(tenants[0],'manager',['attendance.view','break_requests.view_all','break_requests.review'],'direct_reports');
 const emp=await person(tenants[0],'employee',['attendance.clock','break_requests.create','break_requests.view_own'],'self',manager);
 const outsider=await person(tenants[0],'outsider',['attendance.clock','break_requests.create','break_requests.view_own'],'self');
 const foreign=await person(tenants[1],'foreign',['attendance.clock','break_requests.create','break_requests.view_own'],'self');
 for(const tenant of tenants)await pool.query(`INSERT INTO company_locations(tenant_id,name,latitude,longitude,boundary) VALUES($1,'Test site',30,31,ST_Buffer(ST_SetSRID(ST_MakePoint(31,30),4326)::geography,1000)::geometry)`,[tenant]);
 assert.equal((await call(null,'/api/attendance/policy')).status,401);
 assert.equal((await call(emp,'/api/attendance/breaks/start',{})).status,409);
 assert.equal((await call(emp,'/api/attendance/breaks/resume',{})).status,409);
 assert.equal((await ok(emp,'/api/attendance/policy')).attendanceLocationMode,'required');
 assert.equal((await call(emp,'/api/clock-in',{})).status,400);
 assert.equal((await call(emp,'/api/clock-in',{latitude:0,longitude:0})).status,403);
 assert.equal((await call(emp,'/api/clock-in',{latitude:null,longitude:null})).status,400);
 await ok(emp,'/api/clock-in',{latitude:30,longitude:31});await ok(emp,'/api/clock-out',{});
 console.log('PASS required policy: missing, null and outside coordinates rejected; geofence accepted');
 let policy:any={attendanceLocationMode:'optional',allowUnfiledBreaks:true,allowCustomBreaks:true,breakPolicies:[{name:'Test break',duration_minutes:15,maximum_uses:2,requires_approval:false,paid:true,active:true}]};
 assert.equal((await call(emp,'/api/attendance/policy',policy,'PUT')).status,403);
 assert.equal((await call(admin,'/api/attendance/policy',policy,'PUT','https://untrusted.invalid')).status,403);
 await ok(admin,'/api/attendance/policy',policy,'PUT');
 const omitted=await ok(emp,'/api/clock-in',{});assert.equal(omitted.locationStatus,'unavailable');await ok(emp,'/api/clock-out',{});
 const verified=await ok(emp,'/api/clock-in',{latitude:30,longitude:31});assert.equal(verified.locationStatus,'verified');await ok(emp,'/api/clock-out',{});
 const outside=await ok(emp,'/api/clock-in',{latitude:0,longitude:0});assert.equal(outside.locationStatus,'outside');await ok(emp,'/api/clock-out',{});
 policy=await ok(admin,'/api/attendance/policy');policy.attendanceLocationMode='disabled';await ok(admin,'/api/attendance/policy',policy,'PUT');
 const shift=await ok(emp,'/api/clock-in',{latitude:30,longitude:31});
 const stored=(await pool.query('SELECT clock_in_location,attendance_location_mode FROM time_logs WHERE id=$1',[shift.timeLogId])).rows[0];assert.equal(stored.clock_in_location,null);assert.equal(stored.attendance_location_mode,'disabled');
 assert.equal((await call(foreign,'/api/clock-in',{})).status,400,'Other tenant still requires location');
 const foreignShift=await ok(foreign,'/api/clock-in',{latitude:30,longitude:31});
 console.log('PASS optional/disabled attendance and tenant policy isolation; disabled stores no coordinates');
 const p=policy.breakPolicies[0];
 assert.equal((await call(emp,'/api/attendance/breaks/start',{breakPolicyId:crypto.randomUUID()})).status,400);
 p.active=false;await ok(admin,'/api/attendance/policy',policy,'PUT');
 assert.equal((await call(emp,'/api/attendance/breaks/start',{breakPolicyId:p.id})).status,400);
 p.active=true;await ok(admin,'/api/attendance/policy',policy,'PUT');
 assert.equal((await call(foreign,'/api/attendance/breaks/start',{breakPolicyId:p.id})).status,400);
 assert.equal((await call(emp,'/api/attendance/breaks/resume',{})).status,409);
 const starts=await Promise.all([call(emp,'/api/attendance/breaks/start',{breakPolicyId:p.id}),call(emp,'/api/attendance/breaks/start',{breakPolicyId:p.id})]);
 assert.deepEqual(starts.map(r=>r.status).sort(),[200,409]);
 let personal=await ok(emp,'/api/attendance/breaks');assert.equal(personal.breaks[0].exception_status,'unresolved');const first=personal.breaks[0];assert.equal(first.paid,true);
 await ok(emp,'/api/attendance/breaks/resume',{});
 assert.equal((await ok(emp,'/api/attendance/breaks')).breaks.filter((b:any)=>b.id===first.id).length,1);
 assert.equal((await call(outsider,`/api/attendance/breaks/${first.id}/resolve`,{reason:'unauthorized'})).status,404);
 await ok(emp,`/api/attendance/breaks/${first.id}/resolve`,{reason:'Test reason'});
 personal=await ok(emp,'/api/attendance/breaks');assert.equal(personal.breaks[0].exception_status,'resolved');
 await ok(emp,'/api/attendance/breaks/start',{breakPolicyId:p.id});await ok(emp,'/api/attendance/breaks/resume',{});
 assert.equal((await call(emp,'/api/attendance/breaks/start',{breakPolicyId:p.id})).status,409);
 console.log('PASS concurrent pause uniqueness, multiple breaks, paid snapshot, max uses and persisted reminder resolution');
 const custom=await ok(emp,'/api/attendance/breaks/start',{});
 const openMath=(await pool.query("SELECT attendance_unpaid_break_seconds($1,$2,clock_timestamp()+INTERVAL '1 minute')::float8 AS seconds",[emp.tenantId,shift.timeLogId])).rows[0];assert(openMath.seconds>=60,'Open unpaid break is bounded by the supplied calculation time');
 await ok(emp,'/api/clock-out',{});
 assert((await pool.query('SELECT ended_at FROM attendance_breaks WHERE id=$1',[custom.break.id])).rows[0].ended_at,'Clock-out closes active break');
 await ok(outsider,'/api/clock-in',{});await ok(outsider,'/api/attendance/breaks/start',{});await ok(outsider,'/api/attendance/breaks/resume',{});
 const team=await ok(manager,'/api/attendance/breaks?team=true');assert(team.breaks.some((b:any)=>b.employee_id===emp.id));assert(!team.breaks.some((b:any)=>b.employee_id===outsider.id));
 const noTeam=await ok(emp,'/api/attendance/breaks?team=true');assert(noTeam.breaks.every((b:any)=>b.employee_id===emp.id));
 assert((await ok(foreign,'/api/attendance/breaks?team=true')).breaks.every((b:any)=>b.tenant_id===foreign.tenantId));
 console.log('PASS manager direct-report scope, employee-only view and cross-tenant break isolation');
 policy.breakPolicies[0].requires_approval=true;await ok(admin,'/api/attendance/policy',policy,'PUT');await ok(emp,'/api/clock-in',{});
 assert.equal((await call(emp,'/api/attendance/breaks/start',{breakPolicyId:p.id})).status,403,'Approval required even when custom unfiled pauses are allowed');await ok(emp,'/api/clock-out',{});
 policy.allowUnfiledBreaks=false;await ok(admin,'/api/attendance/policy',policy,'PUT');await ok(emp,'/api/clock-in',{});
 assert.equal((await call(emp,'/api/attendance/breaks/start',{})).status,403);
 const request1=await ok(emp,'/api/break-requests',{durationMinutes:15,breakPolicyId:p.id});
 const request2=await ok(emp,'/api/break-requests',{durationMinutes:15,breakPolicyId:p.id});assert.notEqual(request1.breakRequest.id,request2.breakRequest.id);
 assert.equal((await call(emp,`/api/break-requests/${request1.breakRequest.id}/review`,{status:'approved'},'PATCH')).status,403);
 await ok(manager,`/api/break-requests/${request1.breakRequest.id}/review`,{status:'approved'},'PATCH');
 await ok(emp,'/api/attendance/breaks/start',{requestedBreakId:request1.breakRequest.id});await ok(emp,'/api/attendance/breaks/resume',{});
 assert.equal((await call(emp,'/api/attendance/breaks/start',{requestedBreakId:request1.breakRequest.id})).status,409);
 const outsideRequest=await ok(outsider,'/api/break-requests',{durationMinutes:15});assert.equal((await call(manager,`/api/break-requests/${outsideRequest.breakRequest.id}/review`,{status:'approved'},'PATCH')).status,403);
 console.log('PASS approval-required starts, multiple requests, one-use linkage and scoped review');
 // Deterministic completed eight-hour shift with two 15-minute pauses, including a paid one.
 await pool.query('DELETE FROM attendance_breaks WHERE tenant_id=$1 AND time_log_id=$2',[emp.tenantId,shift.timeLogId]);
 await pool.query("UPDATE time_logs SET clock_in_time='2026-09-20T09:00:00Z',clock_out_time='2026-09-20T17:00:00Z' WHERE id=$1",[shift.timeLogId]);
 for(const [start,end,paid] of [['12:00','12:15',true],['14:00','14:15',false]] as const)await pool.query(`INSERT INTO attendance_breaks(tenant_id,employee_id,time_log_id,started_at,ended_at,paid,source) VALUES($1,$2,$3,$4,$5,$6,'policy')`,[emp.tenantId,emp.id,shift.timeLogId,`2026-09-20T${start}:00Z`,`2026-09-20T${end}:00Z`,paid]);
 await rollupAttendanceDailySummary({tenantId:emp.tenantId,employeeId:emp.id,workDate:'2026-09-20'});
 await rollupAttendanceDailySummary({tenantId:emp.tenantId,employeeId:emp.id,workDate:'2026-09-20'});
 const summary=(await pool.query('SELECT total_minutes,total_break_minutes FROM attendance_daily_summaries WHERE tenant_id=$1 AND employee_id=$2 AND work_date=$3',[emp.tenantId,emp.id,'2026-09-20'])).rows[0];assert.equal(summary.total_minutes,465);assert.equal(summary.total_break_minutes,30);
 for(const [paid,expected] of [[true,480],[false,450]] as const) {
   await pool.query('UPDATE attendance_breaks SET paid=$3 WHERE tenant_id=$1 AND time_log_id=$2',[emp.tenantId,shift.timeLogId,paid]);
   await rollupAttendanceDailySummary({tenantId:emp.tenantId,employeeId:emp.id,workDate:'2026-09-20'});
   assert.equal((await pool.query('SELECT total_minutes FROM attendance_daily_summaries WHERE tenant_id=$1 AND employee_id=$2 AND work_date=$3',[emp.tenantId,emp.id,'2026-09-20'])).rows[0].total_minutes,expected);
   assert.equal((await ok(emp,'/api/attendance/history?from=2026-09-20&to=2026-09-20')).logs[0].worked_seconds,expected*60);
 }
 await pool.query("UPDATE attendance_breaks SET paid=(started_at='2026-09-20T12:00:00Z') WHERE tenant_id=$1 AND time_log_id=$2",[emp.tenantId,shift.timeLogId]);
 await rollupAttendanceDailySummary({tenantId:emp.tenantId,employeeId:emp.id,workDate:'2026-09-20'});
 const history=await ok(emp,'/api/attendance/history?from=2026-09-20&to=2026-09-20');assert.equal(Number(history.logs[0].worked_seconds),465*60);
 assert.equal((await ok(emp,'/api/attendance/history?from=2026-09-20&to=2026-09-20&location=verified')).logs.length,0);
 assert.equal((await ok(emp,'/api/attendance/history?from=2026-09-20&to=2026-09-20&location=disabled')).logs.length,1);
 assert.equal((await ok(foreign,`/api/attendance/history?employeeId=${emp.id}`)).logs.length,0);
 console.log('PASS real worker rollup and daily history deduct unpaid breaks and retain paid credit');
 await pool.query(`INSERT INTO time_logs(tenant_id,employee_id,clock_in_time,clock_out_time,is_valid_geofence,attendance_location_mode,location_status) VALUES($1,$2,'2026-09-20T18:00:00Z','2026-09-20T19:00:00Z',false,'disabled','disabled')`,[emp.tenantId,emp.id]);
 await rollupAttendanceDailySummary({tenantId:emp.tenantId,employeeId:emp.id,workDate:'2026-09-20'});
 const daily=await ok(emp,'/api/attendance/history?from=2026-09-20&to=2026-09-20');assert.equal(daily.logs.length,1);assert.equal(daily.logs[0].worked_seconds,525*60);assert.equal(new Date(daily.logs[0].clock_out_time).getUTCHours(),19);
 const sameDay=(await pool.query('SELECT total_minutes FROM attendance_daily_summaries WHERE tenant_id=$1 AND employee_id=$2 AND work_date=$3',[emp.tenantId,emp.id,'2026-09-20'])).rows[0];assert.equal(sameDay.total_minutes,525);
 await pool.query(`INSERT INTO time_logs(tenant_id,employee_id,clock_in_time,clock_out_time,is_valid_geofence,attendance_location_mode,location_status) SELECT $1,$2,'2026-01-01T09:00:00Z'::timestamptz+n*INTERVAL '1 day','2026-01-01T17:00:00Z'::timestamptz+n*INTERVAL '1 day',false,'disabled','disabled' FROM generate_series(0,100) n`,[emp.tenantId,emp.id]);
 const page0=await ok(manager,'/api/attendance/history?from=2026-01-01&to=2026-04-11');
 const page1=await ok(manager,'/api/attendance/history?from=2026-01-01&to=2026-04-11&page=1');
 assert.equal(page0.logs.length,100);assert.equal(page0.hasMore,true);assert.equal(page1.logs.length,1);assert.equal(page1.hasMore,false);
 assert.equal(new Set([...page0.logs,...page1.logs].map((r:any)=>r.date+r.employee_id)).size,101);
 assert(page0.logs.every((r:any)=>r.employee_id===emp.id));
 await pool.query(`INSERT INTO time_logs(tenant_id,employee_id,clock_in_time,clock_out_time,is_valid_geofence,attendance_location_mode,location_status) SELECT $1,$2,'2026-09-19T09:00:00Z'::timestamptz+n*INTERVAL '1 minute','2026-09-19T09:00:30Z'::timestamptz+n*INTERVAL '1 minute',false,'disabled','disabled' FROM generate_series(0,1) n`,[emp.tenantId,emp.id]);
 await rollupAttendanceDailySummary({tenantId:emp.tenantId,employeeId:emp.id,workDate:'2026-09-19'});
 assert.equal((await pool.query('SELECT total_minutes FROM attendance_daily_summaries WHERE tenant_id=$1 AND employee_id=$2 AND work_date=$3',[emp.tenantId,emp.id,'2026-09-19'])).rows[0].total_minutes,1,'Round once per day, not once per shift');
 const jobs=await Promise.all([enqueueAttendanceRollup({tenantId:emp.tenantId,employeeId:emp.id,workDate:'2026-09-20'}),enqueueAttendanceRollup({tenantId:emp.tenantId,employeeId:emp.id,workDate:'2026-09-20'})]);assert.notEqual(jobs[0].id,jobs[1].id,'A later shift change must not be discarded by retained-job deduplication');
 console.log('PASS multiple-shift daily aggregation and independent rollup jobs for repeated changes');
 await assert.rejects(pool.query(`INSERT INTO attendance_breaks(tenant_id,employee_id,time_log_id,source) VALUES($1,$2,$3,'unfiled')`,[emp.tenantId,emp.id,foreignShift.timeLogId]),(e:any)=>e.code==='23503');
 await assert.rejects(pool.query(`INSERT INTO attendance_breaks(tenant_id,employee_id,time_log_id,source,started_at,ended_at) VALUES($1,$2,$3,'unfiled',NOW(),NOW())`,[emp.tenantId,emp.id,shift.timeLogId]),(e:any)=>e.code==='23514');
 const audit=(await pool.query('SELECT DISTINCT action FROM audit_logs WHERE tenant_id=$1',[emp.tenantId])).rows.map(r=>r.action);
 for(const action of ['attendance.clock_in','attendance.clock_out','attendance.break.started','attendance.break.resumed','attendance.break.ended_on_clock_out','attendance.break.exception_resolved','attendance.policy.updated']) assert(audit.includes(action),action);
 const c=await pool.connect();const probe='attendance_rls_'+crypto.randomBytes(6).toString('hex');
 try {await c.query('BEGIN');await c.query(`CREATE ROLE ${probe} NOLOGIN`);await c.query(`GRANT SELECT,INSERT ON attendance_policies,attendance_break_policies,attendance_breaks TO ${probe}`);await c.query(`SET LOCAL ROLE ${probe}`);await c.query("SELECT set_config('app.current_tenant',$1,true)",[emp.tenantId]);assert.equal((await c.query('SELECT count(*)::int n FROM attendance_breaks WHERE tenant_id=$1',[foreign.tenantId])).rows[0].n,0);assert((await c.query('SELECT count(*)::int n FROM attendance_breaks')).rows[0].n>0);await assert.rejects(c.query('INSERT INTO attendance_policies(tenant_id) VALUES($1)',[foreign.tenantId]),(e:any)=>e.code==='42501');}finally{await c.query('ROLLBACK');c.release();}
 console.log('PASS actual non-superuser RLS read/write enforcement and composite tenant foreign keys');

} finally {

 // Remove only background jobs owned by this run before removing its database fixtures.
 const queue=getHrQueue();
 for(const job of await queue.getJobs(['wait','delayed','completed','failed'],0,-1)) if(tenants.includes(job.data?.tenantId)) await job.remove();
 await queue.close();
 // Only identifiers generated by this run are removed; existing users/shifts are untouched.
 for(const tenant of tenants)await pool.query('DELETE FROM tenants WHERE id=$1',[tenant]);
 await pool.end();await getDbPool().end();
}
