import { useEffect, useRef, useState } from 'react';
import './performance-isolation.css';
import { defaultPerformanceIsolation, type PerformanceIsolation } from '../../lib/performance-isolation';
import LanyardComparison from './LanyardComparison';
import GuidedChromeBenchmark from './GuidedChromeBenchmark';
import { armDevInteractionBenchmark, beginDevGuidedBenchmarkCapture, finishDevGuidedBenchmarkCapture, getDevPerformanceDiagnostics, observeDevControlFrames, type GuidedBenchmarkCapture } from '../../lib/dev-performance';
import {
  getDevRenderDiagnostics,
  resetDevRenderDiagnostics,
  type RenderDiagnosticsSnapshot,
} from '../../lib/render-diagnostics';

type Props = {
  value: PerformanceIsolation;
  onChange: (value: PerformanceIsolation) => void;
  onTransientChange: (value: PerformanceIsolation) => void;
  activePreset: string;
  module: string;
  settingsOpen: boolean;
  lanyardMounted: boolean;
};
type SurfaceKind = 'transform' | 'filter' | 'backdrop' | 'opacity' | 'blend' | 'willChange' | 'isolation' | 'perspective' | 'mask' | 'clipPath' | 'fixed' | 'sticky' | 'shadow' | 'blur' | 'canvas';
type SurfaceEntry = { label: string; area: number; kinds: SurfaceKind[] };
type Metrics = { dom: number; canvases: number; viewport: string; visibility: string; surfaces: Record<SurfaceKind, number>; largestSurfaces: SurfaceEntry[] };
type Sample = { frames: number; fps: number; over16: number; over33: number; over50: number; worst: number };

const labels: Array<[keyof PerformanceIsolation, string]> = [
  ['topographyMask', 'Topography mask'],
  ['filteredGlows', 'Filtered glows (off = radial approximation)'],
  ['lanyard', 'Lanyard Canvas / physics'],
  ['atmosphericGlows', 'Atmospheric background glows'],
  ['cssFilters', 'CSS filter effects'],
  ['backdropFilters', 'Backdrop-filter effects'],
  ['largeShadows', 'Large decorative shadows'],
  ['hoverTransforms', 'Hover transforms'],
  ['pressedTransforms', 'Pressed transforms'],
  ['translucentNavigationSurfaces', 'Translucent launcher / navigation surfaces'],
  ['tutorialEffects', 'Tutorial spotlight / dimming effects'],
  ['decorativeGradients', 'Nonessential decorative gradients'],
  ['topography', 'Topographic contour layer'], ['atmosphere', 'Ambient glow / gradient atmosphere'], ['shadows', 'Legacy dashboard shadow gate'], ['translucentSurfaces', 'Legacy translucent surface gate'], ['settingsBackdrop', 'Settings overlay / dimming'], ['tutorials', 'Tutorial provider / overlay'], ['attentionPolling', 'Attention-count polling'], ['recentFrequent', 'Recent / Frequent launcher'], ['badges', 'Notification / count badges'], ['mobileNavigation', 'Mobile fixed bottom navigation'], ['geoSecondaryPanels', 'Geo Operations secondary panels'], ['transitions', 'Theme transitions / micro-interactions'], ['visualAtmosphere', 'All non-essential visual atmosphere'],
];
const presets: Array<[string, PerformanceIsolation]> = [
  ['NORMAL', defaultPerformanceIsolation],
  ['TOPOGRAPHY ONLY', { ...defaultPerformanceIsolation, atmosphere: false, decorativeGradients: false }],
  ['NO MASK', { ...defaultPerformanceIsolation, topographyMask: false }],
  ['RADIAL GLOWS', { ...defaultPerformanceIsolation, filteredGlows: false }],
  ['FLAT BACKGROUND', { ...defaultPerformanceIsolation, atmosphere: false, topography: false, decorativeGradients: false }],
  ['MINIMAL COMPOSITOR', { ...defaultPerformanceIsolation, lanyard: false, atmosphericGlows: false, cssFilters: false, backdropFilters: false, largeShadows: false, hoverTransforms: false, pressedTransforms: false, translucentNavigationSurfaces: false }],
  ['NO LANYARD', { ...defaultPerformanceIsolation, lanyard: false }],
  ['NO ATMOSPHERE', { ...defaultPerformanceIsolation, atmosphericGlows: false, cssFilters: false }],
  ['NO TRANSFORMS', { ...defaultPerformanceIsolation, hoverTransforms: false, pressedTransforms: false }],
  ['OPAQUE SHELL', { ...defaultPerformanceIsolation, backdropFilters: false, translucentNavigationSurfaces: false }],
];
const interactionScenarios = [
  ['launcher-open', 'A. Open Launcher'], ['launcher-close', 'B. Close Launcher'],
  ['settings-open', 'C. Open Settings'], ['settings-close', 'D. Close Settings'],
  ['module-switch', 'E. Switch module'], ['launcher-scroll', 'F. Scroll Launcher'],
  ['workspace-scroll', 'G. Scroll workspace'], ['control-hover', 'H. Hover controls'],
  ['tutorial-next', 'I. Tutorial Next'], ['theme-change', 'J. Change theme'],
  ['lanyard-interact', 'K. Interact lanyard'], ['lanyard-disabled-interact', 'L. Interact with lanyard disabled'],
  ['attendance-clock', 'M. Clock In'], ['break-request', 'N. Request Break'], ['login-demo-accounts', 'O. Login demo accounts'],
] as const;

const surfaceKinds: SurfaceKind[] = ['transform', 'filter', 'backdrop', 'opacity', 'blend', 'willChange', 'isolation', 'perspective', 'mask', 'clipPath', 'fixed', 'sticky', 'shadow', 'blur', 'canvas'];

function elementLabel(element: Element) {
  const htmlElement = element as HTMLElement;
  const classes = typeof htmlElement.className === 'string' ? htmlElement.className.split(/\s+/).filter(Boolean).slice(0, 3).join('.') : '';
  return `${element.tagName.toLowerCase()}${htmlElement.id ? `#${htmlElement.id}` : ''}${classes ? `.${classes}` : ''}`;
}

function collectSurfaceAudit(): Pick<Metrics, 'surfaces' | 'largestSurfaces'> {
  const surfaces = Object.fromEntries(surfaceKinds.map((kind) => [kind, 0])) as Record<SurfaceKind, number>;
  const largestSurfaces: SurfaceEntry[] = [];
  const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);

  for (const element of document.querySelectorAll('*')) {
    if (element.closest('[data-performance-isolation]')) continue;
    const style = getComputedStyle(element);
    const htmlElement = element as HTMLElement;
    const kinds: SurfaceKind[] = [];
    if (style.transform !== 'none') kinds.push('transform');
    if (style.filter !== 'none') kinds.push('filter');
    const webkitBackdropFilter = style.getPropertyValue('-webkit-backdrop-filter');
    if (
      style.backdropFilter !== 'none' ||
      (webkitBackdropFilter.length > 0 && webkitBackdropFilter !== 'none')
    ) {
      kinds.push('backdrop');
    }
    if (Number(style.opacity) < 1) kinds.push('opacity');
    if (style.mixBlendMode !== 'normal') kinds.push('blend');
    if (style.willChange !== 'auto') kinds.push('willChange');
    if (style.isolation === 'isolate') kinds.push('isolation');
    if (style.perspective !== 'none') kinds.push('perspective');
    if (style.maskImage !== 'none' || style.webkitMaskImage !== 'none') kinds.push('mask');
    if (style.clipPath !== 'none') kinds.push('clipPath');
    if (style.position === 'fixed') kinds.push('fixed');
    if (style.position === 'sticky') kinds.push('sticky');
    if (style.boxShadow !== 'none') kinds.push('shadow');
    if (htmlElement.classList.contains('blur-3xl') || style.filter.includes('blur(')) kinds.push('blur');
    if (element instanceof HTMLCanvasElement) kinds.push('canvas');
    if (!kinds.length) continue;

    const rect = htmlElement.getBoundingClientRect();
    const visibleArea = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0)) * Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
    if (!visibleArea || style.visibility === 'hidden' || style.display === 'none') continue;
    kinds.forEach((kind) => { surfaces[kind] += 1; });
    if (visibleArea / viewportArea >= 0.08) largestSurfaces.push({ label: elementLabel(element), area: Math.round((visibleArea / viewportArea) * 100), kinds });
  }

  return { surfaces, largestSurfaces: largestSurfaces.sort((left, right) => right.area - left.area).slice(0, 16) };
}

export default function PerformanceIsolationPanel({ value, onChange, onTransientChange, activePreset, module, settingsOpen, lanyardMounted }: Props) {
  const [open, setOpen] = useState(false);
  const [guidedBenchmarkOpen, setGuidedBenchmarkOpen] = useState(false);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [sample, setSample] = useState<Sample | null>(null);
  const [renders, setRenders] = useState<RenderDiagnosticsSnapshot>(() => getDevRenderDiagnostics());
  const [timings, setTimings] = useState(() => getDevPerformanceDiagnostics());
  const [scenario, setScenario] = useState<(typeof interactionScenarios)[number][0]>('launcher-open');
  const [idleSeconds, setIdleSeconds] = useState(10);
  const raf = useRef<number | undefined>(undefined);
  const [geoSurface, setGeoSurface] = useState('current');
  const [geoControl, setGeoControl] = useState('current');
  const [captureGeoStyles, setCaptureGeoStyles] = useState(false);
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.geo-operations-content');
    if (open && module === 'geofence' && captureGeoStyles && root) return observeDevControlFrames(root);
  }, [open, module, captureGeoStyles]);
  const [captureResult, setCaptureResult] = useState<GuidedBenchmarkCapture | null>(null);
  useEffect(() => {
    if (module === 'geofence') {
      document.documentElement.dataset.stanzaGeoSurface = geoSurface;
      document.documentElement.dataset.stanzaGeoControl = geoControl;
    }
    return () => {
      delete document.documentElement.dataset.stanzaGeoSurface;
      delete document.documentElement.dataset.stanzaGeoControl;
    };
  }, [module, geoSurface, geoControl]);

  const refresh = () => {
    const surfaceAudit = collectSurfaceAudit();
    setMetrics({
      dom: document.querySelectorAll('*').length,
      canvases: document.querySelectorAll('canvas').length,
      viewport: `${window.innerWidth} x ${window.innerHeight}`,
      visibility: document.visibilityState,
      ...surfaceAudit,
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

  if (guidedBenchmarkOpen) return <GuidedChromeBenchmark initialIsolation={value} onApplyIsolation={onTransientChange} onClose={() => setGuidedBenchmarkOpen(false)} />;
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="fixed bottom-3 right-3 z-[80] rounded-md border border-amber-400/40 bg-black/85 px-3 py-2 text-xs font-bold text-amber-200">Perf</button>;

  return <section data-performance-isolation role="dialog" aria-label="Performance isolation" className="fixed bottom-3 right-3 z-[80] max-h-[80dvh] w-[min(360px,calc(100vw-1.5rem))] overflow-y-auto rounded-lg border border-amber-400/40 bg-[#07110d]/95 p-3 text-xs text-emerald-50 shadow-xl">
    <div className="flex items-center justify-between gap-2"><strong>Performance isolation (DEV)</strong><button type="button" onClick={() => setOpen(false)}>Close</button></div>
    <p className="mt-2 text-emerald-100/70">Preset: {activePreset} · Module: {module} · Settings: {settingsOpen ? 'open' : 'closed'} · Tutorials: {value.tutorials ? 'active' : 'off'} · Lanyard: {lanyardMounted ? 'mounted' : 'off'}</p>
    <p className="mt-1 text-amber-200">DEV ONLY. These switches alter presentation CSS only; they do not change saved preferences or business state.</p>
    <div className="mt-3 flex flex-wrap gap-2" aria-label="Visual isolation presets">{presets.map(([label, preset]) => <button key={label} type="button" onClick={() => onChange(preset)}>{label}</button>)}</div>
    <LanyardComparison module={module} enabled={value.lanyard} setEnabled={enabled => onTransientChange({ ...value, lanyard: enabled })} />
    <div className="mt-3"><button type="button" onClick={() => beginDevGuidedBenchmarkCapture(`lanyard:${module}:${geoSurface}`)}>Start lanyard capture</button><button type="button" onClick={async () => { setCaptureResult(await finishDevGuidedBenchmarkCapture()); refresh(); }}>Finish lanyard capture</button><p>Drag at Dashboard size, then release and wait for sleep. Capture separately for idle, initial wake, drag, and settling. Render duration is CPU submission, not GPU time.</p><pre data-lanyard-runtime className="max-h-48 overflow-auto">{JSON.stringify(timings.runtime, null, 2)}</pre><details><summary>Lanyard frame / physics samples</summary><pre className="max-h-48 overflow-auto">{JSON.stringify(timings.lanyardSamples, null, 2)}</pre></details></div>
    <div className="mt-3 space-y-2">
      <label>Geo surface experiment<select aria-label="Geo surface experiment" value={geoSurface} onChange={event => setGeoSurface(event.target.value)}>{['current', 'opaque', 'no-shadows', 'no-filters', 'no-topography', 'flat'].map(mode => <option key={mode}>{mode}</option>)}</select></label>
      <label>Real Geo button experiment<select aria-label="Real Geo button experiment" value={geoControl} onChange={event => setGeoControl(event.target.value)}>{['current', 'no-transform', 'opaque-parent', 'no-backdrop', 'no-transition', 'color-only', 'opaque-button', 'gradient-gradient', 'solid-solid', 'no-background-transition', 'no-shadow', 'no-pseudo'].map(mode => <option key={mode}>{mode}</option>)}</select></label>
      <label><input type="checkbox" checked={captureGeoStyles} onChange={event => setCaptureGeoStyles(event.target.checked)} />Capture real Geo control styles</label>
      <details><summary>Real Geo control frame samples</summary><pre className="max-h-48 overflow-auto">{JSON.stringify(timings.controlFrames, null, 2)}</pre></details>
      <p>Geo-only, session-only experiments on Clock In and Request Break. No business action is simulated. Changing module removes these overrides.</p>
      <pre data-module-capture className="max-h-48 overflow-auto">{JSON.stringify({ module, geoSurface, geoControl, capture: captureResult, metrics }, null, 2)}</pre>
    </div>
    <div className="mt-3 space-y-2">{labels.map(([key, label]) => <label key={key} className="flex items-center justify-between gap-3"><span>{label}</span><input type="checkbox" checked={value[key]} onChange={(event) => onChange({ ...value, [key]: event.target.checked })} /></label>)}</div>
    <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={refresh}>Refresh metrics</button><button type="button" onClick={resetRenders}>Reset counters</button><button type="button" onClick={record}>Record 10 seconds</button><button type="button" onClick={() => setGuidedBenchmarkOpen(true)}>Run guided Chrome benchmark</button><button type="button" onClick={() => window.open('/?stanzaPerfLab=1', '_blank', 'noopener,noreferrer')}>Open interaction lab</button></div>
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
    {metrics && <><p className="mt-2 text-emerald-100/70">DOM {metrics.dom} · Canvas {metrics.canvases} · {metrics.viewport} · {metrics.visibility}</p><details className="mt-2 rounded border border-amber-400/20 p-2"><summary>Compositing / paint surface audit</summary><p className="mt-2 break-words text-emerald-100/70">{surfaceKinds.map((kind) => `${kind}: ${metrics.surfaces[kind]}`).join(' · ')}</p>{metrics.largestSurfaces.map((surface) => <p key={`${surface.label}-${surface.area}`} className="mt-1 break-words text-emerald-100/70">{surface.area}% viewport · {surface.label} · {surface.kinds.join(', ')}</p>)}</details></>}
    <div className="mt-3 rounded border border-amber-400/20 p-2"><strong>React renders</strong>{Object.entries(renders).map(([name, entry]) => <p key={name} className="mt-1 text-emerald-100/70"><span className="font-bold text-emerald-50">{name}: {entry.renders}</span>{entry.lastChanged.length ? ` · ${entry.lastChanged.join(', ')}` : ''}</p>)}</div>
    <div data-performance-timeline className="mt-3 rounded border border-amber-400/20 p-2"><strong>Startup / interactions</strong><p className="mt-1 text-emerald-100/70">Lanyard tier: {timings.runtime.lanyardFrameTier}</p>{timings.records.map((entry, index) => <p key={`${entry.name}-${entry.startTime}-${index}`} className="mt-1 break-words text-emerald-100/70">+{Math.round(entry.startTime * 10) / 10}ms · {entry.name}: {Math.round(entry.duration * 10) / 10}ms{entry.detail ? ` · ${JSON.stringify(entry.detail)}` : ''}</p>)}</div>
    {sample && <p className="mt-2 text-emerald-100/70">{sample.frames} frames · ~{sample.fps} FPS · &gt;16.7ms {sample.over16} · &gt;33ms {sample.over33} · &gt;50ms {sample.over50} · worst {sample.worst}ms</p>}
    <ol className="mt-3 list-decimal space-y-1 pl-4 text-emerald-100/70"><li>Idle 10 seconds, then open Launcher, hover several rows, and close it.</li><li>Repeat for Settings open/close, module switch, and Launcher scroll.</li><li>Record Chrome renderer and GPU-process CPU separately for each preset.</li></ol>
  </section>;
}
