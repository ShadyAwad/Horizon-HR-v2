import assert from 'node:assert/strict';
import { safeErrorCode, logServerError } from '../src/lib/server-logging';
assert.equal(safeErrorCode({ code: '23505', detail: 'private employee record' }), '23505');
assert.equal(safeErrorCode({ code: 'PERMISSION_DENIED', message: 'private complaint' }), 'PERMISSION_DENIED');
assert.equal(safeErrorCode({ statusCode: 403 }), 'HTTP_403');
for (const error of [null, 'secret reset token', { code: 'private@example.invalid' }, { code: 'A'.repeat(65) }, { statusCode: NaN }, { statusCode: 200 }, new Error('provider key and body')])
    assert.equal(safeErrorCode(error), 'INTERNAL_ERROR');
const captured: unknown[][] = [];
const original = console.error;
try {
    console.error = (...args: unknown[]) => { captured.push(args); };
    logServerError('[Operation] Failed:', { code: '23514', message: 'secret', detail: 'private record', stack: 'credentials', password: 'secret' });
}
finally {
    console.error = original;
}
assert.deepEqual(JSON.parse(captured[0][0] as string), {level:'error',operation:'[Operation] Failed:',code:'23514'});
assert.equal(captured.length,1);
console.log('PASS operational errors expose only bounded codes and context, without SQL details, bodies or credentials.');
