import { boundedQueueOperation } from '../src/lib/queue-bounds';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateProductionConfig } from '../src/lib/production-config';
import { PrivateObjectAdapter } from '../src/server/storage/private-object-storage';
const valid = { NODE_ENV: 'production', DATABASE_URL: 'postgres://user:secret@localhost/db', DATABASE_SSL: 'false', DATABASE_ALLOW_PLAINTEXT: 'true', REDIS_HOST: 'localhost', APP_BASE_URL: 'https://stanza.example', WEBAUTHN_ORIGIN: 'https://stanza.example', WEBAUTHN_RP_ID: 'stanza.example', QR_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'), TRUST_PROXY_HOPS: '1', WEB_REPLICAS: '1', ...Object.fromEntries(['PROFILE_IMAGE_DIRECTORY', 'COMPANY_FEED_IMAGE_DIRECTORY', 'ASSET_EVIDENCE_DIRECTORY', 'GRIEVANCE_ATTACHMENT_DIRECTORY'].map(key => [key, path.resolve('uploads', key)])) };
validateProductionConfig(valid);
for (const key of ['DATABASE_URL', 'APP_BASE_URL', 'QR_TOKEN_ENCRYPTION_KEY', 'GRIEVANCE_ATTACHMENT_DIRECTORY', 'TRUST_PROXY_HOPS'])
    assert.throws(() => validateProductionConfig({ ...valid, [key]: '' }), new RegExp(key));
for (const patch of [{ WEB_REPLICAS: '2' }, { APP_BASE_URL: 'http://public.example' }, { WEBAUTHN_RP_ID: 'other.example' }, { DEV_AUTH_HEADERS: 'true' }, { RESEND_API_KEY: 'secret' }, { DATABASE_SSL: 'false', DATABASE_ALLOW_PLAINTEXT: 'false' }])
    assert.throws(() => validateProductionConfig({ ...valid, ...patch }));
assert.throws(() => validateProductionConfig({ ...valid, DATABASE_URL: 'private credential string' }), error => error instanceof Error && !error.message.includes('private credential string'));
const objects = new Map<string, Buffer>();
const storage = new PrivateObjectAdapter({ async put(key, buffer) { objects.set(key, buffer); }, async get(key) { const b = objects.get(key); if (!b)
        throw Error('Not found'); return b; }, async delete(key) { objects.delete(key); } });
const a = await storage.write(Buffer.from('private'));
const b = await storage.write(Buffer.from('private'));
assert.notEqual(a, b);
assert.equal((await storage.read(a)).toString(), 'private');
assert.throws(() => storage.read('../outside'));
await storage.remove(a);
assert.equal(objects.size, 1);
const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', "import {installShutdown} from './src/lib/runtime-lifecycle.ts';installShutdown(async()=>console.log('drained'));process.emit('SIGTERM');process.emit('SIGINT');"], { encoding: 'utf8', timeout: 5000 });
assert.equal(result.status, 0, result.stderr);
assert.equal(result.stdout.split('drained').length - 1, 1);
assert.match(result.stdout, /shutdown_complete/);
await assert.rejects(boundedQueueOperation(new Promise(()=>{}),10),{code:'QUEUE_UNAVAILABLE',statusCode:503});
console.log('PASS production configuration, secret-safe failures, private object lifecycle, traversal rejection and idempotent signal drain');
