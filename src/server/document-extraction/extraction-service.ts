import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import { withTenant } from '../../lib/hr-background';
import { recordAuditEvent } from '../audit/audit-events';
import {
  createConfiguredExtractionProvider,
  type ExtractionProvider,
  type ExtractionProviderInput,
  type ProviderExtraction,
} from './extraction-provider';
import { normalizeProviderExtraction } from './extraction-normalisers';
import { PrivateExtractionStorage } from './extraction-storage';
import {
  ExtractionError,
  type ExtractionMode,
  type ExtractionResponse,
  type ExtractionStatus,
  type StructuredExtraction,
} from './extraction-types';
import { validateAndPrepareImage } from './extraction-validation';

type AuthIdentity = {
  employeeId: string;
  tenantId: string;
};

type UploadInput = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
};

type JobRow = {
  id: string;
  mode: ExtractionMode;
  status: ExtractionStatus;
  provider: string | null;
  result_json: StructuredExtraction | null;
  expires_at: Date | string;
};

const HOUR_MS = 60 * 60 * 1000;
const USER_REQUEST_LIMIT = 10;
const TENANT_REQUEST_LIMIT = 100;
const TENANT_BYTE_LIMIT = 100 * 1024 * 1024;
const TENANT_CONCURRENT_LIMIT = 4;
const PROVIDER_TIMEOUT_MS = 20_000;

function safeRetentionHours(value: string | undefined) {
  const parsed = Number(value || 4);
  return Number.isFinite(parsed) ? Math.min(24, Math.max(1, parsed)) : 4;
}

function toResponse(row: JobRow): ExtractionResponse {
  return {
    extractionId: row.id,
    mode: row.mode,
    status: row.status,
    fields: row.result_json?.fields || null,
    warnings: row.result_json?.warnings || [],
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}

function providerFailure(error: unknown) {
  if (error instanceof ExtractionError) return error;
  return new ExtractionError('EXTRACTION_FAILED', 'The document could not be extracted.', 502);
}

async function enforceLimits(
  client: PoolClient,
  identity: AuthIdentity,
  inputSizeBytes: number,
) {
  // Serialize tenant extraction admission so concurrent requests cannot race
  // past byte, request, or processing-job limits.
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
    [`document-extraction:${identity.tenantId}`],
  );
  const result = await client.query(
    `SELECT
       COUNT(*) FILTER (WHERE requested_by_employee_id=$2 AND created_at > NOW() - INTERVAL '1 hour')::integer AS user_requests,
       COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour')::integer AS tenant_requests,
       COALESCE(SUM(input_size_bytes) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour'), 0)::bigint AS tenant_bytes,
       COUNT(*) FILTER (WHERE status IN ('pending','processing'))::integer AS concurrent_jobs
     FROM document_extraction_jobs
     WHERE tenant_id=$1`,
    [identity.tenantId, identity.employeeId],
  );
  const usage = result.rows[0];
  if (
    usage.user_requests >= USER_REQUEST_LIMIT
    || usage.tenant_requests >= TENANT_REQUEST_LIMIT
    || Number(usage.tenant_bytes) + inputSizeBytes > TENANT_BYTE_LIMIT
    || usage.concurrent_jobs >= TENANT_CONCURRENT_LIMIT
  ) {
    throw new ExtractionError('RATE_LIMITED', 'Document extraction capacity has been reached. Please try again later.', 429);
  }
}

export function extractWithTimeout(
  provider: ExtractionProvider,
  input: ExtractionProviderInput,
  timeoutMs = PROVIDER_TIMEOUT_MS,
): Promise<ProviderExtraction> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new ExtractionError('EXTRACTION_TIMEOUT', 'Document extraction timed out.', 504)),
      timeoutMs,
    );
    provider.extract(input).then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export class DocumentExtractionService {
  private readonly retentionHours: number;

  constructor(
    private readonly provider: ExtractionProvider = createConfiguredExtractionProvider(),
    private readonly storage = new PrivateExtractionStorage(),
    retentionHours = safeRetentionHours(process.env.DOCUMENT_EXTRACTION_RETENTION_HOURS),
  ) {
    this.retentionHours = Math.min(24, Math.max(1, retentionHours));
  }

  async create(identity: AuthIdentity, mode: ExtractionMode, file: UploadInput) {
    const prepared = await validateAndPrepareImage(file);
    const contentHash = crypto.createHash('sha256').update(file.buffer).digest('hex');
    await this.storage.cleanupExpired();
    const storageKey = await this.storage.write(prepared.buffer);
    let job: JobRow | null = null;

    try {
      job = await withTenant(identity.tenantId, async (client) => {
        await client.query(
          `UPDATE document_extraction_jobs
           SET status='expired',result_json=NULL,storage_key=NULL,updated_at=NOW()
           WHERE tenant_id=$1 AND expires_at<=NOW() AND status IN ('pending','processing','completed','failed')`,
          [identity.tenantId],
        );
        const duplicate = (await client.query<JobRow>(
          `SELECT id,mode,status,provider,result_json,expires_at
           FROM document_extraction_jobs
           WHERE tenant_id=$1 AND requested_by_employee_id=$2 AND mode=$3
             AND input_sha256=$4 AND status='completed' AND expires_at>NOW()
           ORDER BY created_at DESC LIMIT 1`,
          [identity.tenantId, identity.employeeId, mode, contentHash],
        )).rows[0];
        if (duplicate) return duplicate;
        const processingDuplicate = await client.query(
          `SELECT 1 FROM document_extraction_jobs
           WHERE tenant_id=$1 AND requested_by_employee_id=$2 AND mode=$3
             AND input_sha256=$4 AND status IN ('pending','processing') LIMIT 1`,
          [identity.tenantId, identity.employeeId, mode, contentHash],
        );
        if (processingDuplicate.rowCount) {
          throw new ExtractionError('DUPLICATE_EXTRACTION', 'This document is already being processed.', 409);
        }
        await enforceLimits(client, identity, file.size);
        const created = (await client.query<JobRow>(
          `INSERT INTO document_extraction_jobs (
             tenant_id,requested_by_employee_id,mode,status,provider,storage_key,
             input_mime_type,input_size_bytes,input_sha256,expires_at
           ) VALUES ($1,$2,$3,'processing',$4,$5,$6,$7,$8,NOW()+($9::text || ' hours')::interval)
           RETURNING id,mode,status,provider,result_json,expires_at`,
          [
            identity.tenantId,
            identity.employeeId,
            mode,
            this.provider.id,
            storageKey,
            prepared.mimeType,
            file.size,
            contentHash,
            this.retentionHours,
          ],
        )).rows[0];
        await recordAuditEvent(client, {
          tenantId: identity.tenantId,
          actorId: identity.employeeId,
          action: 'document_extraction.requested',
          targetType: 'document_extraction_job',
          targetId: created.id,
          metadata: {
            extractionId: created.id,
            mode,
            inputMimeType: prepared.mimeType,
            inputSizeBytes: file.size,
            provider: this.provider.id,
            status: 'processing',
          },
        });
        return created;
      });

      if (job.status === 'completed') return toResponse(job);
      const privateBuffer = await this.storage.read(storageKey);
      const providerResult = await extractWithTimeout(
        this.provider,
        { mode, mimeType: prepared.mimeType, buffer: privateBuffer },
      );
      const structured = normalizeProviderExtraction(mode, providerResult);
      job = await withTenant(identity.tenantId, async (client) => {
        const updated = (await client.query<JobRow>(
          `UPDATE document_extraction_jobs
           SET status='completed',result_json=$4::jsonb,storage_key=NULL,error_code=NULL,
               completed_at=NOW(),updated_at=NOW()
           WHERE tenant_id=$1 AND id=$2 AND requested_by_employee_id=$3 AND status='processing'
           RETURNING id,mode,status,provider,result_json,expires_at`,
          [identity.tenantId, job!.id, identity.employeeId, JSON.stringify(structured)],
        )).rows[0];
        if (!updated) throw new ExtractionError('EXTRACTION_FAILED', 'The extraction job changed before completion.', 409);
        await recordAuditEvent(client, {
          tenantId: identity.tenantId,
          actorId: identity.employeeId,
          action: 'document_extraction.completed',
          targetType: 'document_extraction_job',
          targetId: updated.id,
          metadata: {
            extractionId: updated.id,
            mode,
            provider: this.provider.id,
            status: 'completed',
            fieldNames: Object.entries(structured.fields).filter(([, value]) => value.value !== null).map(([key]) => key),
            warningCount: structured.warnings.length,
          },
        });
        return updated;
      });
      return toResponse(job);
    } catch (error) {
      const failure = providerFailure(error);
      if (job && job.status !== 'completed') {
        await withTenant(identity.tenantId, async (client) => {
          await client.query(
            `UPDATE document_extraction_jobs
             SET status='failed',result_json=NULL,storage_key=NULL,error_code=$4,updated_at=NOW()
             WHERE tenant_id=$1 AND id=$2 AND requested_by_employee_id=$3 AND status IN ('pending','processing')`,
            [identity.tenantId, job!.id, identity.employeeId, failure.code],
          );
          await recordAuditEvent(client, {
            tenantId: identity.tenantId,
            actorId: identity.employeeId,
            action: 'document_extraction.failed',
            targetType: 'document_extraction_job',
            targetId: job!.id,
            metadata: {
              extractionId: job!.id,
              mode,
              provider: this.provider.id,
              status: 'failed',
            },
          });
        }).catch(() => undefined);
      }
      throw failure;
    } finally {
      await this.storage.remove(storageKey).catch(() => undefined);
    }
  }

  async getOwn(identity: AuthIdentity, extractionId: string) {
    return withTenant(identity.tenantId, async (client) => {
      const row = (await client.query<JobRow>(
        `SELECT id,mode,status,provider,result_json,expires_at
         FROM document_extraction_jobs
         WHERE tenant_id=$1 AND id=$2 AND requested_by_employee_id=$3`,
        [identity.tenantId, extractionId, identity.employeeId],
      )).rows[0];
      if (!row || ['deleted', 'expired'].includes(row.status)) {
        throw new ExtractionError('EXTRACTION_NOT_FOUND', 'Document extraction not found.', 404);
      }
      if (new Date(row.expires_at).valueOf() <= Date.now()) {
        await client.query(
          `UPDATE document_extraction_jobs SET status='expired',result_json=NULL,storage_key=NULL,updated_at=NOW()
           WHERE tenant_id=$1 AND id=$2`,
          [identity.tenantId, extractionId],
        );
        throw new ExtractionError('EXTRACTION_EXPIRED', 'Document extraction has expired.', 404);
      }
      return toResponse(row);
    });
  }

  async deleteOwn(identity: AuthIdentity, extractionId: string) {
    return withTenant(identity.tenantId, async (client) => {
      const row = (await client.query<JobRow>(
        `UPDATE document_extraction_jobs
         SET status='deleted',result_json=NULL,storage_key=NULL,updated_at=NOW()
         WHERE tenant_id=$1 AND id=$2 AND requested_by_employee_id=$3
           AND status NOT IN ('deleted','expired')
         RETURNING id,mode,status,provider,result_json,expires_at`,
        [identity.tenantId, extractionId, identity.employeeId],
      )).rows[0];
      if (!row) throw new ExtractionError('EXTRACTION_NOT_FOUND', 'Document extraction not found.', 404);
      await recordAuditEvent(client, {
        tenantId: identity.tenantId,
        actorId: identity.employeeId,
        action: 'document_extraction.deleted',
        targetType: 'document_extraction_job',
        targetId: row.id,
        metadata: {
          extractionId: row.id,
          mode: row.mode,
          provider: row.provider || 'unknown',
          status: 'deleted',
        },
      });
      return { success: true };
    });
  }
}
