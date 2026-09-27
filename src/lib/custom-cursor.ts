import { hasCustomCursor, normaliseCustomTheme, type CustomThemeConfig } from './custom-theme';

// One shared RAF queue for the applied cursor and all local previews. Switching
// between them cannot start a second browser animation clock.
type Frame = (now: number) => void;
const pending = new Set<Frame>();
let sharedRaf = 0;
function requestFrame(callback: Frame) {
  pending.add(callback);
  if (!sharedRaf) sharedRaf = window.requestAnimationFrame((now) => {
    sharedRaf = 0;
    const batch = [...pending]; pending.clear();
    for (const frame of batch) frame(now);
  });
}
function cancelFrame(callback: Frame) {
  pending.delete(callback);
  if (!pending.size && sharedRaf) { window.cancelAnimationFrame(sharedRaf); sharedRaf = 0; }
}

/** Small transformed DOM elements; zero subscriptions for system + none. */
export function installCustomCursor(value: CustomThemeConfig, target: HTMLElement = document.body, preview = false) {
  const config = normaliseCustomTheme(value);
  if (!hasCustomCursor(config)) return () => {};
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
  let disposeActive = () => {};
  function reconcile() {
    disposeActive(); disposeActive = () => {};
    if (reduced.matches || !fine.matches || document.hidden) return;
    const effect = config.cursorEffect;
    const count = effect === 'none' ? 0 : effect === 'glow' ? 1 : config.cursorTrailLength;
    const create = (className: string, color: string) => {
      const node = document.createElement('span');
      node.className = className;
      node.setAttribute('aria-hidden', 'true');
      node.style.color = color;
      node.style.position = preview ? 'absolute' : 'fixed';
      target.appendChild(node);
      return node;
    };
    const nodes = Array.from({ length: count }, (_, index) => {
      const node = create(`stanza-cursor-particle stanza-cursor-${effect}`, config.cursorColor ?? config.accent);
      // A bounded luminous core, not an animated blur/filter. Taper along the chain.
      const glow = config.cursorTrailGlow / 100 * (1 - index / count);
      node.style.background = index === 0 && ['portfolio-trail', 'comet'].includes(effect)
        ? 'radial-gradient(circle, white 10%, currentColor 35%, transparent 75%)'
        : glow && effect !== 'glow' ? `linear-gradient(0deg, transparent, currentColor ${45 - glow * 20}%, currentColor ${55 + glow * 20}%, transparent)` : '';
      return node;
    });
    const pointer = config.cursorAppearance === 'system' ? null : create(`stanza-custom-pointer stanza-pointer-${config.cursorAppearance}`, config.pointerColor ?? config.accent);
    if (pointer) {
      pointer.style.width = `${config.pointerSize}px`;
      pointer.style.height = `${config.pointerSize}px`;
      pointer.style.setProperty('--pointer-outline', `${config.pointerOutline}px`);
      pointer.style.boxShadow = config.pointerGlow ? `0 0 ${config.pointerGlow / 10}px currentColor` : 'none';
    }
    const points = nodes.map(() => ({ x: 0, y: 0, born: -Infinity }));
    let x = 0, y = 0, previousX = 0, previousY = 0, speed = 0;
    let lastMove = 0, lastFrame = 0, started = false, pressed = false, interactive = false;
    let eventTarget: Element | null = null, hiddenTarget: Element | null = null;
    let bounds: DOMRect | null = null, scaleX = 1, scaleY = 1;
    const restoreNative = () => { hiddenTarget?.removeAttribute('data-stanza-hide-pointer'); hiddenTarget = null; };
    const measure = () => {
      if (preview) {
        bounds = target.getBoundingClientRect();
        scaleX = bounds.width ? target.clientWidth / bounds.width : 1;
        scaleY = bounds.height ? target.clientHeight / bounds.height : 1;
      }
    };
    const stop = () => {
      cancelFrame(frame); started = false; pressed = false;
      restoreNative();
      if (pointer) pointer.style.opacity = '0';
      for (const node of nodes) node.style.opacity = '0';
    };
    const frame: Frame = (now) => {
      const age = now - lastMove;
      const dt = Math.max(1, Math.min(50, now - lastFrame)); lastFrame = now;
      if (pointer) {
        pointer.dataset.state = pressed ? 'pressed' : interactive ? 'interactive' : 'normal';
        const scale = pressed ? .82 : interactive ? 1.16 : 1;
        pointer.style.transform = `translate3d(${x}px, ${y}px, 0) translate(${config.cursorAppearance === 'minimal-arrow' ? '0, 0' : '-50%, -50%'}) scale(${scale})`;
        pointer.style.opacity = String(Math.min(1, config.pointerOpacity / 100 * (interactive && config.cursorAppearance === 'orb' ? 1.1 : 1)));
        if (eventTarget !== hiddenTarget) { restoreNative(); hiddenTarget = eventTarget; hiddenTarget?.setAttribute('data-stanza-hide-pointer', ''); }
      }
      if (!count) return; // Static pointer stays visible without an animation loop.
      const fadeDuration = 850 - config.cursorFadeSpeed * 6;
      const fade = Math.max(0, 1 - age / fadeDuration);
      if (!fade) { for (const node of nodes) node.style.opacity = '0'; return; }
      const measuredSpeed = Math.min(3, Math.hypot(x - previousX, y - previousY) / dt);
      speed += (measuredSpeed - speed) * .3;
      previousX = x; previousY = y;
      const response = config.cursorVelocityResponse / 100;
      const smooth = 1 - Math.exp(-dt / (16 + config.cursorSmoothness * .85 + speed * response * 24));
      if (effect === 'dot-trail' || effect === 'sparks') {
        if (age < 80 && (points[0].x !== x || points[0].y !== y)) {
          for (let i = count - 1; i > 0; i--) Object.assign(points[i], points[i - 1]);
          Object.assign(points[0], { x, y, born: now });
        }
      } else {
        for (let i = 0; i < count; i++) {
          const goal = i ? points[i - 1] : { x, y };
          const follow = effect === 'glow' ? 1 : i === 0 ? Math.min(1, smooth * 1.65) : smooth;
          points[i].x += (goal.x - points[i].x) * follow;
          points[i].y += (goal.y - points[i].y) * follow;
        }
      }
      for (let i = 0; i < count; i++) {
        const taper = Math.pow(1 - i / count, 1.5);
        const point = points[i];
        const previous = i ? points[i - 1] : { x, y };
        let px = point.x, py = point.y, width = config.cursorTrailSize * (.25 + .75 * taper), height = width, angle = 0;
        let opacity = config.cursorTrailIntensity / 100 * fade * taper;
        if (effect === 'portfolio-trail' || effect === 'ribbon' || effect === 'comet') {
          const distance = Math.hypot(previous.x - px, previous.y - py);
          angle = Math.atan2(previous.y - py, previous.x - px) * 180 / Math.PI;
          width = Math.min(120, distance + 2);
          height = config.cursorTrailSize * taper * (effect === 'ribbon' ? 1.6 : effect === 'portfolio-trail' ? .35 : 1);
          px = (px + previous.x) / 2; py = (py + previous.y) / 2;
          opacity *= .3 + Math.min(.7, speed * (.2 + response));
          if (i === 0 && effect !== 'ribbon') { px = point.x; py = point.y; width = height = config.cursorTrailSize * 2; }
        } else if (effect === 'glow') { width = height = config.cursorTrailSize * 5; }
        else if (effect === 'orbit') {
          const phase = now / 240 + i * Math.PI * 2 / count;
          const radius = (8 + config.cursorTrailSize + speed * response * 8) * fade;
          px = x + Math.cos(phase) * radius; py = y + Math.sin(phase) * radius;
        } else if (effect === 'sparks') {
          const life = Math.max(0, now - point.born);
          const phase = i * 2.399;
          px += Math.cos(phase) * life * .035 * (1 + response);
          py += Math.sin(phase) * life * .035 * (1 + response);
          angle = 45; opacity *= Math.max(0, 1 - life / fadeDuration);
        } else if (effect === 'dot-trail') opacity *= Math.max(0, 1 - (now - point.born) / fadeDuration);
        nodes[i].style.transform = `translate3d(${px}px, ${py}px, 0) translate(-50%, -50%) rotate(${angle}deg) scale(${Math.max(.1, width)}, ${Math.max(.1, height)})`;
        nodes[i].style.opacity = String(opacity);
      }
      requestFrame(frame); // Finite fade; movement is the only way to extend it.
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch') { stop(); return; }
      const element = event.target instanceof Element ? event.target : null;
      if (!preview && element?.closest('[role="dialog"], [role="alertdialog"], [data-custom-cursor-preview]')) { stop(); return; }
      // Keep native text selection, form widgets, disabled and resize/drag affordances.
      if (element?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [disabled], [aria-disabled="true"], [draggable="true"]')) { stop(); return; }
      eventTarget = element;
      interactive = Boolean(element?.closest('button, a, summary, [role="button"], [role="link"]'));
      if (preview && !bounds) measure();
      x = preview && bounds ? (event.clientX - bounds.left) * scaleX : event.clientX;
      y = preview && bounds ? (event.clientY - bounds.top) * scaleY : event.clientY;
      lastMove = performance.now();
      if (!started) {
        for (const point of points) Object.assign(point, { x, y, born: lastMove });
        previousX = x; previousY = y; speed = 0;
        started = true; lastFrame = lastMove - 16;
      }
      requestFrame(frame);
    };
    const down = (event: PointerEvent) => { move(event); if (started) { pressed = true; requestFrame(frame); } };
    const up = () => { if (started) { pressed = false; requestFrame(frame); } };
    const relocate = () => { bounds = null; stop(); };
    target.addEventListener('pointermove', move, { passive: true });
    target.addEventListener('pointerdown', down, { passive: true });
    target.addEventListener('pointerleave', stop);
    target.addEventListener('pointerenter', measure);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('blur', stop);
    window.addEventListener('scroll', relocate, { passive: true, capture: true });
    window.addEventListener('resize', relocate);
    disposeActive = () => {
      stop();
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerdown', down);
      target.removeEventListener('pointerleave', stop);
      target.removeEventListener('pointerenter', measure);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('blur', stop);
      window.removeEventListener('scroll', relocate, true);
      window.removeEventListener('resize', relocate);
      pointer?.remove(); for (const node of nodes) node.remove();
    };
  }
  reduced.addEventListener('change', reconcile);
  fine.addEventListener('change', reconcile);
  document.addEventListener('visibilitychange', reconcile);
  reconcile();
  return () => {
    disposeActive();
    reduced.removeEventListener('change', reconcile);
    fine.removeEventListener('change', reconcile);
    document.removeEventListener('visibilitychange', reconcile);
  };
}
