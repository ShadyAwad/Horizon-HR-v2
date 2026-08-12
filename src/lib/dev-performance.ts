import { getDevRenderDiagnostics } from './render-diagnostics';

type DiagnosticDetail = Record<string, string | number | boolean | null | undefined>;

type DiagnosticRecord = {
  name: string;
  kind: 'mark' | 'measure' | 'interaction-settle' | 'resource';
  startTime: number;
  duration: number;
  detail?: DiagnosticDetail;
};

type LanyardFrameTier = 'active' | 'passive' | 'settled' | 'unmounted';

const records: DiagnosticRecord[] = [];
const once = new Set<string>();
const interactionStarts = new Map<string, number>();
let lanyardFrameTier: LanyardFrameTier = 'unmounted';
let sequence = 0;

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
  const startMark = `interaction:${name}:start:${id}`;
  const handlerEndMark = `interaction:${name}:handler-end:${id}`;
  const rendersBefore = renderCount();
  const resourcesBefore = performance.getEntriesByType('resource').length;
  interactionStarts.set(name, start);
  markDevPerformance(startMark, { id });

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
      if (interactionStarts.get(name) !== start) return;
      append({
        name: `interaction:${name}:settled`,
        kind: 'interaction-settle',
        startTime: start,
        duration: performance.now() - start,
        detail: {
          id,
          renderDelta: renderCount() - rendersBefore,
          resourceDelta: performance.getEntriesByType('resource').length - resourcesBefore,
          runningAnimations: runningAnimations(),
          lanyardFrameTier,
        },
      });
    }, 2000);
  }
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
  };
}

export function resetDevPerformanceDiagnostics() {
  records.length = 0;
  once.clear();
  interactionStarts.clear();
}

declare global {
  interface Window {
    __STANZA_PERFORMANCE_DIAGNOSTICS__?: {
      snapshot: typeof getDevPerformanceDiagnostics;
      reset: typeof resetDevPerformanceDiagnostics;
    };
  }
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__STANZA_PERFORMANCE_DIAGNOSTICS__ = {
    snapshot: getDevPerformanceDiagnostics,
    reset: resetDevPerformanceDiagnostics,
  };
}
