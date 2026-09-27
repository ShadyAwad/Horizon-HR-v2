import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { build } from 'esbuild';
import postcss from 'postcss';

const bundle = await build({ entryPoints: ['src/diagnostics/login-control-transitions.ts'], bundle: true, write: false, platform: 'node', format: 'cjs' });
for (const mode of ['baseline', 'off']) {
  const styles: any[] = [];
  let reads = 0;
  const elements = ['corporate-id', 'passkey'].map(target => ({ getAttribute: () => target, getAnimations: () => [] }));
  const module = { exports: {} as any }, window: any = {};
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, window, URLSearchParams,
    location: { search: '?loginIdleCanvas=idle-static&loginAutofillTest=off&loginControlTransitions=' + mode },
    document: { createElement: () => ({}), head: { appendChild: (style: any) => styles.push(style) }, querySelectorAll: () => elements },
    getComputedStyle: () => { reads++; return { transitionProperty: mode === 'off' ? 'none' : 'color', transitionDuration: mode === 'off' ? '0s' : '0.15s', animationName: 'none' }; },
  });
  module.exports.installLoginControlTransitions();
  assert.equal(reads, 0, 'installation must not sample styles');
  assert.equal(styles.length, mode === 'off' ? 1 : 0);
  const css = postcss.parse(module.exports.controlTransitionCss);
  let selectors = 0;
  css.walkRules(rule => {
    selectors += rule.selectors.length;
    for (const selector of rule.selectors) assert.match(selector, /^:root \.stanza-auth-shell (?:input\[data-login-transition-target="corporate-id"\]|button\[data-login-transition-target="passkey"\])$/);
    rule.walkDecls(decl => { assert.ok(['transition','animation'].includes(decl.prop)); assert.equal(decl.value, 'none'); assert.equal(decl.important, true); });
  });
  assert.equal(selectors, 2);
  assert.equal(window.__STANZA_LOGIN_CONTROL_AUDIT__().verifiedOff, mode === 'off');
  elements.pop();
  assert.equal(window.__STANZA_LOGIN_CONTROL_AUDIT__().verifiedOff, false, 'a missing target must not pass');
}
const login = readFileSync('src/pages/Login.tsx', 'utf8');
assert.equal((login.match(/data-login-transition-target=/g) ?? []).length, 2);
assert.match(login, /ref=\{emailInputRef\}\s+data-login-transition-target=/);
assert.match(login, /onClick=\{handlePasskeySignIn\}\s+data-login-transition-target=/);
console.log('PASS: only Corporate ID/Passkey targeted; only transition/animation declarations; combined query; no automatic style reads; audit rejects missing targets. Computed-style mock is not Chrome verification.');
