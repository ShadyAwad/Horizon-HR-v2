import type { PoolClient } from 'pg';
import { resolveScopedPermission, type PermissionAuthority } from '../organisation/scoped-permissions';
import { QrTokenError, type QrTokenPurpose } from './qr-token-types';

export const QR_PERMISSIONS = {
  employeeSelf: 'qr.employee_badge.self',
  employeeManage: 'qr.employee_badge.manage',
  assetManage: 'qr.asset_label.manage',
  onboardingManage: 'qr.onboarding_invite.manage',
  revoke: 'qr.tokens.revoke',
} as const;

type Identity = { tenantId: string; employeeId: string };
type Subject = { employeeId?: string | null; assetId?: string | null };
export type QrPermissionRecord = Subject & { purpose: QrTokenPurpose };

async function authority(
  client: PoolClient,
  identity: Identity,
  permissionKey: string,
  targetEmployeeId?: string | null,
): Promise<PermissionAuthority> {
  return resolveScopedPermission(client, {
    tenantId: identity.tenantId,
    actorEmployeeId: identity.employeeId,
    permissionKey,
    targetEmployeeId,
  });
}

async function requireAllowed(
  client: PoolClient,
  identity: Identity,
  permissionKey: string,
  targetEmployeeId?: string | null,
) {
  const decision = await authority(client, identity, permissionKey, targetEmployeeId);
  if (!decision.allowed) {
    throw new QrTokenError(403, 'QR_PERMISSION_DENIED', 'You do not have permission to manage this QR token.');
  }
  return decision;
}

export async function assertQrIssuePermission(
  client: PoolClient,
  identity: Identity,
  purpose: QrTokenPurpose,
  subject: Subject,
) {
  if (purpose === 'employee_verification') {
    const employeeId = subject.employeeId!;
    const employee = (await client.query(
      `SELECT 1 FROM employees
       WHERE tenant_id=$1 AND id=$2 AND is_active=true AND employment_status='active'`,
      [identity.tenantId, employeeId],
    )).rows[0];
    if (!employee) throw new QrTokenError(404, 'QR_SUBJECT_NOT_FOUND', 'The QR subject is unavailable.');
    return requireAllowed(
      client,
      identity,
      employeeId === identity.employeeId ? QR_PERMISSIONS.employeeSelf : QR_PERMISSIONS.employeeManage,
      employeeId,
    );
  }

  if (purpose === 'asset_lookup') {
    const asset = (await client.query(
      `SELECT asset.id,assignment.employee_id
       FROM assets asset
       LEFT JOIN asset_assignments assignment
         ON assignment.tenant_id=asset.tenant_id
        AND assignment.asset_id=asset.id
        AND assignment.status='active'
       WHERE asset.tenant_id=$1 AND asset.id=$2`,
      [identity.tenantId, subject.assetId],
    )).rows[0];
    if (!asset) throw new QrTokenError(404, 'QR_SUBJECT_NOT_FOUND', 'The QR subject is unavailable.');
    const targetEmployeeId = asset.employee_id || null;
    await requireAllowed(client, identity, 'assets.manage', targetEmployeeId);
    return requireAllowed(client, identity, QR_PERMISSIONS.assetManage, targetEmployeeId);
  }

  await requireAllowed(client, identity, 'hiring.create');
  return requireAllowed(client, identity, QR_PERMISSIONS.onboardingManage);
}

export async function assertEmployeeBadgeReadPermission(
  client: PoolClient,
  identity: Identity,
  employeeId: string,
) {
  return requireAllowed(
    client,
    identity,
    employeeId === identity.employeeId ? QR_PERMISSIONS.employeeSelf : QR_PERMISSIONS.employeeManage,
    employeeId,
  );
}


export async function assertQrMutationPermission(
  client: PoolClient,
  identity: Identity,
  record: QrPermissionRecord,
  operation: 'rotate' | 'revoke',
) {
  await assertQrIssuePermission(client, identity, record.purpose, record);
  if (
    operation === 'revoke'
    && !(record.purpose === 'employee_verification' && record.employeeId === identity.employeeId)
  ) {
    await requireAllowed(client, identity, QR_PERMISSIONS.revoke, record.employeeId || null);
  }
}
