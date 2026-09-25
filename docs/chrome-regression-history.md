# Chrome regression history — September 16, 2026

## Evidence and boundary

Confirmed source boundary: parent `b0921cc22763234a00b74d2c3415f734f2f2310b`
(August 3, `perf(lanyard): sleep rendering after physics settle`) →
`1725157143935d154e0dfd37cd43d7e654cdb325` (August 8,
`fix(visuals) centered install button and enhanced mobile ui experience`).
This is the narrowest boundary introducing the suspect button behavior, not a
browser-tested last-good/first-bad pair. August 2 reference
`0bd1c7d8d9d81f69955110f5cf0a32d02f7b9035` has the earlier primitives too.
History was inspected with read-only log/show/diff; no checkout or Git mutation.

## Exact button changes

In `src/pages/Dashboard.tsx`, the idle Clock In branch changed from:

```tsx
"bg-gradient-to-tr from-emerald-600 to-emerald-400 text-slate-950 shadow-[0_0_30px_rgba(16,185,129,0.4)] hover:shadow-[0_0_40px_rgba(16,185,129,0.6)]"
```

to `"stanza-theme-primary"`. Its common classes retained rounded clipping,
relative z-10, `transition-transform duration-300 hover:scale-105 active:scale-95`.
No hover background-image removal existed in the old idle branch.

Request Break changed from:

```tsx
"rounded-lg bg-emerald-500 px-4 py-2 text-xs font-black uppercase tracking-widest text-black transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-55"
```

to:

```tsx
"stanza-theme-primary rounded-lg px-4 py-2 text-xs font-black uppercase tracking-widest transition-colors disabled:cursor-not-allowed disabled:opacity-55"
```

The same commit added to `src/index.css`:

```css
.stanza-theme-primary {
  background: linear-gradient(135deg, var(--stanza-accent), var(--stanza-accent-hover)) !important;
  color: var(--stanza-accent-foreground) !important;
  border-color: var(--stanza-border-accent) !important;
  box-shadow: 0 0 26px color-mix(in srgb, var(--stanza-accent) 34%, transparent);
}
.stanza-theme-primary:hover { background: var(--stanza-accent-hover) !important; }
```

The shared transition list added background-color/border-color/color/box-shadow/
opacity at 140ms and transform at 110ms, plus an active `transform: scale(.98)`.
A second enabled-hover rule repeated the solid background and changed the shadow.

**Confirmed mechanism in the CSS:** the resting background shorthand resets the
underlying color to transparent; the hover shorthand removes the image and sets
a solid color, while background-color is transitioned. The image is not smoothly
interpolated into the solid color. This exposes a partially transparent fill over
the dark panel during entry. No opaque-black CSS value is necessary.
**Suspected runtime cause:** this matches the reported pointer-entry dark flash,
but the recordings alone do not prove it is the only Chrome paint/compositor issue.
The fix must not be described as visually verified until real Chrome is checked.

## Login, separately

`src/components/AuthShell.tsx` mounts `FingerprintCanvas` behind Login in a fixed
full-screen layer. `FingerprintCanvas` uses an opaque Canvas2D context, native DPR,
continuous RAF, animated radial glow and ring paths. Login's translucent panel and
backdrop-blur-xl, language-bar blur, and auth transition overlay predate August 8.
The canvas is not the Dashboard's SVG mask and does not use lanyard WebGL.

August 8 added inside `FingerprintCanvas`'s `drawFrame`:

```ts
const rootStyles = getComputedStyle(document.documentElement);
const authBackground = rootStyles.getPropertyValue('--stanza-auth-background').trim();
const authRingRgb = rootStyles.getPropertyValue('--stanza-auth-ring-rgb').trim();
const authPulseRgb = rootStyles.getPropertyValue('--stanza-auth-pulse-rgb').trim();
```

Fallbacks remained; a dark-class read was already present. Inside **each ring** it
added two `split(',').map(parseInt)` operations, one for each RGB triple. At 1920px
width there are 69 rings: 138 RGB parses / 414 integer parses and 276 split/map
array results per rendered frame, plus one computed-style read and three token
reads. These are source-derived counts, not measured GPU utilization.

The full-screen animation was not introduced by this commit. July 12 `11aec93`
added the radial glow and optional static mode; July 13 `f650ad6` increased glow
and ring intensity. August 8 made their palette theme-dependent. Its extra work
is confirmed; responsibility for the large Chrome process spikes is unproven.

## Other nearby shared changes

- July 29 `cf5b9ba` introduced light-intensity tokens; existing Dashboard mask and
  420/520px blur-3xl glows retained their rendering representation.
- August 3 `b0921cc` tokenized dark atmosphere/topography/glows and added presets;
  the mask and glows already existed. It also changed Login demo accordion styling.
- August 8 added non-Emerald auth descendant theme remappings for panels, borders,
  focus rings and inputs; AuthShell switched its fixed color to an auth token.
  Dashboard shell descendant remappings and finite workspace/state entry animations
  were introduced. These are additional candidates, not proven CPU causes.
- August 12 `1b9920ee9eaa771c2ec6b0043add8aca839b41e8` expanded transition scope from
  named shells to all Dashboard buttons/ARIA controls, restored near-black Emerald,
  and removed some modal/mobile backdrop work. It did not introduce the button
  primitive switch. Dashboard-scoped rules cannot explain Login on their own.
- August 20 `d01c60402c225102f026e0fe23812b2280d5fb7c` extracted architecture boundaries;
  the relevant CSS behavior persisted. Current uncommitted work is separate history.

No evidence establishes a new giant full-screen CSS blur or mask on Login in the
August 3–8 boundary. Do not revert unrelated selectors or redesign the background.

## Authorized targeted implementation

Restore Clock In's persistent gradient and Request Break's solid-to-solid fill
using existing semantic tokens. Remove transform interactions on these two controls.
Cache Login palette outside RAF, refresh on root theme/preset/custom-style changes,
pause RAF while hidden, and retain visual drawing equations and normal cadence.
Add bounded DEV callback/counter measurements and deterministic regression tests.
Lanyard and production Auto remain unchanged. Implementation/validation results
are recorded below.

## Applied changes

- `src/pages/Dashboard.tsx` and `src/index.css`: scoped Geo modifiers retain the
  Clock gradient in both rest and enabled hover, with an opaque accent base beneath
  it. Request Break uses an opaque accent solid at rest and opaque accent-hover
  solid on hover. Both endpoints therefore have alpha 1; no image removal exposes
  a transitioning transparent base. Other semantic primary buttons are unchanged.
  Removed Clock's scale utilities and overrode shared hover/active transforms only
  for these two controls. Transitions are restricted to background-color,
  border-color and color, with reduced-motion suppression. Focus/disabled states,
  layout, business actions, tokens, seven preset definitions and Custom are retained.
- `src/lib/login-canvas-palette.ts`: resolves the three tokens and dark state,
  and parses the two RGB triples once outside the frame callback.
- `src/components/FingerprintCanvas.tsx`: consumes the prepared palette, observes
  root class/theme/preset/light-intensity/style changes (including Custom inline
  tokens), and resolves once per delivered mutation batch. No theme polling in RAF.
  There is one guarded pending RAF. Hidden documents cancel it; visible documents
  schedule one callback without replaying missed frames. An in-progress pulse's
  start time is adjusted for hidden time. Ambient animation uses the current RAF
  timestamp; no backlog is simulated. Cleanup cancels RAF, removes the visibility
  listener and disconnects both observers. Reduced-motion redraws also use the cache.
- `src/lib/dev-login-canvas.ts`: DEV-only, maximum 600 measured frames per mount,
  four retained aggregate records, no sample arrays or independent timers. Records
  frame count, average/worst callback CPU, palette reads/parses and historical
  counter equivalents. Allocation measurements are explicitly unavailable.
  Production bundle search found neither the console measurement property nor
  its historical counter marker.

The ring geometry, radial gradient stops, stroke calculations, alpha equations,
DPR and normal RAF cadence were not simplified. Dynamic gradient creation and
RGBA strings remain because they depend on animation time; constant theme token
reads, RGB parsing and their arrays have moved out of the frame loop.

## Measurements and regression checks

`npx.cmd tsx scripts/chrome-regression-test.ts` compiles the actual historical
August 8 component and current component in memory, with a deterministic 1920×1080
Canvas2D stub and controlled RAF/observers. It does not check out historical files.
Instrumented computed-style/token/class reads and integer parses establish:

| Work | Historical, 120 unchanged-theme frames | Fixed, 120 unchanged-theme frames |
|---|---:|---:|
| Computed-style reads | 120 | 1 initial; 0 in frames |
| Token reads | 360 | 3 initial; 0 in frames |
| Dark-class reads | 120 | 1 initial; 0 in frames |
| RGB triple parses | 16,560 | 2 initial; 0 in frames |
| Integer parses | 49,680 | 6 initial; 0 in frames |

One theme mutation batch adds one computed-style read, three token reads, two RGB
parses and six integer parses. The test includes Custom's `style` observation,
theme refresh, hidden/resume behavior, single pending RAF, cleanup/remount ownership,
reduced-motion refresh and the 600-frame instrumentation cap. It compares the full
Canvas2D command/style sequence at an equal timestamp and palette: identical.
This is drawing-command equivalence, not a screenshot or actual React StrictMode
browser run; setup/cleanup/remount ownership is simulated with hook stubs.

Recorded 120-frame callback measurements in Node VM with Canvas2D stub:

| Callback | Historical | Fixed |
|---|---:|---:|
| Average CPU milliseconds | 8.943 | 8.540 |
| Worst CPU milliseconds | 18.556 | 18.677 |

These noisy stub timings include VM/instrumentation overhead and exclude real
Canvas2D rasterization, GPU and Chrome compositor work. They do not establish a
Chrome speedup; the worst sample did not improve. A fixed 600-frame DEV aggregate
in the same harness recorded 7.599ms average / 18.660ms worst, three palette
resolutions / six RGB parses, including two explicit test changes. No actual
allocation or Chrome renderer/GPU measurement is claimed.

For real Chrome, inspect `window.__stanzaLoginCanvasMeasurements` in development
during the first 600 frames after mounting Login. The latest record is the active
mount; a StrictMode cleanup stops its prior record. While the theme is unchanged,
frames should increase without themeReads/colorParses increasing. Change preset,
light/dark or Custom before the cap and check the palette count. All counters freeze
at the cap; remount Login for another bounded run. `legacyEquivalent*` fields are
source-derived counter equivalents, not an executed historical timing baseline.

## Validation and remaining manual work

Passed: lint, production build, performance (110/110), navigation, theme, tutorials,
PWA, security, audit (13), sessions (6), HR background and the new regression script.
Theme checks cover original preset snapshots, Custom contrast/persistence, Passkey
and close-glyph contracts. Security's credential-dependent authenticated checks
remain skipped with the existing missing-fixture warning. Build reports existing
Lexical PURE-annotation and large-chunk warnings. Three initial performance failures
were LF-sensitive source checks after Windows newline conversion; restoring LF
made all 110 pass without weakening assertions.

Files changed in this pass only:

1. `docs/chrome-regression-history.md`
2. `src/index.css`
3. `src/pages/Dashboard.tsx`
4. `src/components/FingerprintCanvas.tsx`
5. `src/lib/login-canvas-palette.ts`
6. `src/lib/dev-login-canvas.ts`
7. `scripts/chrome-regression-test.ts`
8. `scripts/theme-test.ts` (palette-source assertion follows the extracted resolver)

Existing uncommitted work was preserved. No Git state was mutated. Lanyard source,
scheduler, profiles and production Auto were not changed in this pass.

August 8 remains the strongest button boundary. There is no claim that it alone
caused total Chrome CPU/GPU load. Earlier real-Chrome automation stopped on its URL
validation guard; this pass does not represent manual Chrome verification.
Still required: repeatedly enter/leave the exact enabled buttons without submitting
HR actions, confirm no flash, verify light/dark/seven presets/Custom and focus,
then compare Login callback and Chrome process behavior under matched conditions.
Check hide/resume and theme changes in real React/Chrome too. The RTX 5060 Ti 16GB
is not target office hardware; neither usability there nor the Node timings justify
accepting high GPU cost or changing production lanyard tiers.
