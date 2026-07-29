import { createHash, randomBytes } from 'node:crypto';
import { QrTokenError } from './qr-token-types';

export const QR_TOKEN_BYTES = 32;
export const QR_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function generateOpaqueQrToken(): string {
  return randomBytes(QR_TOKEN_BYTES).toString('base64url');
}

export function hashQrToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function isValidQrToken(value: unknown): value is string {
  return typeof value === 'string' && QR_TOKEN_PATTERN.test(value);
}

export function requireUuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new QrTokenError(400, 'QR_INVALID_REQUEST', `${label} is invalid.`);
  }
  return value;
}

export function strictQrObject(value: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new QrTokenError(400, 'QR_INVALID_REQUEST', 'A valid request body is required.');
  }
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !allowedKeys.includes(key))) {
    throw new QrTokenError(400, 'QR_INVALID_REQUEST', 'The request contains unsupported fields.');
  }
  return body;
}

export function normalizeInviteExpiryMinutes(value: unknown): number {
  const minutes = value === undefined ? 60 : Number(value);
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 10_080) {
    throw new QrTokenError(400, 'QR_INVALID_EXPIRY', 'Invite expiry must be between 5 minutes and 7 days.');
  }
  return minutes;
}

export function getCanonicalQrOrigin(environment: NodeJS.ProcessEnv = process.env): string {
  const configured = environment.APP_BASE_URL?.trim()
    || (environment.NODE_ENV === 'production' ? '' : 'http://localhost:3000');
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new QrTokenError(500, 'QR_ORIGIN_INVALID', 'The public application origin is not configured safely.');
  }
  const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  if (
    url.username
    || url.password
    || url.search
    || url.hash
    || (url.pathname !== '/' && url.pathname !== '')
    || !['http:', 'https:'].includes(url.protocol)
    || (environment.NODE_ENV === 'production' && url.protocol !== 'https:')
    || (url.protocol === 'http:' && !isLocalhost)
    || (environment.NODE_ENV === 'production' && isLocalhost)
  ) {
    throw new QrTokenError(500, 'QR_ORIGIN_INVALID', 'The public application origin is not configured safely.');
  }
  return url.origin;
}
