import { STANZA_FINGERPRINT_GROOVES, STANZA_FINGERPRINT_VIEW_BOX } from '../stanzaFingerprintGeometry';

export type StanzaBadgeUser = {
  id?: string | null;
  email?: string | null;
  name?: string | null;
  role?: string | null;
  jobTitle?: string | null;
  tenantId?: string | null;
  tenant?: string | { id?: string; slug?: string; companyName?: string } | null;
  profileImageDataUrl?: string | null;
};

export type StanzaBadgeLanguage = 'en' | 'ar';
type StanzaBadgeArtworkOptions = { language?: StanzaBadgeLanguage; direction?: 'ltr' | 'rtl' };

const escapeXml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

const cleanText = (value: string | null | undefined, fallback: string, maxLength: number) => {
  const normalized = value?.trim() || fallback;
  return escapeXml(normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized);
};

const roleLabel = (user: StanzaBadgeUser) => {
  if (user.jobTitle?.trim()) return user.jobTitle;
  const roles: Record<string, string> = {
    hr_admin: 'HR Administrator',
    manager: 'Manager',
    employee: 'Employee'
  };
  return roles[user.role || ''] || 'Authorized Staff';
};

const tenantDetails = (user: StanzaBadgeUser) => {
  if (typeof user.tenant === 'string') {
    return { company: user.tenant, identifier: user.tenantId || 'STANZA-WORKSPACE' };
  }

  return {
    company: user.tenant?.companyName || 'Stanza Workspace',
    identifier: user.tenant?.slug || user.tenant?.id || user.tenantId || 'STANZA-WORKSPACE'
  };
};

const barcodeBars = (seed: string) => {
  const source = seed || 'STANZA-ACCESS';
  let x = 76;
  return Array.from({ length: 38 }, (_, index) => {
    const code = source.charCodeAt(index % source.length);
    const width = 3 + ((code + index) % 4) * 2;
    const gap = 4 + ((code >> 2) % 3);
    const bar = `<rect x="${x}" y="858" width="${width}" height="54" rx="1" fill="#b7f7d8" opacity="${0.5 + ((code % 5) * 0.1)}"/>`;
    x += width + gap;
    return bar;
  }).join('');
};

const fingerprintPaths = STANZA_FINGERPRINT_GROOVES
  .map((path) => `<path d="${path}"/>`)
  .join('');

// Matches StanzaFingerprintMark: the shared 24px geometry, rounded caps and a
// proportional 2px stroke. The surrounding group only scales the real mark.
const fingerprintMark = (x: number, y: number, scale: number, color = '#18C98B') => `
  <g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${fingerprintPaths}</g>
`;

export function buildStanzaFrontBadgeSvg(options: StanzaBadgeArtworkOptions = {}) {
  const language = options.language || 'en';
  const isRtl = (options.direction || (language === 'ar' ? 'rtl' : 'ltr')) === 'rtl';
  const secureWorkforce = isRtl ? 'منصة القوى العاملة' : 'SECURE WORKFORCE';
  const verifiedAccess = isRtl ? 'وصول موثق' : 'VERIFIED ACCESS';
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="660" height="1000" viewBox="0 0 660 1000" direction="${isRtl ? 'rtl' : 'ltr'}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#020604"/>
          <stop offset="0.55" stop-color="#061b13"/>
          <stop offset="1" stop-color="#020a07"/>
        </linearGradient>
        <radialGradient id="glow" cx="50%" cy="35%" r="52%">
          <stop offset="0" stop-color="#18C98B" stop-opacity="0.22"/>
          <stop offset="0.56" stop-color="#0B6649" stop-opacity="0.09"/>
          <stop offset="1" stop-color="#020604" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="100%" height="100%" fill="#041C15"/>
      <rect width="660" height="1000" fill="url(#bg)"/>
      <rect width="660" height="1000" fill="url(#glow)"/>
      <path d="M0 170 C155 105 248 222 405 151 C515 101 590 107 660 73" fill="none" stroke="#18C98B" stroke-opacity="0.07" stroke-width="2"/>
      <path d="M0 204 C169 137 269 249 421 181 C533 131 599 137 660 106" fill="none" stroke="#42E8AD" stroke-opacity="0.045" stroke-width="2"/>
      <rect x="42" y="42" width="576" height="916" rx="34" fill="none" stroke="#2B7A5D" stroke-opacity="0.38" stroke-width="2"/>
      <circle cx="330" cy="330" r="172" fill="none" stroke="#18C98B" stroke-opacity="0.1" stroke-width="1"/>
      <circle cx="330" cy="330" r="142" fill="none" stroke="#42E8AD" stroke-opacity="0.08" stroke-width="1" stroke-dasharray="2 10"/>
      <g opacity="0.12">${fingerprintMark(190, 190, 11.666667, '#42E8AD')}</g>
      ${fingerprintMark(190, 190, 11.666667)}
      <text x="330" y="640" text-anchor="middle" font-family="Inter,Segoe UI,Arial,Helvetica,sans-serif" font-size="76" font-weight="750" letter-spacing="1"><tspan fill="#18C98B">S</tspan><tspan fill="#E8F7F1">tanza</tspan></text>
      <text x="330" y="696" text-anchor="middle" fill="#78D7B4" font-family="Inter,Segoe UI,Arial,Helvetica,sans-serif" font-size="20" font-weight="650" letter-spacing="${isRtl ? '1' : '4'}">${secureWorkforce}</text>
      <line x1="210" y1="756" x2="450" y2="756" stroke="#18C98B" stroke-opacity="0.3"/>
      <circle cx="300" cy="819" r="5" fill="#42E8AD"/>
      <text x="322" y="827" fill="#78D7B4" font-family="Inter,Segoe UI,Arial,Helvetica,sans-serif" font-size="18" letter-spacing="${isRtl ? '1' : '3'}">${verifiedAccess}</text>
    </svg>
  `;
}

export function buildStanzaBackBadgeSvg(user: StanzaBadgeUser, options: StanzaBadgeArtworkOptions = {}) {
  const language = options.language || 'en';
  const isRtl = (options.direction || (language === 'ar' ? 'rtl' : 'ltr')) === 'rtl';
  const labels = isRtl ? {
    access: 'دخول الموظف',
    identity: 'هوية ستانزا الموثقة',
    employee: 'الموظف',
    workspace: 'مساحة العمل',
    email: 'البريد الإلكتروني',
    workspaceId: 'معرف مساحة العمل',
    propertyOf: 'ملكية'
  } : {
    access: 'Employee Access',
    identity: 'STANZA VERIFIED IDENTITY',
    employee: 'EMPLOYEE',
    workspace: 'WORKSPACE',
    email: 'EMAIL',
    workspaceId: 'WORKSPACE ID',
    propertyOf: 'PROPERTY OF'
  };
  const textX = isRtl ? 586 : 74;
  const textAnchor = isRtl ? 'end' : 'start';
  const tenant = tenantDetails(user);
  const name = cleanText(user.name, 'Stanza User', 30);
  const role = cleanText(roleLabel(user), 'Authorized Staff', 34);
  const company = cleanText(tenant.company, 'Stanza Workspace', 34);
  const companyUpper = cleanText(tenant.company.toUpperCase(), 'STANZA WORKSPACE', 34);
  const email = cleanText(user.email, 'authorized@stanza.app', 42);
  const identifier = cleanText(tenant.identifier, 'STANZA-WORKSPACE', 32);
  const portraitCenterX = isRtl ? 140 : 520;
  const portrait = user.profileImageDataUrl
    ? `<defs><clipPath id="portraitClip"><circle cx="${portraitCenterX}" cy="288" r="58"/></clipPath></defs><circle cx="${portraitCenterX}" cy="288" r="62" fill="#04110d" stroke="#34d399" stroke-opacity="0.65" stroke-width="4"/><image href="${escapeXml(user.profileImageDataUrl)}" x="${portraitCenterX - 58}" y="230" width="116" height="116" preserveAspectRatio="xMidYMid slice" clip-path="url(#portraitClip)"/>`
    : '';

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="660" height="1000" viewBox="0 0 660 1000" direction="${isRtl ? 'rtl' : 'ltr'}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#020604"/>
          <stop offset="0.48" stop-color="#071a13"/>
          <stop offset="1" stop-color="#020a07"/>
        </linearGradient>
        <linearGradient id="header" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#064e3b" stop-opacity="0.75"/>
          <stop offset="1" stop-color="#10b981" stop-opacity="0.12"/>
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="100%" height="100%" fill="#041C15"/>
      <rect width="660" height="1000" fill="url(#bg)"/>
      <rect x="42" y="42" width="576" height="916" rx="34" fill="none" stroke="#6ee7b7" stroke-opacity="0.17" stroke-width="2"/>
      <rect x="42" y="42" width="576" height="152" rx="34" fill="url(#header)"/>
      <rect x="42" y="160" width="576" height="34" fill="#071a13"/>
      ${fingerprintMark(72, 68, 3.75)}
      <text x="174" y="113" fill="#E8F7F1" font-family="Inter,Segoe UI,Arial,Helvetica,sans-serif" font-size="38" font-weight="750">${labels.access}</text>
      <text x="174" y="151" fill="#78D7B4" font-family="Inter,Segoe UI,Arial,Helvetica,sans-serif" font-size="16" font-weight="650" letter-spacing="3">${labels.identity}</text>

      <text x="${textX}" y="258" text-anchor="${textAnchor}" fill="#6ee7b7" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="15" font-weight="700" letter-spacing="3">${labels.employee}</text>
      <text x="${textX}" y="310" text-anchor="${textAnchor}" fill="#ecfdf5" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="42" font-weight="750">${name}</text>
      <text x="${textX}" y="351" text-anchor="${textAnchor}" fill="#a7f3d0" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="23" font-weight="600">${role}</text>
      ${portrait}

      <line x1="74" y1="402" x2="586" y2="402" stroke="#34d399" stroke-opacity="0.22"/>
      <text x="${textX}" y="453" text-anchor="${textAnchor}" fill="#6ee7b7" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="14" font-weight="700" letter-spacing="3">${labels.workspace}</text>
      <text x="${textX}" y="496" text-anchor="${textAnchor}" fill="#d1fae5" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="27" font-weight="650">${company}</text>

      <text x="${textX}" y="574" text-anchor="${textAnchor}" fill="#6ee7b7" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="14" font-weight="700" letter-spacing="3">${labels.email}</text>
      <text x="${textX}" y="614" text-anchor="${textAnchor}" direction="ltr" unicode-bidi="embed" fill="#d1fae5" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="22">${email}</text>

      <text x="${textX}" y="694" text-anchor="${textAnchor}" fill="#6ee7b7" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="14" font-weight="700" letter-spacing="3">${labels.workspaceId}</text>
      <text x="${textX}" y="732" text-anchor="${textAnchor}" direction="ltr" unicode-bidi="embed" fill="#86bba5" font-family="ui-monospace,SFMono-Regular,Consolas,monospace" font-size="18" letter-spacing="1">${identifier}</text>

      <rect x="74" y="790" width="512" height="1" fill="#34d399" opacity="0.2"/>
      ${barcodeBars(user.id || tenant.identifier)}
      <text x="${textX}" y="944" text-anchor="${textAnchor}" fill="#6ee7b7" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="14" font-weight="650" letter-spacing="2">${labels.propertyOf} ${companyUpper}</text>
    </svg>
  `;
}
