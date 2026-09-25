import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { readAuthIdleIsolation } from '../src/components/dev/auth-idle-isolation';

assert.deepEqual(readAuthIdleIsolation(''), { label: undefined, freezeCanvas: false, removeCanvas: false, css: '' });
assert.deepEqual(readAuthIdleIsolation('?loginIdle=unknown'), readAuthIdleIsolation(''));
const freeze = readAuthIdleIsolation('?loginIdle=freeze-canvas');
assert.equal(freeze.freezeCanvas, true);
assert.equal(freeze.removeCanvas, false);
assert.equal(freeze.css, '');
assert.equal(readAuthIdleIsolation('?loginIdle=no-canvas').removeCanvas, true);
const combined = readAuthIdleIsolation('?loginIdle=no-card-blur&loginIdle=no-toolbar-blur&loginIdle=no-card-blur');
assert.equal(combined.label, 'no-card-blur no-toolbar-blur');
assert.equal(combined.freezeCanvas, false);
assert.match(combined.css, /backdrop-blur-xl/);
assert.match(combined.css, /backdrop-blur-md/);
assert.equal(combined.css.split('\n').length, 2);
assert.ok(combined.css.split('\n').every((rule) => rule.startsWith('.stanza-auth-shell[data-login-idle-isolation] ')));
assert.doesNotMatch(combined.css, /background:|transform:|opacity:/);
assert.match(readAuthIdleIsolation('?loginIdle=no-css-motion').css, /animation: none/);

const source = readFileSync('src/components/AuthShell.tsx', 'utf8');
const result = await build({
  stdin: { contents: source, resolveDir: `${process.cwd()}/src/components`, loader: 'tsx' },
  bundle: true, write: false, format: 'esm', minify: true,
  external: ['react', 'react/jsx-runtime', './FingerprintCanvas'],
  define: { 'import.meta.env.DEV': 'false' },
});
assert.doesNotMatch(result.outputFiles[0].text, /freeze-canvas|no-canvas|no-card-blur|no-toolbar-blur|no-css-motion|URLSearchParams|window.location/);
console.log('PASS: default/unknown flags inert; effects independently scoped; combined flags deduplicated; production excludes isolation implementation.');
