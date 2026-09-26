import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';

const result = await build({ entryPoints: ['src/diagnostics/login-animation-audit.ts'], bundle: true, write: false, platform: 'node', format: 'cjs' });
let reads = 0;
const target = { tagName: 'PATH', id: '', parentElement: null, closest: () => ({}), getAttribute: () => 'stanza-fingerprint-groove' };
const effect = {
  target, pseudoElement: '::before',
  getTiming: () => ({ duration: 1050, iterations: Infinity }),
  getComputedTiming: () => ({ duration: 1050, iterations: Infinity, endTime: Infinity }),
  getKeyframes: () => [{ offset: 0, computedOffset: 0, easing: 'linear', composite: 'auto', opacity: '0.2', strokeDashoffset: '28' }],
};
const animation = { constructor: { name: 'CSSAnimation' }, effect, animationName: 'example', currentTime: 500, playState: 'running', pending: false, playbackRate: 1 };
const window: any = {};
const module = { exports: {} as any };
vm.runInNewContext(result.outputFiles[0].text, {
  module, exports: module.exports, window,
  performance: { now: () => 123 }, location: { origin: 'http://localhost:4173', pathname: '/' },
  document: { getAnimations: () => { reads++; return [animation]; }, visibilityState: 'visible', activeElement: target,
    querySelector: () => ({ getAttribute: () => 'idle' }) },
  // Intentionally no RAF, timers, observers, getComputedStyle or DOM write APIs.
});
module.exports.installLoginAnimationAudit();
assert.equal(reads, 0);
const first = window.__STANZA_ANIMATION_AUDIT__();
assert.equal(reads, 1);
assert.equal(first.animations[0].timing.iterations, 'Infinity');
assert.equal(first.animations[0].pseudoElement, '::before');
assert.equal(first.animations[0].infinite, true);
assert.deepEqual(Array.from(first.animations[0].properties), ['opacity', 'strokeDashoffset']);
assert.doesNotMatch(JSON.stringify(first), /"28"/);
animation.currentTime = 750;
animation.playState = 'finished';
const second = window.__STANZA_ANIMATION_AUDIT__();
assert.equal(second.animations[0].auditId, first.animations[0].auditId);
assert.equal(second.animations[0].currentTime, '750');
assert.equal(second.animations[0].playState, 'finished');
assert.equal(first.animations[0].currentTime, '500', 'snapshot must not retain a live animation');
console.log('PASS: manual-only audit; stable identity; finite/infinite timing and pseudo-element metadata; property names without keyframe values; no live snapshot references or scheduling.');
