# Chrome graphics-process investigation — 15 September 2026

## Primary evidence and hardware target

The tester uses an RTX 5060 Ti with 16 GB VRAM. This is high-end evidence, not acceptance hardware. Target ordinary 1080p office laptops, Intel/AMD integrated graphics or older laptop GPUs, and 8–16 GB system RAM. Usability on this GPU does not demonstrate acceptable office-hardware performance. No lower-end performance numbers are inferred from it.

Both supplied recordings were decoded and inspected. The app recording is 94.098s; the Task Manager recording is 42.241s. The following are visible samples from Task Manager's **CPU** column, not GPU utilization percentages or a complete peak search:

| Task Manager video timestamp | Browser CPU | GPU Process CPU | Visible generic Renderer CPU |
|---|---:|---:|---:|
| 2.025s | 0.9 | 0.3 | 0.0 |
| 6.025s | 13.6 | 76.6 | 0.0 |
| 8.025s | 7.5 | 160.9 | 0.0 |
| 10.025s | 8.6 | 163.8 | 0.0 |
| 16.025s | 3.1 | 30.4 | 0.0 |
| 20.025s | 4.4 | 53.7 | 0.0 |
| 24.025s | 2.7 | 20.4 | 0.0 |
| 28.024s | 19.3 | 72.1 | 0.0 |
| 40.024s | 7.3 | 174.3 | 0.0 |

The observed graphics-process CPU cost is substantial. Browser CPU is usually much smaller but is not always only a few percent. The recording has Task Manager's **Browser** category selected, rather than showing the named Stanza tab under Tabs & extensions/All tasks. Its generic Renderer row cannot establish Stanza renderer CPU. The GPU Process is shared; the video does not identify which application interaction causes each sample. The app and Task Manager recordings are separate and do not show a synchronized controlled drag or switch matrix. They do not distinguish command submission, graphics-driver work, raster, compositor work and GPU hardware execution.

The app video's consecutive frames confirm Clock In fill loss at **18.750s and 19.883s**, and Request Break at **21.016s and 21.883s**, followed by dark-to-bright recovery. Pointer entry precedes each; nearby panels remain stable. No active-lanyard/disabled comparison is identified in those frames. The footage includes Settings/theme changes but is not a FULL/LIGHT or alpha A/B trial.

## Canvas audit

Source and installed dependency findings:

| Property | Current configuration |
|---|---|
| alpha | Explicit `true`; transparent clear alpha 0 |
| antialias | Explicit `true` |
| preserveDrawingBuffer | Not overridden; Three default `false` |
| premultipliedAlpha | Not overridden; Three default `true` |
| powerPreference | Explicit `high-performance` |
| tone mapping | R3F default ACESFilmicToneMapping |
| output color space | R3F default SRGBColorSpace |
| DPR | 1 |
| scheduling | One never-loop owner; FULL 60/24, LIGHT 45/20; settled/paused 0 |
| CSS opacity | No canvas opacity override in the source; actual styles are recorded by the new audit |
| placement | Full-size absolute inset-0 wrapper, z-10, transparent background, pointer-events-none, overflow-hidden |
| events | R3F eventSource is the dashboard root, with client-coordinate events |
| clipping | Lanyard wrapper and dashboard root overflow-hidden; full-viewport canvas blends over themed content |

The canvas is a sibling overlay rather than a child of the rounded Geo panel. Geo has its own large translucent/backdrop-filtered/clipped surface; Session Center's generic panel has a shadow but no corresponding local backdrop blur. This makes transparent full-size WebGL over the Geo underlay a strong **compositing candidate**, not a confirmed cause. Geometry, textures, canvas dimensions and physics were not changed.

**Important dependency detail:** installed Three r185 constructs its WebGL context with `alpha: true` even when the WebGLRenderer constructor's `alpha` option is false. A constructor-only false experiment could be misleading. The diagnostic `alpha-opaque` mode now explicitly creates `canvas.getContext('webgl2', { alpha: false, ... })`, passes that context to Three, clears with opaque semantic page color, and reports `getContextAttributes()` from the actual context. Failure to create the context is not silently relabelled as success. Changing alpha, antialias or DPR remounts the scene/world so immutable attributes are actually changed; wait for initialization before recording.

Perf → **Inspect actual context and ancestors** reports requested options, actual context attributes, drawing-buffer size, pixel ratio, clear alpha, tone mapping, output color space, context loss and the full CSS ancestor chain. It includes opacity, position, z-index, pointer events, overflow, radius, masks, clip-path, filter/backdrop-filter, transform/scale, isolation, contain and backgrounds. These are CSS context candidates, not a GPU layer tree. Promotion/demotion and surface recreation remain unverified without a Chrome layer trace.

## DEV-only switches

Use Perf → Manual lanyard comparison. Restore other preexisting isolation toggles and Geo surface choices to current before each controlled series.

Canvas / underlay experiment:

- `current`: unchanged transparent renderer over the workspace.
- `css-opaque`: opaque semantic page-color CSS background behind transparent WebGL pixels; actual context still has alpha.
- `alpha-opaque`: actual alpha:false WebGL2 context with opaque page-color clear.
- `precomposed`: a single locally generated PNG semantic wash behind the canvas. It is pre-rasterized once on selection, not a screenshot or equivalent reproduction of all DOM content.
- `opaque-dom`: replaces workspace surface/descendant fills with opaque semantic backgrounds; preserves the WebGL configuration.
- `flat-geo`: one opaque Geo surface with its child contents hidden, no Geo backdrop blur/shadow; preserves layout and canvas.
- `flat-test`: suppresses themed dashboard descendant painting except the unchanged canvas and diagnostic panel. Layout remains to preserve event-source coordinates.

Opaque/precomposed modes necessarily obscure the DOM under transparent canvas pixels. They are diagnostic comparisons, not a proposed production visual design.

Single GPU category isolation: `no-backdrop`, `no-filters` (including CSS blur), `no-glows`, `no-topography`, `no-shadows`. These new category tests avoid the old no-backdrop toggle's additional forced opaque background. Canvas/ancestor tests also cover `no-clipping`, `no-masks`, `no-transform`, `no-isolation`, `no-contain`. No-clipping removes overflow clipping, clip-path and radius on that ancestry; the exact button radius is unchanged by button experiments. No forced layer promotion was added.

After the compositing series, independently test antialias true/false and DPR 1/.75, keeping FULL/LIGHT fixed. Existing FULL 60/24, LIGHT 45/20, VERY LIGHT 30/15 and DISABLED remain available. No texture or geometry change and no production Auto change.

## Exact button rendering-primitive tests

Both real controls share `.stanza-theme-primary`: a gradient background normally and solid background shorthand on hover, with background-color/shadow/transform/opacity transitions. Clock In also scales on hover; Request Break has no local hover scale. Shared active styling scales controls. Neither exact button declares a local before/after effect. The opt-in logger now also associates each event with lanyard tier/frame count and records independent transform properties and clipping, alongside prior fill/parent/pseudo samples.

Real Geo button experiment now includes:

| Mode | What it tests |
|---|---|
| current | Existing gradient → solid |
| gradient-gradient | Keeps gradient primitives in both states, reversing semantic stops on hover |
| solid-solid | Semantic midpoint solid fill → solid accent-hover, no image in either state |
| no-background-transition | Existing primitives but no animated background properties; other feedback remains |
| no-transition | Removes all control/descendant transitions |
| opaque-button | Existing retained-gradient plus stable opaque base experiment |
| no-transform / no-shadow / no-pseudo | Existing exact-control isolation |
| opaque-parent / no-backdrop | Existing Geo parent isolation |

The gradient disappearing while its transparent base animates toward opaque remains a concrete shared hypothesis. It is not yet confirmed by solid/solid Chrome evidence. No production button fix was applied and no new live computed-style capture is claimed. Business success/error/non-primary states retain their existing styling; tests target the actual idle Clock In/Request Break primary states and disabled primary states.

For hover with active WebGL, choose Capture activity → **Button hover - active rendering for 15s**, then Start. The existing frame owner renders the stationary scene continuously for at most 15 seconds, with normal pause/visibility protection. This is a rendering-pressure test, not a sustained drag simulation. Hover without clicking; finish within the active window. Compare disabled, settled and active with current and solid-solid buttons. Frame/tier data reveals whether active rendering actually occurred. The forced mode expires and resets on panel closure/configuration cancellation; it does not become a persistent background loop.

## Required manual matrix and reporting

The report prepopulates the seven lanyard cases below and four disabled/active button cases. Additional settings produce separate rows rather than mixing current/opaque/AA/DPR captures. Each saved trial records settings, canvas audit, root diagnostic flags, theme, viewport, actual frame/FPS/physics statistics and gesture/settle timing. Manual fields are GPU Process peak CPU (primary), Browser peak CPU, Stanza tab renderer peak CPU, smoothness 1–5 and visible black-flash count. Manual entries are attached to the latest trial and retained when that row is repeated. Blank means unmeasured. Copy lanyard comparison copies locally; there is no upload.

| Required trial | Actual controlled Chrome result |
|---|---|
| Geo FULL current | Pending |
| Geo FULL alpha-opaque | Pending |
| Geo FULL no-backdrop | Pending |
| Geo LIGHT current | Pending |
| Geo DISABLED | Pending |
| Session FULL current | Pending |
| Session FULL alpha-opaque | Pending |
| Disabled + current / solid-solid buttons | Both pending |
| Active rendering + current / solid-solid buttons | Both pending |

Manually drag for about five seconds including a long stretch, release, wait for sleep and Finish. Keep style logging off for process CPU measurements. Do separate short hover recordings with logging on if needed. Record Task Manager's named Stanza tab and GPU Process together using All tasks; keep recording overhead/background apps consistent. No fresh Chrome automation was used in this task; the requested fallback switches and manual fields are ready.

## Decision

The evidence warrants prioritizing graphics-process work and testing alpha/underlay/filter interactions before attributing the problem to React or changing model quality. App CPU timing is not evidence of compositor or GPU savings. A controlled alpha/underlay result is still needed to distinguish blending/composition workload from WebGL rendering workload. No alpha, antialias, DPR, FPS or button change is recommended for production as proven yet. A successful 5060 Ti trial would still need validation on ordinary office hardware before acceptance.

## Files and validation

Changed this task: `src/lib/dev-gpu-experiments.ts` (new), `src/lib/dev-performance.ts`, `src/components/lanyard/Lanyard.tsx`, `src/components/dev/LanyardComparison.tsx`, `src/components/dev/lanyard-comparison.ts`, `src/components/dev/PerformanceIsolationPanel.tsx`, `src/components/dev/performance-isolation.css`, `scripts/lanyard-scheduler-test.ts`, `scripts/performance-test.ts`, and this report. Existing work was preserved; no Git mutation command was used.

Lint and build passed. All requested test suites passed: performance 110/110, navigation, theme, tutorials, PWA, security, audit 13, sessions 6, HR background and lanyard. Scheduler and summary tests remain green; added tests exercise GPU diagnostic auto-expiry, reset cleanup, snapshot isolation and production inertness. Production bundles exclude the GPU diagnostic UI/event markers, and production CSS excludes the new GPU surface selectors. Changed-source UTF-8 and tracked-file whitespace checks passed. Existing security optional-authenticated-fixture warning remains. Build warnings concern large vendor chunks/Lexical annotations; lanyard tests report THREE.Clock deprecation. These tests do not prove real Chrome visual parity or GPU savings.
