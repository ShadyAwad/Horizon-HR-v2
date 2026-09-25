export type LoginShellTest = 'baseline' | 'root-match' | 'no-center' | 'plain-shell' | 'no-bg-layers' | 'app-match' | 'app-match-no-center';

/** Reload-based DEV controls. CSS exists only while the Login route is mounted. */
export function readLoginShellTest(search: string) {
  const requested = new URLSearchParams(search).get('loginShellTest');
  const mode: LoginShellTest = requested === 'root-match' || requested === 'no-center'
    || requested === 'plain-shell' || requested === 'no-bg-layers'
    || requested === 'app-match' || requested === 'app-match-no-center' ? requested : 'baseline';
  const login = `[data-login-shell-test="${mode}"]`;
  const shell = `.stanza-auth-shell:has(${login})`;
  let css = '';
  if (mode === 'root-match') css = `
html:has(${login}), body:has(${login}), #root:has(${login}) {
  background-color: var(--stanza-auth-background) !important;
  background-image: none !important;
}`;
  // Match only AuthShell's direct App parent, while this Login mode is mounted.
  if (mode === 'app-match' || mode === 'app-match-no-center') css = `
#root > div:has(> .stanza-auth-shell ${login}) {
  background-color: var(--stanza-auth-background) !important;
}`;
  if (mode === 'no-center' || mode === 'app-match-no-center') css += `
@media (min-width: 768px) {
  ${login} { justify-content: flex-start !important;
    padding-top: calc(env(safe-area-inset-top) + 4rem) !important; }
}`;
  if (mode === 'no-bg-layers' || mode === 'plain-shell') css = `
${shell} { background-color: var(--stanza-auth-background) !important; background-image: none !important; }
${shell} > [aria-hidden="true"] { display: none !important; }
${shell}::before, ${shell}::after { content: none !important; }
`;
  if (mode === 'plain-shell') css += `
${shell} { isolation: auto !important; overflow: visible !important;
  transform: none !important; filter: none !important; backdrop-filter: none !important;
  contain: none !important; box-shadow: none !important; border-radius: 0 !important; }
${shell} > div:not([aria-hidden="true"]) {
  z-index: auto !important; isolation: auto !important; transform: none !important;
  background: transparent !important; overflow: visible !important; contain: none !important;
}
`;
  return { mode, css };
}
