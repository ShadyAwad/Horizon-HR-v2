import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createCanvasCadence } from '../src/lib/login-canvas-scheduler';
import type { AuthVisualState } from '../src/auth/auth-contract';

let now = 0, next = 0, hidden = false, draws = 0;
let state: AuthVisualState = 'idle';
const frames = new Map<number, (time: number) => void>();
const timers = new Map<number, { callback: () => void; at: number }>();
const cadence = createCanvasCadence({
  now: () => now, hidden: () => hidden,
  raf: (callback) => { const id = ++next; frames.set(id, callback); return id; },
  cancelRaf: (id) => { frames.delete(id); },
  timer: (callback, delay) => { const id = ++next; timers.set(id, { callback, at: now + delay }); return id; },
  cancelTimer: (id) => { timers.delete(id); },
}, () => { draws++; cadence.request(false); }, () => state);
function tick(time: number) {
  now = time;
  for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
  const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback(time));
}
cadence.request(); cadence.request();
assert.equal(frames.size, 1);
tick(0);
assert.equal(draws, 1);
assert.equal(frames.size, 0, 'idle must not keep a full-rate RAF skip loop');
assert.equal(timers.size, 1);
for (let i = 1; i <= 600; i++) tick(i * 1000 / 60);
assert.ok(draws >= 195 && draws <= 242, `10 seconds at 60Hz: ${draws} draws`);
console.log(`PASS: idle cadence ${draws} draws in 10 simulated seconds (timer + vsync).`);
cadence.request(); // Theme/resize invalidation preempts the pending idle timer.
assert.equal(timers.size, 0); assert.equal(frames.size, 1);
for (const active of ['loading', 'success', 'error'] as const) {
  state = active; cadence.request(); tick(now + 16.667);
  assert.equal(frames.size, 1); assert.equal(timers.size, 0);
}
state = 'idle'; cadence.request(); tick(now + 16.667);
assert.equal(frames.size, 0); assert.equal(timers.size, 1);
hidden = true; cadence.cancel(); cadence.request();
assert.equal(frames.size + timers.size, 0);
hidden = false; cadence.request(); assert.equal(frames.size, 1);
cadence.stop(); cadence.request(); assert.equal(frames.size + timers.size, 0);
const output = await build({ entryPoints: ['src/components/FingerprintCanvas.tsx'], bundle: true,
  write: false, format: 'esm', minify: true, external: ['react', 'react/jsx-runtime'],
  define: { 'import.meta.env.DEV': 'false', 'import.meta.env.LOGIN_IDLE_CANVAS_DIAGNOSTIC': 'false' } });
assert.doesNotMatch(output.outputFiles[0].text, /loginCanvasScheduler|__stanzaCanvasSchedulers|rafPerSecond|drawFramePerSecond|loginCanvasTest|LOGIN_CANVAS_DIAGNOSTIC/);
assert.match(output.outputFiles[0].text, /41\.666666666666664/);
console.log('PASS: invalidation, active states, settle, hidden/resume, disposal, production exclusion.');
