import { useEffect, useRef, useState } from 'react';
import type { PerformanceIsolation } from '../../lib/performance-isolation';
import { armDevInteractionBenchmark, getDevPerformanceDiagnostics } from '../../lib/dev-performance';
import {
  getDevRenderDiagnostics,
  resetDevRenderDiagnostics,
  type RenderDiagnosticsSnapshot,
} from '../../lib/render-diagnostics';

type Props = {
  value: PerformanceIsolation;
  onChange: (value: PerformanceIsolation) => void;
  activePreset: string;
  module: string;
  settingsOpen: boolean;
  lanyardMounted: boolean;
};
type Metrics = { dom: number; canvases: number; viewport: string; visibility: string };
type Sample = { frames: number; fps: number; over16: number; over33: number; over50: number; worst: number };

const labels: Array<[keyof PerformanceIsolation, string]> = [
  ['lanyard', 'Lanyard Canvas / physics'], ['topography', 'Topographic contour layer'], ['atmosphere', 'Ambient glow / gradient atmosphere'], ['shadows', 'Dashboard decorative shadows'], ['translucentSurfaces', 'Dashboard translucent / alpha surfaces'], ['settingsBackdrop', 'Settings overlay / dimming'], ['tutorials', 'Tutorial provider / overlay'], ['attentionPolling', 'Attention-count polling'], ['recentFrequent', 'Recent / Frequent launcher'], ['badges', 'Notification / count badges'], ['mobileNavigation', 'Mobile fixed bottom navigation'], ['geoSecondaryPanels', 'Geo Operations secondary panels'], ['transitions', 'Theme transitions / micro-interactions'], ['visualAtmosphere', 'All non-essential visual atmosphere'],
];
const matrix = ['Baseline: everything enabled', '1. Lanyard off', '2. Contours + atmosphere off', '3. Shadows + translucency off', '4. Tutorials off', '5. Polling + badges off', '6. Settings open normally', '7. Settings without backdrop', '8. Settings with lanyard off', '9. Settings with backdrop + lanyard off'];
const interactionScenarios = [
  ['launcher-open', 'A. Open Launcher'], ['launcher-close', 'B. Close Launcher'],
  ['settings-open', 'C. Open Settings'], ['settings-close', 'D. Close Settings'],
  ['module-switch', 'E. Switch module'], ['launcher-scroll', 'F. Scroll Launcher'],
  ['workspace-scroll', 'G. Scroll workspace'], ['control-hover', 'H. Hover controls'],
  ['tutorial-next', 'I. Tutorial Next'], ['theme-change', 'J. Change theme'],
  ['lanyard-interact', 'K. Interact lanyard'], ['lanyard-disabled-interact', 'L. Interact with lanyard disabled'],
] as const;

export default function PerformanceIsolationPanel({ value, onChange, activePreset, module, settingsOpen, lanyardMounted }: Props) {
  const [open, setOpen] = useState(false);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [sample, setSample] = useState<Sample | null>(null);
  const [renders, setRenders] = useState<RenderDiagnosticsSnapshot>(() => getDevRenderDiagnostics());
  const [timings, setTimings] = useState(() => getDevPerformanceDiagnostics());
  const [scenario, setScenario] = useState<(typeof interactionScenarios)[number][0]>('launcher-open');
  const [idleSeconds, setIdleSeconds] = useState(10);
  const raf = useRef<number | undefined>(undefined);

  const refresh = () => {
    setMetrics({
      dom: document.querySelectorAll('*').length,
      canvases: document.querySelectorAll('canvas').length,
      viewport: `${window.innerWidth} x ${window.innerHeight}`,
      visibility: document.visibilityState,
    });
    setRenders(getDevRenderDiagnostics());
    setTimings(getDevPerformanceDiagnostics());
  };
  const resetRenders = () => {
    resetDevRenderDiagnostics();
    setRenders(getDevRenderDiagnostics());
  };

  useEffect(() => {
    if (open) refresh();
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [open, value]);

  const record = () => {
    if (raf.current) return;
    setSample(null);
    let start = 0;
    let previous = 0;
    let frames = 0;
    let over16 = 0;
    let over33 = 0;
    let over50 = 0;
    let worst = 0;
    const tick = (now: number) => {
      if (!start) { start = now; previous = now; }
      const delta = now - previous;
      previous = now;
      if (frames++) {
        worst = Math.max(worst, delta);
        if (delta > 16.7) over16++;
        if (delta > 33) over33++;
        if (delta > 50) over50++;
      }
      if (now - start >= 10000) {
        raf.current = undefined;
        setSample({ frames, fps: Math.round((frames * 1000) / (now - start)), over16, over33, over50, worst: Math.round(worst * 10) / 10 });
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };

  if (!open) return <button type="button" onClick={() => setOpen(true)} className="fixed bottom-3 right-3 z-[80] rounded-md border border-amber-400/40 bg-black/85 px-3 py-2 text-xs font-bold text-amber-200">Perf</button>;

  return <section data-performance-isolation role="dialog" aria-label="Performance isolation" className="fixed bottom-3 right-3 z-[80] max-h-[80dvh] w-[min(360px,calc(100vw-1.5rem))] overflow-y-auto rounded-lg border border-amber-400/40 bg-[#07110d]/95 p-3 text-xs text-emerald-50 shadow-xl">
    <div className="flex items-center justify-between gap-2"><strong>Performance isolation (DEV)</strong><button type="button" onClick={() => setOpen(false)}>Close</button></div>
    <p className="mt-2 text-emerald-100/70">Preset: {activePreset} · Module: {module} · Settings: {settingsOpen ? 'open' : 'closed'} · Tutorials: {value.tutorials ? 'active' : 'off'} · Lanyard: {lanyardMounted ? 'mounted' : 'off'}</p>
    <div className="mt-3 space-y-2">{labels.map(([key, label]) => <label key={key} className="flex items-center justify-between gap-3"><span>{label}</span><input type="checkbox" checked={value[key]} onChange={(event) => onChange({ ...value, [key]: event.target.checked })} /></label>)}</div>
    <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={refresh}>Refresh metrics</button><button type="button" onClick={resetRenders}>Reset counters</button><button type="button" onClick={record}>Record 10 seconds</button></div>
    <div data-interaction-benchmark className="mt-3 rounded border border-amber-400/20 p-2">
      <strong>Interaction benchmark (DEV)</strong>
      <p className="mt-1 text-emerald-100/70">Choose a scenario, arm it, wait for the selected idle window, then perform the real action once. The next instrumented action records handler, two-frame paint, DOM mutation, Chromium long-task/event timing when available, render, resource, frame, and heap deltas.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <select value={scenario} onChange={(event) => setScenario(event.target.value as typeof scenario)} aria-label="Interaction scenario">
          {interactionScenarios.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select value={idleSeconds} onChange={(event) => setIdleSeconds(Number(event.target.value))} aria-label="Idle window">
          {[0, 2, 5, 10, 30].map((seconds) => <option key={seconds} value={seconds}>{seconds}s idle</option>)}
        </select>
        <button type="button" onClick={() => { armDevInteractionBenchmark(scenario, idleSeconds * 1000); refresh(); }}>Arm next action</button>
      </div>
      {timings.benchmark && <p className="mt-2 text-amber-200">Armed: {timings.benchmark.scenario}; wait {Math.round(timings.benchmark.idleTargetMs / 1000)}s before the next action.</p>}
    </div>
    {metrics && <p className="mt-2 text-emerald-100/70">DOM {metrics.dom} · Canvas {metrics.canvases} · {metrics.viewport} · {metrics.visibility}</p>}
    <div className="mt-3 rounded border border-amber-400/20 p-2"><strong>React renders</strong>{Object.entries(renders).map(([name, entry]) => <p key={name} className="mt-1 text-emerald-100/70"><span className="font-bold text-emerald-50">{name}: {entry.renders}</span>{entry.lastChanged.length ? ` · ${entry.lastChanged.join(', ')}` : ''}</p>)}</div>
    <div data-performance-timeline className="mt-3 rounded border border-amber-400/20 p-2"><strong>Startup / interactions</strong><p className="mt-1 text-emerald-100/70">Lanyard tier: {timings.runtime.lanyardFrameTier}</p>{timings.records.map((entry, index) => <p key={`${entry.name}-${entry.startTime}-${index}`} className="mt-1 break-words text-emerald-100/70">+{Math.round(entry.startTime * 10) / 10}ms · {entry.name}: {Math.round(entry.duration * 10) / 10}ms{entry.detail ? ` · ${JSON.stringify(entry.detail)}` : ''}</p>)}</div>
    {sample && <p className="mt-2 text-emerald-100/70">{sample.frames} frames · ~{sample.fps} FPS · &gt;16.7ms {sample.over16} · &gt;33ms {sample.over33} · &gt;50ms {sample.over50} · worst {sample.worst}ms</p>}
    <ol className="mt-3 list-decimal space-y-1 pl-4 text-emerald-100/70">{matrix.map((item) => <li key={item}>{item}: record 10s while scrolling.</li>)}</ol>
  </section>;
}
