import assert from 'node:assert/strict';
import { installCustomCursor } from '../src/lib/custom-cursor';
import { DEFAULT_CUSTOM_THEME } from '../src/lib/custom-theme';

class Events {
  listeners = new Map<string, Set<(event: any) => void>>();
  addEventListener(type: string, callback: (event: any) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(callback);
  }
  removeEventListener(type: string, callback: (event: any) => void) { this.listeners.get(type)?.delete(callback); }
  emit(type: string, event: any = {}) { for (const callback of this.listeners.get(type) ?? []) callback(event); }
  count(type?: string) { return type ? this.listeners.get(type)?.size ?? 0 : [...this.listeners.values()].reduce((sum, entries) => sum + entries.size, 0); }
}
const nodes = new Set<Particle>();
class Particle extends Events {
  style: Record<string, string> = {};
  className = '';
  inDialog = false;
  clientWidth = 200;
  clientHeight = 100;
  setAttribute() {}
  closest() { return this.inDialog ? this : null; }
  getBoundingClientRect() { return { left: 10, top: 20, width: 200, height: 100 }; }
  appendChild(node: Particle) { nodes.add(node); }
  remove() { nodes.delete(this); }
}
const body = new Particle();
const doc = Object.assign(new Events(), { hidden: false, body, createElement: () => new Particle() });
const reduced = Object.assign(new Events(), { matches: false });
const fine = Object.assign(new Events(), { matches: true });
let now = 0, nextId = 0, mediaQueries = 0;
const frames = new Map<number, FrameRequestCallback>();
const win = Object.assign(new Events(), {
  matchMedia: (query: string) => { mediaQueries++; return query.includes('reduced') ? reduced : fine; },
  requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++nextId, callback); return nextId; },
  cancelAnimationFrame: (id: number) => frames.delete(id),
});
Object.assign(globalThis, { window: win, document: doc, Element: Particle });
Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => now } });
const move = (target = body, pointerType = 'mouse') => target.emit('pointermove', { target, pointerType, clientX: 100 + now, clientY: 50 });
function tick() {
  now += 16;
  const batch = [...frames.values()]; frames.clear();
  batch.forEach((callback) => callback(now));
}
function assertClean() {
  assert.equal(nodes.size, 0); assert.equal(frames.size, 0);
  for (const events of [body, doc, win, reduced, fine]) assert.equal(events.count(), 0);
}
installCustomCursor({ ...DEFAULT_CUSTOM_THEME })();
assert.equal(mediaQueries, 0, 'None never even subscribes to media queries');
assertClean();
for (const cursorEffect of ['glow', 'dot-trail', 'lerp-trail'] as const) {
  const dispose = installCustomCursor({ ...DEFAULT_CUSTOM_THEME, cursorEffect, cursorTrailLength: 12 });
  assert.equal(nodes.size, cursorEffect === 'glow' ? 1 : 12);
  assert.equal(frames.size, 0, 'Enabling an effect does not start a loop');
  move(body, 'touch'); assert.equal(frames.size, 0);
  body.inDialog = true; move(); assert.equal(frames.size, 0, 'No invisible global animation behind dialogs'); body.inDialog = false;
  for (let i = 0; i < 500; i++) move();
  assert.equal(frames.size, 1, 'Pointer events coalesce into one frame');
  tick(); assert.ok([...nodes].some((node) => Number(node.style.opacity) > 0));
  for (let i = 0; i < 50; i++) tick();
  assert.equal(frames.size, 0, 'Stationary effects settle and stop');
  assert.ok([...nodes].every((node) => node.style.opacity === '0'));
  move(); doc.hidden = true; doc.emit('visibilitychange');
  assert.equal(frames.size, 0); assert.equal(nodes.size, 0); assert.equal(body.count('pointermove'), 0);
  doc.hidden = false; doc.emit('visibilitychange');
  assert.equal(frames.size, 0, 'Visibility resume waits for actual movement');
  move(); reduced.matches = true; reduced.emit('change');
  assert.equal(nodes.size, 0); assert.equal(frames.size, 0); assert.equal(body.count('pointermove'), 0);
  reduced.matches = false; reduced.emit('change');
  fine.matches = false; fine.emit('change');
  assert.equal(nodes.size, 0); assert.equal(body.count('pointermove'), 0);
  fine.matches = true; fine.emit('change');
  move(); win.emit('blur'); assert.equal(frames.size, 0);
  move(); body.emit('pointerleave'); assert.equal(frames.size, 0);
  move(); dispose(); dispose(); assertClean();
}
for (const restriction of ['reduced', 'touch', 'hidden']) {
  reduced.matches = restriction === 'reduced'; fine.matches = restriction !== 'touch'; doc.hidden = restriction === 'hidden';
  const dispose = installCustomCursor({ ...DEFAULT_CUSTOM_THEME, cursorEffect: 'glow' });
  assert.equal(nodes.size, 0); assert.equal(frames.size, 0); assert.equal(body.count('pointermove'), 0);
  dispose(); assertClean();
}
reduced.matches = false; fine.matches = true; doc.hidden = false;
const preview = new Particle();
const disposePreview = installCustomCursor({ ...DEFAULT_CUSTOM_THEME, cursorEffect: 'glow' }, preview as unknown as HTMLElement, true);
move(preview); tick();
assert.ok([...nodes].every((node) => node.style.position === 'absolute'));
disposePreview(); assert.equal(preview.count(), 0); assertClean();
console.log('Cursor: disabled zero-work, frame coalescing, bounded particles, settling, hidden/resume, reduced motion, touch, preview and cleanup passed');
