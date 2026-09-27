import assert from 'node:assert/strict';
import { installCustomCursor } from '../src/lib/custom-cursor';
import { DEFAULT_CUSTOM_THEME, CURSOR_EFFECTS, CURSOR_APPEARANCES, POINTER_PRESETS, applyPointerPreset, normaliseCustomTheme } from '../src/lib/custom-theme';

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
  style: Record<string, any> = { setProperty(key: string, value: string) { this[key] = value; } };
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  interactive = false;
  textInput = false;
  className = '';
  inDialog = false;
  clientWidth = 200;
  clientHeight = 100;
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  removeAttribute(key: string) { this.attributes.delete(key); }
  closest(selector: string) { return (selector.includes('[role="dialog"]') && this.inDialog) || (selector.startsWith('input') && this.textInput) || (selector.startsWith('button') && this.interactive) ? this : null; }
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
for (const cursorEffect of CURSOR_EFFECTS.filter((effect) => effect !== 'none')) {
  const dispose = installCustomCursor({ ...DEFAULT_CUSTOM_THEME, cursorEffect, cursorTrailLength: 12 });
  assert.equal(nodes.size, cursorEffect === 'glow' ? 1 : 12);
  assert.equal(frames.size, 0, 'Enabling an effect does not start a loop');
  move(body, 'touch'); assert.equal(frames.size, 0);
  body.inDialog = true; move(); assert.equal(frames.size, 0, 'No invisible global animation behind dialogs'); body.inDialog = false;
  for (let i = 0; i < 500; i++) move();
  assert.equal(frames.size, 1, 'Pointer events coalesce into one frame');
  tick(); assert.ok([...nodes].some((node) => Number(node.style.opacity) > 0));
  for (let i = 0; i < 70; i++) tick();
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

for (const cursorAppearance of CURSOR_APPEARANCES.filter((appearance) => appearance !== 'system')) {
  const dispose = installCustomCursor({ ...DEFAULT_CUSTOM_THEME, cursorAppearance });
  move(); tick();
  const pointer = [...nodes][0];
  assert.match(pointer.style.transform, /translate3d/);
  assert.equal(pointer.dataset.state, 'normal');
  assert.equal(frames.size, 0, 'Pointer alone does not keep RAF running');
  assert.ok(body.attributes.has('data-stanza-hide-pointer'));
  body.interactive = true; move(); tick(); assert.equal(pointer.dataset.state, 'interactive');
  body.emit('pointerdown', { target: body, pointerType: 'mouse', clientX: 100, clientY: 50 }); tick();
  assert.equal(pointer.dataset.state, 'pressed');
  win.emit('pointerup'); tick(); assert.equal(pointer.dataset.state, 'interactive');
  body.textInput = true; move();
  assert.equal(pointer.style.opacity, '0'); assert.equal(frames.size, 0);
  assert.equal(body.attributes.has('data-stanza-hide-pointer'), false, 'Native text cursor restored');
  body.textInput = false; body.interactive = false; move(); tick();
  doc.hidden = true; doc.emit('visibilitychange');
  assert.equal(body.attributes.has('data-stanza-hide-pointer'), false); assert.equal(nodes.size, 0);
  doc.hidden = false; doc.emit('visibilitychange'); move(); tick();
  reduced.matches = true; reduced.emit('change');
  assert.equal(body.attributes.has('data-stanza-hide-pointer'), false); assert.equal(nodes.size, 0);
  reduced.matches = false; reduced.emit('change'); move(); tick();
  fine.matches = false; fine.emit('change');
  assert.equal(body.attributes.has('data-stanza-hide-pointer'), false); assert.equal(nodes.size, 0);
  fine.matches = true; fine.emit('change'); move(); tick();
  dispose(); assert.equal(body.attributes.has('data-stanza-hide-pointer'), false); assertClean();
}
const globalDispose = installCustomCursor({ ...DEFAULT_CUSTOM_THEME, cursorAppearance: 'ring', cursorEffect: 'portfolio-trail' });
const local = new Particle();
const localDispose = installCustomCursor({ ...DEFAULT_CUSTOM_THEME, cursorAppearance: 'dot', cursorEffect: 'sparks' }, local as unknown as HTMLElement, true);
for (let i = 0; i < 200; i++) { move(); move(local); assert.equal(frames.size, 1, 'Global and preview share exactly one RAF'); }
tick(); assert.equal(frames.size, 1);
localDispose(); assert.equal(frames.size, 1, 'Disposing preview preserves global scheduling');
globalDispose(); assertClean(); assert.equal(local.count(), 0);
const legacy = normaliseCustomTheme({ cursorEffect: 'lerp-trail', cursorColor: '#aabbcc', cursorTrailIntensity: 70, cursorTrailLength: 10 });
assert.equal(legacy.cursorAppearance, 'system'); assert.equal(legacy.cursorColor, '#AABBCC');
assert.equal(legacy.cursorTrailIntensity, 70); assert.equal(legacy.cursorTrailLength, 10);
assert.equal(legacy.cursorEffect, 'lerp-trail');
assert.deepEqual(normaliseCustomTheme(JSON.parse(JSON.stringify(legacy))), legacy);
const malformed = normaliseCustomTheme({ cursorAppearance: 'invalid', pointerColor: 'red', pointerSize: 999, pointerOpacity: -20, pointerOutline: 100, pointerGlow: Infinity, cursorTrailSize: 900, cursorSmoothness: -3, cursorFadeSpeed: 'fast', cursorVelocityResponse: NaN });
assert.equal(malformed.cursorAppearance, 'system'); assert.equal(malformed.pointerColor, null);
assert.equal(malformed.pointerSize, 32); assert.equal(malformed.pointerOpacity, 35); assert.equal(malformed.pointerOutline, 4);
assert.equal(malformed.pointerGlow, 0); assert.equal(malformed.cursorTrailSize, 14); assert.equal(malformed.cursorSmoothness, 0);
assert.equal(malformed.cursorFadeSpeed, 50); assert.equal(malformed.cursorVelocityResponse, 40);
for (const preset of POINTER_PRESETS) {
  const config = applyPointerPreset({ ...legacy, accent: '#ABCDEF', primaryAction: '#123456' }, preset);
  assert.equal(config.accent, '#ABCDEF'); assert.equal(config.primaryAction, '#123456');
  assert.deepEqual(normaliseCustomTheme(config), config);
  if (preset === 'system') { assert.equal(config.cursorAppearance, 'system'); assert.equal(config.cursorEffect, 'none'); installCustomCursor(config)(); assertClean(); }
}
// Auto colors use the current accent; explicit pointer and trail colors stay independent.
const colorDispose = installCustomCursor({ ...DEFAULT_CUSTOM_THEME, accent: '#123456', cursorAppearance: 'ring', cursorEffect: 'glow', cursorColor: '#ABCDEF' });
assert.equal([...nodes].find((node) => node.className.includes('stanza-custom-pointer'))?.style.color, '#123456');
assert.equal([...nodes].find((node) => node.className.includes('stanza-cursor-particle'))?.style.color, '#ABCDEF');
colorDispose(); assertClean();
console.log('Expanded cursor: all appearances/effects, interaction/text states, shared RAF, migration, normalization, presets, colors and cleanup passed');
