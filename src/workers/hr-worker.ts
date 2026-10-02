import { cleanupSessions } from '../lib/session-maintenance';
import { dispatchPendingBackground, completeBackground } from '../lib/durable-background';
import { validateProductionConfig } from '../lib/production-config';
import { installShutdown } from '../lib/runtime-lifecycle';
import { closeHrResources } from '../lib/hr-background';
import { closeCommunicationsQueue } from '../server/communications/communications-queue';
import { logServerError } from '../lib/server-logging';
import 'dotenv/config';
import { startCommunicationsWorker } from '../server/communications/communications-queue';
import { rollupAttendanceDailySummary } from '../server/attendance/attendance-rollup';
import { Worker, Job } from 'bullmq';
import { HR_QUEUE_NAME, redisConnection, redisConnectionLabel, withTenant, type AttendanceRollupJobData, type AuditLogJobData, type QrExpiryCleanupJobData, } from '../lib/hr-background';
import { QrTokenService } from '../server/qr/qr-token-service';
validateProductionConfig();
console.log(`[Worker Engine] Initializing connection to Redis at ${redisConnectionLabel}...`);
async function writeAuditLog(data: AuditLogJobData & {
    dispatchId?: string;
}) {
    await withTenant(data.tenantId, async (client) => {
        if (data.dispatchId) {
            const dispatch = (await client.query("SELECT processed_at FROM outbox_events WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [data.tenantId, data.dispatchId])).rows[0];
            if (!dispatch || dispatch.processed_at)
                return;
            await client.query('UPDATE outbox_events SET processed_at=now() WHERE tenant_id=$1 AND id=$2', [data.tenantId, data.dispatchId]);
        }
        await client.query(`
        INSERT INTO audit_logs (
          tenant_id,
          actor_employee_id,
          action,
          entity_type,
          entity_id,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      `, [
            data.tenantId,
            data.actorEmployeeId ?? null,
            data.action,
            data.entityType,
            data.entityId ?? null,
            JSON.stringify(data.metadata ?? {}),
        ]);
    });
}
const hrWorker = new Worker(HR_QUEUE_NAME, async (job: Job) => {
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
    await completeBackground(job.data.tenantId, job.data.dispatchId);
}, {
    connection: redisConnection,
});
hrWorker.on('error', error => logServerError('hr_worker_error', error));
hrWorker.on('ready', () => console.log('[Worker Engine] Redis connection ready.'));
hrWorker.on('completed', (job) => {
    console.info(JSON.stringify({ level: 'info', operation: 'job_completed', jobId: job.id, jobType: job.name, requestId: job.data.requestId }));
});
hrWorker.on('failed', (job, err) => {
    console.error(JSON.stringify({ level: 'error', operation: 'job_failed', jobId: job?.id, jobType: job?.name, requestId: job?.data.requestId, code: 'JOB_FAILED' }));
});
const communicationsWorker = startCommunicationsWorker();
const activeJobs = new Set<string>();
for (const worker of [hrWorker, communicationsWorker]) {
    worker.on('active', job => activeJobs.add(worker.name + '-' + job.id));
    worker.on('completed', job => activeJobs.delete(worker.name + '-' + job.id));
    worker.on('failed', job => { if (job)
        activeJobs.delete(worker.name + '-' + job.id); });
}
let dispatching: Promise<void> | undefined;
const dispatch = () => { if (!dispatching)
    dispatching = dispatchPendingBackground().catch(error => logServerError('background_recovery', error)).finally(() => { dispatching = undefined; }); };
const recoveryTimer = setInterval(dispatch, 5000);
dispatch();
let maintenance: Promise<void> | undefined;
const maintain = () => { if (!maintenance)
    maintenance = cleanupSessions().catch(error => logServerError('session_cleanup', error)).finally(() => { maintenance = undefined; }); };
const maintenanceTimer = setInterval(maintain, 3600000);
maintain();
installShutdown(async () => {
    clearInterval(recoveryTimer);
    clearInterval(maintenanceTimer);
    await maintenance;
    await dispatching;
    await Promise.all([hrWorker.pause(true), communicationsWorker.pause(true)]);
    const deadline = Date.now() + 8000;
    while (activeJobs.size && Date.now() < deadline)
        await new Promise(resolve => setTimeout(resolve, 50));
    await Promise.all([hrWorker.close(true), communicationsWorker.close(true)]);
    await closeCommunicationsQueue();
    await closeHrResources();
});
