export const QR_TOKEN_PURPOSES = ['employee_verification', 'asset_lookup', 'onboarding_invite'] as const;
export type QrTokenPurpose = (typeof QR_TOKEN_PURPOSES)[number];
export type QrSubjectType = 'employee' | 'asset' | 'onboarding_invite';
export type QrTokenStatus = 'active' | 'used' | 'expired' | 'revoked';

export const QR_PURPOSE_CONFIG: Record<QrTokenPurpose, {
  subjectType: QrSubjectType;
  publicPath: string;
  singleUse: boolean;
  expiryRequired: boolean;
}> = {
  employee_verification: {
    subjectType: 'employee',
    publicPath: '/verify/employee',
    singleUse: false,
    expiryRequired: false,
  },
  asset_lookup: {
    subjectType: 'asset',
    publicPath: '/assets/lookup',
    singleUse: false,
    expiryRequired: false,
  },
  onboarding_invite: {
    subjectType: 'onboarding_invite',
    publicPath: '/onboarding/invite',
    singleUse: true,
    expiryRequired: true,
  },
};

export type QrTokenPresentation = {
  tokenRecordId: string;
  purpose: QrTokenPurpose;
  encodedUrl: string;
  label: string;
  expiresAt: string | null;
  status: QrTokenStatus;
  rotatable: boolean;
  revocable: boolean;
};

export class QrTokenError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function isQrTokenPurpose(value: unknown): value is QrTokenPurpose {
  return typeof value === 'string' && (QR_TOKEN_PURPOSES as readonly string[]).includes(value);
}
