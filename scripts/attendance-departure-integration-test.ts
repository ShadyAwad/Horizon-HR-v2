import './router-env';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import {getMigrationPool} from './migration-pool';
import { assertDatabaseMutationSafety, assertHttpMutationSafety } from './mutation-safety';
import { rollupAttendanceDailySummary } from '../src/server/attendance/attendance-rollup';
import { getDbPool, getHrQueue, enqueueAttendanceRollup } from '../src/lib/hr-background';
const base=assertHttpMutationSafety(process.env.ATTENDANCE_TEST_BASE_URL||'http://localhost:3001','Attendance integration');
assertDatabaseMutationSafety(process.env.DATABASE_URL,'Attendance integration');
const pool=getMigrationPool();
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
 for(let i=0;i<2;i++)tenants.push((await pool.query('INSERT INTO tenants(slug,company_name) VALUES($1,$2) RETURNING id',[`departure-test-${tag}-${i}`,'Departure fixture'])).rows[0].id);
 const admin=await person(tenants[0],'admin',['attendance.clock','attendance.view','attendance.early_leave.review'],'company');
 const manager=await person(tenants[0],'manager',['attendance.view','attendance.early_leave.review'],'direct_reports');
 const emp=await person(tenants[0],'employee',['attendance.clock','break_requests.create','break_requests.view_own'],'self',manager);
 const outsider=await person(tenants[0],'outsider',['attendance.clock'],'self');
 const foreign=await person(tenants[1],'foreign',['attendance.clock','attendance.early_leave.review'],'company');
 for(const tenant of tenants)await pool.query(`INSERT INTO company_locations(tenant_id,name,latitude,longitude,boundary) VALUES($1,'Test site',30,31,ST_Buffer(ST_SetSRID(ST_MakePoint(31,30),4326)::geography,1000)::geometry)`,[tenant]);
 assert.equal((await call(emp,'/api/clock-in',{})).status,400);
 assert.equal((await call(emp,'/api/clock-in',{latitude:0,longitude:0})).status,403);
 assert.equal((await call(emp,'/api/clock-in',{latitude:30,longitude:31,employeeId:outsider.id})).status,403);
 const geo=await ok(emp,'/api/clock-in',{latitude:30,longitude:31});
 assert.equal((await pool.query('SELECT attendance_method FROM time_logs WHERE id=$1',[geo.timeLogId])).rows[0].attendance_method,'geofenced');
 await ok(emp,'/api/clock-out',{});
 console.log('PASS unchanged real PostGIS geofence acceptance/rejection and self-only mutation');
 const now=Date.now(),end=new Date(now+2*3600000),due={startTime:new Date(now-60000).toISOString(),endTime:new Date(now+300000).toISOString()},upcoming={startTime:new Date(now+900000).toISOString(),endTime:new Date(now+1200000).toISOString()};
 await pool.query(`INSERT INTO roster_shifts(tenant_id,employee_id,created_by,start_time,end_time,planned_breaks) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,[emp.tenantId,emp.id,admin.id,new Date(now-3600000),end,JSON.stringify([due,upcoming])]);
 assert.equal((await call(emp,'/api/attendance/clock-in-without-location',{})).status,400);
 assert.equal((await call(emp,'/api/attendance/clock-in-without-location',{confirm:true,latitude:30})).status,400);
 assert.equal((await call(emp,'/api/attendance/clock-in-without-location',{confirm:true,employeeId:outsider.id})).status,403);
 const shift=await ok(emp,'/api/attendance/clock-in-without-location',{confirm:true,note:'Travel location privacy'});
 assert.equal((await call(emp,'/api/attendance/clock-in-without-location',{confirm:true})).status,409);
 const stored=(await pool.query('SELECT * FROM time_logs WHERE id=$1',[shift.timeLogId])).rows[0];assert.equal(stored.clock_in_location,null);assert.equal(stored.is_valid_geofence,false);assert.equal(stored.attendance_method,'no_location');assert.equal(stored.clock_in_note,'Travel location privacy');
 let state=(await ok(emp,'/api/clock-status')).attendance;assert.equal(state.plannedBreaks[0].state,'due');assert.equal(state.plannedBreaks[1].state,'upcoming');
 assert.equal((await call(emp,'/api/attendance/breaks/start',{plannedStartTime:upcoming.startTime})).status,409);
 await ok(emp,'/api/attendance/breaks/start',{plannedStartTime:due.startTime});assert((await ok(emp,'/api/clock-status')).attendance.activeBreak);
 const warning=await call(emp,'/api/clock-out',{timeLogId:shift.timeLogId});assert.equal(warning.status,409);assert.equal(warning.body.code,'early_clock_out_confirmation');assert(warning.body.attendance.remainingSeconds>7100);assert((await ok(emp,'/api/clock-status')).attendance.activeBreak,'Warning does not close break');
 console.log('PASS explicit no-location method, audit-safe coordinates, planned break due/start and early warning without mutation');
 const departure=new Date(Date.now()+1800000).toISOString();
 const preview=await ok(emp,'/api/attendance/early-leave/preview',{timeLogId:shift.timeLogId,departureTime:departure});assert(preview.earlySeconds>5300);
 assert.equal((await call(emp,'/api/attendance/early-leave',{timeLogId:crypto.randomUUID(),departureTime:departure})).status,409);
 assert.equal((await call(emp,'/api/attendance/early-leave',{timeLogId:shift.timeLogId,departureTime:departure,reason:'x'.repeat(501)})).status,400);
 const pending=await ok(emp,'/api/attendance/early-leave',{timeLogId:shift.timeLogId,departureTime:departure});assert.equal((await ok(emp,'/api/clock-status')).isClockedIn,true);
 assert.equal((await call(emp,'/api/attendance/early-leave',{timeLogId:shift.timeLogId,departureTime:departure})).status,409);
 assert.equal((await call(emp,`/api/attendance/early-leave/${pending.request.id}/review`,{status:'approved'},'PATCH')).status,403,'Self approval is forbidden');
 assert.equal((await call(outsider,`/api/attendance/early-leave/${pending.request.id}/review`,{status:'approved'},'PATCH')).status,403);
 assert.equal((await call(foreign,`/api/attendance/early-leave/${pending.request.id}/review`,{status:'approved'},'PATCH')).status,404);
 assert((await ok(manager,'/api/attendance/early-leave')).requests.some((r:any)=>r.id===pending.request.id&&r.canReview));
 await ok(manager,`/api/attendance/early-leave/${pending.request.id}/review`,{status:'rejected',reviewNote:'Please choose another time'},'PATCH');
 assert.equal((await call(manager,`/api/attendance/early-leave/${pending.request.id}/review`,{status:'approved'},'PATCH')).status,409);
 const second=await ok(emp,'/api/attendance/early-leave',{timeLogId:shift.timeLogId,departureTime:departure,reason:'Appointment'});
 await ok(manager,`/api/attendance/early-leave/${second.request.id}/review`,{status:'approved'},'PATCH');
 state=(await ok(emp,'/api/clock-status')).attendance;assert.equal(new Date(state.effectiveEnd).toISOString(),departure);assert.equal(new Date(state.scheduledEnd).toISOString(),end.toISOString());
 await ok(emp,'/api/attendance/breaks/resume',{});
 assert.equal((await call(emp,'/api/attendance/breaks/start',{plannedStartTime:due.startTime})).status,409,'Completed planned break cannot be reused');
 // Owned fixture schedule advances without modifying server time or another employee.
 const pastBreak={startTime:new Date(Date.now()-30000).toISOString(),endTime:new Date(Date.now()+120000).toISOString()};
 await pool.query('UPDATE time_logs SET scheduled_breaks=$2::jsonb WHERE id=$1',[shift.timeLogId,JSON.stringify([due,pastBreak])]);
 await ok(emp,'/api/attendance/breaks/start',{plannedStartTime:pastBreak.startTime});
 assert.equal((await ok(emp,'/api/clock-status')).attendance.plannedBreaks.filter((b:any)=>b.state==='active').length,1);
 assert.equal((await call(emp,'/api/clock-out',{timeLogId:crypto.randomUUID(),confirmEarly:true})).status,409);
 await ok(emp,'/api/clock-out',{timeLogId:shift.timeLogId,confirmEarly:true,note:'Early appointment departure'});
 const closed=(await pool.query('SELECT * FROM time_logs WHERE id=$1',[shift.timeLogId])).rows[0];assert(closed.early_departure_seconds>7100);assert.equal(closed.early_departure_note,'Early appointment departure');
 assert.equal((await pool.query('SELECT count(*)::int n FROM attendance_breaks WHERE time_log_id=$1 AND ended_at IS NULL',[shift.timeLogId])).rows[0].n,0);
 const history=await ok(manager,'/api/attendance/history');assert(history.logs.some((l:any)=>l.early_departure_note==='Early appointment departure'&&l.attendance_method.includes('no_location')));
 console.log('PASS request while on break, scoped approve/reject, duplicate/stale guards, multiple planned breaks, early note and safe active-break closure');
 const next=await ok(emp,'/api/attendance/clock-in-without-location',{confirm:true});
 await pool.query("UPDATE time_logs SET clock_in_time=clock_in_time-INTERVAL '1 hour' WHERE id=$1",[next.timeLogId]);
 const nearPast=new Date(Date.now()-10000).toISOString();
 const approved=await ok(emp,'/api/attendance/early-leave',{timeLogId:next.timeLogId,departureTime:nearPast});await ok(manager,`/api/attendance/early-leave/${approved.request.id}/review`,{status:'approved'},'PATCH');
 state=(await ok(emp,'/api/clock-status')).attendance;assert.equal(state.remainingSeconds,0);assert(state.plannedBreaks.every((b:any)=>b.state==='outside_authorized_shift'||b.state==='missed'));
 await ok(emp,'/api/clock-out',{});assert.equal((await pool.query('SELECT early_departure_note FROM time_logs WHERE id=$1',[next.timeLogId])).rows[0].early_departure_note,null);
 assert.equal((await call(emp,'/api/clock-out',{})).status,404);
 const ordinary=await ok(outsider,'/api/attendance/clock-in-without-location',{confirm:true});await pool.query("UPDATE time_logs SET scheduled_end_time=clock_timestamp()-INTERVAL '1 second' WHERE id=$1",[ordinary.timeLogId]);await ok(outsider,'/api/clock-out',{});
 // Real PostgreSQL overnight schedule binding uses timestamps, never browser date arithmetic.
 const day=new Date();day.setUTCHours(0,0,0,0);const overnightStart=new Date(day.getTime()-3600000),overnightEnd=new Date(day.getTime()+7*3600000),overnightIn=new Date(day.getTime()-1800000);
 await pool.query(`INSERT INTO roster_shifts(tenant_id,employee_id,created_by,start_time,end_time,planned_breaks) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,[outsider.tenantId,outsider.id,admin.id,overnightStart,overnightEnd,JSON.stringify([{startTime:new Date(day.getTime()+3600000).toISOString(),endTime:new Date(day.getTime()+4500000).toISOString()}])]);
 const overnight=(await pool.query(`INSERT INTO time_logs(tenant_id,employee_id,clock_in_time,is_valid_geofence,attendance_method,location_status) VALUES($1,$2,$3,false,'no_location','unavailable') RETURNING id`,[outsider.tenantId,outsider.id,overnightIn])).rows[0];
 const overnightState=(await ok(outsider,'/api/clock-status')).attendance;assert.equal(new Date(overnightState.scheduledEnd).toISOString(),overnightEnd.toISOString());assert.equal(overnightState.plannedBreaks.length,1);
 await ok(outsider,'/api/clock-out',{timeLogId:overnight.id,confirmEarly:true});
 console.log('PASS real overnight roster binding, planned timestamps and clock-out');
 assert.equal((await ok(foreign,'/api/attendance/early-leave')).requests.length,0);
 const c=await pool.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE stanza_runtime');await c.query("SELECT set_config('app.current_tenant',$1,true)",[foreign.tenantId]);assert.equal((await c.query('SELECT count(*)::int n FROM attendance_early_leave_requests')).rows[0].n,0);await assert.rejects(c.query(`INSERT INTO attendance_early_leave_requests(tenant_id,employee_id,time_log_id,scheduled_end_time,requested_departure_time) VALUES($1,$2,$3,$4,$5)`,[emp.tenantId,emp.id,next.timeLogId,end,nearPast]),(e:any)=>e.code==='42501');}finally{await c.query('ROLLBACK');c.release();}
 const actions=(await pool.query('SELECT DISTINCT action FROM audit_logs WHERE tenant_id=$1',[emp.tenantId])).rows.map(r=>r.action);for(const action of ['attendance.clock_in.no_location','attendance.early_leave.requested','attendance.early_leave.approved','attendance.early_leave.rejected','attendance.clock_out','attendance.break.ended_on_clock_out'])assert(actions.includes(action),action);
 console.log('PASS approved departure effective end, normal on-time clock-out, runtime-role RLS read/write isolation and durable audit');
} finally {const queue=getHrQueue();for(const job of await queue.getJobs(['wait','delayed','completed','failed'],0,-1))if(tenants.includes(job.data?.tenantId))await job.remove();await queue.close();for(const t of tenants){await pool.query('DELETE FROM tenants WHERE id=$1',[t]);}await pool.end();await getDbPool()?.end();}
