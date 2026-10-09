import type {PoolClient} from 'pg';
import {attendanceError} from './attendance-policy';
import type {PlannedBreak} from '../../lib/roster-breaks';
export function assertAttendanceIdentity(body:any, u:{tenantId:string;employeeId:string}) {
 if ((body?.tenantId && body.tenantId!==u.tenantId)||(body?.employeeId&&body.employeeId!==u.employeeId)) throw attendanceError(403,'Attendance actions are for your own account only.');
}
export function attendanceNote(value:unknown) {
 if(value===undefined||value===null||value==='')return null;
 if(typeof value!=='string'||value.length>500)throw attendanceError(400,'Use a note of up to 500 characters.');
 return value.trim()||null;
}
export async function bindAttendanceSchedule(c:PoolClient, tenantId:string, employeeId:string, log:any) {
 if(!log)return null;
 // Bind once to the published shift containing the original clock-in, including overnight shifts.
 if(!log.roster_shift_id) {
  const roster=(await c.query(`SELECT id,end_time,planned_breaks FROM roster_shifts WHERE tenant_id=$1 AND employee_id=$2 AND status='scheduled' AND start_time<=$3 AND end_time>$3 ORDER BY start_time DESC LIMIT 1`,[tenantId,employeeId,log.clock_in_time])).rows[0];
  if(roster){await c.query('UPDATE time_logs SET roster_shift_id=$3,scheduled_end_time=$4,scheduled_breaks=$5::jsonb WHERE tenant_id=$1 AND id=$2 AND roster_shift_id IS NULL',[tenantId,log.id,roster.id,roster.end_time,JSON.stringify(roster.planned_breaks)]);Object.assign(log,{roster_shift_id:roster.id,scheduled_end_time:roster.end_time,scheduled_breaks:roster.planned_breaks});}
 }
 return log;
}
export async function attendanceState(c:PoolClient,tenantId:string,employeeId:string,log:any) {
 const now:Date=(await c.query('SELECT clock_timestamp() AS now')).rows[0].now;
 await bindAttendanceSchedule(c,tenantId,employeeId,log);
 const request=log?(await c.query(`SELECT * FROM attendance_early_leave_requests WHERE tenant_id=$1 AND time_log_id=$2 ORDER BY created_at DESC LIMIT 1`,[tenantId,log.id])).rows[0]||null:null;
 const approved=request?.status==='approved'?request.requested_departure_time:null;
 const effectiveEnd=approved||log?.scheduled_end_time||null;
 const breaks=log?(await c.query('SELECT * FROM attendance_breaks WHERE tenant_id=$1 AND time_log_id=$2 ORDER BY started_at',[tenantId,log.id])).rows:[];
 const activeBreak=breaks.find(b=>!b.ended_at)||null;
 const plannedBreaks: Array<PlannedBreak & {state:string}>=(log?.scheduled_breaks||[]).map((b:PlannedBreak)=>{
  const recorded=breaks.find(r=>r.planned_start_time && new Date(r.planned_start_time).getTime()===Date.parse(b.startTime));
  const state=recorded?(recorded.ended_at?'completed':'active'):effectiveEnd&&Date.parse(b.startTime)>=new Date(effectiveEnd).getTime()?'outside_authorized_shift':now.getTime()<Date.parse(b.startTime)?'upcoming':now.getTime()>=Math.min(Date.parse(b.endTime),effectiveEnd?new Date(effectiveEnd).getTime():Infinity)?'missed':'due';
  return {...b,state};
 });
 const boundary=[effectiveEnd,...plannedBreaks.filter(b=>b.state==='upcoming'||b.state==='due').flatMap(b=>[b.startTime,b.endTime])].filter(Boolean).map(v=>new Date(v).getTime()).filter(t=>t>now.getTime()).sort((a,b)=>a-b)[0];
 return {serverNow:now,timeLogId:log?.id||null,scheduledEnd:log?.scheduled_end_time||null,effectiveEnd,approvedDeparture:approved,earlyLeaveRequest:request,activeBreak,plannedBreaks,nextChangeAt:boundary?new Date(boundary):null,remainingSeconds:effectiveEnd?Math.max(0,Math.ceil((new Date(effectiveEnd).getTime()-now.getTime())/1000)):0};
}
export function validateDeparture(value:unknown, state:{serverNow:Date;scheduledEnd:any;effectiveEnd:any}, clockIn:Date) {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))throw attendanceError(400,'Choose a valid departure time.');
 const departure=new Date(value);
 if(!state.scheduledEnd||departure.getTime()<state.serverNow.getTime()-60000||departure<=clockIn||departure>=new Date(state.effectiveEnd))throw attendanceError(409,'Choose a departure from now until your authorized shift end.');
 return {departure,earlySeconds:Math.ceil((new Date(state.scheduledEnd).getTime()-departure.getTime())/1000)};
}
