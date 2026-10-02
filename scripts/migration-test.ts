import path from 'node:path';
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import net from 'node:net';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { Pool } from 'pg';
import { getDbPool } from '../src/lib/hr-background';
import { applyMigrations } from './migration-order';
import { assertDatabaseMutationSafety } from './mutation-safety';
// CREATE/DROP is restricted to a newly generated database, never the configured database.
const { databaseUrl } = assertDatabaseMutationSafety(process.env.DATABASE_URL, 'Disposable migration checks');
const name = 'stanza_migration_test_' + crypto.randomBytes(12).toString('hex');
assert.match(name, /^stanza_migration_test_[a-f0-9]{24}$/);
const admin = getDbPool();
const target = new URL(databaseUrl);
target.pathname = '/' + name;
const pool = new Pool({ connectionString: target.toString(), ssl: admin.options.ssl });
pool.on('error', error => console.error('Temporary database connection:', error.message));
admin.on('error', error => console.error('Migration administration connection:', error.message));
let created = false;
const env: NodeJS.ProcessEnv & {
    DEMO_PASSWORD: string;
} = { ...process.env, DATABASE_URL: target.toString(), NODE_ENV: 'test', ALLOW_TEST_DATA_MUTATION: 'true', TEST_DATABASE_ALLOWLIST: name, DEMO_DATABASE_ALLOWLIST: name, DEMO_DATABASE_NAME: name, DEMO_TENANT_ID: '', ALLOW_DEMO_DATA_MUTATION: 'true', DEMO_PASSWORD: 'Aa1!' + crypto.randomBytes(24).toString('base64url'), RESEND_API_KEY: '', EMAIL_FROM: '', STANZA_DEMO_ENV: 'false', DEV_AUTH_HEADERS: 'false', ALLOW_TRYCLOUDFLARE_DEV_ORIGINS: 'false', ORGANISATION_CONCURRENCY_TEST: 'true' };
function run(script: string, args: string[] = [], extra: NodeJS.ProcessEnv = {}) {
    const result = spawnSync(process.execPath, ['--import', 'tsx', script, ...args], { env: { ...env, ...extra }, stdio: 'inherit' });
    assert.equal(result.status, 0, script + ' failed');
}
async function freePort() { const socket = net.createServer(); await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve)); const port = (socket.address() as net.AddressInfo).port; await new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve())); return port; }
async function stop(child: ChildProcess) {
    if (child.exitCode !== null)
        return;
    const ended = new Promise<void>(resolve => child.once('exit', () => resolve()));
    child.kill();
    await ended;
}
async function withServer(script: string, args: string[], key: string) {
    const port = await freePort(), base = 'http://localhost:' + port;
    const child = spawn(process.execPath, ['--throw-deprecation', 'dist/server.cjs'], { env: { ...env, NODE_ENV: 'production', PORT: String(port), APP_BASE_URL: base, WEBAUTHN_ORIGIN: base, WEBAUTHN_RP_ID: 'localhost', QR_TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'), TRUST_PROXY_HOPS: '0', DATABASE_SSL: 'false', DATABASE_ALLOW_PLAINTEXT: 'true', PROFILE_IMAGE_DIRECTORY: path.resolve('uploads/profile-images'), COMPANY_FEED_IMAGE_DIRECTORY: path.resolve('uploads/company-feed'), ASSET_EVIDENCE_DIRECTORY: path.resolve('uploads/assets'), GRIEVANCE_ATTACHMENT_DIRECTORY: path.resolve('uploads/private-grievances') }, stdio: ['ignore', 'ignore', 'inherit'] });
    try {
        let ready = false;
        for (let i = 0; i < 100; i++) {
            if (child.exitCode !== null)
                throw Error('Preview server exited');
            try {
                const response = await fetch(base + '/api/system/health');
                if (response.ok) {
                    ready = true;
                    break;
                }
            }
            catch { }
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        assert(ready, 'Preview health timeout');
        run(script, args, { [key]: base, SMOKE_TEST_EMAIL: 'admin@stanza-demo.com', SMOKE_TEST_PASSWORD: env.DEMO_PASSWORD, RELIABILITY_ADMIN_EMAIL: 'admin@stanza-demo.com', RELIABILITY_ADMIN_PASSWORD: env.DEMO_PASSWORD, RELIABILITY_EMPLOYEE_EMAIL: 'employee@stanza-demo.com', RELIABILITY_EMPLOYEE_PASSWORD: env.DEMO_PASSWORD });
    }
    finally {
        await stop(child);
    }
}
try {
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
    created = true;
    await pool.query(fs.readFileSync('src/db/schema.sql', 'utf8'));
    await applyMigrations(pool);
    console.log('PASS fresh migration pass');
    // Non-demo control data makes isolation checks non-vacuous.
    const control = (await pool.query("INSERT INTO tenants(slug,company_name) VALUES('migration-control','Migration control') RETURNING id")).rows[0].id;
    await pool.query("INSERT INTO employees(tenant_id,email,full_name,role,password_hash) VALUES($1,'control@example.invalid','Untouched control','employee',$2)", [control, await bcrypt.hash(crypto.randomBytes(24).toString('base64url'), 10)]);
    run('scripts/seed-demo.ts', [], { STANZA_DEMO_ENV: 'true' });
    const fingerprint = async () => {
        const result: Record<string, string> = {};
        for (const table of ['employees', 'grievances', 'expense_claims', 'time_logs'])
            result[table] = (await pool.query("SELECT md5(COALESCE(string_agg(to_jsonb(r)::text,'' ORDER BY id),'')) AS hash FROM " + table + " r")).rows[0].hash;
        return result;
    };
    const before = await fingerprint();
    await applyMigrations(pool);
    assert.deepEqual(await fingerprint(), before, 'Migration replay must preserve populated employee/case/expense/attendance records');
    console.log('PASS populated migration replay preserves business records');
    run('scripts/demo-seed-test.ts', [], { STANZA_DEMO_ENV: 'true' });
    if (process.argv.includes('--with-integration')) {
        run('scripts/grievances-migration-test.ts');
        run('scripts/grievances-test.ts');
        run('scripts/communications-test.ts');
        run('scripts/organisation-final-admin-concurrency-test.ts');
        await withServer('scripts/attendance-integration-test.ts', [], 'ATTENDANCE_TEST_BASE_URL');
        await withServer('scripts/hiring-role-ux-test.ts', ['--with-hiring-integration'], 'HIRING_ROLE_TEST_BASE_URL');
        await withServer('scripts/communications-session-test.ts', [], 'COMMUNICATIONS_TEST_BASE_URL');
        await withServer('scripts/api-routing-test.ts', [], 'API_ROUTING_TEST_BASE_URL');
        await withServer('scripts/sessions-test.ts', [], 'SESSIONS_TEST_BASE_URL');
        await withServer('scripts/audit-test.ts', [], 'AUDIT_TEST_BASE_URL');
    }
    if (process.argv.includes('--with-smoke') || process.argv.includes('--with-integration')) {
        await withServer('scripts/smoke-test.ts', [], 'SMOKE_TEST_BASE_URL');
        await withServer('scripts/reliability-integration-test.ts', [], 'RELIABILITY_TEST_BASE_URL');
    }
    if (process.argv.includes('--operations')) {
        if (!process.env.WORKER_SMOKE_REDIS_URL)
            throw Error('Deployment test requires dedicated WORKER_SMOKE_REDIS_URL');
        env.REDIS_URL = process.env.WORKER_SMOKE_REDIS_URL;
        await withServer('scripts/deployment-http-test.ts', [], 'OPERATIONS_BASE_URL');
        await deploymentProcesses();
    }
    if (process.argv.includes('--dev-smoke'))
        await devSmoke();
    console.log('PASS fresh bootstrap, ordered/repeat migrations, seeded integrity and non-demo isolation.');
}
catch (error) {
    console.error('Migration validation failed:', error instanceof Error ? error.message : 'Unknown error');
    process.exitCode = 1;
}
finally {
    await pool.end();
    if (created) {
        await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [name]);
        await admin.query(`DROP DATABASE "${name}"`);
    }
    await admin.end();
}
async function devSmoke() {
    const dedicatedRedis = process.env.WORKER_SMOKE_REDIS_URL;
    if (!dedicatedRedis)
        throw new Error('Dev smoke requires WORKER_SMOKE_REDIS_URL for a dedicated local Redis instance.');
    const redis = new URL(dedicatedRedis);
    if (redis.protocol !== 'redis:' || !['localhost', '127.0.0.1', '[::1]'].includes(redis.hostname))
        throw new Error('Worker smoke Redis must be local and isolated.');
    env.REDIS_URL = dedicatedRedis;
    const port = await freePort(), base = 'http://localhost:' + port;
    const child = process.platform === 'win32'
        ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm run dev'], { env: { ...env, NODE_ENV: 'development', PORT: String(port), APP_BASE_URL: base, WEBAUTHN_ORIGIN: base, DISABLE_HMR: 'true' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
        : spawn('npm', ['run', 'dev'], { env: { ...env, NODE_ENV: 'development', PORT: String(port), APP_BASE_URL: base, WEBAUTHN_ORIGIN: base, DISABLE_HMR: 'true' }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', serverOutput = '', workerReady = false;
    const capture = (data: Buffer) => { output = (output + data.toString()).slice(-20000); workerReady ||= output.includes('Redis connection ready.'); serverOutput += (data.toString().split('\n').filter((line: string) => line.includes('[Server]')).join('\n')); serverOutput = serverOutput.slice(-8000); };
    child.stdout?.on('data', capture);
    child.stderr?.on('data', capture);
    try {
        let ready = false;
        const startupDeadline = Date.now() + 60000;
        while (Date.now() < startupDeadline) {
            if (child.exitCode !== null)
                throw Error('Development process exited');
            try {
                const response = await fetch(base + '/api/system/health', { signal: AbortSignal.timeout(2000) });
                const health = await response.json();
                if (response.ok && health.queue && health.database.configured && workerReady) {
                    ready = true;
                    break;
                }
            }
            catch { }
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        assert(ready, 'Development health/worker ready timeout: ' + output.slice(0, 4000));
        let response: Response | undefined;
        let transportError = '';
        const loginDeadline = Date.now() + 30000;
        while (Date.now() < loginDeadline) {
            try {
                response = await fetch(base + '/api/auth/login', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@stanza-demo.com', password: env.DEMO_PASSWORD }), signal: AbortSignal.timeout(3000) });
                break;
            }
            catch (error) {
                const fault = error as Error & {
                    cause?: {
                        code?: string;
                    };
                };
                transportError = fault.message + ' ' + (fault.cause?.code || '');
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        }
        assert(response, 'Development login transport unavailable: ' + transportError + '; server: ' + serverOutput);
        assert.equal(response.status, 200, 'Development fixture login');
        assert.match(response.headers.get('set-cookie') || '', /HttpOnly/i);
        console.log('PASS npm run dev: server health, configured database, Redis-connected worker and standard cookie login.');
    }
    finally {
        if (child.pid && child.exitCode === null) {
            if (process.platform === 'win32') {
                const stopped = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, encoding: 'utf8' });
                if (stopped.status !== 0)
                    throw new Error('Unable to stop owned dev process tree: ' + stopped.stderr);
            }
            else
                process.kill(-child.pid, 'SIGTERM');
        }
    }
}
async function deploymentProcesses() {
    const config = { ...env, NODE_ENV: 'production', APP_BASE_URL: 'http://localhost:3000', WEBAUTHN_ORIGIN: 'http://localhost:3000', WEBAUTHN_RP_ID: 'localhost', QR_TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'), TRUST_PROXY_HOPS: '0', DATABASE_SSL: 'false', DATABASE_ALLOW_PLAINTEXT: 'true', PROFILE_IMAGE_DIRECTORY: path.resolve('uploads/profile-images'), COMPANY_FEED_IMAGE_DIRECTORY: path.resolve('uploads/company-feed'), ASSET_EVIDENCE_DIRECTORY: path.resolve('uploads/assets'), GRIEVANCE_ATTACHMENT_DIRECTORY: path.resolve('uploads/private-grievances') };
    run('scripts/background-durability-test.ts', [], { REDIS_URL: 'redis://127.0.0.1:1' });
    const worker = spawn(process.execPath, ['dist/worker.cjs'], { env: config, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    worker.stdout?.on('data', b => { output += b.toString(); });
    worker.stderr?.on('data', b => { output += b.toString(); });
    try {
        const deadline = Date.now() + 15000;
        while (!output.includes('Redis connection ready.') && Date.now() < deadline && worker.exitCode === null)
            await new Promise(r => setTimeout(r, 100));
        assert(output.includes('Redis connection ready.'), 'Production worker startup: ' + output);
        console.log('PASS built production worker starts with Redis');
        const completedDeadline = Date.now() + 15000;
        let completed = false;
        while (Date.now() < completedDeadline) {
            const result = await pool.query("SELECT count(*)::int AS count FROM audit_logs WHERE action='operations_recovery_probe'");
            if (result.rows[0].count === 1) {
                completed = true;
                break;
            }
            await new Promise(r => setTimeout(r, 200));
        }
        assert(completed, 'Pending dispatch must recover after worker starts');
        const pending = await pool.query("SELECT count(*)::int AS count FROM outbox_events WHERE event_type='background.hr' AND processed_at IS NULL");
        assert.equal(pending.rows[0].count, 0);
        console.log('PASS worker recovers durable pending audit without duplication');
    }
    finally {
        await stop(worker);
    }
    for (const patch of [{ REDIS_URL: 'redis://127.0.0.1:1' }, { DATABASE_URL: 'postgres://invalid:invalid@127.0.0.1:1/unavailable' }]) {
        const port = await freePort();
        const child = spawn(process.execPath, ['dist/server.cjs'], { env: { ...config, ...patch, PORT: String(port) }, stdio: 'ignore' });
        try {
            let live = false;
            for (let i = 0; i < 50; i++) {
                try {
                    live = (await fetch('http://localhost:' + port + '/api/system/live', { signal: AbortSignal.timeout(1000) })).ok;
                    if (live)
                        break;
                }
                catch { }
                await new Promise(r => setTimeout(r, 100));
            }
            assert(live, 'Liveness survives dependency outage');
            const started = Date.now();
            const result = await fetch('http://localhost:' + port + '/api/system/ready', { signal: AbortSignal.timeout(5000) });
            assert.equal(result.status, 503);
            assert(Date.now() - started < 5000);
            assert.deepEqual(await result.json(), { success: false });
        }
        finally {
            await stop(child);
        }
    }
    const securePort = await freePort(), publicOrigin = 'https://stanza.example';
    const secureWeb = spawn(process.execPath, ['dist/server.cjs'], { env: { ...config, PORT: String(securePort), APP_BASE_URL: publicOrigin, WEBAUTHN_ORIGIN: publicOrigin, WEBAUTHN_RP_ID: 'stanza.example' }, stdio: 'ignore' });
    try {
        let alive = false;
        for (let i = 0; i < 50; i++) {
            try {
                alive = (await fetch('http://localhost:' + securePort + '/api/system/live')).ok;
                if (alive)
                    break;
            }
            catch { }
            await new Promise(r => setTimeout(r, 100));
        }
        assert(alive);
        const response = await fetch('http://localhost:' + securePort + '/api/auth/login', { method: 'POST', headers: { Origin: publicOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@stanza-demo.com', password: env.DEMO_PASSWORD }) });
        assert.equal(response.status, 200);
        assert.match(response.headers.get('set-cookie') || '', /; Secure/i);
        console.log('PASS canonical public HTTPS origin forces Secure cookies behind a local ingress');
    }
    finally {
        await stop(secureWeb);
    }
    console.log('PASS bounded PostgreSQL/Redis readiness failures without infrastructure disclosure');
}
