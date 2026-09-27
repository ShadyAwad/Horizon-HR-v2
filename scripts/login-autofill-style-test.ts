import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';

// Parse declarations, independent of formatting, duration spelling or minifier.
// Optionally validate the served/built stylesheet using the same contract.
const path = process.argv[2] ?? 'src/index.css';
const root = postcss.parse(readFileSync(path, 'utf8'), { from: path });
const covered = new Set<string>();
root.walkRules(rule => {
  if (!rule.selector.includes('.stanza-login-input') || !rule.selector.includes('autofill')) return;
  rule.walkDecls(decl => {
    if (/^(?:-webkit-)?(?:transition|animation)(?:-|$)/.test(decl.prop)) {
      assert.ok(['none', '0s', '0ms', '0'].includes(decl.value.trim()),
        `${path}: autofill must not animate: ${decl.prop}: ${decl.value}`);
    }
  });
  const baseSelectors = [':-webkit-autofill', ':autofill', ':-moz-autofill', ':-moz-autofill-preview'];
  for (const pseudo of baseSelectors) {
    if (!rule.selectors.includes('.stanza-login-input' + pseudo)) continue;
    covered.add(pseudo);
    const declarations = new Map<string, { value: string; important: boolean }>();
    rule.walkDecls(decl => { declarations.set(decl.prop, { value: decl.value, important: !!decl.important }); });
    assert.deepEqual(declarations.get('transition'), { value: 'none', important: true }, `${pseudo}: override utility transitions`);
    assert.ok(declarations.get('box-shadow')?.value.includes('inset'), `${pseudo}: static inset fill retained`);
    for (const prop of ['background-color', '-webkit-text-fill-color', 'caret-color']) {
      assert.ok(declarations.has(prop), `${pseudo}: explicit static ${prop} retained`);
    }
  }
});
for (const pseudo of [':-webkit-autofill', ':autofill', ':-moz-autofill', ':-moz-autofill-preview']) {
  assert.ok(covered.has(pseudo), `${path}: missing autofill selector ${pseudo}`);
}
console.log(`PASS: ${path}: autofill uses important transition:none with static fill/text/caret; no animation or transition duration workaround.`);
