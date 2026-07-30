export const QR_TOKEN_PURPOSES = ['employee_verification', 'asset_lookup', 'onboarding_invite'] as const;
export type QrTokenPurpose = (typeof QR_TOKEN_PURPOSES)[number];
export type QrSubjectType = 'employee' | 'asset' | 'onboarding_invite';
export type QrTokenStatus = 'active' | 'used' | 'expired' | 'revoked';
export type BadgeDisclosureLevel = 'name_only' | 'name_and_title' | 'name_title_and_department';

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

export type DigitalBadge = {
  state: 'active' | 'inactive' | 'revoked' | 'not_issued';
  canIssue: boolean;
  canRotate: boolean;
  canRevoke: boolean;
  requiresRotation: boolean;
  verificationUrl: string | null;
  issuedAt: string | null;
  lastUpdatedAt: string | null;
  revokedAt: string | null;
  display: {
    name: string;
    companyName: string;
    jobTitle: string | null;
    departmentName: string | null;
    avatarUrl: string | null;
  };
};

export type PublicEmployeeVerification = {
  verified: boolean;
  status: 'active' | 'inactive';
  employeeDisplayName?: string;
  companyName: string;
  jobTitle?: string;
  departmentName?: string;
  issuedByCompany: true;
  verifiedAt: string;
  badgeLastUpdatedAt: string;
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
