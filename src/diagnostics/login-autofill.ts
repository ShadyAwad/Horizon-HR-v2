// Narrow diagnostic only: no RAF, timers, mutation/resize observers or sampling.
export const autofillDiagnosticCss = `@layer base {
  :root .stanza-auth-shell input.stanza-login-input:is(:-webkit-autofill, :autofill) {
    transition: none !important;
  }
}`;

export function installLoginAutofillDiagnostic() {
  const off = new URLSearchParams(location.search).get('loginAutofillTest') === 'off';
  if (off) {
    const style = document.createElement('style');
    style.id = 'stanza-autofill-diagnostic';
    style.textContent = autofillDiagnosticCss;
    document.head.appendChild(style);
  }
  const snapshot = () => ({
    mode: off ? 'off' : 'baseline',
    hidden: document.hidden,
    inputs: [...document.querySelectorAll<HTMLInputElement>('.stanza-auth-shell .stanza-login-input')].map((input, index) => {
      const css = getComputedStyle(input);
      return { index, type: input.type, autofilled: input.matches(':-webkit-autofill, :autofill'),
        transitionProperty: css.transitionProperty, transitionDuration: css.transitionDuration,
        backgroundColor: css.backgroundColor };
    }),
    animations: document.getAnimations().map(animation => {
      const effect = animation.effect as KeyframeEffect | null;
      const target = effect?.target;
      return { kind: animation.constructor.name, state: animation.playState,
        target: target instanceof Element ? target.tagName + '.' + target.className : null,
        property: 'transitionProperty' in animation ? animation.transitionProperty : undefined,
        timing: effect?.getComputedTiming(), currentTime: animation.currentTime };
    }),
    note: 'On-demand snapshot only; run outside the timed capture. No input values recorded.',
  });
  (window as Window & { __STANZA_AUTOFILL_AUDIT__?: typeof snapshot }).__STANZA_AUTOFILL_AUDIT__ = snapshot;
}
