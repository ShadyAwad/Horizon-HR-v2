import assert from 'node:assert/strict';
import { ApiResponseError, readApiJson } from '../src/lib/api-response';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
assert.deepEqual(await readApiJson(json({ success: true })), { success: true });
for (const [response, code, message] of [
  [new Response('<!doctype html><html>Private proxy output</html>', { headers: { 'Content-Type': 'text/html' } }), 'UNEXPECTED_RESPONSE', 'Attendance service returned an unexpected response.'],
  [new Response('{broken', { headers: { 'Content-Type': 'application/json' } }), 'INVALID_JSON', 'Attendance service returned invalid JSON.'],
  [json({}, 401), 'AUTH_REQUIRED', 'Your session is unavailable or expired. Please sign in again.'],
  [json({ error: 'Permission denied' }, 403), 'API_ERROR', 'Permission denied'],
  [json({ error: 'Outside geofence' }, 400), 'API_ERROR', 'Outside geofence'],
] as const) {
  await assert.rejects(readApiJson(response), (error: unknown) => error instanceof ApiResponseError && error.code === code && error.message === message);
}
assert.deepEqual(await readApiJson(json({ error: 'Already clocked in' }, 409), 'Attendance service', { allowErrorResponse: true }), { error: 'Already clocked in' });
console.log('PASS JSON parsing: success, HTML, malformed JSON, authentication and API errors');

// Read-only live checks; run against both full-stack development and production servers.
const base = new URL(process.env.API_ROUTING_TEST_BASE_URL || 'http://localhost:3000').origin;
for (const path of ['/api/attendance/policy', '/api/attendance/breaks?team=true', '/api/attendance/history', '/api/clock-status']) {
  const response = await fetch(base + path, { headers: { Accept: 'text/html' } });
  assert.equal(response.status, 401, `${path}: mounted route must require a session`);
  assert.match(response.headers.get('content-type') || '', /^application\/json\b/);
  assert.equal((await response.json()).success, false);
  console.log(`PASS ${base}${path}: 401 JSON (mounted, authentication enforced)`);
}
for (const method of ['GET', 'POST']) {
  const response = await fetch(base + '/api/__routing_regression_missing__', { method, headers: { Accept: 'text/html', Origin: base } });
  assert.equal(response.status, 404);
  assert.match(response.headers.get('content-type') || '', /^application\/json\b/);
  assert.equal((await response.json()).code, 'API_ROUTE_NOT_FOUND');
}
const page = await fetch(base + '/__routing_regression_spa__', { headers: { Accept: 'text/html' } });
assert.equal(page.status, 200);
assert.match(page.headers.get('content-type') || '', /^text\/html\b/);
assert.match(await page.text(), /<!doctype html>/i);
console.log(`PASS ${base}: unknown API GET/POST return JSON 404; frontend navigation remains HTML`);
