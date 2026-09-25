import { useEffect, useRef, useState } from 'react';

import { beginDevGuidedBenchmarkCapture, cancelDevGuidedBenchmarkCapture, finishDevGuidedBenchmarkCapture, getDevLanyardQuality, getDevPerformanceDiagnostics, setDevLanyardQuality, type DevLanyardQuality } from '../../lib/dev-performance';

import { GPU_SURFACES, GPU_ISOLATIONS, getDevGpuExperiment, setDevGpuExperiment, resetDevGpuExperiment, readDevCanvasAudit, createDevPrecomposedSurface, type GpuExperiment } from '../../lib/dev-gpu-experiments';

import { summarizeLanyardCapture } from './lanyard-comparison';



const profiles = ['full', 'chromium-lightweight', 'very-light', 'disabled'] as const;

const names = ['FULL 60/24', 'LIGHT 45/20', 'VERY LIGHT 30/15', 'DISABLED'];

type Row = { browserCpu: string; tabCpu: string; gpuCpu: string; smoothness: string; flicker: string; trials: unknown[] };

function updateManualRow(row: Row, field: 'gpuCpu' | 'browserCpu' | 'tabCpu' | 'smoothness' | 'flicker', value: string): Row {
  return { ...row, [field]: value, trials: row.trials.map((trial, index) => {
    if (index !== row.trials.length - 1) return trial;
    const record = trial as Record<string, unknown>;
    return { ...record, manual: { ...(record.manual as Record<string, string> ?? {}), [field]: value } };
  }) };
}
const emptyRow = (): Row => ({ browserCpu: '', tabCpu: '', gpuCpu: '', smoothness: '', flicker: '', trials: [] });

const initialRows = () => Object.fromEntries([

  'geofence/full/current/current', 'geofence/full/alpha-opaque/current',

  'geofence/full/current/no-backdrop', 'geofence/chromium-lightweight/current/current',

  'geofence/disabled/current/current', 'sessionCenter/full/current/current',

  'sessionCenter/full/alpha-opaque/current',

].map(key => [key + '/aa=true/dpr=1/buttons=current/drag', emptyRow()]).concat(['disabled', 'full'].flatMap(profile => ['current', 'solid-solid'].map(button => [`geofence/${profile}/current/current/aa=true/dpr=1/buttons=${button}/${profile === 'disabled' ? 'buttons-settled' : 'buttons-active'}`, emptyRow()]))));



let savedRows: Record<string, Row> = initialRows();



export default function LanyardComparison({ module, enabled, setEnabled }: { module: string; enabled: boolean; setEnabled: (enabled: boolean) => void }) {

  const [profile, setProfile] = useState<DevLanyardQuality>(getDevLanyardQuality());

  const [gpu, setGpu] = useState(getDevGpuExperiment);

  const [activity, setActivity] = useState('drag');

  const [audit, setAudit] = useState<unknown>(null);

  const startedSettings = useRef<Record<string, unknown>>({});

  const gpuKey = JSON.stringify({ ...gpu, forceActive: false });

  const [rows, setRows] = useState<Record<string, Row>>(() => savedRows);

  useEffect(() => { savedRows = rows; }, [rows]);

  const [message, setMessage] = useState('');

  const [running, setRunning] = useState(false);

  const owner = useRef(false);

  const generation = useRef(0);

  const finishing = useRef(false);

  const deadline = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {

    const update = () => setGpu(getDevGpuExperiment());

    window.addEventListener('stanza-gpu-experiment', update);

    return () => { window.removeEventListener('stanza-gpu-experiment', update); resetDevGpuExperiment(); };

  }, []);

  useEffect(() => {

    const root = document.documentElement;

    root.dataset.stanzaGpuSurface = gpu.surface;

    root.dataset.stanzaGpuIsolation = gpu.isolation;

    if (gpu.surface === 'precomposed') root.style.setProperty('--stanza-gpu-precomposed', createDevPrecomposedSurface());

    return () => { delete root.dataset.stanzaGpuSurface; delete root.dataset.stanzaGpuIsolation; root.style.removeProperty('--stanza-gpu-precomposed'); };

  }, [gpu.surface, gpu.isolation]);

  useEffect(() => {

    setRunning(false);

    return () => { generation.current++; clearTimeout(deadline.current); if (owner.current) cancelDevGuidedBenchmarkCapture(); owner.current = false; finishing.current = false; setDevGpuExperiment({ forceActive: false }); };

  }, [module, enabled, profile, gpuKey, activity]);

  async function finish() {

    if (!owner.current || finishing.current) return;

    finishing.current = true;

    clearTimeout(deadline.current);

    const current = generation.current;

    setMessage('Finishing capture…');

    const capture = await finishDevGuidedBenchmarkCapture();

    if (current !== generation.current) return;

    owner.current = false; finishing.current = false; setRunning(false);

    if (activity === 'buttons-active') setDevGpuExperiment({ forceActive: false });

    const key = String(startedSettings.current.key);

    const diagnostics = getDevPerformanceDiagnostics();

    const summary = summarizeLanyardCapture(diagnostics.lanyardSamples);

    setRows(previous => ({ ...previous, [key]: { ...emptyRow(), trials: [...(previous[key]?.trials ?? []).slice(-3), { settings: startedSettings.current, canvasAudit: readDevCanvasAudit(), viewport: `${innerWidth}x${innerHeight}`, theme: document.documentElement.getAttribute('data-theme'), capturedAt: new Date().toISOString(), capture, summary }] } }));

    setMessage(activity !== 'drag' ? 'Button capture saved. Enter observed process CPU and black flash count.' : summary.gestures.some(g => g.sustainedFiveSeconds) ? 'Captured sustained drag. Enter observed CPU and smoothness below.' : 'Saved, but no completed ~5-second drag was recorded (expected for disabled baseline).');

  }

  function start() {

    if (!beginDevGuidedBenchmarkCapture(`manual-lanyard:${module}:${profile}:${gpu.surface}`)) { setMessage('Another capture is active. Finish it first.'); return; }

    const root = document.documentElement;

    const selectedProfile = enabled ? profile === 'auto' ? 'full' : profile : 'disabled';

    const buttonVariant = root.dataset.stanzaGeoControl || 'current';

    const key = `${module}/${selectedProfile}/${gpu.surface}/${gpu.isolation}/aa=${gpu.antialias}/dpr=${gpu.dpr}/buttons=${buttonVariant}/${activity}`;

    startedSettings.current = { key, module, profile: selectedProfile, gpu, activity, canvasAudit: readDevCanvasAudit(), rootFlags: { ...root.dataset }, hardwareTarget: 'Office integrated graphics / older laptop GPU; current tester RTX 5060 Ti 16GB is not baseline' };

    owner.current = true; setRunning(true);

    if (activity === 'buttons-active' && enabled) setDevGpuExperiment({ forceActive: true });

    setMessage(activity === 'drag' ? 'Drag manually for about 5 seconds, release, wait for sleep, then Finish. Auto-finish after 50s.' : 'Hover both buttons repeatedly without clicking. Active mode forces stationary scene rendering for 15s; it is not a drag benchmark. Finish within 15s.');

    deadline.current = setTimeout(() => { void finish(); }, 50000);

  }

  const report = JSON.stringify({ hardwareTarget: 'Ordinary office hardware; RTX 5060 Ti is high-end evidence only', note: 'Local manual Chrome comparison. Blank CPU means unmeasured. GPU Process CPU is primary, Browser CPU next, Stanza tab renderer CPU secondary. GPU Process CPU is not GPU hardware utilization. Manual fields apply to the latest trial in a row. Render is CPU submission, not GPU time. R3F advance includes physics/render; do not add them together. Pointer timing excludes R3F raycasting. Whole-capture intervals include settling; compare gesture work for sustained drag.', rows }, null, 2);

  return <section className="mt-3 border p-2" aria-label="Manual lanyard comparison">

    <label>Lanyard manual profile<select disabled={running} value={enabled ? profile : 'disabled'} onChange={e => { const next = e.target.value; setEnabled(next !== 'disabled'); if (next !== 'disabled') { setProfile(next as DevLanyardQuality); setDevLanyardQuality(next as DevLanyardQuality); } }}><option value="auto">Auto (production unchanged)</option>{profiles.map((p, i) => <option value={p} key={p}>{names[i]}</option>)}</select></label>

    <label>Canvas / underlay experiment<select disabled={running} value={gpu.surface} onChange={e => setDevGpuExperiment({ surface: e.target.value as GpuExperiment['surface'] })}>{GPU_SURFACES.map(mode => <option key={mode}>{mode}</option>)}</select></label>

    <label>Single GPU category isolation<select disabled={running} value={gpu.isolation} onChange={e => setDevGpuExperiment({ isolation: e.target.value as GpuExperiment['isolation'] })}>{GPU_ISOLATIONS.map(mode => <option key={mode}>{mode}</option>)}</select></label>

    <details><summary>Quality tests - after compositing tests</summary>

      <label><input type="checkbox" disabled={running} checked={gpu.antialias} onChange={e => setDevGpuExperiment({ antialias: e.target.checked })} />Antialias</label>

      <label>DPR<select disabled={running} value={gpu.dpr} onChange={e => setDevGpuExperiment({ dpr: Number(e.target.value) as 1 | .75 })}><option value={1}>1</option><option value={.75}>0.75 diagnostic</option></select></label>

    </details>

    <label>Capture activity<select disabled={running} value={activity} onChange={e => setActivity(e.target.value)}><option value="drag">Manual sustained drag</option><option value="buttons-settled">Button hover - settled / disabled</option><option value="buttons-active">Button hover - active rendering for 15s</option></select></label>

    <p>Alpha/AA/DPR changes restart the scene. Wait for initialization and settling before Start. Opaque modes intentionally obscure DOM under the full-size canvas; they are not a visual-equivalent production fix.</p>

    <button type="button" disabled={running} onClick={() => setAudit(readDevCanvasAudit())}>Inspect actual context and ancestors</button>

    <details><summary>Actual canvas audit</summary><pre className="max-h-48 overflow-auto">{JSON.stringify(audit, null, 2)}</pre></details>

    <p>Keep theme, viewport and motion equal. Turn style logging off. No uploads; results stay in memory. CPU fields apply to the latest trial in that row.</p>

    <button disabled={running || !['geofence', 'sessionCenter'].includes(module)} onClick={start}>Start sustained drag capture</button>

    <button disabled={!running} onClick={() => void finish()}>Finish sustained drag capture</button>

    <p role="status">{message}</p>

    <div className="max-h-64 overflow-auto">{Object.entries(rows).map(([key, row]) => <fieldset key={key}><legend className="break-all">{key.replace('geofence', 'Geo').replace('sessionCenter', 'Session').replace('chromium-lightweight', 'LIGHT').replace('very-light', 'VERY LIGHT').replace('full', 'FULL')}</legend>{(['gpuCpu', 'browserCpu', 'tabCpu', 'smoothness', 'flicker'] as const).map((field, i) => <label key={field}>{['GPU Process peak CPU %', 'Browser peak CPU %', 'Stanza tab renderer peak CPU %', 'Smoothness 1-5', 'Visible black flashes (count)'][i]}<input type="number" min={field === 'smoothness' ? 1 : 0} max={field === 'smoothness' ? 5 : undefined} step={field === 'smoothness' ? 1 : 'any'} value={row[field]} onChange={e => setRows(previous => ({ ...previous, [key]: updateManualRow(previous[key], field, e.target.value) }))} /></label>)}<span>{row.trials.length} captures</span></fieldset>)}</div>

    <button onClick={async () => { try { await navigator.clipboard.writeText(report); setMessage('Comparison copied locally.'); } catch { setMessage('Clipboard unavailable; select and copy the report below.'); } }}>Copy lanyard comparison</button>

    <details><summary>Comparison output</summary><textarea readOnly aria-label="Lanyard comparison output" value={report} className="w-full h-48" /></details>

  </section>;

}

