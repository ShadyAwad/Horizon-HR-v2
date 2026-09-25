import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRoot, _roots, type RenderCallback } from '@react-three/fiber';
import { createLanyardFrameScheduler, FULL_LANYARD_RATES, LIGHT_LANYARD_RATES, VERY_LIGHT_LANYARD_RATES } from '../src/components/lanyard/lanyard-frame-scheduler';

class FakeDisplay {
  time = 0;
  id = 0;
  jobs = new Map<number, { at: number; fn: () => void }>();
  now = () => this.time;
  timeout = (fn: () => void, delay: number) => { const id = ++this.id; this.jobs.set(id, { at: this.time + delay, fn }); return id; };
  clearTimeout = (id: number) => { this.jobs.delete(id); };
  raf = (fn: (now: number) => void) => this.timeout(() => fn(this.time), (Math.floor((this.time + .00001) / (1000 / 60)) + 1) * (1000 / 60) - this.time);
  cancelRaf = this.clearTimeout;
  run(ms: number) {
    const until = this.time + ms;
    for (let count = 0; count < 100000; count++) {
      const next = [...this.jobs.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > until + .000001) { this.time = until; return; }
      this.jobs.delete(next[0]); this.time = next[1].at; next[1].fn();
    }
    assert.fail('Runaway scheduler');
  }
}

// Real installed R3F root/advance/invalidator; only the GPU is replaced by a
// counted renderer. A subscriber makes the same invalidate calls Rapier makes.
const canvas = { width: 800, height: 600, style: {} } as HTMLCanvasElement;
let rendered = 0, advanced = 0, bypassRafs = 0;
const deltas: number[] = [];
globalThis.requestAnimationFrame = () => { bypassRafs++; return 999999; };
globalThis.cancelAnimationFrame = () => undefined;
const root = createRoot(canvas);
await root.configure({ frameloop: 'never', size: { width: 800, height: 600, top: 0, left: 0 }, gl: { render: () => rendered++, setSize() {}, setPixelRatio() {}, xr: { isPresenting: false } } as never });
const store = _roots.get(canvas)!.store;
const state = store.getState();
state.internal.active = true;
const callback: RenderCallback = (current, delta) => {
  deltas.push(delta);
  for (let body = 0; body < 5; body++) current.invalidate();
};
const unsubscribe = state.internal.subscribe({ current: callback }, 0, store);

for (const [label, rates] of [['full', FULL_LANYARD_RATES], ['lightweight', LIGHT_LANYARD_RATES], ['very-light', VERY_LIGHT_LANYARD_RATES]] as const) {
  for (const tier of ['active', 'passive'] as const) {
    const display = new FakeDisplay();
    const startRendered = rendered, startAdvanced = advanced;
    const startDelta = deltas.length;
    let wakes = 0;
    const scheduler = createLanyardFrameScheduler({
      host: display, initialTier: 'settled', initialTime: state.clock.elapsedTime,
      rates: () => rates,
      advance: (seconds) => { advanced++; state.advance(seconds, false); },
      onTier: (_tier, previous) => { if (previous === 'settled') wakes++; },
    });
    display.run(10000);
    assert.equal(rendered, startRendered);
    assert.equal(advanced, startAdvanced);
    scheduler.request(tier);
    scheduler.request(tier); // Duplicate pointer/mount request must be idempotent.
    display.run(5000);
    const frames = rendered - startRendered;
    assert.ok(Math.abs(frames - rates[tier] * 5) <= 1, `${label}/${tier}: ${frames} actual renders`);
    assert.equal(advanced - startAdvanced, frames);
    assert.equal(wakes, 1);
    assert.ok(Math.abs(deltas[startDelta] - 1 / 60) < .000001, 'Wake advances one fixed step, not 10 seconds');
    assert.ok(deltas.slice(startDelta).every((delta) => delta <= .1 + .000001));
    assert.ok(Math.abs(deltas.slice(startDelta).reduce((a, b) => a + b, 0) - 5) < .06, 'Steady simulation time follows wall time at every render cadence');

    scheduler.request('settled');
    const stoppedFrames = rendered, stoppedAdvances = advanced;
    display.run(5000);
    assert.equal(rendered, stoppedFrames, 'Settled 5s: zero rendered frames');
    assert.equal(advanced, stoppedAdvances, 'Settled 5s: zero advance calls');
    assert.equal(display.jobs.size, 0, 'Settled: no timer or RAF');
    scheduler.setPaused(true); scheduler.setPaused(false); display.run(5000);
    assert.equal(rendered, stoppedFrames, 'Settings/visibility resume does not wake a settled scene');
    scheduler.request('active'); display.run(100);
    scheduler.setPaused(true);
    const pausedFrames = rendered;
    display.run(10000);
    assert.equal(rendered, pausedFrames, 'Hidden/Settings: zero render frames');
    assert.equal(display.jobs.size, 0);
    const pauseDelta = deltas.length;
    scheduler.setPaused(false); display.run(100);
    assert.ok(Math.abs(deltas[pauseDelta] - 1 / 60) < .000001, 'No hidden-time catch-up');
    scheduler.dispose(); scheduler.request('active'); display.run(5000);
    assert.equal(display.jobs.size, 0, 'Unmount/StrictMode cleanup cannot restart old scheduler');
    console.log(`PASS ${label} ${tier}: ${frames} actual R3F renders / advances in 5s; wake, settled, pause, resume, cleanup`);
  }
}
assert.equal(bypassRafs, 0, 'Rapier-style invalidation never schedules a hidden R3F RAF');
unsubscribe();
state.internal.active = false;
_roots.delete(canvas);

const lanyard = readFileSync('src/components/lanyard/Lanyard.tsx', 'utf8');
assert.match(lanyard, /frameloop="never"/);
assert.equal((lanyard.match(/advance\(simulationTime, false\)/g) ?? []).length, 1);
assert.match(lanyard, /timeStep=\{1 \/ 60\}/);
assert.match(lanyard, /if \(!gesture && !isDraggingRef.current\) return;/);
assert.match(lanyard, /Boolean\(pointerGestureRef.current\) \|\| isDraggingRef.current/, 'Holding pointer down must not resettle before the drag threshold');
assert.doesNotMatch(lanyard, /invalidate\(\)/);
assert.match(lanyard, /import.meta.env.DEV && <LanyardPhysicsProbe/);
console.log('PASS real R3F never-loop rejects Rapier bypass, preserves frame ownership and cumulative-seconds advance contract');

const { summarizeLanyardCapture } = await import('../src/components/dev/lanyard-comparison');
const sample = (at: number, kind: string, duration = 0) => ({ at, kind, duration, tier: 'active' });
const comparison = summarizeLanyardCapture([
  sample(0, 'frame'), sample(10, 'wake'), sample(100, 'drag-start'),
  sample(110, 'frame'), sample(110, 'render', 2), sample(110, 'physics', .5),
  sample(130, 'frame'), sample(130, 'pointer', .1), sample(130, 'pointer-target', .2),
  sample(5100, 'drag-end'), sample(5500, 'frame'), sample(5600, 'settled'),
  sample(6000, 'drag-start'), sample(6100, 'drag-end'),
]);
assert.equal(comparison.gestures[0].durationMs, 5000);
assert.equal(comparison.gestures[0].sustainedFiveSeconds, true);
assert.equal(comparison.gestures[0].settleMs, 500);
assert.equal(comparison.gestures[0].work.actualFrames, 2);
assert.equal(comparison.gestures[0].work.averageFrameIntervalMs, 20);
assert.equal(comparison.gestures[0].work.actualFps, 50);
assert.equal(comparison.gestures[0].work.renderSubmission.totalMs, 2);
assert.equal(comparison.gestures[0].work.physics.totalMs, .5);
assert.equal(comparison.gestures[0].work.pointerHandler.totalMs, .1);
assert.equal(comparison.gestures[0].work.pointerTarget.totalMs, .2);
assert.equal(comparison.gestures[1].sustainedFiveSeconds, false);
assert.equal(comparison.gestures[1].settleMs, null);
assert.equal(comparison.wakeCount, 1);
assert.equal(summarizeLanyardCapture([]).wholeCapture.averageFrameIntervalMs, null);
assert.equal(summarizeLanyardCapture([sample(0, 'drag-start')]).gestures[0].durationMs, null);
assert.equal(summarizeLanyardCapture([sample(0, 'drag-start'), sample(10, 'drag-end'), sample(20, 'drag-start'), sample(30, 'settled')]).gestures[0].settleMs, null);
console.log('PASS manual comparison separates sustained gestures, settling, missing samples, and CPU work categories');

// Exercise DEV-only GPU experiment expiry and production inertness without a browser.
const { build } = await import('esbuild');
async function gpuModule(dev: boolean) {
  const bundled = await build({ entryPoints: ['src/lib/dev-gpu-experiments.ts'], bundle: true, write: false, format: 'esm', platform: 'node', define: { 'import.meta.env.DEV': String(dev) } });
  return import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
}
const gpuDev = await gpuModule(true);
const gpuProduction = await gpuModule(false);
const originalWindow = (globalThis as any).window;
const originalTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
const timers = new Map<number, () => void>();
const browserEvents = new EventTarget();
let gpuEvents = 0;
browserEvents.addEventListener('stanza-gpu-experiment', () => gpuEvents++);
try {
  (globalThis as any).window = browserEvents;
  (globalThis as any).setTimeout = (callback: () => void, delay: number) => { assert.equal(delay, 15000); timers.set(1, callback); return 1; };
  (globalThis as any).clearTimeout = (id: number) => timers.delete(id);
  gpuDev.setDevGpuExperiment({ surface: 'alpha-opaque', forceActive: true });
  assert.equal(gpuDev.getDevGpuExperiment().surface, 'alpha-opaque');
  assert.equal(gpuDev.getDevGpuExperiment().forceActive, true);
  const snapshot = gpuDev.getDevGpuExperiment(); snapshot.dpr = .75;
  assert.equal(gpuDev.getDevGpuExperiment().dpr, 1, 'Snapshots cannot mutate the current experiment');
  timers.get(1)!();
  assert.equal(gpuDev.getDevGpuExperiment().forceActive, false, 'Forced rendering expires without user cleanup');
  gpuDev.setDevGpuExperiment({ forceActive: true });
  gpuDev.resetDevGpuExperiment();
  assert.equal(timers.size, 0, 'Reset clears the forced-render deadline');
  assert.equal(gpuDev.getDevGpuExperiment().surface, 'current');
  const before = gpuEvents;
  gpuProduction.setDevGpuExperiment({ forceActive: true, antialias: false, surface: 'alpha-opaque' });
  assert.equal(gpuEvents, before, 'Production never dispatches diagnostic actions');
  assert.equal(timers.size, 0);
  assert.deepEqual(gpuProduction.getDevGpuExperiment(), { surface: 'current', isolation: 'current', antialias: true, dpr: 1, forceActive: false });
} finally {
  (globalThis as any).window = originalWindow;
  globalThis.setTimeout = originalTimeout;
  globalThis.clearTimeout = originalClearTimeout;
}
console.log('PASS GPU diagnostics expire, reset safely, isolate snapshots, and stay inert in production');
