type Environment = Record<string, string | undefined>;

const TRYCLOUDFLARE_SUFFIX = '.trycloudflare.com';

export function isTryCloudflareDevOriginsEnabled(env: Environment = process.env) {
  return env.NODE_ENV !== 'production'
    && env.ALLOW_TRYCLOUDFLARE_DEV_ORIGINS === 'true';
}

export function assertTryCloudflareDevOriginsStartup(env: Environment = process.env) {
  if (env.NODE_ENV === 'production' && env.ALLOW_TRYCLOUDFLARE_DEV_ORIGINS === 'true') {
    throw new Error('ALLOW_TRYCLOUDFLARE_DEV_ORIGINS is development-only and must be disabled in production.');
  }
}

export function isAllowedTryCloudflareDevOrigin(
  origin: string | undefined,
  env: Environment = process.env,
) {
  if (!origin || !isTryCloudflareDevOriginsEnabled(env)) return false;

  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === 'https:'
      && url.port === ''
      && !url.username
      && !url.password
      && hostname !== 'trycloudflare.com'
      && hostname.endsWith(TRYCLOUDFLARE_SUFFIX)
      && url.origin === origin;
  } catch {
    return false;
  }
}

export function shouldTrustTryCloudflareDevProxy(
  address: string,
  hop: number,
  env: Environment = process.env,
) {
  if (!isTryCloudflareDevOriginsEnabled(env) || hop !== 0) return false;
  const normalizedAddress = address.toLowerCase().replace(/^::ffff:/, '');
  return normalizedAddress === '127.0.0.1' || normalizedAddress === '::1';
}
