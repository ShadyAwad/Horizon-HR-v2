import { useEffect, useState } from 'react';
import { beginDevGuidedBenchmarkCapture, cancelDevGuidedBenchmarkCapture, finishDevGuidedBenchmarkCapture, type GuidedBenchmarkCapture } from '../../lib/dev-performance';
import './login-flicker-benchmark.css';

type Mode = 'CURRENT ANIMATION' | 'NO ANIMATION' | 'NO GRID TRANSITION' | 'NO OPACITY TRANSITION';
type Phase = 'ready' | 'countdown' | 'interacting' | 'settling' | 'recording' | 'complete';
type Result = { mode: Mode; capture: GuidedBenchmarkCapture; flicker: boolean; note: string };
type Props = { onClose: () => void; onPrepare: () => void };

const modes: Array<{ label: Mode; attribute: string | null }> = [
  { label: 'CURRENT ANIMATION', attribute: null },
  { label: 'NO ANIMATION', attribute: 'no-animation' },
  { label: 'NO GRID TRANSITION', attribute: 'no-grid-transition' },
  { label: 'NO OPACITY TRANSITION', attribute: 'no-opacity-transition' },
];

function metric(value: number, suffix = '') { return `${Math.round(value * 10) / 10}${suffix}`; }

export default function LoginFlickerBenchmark({ onClose, onPrepare }: Props) {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('ready');
  const [countdown, setCountdown] = useState(10);
  const [capture, setCapture] = useState<GuidedBenchmarkCapture | null>(null);
  const [flicker, setFlicker] = useState(false);
  const [note, setNote] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const mode = modes[index]!;

  useEffect(() => {
    if (mode.attribute) document.documentElement.setAttribute('data-stanza-login-benchmark', mode.attribute);
    else document.documentElement.removeAttribute('data-stanza-login-benchmark');
    return () => document.documentElement.removeAttribute('data-stanza-login-benchmark');
  }, [mode.attribute]);
  useEffect(() => () => cancelDevGuidedBenchmarkCapture(), []);

  useEffect(() => {
    if (phase !== 'countdown') return;
    const timer = window.setTimeout(() => {
      if (countdown <= 1) {
        beginDevGuidedBenchmarkCapture(`login-demo-accounts:${mode.label.toLowerCase().replaceAll(' ', '-')}`);
        setPhase('interacting');
      } else setCountdown((value) => value - 1);
    }, 1_000);
    return () => window.clearTimeout(timer);
  }, [countdown, mode.label, phase]);

  const start = () => { onPrepare(); setCountdown(10); setCapture(null); setFlicker(false); setNote(''); setPhase('countdown'); };
  const complete = async () => { setPhase('settling'); setCapture(await finishDevGuidedBenchmarkCapture()); setPhase('recording'); };
  const save = () => {
    if (!capture) return;
    setResults((current) => [...current, { mode: mode.label, capture, flicker, note }]);
    if (index === modes.length - 1) setPhase('complete');
    else { setIndex((current) => current + 1); setPhase('ready'); }
  };
  const copy = async () => {
    const lines = ['# Stanza login flicker benchmark', `Timestamp: ${new Date().toISOString()}`, '', '| Mode | Paint | Event Timing | Long Tasks | Frames | Mutations | Flicker |', '|---|---:|---:|---:|---:|---:|---|', ...results.map((result) => `| ${result.mode} | ${metric(result.capture.twoFramePaintMs, 'ms')} | ${result.capture.eventCount} / ${metric(result.capture.eventDuration, 'ms')} | ${result.capture.longTaskCount} / ${metric(result.capture.longTaskDuration, 'ms')} | ${result.capture.frameCount}, worst ${metric(result.capture.worstFrameDuration, 'ms')} | ${result.capture.domMutationCount} | ${result.flicker ? 'Yes' : 'No'} |`), '', ...results.map((result) => `${result.mode}: render Δ ${result.capture.renderDelta}; DOM ${result.capture.domNodesBefore}→${result.capture.domNodesAfter}; ${result.note || 'No note.'}`)];
    await navigator.clipboard?.writeText(lines.join('\n'));
  };

  return <section data-login-flicker-benchmark role="region" aria-label="Login flicker benchmark" className="fixed bottom-3 right-3 z-[100] max-h-[80dvh] w-[min(360px,calc(100vw-1.5rem))] overflow-y-auto rounded-xl border border-emerald-400/30 bg-[#020604] p-4 text-emerald-50"><div className="mx-auto max-w-3xl"><div className="flex flex-wrap justify-between gap-4 border-b border-emerald-400/25 pb-4"><div><p className="text-xs font-black uppercase tracking-[.2em] text-amber-200">Development only</p><h1 className="mt-1 text-2xl font-black">Login flicker benchmark</h1><p className="mt-2 text-sm text-emerald-100/70">Compares the real “Use Demo Account” expansion without changing production animation.</p></div><button type="button" onClick={onClose} className="rounded border border-emerald-400/40 px-3 py-2 text-xs font-bold">Exit</button></div>{phase !== 'complete' && <article className="mt-6 rounded-xl border border-emerald-400/25 bg-emerald-950/25 p-5"><p className="text-xs font-black uppercase tracking-widest text-amber-200">Test {index + 1} of {modes.length}</p><h2 className="mt-1 text-3xl font-black text-emerald-200">{mode.label}</h2>{phase === 'ready' && <><p className="mt-4 text-sm text-emerald-100/70">Leave Chrome Task Manager visible, then start the idle countdown. Only the dev diagnostic style override is active for this mode.</p><button type="button" onClick={start} className="mt-4 rounded-lg bg-emerald-400 px-4 py-3 text-sm font-black text-[#04110d]">Start 10-second idle countdown</button></>}{phase === 'countdown' && <div className="mt-5 text-center"><p className="text-sm">Idle. Do not interact yet.</p><p aria-live="assertive" className="mt-2 text-7xl font-black text-emerald-300">{countdown}</p></div>}{phase === 'interacting' && <div className="mt-5 rounded-lg border border-emerald-300/30 bg-emerald-400/10 p-4"><ol className="list-decimal space-y-2 pl-5 text-sm"><li>Click the real “Use Demo Account” control beside this panel once.</li><li>Observe the expanding panel for flicker.</li><li>Click “Interaction complete”.</li></ol><button type="button" onClick={() => void complete()} className="mt-4 rounded-lg bg-amber-300 px-4 py-3 text-sm font-black text-black">Interaction complete</button></div>}{phase === 'settling' && <p className="mt-5 text-sm text-emerald-100/75">Collecting two-frame paint and the bounded settle window.</p>}{phase === 'recording' && capture && <div className="mt-5 space-y-3"><p className="rounded border border-emerald-300/25 p-3 text-sm text-emerald-100/75">Paint {metric(capture.twoFramePaintMs, 'ms')} · Event Timing {capture.eventCount}/{metric(capture.eventDuration, 'ms')} · long tasks {capture.longTaskCount}/{metric(capture.longTaskDuration, 'ms')} · frames {capture.frameCount}, worst {metric(capture.worstFrameDuration, 'ms')} · mutations {capture.domMutationCount} · render Δ {capture.renderDelta}</p><label className="flex gap-2 text-sm"><input type="checkbox" checked={flicker} onChange={(event) => setFlicker(event.target.checked)} />I saw flicker</label><label className="block text-sm">Optional note<textarea value={note} onChange={(event) => setNote(event.target.value)} className="mt-1 block min-h-20 w-full rounded border border-emerald-400/30 bg-black/30 px-3 py-2" /></label><button type="button" onClick={save} className="rounded-lg bg-emerald-400 px-4 py-3 text-sm font-black text-[#04110d]">{index === modes.length - 1 ? 'Finish comparison' : 'Save and prepare next test'}</button></div>}</article>}{results.length > 0 && <section className="mt-6 rounded-xl border border-emerald-400/25 bg-black/25 p-5"><div className="flex flex-wrap justify-between gap-3"><h2 className="font-black">Results</h2><button type="button" onClick={() => void copy()} className="rounded border border-emerald-400/40 px-3 py-2 text-xs font-bold">Copy benchmark report</button></div><div className="mt-3 overflow-x-auto"><table className="w-full min-w-[650px] text-left text-xs"><thead><tr><th>Mode</th><th>Paint</th><th>Event Timing</th><th>Long Tasks</th><th>Frames</th><th>Mutations</th><th>Flicker</th></tr></thead><tbody>{results.map((result) => <tr key={result.mode} className="border-t border-emerald-400/15"><td className="py-2 font-bold">{result.mode}</td><td>{metric(result.capture.twoFramePaintMs, 'ms')}</td><td>{result.capture.eventCount}/{metric(result.capture.eventDuration, 'ms')}</td><td>{result.capture.longTaskCount}/{metric(result.capture.longTaskDuration, 'ms')}</td><td>{result.capture.frameCount}</td><td>{result.capture.domMutationCount}</td><td>{result.flicker ? 'Yes' : 'No'}</td></tr>)}</tbody></table></div>{phase === 'complete' && <p className="mt-4 text-sm text-amber-100">Diagnostic only: compare flicker and capture deltas before considering any production animation change.</p>}</section>}</div></section>;
}
