import Redis from 'ioredis';
import 'dotenv/config';
import { Queue } from 'bullmq';
import type { RedisOptions } from 'ioredis';
import { Pool, type PoolClient } from 'pg';
export const HR_QUEUE_NAME = 'hr-queue';
export function getRedisConnection(): RedisOptions {
    const redisUrl = process.env.REDIS_URL?.trim();
    if (redisUrl) {
        let parsedUrl: URL;
        try {
            parsedUrl = new URL(redisUrl);
        }
        catch {
            throw new Error('REDIS_URL has an invalid format.');
        }
        if (parsedUrl.protocol !== 'redis:' && parsedUrl.protocol !== 'rediss:') {
            throw new Error('REDIS_URL must use the redis:// or rediss:// protocol.');
        }
        const databaseName = parsedUrl.pathname.replace(/^\//, '');
        const connection: RedisOptions = {
            host: parsedUrl.hostname,
            port: parsedUrl.port ? Number(parsedUrl.port) : 6379,
            username: parsedUrl.username ? decodeURIComponent(parsedUrl.username) : undefined,
            password: parsedUrl.password ? decodeURIComponent(parsedUrl.password) : undefined,
            db: databaseName ? Number(databaseName) : undefined,
            // Upstash and other hosted providers use rediss:// for TLS connections.
            tls: parsedUrl.protocol === 'rediss:' ? {} : undefined,
        };
        if (!Number.isInteger(connection.port) || connection.port! < 1 || connection.port! > 65535) {
            throw new Error('REDIS_URL contains an invalid port.');
        }
        if (databaseName && (!Number.isInteger(connection.db) || connection.db! < 0)) {
            throw new Error('REDIS_URL contains an invalid database number.');
        }
        return connection;
    }
    const port = Number(process.env.REDIS_PORT || 6379);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('REDIS_PORT must be a valid TCP port.');
    }
    return {
        host: process.env.REDIS_HOST?.trim() || '127.0.0.1',
        port,
    };
}
export const redisConnection = getRedisConnection();
export const redisConnectionLabel = `${redisConnection.tls ? 'rediss' : 'redis'}://${redisConnection.host}:${redisConnection.port}`;
class ProducerQueue extends Queue {
    constructor(private readonly producer: Redis) { super(HR_QUEUE_NAME, { connection: producer }); }
    async close() { this.producer.disconnect(); await super.close(); }
}
let hrQueue: Queue | undefined;
let producerRedis: Redis | undefined;
let dbPool: Pool | undefined;
function getDatabaseSsl() {
    if (process.env.DATABASE_SSL !== 'true')
        return undefined;
    const ca = process.env.DATABASE_SSL_CA?.replace(/\\n/g, '\n').trim();
    return {
        rejectUnauthorized: true,
        ...(ca ? { ca } : {}),
    };
}
export type AuditLogJobData = {
    tenantId: string;
    actorEmployeeId?: string | null;
    action: 'clock_in' | 'clock_out' | 'leave_requested' | 'leave_status_changed' | string;
    entityType: 'time_log' | 'leave_request' | string;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
};
export type AttendanceRollupJobData = {
    tenantId: string;
    employeeId: string;
    workDate: string;
};
export type QrExpiryCleanupJobData = {
    tenantId: string;
    tokenRecordId: string;
};
export function getAttendanceRollupJobId(data: AttendanceRollupJobData) {
    return `attendance-rollup-${data.tenantId}-${data.employeeId}-${data.workDate}`;
}
export function getQrExpiryCleanupJobId(data: QrExpiryCleanupJobData) {
    return `qr-expiry-${data.tokenRecordId}`;
}
export function getHrQueue() {
    if (!hrQueue) {
        producerRedis = new Redis({ ...redisConnection, connectTimeout: 3000, commandTimeout: 3000, maxRetriesPerRequest: 1, enableOfflineQueue: false });
        producerRedis.on('error', () => { });
        hrQueue = new ProducerQueue(producerRedis);
        let lastQueueError = 0;
        hrQueue.on('error', () => { if (Date.now() - lastQueueError > 30000) {
            lastQueueError = Date.now();
            console.error(JSON.stringify({ level: 'error', operation: 'hr_queue_unavailable' }));
        } });
    }
    return hrQueue;
}
export function getDbPool() {
    if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL is required for HR database operations.');
    }
    if (!dbPool) {
        dbPool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: getDatabaseSsl(),
            max: Number(process.env.DATABASE_POOL_MAX || 10),
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 3000,
            statement_timeout: 15000,
        });
        dbPool.on('error', () => console.error(JSON.stringify({ level: 'error', operation: 'postgres_pool_error' })));
    }
    return dbPool;
}
export async function withTenant<T>(tenantId: string, callback: (client: PoolClient) => Promise<T>) {
    const client = await getDbPool().connect();
    try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
}
export function hasDatabaseConfig() {
    return Boolean(process.env.DATABASE_URL);
}
export async function closeHrResources() { producerRedis?.disconnect(); await hrQueue?.close().catch(() => undefined); await dbPool?.end(); }
