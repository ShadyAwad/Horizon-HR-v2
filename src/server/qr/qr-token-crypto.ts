import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { QrTokenError } from './qr-token-types';

const VERSION = 'v1';

function keyFromEnvironment(environment: NodeJS.ProcessEnv = process.env) {
  const configured = environment.QR_TOKEN_ENCRYPTION_KEY?.trim();
  if (!configured) {
    throw new QrTokenError(503, 'QR_KEY_UNAVAILABLE', 'Digital badge service is not configured.');
  }
  const key = Buffer.from(configured, 'base64');
  if (key.byteLength !== 32 || key.toString('base64') !== configured) {
    throw new QrTokenError(503, 'QR_KEY_UNAVAILABLE', 'Digital badge service is not configured.');
  }
  return key;
}

/** Encrypts only the opaque bearer token. The hash remains the public lookup key. */
export function encryptQrToken(token: string, environment: NodeJS.ProcessEnv = process.env) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFromEnvironment(environment), iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return `${VERSION}.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptQrToken(payload: string | null | undefined, environment: NodeJS.ProcessEnv = process.env) {
  if (!payload) return null;
  const [version, encodedIv, encodedTag, encodedCiphertext, extra] = payload.split('.');
  if (version !== VERSION || !encodedIv || !encodedTag || !encodedCiphertext || extra) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyFromEnvironment(environment), Buffer.from(encodedIv, 'base64url'));
    decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(encodedCiphertext, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
