export const controlTransitionSelector = '[data-login-transition-target="corporate-id"], [data-login-transition-target="passkey"]';
export const controlTransitionCss = `@layer base {
  :root .stanza-auth-shell input[data-login-transition-target="corporate-id"],
  :root .stanza-auth-shell button[data-login-transition-target="passkey"] {
    transition: none !important;
    animation: none !important;
  }
}`;

// Build-gated, on-demand audit. No timers, observers or animation sampling.
export function installLoginControlTransitions() {
  const off = new URLSearchParams(location.search).get('loginControlTransitions') === 'off';
  if (off) {
    const style = document.createElement('style');
    style.id = 'stanza-login-control-transitions';
    style.textContent = controlTransitionCss;
    document.head.appendChild(style);
  }
  const snapshot = () => {
    const controls = [...document.querySelectorAll<HTMLElement>(controlTransitionSelector)].map(element => {
      const css = getComputedStyle(element);
      return {
        target: element.getAttribute('data-login-transition-target'),
        transitionProperty: css.transitionProperty, transitionDuration: css.transitionDuration,
        animationName: css.animationName,
        activeAnimations: element.getAnimations().filter(animation => animation.playState === 'running' || animation.pending).map(animation => ({
          type: animation.constructor.name, playState: animation.playState,
          property: 'transitionProperty' in animation ? animation.transitionProperty : null,
        })),
      };
    });
    return { mode: off ? 'off' : 'baseline', controls,
      verifiedOff: off && controls.length === 2 && controls.every(control => control.transitionProperty === 'none' && control.transitionDuration === '0s' && control.animationName === 'none' && control.activeAnimations.length === 0) };
  };
  (window as Window & { __STANZA_LOGIN_CONTROL_AUDIT__?: typeof snapshot }).__STANZA_LOGIN_CONTROL_AUDIT__ = snapshot;
}
