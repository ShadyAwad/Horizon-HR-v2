import { getDevRenderDiagnostics } from './render-diagnostics';

type DiagnosticDetail = Record<string, string | number | boolean | null | undefined>;

type InteractionDetail = DiagnosticDetail & {
  id: number;
  idleBeforeMs: number;
  domNodesBefore?: number;
  domNodesAfter?: number;
  canvasCountBefore?: number;
  canvasCountAfter?: number;
  domMutationCount?: number;
  longTaskCount?: number;
  longTaskDuration?: number;
  eventCount?: number;
  eventDuration?: number;
  frameCount?: number;
  worstFrameDuration?: number;
  heapDeltaBytes?: number | null;
  benchmarkScenario?: string;
  benchmarkIdleTargetMs?: number;
  benchmarkIdleTargetMet?: boolean;
};

type DiagnosticRecord = {
  name: string;
  kind: 'mark' | 'measure' | 'interaction-settle' | 'resource';
  startTime: number;
  duration: number;
  detail?: DiagnosticDetail | InteractionDetail;
};

type LanyardFrameTier = 'active' | 'passive' | 'settled' | 'paused' | 'unmounted';

const records: DiagnosticRecord[] = [];
const once = new Set<string>();
const interactionStarts = new Map<string, number>();
let lanyardFrameTier: LanyardFrameTier = 'unmounted';
export type DevLanyardQuality = 'auto' | 'full' | 'chromium-lightweight' | 'very-light';
let lanyardQuality: DevLanyardQuality = 'auto';
type LanyardWorkKind = 'advance' | 'frame' | 'render' | 'physics' | 'pointer' | 'wake' | 'pointer-target' | 'drag-start' | 'drag-end' | 'settled';
const lanyardSamples: Array<{ at: number; tier: LanyardFrameTier; kind: LanyardWorkKind; duration: number }> = [];
const lanyardTotals: Record<LanyardWorkKind, number> = { advance: 0, frame: 0, render: 0, physics: 0, pointer: 0, wake: 0, 'pointer-target': 0, 'drag-start': 0, 'drag-end': 0, settled: 0 };
const lanyardDurations = { active: 0, passive: 0, settled: 0, paused: 0, unmounted: 0 };
let lanyardTierStarted = performance.now();
let lanyardSettledAt: number | null = null;
let lanyardPending = { timer: false, raf: false };
export function setDevLanyardPending(timer: boolean, raf: boolean) {
  if (import.meta.env.DEV) lanyardPending = { timer, raf };
}
export function getDevLanyardQuality() { return import.meta.env.DEV ? lanyardQuality : 'auto'; }
export function setDevLanyardQuality(value: DevLanyardQuality) {
  if (!import.meta.env.DEV) return;
  lanyardQuality = value;
  window.dispatchEvent(new Event('stanza-lanyard-quality'));
}
export function recordDevLanyardWork(kind: LanyardWorkKind, duration = 0) {
  if (!import.meta.env.DEV) return;
  lanyardTotals[kind]++;
  if (!guidedBenchmarkWindow) return;
  if (lanyardSamples.length < 20000) lanyardSamples.push({ at: performance.now(), tier: lanyardFrameTier, kind, duration });
}

// Opt-in style reads perturb timing. Use this separately from CPU benchmarks.
// Bounded to the selected control, its parent, and containing stacking contexts.
const controlFrames: Array<Record<string, unknown>> = [];
export function observeDevControlFrames(root: HTMLElement) {
  if (!import.meta.env.DEV) return () => undefined;
  let frame = 0;
  const describe = (element: Element, pseudo?: string) => {
    const style = getComputedStyle(element, pseudo);
    return Object.fromEntries(['background-color', 'background-image', 'opacity', 'transform', 'filter', 'backdrop-filter', 'box-shadow', 'outline', 'border-color', 'color', 'position', 'z-index', 'isolation', 'will-change', 'contain', 'mask-image', 'content', 'scale', 'translate', 'rotate', 'clip-path', 'overflow', 'border-radius', 'transition-property', 'transition-duration'].map((property) => [property, style.getPropertyValue(property)]));
  };
  const capture = (button: HTMLElement, phase: string, eventTimestamp: number | null = null) => {
    const stackingContexts = [];
    for (let parent = button.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (style.transform !== 'none' || style.scale !== 'none' || style.translate !== 'none' || style.rotate !== 'none' || style.clipPath !== 'none' || style.filter !== 'none' || style.backdropFilter !== 'none' || Number(style.opacity) < 1 || style.isolation === 'isolate' || style.position === 'fixed' || style.zIndex !== 'auto' || style.contain.includes('paint') || style.maskImage !== 'none') stackingContexts.push({ element: `${parent.tagName}.${parent.className}`, style: describe(parent) });
    }
    controlFrames.push({ at: performance.now(), eventTimestamp, lanyardFrameTier, lanyardFrames: lanyardTotals.frame, className: button.className, disabled: button.matches(':disabled'), phase, control: button.dataset.perfControl ?? button.dataset.geoInteraction ?? button.id, active: button.matches(':active'), hover: button.matches(':hover'), focus: button.matches(':focus'), selected: button.getAttribute('aria-pressed') ?? button.getAttribute('aria-checked') ?? button.getAttribute('data-selected'), style: describe(button), before: describe(button, '::before'), after: describe(button, '::after'), parent: button.parentElement ? describe(button.parentElement) : null, stackingContexts });
    if (controlFrames.length > 240) controlFrames.shift();
  };
  const handle = (event: Event) => {
    const button = (event.target as Element).closest<HTMLElement>('[data-perf-control], [data-geo-interaction]');
    if (!button) return;
    // Sample movement synchronously, but keep the entry RAF sequence alive.
    if (event.type !== 'pointermove') cancelAnimationFrame(frame);
    capture(button, event.type, event.timeStamp);
    if (event.type === 'pointermove') return;
    let remaining = 12;
    const sample = () => { if (!button.isConnected) return; capture(button, `${event.type}:frame`, event.timeStamp); if (--remaining > 0) frame = requestAnimationFrame(sample); };
    frame = requestAnimationFrame(sample);
  };
  root.querySelectorAll<HTMLElement>('[data-perf-control], [data-geo-interaction]').forEach((button) => capture(button, 'rest'));
  const events = ['pointerenter', 'mouseover', 'mouseenter', 'pointermove', 'pointerdown', 'pointerup', 'mouseleave', 'pointerover', 'pointerout', 'focusin', 'click'];
  events.forEach((event) => root.addEventListener(event, handle, true));
  return () => { cancelAnimationFrame(frame); events.forEach((event) => root.removeEventListener(event, handle, true)); };
}
let sequence = 0;
let lastInteractionAt = performance.now();
let armedBenchmark: { scenario: string; idleTargetMs: number; armedAt: number } | null = null;

type InteractionWindowMetrics = {
  mutationCount: number;
  longTaskCount: number;
  longTaskDuration: number;
  eventCount: number;
  eventDuration: number;
  frameCount: number;
  worstFrameDuration: number;
  finish: () => InteractionWindowSample;
};

type InteractionWindowSample = Omit<InteractionWindowMetrics, 'finish'>;

export type GuidedBenchmarkCapture = {
  scenario: string;
  durationMs: number;
  twoFramePaintMs: number;
  handlerCount: number;
  handlerDurationMs: number;
  renderDelta: number;
  resourceDelta: number;
  domNodesBefore: number;
  domNodesAfter: number;
  canvasCountBefore: number;
  canvasCountAfter: number;
  domMutationCount: number;
  longTaskCount: number;
  longTaskDuration: number;
  eventCount: number;
  eventDuration: number;
  frameCount: number;
  worstFrameDuration: number;
  heapDeltaBytes: number | null;
  runningAnimations: number;
  lanyardFrameTier: LanyardFrameTier;
};

type GuidedBenchmarkWindow = {
  scenario: string;
  startedAt: number;
  rendersBefore: number;
  resourcesBefore: number;
  domNodesBefore: number;
  canvasCountBefore: number;
  heapBefore: number | null;
  recordStartIndex: number;
  metrics: InteractionWindowMetrics;
};

let guidedBenchmarkWindow: GuidedBenchmarkWindow | null = null;
let guidedCaptureResolve: ((value: GuidedBenchmarkCapture | null) => void) | undefined;
let guidedBenchmarkFirstFrame: number | undefined;
let guidedBenchmarkSecondFrame: number | undefined;
let guidedBenchmarkSettleTimer: number | undefined;
let guidedBenchmarkDeadline: number | undefined;

type MemoryPerformance = Performance & { memory?: { usedJSHeapSize?: number } };

function countDomNodes() {
  return document.querySelectorAll('*').length;
}

function readHeapBytes() {
  const value = (performance as MemoryPerformance).memory?.usedJSHeapSize;
  return typeof value === 'number' ? value : null;
}

function observeEntries(
  type: 'longtask' | 'event',
  onEntry: (entry: PerformanceEntry) => void,
) {
  if (typeof PerformanceObserver === 'undefined') return null;
  try {
    const observer = new PerformanceObserver((list) => list.getEntries().forEach(onEntry));
    observer.observe({ type, buffered: false });
    return observer;
  } catch {
    // Event Timing and Long Tasks are Chromium capabilities. Their absence is
    // diagnostic information, not an application failure.
    return null;
  }
}

function collectInteractionWindow(start: number): InteractionWindowMetrics {
  let mutationCount = 0;
  let longTaskCount = 0;
  let longTaskDuration = 0;
  let eventCount = 0;
  let eventDuration = 0;
  let frameCount = 0;
  let worstFrameDuration = 0;
  let previousFrame = start;
  let frameHandle = 0;
  const mutations = new MutationObserver((entries) => {
    mutationCount += entries.reduce((count, entry) => count + entry.addedNodes.length + entry.removedNodes.length + (entry.type === 'attributes' ? 1 : 0), 0);
  });
  mutations.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'aria-expanded', 'aria-selected', 'data-selected'] });
  const longTasks = observeEntries('longtask', (entry) => {
    if (entry.startTime < start) return;
    longTaskCount += 1;
    longTaskDuration += entry.duration;
  });
  const events = observeEntries('event', (entry) => {
    if (entry.startTime < start) return;
    eventCount += 1;
    eventDuration += entry.duration;
  });
  const sampleFrame = (now: number) => {
    frameCount += 1;
    worstFrameDuration = Math.max(worstFrameDuration, now - previousFrame);
    previousFrame = now;
    frameHandle = requestAnimationFrame(sampleFrame);
  };
  frameHandle = requestAnimationFrame(sampleFrame);

  return {
    mutationCount,
    longTaskCount,
    longTaskDuration,
    eventCount,
    eventDuration,
    frameCount,
    worstFrameDuration,
    finish() {
      cancelAnimationFrame(frameHandle);
      mutations.disconnect();
      longTasks?.disconnect();
      events?.disconnect();
      return {
        mutationCount,
        longTaskCount,
        longTaskDuration,
        eventCount,
        eventDuration,
        frameCount,
        worstFrameDuration,
      };
    },
  };
}

function append(record: DiagnosticRecord) {
  if (!import.meta.env.DEV) return;
  records.push(record);
  if (records.length > 250) records.splice(0, records.length - 250);
}

function renderCount() {
  return Object.values(getDevRenderDiagnostics())
    .reduce((total, entry) => total + entry.renders, 0);
}

function runningAnimations() {
  if (typeof document.getAnimations !== 'function') return 0;
  return document.getAnimations().filter((animation) => animation.playState === 'running').length;
}

export function markDevPerformance(name: string, detail?: DiagnosticDetail, onlyOnce = false) {
  if (!import.meta.env.DEV || typeof performance === 'undefined') return;
  if (onlyOnce && once.has(name)) return;
  if (onlyOnce) once.add(name);
  performance.mark(name, { detail });
  append({ name, kind: 'mark', startTime: performance.now(), duration: 0, detail });
}

export function measureDevPerformance(
  name: string,
  startMark: string,
  endMark: string,
  detail?: DiagnosticDetail,
) {
  if (!import.meta.env.DEV || typeof performance === 'undefined') return;
  try {
    const measure = performance.measure(name, { start: startMark, end: endMark, detail });
    append({ name, kind: 'measure', startTime: measure.startTime, duration: measure.duration, detail });
  } catch {
    // Diagnostics must never change application behaviour when a mark is absent.
  }
}

export function beginDevSpan(name: string, detail?: DiagnosticDetail) {
  if (!import.meta.env.DEV || typeof performance === 'undefined') return () => 0;
  const id = ++sequence;
  const startMark = `${name}:start:${id}`;
  const endMark = `${name}:end:${id}`;
  markDevPerformance(startMark, detail);
  return (endDetail?: DiagnosticDetail) => {
    markDevPerformance(endMark, endDetail);
    measureDevPerformance(name, startMark, endMark, { ...detail, ...endDetail });
    return performance.getEntriesByName(name, 'measure').at(-1)?.duration ?? 0;
  };
}

export async function loadDevMeasured<T>(name: string, loader: () => Promise<T>) {
  const finish = beginDevSpan(name);
  try {
    return await loader();
  } finally {
    finish();
  }
}

export function recordDevInteraction<T>(name: string, action: () => T): T {
  if (!import.meta.env.DEV || typeof window === 'undefined') return action();

  const id = ++sequence;
  const start = performance.now();
  const idleBeforeMs = start - lastInteractionAt;
  lastInteractionAt = start;
  const benchmark = armedBenchmark;
  armedBenchmark = null;
  const startMark = `interaction:${name}:start:${id}`;
  const handlerEndMark = `interaction:${name}:handler-end:${id}`;
  const rendersBefore = renderCount();
  const resourcesBefore = performance.getEntriesByType('resource').length;
  const isBenchmarkSample = Boolean(benchmark);
  const domNodesBefore = isBenchmarkSample ? countDomNodes() : undefined;
  const canvasCountBefore = isBenchmarkSample ? document.querySelectorAll('canvas').length : undefined;
  const heapBefore = isBenchmarkSample ? readHeapBytes() : null;
  const windowMetrics = isBenchmarkSample ? collectInteractionWindow(start) : null;
  interactionStarts.set(`${name}:${id}`, start);
  markDevPerformance(startMark, {
    id,
    idleBeforeMs: Math.round(idleBeforeMs),
    benchmarkScenario: benchmark?.scenario,
  });

  try {
    return action();
  } finally {
    markDevPerformance(handlerEndMark, { id });
    measureDevPerformance(`interaction:${name}:handler`, startMark, handlerEndMark, { id });

    requestAnimationFrame(() => requestAnimationFrame(() => {
      const paintedMark = `interaction:${name}:painted:${id}`;
      markDevPerformance(paintedMark, { id });
      measureDevPerformance(`interaction:${name}:paint`, startMark, paintedMark, { id });
    }));

    window.setTimeout(() => {
      if (interactionStarts.get(`${name}:${id}`) !== start) return;
      interactionStarts.delete(`${name}:${id}`);
      const sampled = windowMetrics?.finish();
      const heapAfter = isBenchmarkSample ? readHeapBytes() : null;
      append({
        name: `interaction:${name}:settled`,
        kind: 'interaction-settle',
        startTime: start,
        duration: performance.now() - start,
        detail: {
          id,
          idleBeforeMs: Math.round(idleBeforeMs),
          renderDelta: renderCount() - rendersBefore,
          resourceDelta: performance.getEntriesByType('resource').length - resourcesBefore,
          runningAnimations: runningAnimations(),
          lanyardFrameTier,
          domNodesBefore,
          domNodesAfter: isBenchmarkSample ? countDomNodes() : undefined,
          canvasCountBefore,
          canvasCountAfter: isBenchmarkSample ? document.querySelectorAll('canvas').length : undefined,
          domMutationCount: sampled?.mutationCount,
          longTaskCount: sampled?.longTaskCount,
          longTaskDuration: sampled ? Math.round(sampled.longTaskDuration * 10) / 10 : undefined,
          eventCount: sampled?.eventCount,
          eventDuration: sampled ? Math.round(sampled.eventDuration * 10) / 10 : undefined,
          frameCount: sampled?.frameCount,
          worstFrameDuration: sampled ? Math.round(sampled.worstFrameDuration * 10) / 10 : undefined,
          heapDeltaBytes: isBenchmarkSample && heapBefore !== null && heapAfter !== null ? heapAfter - heapBefore : null,
          benchmarkScenario: benchmark?.scenario,
          benchmarkIdleTargetMs: benchmark?.idleTargetMs,
          benchmarkIdleTargetMet: benchmark ? idleBeforeMs >= benchmark.idleTargetMs : undefined,
        },
      });
    }, 2000);
  }
}

export function armDevInteractionBenchmark(scenario: string, idleTargetMs = 10_000) {
  if (!import.meta.env.DEV || typeof window === 'undefined') return;
  armedBenchmark = { scenario, idleTargetMs, armedAt: performance.now() };
  markDevPerformance('interaction-benchmark:armed', { scenario, idleTargetMs });
}

/**
 * Starts one explicitly requested development-only measurement window. The
 * caller must finish it; observers and frame sampling never outlive the short
 * post-interaction settle period.
 */
export function beginDevGuidedBenchmarkCapture(scenario: string) {
  if (!import.meta.env.DEV || typeof window === 'undefined' || guidedBenchmarkWindow) return false;
  const startedAt = performance.now();
  lanyardSamples.length = 0;
  guidedBenchmarkWindow = {
    scenario,
    startedAt,
    rendersBefore: renderCount(),
    resourcesBefore: performance.getEntriesByType('resource').length,
    domNodesBefore: countDomNodes(),
    canvasCountBefore: document.querySelectorAll('canvas').length,
    heapBefore: readHeapBytes(),
    recordStartIndex: records.length,
    metrics: collectInteractionWindow(startedAt),
  };
  markDevPerformance('guided-benchmark:capture-start', { scenario });
  guidedBenchmarkDeadline = window.setTimeout(cancelDevGuidedBenchmarkCapture, 60_000);
  return true;
}

/** Finishes a guided measurement after two paints and the existing settle window. */
export function finishDevGuidedBenchmarkCapture() {
  const capture = guidedBenchmarkWindow;
  if (!import.meta.env.DEV || !capture || guidedCaptureResolve || typeof window === 'undefined') return Promise.resolve<GuidedBenchmarkCapture | null>(null);
  window.clearTimeout(guidedBenchmarkDeadline);
  guidedBenchmarkDeadline = undefined;

  return new Promise<GuidedBenchmarkCapture | null>((resolve) => {
    guidedCaptureResolve = resolve;
    const finishRequestedAt = performance.now();
    guidedBenchmarkFirstFrame = requestAnimationFrame(() => {
      guidedBenchmarkSecondFrame = requestAnimationFrame((paintedAt) => {
        guidedBenchmarkSettleTimer = window.setTimeout(() => {
        const sampled = capture.metrics.finish();
        const handlerMeasures = records
          .slice(capture.recordStartIndex)
          .filter((record) => record.kind === 'measure' && record.name.endsWith(':handler'));
        const heapAfter = readHeapBytes();
        const result: GuidedBenchmarkCapture = {
          scenario: capture.scenario,
          durationMs: Math.round((performance.now() - capture.startedAt) * 10) / 10,
          twoFramePaintMs: Math.round((paintedAt - finishRequestedAt) * 10) / 10,
          handlerCount: handlerMeasures.length,
          handlerDurationMs: Math.round(handlerMeasures.reduce((total, record) => total + record.duration, 0) * 10) / 10,
          renderDelta: renderCount() - capture.rendersBefore,
          resourceDelta: performance.getEntriesByType('resource').length - capture.resourcesBefore,
          domNodesBefore: capture.domNodesBefore,
          domNodesAfter: countDomNodes(),
          canvasCountBefore: capture.canvasCountBefore,
          canvasCountAfter: document.querySelectorAll('canvas').length,
          domMutationCount: sampled.mutationCount,
          longTaskCount: sampled.longTaskCount,
          longTaskDuration: Math.round(sampled.longTaskDuration * 10) / 10,
          eventCount: sampled.eventCount,
          eventDuration: Math.round(sampled.eventDuration * 10) / 10,
          frameCount: sampled.frameCount,
          worstFrameDuration: Math.round(sampled.worstFrameDuration * 10) / 10,
          heapDeltaBytes: capture.heapBefore !== null && heapAfter !== null ? heapAfter - capture.heapBefore : null,
          runningAnimations: runningAnimations(),
          lanyardFrameTier,
        };
        guidedBenchmarkFirstFrame = undefined;
        guidedBenchmarkSecondFrame = undefined;
        guidedBenchmarkSettleTimer = undefined;
        guidedBenchmarkWindow = null;
        append({ name: 'guided-benchmark:capture-settled', kind: 'interaction-settle', startTime: capture.startedAt, duration: result.durationMs, detail: result });
        guidedCaptureResolve = undefined;
        resolve(result);
      }, 2_000);
      });
    });
  });
}

/** Cancels an abandoned development capture, including every temporary observer. */
export function cancelDevGuidedBenchmarkCapture() {
  if (guidedBenchmarkDeadline !== undefined) window.clearTimeout(guidedBenchmarkDeadline);
  guidedBenchmarkDeadline = undefined;
  if (guidedBenchmarkFirstFrame !== undefined) cancelAnimationFrame(guidedBenchmarkFirstFrame);
  if (guidedBenchmarkSecondFrame !== undefined) cancelAnimationFrame(guidedBenchmarkSecondFrame);
  if (guidedBenchmarkSettleTimer !== undefined) window.clearTimeout(guidedBenchmarkSettleTimer);
  guidedBenchmarkFirstFrame = undefined;
  guidedBenchmarkSecondFrame = undefined;
  guidedBenchmarkSettleTimer = undefined;
  guidedBenchmarkWindow?.metrics.finish();
  guidedBenchmarkWindow = null;
  guidedCaptureResolve?.(null);
  guidedCaptureResolve = undefined;
}

export function setDevLanyardFrameTier(tier: LanyardFrameTier) {
  if (!import.meta.env.DEV) return;
  if (tier === lanyardFrameTier) return;
  const now = performance.now();
  lanyardDurations[lanyardFrameTier] += now - lanyardTierStarted;
  lanyardTierStarted = now;
  if (tier === 'settled') { lanyardSettledAt = now; recordDevLanyardWork('settled'); }
  lanyardFrameTier = tier;
}

export function recordDevResource(name: string, urlFragment: string) {
  if (!import.meta.env.DEV || typeof performance === 'undefined') return;
  const resources = performance.getEntriesByType('resource')
    .filter((entry): entry is PerformanceResourceTiming => entry instanceof PerformanceResourceTiming)
    .filter((entry) => entry.name.includes(urlFragment));
  const resource = resources.sort((left, right) => right.decodedBodySize - left.decodedBodySize)[0];
  if (!resource) return;
  const resourceKey = `resource:${name}:${resource.name}:${resource.startTime}`;
  if (once.has(resourceKey)) return;
  once.add(resourceKey);
  append({
    name,
    kind: 'resource',
    startTime: resource.startTime,
    duration: resource.duration,
    detail: {
      transferSize: resource.transferSize,
      encodedBodySize: resource.encodedBodySize,
      decodedBodySize: resource.decodedBodySize,
    },
  });
}

export function getDevPerformanceDiagnostics() {
  return {
    records: records.map((record) => ({ ...record, detail: record.detail ? { ...record.detail } : undefined })),
    runtime: { lanyardFrameTier, lanyardQuality, lanyardTotals: { ...lanyardTotals }, lanyardPending: { ...lanyardPending }, lanyardSettledAt, lanyardDurationMs: { ...lanyardDurations, [lanyardFrameTier]: lanyardDurations[lanyardFrameTier] + performance.now() - lanyardTierStarted } },
    lanyardSamples: lanyardSamples.map((sample) => ({ ...sample })),
    controlFrames: controlFrames.map((sample) => ({ ...sample })),
    benchmark: armedBenchmark ? { ...armedBenchmark } : null,
  };
}

export function resetDevPerformanceDiagnostics() {
  records.length = 0;
  lanyardSamples.length = 0;
  controlFrames.length = 0;
  once.clear();
  interactionStarts.clear();
  armedBenchmark = null;
  lastInteractionAt = performance.now();
}

declare global {
  interface Window {
    __STANZA_PERFORMANCE_DIAGNOSTICS__?: {
      snapshot: typeof getDevPerformanceDiagnostics;
      reset: typeof resetDevPerformanceDiagnostics;
      armBenchmark: typeof armDevInteractionBenchmark;
    };
  }
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__STANZA_PERFORMANCE_DIAGNOSTICS__ = {
    snapshot: getDevPerformanceDiagnostics,
    reset: resetDevPerformanceDiagnostics,
    armBenchmark: armDevInteractionBenchmark,
  };
}
