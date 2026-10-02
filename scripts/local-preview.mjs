import { config } from 'dotenv';
import { spawn } from 'node:child_process';
if (process.env.NODE_ENV === 'production') throw new Error('Use npm start for production; local preview is loopback-only');
config({ quiet: true });
config({ path: '.env.development.local', override: true, quiet: true });
if (process.env.NODE_ENV === 'production') throw new Error('Local preview refuses production configuration');
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid preview PORT');
Object.assign(process.env, {
  NODE_ENV: 'development', STANZA_RUNTIME_PROFILE: 'local-preview',
  APP_BASE_URL: 'http://localhost:' + port, WEBAUTHN_ORIGIN: 'http://localhost:' + port,
  WEBAUTHN_RP_ID: 'localhost', TRUST_PROXY_HOPS: '0',
  DEV_AUTH_HEADERS: 'false', ALLOW_TRYCLOUDFLARE_DEV_ORIGINS: 'false',
});
const children = ['dist/server.cjs', 'dist/worker.cjs'].map(bundle =>
  spawn(process.execPath, [bundle], { stdio: 'inherit', env: process.env, windowsHide: true }));
let stopping = false;
function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill(signal);
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop(signal));
for (const child of children) {
  child.once('error', error => { console.error(error.message); process.exitCode = 1; stop(); });
  child.once('exit', code => { if (!stopping) { process.exitCode = code || 1; stop(); } });
}
