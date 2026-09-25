import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import vm from 'node:vm';
import { build } from 'esbuild';

const css = readFileSync('src/index.css', 'utf8');
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
assert.match(dashboard, /className="stanza-theme-primary stanza-geo-break-primary /);
const clockClasses = dashboard.slice(dashboard.indexOf('data-geo-interaction="clock"'), dashboard.indexOf('data-geo-interaction="clock"') + 1300);
assert.doesNotMatch(clockClasses, /hover:scale|active:scale|transition-transform/);
assert.match(css, /button\.stanza-geo-clock:not\(:disabled\):is\(:hover, :active\),\s*button\.stanza-geo-break-primary:not\(:disabled\):is\(:hover, :active\)\s*\{\s*transform: none;\s*scale: none;/);

async function mount(source: string, reduced = false, trace = false, staticMode = false) {
  const output = await build({ stdin: { contents: source, resolveDir: process.cwd() + '/src/components', loader: 'tsx' }, bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react/jsx-runtime'], define: { 'import.meta.env.DEV': 'true' } });
  let reads = 0, tokens = 0, parses = 0, classReads = 0, dark = true, nextId = 1;
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
  const react = { useRef: (current: unknown) => ({ current }), useEffect: (fn: any) => effects.push(fn) };
  const jsx = (_type: unknown, props: any) => { if (_type === 'canvas') props.ref.current = canvas; return null; };
  const root = { classList: { contains: () => { classReads++; return dark; } } };
  const document = { hidden: false, documentElement: root, addEventListener: (name: string, fn: () => void) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name) };
  const window: any = { devicePixelRatio: 1, matchMedia: () => ({ matches: reduced }), setTimeout, clearTimeout };
  const sandbox: any = { module: { exports: {} }, Number: class extends Number { static parseInt(value: string, radix?: number) { parses++; return Number.parseInt(value, radix); } }, performance, window, document, console,
    require: (name: string) => name === 'react' ? react : { jsx, jsxs: jsx },
    getComputedStyle: () => { reads++; return { getPropertyValue: (key: string) => { tokens++; return colors[key] || ''; } }; },
    requestAnimationFrame: (fn: (time: number) => void) => { const id = nextId++; raf.set(id, fn); return id; },
    cancelAnimationFrame: (id: number) => raf.delete(id),
    MutationObserver: class { record: any; constructor(callback: () => void) { this.record = { callback, disconnected: false }; mutations.push(this.record); } observe(_root: any, options: any) { this.record.options = options; } disconnect() { this.record.disconnected = true; } },
    ResizeObserver: class { record: any; constructor(callback: any) { this.record = { callback, disconnected: false }; resizes.push(this.record); } observe() { this.record.callback([{ contentRect: { width: 1920, height: 1080 } }]); } disconnect() { this.record.disconnected = true; } },
  };
  vm.runInNewContext(output.outputFiles[0].text, sandbox);
  sandbox.module.exports.FingerprintCanvas({ pulseState: 'idle', staticMode });
  for (const fn of effects) { const cleanup = fn(); if (cleanup) cleanups.push(cleanup); }
  return {
    raf, window, mutations, resizes, context, drawing,
    get parses() { return parses; }, get classReads() { return classReads; },
    get reads() { return reads; }, get tokens() { return tokens; },
    frame(time: number) { const callbacks = [...raf.values()]; raf.clear(); assert.equal(callbacks.length, 1); const start = performance.now(); callbacks[0](time); return performance.now() - start; },
    theme() { dark = false; colors = { '--stanza-auth-background': '#ffffff', '--stanza-auth-ring-rgb': '99, 102, 241', '--stanza-auth-pulse-rgb': '120, 130, 250' }; mutations[0].callback(); },
    visibility(hidden: boolean) { document.hidden = hidden; listeners.get('visibilitychange')?.(); },
    cleanup() { cleanups.forEach(fn => fn()); assert.equal(raf.size, 0); assert.ok(mutations.every(x => x.disconnected)); assert.ok(resizes.every(x => x.disconnected)); assert.equal(listeners.size, 0); },
  };
}
const currentSource = readFileSync('src/components/FingerprintCanvas.tsx', 'utf8');
// Read-only historical source, compiled in memory. No checkout or filesystem restoration.
const historicalSource = execFileSync('git', ['show', '1725157:src/components/FingerprintCanvas.tsx'], { encoding: 'utf8' });
const previous = await mount(historicalSource);
const current = await mount(currentSource);
assert.equal(current.reads, 1);
const before: number[] = [], after: number[] = [];
for (let i = 0; i < 120; i++) { before.push(previous.frame(i * 16.667)); after.push(current.frame(i * 16.667)); }
console.log('120-frame callback CPU, Node VM with Canvas2D stub, NOT Chrome:', JSON.stringify({ before: { average: before.reduce((a,b)=>a+b,0)/120, worst: Math.max(...before) }, after: { average: after.reduce((a,b)=>a+b,0)/120, worst: Math.max(...after) } }));
assert.equal(previous.reads, 120); assert.equal(previous.tokens, 360);
assert.equal(current.reads, 1); assert.equal(current.tokens, 3);
assert.equal(current.parses, 6); assert.equal(current.classReads, 1);
assert.equal(previous.parses, 120 * 69 * 6); assert.equal(previous.classReads, 120);
let measured = current.window.__stanzaLoginCanvasMeasurements[0];
assert.equal(measured.frames, 120); assert.equal(measured.colorParses, 2);
assert.equal(measured.legacyEquivalentColorParses, 120 * 69 * 2);
assert.ok(current.mutations[0].options.attributeFilter.includes('style'));
current.theme(); assert.equal(current.parses, 12); assert.equal(current.reads, 2); assert.equal(measured.colorParses, 4);
assert.equal(current.raf.size, 1); current.frame(2016.667);
assert.equal(current.context.fillStyle !== '#020604', true);
current.visibility(true); assert.equal(current.raf.size, 0);
current.theme(); assert.equal(current.raf.size, 0);
current.visibility(false); current.visibility(false); assert.equal(current.raf.size, 1);
current.frame(100000); assert.equal(current.raf.size, 1);
for (let i = 0; i < 600; i++) current.frame(100020 + i * 16.667);
assert.equal(measured.frames, 600); assert.equal(measured.stopped, true);
console.log('Bounded fixed callback measurement (Node VM, Canvas2D stub; NOT Chrome paint/GPU):', JSON.stringify(measured));
previous.cleanup(); current.cleanup();
// Mount/unmount/remount, as StrictMode does: every owner cancels and disconnects.
const remount = await mount(currentSource); assert.equal(remount.raf.size, 1); remount.cleanup();
const reduced = await mount(currentSource, true); reduced.frame(0); assert.equal(reduced.raf.size, 0);
reduced.theme(); reduced.frame(16); assert.equal(reduced.context.fillStyle, '#ffffff'); assert.equal(reduced.raf.size, 0); reduced.cleanup();
console.log('PASS: Geo fill primitives; palette cache and Custom-style refresh; bounded measurements; visibility; cleanup/remount; reduced-motion theme refresh.');

const oldArtwork = await mount(historicalSource, false, true);
const newArtwork = await mount(currentSource, false, true);
oldArtwork.frame(1000); newArtwork.frame(1000);
assert.deepEqual(newArtwork.drawing, oldArtwork.drawing);
oldArtwork.cleanup(); newArtwork.cleanup();
console.log('PASS: identical Canvas2D drawing commands/styles at the same timestamp and palette.');

const frozen = await mount(currentSource, false, false, true);
frozen.frame(1000); assert.equal(frozen.raf.size, 0);
frozen.theme(); assert.equal(frozen.raf.size, 1);
frozen.frame(2000); assert.equal(frozen.raf.size, 0);
frozen.cleanup();
console.log('PASS: freeze-canvas isolation retains drawing but stops idle RAF; palette refresh draws once.');
