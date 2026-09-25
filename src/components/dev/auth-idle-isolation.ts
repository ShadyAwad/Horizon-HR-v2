// Reload-based DEV isolation: no timers, observers, storage, or recurring renders.
// Keep this imported only behind import.meta.env.DEV in AuthShell.
const rules = {
  'freeze-canvas': '',
  'no-canvas': '',
  'no-card-blur': '[class~="backdrop-blur-xl"] { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }',
  'no-toolbar-blur': '[class~="backdrop-blur-md"] { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }',
  'no-css-motion': '* { animation: none !important; transition: none !important; }',
} as const;

export function readAuthIdleIsolation(search: string) {
  const requested = new URLSearchParams(search).getAll('loginIdle');
  const modes = (Object.keys(rules) as Array<keyof typeof rules>).filter((mode) => requested.includes(mode));
  return {
    label: modes.join(' ') || undefined,
    freezeCanvas: modes.includes('freeze-canvas'),
    removeCanvas: modes.includes('no-canvas'),
    css: modes.filter((mode) => rules[mode]).map((mode) => `.stanza-auth-shell[data-login-idle-isolation] ${rules[mode]}`).join('\n'),
  };
}
