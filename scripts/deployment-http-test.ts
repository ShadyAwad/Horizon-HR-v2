import assert from 'node:assert/strict';
const base = process.env.OPERATIONS_BASE_URL!;
for (const route of ['live', 'ready', 'health']) {
    const response = await fetch(base + '/api/system/' + route, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200, route);
    assert.equal((await response.json()).success, true);
    assert.match(response.headers.get('x-request-id') || '', /^[0-9a-f-]{36}$/);
    assert.match(response.headers.get('cache-control') || '', /no-store/);
}
for (const file of ['server.cjs', 'worker.cjs', 'migrate.cjs'])
    assert.equal((await fetch(base + '/' + file)).status, 404, file + ' must not be public');
const response = await fetch(base + '/api/auth/login', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '203.0.113.99', 'X-Request-ID': 'untrusted-id' }, body: JSON.stringify({ email: 'admin@stanza-demo.com', password: process.env.DEMO_PASSWORD }) });
assert.equal(response.status, 200);
const cookie = response.headers.get('set-cookie') || '';
assert.match(cookie, /HttpOnly/);
assert.match(cookie, /SameSite=Lax/);
assert(!/; Secure/i.test(cookie), 'Untrusted forwarded protocol must not alter direct localhost cookies');
assert.notEqual(response.headers.get('x-request-id'), 'untrusted-id');
const authCookie = cookie.split(';')[0];
for (const route of ['/api/hr/organisation/permission-registry', '/api/hr/organisation/hierarchy', '/api/hr/assets', '/api/hr/software-licenses']) {
    const page = await fetch(base + route, { headers: { Cookie: authCookie } });
    assert.equal(page.status, 200, route);
}
console.log('PASS built web liveness/readiness, private cache, request IDs, artifact protection, login and forwarding-spoof protection');
