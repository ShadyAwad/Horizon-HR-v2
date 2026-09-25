import { useEffect, useRef, type RefObject } from 'react';
import { loginCardEffectCss, readLoginCardEffect } from './login-card-effects';

const options = import.meta.env.DEV
  ? readLoginCardEffect(typeof window === 'undefined' ? '' : window.location.search)
  : { mode: 'baseline' as const, trace: false };

const properties = ['background-color', 'background-image', 'opacity', 'backdrop-filter',
  '-webkit-backdrop-filter', 'box-shadow', 'border-radius', 'overflow-x', 'overflow-y',
  'transform', 'translate', 'rotate', 'scale', 'filter', 'isolation', 'contain',
  'will-change', 'position', 'z-index', 'animation-name', 'animation-duration',
  'animation-fill-mode', 'transition-property', 'content', 'display'];

function inventory(card: HTMLElement) {
  const elements: Element[] = [];
  for (let element: Element | null = card; element; element = element.parentElement) elements.push(element);
  const shell = card.closest('.stanza-auth-shell');
  shell?.querySelectorAll('canvas').forEach((canvas) => {
    for (let element: Element | null = canvas; element && element !== shell; element = element.parentElement) {
      if (!elements.includes(element)) elements.push(element);
    }
  });
  return elements.map((element, index) => ({
    element, label: index === 0 ? 'login-card' : `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}[${index}]`,
  }));
}

/** Opt-in computed-style/geometry evidence, not a GPU paint or compositor trace. */
export function useDevLoginCardEffects(card: RefObject<HTMLDivElement | null>) {
  const frame = useRef<number | null>(null);
  const capture = useRef<null | {
    start: number; toggles: number; layers: ReturnType<typeof inventory>;
    previous: string; samples: unknown[]; styleChanges: unknown[];
  }>(null);
  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    capture.current = null;
  }, []);

  const sample = () => {
    const current = capture.current;
    if (!current) return;
    const elapsed = performance.now() - current.start;
    const geometry = current.layers.map(({ element, label }) => {
      const rect = element.getBoundingClientRect();
      return { label, connected: element.isConnected, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    const styles = current.layers.map(({ element, label }) => ({
      label, styles: [null, '::before', '::after'].map((pseudo) => {
        const computed = getComputedStyle(element, pseudo);
        return { pseudo, values: Object.fromEntries(properties.map((property) => [property, computed.getPropertyValue(property)])) };
      }),
    }));
    const signature = JSON.stringify(styles);
    if (signature !== current.previous) current.styleChanges.push({ elapsed, styles });
    current.previous = signature;
    current.samples.push({ elapsed, geometry });
    if (elapsed < 400) {
      frame.current = requestAnimationFrame(sample);
      return;
    }
    const record = { mode: options.mode, theme: document.documentElement.dataset.theme,
      toggles: current.toggles, samples: current.samples, styleChanges: current.styleChanges,
      paintInvalidation: 'unmeasured: computed styles do not expose raster/compositor defects' };
    const target = window as Window & { __stanzaLoginCardEffects?: unknown[] };
    const records = target.__stanzaLoginCardEffects ??= [];
    records.push(record);
    if (records.length > 20) records.shift();
    console.info('[login-card-effects]', JSON.stringify(record));
    frame.current = null;
    capture.current = null;
  };

  const beforeToggle = () => {
    if (!options.trace || !card.current) return;
    if (capture.current) { capture.current.toggles++; return; }
    capture.current = { start: performance.now(), toggles: 1, layers: inventory(card.current),
      previous: '', samples: [], styleChanges: [] };
    sample(); // Include pre-update state; following samples are animation-frame callbacks.
  };
  return { mode: options.mode, css: loginCardEffectCss(options.mode), beforeToggle };
}
