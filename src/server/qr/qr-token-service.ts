import type { PoolClient } from 'pg';
import { getDbPool, withTenant } from '../../lib/hr-background';
import { recordAuditEvent } from '../audit/audit-events';
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

    return {
      tokenRecordId: record.id,
      purpose: input.purpose,
      encodedUrl: `${origin}${config.publicPath}/${token}`,
      label: labelFor(input.purpose),
      expiresAt: record.expiresAt ? new Date(record.expiresAt).toISOString() : null,
      status: 'active',
      rotatable: true,
      revocable: true,
    };
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
