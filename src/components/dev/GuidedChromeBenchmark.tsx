import { useEffect, useMemo, useRef, useState } from 'react';
import {
  beginDevGuidedBenchmarkCapture,
  cancelDevGuidedBenchmarkCapture,
  finishDevGuidedBenchmarkCapture,
  type GuidedBenchmarkCapture,
} from '../../lib/dev-performance';
import { defaultPerformanceIsolation, type PerformanceIsolation } from '../../lib/performance-isolation';
import './guided-chrome-benchmark.css';

type Props = {
  initialIsolation: PerformanceIsolation;
  onApplyIsolation: (value: PerformanceIsolation) => void;
  onClose: () => void;
};

type FlickerFlags = { button: boolean; background: boolean; other: boolean; none: boolean };
type ManualReadings = { rendererPeak: string; gpuPeak: string; rendererIdle: string; gpuIdle: string; note: string; flicker: FlickerFlags };
type BenchmarkResult = { mode: Mode; capture: GuidedBenchmarkCapture; manual: ManualReadings };
type Phase = 'ready' | 'countdown' | 'interacting' | 'settling' | 'recording' | 'complete';
type Scenario = 'workspace' | 'buttons';

type Mode = {
  id: string;
  label: string;
  disabled: string[];
  isolation: PerformanceIsolation;
};

const modes: Mode[] = [
  { id: 'normal', label: 'NORMAL', disabled: ['Nothing — production-equivalent visuals'], isolation: defaultPerformanceIsolation },
  { id: 'topography-only', label: 'TOPOGRAPHY ONLY', disabled: ['Atmosphere'], isolation: { ...defaultPerformanceIsolation, atmosphere: false, decorativeGradients: false } },
  { id: 'no-mask', label: 'NO MASK', disabled: ['Topography mask only'], isolation: { ...defaultPerformanceIsolation, topographyMask: false } },
  { id: 'radial-glows', label: 'RADIAL GLOWS', disabled: ['CSS blur replaced by radial approximation'], isolation: { ...defaultPerformanceIsolation, filteredGlows: false } },
  { id: 'flat-background', label: 'FLAT BACKGROUND', disabled: ['Atmosphere', 'Topography'], isolation: { ...defaultPerformanceIsolation, atmosphere: false, topography: false, decorativeGradients: false } },
  { id: 'no-atmosphere', label: 'NO ATMOSPHERE', disabled: ['Large blur-3xl glows', 'Decorative atmospheric filter layers'], isolation: { ...defaultPerformanceIsolation, atmosphericGlows: false, cssFilters: false } },
  { id: 'no-topography', label: 'NO TOPOGRAPHY', disabled: ['Full viewport topographic mask layer'], isolation: { ...defaultPerformanceIsolation, topography: false } },
  { id: 'no-backdrop-filters', label: 'NO BACKDROP FILTERS', disabled: ['Backdrop-filter surfaces (opaque theme fallbacks remain)'], isolation: { ...defaultPerformanceIsolation, backdropFilters: false } },
  { id: 'opaque-shell', label: 'OPAQUE SHELL', disabled: ['Translucent launcher and navigation surfaces'], isolation: { ...defaultPerformanceIsolation, translucentNavigationSurfaces: false } },
  { id: 'no-transforms', label: 'NO TRANSFORMS', disabled: ['Hover transforms', 'Pressed transforms'], isolation: { ...defaultPerformanceIsolation, hoverTransforms: false, pressedTransforms: false } },
  { id: 'no-lanyard', label: 'NO LANYARD', disabled: ['Lanyard rendering only'], isolation: { ...defaultPerformanceIsolation, lanyard: false } },
  { id: 'minimal-compositor', label: 'MINIMAL COMPOSITOR', disabled: ['Atmosphere and glows', 'Topography/mask', 'Backdrop filters', 'Large decorative shadows', 'Hover/pressed transforms', 'Translucent shell', 'Decorative gradients', 'Lanyard'], isolation: { ...defaultPerformanceIsolation, lanyard: false, topography: false, atmosphere: false, atmosphericGlows: false, cssFilters: false, backdropFilters: false, largeShadows: false, hoverTransforms: false, pressedTransforms: false, translucentNavigationSurfaces: false, decorativeGradients: false } },
];

const blankManual = (): ManualReadings => ({
  rendererPeak: '', gpuPeak: '', rendererIdle: '', gpuIdle: '', note: '',
  flicker: { button: false, background: false, other: false, none: false },
});

function numberValue(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function percentDelta(value: string, baseline: string) {
  const next = numberValue(value);
  const initial = numberValue(baseline);
  if (next === null || initial === null || initial === 0) return '—';
  const delta = ((next - initial) / initial) * 100;
  return `${delta >= 0 ? '+' : ''}${Math.round(delta)}%`;
}

function flickerLabel(flicker: FlickerFlags) {
  const labels = [flicker.button && 'button flash', flicker.background && 'background shimmer', flicker.other && 'other'].filter(Boolean);
  return flicker.none ? 'None' : labels.join(', ') || 'Not recorded';
}

function metric(value: number | null | undefined, suffix = '') {
  return typeof value === 'number' ? `${Math.round(value * 10) / 10}${suffix}` : '—';
}

function buildReport(results: BenchmarkResult[], scenario: Scenario) {
  const browser = typeof navigator === 'undefined' ? 'Unknown browser' : navigator.userAgent;
  const baseline = results.find((result) => result.mode.id === 'normal');
  const rows = results.map(({ mode, capture, manual }) => [
    mode.label,
    manual.rendererPeak ? `${manual.rendererPeak}% (${percentDelta(manual.rendererPeak, baseline?.manual.rendererPeak ?? '')})` : '—',
    manual.gpuPeak ? `${manual.gpuPeak}% (${percentDelta(manual.gpuPeak, baseline?.manual.gpuPeak ?? '')})` : '—',
    `${metric(capture.twoFramePaintMs, 'ms')}; ${metric(capture.handlerDurationMs, 'ms')} handlers`,
    `${capture.longTaskCount} / ${metric(capture.longTaskDuration, 'ms')}`,
    `${capture.frameCount}; worst ${metric(capture.worstFrameDuration, 'ms')}`,
    `${capture.domMutationCount}`,
    flickerLabel(manual.flicker),
  ]);
  return [
    '# Stanza guided Chrome benchmark',
    `Timestamp: ${new Date().toISOString()}`,
    `Browser: ${browser}`,
    `Scenario: ${scenario === 'workspace' ? 'Launcher → five workspace entries → Profile → close Launcher' : 'Navigation button hover and press'}`,
    '',
    '| Mode | Renderer Peak | GPU Peak | Paint / handlers | Long Tasks | Frames | Mutations | Flicker |',
    '|---|---:|---:|---|---|---|---:|---|',
    ...rows.map((row) => `| ${row.join(' | ')} |`),
    '',
    'Renderer and GPU CPU figures are manually observed Chrome Task Manager peaks; app-side values are diagnostic, not a scientific profiler.',
    '',
    ...results.map(({ mode, capture, manual }) => `${mode.label}: idle renderer ${manual.rendererIdle || '—'}%, idle GPU ${manual.gpuIdle || '—'}%, events ${capture.eventCount}/${metric(capture.eventDuration, 'ms')}, render delta ${capture.renderDelta}, resource delta ${capture.resourceDelta}, DOM ${capture.domNodesBefore}→${capture.domNodesAfter}, canvas ${capture.canvasCountBefore}→${capture.canvasCountAfter}, heap Δ ${metric(capture.heapDeltaBytes, ' bytes')}, animations ${capture.runningAnimations}, lanyard ${capture.lanyardFrameTier}${manual.note ? `; note: ${manual.note}` : ''}`),
  ].join('\n');
}

function interpretation(results: BenchmarkResult[]) {
  const baseline = results.find((result) => result.mode.id === 'normal');
  if (!baseline) return 'Complete NORMAL first; comparisons use its manually entered peak CPU values.';
  const rendererBaseline = numberValue(baseline.manual.rendererPeak);
  const gpuBaseline = numberValue(baseline.manual.gpuPeak);
  const observations = results.slice(1).flatMap((result) => {
    const renderer = numberValue(result.manual.rendererPeak);
    const gpu = numberValue(result.manual.gpuPeak);
    const rendererDelta = renderer !== null && rendererBaseline ? ((renderer - rendererBaseline) / rendererBaseline) * 100 : null;
    const gpuDelta = gpu !== null && gpuBaseline ? ((gpu - gpuBaseline) / gpuBaseline) * 100 : null;
    const flickerGone = baseline.manual.flicker.none === false && result.manual.flicker.none;
    const messages: string[] = [];
    if (rendererDelta !== null && gpuDelta !== null && rendererDelta <= -15 && gpuDelta <= -15) messages.push(`${result.mode.label}: a strong renderer and GPU candidate.`);
    else if (gpuDelta !== null && gpuDelta <= -15 && (rendererDelta === null || rendererDelta > -10)) messages.push(`${result.mode.label}: likely GPU/compositor contribution.`);
    else if (rendererDelta !== null && rendererDelta <= -15 && (gpuDelta === null || gpuDelta > -10)) messages.push(`${result.mode.label}: likely renderer/style/layout/paint contribution.`);
    if (flickerGone) messages.push(`${result.mode.label}: removed reported flicker; investigate this shared rendering path first.`);
    return messages;
  });
  return observations.length ? observations.join(' ') : 'No material conclusion yet. Enter Task Manager peaks for NORMAL and the isolated modes; do not change production styling from this diagnostic alone.';
}

export default function GuidedChromeBenchmark({ initialIsolation, onApplyIsolation, onClose }: Props) {
  const [scenario, setScenario] = useState<Scenario>('workspace');
  const [modeIndex, setModeIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('ready');
  const [countdown, setCountdown] = useState(10);
  const [capture, setCapture] = useState<GuidedBenchmarkCapture | null>(null);
  const [manual, setManual] = useState<ManualReadings>(blankManual);
  const [results, setResults] = useState<BenchmarkResult[]>([]);
  const baselineRef = useRef(initialIsolation);
  const activeMode = modes[modeIndex]!;

  useEffect(() => {
    onApplyIsolation(defaultPerformanceIsolation);
    const firstFrame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => onApplyIsolation(activeMode.isolation));
    });
    return () => window.cancelAnimationFrame(firstFrame);
  }, [activeMode, onApplyIsolation]);

  useEffect(() => () => onApplyIsolation(baselineRef.current), [onApplyIsolation]);
  useEffect(() => () => cancelDevGuidedBenchmarkCapture(), []);

  useEffect(() => {
    if (phase !== 'countdown') return;
    const timer = window.setTimeout(() => {
      if (countdown <= 1) {
        beginDevGuidedBenchmarkCapture(`${scenario}:${activeMode.id}`);
        setPhase('interacting');
      } else {
        setCountdown((current) => current - 1);
      }
    }, 1_000);
    return () => window.clearTimeout(timer);
  }, [activeMode.id, countdown, phase, scenario]);

  const startCountdown = () => {
    setCountdown(10);
    setCapture(null);
    setManual(blankManual());
    setPhase('countdown');
  };
  const completeInteraction = async () => {
    setPhase('settling');
    const result = await finishDevGuidedBenchmarkCapture();
    setCapture(result);
    setPhase('recording');
  };
  const saveAndContinue = () => {
    if (!capture) return;
    setResults((current) => [...current, { mode: activeMode, capture, manual }]);
    if (modeIndex === modes.length - 1) {
      setPhase('complete');
      return;
    }
    setModeIndex((current) => current + 1);
    setPhase('ready');
  };
  const restartButtonScenario = () => {
    setScenario('buttons');
    setModeIndex(0);
    setResults([]);
    setCapture(null);
    setManual(blankManual());
    setPhase('ready');
  };
  const report = useMemo(() => buildReport(results, scenario), [results, scenario]);
  const copyReport = async () => {
    await navigator.clipboard?.writeText(report);
  };
  const close = () => {
    onApplyIsolation(baselineRef.current);
    onClose();
  };

  const instructions = scenario === 'workspace'
    ? ['Open Launcher', 'Hover across the same 5 workspace entries', 'Switch to Profile (already-loaded lightweight module)', 'Close Launcher']
    : ['Hover the same navigation controls repeatedly', 'Pointer down/up several times on affected controls', 'Leave the current module unchanged'];

  return <section data-guided-chrome-benchmark role="dialog" aria-modal="true" aria-label="Guided Chrome benchmark" className="stanza-guided-benchmark fixed inset-0 z-[100] overflow-y-auto bg-[#020604]/98 p-4 text-emerald-50 md:p-8">
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-emerald-400/25 pb-4">
        <div><p className="text-xs font-black uppercase tracking-[.2em] text-amber-200">Development only · manual Chrome CPU entry</p><h1 className="mt-1 text-2xl font-black">Guided Chrome A/B benchmark</h1><p className="mt-2 max-w-3xl text-sm text-emerald-100/70">This page coordinates one bounded application-side capture per configuration. Keep Chrome Task Manager visible; the page cannot read its process CPU values.</p></div>
        <button type="button" onClick={close} className="rounded border border-emerald-400/40 px-3 py-2 text-xs font-bold">Exit and restore dev state</button>
      </div>

      {phase !== 'complete' && <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_.8fr]">
        <article className="rounded-xl border border-emerald-400/25 bg-emerald-950/25 p-5">
          <p className="text-xs font-black uppercase tracking-widest text-amber-200">{scenario === 'workspace' ? 'Main workspace scenario' : 'Button-only scenario'}</p>
          <p className="mt-2 text-sm text-emerald-100/70">Test {modeIndex + 1} of {modes.length}</p>
          <h2 className="mt-1 text-3xl font-black text-emerald-200">{activeMode.label}</h2>
          <p className="mt-3 text-xs font-bold uppercase tracking-widest text-emerald-100/55">Disabled for this test</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-emerald-100/80">{activeMode.disabled.map((item) => <li key={item}>{item}</li>)}</ul>
          {phase === 'ready' && <><p className="mt-6 rounded-lg border border-amber-300/25 bg-amber-200/5 p-3 text-sm text-amber-100">Leave Chrome Task Manager visible. The clean baseline was restored before applying only this configuration; styles have had two frames to settle.</p><button type="button" onClick={startCountdown} className="mt-4 rounded-lg bg-emerald-400 px-4 py-3 text-sm font-black text-[#04110d]">Start 10-second idle countdown</button></>}
          {phase === 'countdown' && <div className="mt-6 rounded-xl border border-emerald-300/30 bg-black/25 p-5 text-center"><p className="text-sm font-bold">Idle. Do not interact yet.</p><p aria-live="assertive" className="mt-2 text-7xl font-black text-emerald-300">{countdown}</p></div>}
          {phase === 'interacting' && <div className="mt-6 rounded-xl border border-emerald-300/35 bg-emerald-400/10 p-5"><p className="font-black text-emerald-200">Capture is active — perform this exact interaction once:</p><ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-emerald-50">{instructions.map((item) => <li key={item}>{item}</li>)}</ol><button type="button" onClick={() => void completeInteraction()} className="mt-5 rounded-lg bg-amber-300 px-4 py-3 text-sm font-black text-black">Interaction complete</button></div>}
          {phase === 'settling' && <p aria-live="polite" className="mt-6 rounded-lg border border-emerald-300/25 p-4 text-sm text-emerald-100">Collecting two-frame paint and the 2-second settle window. Observers stop automatically.</p>}
          {phase === 'recording' && capture && <div className="mt-6 rounded-xl border border-emerald-300/25 p-4"><h3 className="font-black">Application-side capture</h3><p className="mt-2 text-sm text-emerald-100/75">Paint {metric(capture.twoFramePaintMs, 'ms')} · handler {metric(capture.handlerDurationMs, 'ms')} ({capture.handlerCount}) · long tasks {capture.longTaskCount} / {metric(capture.longTaskDuration, 'ms')} · frames {capture.frameCount}, worst {metric(capture.worstFrameDuration, 'ms')} · mutations {capture.domMutationCount} · render Δ {capture.renderDelta} · DOM {capture.domNodesBefore}→{capture.domNodesAfter} · canvas {capture.canvasCountBefore}→{capture.canvasCountAfter} · resources Δ {capture.resourceDelta} · heap Δ {metric(capture.heapDeltaBytes, ' bytes')} · animations {capture.runningAnimations} · lanyard {capture.lanyardFrameTier} · duration {metric(capture.durationMs, 'ms')}</p></div>}
        </article>

        <aside className="rounded-xl border border-emerald-400/25 bg-black/25 p-5">
          <h2 className="font-black">Chrome Task Manager readings</h2><p className="mt-1 text-xs text-emerald-100/65">Only these CPU values require manual entry.</p>
          {phase === 'recording' && <div className="mt-4 space-y-3"><label className="block text-xs">Stanza renderer peak CPU <input inputMode="decimal" value={manual.rendererPeak} onChange={(event) => setManual({ ...manual, rendererPeak: event.target.value })} className="mt-1 block w-full rounded border border-emerald-400/30 bg-black/30 px-3 py-2" placeholder="e.g. 24" />%</label><label className="block text-xs">GPU Process peak CPU <input inputMode="decimal" value={manual.gpuPeak} onChange={(event) => setManual({ ...manual, gpuPeak: event.target.value })} className="mt-1 block w-full rounded border border-emerald-400/30 bg-black/30 px-3 py-2" placeholder="e.g. 18" />%</label><div className="grid grid-cols-2 gap-2"><label className="text-xs">Renderer idle <input inputMode="decimal" value={manual.rendererIdle} onChange={(event) => setManual({ ...manual, rendererIdle: event.target.value })} className="mt-1 block w-full rounded border border-emerald-400/30 bg-black/30 px-3 py-2" />%</label><label className="text-xs">GPU idle <input inputMode="decimal" value={manual.gpuIdle} onChange={(event) => setManual({ ...manual, gpuIdle: event.target.value })} className="mt-1 block w-full rounded border border-emerald-400/30 bg-black/30 px-3 py-2" />%</label></div><fieldset><legend className="text-xs font-bold">Did you see flicker?</legend>{([['button', 'Button black flash'], ['background', 'Dashboard/background shimmer'], ['other', 'Other'], ['none', 'None']] as const).map(([key, label]) => <label key={key} className="mt-2 flex gap-2 text-xs"><input type="checkbox" checked={manual.flicker[key]} onChange={(event) => setManual({ ...manual, flicker: { ...manual.flicker, [key]: event.target.checked, ...(key === 'none' && event.target.checked ? { button: false, background: false, other: false } : {}) } })} />{label}</label>)}</fieldset><label className="block text-xs">Optional note<textarea value={manual.note} onChange={(event) => setManual({ ...manual, note: event.target.value })} className="mt-1 block min-h-20 w-full rounded border border-emerald-400/30 bg-black/30 px-3 py-2" /></label><button type="button" onClick={saveAndContinue} className="w-full rounded-lg bg-emerald-400 px-4 py-3 text-sm font-black text-[#04110d]">{modeIndex === modes.length - 1 ? 'Finish matrix' : 'Save and prepare next test'}</button></div>}
          {phase !== 'recording' && <p className="mt-5 text-sm text-emerald-100/55">Manual inputs unlock after the bounded application capture settles.</p>}
        </aside>
      </div>}

      {(results.length > 0 || phase === 'complete') && <section className="mt-6 rounded-xl border border-emerald-400/25 bg-black/25 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-black">Results</h2><p className="mt-1 text-xs text-emerald-100/65">Task Manager values are manually observed peaks; percentage deltas use NORMAL.</p></div><button type="button" onClick={() => void copyReport()} className="rounded border border-emerald-400/40 px-3 py-2 text-xs font-bold">Copy benchmark report</button></div><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead className="text-emerald-200"><tr><th>Mode</th><th>Renderer peak</th><th>GPU peak</th><th>Paint</th><th>Long tasks</th><th>Frames</th><th>Mutations</th><th>Flicker</th></tr></thead><tbody>{results.map((result) => <tr key={`${scenario}-${result.mode.id}`} className="border-t border-emerald-400/15"><td className="py-2 font-bold">{result.mode.label}</td><td>{result.manual.rendererPeak ? `${result.manual.rendererPeak}% (${percentDelta(result.manual.rendererPeak, results.find((item) => item.mode.id === 'normal')?.manual.rendererPeak ?? '')})` : '—'}</td><td>{result.manual.gpuPeak ? `${result.manual.gpuPeak}% (${percentDelta(result.manual.gpuPeak, results.find((item) => item.mode.id === 'normal')?.manual.gpuPeak ?? '')})` : '—'}</td><td>{metric(result.capture.twoFramePaintMs, 'ms')}</td><td>{result.capture.longTaskCount} / {metric(result.capture.longTaskDuration, 'ms')}</td><td>{result.capture.frameCount}</td><td>{result.capture.domMutationCount}</td><td>{flickerLabel(result.manual.flicker)}</td></tr>)}</tbody></table></div><p className="mt-4 rounded-lg border border-amber-300/20 bg-amber-200/5 p-3 text-sm text-amber-100">Diagnostic interpretation: {interpretation(results)}</p>{phase === 'complete' && <div className="mt-4 flex flex-wrap gap-3"><button type="button" onClick={restartButtonScenario} className="rounded-lg bg-emerald-400 px-4 py-3 text-sm font-black text-[#04110d]">Run button-only benchmark</button><button type="button" onClick={close} className="rounded-lg border border-emerald-400/40 px-4 py-3 text-sm font-bold">Exit and restore dev state</button></div>}</section>}
    </div>
  </section>;
}
