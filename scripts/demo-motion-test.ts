import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { demoMotionCss, readDemoMotion } from '../src/components/dev/demo-motion';
import { loginCardEffectCss, readLoginCardEffect } from '../src/components/dev/login-card-effects';
import { readLoginShellTest } from '../src/components/dev/login-shell-tests';

assert.deepEqual(readLoginShellTest(''), { mode: 'baseline', css: '' });
assert.deepEqual(readLoginShellTest('?loginShellTest=bogus'), readLoginShellTest(''));
for (const mode of ['root-match', 'no-center', 'plain-shell', 'no-bg-layers', 'app-match', 'app-match-no-center'] as const) {
  const result = readLoginShellTest(`?demoMotion=none&loginShellTest=${mode}`);
  assert.equal(result.mode, mode);
  assert.ok(result.css.includes(`[data-login-shell-test="${mode}"]`));
  assert.doesNotMatch(result.css, /demo-account-panel|data-login-card-effect|transition-all/);
}
assert.match(readLoginShellTest('?loginShellTest=root-match').css, /html:has/);
assert.doesNotMatch(readLoginShellTest('?loginShellTest=root-match').css, /stanza-auth-shell/);
assert.match(readLoginShellTest('?loginShellTest=no-center').css, /justify-content: flex-start/);
assert.doesNotMatch(readLoginShellTest('?loginShellTest=no-center').css, /background/);
assert.match(readLoginShellTest('?loginShellTest=plain-shell').css, /isolation: auto/);
assert.doesNotMatch(readLoginShellTest('?loginShellTest=no-bg-layers').css, /isolation|overflow|transform/);
const appMatch = readLoginShellTest('?loginShellTest=app-match').css;
assert.match(appMatch, /#root > div:has\(> \.stanza-auth-shell \[data-login-shell-test=/);
assert.match(appMatch, /background-color: var\(--stanza-auth-background\) !important/);
assert.doesNotMatch(appMatch, /justify-content|padding|background-image|isolation|overflow/);
const combined = readLoginShellTest('?loginShellTest=app-match-no-center').css;
assert.match(combined, /background-color: var\(--stanza-auth-background\)/);
assert.match(combined, /justify-content: flex-start/);

assert.deepEqual(readLoginCardEffect(''), { mode: 'baseline', trace: false });
assert.deepEqual(readLoginCardEffect('?loginCardEffect=bogus'), readLoginCardEffect(''));
assert.equal(loginCardEffectCss('baseline'), '');
for (const mode of ['no-blur', 'no-shadow', 'no-radius', 'plain', 'contain'] as const) {
  assert.deepEqual(readLoginCardEffect(`?loginCardEffect=${mode}&loginCardTrace=1`), { mode, trace: true });
  assert.match(loginCardEffectCss(mode), new RegExp(`^\\[data-login-card-effect="${mode}"\\]`));
  assert.doesNotMatch(loginCardEffectCss(mode), /grid|max-height|transition|#demo-account-panel/);
}
assert.equal(loginCardEffectCss('no-blur'), '[data-login-card-effect="no-blur"] { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }');
assert.equal(loginCardEffectCss('no-shadow'), '[data-login-card-effect="no-shadow"] { box-shadow: none !important; }');
assert.equal(loginCardEffectCss('no-radius'), '[data-login-card-effect="no-radius"] { border-radius: 0 !important; }');
assert.equal(loginCardEffectCss('contain'), '[data-login-card-effect="contain"] { contain: paint !important; }');
assert.match(loginCardEffectCss('plain'), /background-color: var\(--stanza-surface-panel\)/);

assert.deepEqual(readDemoMotion(''), { mode: 'grid', trace: false });
assert.deepEqual(readDemoMotion('?demoMotion=bogus'), readDemoMotion(''));
assert.deepEqual(readDemoMotion('?demoMotion=none&demoTrace=1'), { mode: 'none', trace: true });
assert.deepEqual(readDemoMotion('?demoMotion=max-height'), { mode: 'max-height', trace: false });
assert.equal(demoMotionCss('grid'), '');
assert.match(demoMotionCss('none'), /transition: none !important/);
assert.match(demoMotionCss('none'), /animation: none !important/);
assert.match(demoMotionCss('max-height'), /display: block !important/);
assert.match(demoMotionCss('max-height'), /grid-template-rows: none !important/);
assert.match(demoMotionCss('max-height'), /transition-property: max-height !important/);
for (const mode of ['grid', 'none', 'max-height'] as const) {
  assert.doesNotMatch(demoMotionCss(mode), /opacity|background|color|border|font|transform/);
}

const source = readFileSync('src/pages/Login.tsx', 'utf8');
const output = await build({
  stdin: { contents: source, resolveDir: `${process.cwd()}/src/pages`, loader: 'tsx' },
  bundle: true, write: false, format: 'esm', minify: true,
  external: ['react', 'react/jsx-runtime', 'lucide-react', '../lib/*', '../auth/*', '../components/BrandWordmark', '../components/PrivacyPolicyModal', '../components/StanzaFingerprintLoader', '../components/StanzaFingerprintMark', '../components/PwaInstallPrompt'],
  define: { 'import.meta.env.DEV': 'false' },
});
assert.doesNotMatch(output.outputFiles[0].text, /demo-motion-trace|__stanzaDemoMotion|demoTrace|demoMotion=|ResizeObserver|capture-limit|retainedDescendants/);
assert.doesNotMatch(output.outputFiles[0].text, /login-card-effects|__stanzaLoginCardEffects|loginCardTrace|loginCardEffect|data-login-card-effect="|computed styles do not expose/);
assert.doesNotMatch(output.outputFiles[0].text, /loginShellTest|root-match|plain-shell|no-bg-layers|no-center|app-match/);
console.log('PASS: motion mode parsing; scoped geometry-only CSS; production excludes motion alternatives and instrumentation.');
