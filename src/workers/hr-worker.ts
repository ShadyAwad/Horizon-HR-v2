import { rollupAttendanceDailySummary } from '../server/attendance/attendance-rollup';
import 'dotenv/config';
import { Worker, Job } from 'bullmq';
import {
  HR_QUEUE_NAME,
  redisConnection,
  redisConnectionLabel,
  withTenant,
  type AttendanceRollupJobData,
  type AuditLogJobData,
  type QrExpiryCleanupJobData,
} from '../lib/hr-background';
import { QrTokenService } from '../server/qr/qr-token-service';

console.log(
  `[Worker Engine] Initializing connection to Redis at ${redisConnectionLabel}...`,
);

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

      case 'expireQrAccessToken': {
        const data = job.data as QrExpiryCleanupJobData;
        await new QrTokenService().expireToken(data.tenantId, data.tokenRecordId);
        console.log(`[QR] Processed token expiry for tokenRecordId=${data.tokenRecordId}`);
        break;
      }
        
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
