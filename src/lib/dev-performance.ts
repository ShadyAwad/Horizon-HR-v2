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

type LanyardFrameTier = 'active' | 'passive' | 'settled' | 'unmounted';

const records: DiagnosticRecord[] = [];
const once = new Set<string>();
const interactionStarts = new Map<string, number>();
let lanyardFrameTier: LanyardFrameTier = 'unmounted';
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

export function setDevLanyardFrameTier(tier: LanyardFrameTier) {
  if (!import.meta.env.DEV) return;
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
    runtime: { lanyardFrameTier },
    benchmark: armedBenchmark ? { ...armedBenchmark } : null,
  };
}

export function resetDevPerformanceDiagnostics() {
  records.length = 0;
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
