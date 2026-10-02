import 'dotenv/config';
import { startCommunicationsWorker } from '../server/communications/communications-queue';
import { rollupAttendanceDailySummary } from '../server/attendance/attendance-rollup';
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
    
    switch (job.name) {
      case 'rollupAttendanceDailySummary':
        await rollupAttendanceDailySummary(job.data as AttendanceRollupJobData);
        break;
        
      case 'writeAuditLog':
        await writeAuditLog(job.data as AuditLogJobData);
        break;

      case 'expireQrAccessToken': {
        const data = job.data as QrExpiryCleanupJobData;
        await new QrTokenService().expireToken(data.tenantId, data.tokenRecordId);
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

hrWorker.on('ready', () => console.log('[Worker Engine] Redis connection ready.'));

hrWorker.on('completed', (job) => {
  console.log(`[Worker Engine] Job ${job.id} completed successfully.`);
});

hrWorker.on('failed', (job, err) => {
  console.error(`[Worker Engine] Job ${job?.id} failed with error:`, err.message);
});

const communicationsWorker = startCommunicationsWorker();
let shuttingDown=false;
async function shutdownWorkers(){if(shuttingDown)return;shuttingDown=true;try{await Promise.all([hrWorker.close(),communicationsWorker.close()]);process.exit(0);}catch{console.error('[Worker Engine] Shutdown failed.');process.exit(1);}}
process.once('SIGTERM',()=>{void shutdownWorkers();});
process.once('SIGINT',()=>{void shutdownWorkers();});
