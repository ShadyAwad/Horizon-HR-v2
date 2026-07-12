import { Queue } from 'bullmq';
import type { RedisOptions } from 'ioredis';
import { Pool, type PoolClient } from 'pg';


export const HR_QUEUE_NAME = 'hr-queue';

function getRedisConnection(): RedisOptions {
  const redisUrl = process.env.REDIS_URL?.trim();

  if (redisUrl) {
    const parsedUrl = new URL(redisUrl);

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

let hrQueue: Queue | undefined;
let dbPool: Pool | undefined;

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

export function getHrQueue() {
  if (!hrQueue) {
    hrQueue = new Queue(HR_QUEUE_NAME, { connection: redisConnection });
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
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });
  }

  return dbPool;
}

export async function withTenant<T>(
  tenantId: string,
  callback: (client: PoolClient) => Promise<T>,
) {
  const client = await getDbPool().connect();

  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function enqueueAttendanceRollup(data: AttendanceRollupJobData) {
  return getHrQueue().add('rollupAttendanceDailySummary', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: 100,
    removeOnFail: 500,
    jobId: `attendance-rollup:${data.tenantId}:${data.employeeId}:${data.workDate}`,
  });
}

export async function enqueueAuditLog(data: AuditLogJobData) {
  return getHrQueue().add('writeAuditLog', data, {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2_000 },
    removeOnComplete: 250,
    removeOnFail: 1_000,
  });
}

export function hasDatabaseConfig() {
  return Boolean(process.env.DATABASE_URL);
}
