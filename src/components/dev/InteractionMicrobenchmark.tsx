import { useEffect, useMemo, useRef, useState } from 'react';
import './interaction-microbenchmark.css';
import { armDevInteractionBenchmark, getDevPerformanceDiagnostics, observeDevControlFrames, recordDevInteraction, resetDevPerformanceDiagnostics } from '../../lib/dev-performance';
import CustomThemeEditor from '../CustomThemeEditor';
import { useStanzaPreferences } from '../../lib/StanzaPreferencesContext';
import { useTheme } from '../../lib/ThemeContext';
import { useLanguage } from '../../lib/LanguageContext';

type Variant = {
  id: string;
  label: string;
  className: string;
  parentClassName?: string;
};

// Exact Settings preference-card classes. Every differential case shares the
// same ancestor effects; only the named property changes.
const controlStyle = 'stanza-interactive-control min-h-20 rounded-lg border border-transparent p-2 text-start outline-none focus-visible:ring-2 focus-visible:ring-emerald-400';
const variants: Variant[] = [
  { id: 'plain', label: 'Plain opaque', className: 'perf-lab-plain' },
  { id: 'themed', label: 'Current Settings control', className: controlStyle },
  { id: 'launcher', label: 'Current navigation row', className: 'stanza-interactive-control stanza-navigation-item flex min-h-11 w-full items-center gap-3 rounded-lg border border-transparent px-3 text-start text-sm font-bold' },
  { id: 'no-pressed-transform', label: 'Pressed transform removed', className: `${controlStyle} perf-lab-no-pressed-transform` },
  { id: 'no-transform', label: 'All transforms removed', className: `${controlStyle} perf-lab-no-transform` },
  { id: 'no-shadow', label: 'Shadow removed', className: `${controlStyle} perf-lab-no-shadow` },
  { id: 'opaque-parent', label: 'Opaque parent', className: controlStyle, parentClassName: 'perf-lab-opaque' },
  { id: 'no-pseudo', label: 'Pseudo-elements removed', className: `${controlStyle} perf-lab-no-pseudo` },
  { id: 'no-backdrop', label: 'Parent backdrop removed', className: controlStyle, parentClassName: 'perf-lab-no-backdrop' },
  { id: 'no-filter', label: 'Parent filter removed', className: controlStyle, parentClassName: 'perf-lab-no-filter' },
  { id: 'no-transition', label: 'Transitions removed', className: `${controlStyle} perf-lab-no-transition` },
];

export default function InteractionMicrobenchmark() {
  const [selected, setSelected] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const [captureStyles, setCaptureStyles] = useState(false);
  const [report, setReport] = useState('');
  const { backgroundPreset, setBackgroundPreset } = useStanzaPreferences();
  const { toggleTheme } = useTheme();
  const { lang, setLang } = useLanguage();
  const [atmosphere, setAtmosphere] = useState(true);
  useEffect(() => captureStyles && root.current ? observeDevControlFrames(root.current) : undefined, [captureStyles]);
  const denseButtons = useMemo(() => Array.from({ length: 240 }, (_, index) => index + 1), []);

  const interact = (variant: Variant) => {
    recordDevInteraction(`perf-lab:${variant.id}`, () => setSelected(variant.id));
  };

  return (
    <main className="perf-lab-page" ref={root}>
      <section className="perf-lab-shell" aria-labelledby="perf-lab-title">
        <header>
          <p className="perf-lab-kicker">Development-only benchmark</p>
          <h1 id="perf-lab-title">Interaction microbenchmark</h1>
          <p>Arm an interaction, wait for idle, then hover and press one matching control. This page keeps dimensions and text consistent while varying only presentation layers.</p>
          <div className="perf-lab-actions">
            <button type="button" className="perf-lab-plain" onClick={() => armDevInteractionBenchmark('perf-lab', 0)}>Arm next press</button>
            <a href="/">Return to Stanza</a>
            <button type="button" onClick={toggleTheme}>Toggle light / dark</button>
            <button type="button" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>English / العربية</button>
            <button type="button" onClick={() => setBackgroundPreset(backgroundPreset === 'custom' ? 'emerald' : 'custom')}>Theme: {backgroundPreset}</button>
            <button type="button" onClick={() => setAtmosphere((value) => !value)}>Atmosphere: {atmosphere ? 'on' : 'off'}</button>
          </div>
          {backgroundPreset === 'custom' && <CustomThemeEditor />}
          <label><input type="checkbox" checked={captureStyles} onChange={(event) => setCaptureStyles(event.target.checked)} /> Capture computed frames (adds synchronous style reads; disable for CPU measurement)</label>
          <button type="button" onClick={() => setReport(JSON.stringify(getDevPerformanceDiagnostics(), null, 2))}>Read captured frames</button>
          <button type="button" onClick={() => { resetDevPerformanceDiagnostics(); setReport(''); }}>Clear capture</button>
          {report && <textarea aria-label="Computed frame report" readOnly value={report} className="w-full h-48" />}
        </header>

        <section className={`perf-lab-grid stanza-dashboard ${atmosphere ? 'perf-lab-atmosphere' : ''}`} aria-label="Button style variants">
          {variants.map((variant) => (
            <article key={variant.id} className={`perf-lab-case ${variant.id === 'plain' ? '' : 'perf-lab-effect-parent'} ${variant.parentClassName ?? ''}`}>
              <p>{variant.label}</p>
              <button
                type="button"
                className={variant.className}
                data-perf-control={variant.id}
                aria-pressed={selected === variant.id}
                onClick={() => interact(variant)}
              >
                Compare control
              </button>
            </article>
          ))}
        </section>

        <section className="stanza-preference-surface p-3" aria-label="Semantic status samples">
          <span data-stanza-status="success" className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25">Approved / online / secure</span>
          <span className="bg-amber-500/15 text-amber-700 dark:text-amber-300">Pending / warning</span>
          <span className="bg-red-500/15 text-red-700 dark:text-red-300">Rejected / error</span>
          <button type="button" className="stanza-tutorial-primary">Tutorial Next / Finish</button>
        </section>
        <section className="perf-lab-dense" aria-labelledby="perf-lab-dense-title">
          <h2 id="perf-lab-dense-title">Dense opaque baseline</h2>
          <p>240 ordinary buttons with theme-color variables, no blur, no shadow, no WebGL, and no transform.</p>
          <div>{denseButtons.map((index) => <button key={index} type="button" onClick={() => recordDevInteraction('perf-lab:dense-button', () => setSelected(`dense-${index}`))}>Action {index}</button>)}</div>
        </section>
      </section>
    </main>
  );
}
