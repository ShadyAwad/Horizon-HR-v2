import path from 'node:path';
export function validateProductionConfig(env: NodeJS.ProcessEnv = process.env) {
    if (env.NODE_ENV !== 'production')
        return;
    const errors: string[] = [];
    const required = (key: string) => { if (!env[key]?.trim())
        errors.push(key + ' is required'); };
    for (const key of ['DATABASE_URL', 'APP_BASE_URL', 'QR_TOKEN_ENCRYPTION_KEY'])
        required(key);
    if (!env.REDIS_URL && !env.REDIS_HOST)
        errors.push('REDIS_URL or REDIS_HOST is required');
    for (const [key, protocols] of [['DATABASE_URL', ['postgres:', 'postgresql:']], ['REDIS_URL', ['redis:', 'rediss:']], ['APP_BASE_URL', ['https:', 'http:']]] as const) {
        if (env[key])
            try {
                const url = new URL(env[key]!);
                if (!protocols.some(p => p === url.protocol) || url.username && key === 'APP_BASE_URL' || url.password && key === 'APP_BASE_URL')
                    throw Error();
            }
            catch {
                errors.push(key + ' has an invalid protocol or format');
            }
    }
    const origin = env.APP_BASE_URL;
    if (origin)
        try {
            const url = new URL(origin);
            if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
                errors.push('APP_BASE_URL requires HTTPS');
            if (url.origin !== origin.replace(/\/$/, ''))
                errors.push('APP_BASE_URL must be an origin without a path');
            if (env.WEBAUTHN_ORIGIN !== url.origin)
                errors.push('WEBAUTHN_ORIGIN must match APP_BASE_URL');
            const rp = env.WEBAUTHN_RP_ID;
            if (!rp || (url.hostname !== rp && !url.hostname.endsWith('.' + rp)))
                errors.push('WEBAUTHN_RP_ID must match the public host');
        }
        catch { }
    if (env.QR_TOKEN_ENCRYPTION_KEY && (Buffer.from(env.QR_TOKEN_ENCRYPTION_KEY, 'base64').length !== 32 || Buffer.from(env.QR_TOKEN_ENCRYPTION_KEY, 'base64').toString('base64') !== env.QR_TOKEN_ENCRYPTION_KEY))
        errors.push('QR_TOKEN_ENCRYPTION_KEY must encode 32 bytes');
    for (const key of ['DEV_AUTH_HEADERS', 'ALLOW_TRYCLOUDFLARE_DEV_ORIGINS', 'STANZA_DEMO_ENV', 'ALLOW_DOCUMENT_EXTRACTION_FIXTURES'])
        if (env[key] === 'true')
            errors.push(key + ' must be disabled');
    if (!/^(?:0|[1-9][0-9]?)$/.test(env.TRUST_PROXY_HOPS || ''))
        errors.push('TRUST_PROXY_HOPS must explicitly specify 0–99 trusted hops');
    if (env.WEB_REPLICAS && env.WEB_REPLICAS !== '1')
        errors.push('WEB_REPLICAS must be 1: authentication rate limiting is process-local');
    if (Boolean(env.RESEND_API_KEY) !== Boolean(env.EMAIL_FROM))
        errors.push('RESEND_API_KEY and EMAIL_FROM must be configured together');
    for (const key of ['PROFILE_IMAGE_DIRECTORY', 'COMPANY_FEED_IMAGE_DIRECTORY', 'ASSET_EVIDENCE_DIRECTORY', 'GRIEVANCE_ATTACHMENT_DIRECTORY'])
        if (!env[key] || !path.isAbsolute(env[key]!))
            errors.push(key + ' must be an absolute durable volume path');
    if (env.DATABASE_SSL === 'false' && env.DATABASE_ALLOW_PLAINTEXT !== 'true')
        errors.push('Plaintext PostgreSQL requires DATABASE_ALLOW_PLAINTEXT=true on a private network');
    if (!['true', 'false'].includes(env.DATABASE_SSL || ''))
        errors.push('DATABASE_SSL must explicitly be true or false');
    if (!/^(?:[1-9]|[1-4][0-9]|50)$/.test(env.DATABASE_POOL_MAX || '10'))
        errors.push('DATABASE_POOL_MAX must be 1–50');
    if (env.DATABASE_SSL === 'true' && env.DATABASE_URL)
        try {
            const url = new URL(env.DATABASE_URL);
            if (['sslmode', 'sslcert', 'sslkey', 'sslrootcert'].some(key => url.searchParams.has(key)))
                errors.push('Remove DATABASE_URL SSL query overrides; configure DATABASE_SSL and DATABASE_SSL_CA');
        }
        catch { }
    if (errors.length)
        throw new Error('Production configuration invalid: ' + errors.join('; '));
}
