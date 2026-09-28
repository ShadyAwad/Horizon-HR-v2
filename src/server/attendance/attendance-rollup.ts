import { withTenant, type AttendanceRollupJobData } from '../../lib/hr-background';
export async function rollupAttendanceDailySummary(data: AttendanceRollupJobData) {
  await withTenant(data.tenantId, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`attendance-rollup:${data.tenantId}:${data.employeeId}:${data.workDate}`]);
    const result = await client.query(
      `
        INSERT INTO attendance_daily_summaries (
          tenant_id,
          employee_id,
          work_date,
          first_clock_in,
          last_clock_out,
          total_minutes, total_break_minutes,
          invalid_geofence_count,
          generated_at,
          updated_at
        )
        SELECT
          tenant_id,
          employee_id,
          $3::date AS work_date,
          MIN(clock_in_time) AS first_clock_in,
          MAX(clock_out_time) FILTER (WHERE clock_out_time IS NOT NULL) AS last_clock_out,
          FLOOR(COALESCE(SUM(CASE WHEN clock_out_time IS NULL THEN 0
            ELSE GREATEST(0,EXTRACT(EPOCH FROM (clock_out_time-clock_in_time))-attendance_unpaid_break_seconds(tenant_id,id,clock_out_time)) END),0)/60)::int AS total_minutes,
          FLOOR(COALESCE(SUM(attendance_break_seconds(tenant_id,id,COALESCE(clock_out_time,NOW()))),0)/60)::int AS total_break_minutes,
          COUNT(*) FILTER (WHERE location_status = 'outside')::int AS invalid_geofence_count,
          NOW() AS generated_at,
          NOW() AS updated_at
        FROM time_logs
        WHERE tenant_id = $1
          AND employee_id = $2
          AND clock_in_time >= ($3::date::timestamp AT TIME ZONE 'UTC')
          AND clock_in_time < (($3::date+1)::timestamp AT TIME ZONE 'UTC')
        GROUP BY tenant_id, employee_id
        ON CONFLICT (tenant_id, employee_id, work_date)
        DO UPDATE SET
          first_clock_in = EXCLUDED.first_clock_in,
          last_clock_out = EXCLUDED.last_clock_out,
          total_minutes = EXCLUDED.total_minutes,
          total_break_minutes = EXCLUDED.total_break_minutes,
          invalid_geofence_count = EXCLUDED.invalid_geofence_count,
          updated_at = NOW()
      `,
      [data.tenantId, data.employeeId, data.workDate],
    );

    if (result.rowCount === 0) {
      console.warn(
        `[Attendance] No time logs found for tenant=${data.tenantId}, employee=${data.employeeId}, date=${data.workDate}`,
      );
    }
  });
}

