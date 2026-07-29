import type { PoolClient } from 'pg';
import { enqueueQrExpiryCleanup, getDbPool, withTenant } from '../../lib/hr-background';
import { recordAuditEvent } from '../audit/audit-events';
import { assertQrIssuePermission, assertQrMutationPermission } from './qr-token-permissions';
import { QR_PURPOSE_CONFIG, QrTokenError, type QrTokenPresentation, type QrTokenPurpose } from './qr-token-types';
import { generateOpaqueQrToken, getCanonicalQrOrigin, hashQrToken } from './qr-token-validation';

type Identity = { tenantId: string; employeeId: string };
type IssueInput = {
  purpose: QrTokenPurpose;
  employeeId?: string | null;
  assetId?: string | null;
  expiresInMinutes?: number | null;
};

function labelFor(purpose: QrTokenPurpose) {
  if (purpose === 'employee_verification') return 'Employee verification';
  if (purpose === 'asset_lookup') return 'Asset lookup';
  return 'Onboarding invitation';
}

export class QrTokenService {
  async issue(identity: Identity, input: IssueInput): Promise<QrTokenPresentation> {
    const token = generateOpaqueQrToken();
    const tokenHash = hashQrToken(token);
    const config = QR_PURPOSE_CONFIG[input.purpose];
    const expiresAt = input.expiresInMinutes
      ? new Date(Date.now() + input.expiresInMinutes * 60_000).toISOString()
      : null;
    const origin = getCanonicalQrOrigin();

    const record = await withTenant(identity.tenantId, async (client) => {
      await assertQrIssuePermission(client, identity, input.purpose, input);
      const result = await client.query(
        `INSERT INTO qr_access_tokens (
           tenant_id,purpose,subject_type,employee_id,asset_id,token_hash,status,
           expires_at,single_use,created_by_employee_id,metadata
         ) VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8,$9,NULL)
         RETURNING id,purpose,status,expires_at AS "expiresAt"`,
        [
          identity.tenantId,
          input.purpose,
          config.subjectType,
          input.employeeId || null,
          input.assetId || null,
          tokenHash,
          expiresAt,
          config.singleUse,
          identity.employeeId,
        ],
      );
      const row = result.rows[0];
      await recordAuditEvent(client, {
        tenantId: identity.tenantId,
        actorId: identity.employeeId,
        action: 'qr.token_issued',
        targetType: 'qr_access_token',
        targetId: row.id,
        metadata: {
          tokenRecordId: row.id,
          purpose: input.purpose,
          subjectType: config.subjectType,
          issuerEmployeeId: identity.employeeId,
          status: row.status,
          expiresAt: row.expiresAt,
          singleUse: config.singleUse,
        },
      });
      return row;
    }).catch((error: unknown) => {
      if ((error as { code?: string })?.code === '23505') {
        throw new QrTokenError(409, 'QR_ACTIVE_TOKEN_EXISTS', 'An active token already exists. Rotate it instead.');
      }
      throw error;
    });

    if (record.expiresAt) {
      void enqueueQrExpiryCleanup(
        { tenantId: identity.tenantId, tokenRecordId: record.id },
        new Date(record.expiresAt),
      ).catch((error) => {
        if (process.env.NODE_ENV !== 'production') console.warn('[qr] expiry scheduling deferred', (error as Error).message);
      });
    }

    return this.presentation(record, input.purpose, token, origin);
  }

  private presentation(
    record: { id: string; expiresAt?: string | Date | null },
    purpose: QrTokenPurpose,
    token: string,
    origin = getCanonicalQrOrigin(),
  ): QrTokenPresentation {
    const config = QR_PURPOSE_CONFIG[purpose];
    return {
      tokenRecordId: record.id,
      purpose,
      encodedUrl: `${origin}${config.publicPath}/${token}`,
      label: labelFor(purpose),
      expiresAt: record.expiresAt ? new Date(record.expiresAt).toISOString() : null,
      status: 'active',
      rotatable: true,
      revocable: true,
    };
  }

  async rotate(identity: Identity, tokenRecordId: string): Promise<QrTokenPresentation> {
    const token = generateOpaqueQrToken();
    const tokenHash = hashQrToken(token);
    const origin = getCanonicalQrOrigin();
    const replacement = await withTenant(identity.tenantId, async (client) => {
      const current = (await client.query(
        `SELECT id,purpose,subject_type AS "subjectType",employee_id AS "employeeId",
                asset_id AS "assetId",status,expires_at AS "expiresAt",single_use AS "singleUse"
         FROM qr_access_tokens
         WHERE tenant_id=$1 AND id=$2
         FOR UPDATE`,
        [identity.tenantId, tokenRecordId],
      )).rows[0];
      if (!current) throw new QrTokenError(404, 'QR_TOKEN_NOT_FOUND', 'QR token is unavailable.');
      await assertQrMutationPermission(client, identity, current, 'rotate');
      if (current.status !== 'active') throw new QrTokenError(409, 'QR_TOKEN_NOT_ACTIVE', 'Only an active token can be rotated.');
      if (current.expiresAt && new Date(current.expiresAt).getTime() <= Date.now()) {
        await client.query(
          `UPDATE qr_access_tokens SET status='expired',updated_at=NOW()
           WHERE tenant_id=$1 AND id=$2 AND status='active'`,
          [identity.tenantId, tokenRecordId],
        );
        throw new QrTokenError(409, 'QR_TOKEN_NOT_ACTIVE', 'Only an active token can be rotated.');
      }
      await client.query(
        `UPDATE qr_access_tokens
         SET status='revoked',revoked_at=NOW(),revoked_by_employee_id=$3,updated_at=NOW()
         WHERE tenant_id=$1 AND id=$2 AND status='active'`,
        [identity.tenantId, tokenRecordId, identity.employeeId],
      );
      const next = (await client.query(
        `INSERT INTO qr_access_tokens (
           tenant_id,purpose,subject_type,employee_id,asset_id,token_hash,status,
           expires_at,single_use,created_by_employee_id,metadata
         ) VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8,$9,NULL)
         RETURNING id,expires_at AS "expiresAt"`,
        [
          identity.tenantId,
          current.purpose,
          current.subjectType,
          current.employeeId,
          current.assetId,
          tokenHash,
          current.expiresAt,
          current.singleUse,
          identity.employeeId,
        ],
      )).rows[0];
      await recordAuditEvent(client, {
        tenantId: identity.tenantId,
        actorId: identity.employeeId,
        action: 'qr.token_rotated',
        targetType: 'qr_access_token',
        targetId: next.id,
        metadata: {
          tokenRecordId: next.id,
          purpose: current.purpose,
          subjectType: current.subjectType,
          issuerEmployeeId: identity.employeeId,
          status: 'active',
          expiresAt: next.expiresAt,
          singleUse: current.singleUse,
        },
      });
      return { ...next, purpose: current.purpose as QrTokenPurpose };
    });
    if (replacement.expiresAt) {
      void enqueueQrExpiryCleanup(
        { tenantId: identity.tenantId, tokenRecordId: replacement.id },
        new Date(replacement.expiresAt),
      ).catch(() => undefined);
    }
    return this.presentation(replacement, replacement.purpose, token, origin);
  }

  async revoke(identity: Identity, tokenRecordId: string): Promise<{ success: true; status: 'revoked'; alreadyRevoked: boolean }> {
    return withTenant(identity.tenantId, async (client) => {
      const current = (await client.query(
        `SELECT id,purpose,subject_type AS "subjectType",employee_id AS "employeeId",
                asset_id AS "assetId",status,expires_at AS "expiresAt",single_use AS "singleUse"
         FROM qr_access_tokens WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [identity.tenantId, tokenRecordId],
      )).rows[0];
      if (!current) throw new QrTokenError(404, 'QR_TOKEN_NOT_FOUND', 'QR token is unavailable.');
      await assertQrMutationPermission(client, identity, current, 'revoke');
      if (current.status === 'revoked') return { success: true, status: 'revoked', alreadyRevoked: true };
      if (current.status !== 'active') throw new QrTokenError(409, 'QR_TOKEN_NOT_ACTIVE', 'Only an active token can be revoked.');
      await client.query(
        `UPDATE qr_access_tokens
         SET status='revoked',revoked_at=NOW(),revoked_by_employee_id=$3,updated_at=NOW()
         WHERE tenant_id=$1 AND id=$2 AND status='active'`,
        [identity.tenantId, tokenRecordId, identity.employeeId],
      );
      await recordAuditEvent(client, {
        tenantId: identity.tenantId,
        actorId: identity.employeeId,
        action: 'qr.token_revoked',
        targetType: 'qr_access_token',
        targetId: current.id,
        metadata: {
          tokenRecordId: current.id,
          purpose: current.purpose,
          subjectType: current.subjectType,
          issuerEmployeeId: identity.employeeId,
          status: 'revoked',
          expiresAt: current.expiresAt,
          singleUse: current.singleUse,
        },
      });
      return { success: true, status: 'revoked', alreadyRevoked: false };
    });
  }

  async consumeOnboardingInvite(tokenHash: string): Promise<{ consumed: true } | null> {
    const tenantLookup = await getDbPool().query(
      `SELECT tenant_id FROM qr_access_tokens
       WHERE token_hash=$1 AND purpose='onboarding_invite'
       LIMIT 1`,
      [tokenHash],
    );
    const tenantId = tenantLookup.rows[0]?.tenant_id;
    if (!tenantId) return null;
    return withTenant(tenantId, async (client) => {
      const current = (await client.query(
        `SELECT id,purpose,subject_type AS "subjectType",status,expires_at AS "expiresAt",
                single_use AS "singleUse",created_by_employee_id AS "issuerEmployeeId"
         FROM qr_access_tokens
         WHERE tenant_id=$1 AND token_hash=$2 AND purpose='onboarding_invite'
         FOR UPDATE`,
        [tenantId, tokenHash],
      )).rows[0];
      if (!current || current.status !== 'active') return null;
      if (!current.expiresAt || new Date(current.expiresAt).getTime() <= Date.now()) {
        await client.query(
          `UPDATE qr_access_tokens SET status='expired',updated_at=NOW()
           WHERE tenant_id=$1 AND id=$2 AND status='active'`,
          [tenantId, current.id],
        );
        return null;
      }
      const consumed = await client.query(
        `UPDATE qr_access_tokens
         SET status='used',used_at=NOW(),updated_at=NOW()
         WHERE tenant_id=$1 AND id=$2 AND status='active'
         RETURNING id`,
        [tenantId, current.id],
      );
      if (!consumed.rows[0]) return null;
      await recordAuditEvent(client, {
        tenantId,
        actorId: null,
        action: 'qr.token_consumed',
        targetType: 'qr_access_token',
        targetId: current.id,
        metadata: {
          tokenRecordId: current.id,
          purpose: current.purpose,
          subjectType: current.subjectType,
          issuerEmployeeId: current.issuerEmployeeId,
          status: 'used',
          expiresAt: current.expiresAt,
          singleUse: current.singleUse,
        },
      });
      return { consumed: true };
    });
  }

  async expireToken(tenantId: string, tokenRecordId: string): Promise<boolean> {
    return withTenant(tenantId, async (client) => {
      const expired = (await client.query(
        `UPDATE qr_access_tokens
         SET status='expired',updated_at=NOW()
         WHERE tenant_id=$1 AND id=$2 AND status='active'
           AND expires_at IS NOT NULL AND expires_at<=NOW()
         RETURNING id,purpose,subject_type AS "subjectType",expires_at AS "expiresAt",
                   single_use AS "singleUse",created_by_employee_id AS "issuerEmployeeId"`,
        [tenantId, tokenRecordId],
      )).rows[0];
      if (!expired) return false;
      await recordAuditEvent(client, {
        tenantId,
        actorId: null,
        action: 'qr.token_expired',
        targetType: 'qr_access_token',
        targetId: expired.id,
        metadata: {
          tokenRecordId: expired.id,
          purpose: expired.purpose,
          subjectType: expired.subjectType,
          issuerEmployeeId: expired.issuerEmployeeId,
          status: 'expired',
          expiresAt: expired.expiresAt,
          singleUse: expired.singleUse,
        },
      });
      return true;
    });
  }

  async resolvePublic(purpose: QrTokenPurpose, tokenHash: string): Promise<Record<string, unknown> | null> {
    const pool = getDbPool();
    const tenantLookup = await pool.query(
      `SELECT tenant_id FROM qr_access_tokens
       WHERE token_hash=$1 AND purpose=$2
       LIMIT 1`,
      [tokenHash, purpose],
    );
    const tenantId = tenantLookup.rows[0]?.tenant_id;
    if (!tenantId) return null;

    return withTenant(tenantId, async (client: PoolClient) => {
      const result = await client.query(
        `UPDATE qr_access_tokens token
         SET last_scanned_at=NOW(),scan_count=LEAST(scan_count+1,2147483647),updated_at=NOW()
         WHERE token.tenant_id=$1
           AND token.token_hash=$2
           AND token.purpose=$3
           AND token.status='active'
           AND (token.expires_at IS NULL OR token.expires_at>NOW())
         RETURNING token.id,token.purpose,token.expires_at,
           token.employee_id,token.asset_id`,
        [tenantId, tokenHash, purpose],
      );
      const row = result.rows[0];
      if (!row) return null;
      if (purpose === 'employee_verification') {
        const active = (await client.query(
          `SELECT 1 FROM employees
           WHERE tenant_id=$1 AND id=$2 AND is_active=true AND employment_status='active'`,
          [tenantId, row.employee_id],
        )).rows[0];
        return active ? { valid: true, purpose, verification: 'active_employee' } : null;
      }
      if (purpose === 'asset_lookup') {
        const asset = (await client.query(
          `SELECT status FROM assets WHERE tenant_id=$1 AND id=$2`,
          [tenantId, row.asset_id],
        )).rows[0];
        return asset ? { valid: true, purpose, assetState: asset.status } : null;
      }
      return {
        valid: true,
        purpose,
        inviteState: 'ready',
        expiresAt: new Date(row.expires_at).toISOString(),
      };
    });
  }
}
