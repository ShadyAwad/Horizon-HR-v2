import assert from 'node:assert/strict';
import express from 'express';
import { registerAttendanceStatusRoutes } from '../src/server/attendance/attendance-routes';
const previous = { url: process.env.DATABASE_URL, mode: process.env.NODE_ENV, demo: process.env.STANZA_DEMO_ENV };
delete process.env.DATABASE_URL;
const app = express();
app.use(express.json());
registerAttendanceStatusRoutes(app, { authWhenDatabaseConfigured: (_req, _res, next) => next(), mutationGuard: (_req, _res, next) => next() });
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address();
assert(address && typeof address !== 'string');
const base = `http://127.0.0.1:${address.port}`;
try {
    process.env.STANZA_DEMO_ENV = 'true';
    process.env.NODE_ENV = 'production';
    assert.equal((await fetch(base + '/api/clock-status')).status, 503);
    assert.equal((await fetch(base + '/api/clock-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 503);
    process.env.NODE_ENV = 'development';
    assert.equal((await fetch(base + '/api/clock-status')).status, 200);
    process.env.STANZA_DEMO_ENV = 'false';
    assert.equal((await fetch(base + '/api/clock-status')).status, 503);
    console.log('PASS no-database demo attendance is explicitly opted in and unavailable in production.');
}
finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    for (const [key, value] of [['DATABASE_URL', previous.url], ['NODE_ENV', previous.mode], ['STANZA_DEMO_ENV', previous.demo]])
        if (value === undefined)
            delete process.env[key!];
        else
            process.env[key!] = value;
}
