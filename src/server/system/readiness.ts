import { boundedQueueOperation } from '../../lib/queue-bounds';
import Redis from 'ioredis';
import { getDbPool, getRedisConnection } from '../../lib/hr-background';
export async function checkReadiness() {
    const redis = new Redis({ ...getRedisConnection(), lazyConnect: true, connectTimeout: 2000, commandTimeout: 2000, maxRetriesPerRequest: 0, retryStrategy: () => null });
    redis.on('error', () => { });
    try {
        await Promise.all([boundedQueueOperation(getDbPool().query({ text: "SELECT (to_regclass('communication_messages') IS NOT NULL AND to_regclass('grievance_attachments') IS NOT NULL AND to_regclass('attendance_daily_summaries') IS NOT NULL AND to_regclass('auth_sessions') IS NOT NULL) AS ready" }), 2500).then(result => { if (!result.rows[0]?.ready)
                throw Error('Schema unavailable'); }), redis.connect().then(() => redis.ping())]);
        return true;
    }
    catch {
        return false;
    }
    finally {
        redis.disconnect();
    }
}
