import type { Pool } from 'pg';
import { assertRuntimeRole } from '../src/lib/database-security';

export function runtimeRoleName(value: string) {
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(value)) throw new Error('DATABASE_RUNTIME_ROLE must be a simple lowercase PostgreSQL role name.');
  return '"' + value + '"';
}
export async function grantRuntimeAccess(pool: Pool, role: string) {
  const quoted = runtimeRoleName(role), client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${quoted}`);
    await assertRuntimeRole(client);
    await client.query('RESET ROLE');
    await client.query(`GRANT CONNECT ON DATABASE "${(await client.query('SELECT current_database() AS name')).rows[0].name.replaceAll('"','""')}" TO ${quoted}`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${quoted}`);
    const tables = (await client.query(`SELECT c.relname,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')`)).rows;
    const appendOnly = new Set(['audit_logs','grievance_case_events','grievance_messages','communication_message_events',
      'expense_claim_history','hiring_stage_history','leave_request_history',
      'roster_shift_assignment_history','shift_swap_history','performance_goal_updates','router_review_history','support_ticket_events']);
    for (const table of tables) {
      const name = '"' + table.relname.replaceAll('"','""') + '"';
      if (['tenant_permissions','router_platform_authorities'].includes(table.relname)) {
        await client.query(`REVOKE ALL ON public.${name} FROM ${quoted}`);
        await client.query(`GRANT SELECT ON public.${name} TO ${quoted}`);
      } else {
        if (!table.relrowsecurity) throw new Error('Runtime grant refused: application table lacks RLS: '+table.relname);
        await client.query(`REVOKE ALL ON public.${name} FROM ${quoted}`);
        const permissions = ['tenants','hiring_applicant_notes'].includes(table.relname) ? 'SELECT,INSERT,UPDATE' : appendOnly.has(table.relname) ? 'SELECT,INSERT' : 'SELECT,INSERT,UPDATE,DELETE';
        await client.query(`GRANT ${permissions} ON public.${name} TO ${quoted}`);
      }
    }
    await client.query(`GRANT SELECT ON public.vw_employee_hierarchy TO ${quoted}`);
    // Sequence USAGE permits nextval; no setval/ownership/DDL rights.
    await client.query(`GRANT USAGE ON SEQUENCE public.communication_message_events_id_seq TO ${quoted}`);
    await client.query(`GRANT EXECUTE ON FUNCTION public.stanza_auth_tenant(text),public.stanza_session_identity(text),
      public.stanza_reset_tenant(text),public.stanza_qr_tenant(text,text),public.stanza_maintenance_tenants(uuid),
      public.attendance_break_seconds(uuid,uuid,timestamptz),public.attendance_unpaid_break_seconds(uuid,uuid,timestamptz) TO ${quoted}`);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
