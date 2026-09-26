// Build-gated manual snapshots: no timers, observers, RAF or DOM/style writes.
export function installLoginAnimationAudit() {
  const ids = new WeakMap<Animation, number>();
  let nextId = 1;
  const identify = (element: Element | null) => element ? {
    tag: element.tagName, id: element.id, classes: element.getAttribute('class'),
    inAuthSurface: !!element.closest('.stanza-auth-shell'),
  } : null;
  const timingSnapshot = (timing: object) => Object.fromEntries(Object.entries(timing).map(([key,value]) =>
    [key, typeof value === 'number' && !Number.isFinite(value) ? String(value) : value]));
  const audit = () => {
    const animations = document.getAnimations().map(animation => {
      if (!ids.has(animation)) ids.set(animation, nextId++);
      const effect = animation.effect as KeyframeEffect | null;
      const target = effect?.target ?? null;
      const timing = effect?.getTiming();
      const properties = effect ? [...new Set(effect.getKeyframes().flatMap(frame => Object.keys(frame)))].filter(
        key => !['offset', 'computedOffset', 'easing', 'composite'].includes(key),
      ) : [];
      return {
        auditId: ids.get(animation), type: animation.constructor.name,
        target: identify(target), ancestors: target ? [target.parentElement, target.parentElement?.parentElement ?? null].map(identify) : [],
        pseudoElement: (effect as (KeyframeEffect & { pseudoElement?: string | null }) | null)?.pseudoElement ?? null,
        animationName: 'animationName' in animation ? animation.animationName : null,
        transitionProperty: 'transitionProperty' in animation ? animation.transitionProperty : null,
        properties, currentTime: animation.currentTime === null ? null : String(animation.currentTime),
        playState: animation.playState, pending: animation.pending, playbackRate: animation.playbackRate,
        timing: timing ? timingSnapshot(timing) : null,
        computedTiming: effect ? timingSnapshot(effect.getComputedTiming()) : null,
        infinite: timing?.iterations === Infinity || timing?.duration === Infinity,
        compositorEligibility: properties.length > 0 && properties.every(property => ['transform','translate','rotate','scale','opacity'].includes(property))
          ? 'Candidate only; actual promotion requires Chrome evidence.'
          : 'Not established; inspect trace compositing failure reasons.',
      };
    });
    return {
      capturedAt: performance.now(), url: location.origin + location.pathname,
      visibility: document.visibilityState, authState: document.querySelector('.stanza-auth-shell')?.getAttribute('data-auth-state') ?? null,
      focusedElement: identify(document.activeElement), animationCount: animations.length, animations,
      coverage: 'document.getAnimations includes document CSS transitions, CSS/WAAPI animations and pseudo-element effects; excludes native caret blinking, browser UI, canvas drawing, all SVG SMIL, cross-origin frames and native Viz work.',
      note: 'Snapshot only. Finished fill-mode effects do not prove ongoing frame requests. Compare two manual snapshots outside a timed capture. No input values or keyframe values recorded.',
    };
  };
  (window as Window & { __STANZA_ANIMATION_AUDIT__?: typeof audit }).__STANZA_ANIMATION_AUDIT__ = audit;
}
