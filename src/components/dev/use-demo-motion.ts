import { useEffect, useLayoutEffect, useRef } from 'react';
import { demoMotionCss, readDemoMotion } from './demo-motion';
import { useDevLoginCardEffects } from './use-login-card-effects';

const options = import.meta.env.DEV
  ? readDemoMotion(typeof window === 'undefined' ? '' : window.location.search)
  : { mode: 'grid' as const, trace: false };
let nextInstance = 0;
let nextNode = 0;
const identities = /* @__PURE__ */ new WeakMap<Element, number>();
function identity(element: Element | null) {
  if (!element) return null;
  if (!identities.has(element)) identities.set(element, ++nextNode);
  return identities.get(element)!;
}
type Capture = {
  start: number; renders: number; commits: number; before: ReturnType<typeof snapshot>;
  nodes: Element[]; samples: Array<{ cardHeight: number; cardTop: number; panelHeight: number; opacity: string }>;
  overlapped: boolean;
};
function snapshot(card: HTMLElement | null, parent: HTMLElement | null, panel: HTMLElement | null, content: HTMLElement | null) {
  return { card: identity(card), parent: identity(parent), panel: identity(panel), content: identity(content) };
}

/** DEV-only, build-gated at the Login call site. Trace instrumentation is opt-in. */
export function useDevDemoMotion(open: boolean) {
  const card = useRef<HTMLDivElement>(null);
  const cardEffects = useDevLoginCardEffects(card);
  const parent = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const currentOpen = useRef(open);
  currentOpen.current = open;
  const counts = useRef({ renders: 0, commits: 0, instance: 0 });
  if (!counts.current.instance) counts.current.instance = ++nextInstance;
  if (options.trace) counts.current.renders++;
  const active = useRef<Capture[]>([]);
  const frame = useRef<number | null>(null);

  const publish = (record: Record<string, unknown>) => {
    const target = window as Window & { __stanzaDemoMotion?: Record<string, unknown>[] };
    const records = target.__stanzaDemoMotion ??= [];
    records.push({ mode: options.mode, instance: counts.current.instance, ...record });
    if (records.length > 100) records.shift();
    console.info('[demo-motion-trace]', JSON.stringify(records.at(-1)));
  };

  useLayoutEffect(() => {
    if (options.trace) counts.current.commits++;
    if (options.mode === 'max-height' && panel.current && content.current) {
      panel.current.style.maxHeight = open ? `${content.current.scrollHeight}px` : '0px';
    }
  });

  useLayoutEffect(() => {
    if (options.mode !== 'max-height' || !content.current) return;
    // Natural content height follows localization and wrapping, without React state updates.
    const observer = new ResizeObserver(() => {
      if (panel.current && content.current && currentOpen.current) {
        panel.current.style.maxHeight = `${content.current.scrollHeight}px`;
      }
    });
    observer.observe(content.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!options.trace) return;
    publish({ event: 'effect-setup', nodes: snapshot(card.current, parent.current, panel.current, content.current) });
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      publish({ event: 'effect-cleanup', unfinishedCaptures: active.current.length });
      active.current = [];
    };
  }, []);

  const sample = () => {
    frame.current = null;
    const now = performance.now();
    if (!card.current || !panel.current) return;
    const cardRect = card.current.getBoundingClientRect();
    const panelRect = panel.current.getBoundingClientRect();
    const opacity = getComputedStyle(panel.current).opacity;
    active.current = active.current.filter((capture) => {
      capture.samples.push({ cardHeight: cardRect.height, cardTop: cardRect.top, panelHeight: panelRect.height, opacity });
      if (now - capture.start < 350) return true;
      const after = snapshot(card.current, parent.current, panel.current, content.current);
      publish({
        event: 'toggle', theme: document.documentElement.dataset.theme,
        renderCalls: counts.current.renders - capture.renders,
        committedRenders: counts.current.commits - capture.commits,
        overlappingToggles: capture.overlapped,
        before: capture.before, after,
        sameCard: capture.before.card === after.card,
        sameParent: capture.before.parent === after.parent,
        samePanel: capture.before.panel === after.panel,
        sameContent: capture.before.content === after.content,
        retainedDescendants: capture.nodes.every((node) => node.isConnected && content.current?.contains(node)),
        cardGeometryChanged: new Set(capture.samples.map((s) => `${s.cardHeight}:${s.cardTop}`)).size > 1,
        paintInvalidation: 'unmeasured: use Chrome Paint flashing / Performance',
        expanded: currentOpen.current, samples: capture.samples,
      });
      return false;
    });
    if (active.current.length) frame.current = requestAnimationFrame(sample);
  };

  const beforeToggle = () => {
    cardEffects.beforeToggle();
    if (!options.trace || !content.current) return;
    active.current.forEach((capture) => { capture.overlapped = true; });
    if (active.current.length >= 40) {
      publish({ event: 'capture-limit', note: 'Wait for the current bounded captures to finish.' });
      return;
    }
    const cardRect = card.current?.getBoundingClientRect();
    const panelRect = panel.current?.getBoundingClientRect();
    active.current.push({
      start: performance.now(), renders: counts.current.renders, commits: counts.current.commits,
      before: snapshot(card.current, parent.current, panel.current, content.current),
      nodes: [...content.current.querySelectorAll('*')],
      samples: cardRect && panelRect && panel.current ? [{
        cardHeight: cardRect.height, cardTop: cardRect.top, panelHeight: panelRect.height,
        opacity: getComputedStyle(panel.current).opacity,
      }] : [],
      overlapped: active.current.length > 0,
    });
    if (frame.current === null) frame.current = requestAnimationFrame(sample);
  };

  return {
    card, parent, panel, content, beforeToggle,
    mode: options.mode, cardEffect: cardEffects.mode,
    css: demoMotionCss(options.mode) + cardEffects.css,
  };
}
