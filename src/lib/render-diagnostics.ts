export const RENDER_DIAGNOSTIC_NAMES = [
  'Dashboard',
  'Settings',
  'Navigation',
  'ActiveModule',
  'TutorialProvider',
] as const;

export type RenderDiagnosticName = typeof RENDER_DIAGNOSTIC_NAMES[number];
export type RenderDiagnosticSnapshot = Record<string, string | number | boolean | null | undefined>;

export type RenderDiagnosticEntry = {
  renders: number;
  lastChanged: string[];
  changes: Record<string, number>;
  lastAt: number | null;
};

export type RenderDiagnosticsSnapshot = Record<RenderDiagnosticName, RenderDiagnosticEntry>;

type RenderDiagnosticStore = {
  entries: RenderDiagnosticsSnapshot;
  previous: Partial<Record<RenderDiagnosticName, RenderDiagnosticSnapshot>>;
};

const createEntry = (): RenderDiagnosticEntry => ({
  renders: 0,
  lastChanged: [],
  changes: {},
  lastAt: null,
});

const store: RenderDiagnosticStore = {
  entries: Object.fromEntries(RENDER_DIAGNOSTIC_NAMES.map((name) => [name, createEntry()])) as RenderDiagnosticsSnapshot,
  previous: {},
};

function changedCategories(
  previous: RenderDiagnosticSnapshot | undefined,
  next: RenderDiagnosticSnapshot,
) {
  if (!previous) return ['mount'];
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  const changed = [...keys].filter((key) => !Object.is(previous[key], next[key]));
  return changed.length ? changed : ['parent-or-context'];
}

export function recordDevRender(name: RenderDiagnosticName, snapshot: RenderDiagnosticSnapshot = {}) {
  if (!import.meta.env.DEV) return;

  const changed = changedCategories(store.previous[name], snapshot);
  const entry = store.entries[name];
  entry.renders += 1;
  entry.lastChanged = changed;
  entry.lastAt = performance.now();
  for (const category of changed) entry.changes[category] = (entry.changes[category] || 0) + 1;
  store.previous[name] = { ...snapshot };
}

export function getDevRenderDiagnostics(): RenderDiagnosticsSnapshot {
  return Object.fromEntries(RENDER_DIAGNOSTIC_NAMES.map((name) => {
    const entry = store.entries[name];
    return [name, {
      ...entry,
      lastChanged: [...entry.lastChanged],
      changes: { ...entry.changes },
    }];
  })) as RenderDiagnosticsSnapshot;
}

export function resetDevRenderDiagnostics() {
  for (const name of RENDER_DIAGNOSTIC_NAMES) store.entries[name] = createEntry();
}

declare global {
  interface Window {
    __STANZA_RENDER_DIAGNOSTICS__?: {
      snapshot: typeof getDevRenderDiagnostics;
      reset: typeof resetDevRenderDiagnostics;
    };
  }
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__STANZA_RENDER_DIAGNOSTICS__ = {
    snapshot: getDevRenderDiagnostics,
    reset: resetDevRenderDiagnostics,
  };
}
