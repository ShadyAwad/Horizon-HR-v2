import assert from 'node:assert/strict';
import { readFile, mkdtemp, cp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';
import { writeServiceWorker } from './build-service-worker.mjs';

const source = await readFile('public/service-worker.js', 'utf8');
const handlers = new Map<string, (event: any) => void>();
const removed: string[] = [];
let claims = 0, fetches = 0;
const names = ['stanza-static-v10', 'stanza-runtime-v10', 'stanza-static-v11-unversioned', 'stanza-runtime-v11-unversioned', 'another-app-cache'];
runInNewContext(source, {
  self: { location: { origin: 'https://stanza.example' }, addEventListener: (name: string, fn: any) => handlers.set(name, fn), clients: { claim: () => { claims++; } } },
  caches: { keys: async () => names, delete: async (name: string) => { removed.push(name); } },
  fetch: async () => { fetches++; throw Error('owned offline control'); },
  URL, Response,
});
let activation: Promise<unknown>;
handlers.get('activate')!({ waitUntil: (promise: Promise<unknown>) => { activation = promise; } });
await activation!;
assert.deepEqual(removed, ['stanza-static-v10', 'stanza-runtime-v10']);
assert.equal(claims, 1);
for (const pathname of ['/api/auth/session', '/api/support/fixture', '/api/company-feed/images/fixture.png', '/profile-images/fixture.png']) {
  for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    let reply: Promise<Response>;
    handlers.get('fetch')!({ request: { url: 'https://stanza.example' + pathname, method }, respondWith: (response: Promise<Response>) => { reply = response; } });
    const result = await reply!;
    assert.equal(result.status, 503);
    assert.deepEqual(await result.json(), { success: false, offline: true, error: 'You are offline. Please reconnect and try again.' });
  }
}
assert.equal(fetches, 24);
console.log('PASS worker namespace cleanup and network-only API/file/mutation offline contracts');

const code = (await transform(await readFile('src/lib/pwa-chunk-recovery.ts', 'utf8'), { loader: 'ts', format: 'cjs' })).code;
let listener: (event: any) => void, reloads = 0, prevented = 0, now = 100_000, storageFails = false;
const values = new Map<string, string>();
const navigator = { onLine: true };
const env: any = { exports: {}, module: { exports: {} }, Date: { now: () => now }, navigator, window: {
  addEventListener: (_: string, fn: any) => { listener = fn; }, location: { reload: () => { reloads++; } },
  sessionStorage: { getItem: (key: string) => { if (storageFails) throw Error('storage denied'); return values.get(key) ?? null; }, setItem: (key: string, value: string) => values.set(key, value) },
} };
runInNewContext(code, env);
env.module.exports.installStaleChunkRecovery();
const trigger = () => listener!({ preventDefault: () => { prevented++; } });
trigger(); trigger(); assert.equal(reloads, 1); assert.equal(prevented, 1);
now += 60_001; navigator.onLine = false; trigger(); assert.equal(reloads, 1);
navigator.onLine = true; storageFails = true; trigger(); assert.equal(reloads, 1);
storageFails = false; trigger(); assert.equal(reloads, 2);
console.log('PASS missing-chunk single-reload window, offline and storage-denial controls');

const root = await mkdtemp(path.join(tmpdir(), 'stanza-pwa-contract-'));
try {
  const assets = [...source.match(/const STATIC_ASSETS = \[([\s\S]*?)\];/)![1].matchAll(/'([^']+)'/g)].map(match => match[1]);
  for (const asset of assets) await cp(path.join('dist', asset.slice(1)), path.join(root, asset.slice(1)), { recursive: true });
  const a = await writeServiceWorker(root), same = await writeServiceWorker(root);
  assert.equal(a, same, 'unchanged normal build assets have deterministic revision');
  await writeFile(path.join(root, 'index.html'), (await readFile(path.join(root, 'index.html'), 'utf8')) + '<!-- owned deployment marker -->');
  const b = await writeServiceWorker(root); assert.notEqual(a, b);
  assert((await readFile(path.join(root, 'service-worker.js'), 'utf8')).includes(b));
  console.log('PASS build-derived worker revision changes with shell fingerprint and remains deterministic');
} finally {
  assert.equal(path.dirname(root), tmpdir()); assert(path.basename(root).startsWith('stanza-pwa-contract-'));
  await rm(root, { recursive: true, force: true });
}