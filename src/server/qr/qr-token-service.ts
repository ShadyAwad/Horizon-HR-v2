import type { PoolClient } from 'pg';
import { enqueueQrExpiryCleanup, getDbPool, withTenant } from '../../lib/hr-background';
import { recordAuditEvent } from '../audit/audit-events';
import { assertEmployeeBadgeReadPermission, assertQrIssuePermission, assertQrMutationPermission } from './qr-token-permissions';
import { decryptQrToken, encryptQrToken } from './qr-token-crypto';
import { QR_PURPOSE_CONFIG, QrTokenError, type DigitalBadge, type PublicEmployeeVerification, type QrTokenPresentation, type QrTokenPurpose } from './qr-token-types';
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
    const tokenCiphertext = encryptQrToken(token);
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
           expires_at,single_use,created_by_employee_id,token_ciphertext,metadata
         ) VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8,$9,$10,NULL)
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
          tokenCiphertext,
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
    const tokenCiphertext = encryptQrToken(token);
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
           expires_at,single_use,created_by_employee_id,token_ciphertext,metadata
         ) VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8,$9,$10,NULL)
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
          tokenCiphertext,
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

  async getEmployeeBadge(identity: Identity, employeeId = identity.employeeId): Promise<DigitalBadge> {
    return withTenant(identity.tenantId, async (client) => {
      const employee = (await client.query(
        `SELECT employee.id,employee.full_name AS "name",employee.is_active AS "isActive",
                employee.employment_status AS "employmentStatus",employee.profile_image_url AS "avatarUrl",
                COALESCE(NULLIF(title.name,''),NULLIF(employee.job_title,'')) AS "jobTitle",
                department.name AS "departmentName",tenant.company_name AS "companyName"
           FROM employees employee
           JOIN tenants tenant ON tenant.id=employee.tenant_id
           LEFT JOIN organisation_job_titles title ON title.tenant_id=employee.tenant_id AND title.id=employee.job_title_id
           LEFT JOIN organisation_departments department ON department.tenant_id=employee.tenant_id AND department.id=employee.department_id
          WHERE employee.tenant_id=$1 AND employee.id=$2`,
        [identity.tenantId, employeeId],
      )).rows[0];
      if (!employee) throw new QrTokenError(404, 'QR_BADGE_NOT_FOUND', 'Digital badge is unavailable.');

      // This validates the actual employee scope; it intentionally does not infer authority from a role name.
      await assertEmployeeBadgeReadPermission(client, identity, employeeId);

      const token = (await client.query(
        `SELECT id,status,token_ciphertext,created_at AS "issuedAt",updated_at AS "lastUpdatedAt",revoked_at AS "revokedAt"
           FROM qr_access_tokens
          WHERE tenant_id=$1 AND purpose='employee_verification' AND employee_id=$2
          ORDER BY created_at DESC,id DESC LIMIT 1`,
        [identity.tenantId, employeeId],
      )).rows[0] as { id: string; status: 'active' | 'revoked' | 'expired'; token_ciphertext: string | null; issuedAt: string | Date; lastUpdatedAt: string | Date; revokedAt: string | Date | null } | undefined;
      const activeEmployee = employee.isActive && employee.employmentStatus === 'active';
      const isActiveToken = token?.status === 'active';
      const rawToken = isActiveToken ? decryptQrToken(token?.token_ciphertext) : null;
      const origin = rawToken ? getCanonicalQrOrigin() : null;
      const verificationUrl = rawToken && origin
        ? `${origin}${QR_PURPOSE_CONFIG.employee_verification.publicPath}/${rawToken}`
        : null;
      return {
        state: !activeEmployee ? 'inactive' : isActiveToken ? 'active' : token?.status === 'revoked' ? 'revoked' : 'not_issued',
        canIssue: activeEmployee && !isActiveToken,
        canRotate: activeEmployee && isActiveToken,
        canRevoke: isActiveToken,
        requiresRotation: Boolean(isActiveToken && !verificationUrl),
        verificationUrl,
        issuedAt: token ? new Date(token.issuedAt).toISOString() : null,
        lastUpdatedAt: token ? new Date(token.lastUpdatedAt).toISOString() : null,
        revokedAt: token?.revokedAt ? new Date(token.revokedAt).toISOString() : null,
        display: {
          name: employee.name,
          companyName: employee.companyName,
          jobTitle: employee.jobTitle || null,
          departmentName: employee.departmentName || null,
          avatarUrl: employee.avatarUrl || null,
        },
      };
    });
  }

  async issueEmployeeBadge(identity: Identity, employeeId = identity.employeeId) {
    const current = await this.getEmployeeBadge(identity, employeeId);
    if (current.state === 'inactive') throw new QrTokenError(409, 'QR_EMPLOYEE_INACTIVE', 'Inactive employees cannot receive a badge.');
    if (current.state === 'active') return { badge: current, created: false };
    const token = await this.issue(identity, { purpose: 'employee_verification', employeeId });
    return { badge: await this.getEmployeeBadge(identity, employeeId), created: Boolean(token) };
  }

  async rotateEmployeeBadge(identity: Identity, employeeId = identity.employeeId) {
    const current = await this.getEmployeeBadge(identity, employeeId);
    if (current.state === 'inactive') throw new QrTokenError(409, 'QR_EMPLOYEE_INACTIVE', 'Inactive employees cannot rotate a badge.');
    const record = await withTenant(identity.tenantId, async (client) => (await client.query(
      `SELECT id FROM qr_access_tokens WHERE tenant_id=$1 AND purpose='employee_verification' AND employee_id=$2 AND status='active'`,
      [identity.tenantId, employeeId],
    )).rows[0]);
    if (!record) throw new QrTokenError(404, 'QR_BADGE_NOT_FOUND', 'No active digital badge exists.');
    await this.rotate(identity, record.id);
    return this.getEmployeeBadge(identity, employeeId);
  }

  async revokeEmployeeBadge(identity: Identity, employeeId = identity.employeeId) {
    const record = await withTenant(identity.tenantId, async (client) => (await client.query(
      `SELECT id FROM qr_access_tokens WHERE tenant_id=$1 AND purpose='employee_verification' AND employee_id=$2 AND status='active'`,
      [identity.tenantId, employeeId],
    )).rows[0]);
    if (!record) throw new QrTokenError(404, 'QR_BADGE_NOT_FOUND', 'No active digital badge exists.');
    await this.revoke(identity, record.id);
    return this.getEmployeeBadge(identity, employeeId);
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
         RETURNING token.id,token.purpose,token.expires_at,token.updated_at,
           token.employee_id,token.asset_id`,
        [tenantId, tokenHash, purpose],
      );
      const row = result.rows[0];
      if (!row) return null;
      if (purpose === 'employee_verification') {
        const employee = (await client.query(
          `SELECT employee.full_name AS "employeeDisplayName",employee.is_active AS "isActive",
                  employee.employment_status AS "employmentStatus",tenant.company_name AS "companyName",
                  tenant.badge_disclosure_level AS "disclosureLevel",
                  COALESCE(NULLIF(title.name,''),NULLIF(employee.job_title,'')) AS "jobTitle",
                  department.name AS "departmentName"
             FROM employees employee
             JOIN tenants tenant ON tenant.id=employee.tenant_id
             LEFT JOIN organisation_job_titles title ON title.tenant_id=employee.tenant_id AND title.id=employee.job_title_id
             LEFT JOIN organisation_departments department ON department.tenant_id=employee.tenant_id AND department.id=employee.department_id
            WHERE employee.tenant_id=$1 AND employee.id=$2`,
          [tenantId, row.employee_id],
        )).rows[0];
        if (!employee) return null;
        const active = employee.isActive && employee.employmentStatus === 'active';
        const disclosure = employee.disclosureLevel as 'name_only' | 'name_and_title' | 'name_title_and_department' | null;
        const verification: PublicEmployeeVerification = {
          verified: active,
          status: active ? 'active' : 'inactive',
          companyName: employee.companyName,
          issuedByCompany: true,
          verifiedAt: new Date().toISOString(),
          badgeLastUpdatedAt: new Date(row.updated_at).toISOString(),
        };
        if (active) {
          verification.employeeDisplayName = employee.employeeDisplayName;
          if (disclosure === 'name_and_title' || disclosure === 'name_title_and_department') {
            if (employee.jobTitle) verification.jobTitle = employee.jobTitle;
          }
          if (disclosure === 'name_title_and_department' && employee.departmentName) {
            verification.departmentName = employee.departmentName;
          }
        }
        return verification;
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
