import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import vm from 'node:vm';
import { build } from 'esbuild';

const css = readFileSync('src/index.css', 'utf8');
const attendance = readFileSync('src/components/attendance/AttendanceWorkspace.tsx', 'utf8');
const dashboard = readFileSync('src/pages/Dashboard.tsx', 'utf8');
const clockRule = css.match(/button\.stanza-theme-primary\.stanza-geo-clock-primary,\s*button\.stanza-theme-primary\.stanza-geo-clock-primary:not\(:disabled\):hover\s*\{([^}]+)\}/)![1];
assert.match(clockRule, /background: linear-gradient\(.+\) var\(--stanza-accent\) !important/);
for (const [state, token] of [['', 'accent'], [':not(:disabled):hover', 'accent-hover']]) {
  const selector = `button.stanza-theme-primary.stanza-geo-break-primary${state}`;
  const block = css.slice(css.indexOf(selector + ' {')).split('}')[0];
  assert.ok(block.includes(`background: var(--stanza-${token}) !important;`));
  assert.ok(!block.includes('gradient'));
}
assert.match(dashboard, /clockInState === 'idle' \? "stanza-theme-primary stanza-geo-clock-primary"/);
assert.ok(attendance.includes('stanza-theme-primary stanza-geo-break-primary'), 'Break action uses shared themed fill');
const clockClasses = dashboard.slice(dashboard.indexOf('data-geo-interaction="clock"'), dashboard.indexOf('data-geo-interaction="clock"') + 1300);
assert.doesNotMatch(clockClasses, /hover:scale|active:scale|transition-transform/);
assert.match(css, /button\.stanza-geo-clock:not\(:disabled\):is\(:hover, :active\),\s*button\.stanza-geo-break-primary:not\(:disabled\):is\(:hover, :active\)\s*\{\s*transform: none;\s*scale: none;/);

async function mount(source: string, reduced = false, trace = false, staticMode = false, production = false, idleMode: string | undefined = undefined) {
  const output = await build({ stdin: { contents: source, resolveDir: process.cwd() + '/src/components', loader: 'tsx' }, bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react/jsx-runtime'], define: { 'import.meta.env.DEV': String(!production), 'import.meta.env.LOGIN_IDLE_CANVAS_DIAGNOSTIC': String(idleMode !== undefined) } });
  let reads = 0, tokens = 0, parses = 0, classReads = 0, dark = true, nextId = 1;
  let frameTime: number | undefined;
  let clock = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const drawing: string[] = [];
  const record = (...args: unknown[]) => { if (trace) drawing.push(JSON.stringify(args)); };
  const effects: (() => void | (() => void))[] = [], cleanups: (() => void)[] = [];
  const raf = new Map<number, (time: number) => void>();
  const listeners = new Map<string, () => void>();
  const mutations: { callback: () => void; disconnected: boolean; options?: any }[] = [];
  const resizes: { callback: (entries: any[]) => void; disconnected: boolean }[] = [];
  let colors: Record<string, string> = { '--stanza-auth-background': '#020604', '--stanza-auth-ring-rgb': '16, 185, 129', '--stanza-auth-pulse-rgb': '52, 211, 153' };
  const gradient = { addColorStop(...args: unknown[]) { record('addColorStop', ...args); } };
  const context = new Proxy({ createRadialGradient: (...args: unknown[]) => { record('createRadialGradient', ...args); return gradient; } } as any, {
    get(target, key) { return target[key] ?? ((...args: unknown[]) => record(key, ...args)); },
    set(target, key, value) { record('set', key, value === gradient ? 'gradient' : value); target[key] = value; return true; },
  });
  const canvas = { parentElement: { getBoundingClientRect: () => ({ width: 1920, height: 1080 }) }, style: {}, getContext: () => context };
  const refs: { current: any }[] = [];
  let refIndex = 0;
  const react = { useRef: (current: unknown) => refs[refIndex++] ?? (refs[refIndex - 1] = { current }), useEffect: (fn: any) => effects.push(fn) };
  const jsx = (_type: unknown, props: any) => { if (_type === 'canvas') props.ref.current = canvas; return null; };
  const root = { classList: { contains: () => { classReads++; return dark; } } };
  const document = { hidden: false, documentElement: root, addEventListener: (name: string, fn: () => void) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name) };
  const window: any = { location: { search: '' }, devicePixelRatio: 1, matchMedia: () => ({ matches: reduced }), setTimeout: (callback: () => void, delay: number) => { const id = nextId++; timers.set(id, { at: (frameTime ?? clock) + delay, callback }); return id; }, clearTimeout: (id: number) => timers.delete(id) };
  const sandbox: any = { module: { exports: {} }, Number: class extends Number { static parseInt(value: string, radix?: number) { parses++; return Number.parseInt(value, radix); } }, performance: { now: () => frameTime ?? clock }, URLSearchParams, window, document, console,
    require: (name: string) => name === 'react' ? react : { jsx, jsxs: jsx },
    getComputedStyle: () => { reads++; return { getPropertyValue: (key: string) => { tokens++; return colors[key] || ''; } }; },
    requestAnimationFrame: (fn: (time: number) => void) => { const id = nextId++; raf.set(id, fn); return id; },
    cancelAnimationFrame: (id: number) => raf.delete(id),
    MutationObserver: class { record: any; constructor(callback: () => void) { this.record = { callback, disconnected: false }; mutations.push(this.record); } observe(_root: any, options: any) { this.record.options = options; } disconnect() { this.record.disconnected = true; } },
    ResizeObserver: class { record: any; constructor(callback: any) { this.record = { callback, disconnected: false }; resizes.push(this.record); } observe() { this.record.callback([{ contentRect: { width: 1920, height: 1080 } }]); } disconnect() { this.record.disconnected = true; } },
  };
  if (idleMode !== undefined) {
    (window as any).location = { search: '?loginIdleCanvas=' + idleMode };
    (sandbox as any).URLSearchParams = URLSearchParams;
  }
  vm.runInNewContext(output.outputFiles[0].text, sandbox);
  sandbox.module.exports.FingerprintCanvas({ pulseState: 'idle', staticMode });
  for (const fn of effects) { const cleanup = fn(); if (cleanup) cleanups.push(cleanup); }
  return {
    raf, timers, window, mutations, resizes, context, drawing,
    get parses() { return parses; }, get classReads() { return classReads; },
    get reads() { return reads; }, get tokens() { return tokens; },
    frame(time: number) { clock = time; frameTime = time; for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.callback(); } const callbacks = [...raf.values()]; raf.clear(); assert.equal(callbacks.length, 1); const start = performance.now(); callbacks[0](time); frameTime = undefined; return performance.now() - start; },
    state(pulseState: string, start: number, onPulseComplete: () => void) {
      frameTime = start; refIndex = 0; effects.length = 0;
      sandbox.module.exports.FingerprintCanvas({ pulseState, staticMode, onPulseComplete });
      effects[0](); frameTime = undefined;
    },
    theme() { dark = false; colors = { '--stanza-auth-background': '#ffffff', '--stanza-auth-ring-rgb': '99, 102, 241', '--stanza-auth-pulse-rgb': '120, 130, 250' }; mutations[0].callback(); },
    resize(width: number, height: number) { resizes[0].callback([{ contentRect: { width, height } }]); },
    visibility(hidden: boolean) { document.hidden = hidden; listeners.get('visibilitychange')?.(); },
    cleanup() { cleanups.forEach(fn => fn()); assert.equal(raf.size, 0); assert.equal(timers.size, 0); assert.ok(mutations.every(x => x.disconnected)); assert.ok(resizes.every(x => x.disconnected)); assert.equal(listeners.size, 0); },
  };
}
const currentSource = readFileSync('src/components/FingerprintCanvas.tsx', 'utf8');
for (const mode of ['baseline', 'idle-static']) {
  const subject = await mount(currentSource, false, true, false, true, mode);
  const reference = await mount(currentSource, false, true, false, true);
  subject.frame(0); reference.frame(0);
  assert.deepEqual(subject.drawing, reference.drawing, 'diagnostic must preserve complete initial artwork');
  reference.cleanup();
  const audit = () => (subject.window as any).__STANZA_IDLE_CANVAS__();
  if (mode === 'baseline') {
    assert.equal(subject.timers.size, 1);
    subject.frame(50); assert.equal(audit().redraws, 2);
  } else {
    const settled = audit();
    assert.equal(subject.raf.size + subject.timers.size, 0, 'no scheduled work throughout sustained idle');
    assert.equal(settled.rafCallbacks, 1); assert.equal(settled.redraws, 1);
    for (const invalidate of [() => subject.resize(1920, 1080), () => subject.theme(), () => subject.visibility(false)]) {
      invalidate(); assert.equal(subject.raf.size, 1);
      subject.frame(50); assert.equal(subject.raf.size + subject.timers.size, 0);
    }
    subject.visibility(true); subject.theme();
    assert.equal(subject.raf.size + subject.timers.size, 0);
    subject.visibility(false); subject.frame(100); assert.equal(subject.raf.size + subject.timers.size, 0);
    subject.state('loading', 200, () => undefined);
    for (const t of [200, 216.667, 233.334]) { subject.frame(t); assert.equal(subject.raf.size, 1); assert.equal(subject.timers.size, 0); }
    subject.state('idle', 250, () => undefined); subject.frame(250);
    assert.equal(subject.raf.size + subject.timers.size, 0);
    for (const state of ['success', 'error']) {
      let completions = 0;
      subject.state(state, 1000, () => { completions++; });
      subject.frame(1000); subject.frame(1016.667);
      assert.equal(subject.raf.size, 1); assert.equal(subject.timers.size, 0);
      subject.frame(4000); assert.equal(completions, 1);
      assert.equal(subject.raf.size, 1, 'completion requests final idle artwork');
      subject.frame(4016.667);
      assert.equal(subject.raf.size + subject.timers.size, 0, 'final idle draw settles');
    }
    console.log('PASS: diagnostic idle-static has zero pending RAF/timers at sustained idle; full artwork parity, resize/theme/resume, loading, success/error completion and final idle frame.');
  }
  subject.cleanup(); assert.equal(audit().stopped, true);
}
const current = await mount(currentSource);
for (let i = 0; i < 120; i++) current.frame(i * 50);
assert.equal(current.reads, 1); assert.equal(current.tokens, 3);
assert.equal(current.parses, 6); assert.equal(current.classReads, 1);
let measured = current.window.__stanzaLoginCanvasMeasurements[0];
assert.equal(measured.frames, 120); assert.equal(measured.colorParses, 2);
assert.equal(measured.legacyEquivalentColorParses, 120 * 69 * 2);
assert.ok(current.mutations[0].options.attributeFilter.includes('style'));
current.theme(); assert.equal(current.parses, 12); assert.equal(current.reads, 2); assert.equal(measured.colorParses, 4);
assert.equal(current.raf.size, 1); current.frame(6016.667);
assert.equal(current.context.fillStyle !== '#020604', true);
current.visibility(true); assert.equal(current.raf.size, 0);
current.theme(); assert.equal(current.raf.size, 0);
current.visibility(false); current.visibility(false); assert.equal(current.raf.size, 1);
current.frame(100000); assert.equal(current.raf.size, 0); assert.equal(current.timers.size, 1);
for (let i = 0; i < 600; i++) current.frame(100050 + i * 50);
assert.equal(measured.frames, 600); assert.equal(measured.stopped, true);
console.log('Bounded fixed callback measurement (Node VM, Canvas2D stub; NOT Chrome paint/GPU):', JSON.stringify(measured));
current.cleanup();
// Mount/unmount/remount, as StrictMode does: every owner cancels and disconnects.
const remount = await mount(currentSource); assert.equal(remount.raf.size, 1); remount.cleanup();
const reduced = await mount(currentSource, true); reduced.frame(0); assert.equal(reduced.raf.size, 0);
reduced.theme(); reduced.frame(16); assert.equal(reduced.context.fillStyle, '#ffffff'); assert.equal(reduced.raf.size, 0); reduced.cleanup();
console.log('PASS: Geo fill primitives; palette cache and Custom-style refresh; bounded measurements; visibility; cleanup/remount; reduced-motion theme refresh.');

const referenceArtwork = await mount(currentSource, false, true);
const optimizedArtwork = await mount(currentSource, false, true, false, true);
referenceArtwork.frame(1000); optimizedArtwork.frame(1000);
assert.deepEqual(optimizedArtwork.drawing, referenceArtwork.drawing);
assert.equal(optimizedArtwork.raf.size, 0);
optimizedArtwork.theme(); referenceArtwork.theme();
referenceArtwork.frame(2000); optimizedArtwork.frame(2000);
assert.deepEqual(optimizedArtwork.drawing, referenceArtwork.drawing);
let referenceComplete = 0, optimizedComplete = 0;
for (const state of ['loading', 'success', 'error']) {
  referenceArtwork.state(state, 2100, () => { referenceComplete++; });
  optimizedArtwork.state(state, 2100, () => { optimizedComplete++; });
  referenceArtwork.frame(2200); optimizedArtwork.frame(2200);
  assert.deepEqual(optimizedArtwork.drawing, referenceArtwork.drawing);
  assert.equal(optimizedArtwork.raf.size, 1);
  referenceArtwork.frame(4000); optimizedArtwork.frame(4000);
  assert.deepEqual(optimizedArtwork.drawing, referenceArtwork.drawing);
  assert.equal(optimizedArtwork.raf.size, state === 'loading' ? 1 : 0);
}
assert.equal(referenceComplete, 2); assert.equal(optimizedComplete, 2);
referenceArtwork.resize(390, 667); optimizedArtwork.resize(390, 667);
referenceArtwork.frame(5000); optimizedArtwork.frame(5000);
assert.deepEqual(optimizedArtwork.drawing, referenceArtwork.drawing);
optimizedArtwork.visibility(true); assert.equal(optimizedArtwork.raf.size, 0);
optimizedArtwork.theme(); assert.equal(optimizedArtwork.raf.size, 0);
optimizedArtwork.visibility(false); assert.equal(optimizedArtwork.raf.size, 1);
referenceArtwork.cleanup(); optimizedArtwork.cleanup();
const optimizedReduced = await mount(currentSource, true, false, false, true);
optimizedReduced.frame(0); assert.equal(optimizedReduced.raf.size, 0);
optimizedReduced.theme(); optimizedReduced.frame(100); assert.equal(optimizedReduced.raf.size, 0);
optimizedReduced.cleanup();
console.log('PASS: optimized renderer command parity at identical timestamps in both themes; reduced-motion redraws.');
console.log('PASS: identical Canvas2D drawing commands/styles at the same timestamp and palette.');

const frozen = await mount(currentSource, false, false, true);
frozen.frame(1000); assert.equal(frozen.raf.size, 0);
frozen.theme(); assert.equal(frozen.raf.size, 1);
frozen.frame(2000); assert.equal(frozen.raf.size, 0);
frozen.cleanup();
console.log('PASS: explicit static rendering retains artwork without recurring work.');
