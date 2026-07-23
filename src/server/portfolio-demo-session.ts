export const PORTFOLIO_DEMO_ROLES = ['hr_admin', 'manager', 'employee'] as const;

export type PortfolioDemoRole = (typeof PORTFOLIO_DEMO_ROLES)[number];

export type PortfolioDemoSessionConfig = {
  tenantSlug: string;
  accounts: Record<PortfolioDemoRole, string>;
};

type Environment = Record<string, string | undefined>;

const DEMO_TENANT_SLUG = 'stanza-demo';
const DEMO_ACCOUNTS: PortfolioDemoSessionConfig['accounts'] = {
  hr_admin: 'admin@stanza-demo.com',
  manager: 'manager@stanza-demo.com',
  employee: 'employee@stanza-demo.com',
};

export function getPortfolioDemoSessionConfig(env: Environment = process.env): PortfolioDemoSessionConfig | null {
  if (env.STANZA_DEMO_ENV !== 'true' || env.ENABLE_PORTFOLIO_DEMO_SESSION !== 'true') {
    return null;
  }

  return { tenantSlug: DEMO_TENANT_SLUG, accounts: { ...DEMO_ACCOUNTS } };
}

export function assertPortfolioDemoSessionStartup(env: Environment = process.env) {
  if (env.NODE_ENV === 'production'
    && env.ENABLE_PORTFOLIO_DEMO_SESSION === 'true'
    && env.STANZA_DEMO_ENV !== 'true') {
    throw new Error('ENABLE_PORTFOLIO_DEMO_SESSION requires STANZA_DEMO_ENV=true in production.');
  }
}

export function parsePortfolioDemoRole(body: unknown): PortfolioDemoRole | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const entries = Object.entries(body as Record<string, unknown>);
  if (entries.length !== 1 || entries[0][0] !== 'role') return null;

  const role = entries[0][1];
  return typeof role === 'string' && (PORTFOLIO_DEMO_ROLES as readonly string[]).includes(role)
    ? role as PortfolioDemoRole
    : null;
}
