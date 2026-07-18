import { URL } from 'node:url';

const SAFE_ENVIRONMENTS = new Set(['development', 'test', 'demo']);
const PRODUCTION_MARKERS = /(?:^|[.-])(prod|production|live|staging)(?:[.-]|$)/i;

function requireSafeEnvironment(label: string) {
  if (process.env.ALLOW_TEST_DATA_MUTATION !== 'true') {
    throw new Error(`${label} requires ALLOW_TEST_DATA_MUTATION=true.`);
  }
  const environment = (process.env.NODE_ENV || 'development').toLowerCase();
  if (!SAFE_ENVIRONMENTS.has(environment)) {
    throw new Error(`${label} is disabled when NODE_ENV=${environment}. Use development, test, or demo.`);
  }
}

function isLoopback(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function isAllowlisted(value: string) {
  return (process.env.TEST_TARGET_ALLOWLIST || '')
    .split(',')
    .map((item) => item.trim().replace(/\/$/, ''))
    .filter(Boolean)
    .includes(value.replace(/\/$/, ''));
}

export function assertHttpMutationSafety(rawTarget: string, label: string) {
  requireSafeEnvironment(label);

  let target: URL;
  try {
    target = new URL(rawTarget);
  } catch {
    throw new Error(`${label} target must be a valid HTTP(S) URL.`);
  }
  if (!['http:', 'https:'].includes(target.protocol)) {
    throw new Error(`${label} target must use HTTP or HTTPS.`);
  }

  const origin = target.origin;
  if (!isLoopback(target.hostname) && !isAllowlisted(origin)) {
    throw new Error(`${label} target is not local or in TEST_TARGET_ALLOWLIST.`);
  }
  if (!isLoopback(target.hostname) && process.env.ALLOW_NONLOCAL_TEST_TARGET !== 'true') {
    throw new Error(`${label} nonlocal target requires ALLOW_NONLOCAL_TEST_TARGET=true.`);
  }
  if (PRODUCTION_MARKERS.test(target.hostname) || PRODUCTION_MARKERS.test(target.pathname)) {
    if (process.env.ALLOW_PRODUCTION_TEST_TARGET !== 'true') {
      throw new Error(`${label} target looks production-like; set ALLOW_PRODUCTION_TEST_TARGET=true only for an approved isolated target.`);
    }
  }

  console.log(`${label} target: ${target.origin}`);
  return target.origin;
}

export function assertDatabaseMutationSafety(rawDatabaseUrl: string | undefined, label: string, requirePassword = false, requireDemoDatabase = false) {
  requireSafeEnvironment(label);
  if (!rawDatabaseUrl?.trim()) throw new Error(`${label} requires DATABASE_URL.`);

  let databaseUrl: URL;
  try {
    databaseUrl = new URL(rawDatabaseUrl);
  } catch {
    throw new Error(`${label} DATABASE_URL must be a valid PostgreSQL URL.`);
  }
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
    throw new Error(`${label} DATABASE_URL must use postgres:// or postgresql://.`);
  }

  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\/+/, ''));
  const target = `${databaseUrl.hostname}:${databaseUrl.port || '5432'}/${databaseName}`;
  const allowlist = (process.env.DEMO_DATABASE_ALLOWLIST || process.env.TEST_DATABASE_ALLOWLIST || '')
    .split(',').map((item) => item.trim()).filter(Boolean);
  const hostAllowlisted = allowlist.includes(target) || allowlist.includes(databaseName);
  if (!hostAllowlisted) throw new Error(`${label} database is not explicitly allowlisted; localhost alone is not a safety boundary.`);
  if (!isLoopback(databaseUrl.hostname) && process.env.ALLOW_NONLOCAL_TEST_TARGET !== 'true') {
    throw new Error(`${label} nonlocal database requires ALLOW_NONLOCAL_TEST_TARGET=true.`);
  }
  if (requireDemoDatabase && (!process.env.DEMO_DATABASE_NAME || databaseName !== process.env.DEMO_DATABASE_NAME.trim())) {
    throw new Error(`${label} must target the exact DEMO_DATABASE_NAME database.`);
  }
  if (PRODUCTION_MARKERS.test(databaseUrl.hostname) || PRODUCTION_MARKERS.test(databaseName)) {
    if (process.env.ALLOW_PRODUCTION_TEST_TARGET !== 'true') {
      throw new Error(`${label} database looks production-like; set ALLOW_PRODUCTION_TEST_TARGET=true only for an approved isolated target.`);
    }
  }
  if (requirePassword && (!process.env.DEMO_PASSWORD || process.env.DEMO_PASSWORD.trim().length < 12)) {
    throw new Error('Set DEMO_PASSWORD to a strong demo-only password.');
  }

  console.log(`${label} target: ${target}`);
  return { databaseUrl, databaseName };
}

export async function requireDestructiveConfirmation(expected: string, label: string) {
  if (process.env.TEST_DATA_CONFIRM === expected || process.env.DEMO_RESET_CONFIRM === expected) return;
  if (process.env.TEST_DATA_NONINTERACTIVE === 'true') {
    throw new Error(`${label} requires TEST_DATA_CONFIRM=${expected} in noninteractive mode.`);
  }
  if (!process.stdin.isTTY) throw new Error(`${label} requires TEST_DATA_CONFIRM=${expected} in noninteractive mode.`);

  const { createInterface } = await import('node:readline/promises');
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await readline.question(`Type ${expected} to confirm ${label}: `);
    if (answer.trim() !== expected) throw new Error(`${label} confirmation did not match.`);
  } finally {
    readline.close();
  }
}
