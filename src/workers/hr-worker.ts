import 'dotenv/config';
import { Worker, Job } from 'bullmq';
import {
  HR_QUEUE_NAME,
  redisConnection,
  withTenant,
  type AttendanceRollupJobData,
  type AuditLogJobData,
} from '../lib/hr-background';

console.log(
  `[Worker Engine] Initializing connection to Redis at ${redisConnection.host}:${redisConnection.port}...`,
);

async function rollupAttendanceDailySummary(data: AttendanceRollupJobData) {
  await withTenant(data.tenantId, async (client) => {
    const result = await client.query(
      `
        INSERT INTO attendance_daily_summaries (
          tenant_id,
          employee_id,
          work_date,
          first_clock_in,
          last_clock_out,
          total_minutes,
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
          COALESCE(
            SUM(
              CASE
                WHEN clock_out_time IS NULL THEN 0
                ELSE FLOOR(EXTRACT(EPOCH FROM (clock_out_time - clock_in_time)) / 60)::int
              END
            ),
            0
          ) AS total_minutes,
          COUNT(*) FILTER (WHERE is_valid_geofence = false)::int AS invalid_geofence_count,
          NOW() AS generated_at,
          NOW() AS updated_at
        FROM time_logs
        WHERE tenant_id = $1
          AND employee_id = $2
          AND clock_in_time >= $3::date
          AND clock_in_time < ($3::date + INTERVAL '1 day')
        GROUP BY tenant_id, employee_id
        ON CONFLICT (tenant_id, employee_id, work_date)
        DO UPDATE SET
          first_clock_in = EXCLUDED.first_clock_in,
          last_clock_out = EXCLUDED.last_clock_out,
          total_minutes = EXCLUDED.total_minutes,
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

async function writeAuditLog(data: AuditLogJobData) {
  await withTenant(data.tenantId, async (client) => {
    await client.query(
      `
        INSERT INTO audit_logs (
          tenant_id,
          actor_employee_id,
          action,
          entity_type,
          entity_id,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      `,
      [
        data.tenantId,
        data.actorEmployeeId ?? null,
        data.action,
        data.entityType,
        data.entityId ?? null,
        JSON.stringify(data.metadata ?? {}),
      ],
    );
  });
}

const hrWorker = new Worker(
  HR_QUEUE_NAME,
  async (job: Job) => {
    console.log(`[Worker Engine] Processing background job: ${job.name} (ID: ${job.id})`);
    
    switch (job.name) {
      case 'rollupAttendanceDailySummary':
        await rollupAttendanceDailySummary(job.data as AttendanceRollupJobData);
        console.log(
          `[Attendance] Rolled up daily summary for tenant=${job.data.tenantId}, employee=${job.data.employeeId}, date=${job.data.workDate}`,
        );
        break;
        
      case 'writeAuditLog':
        await writeAuditLog(job.data as AuditLogJobData);
        console.log(`[Audit] Wrote ${job.data.action} audit log for tenant=${job.data.tenantId}`);
        break;
        
      default:
        throw new Error(`Unknown job type: ${job.name}`);
    }
  },
  {
    connection: redisConnection,
  }
);

hrWorker.on('completed', (job) => {
  console.log(`[Worker Engine] Job ${job.id} completed successfully.`);
});

hrWorker.on('failed', (job, err) => {
  console.error(`[Worker Engine] Job ${job?.id} failed with error:`, err.message);
});
