import type {PoolClient} from 'pg';
import type {RouterActor} from './openai-local-auth';
import type {RouterDataAnswer} from '../../lib/intelligent-router';
/** Read only existing authoritative records, after intent permission validation. No model receives data. */
export async function dataAnswer(c:PoolClient,actor:RouterActor,intent:string,timeZone:string):Promise<RouterDataAnswer|undefined>{
  if(['tomorrow_shift','next_shift','current_shift','shift_end_time'].includes(intent)){
    const predicates:Record<string,string>={tomorrow_shift:"(start_time AT TIME ZONE $3)::date=((now() AT TIME ZONE $3)::date+1)",next_shift:'start_time>now()',current_shift:'start_time<=now() AND end_time>now()',shift_end_time:'start_time<=now() AND end_time>now()'};
    const params= intent==='tomorrow_shift'?[actor.tenantId,actor.employeeId,timeZone]:[actor.tenantId,actor.employeeId];
    const row=(await c.query('SELECT start_time,end_time FROM roster_shifts WHERE tenant_id=$1 AND employee_id=$2 AND status=\'scheduled\' AND '+predicates[intent]+' ORDER BY start_time LIMIT 1',params)).rows[0];
    return {kind:'shift',timeZone,start:row?.start_time?.toISOString()??null,end:row?.end_time?.toISOString()??null};
  }
  if(['my_manager','my_department','my_team'].includes(intent)){
    const row=(await c.query('SELECT manager.full_name AS manager,department.name AS department,team.name AS team FROM employees employee LEFT JOIN employees manager ON manager.tenant_id=employee.tenant_id AND manager.id=employee.manager_id AND manager.is_active LEFT JOIN organisation_departments department ON department.tenant_id=employee.tenant_id AND department.id=employee.department_id LEFT JOIN organisation_teams team ON team.tenant_id=employee.tenant_id AND team.id=employee.team_id WHERE employee.tenant_id=$1 AND employee.id=$2',[actor.tenantId,actor.employeeId])).rows[0];
    return {kind:'profile',field:intent,value:row?.[intent==='my_manager'?'manager':intent==='my_team'?'team':'department']??null};
  }
  return undefined;
}
