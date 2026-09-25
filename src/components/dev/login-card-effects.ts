export type LoginCardEffect = 'baseline' | 'no-blur' | 'no-shadow' | 'no-radius' | 'plain' | 'contain';

export function readLoginCardEffect(search: string) {
  const params = new URLSearchParams(search);
  const requested = params.get('loginCardEffect');
  const mode: LoginCardEffect = requested === 'no-blur' || requested === 'no-shadow'
    || requested === 'no-radius' || requested === 'plain' || requested === 'contain'
    ? requested : 'baseline';
  return { mode, trace: params.get('loginCardTrace') === '1' };
}

export function loginCardEffectCss(mode: LoginCardEffect) {
  if (mode === 'baseline') return '';
  const declarations = {
    'no-blur': 'backdrop-filter: none !important; -webkit-backdrop-filter: none !important;',
    'no-shadow': 'box-shadow: none !important;',
    'no-radius': 'border-radius: 0 !important;',
    // Existing opaque theme token; only this combined control changes the surface.
    plain: `background-color: var(--stanza-surface-panel) !important;
      backdrop-filter: none !important; -webkit-backdrop-filter: none !important;
      box-shadow: none !important; transform: none !important;
      translate: none !important; rotate: none !important; scale: none !important;
      animation: none !important; opacity: 1 !important;`,
    // Paint only: no size containment, so intrinsic card height remains content-driven.
    contain: 'contain: paint !important;',
  };
  return `[data-login-card-effect="${mode}"] { ${declarations[mode]} }`;
}
