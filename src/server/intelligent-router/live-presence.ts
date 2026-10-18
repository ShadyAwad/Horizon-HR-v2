import type {PoolClient} from 'pg';
import type {RouterActor} from './openai-local-auth';
import {hasCompanyPermission} from '../organisation/scoped-permissions';
/** Mirror Live Employees' company-scoped permission boundary; company-wide totals need company scope. */
export async function canReadLivePresence(c:PoolClient,actor:RouterActor) {
  const employee=(await c.query("SELECT role FROM employees WHERE tenant_id=$1 AND id=$2 AND is_active AND employment_status='active'",[actor.tenantId,actor.employeeId])).rows[0];
  return !!employee&&(await hasCompanyPermission(c,actor.tenantId,actor.employeeId,'attendance.view_live')).allowed&&(employee.role==='hr_admin'||(await hasCompanyPermission(c,actor.tenantId,actor.employeeId,'organisation.manage')).allowed);
}
export async function livePresenceAnswer(c:PoolClient,actor:RouterActor) {
  if(!await canReadLivePresence(c,actor))throw Error('REVIEW_DENIED');
  const row=(await c.query("SELECT count(DISTINCT e.id)::int AS total,count(DISTINCT e.id) FILTER (WHERE EXISTS(SELECT 1 FROM attendance_breaks b WHERE b.tenant_id=t.tenant_id AND b.time_log_id=t.id AND b.employee_id=e.id AND b.ended_at IS NULL))::int AS on_break FROM time_logs t JOIN employees e ON e.tenant_id=t.tenant_id AND e.id=t.employee_id WHERE t.tenant_id=$1 AND t.clock_out_time IS NULL AND e.is_active AND e.employment_status='active'",[actor.tenantId])).rows[0];
  return {kind:'presence' as const,total:row.total,onBreak:row.on_break};
}
