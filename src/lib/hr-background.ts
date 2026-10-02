export * from './background-connections';
import { durableEnqueue } from './durable-background';
import { getQrExpiryCleanupJobId, type AttendanceRollupJobData, type AuditLogJobData, type QrExpiryCleanupJobData } from './background-connections';
export async function enqueueAttendanceRollup(data: AttendanceRollupJobData) {
  return durableEnqueue('rollupAttendanceDailySummary', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: 100,
    removeOnFail: 500,
    // Every durable event gets a new job; the worker serializes and upserts each day.
  });
}

export async function enqueueAuditLog(data: AuditLogJobData) {
  return durableEnqueue('writeAuditLog', data, {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2_000 },
    removeOnComplete: 250,
    removeOnFail: 1_000,
  });
}

export function enqueueQrExpiryCleanup(data: QrExpiryCleanupJobData, expiresAt: Date) {
  const delay = Math.max(0, expiresAt.getTime() - Date.now());
  return durableEnqueue('expireQrAccessToken', data, {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5_000 },
    delay,
    removeOnComplete: 250,
    removeOnFail: 1_000,
    jobId: getQrExpiryCleanupJobId(data),
  });
}
