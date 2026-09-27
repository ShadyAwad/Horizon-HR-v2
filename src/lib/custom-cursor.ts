import { normaliseCustomTheme, type CustomThemeConfig } from './custom-theme';

/** Bounded, event-driven decoration. No React updates, canvas, filters or idle loop. */
export function installCustomCursor(value: CustomThemeConfig, target: HTMLElement = document.body, preview = false) {
  const config = normaliseCustomTheme(value);
  if (config.cursorEffect === 'none') return () => {};
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
  let disposeActive = () => {};
  function reconcile() {
    disposeActive();
    disposeActive = () => {};
    if (reduced.matches || !fine.matches || document.hidden) return;
    const count = config.cursorEffect === 'glow' ? 1 : config.cursorTrailLength;
    const nodes = Array.from({ length: count }, () => {
      const node = document.createElement('span');
      node.className = `stanza-cursor-particle stanza-cursor-${config.cursorEffect}`;
      node.setAttribute('aria-hidden', 'true');
      node.style.color = config.cursorColor ?? config.accent;
      node.style.position = preview ? 'absolute' : 'fixed';
      target.appendChild(node);
      return node;
    });
    const points = nodes.map(() => ({ x: 0, y: 0, born: -Infinity }));
    let raf = 0, lastMove = 0, lastFrame = 0, x = 0, y = 0, started = false;
    let bounds: DOMRect | null = null, scaleX = 1, scaleY = 1;
    const measure = () => {
      if (preview) {
        bounds = target.getBoundingClientRect();
        scaleX = bounds.width ? target.clientWidth / bounds.width : 1;
        scaleY = bounds.height ? target.clientHeight / bounds.height : 1;
      }
    };
    const stop = () => {
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;
      started = false;
      for (const node of nodes) node.style.opacity = '0';
    };
    const frame = (now: number) => {
      raf = 0;
      const age = now - lastMove;
      if (age >= 650) { stop(); return; }
      const smoothing = 1 - Math.exp(-Math.min(50, now - lastFrame) / 45);
      lastFrame = now;
      if (config.cursorEffect === 'dot-trail') {
        if (age < 80 && (points[0].x !== x || points[0].y !== y)) {
          for (let i = count - 1; i > 0; i--) Object.assign(points[i], points[i - 1]);
          Object.assign(points[0], { x, y, born: now });
        }
      } else {
        for (let i = 0; i < count; i++) {
          const goal = i === 0 ? { x, y } : points[i - 1];
          points[i].x += (goal.x - points[i].x) * (config.cursorEffect === 'glow' ? 1 : smoothing);
          points[i].y += (goal.y - points[i].y) * (config.cursorEffect === 'glow' ? 1 : smoothing);
        }
      }
      for (let i = 0; i < count; i++) {
        const fade = config.cursorEffect === 'dot-trail'
          ? Math.max(0, 1 - (now - points[i].born) / 400)
          : Math.max(0, 1 - Math.max(0, age - 200) / 350);
        nodes[i].style.transform = `translate(${points[i].x}px, ${points[i].y}px) translate(-50%, -50%) scale(${1 - i / (count * 1.5)})`;
        nodes[i].style.opacity = String(fade * config.cursorTrailIntensity / 100 * (1 - i / (count + 1)));
      }
      // The finite fade also stops a converged lerp trail; no permanent RAF.
      if (age < 550) raf = window.requestAnimationFrame(frame);
      else stop();
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      // The global decoration sits below dialogs; do not animate invisibly behind them.
      if (!preview && event.target instanceof Element && event.target.closest('[role="dialog"], [role="alertdialog"], [data-custom-cursor-preview]')) { stop(); return; }
      if (preview && !bounds) measure();
      x = preview && bounds ? (event.clientX - bounds.left) * scaleX : event.clientX;
      y = preview && bounds ? (event.clientY - bounds.top) * scaleY : event.clientY;
      lastMove = performance.now();
      if (!started) {
        for (const point of points) Object.assign(point, { x, y, born: lastMove });
        started = true;
        lastFrame = lastMove - 16;
      }
      if (!raf) raf = window.requestAnimationFrame(frame);
    };
    target.addEventListener('pointermove', move, { passive: true });
    target.addEventListener('pointerleave', stop);
    target.addEventListener('pointerenter', measure);
    window.addEventListener('blur', stop);
    if (preview) {
      window.addEventListener('scroll', measure, { passive: true, capture: true });
      window.addEventListener('resize', measure);
    }
    disposeActive = () => {
      stop();
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerleave', stop);
      target.removeEventListener('pointerenter', measure);
      window.removeEventListener('blur', stop);
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
      for (const node of nodes) node.remove();
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
