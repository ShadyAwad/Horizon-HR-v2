import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
const bundle = await build({ entryPoints: ['src/diagnostics/login-autofill.ts'], bundle: true, write: false, platform: 'node', format: 'cjs' });
for (const mode of ['', 'off', 'unknown']) {
  const styles: any[] = [];
  let reads = 0;
  const window: any = {};
  const module = { exports: {} as any };
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, window, URLSearchParams,
    location: { search: '?loginAutofillTest=' + mode },
    document: { hidden: false, head: { appendChild: (style: any) => styles.push(style) }, createElement: () => ({}),
      querySelectorAll: () => { reads++; return []; }, getAnimations: () => { reads++; return []; } } });
  module.exports.installLoginAutofillDiagnostic();
  assert.equal(reads, 0, 'installation must not poll or read styles');
  assert.equal(styles.length, mode === 'off' ? 1 : 0);
  if (styles.length) {
    assert.match(styles[0].textContent, /@layer base/);
    assert.match(styles[0].textContent, /input\.stanza-login-input:is\(:-webkit-autofill, :autofill\)/);
    assert.match(styles[0].textContent, /transition: none !important/);
    assert.doesNotMatch(styles[0].textContent, /background:|color:|animation:|filter:/);
  }
  const snapshot = window.__STANZA_AUTOFILL_AUDIT__();
  assert.equal(snapshot.mode, mode === 'off' ? 'off' : 'baseline');
  assert.equal(reads, 2);
}
console.log('PASS: baseline is read-only; off affects only autofill transitions in the correct cascade layer; audit is on-demand with no scheduling.');
