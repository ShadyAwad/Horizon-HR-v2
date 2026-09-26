# Login foreground rendering investigation — September 25, 2026

## Evidence and scope

The user's real-Chrome transition-off A/B produced essentially no CPU/power improvement. Transition spam is therefore deprioritized as the primary performance cause. No transition optimization is proposed. The user's foreground/background observation is consistent with visible animation/render work being suppressed when hidden, but does not identify one subsystem.

Analyzed `C:/Users/10/Downloads/Trace-20260925T151354.json`, with URL `http://localhost:3000/?loginCanvasScheduler=optimized`. Renderer main: PID 1184/TID 18164, 23.621 seconds. Complete-event inclusive totals (nested and **not additive**):

| Category | Count | Duration |
|---|---:|---:|
| Main FunctionCall | 16,902 | 766.50 ms |
| Main UpdateLayoutTree | 1,591 | 778.10 ms |
| Main Layout | 110 | 14.52 ms |
| Main Paint | 2,405 | 289.94 ms |
| Main Commit | 1,409 | 3,701.40 ms |
| Main PageAnimator::serviceScriptedAnimations | 1,409 | 477.64 ms |

`CpuProfiler::StartProfiling` is a 58.36 ms startup event and is excluded from the causal diagnosis. Main `Commit` is browser rendering/compositor submission work, not a React commit count or proof of GPU execution time. Across all processes there are 3,951 Commit events; only 1,409 belong to renderer main.

In the one-second bin starting two seconds after renderer capture start, there are no pointermove/click/keydown/input/wheel dispatches, yet 59 PageAnimator calls, 118 Paint events and 12.9 ms of FunctionCall time. Bins at 13 and 15 seconds also have no such input and 60 animator calls. These are nominally quiet intervals, not proof all prior transitions or async work have settled. The capture has interactions elsewhere and no controlled hidden-tab comparison.

Renderer Compositor thread (1184/2408) records 436.3 ms of RunTask durations; GPU-process CrGpuMain (6000/5996) records 10.4 ms; VizCompositorThread (6000/6696) records 17,228.8 ms. These are wall-duration trace slices, not CPU utilization or GPU hardware execution time; waits and shared browser work can contribute. Do not convert them to utilization percentages or attribute the shared GPU process entirely to Login. The capture lacks detailed attribution needed to explain the long Viz work. Renderer painting, raster/composition and GPU execution remain distinct measurements.

## Mounted tree and continuous-source inventory

`main.tsx` → StrictMode → StanzaPreferencesProvider → App → ThemeProvider → LanguageProvider → App wrapper → AuthShell → FingerprintCanvas + Login. Login mounts static branding/icons, PWA affordance and conditional dialogs; pending session/navigation replaces Login with AuthTransitionLoader. App also mounts DemoNoticeModal (null when closed) and an update notice only when a worker update is waiting. Dashboard, lanyard, recognition components and Signup are not part of settled Login's rendered tree merely because their types/lazy imports exist.

| Source / location | Mechanism and expected rate | Untouched / hidden behavior | Work |
|---|---|---|---|
| `FingerprintCanvas.tsx:68–80,137–261`; `dev-login-canvas-scheduler.ts:18–48` | Canvas ambient drawing; current recursive RAF at display rate. Optimized idle timer targets 24 FPS, then waits for RAF; observed ~20 FPS on 60-Hz display. Non-idle pulse states use display cadence. | Continues untouched while visible. Explicit visibility handler cancels RAF **and** optimized timer; hidden guards prevent drawing; returns on visibility. | JS Canvas2D drawing, raster/paint and composition of the updated surface. |
| `FingerprintCanvas.tsx:102–131` | ResizeObserver resizes backing store using devicePixelRatio; MutationObserver reads palette on root class/theme/preset/intensity/style mutation. | Event-driven, not polling. Source has no observer feedback writer to the observed root. Resize dimensions are written on size changes; trace showed only four canvas observer callbacks. Hidden draw scheduling is guarded. | Allocation/raster on resize; computed-style reads and requested redraw on theme changes. |
| `StanzaFingerprintLoader.tsx:22–31`, `StanzaFingerprintMark.tsx:39–50`, `index.css:493–565` | Loading shell: 1.05-second infinite transform/shadow animation; SVG grooves: 1.05-second infinite opacity/stroke-dashoffset, staggered 45 ms. Success variants are finite. CSS sampled at display cadence. | Only pending login/AuthTransitionLoader, not ordinary idle Login. If a request remains loading, repeats untouched. No app visibility handler; Chrome can suppress hidden rendering, timeline can advance. | Paint (shadow/stroke) and composition (opacity/transform), no per-frame application JS. |
| Login static fingerprint at `Login.tsx:404`, PWA mark at `PwaInstallPrompt.tsx:91` | `StanzaFingerprintMark` defaults `animated=false`. | No continuous animation. | Static SVG; no SMIL `<animate>`/SVG render loop. |
| `Login.tsx:402,644–645`, `index.css:475–491` | Card entrance 180 ms; recovery overlay 120/160 ms. | Finite mount animations, not an idle loop. Browser hidden rendering suppression, no explicit pause. | Opacity/transform composition and possible layer/raster setup. |
| `App.tsx:273`, `index.css:302`, Login control transition classes | CSS transitions on changed values; inherited/retargeted color activity exists in trace. | Not an unconditional timer; can prolong page animation while completing/retargeting. User's off A/B did not improve power materially. | Style/paint and browser animation service; kept as context, not primary target. |
| `ThemeContext.tsx:26–32`, `LanguageContext.tsx` provider effect, `StanzaPreferencesContext.tsx:184–205`, `public/stanza-bootstrap.js` | Preference-driven class/data/token/dir changes; startup initialization. | No RAF/interval loop. No evidence of a continuously written auth/theme variable. Bootstrap executes once. | Occasional style/layout/paint. |
| `Login.tsx:172–175`, `AuthShell.tsx` auth-state attribute, App pulse completion | Pulse state effect on state/callback changes; success/error completes once. | No per-frame React state update. Auth session restoration/preload/navigation waits are one-shot, not idle polling. | Event-driven React/style work. |
| PWA prompt/hook, PrivacyPolicyModal, DemoNoticeModal, service-worker handlers | Install, media-query, storage, online/offline, keyboard and worker event listeners. Dialogs are conditional. | No recurring timer or animation loop in these components. Static full-screen backdrop blurs when dialogs open. | Event-driven rendering; backdrop filtering can amplify an animation beneath. |
| `BrandWordmark.tsx:12`, Login card shadows and surfaces | Static drop-shadow, box-shadow, translucent colors. | Not clock sources. Can increase rendering cost when inputs/underlying pixels change. | Raster/filter/composition candidates. |
| `dev-performance.ts:191–235,336–342` | Explicitly armed benchmark collects display-rate RAF; ordinary measured actions schedule two RAFs plus one settle timeout. | Benchmark-only bounded loop; no default idle sampling. RAF background-throttled, no separate explicit hidden cancellation. | Measurement JS/observers; not ordinary idle work. |
| `use-demo-motion.ts:86–117`, `use-login-card-effects.ts:46–83` | Opt-in toggle traces sample geometry/styles for 350/400 ms. Optional max-height ResizeObserver reacts to size changes. | Finite after toggle, not idle; no per-frame provider. Leave trace flags absent during A/B. | Measurement style/layout reads and RAF. |
| `login-transition-test.ts:25–87` | Explicit Console `start()` samples at RAF for 1–10 seconds. | Dormant unless invoked; static-auth does not install this recorder. Never run during CPU A/B. | Measurement-induced JS/style work. |
| Canvas measurement/cadence counters | Increment counters inside existing callbacks; bounded storage. | No extra clock source. | Small JS overhead; disappears with canvas unmount. |

No other steady Auth RAF/interval, WAAPI animation, SMIL animation, animated gradient/background-position, animated pseudo-element, IntersectionObserver loop, or animation-library provider was found in this mounted source tree. The installed animation dependencies do not imply an active Login loop. No CSS keyframe animations begin in this capture's Animation records; they identify transitions, predominantly color. Already-running animations could predate a recording, so source mount conditions still matter. Native caret blinking, browser extensions and DevTools may add work outside this inventory.

## Composition relationship

AuthShell establishes `isolate`; a fixed `inset-0` canvas layer sits at z-0 beneath the z-10 content container. FingerprintCanvas is opaque Canvas2D (`alpha:false`), sized using full devicePixelRatio. Toolbar `Login.tsx:361` has backdrop-blur-md and translucent fill; main card `:402` has backdrop-blur-xl and translucent fill. Privacy/PWA/Demo dialogs can add full-screen backdrop-blur-sm; recovery adds a smaller backdrop filter. Static branding has a drop shadow. No animated Auth mask or blend-mode layer was found.

This is a plausible amplification path: an updated large backing surface can require raster/composition and resampling through translucent/filtered overlays even with low main-thread callback time. The prior individual blur tests did not solve it. This investigation does not repeat them or assert a Chrome compositing defect. Removing the whole canvas plus fixed wrapper tests whether its rendering/layer relationship contributes; no-decor-motion separately retains that exact relationship.

## DEV modes and exact URLs

Reload for each mode. Use only these parameters, with no earlier benchmark/trace/isolation flags. Keep theme, viewport, zoom and open dialogs identical.

- Baseline: http://localhost:3000/?loginCanvasScheduler=optimized
- Canvas and its fixed wrapper **unmounted**, so no canvas drawing, observers, backing surface or canvas layer: http://localhost:3000/?loginCanvasScheduler=optimized&loginPerfTest=no-canvas
- Non-canvas Auth CSS keyframe motion disabled, including pseudo-elements and loading grooves; canvas scheduler unchanged, static styles retained: http://localhost:3000/?loginCanvasScheduler=optimized&loginPerfTest=no-decor-motion
- Combined static surface: canvas/fixed wrapper unmounted; Auth CSS animations and transitions disabled, including transitioning ancestors (not their unrelated descendants); transition recorder unavailable: http://localhost:3000/?loginCanvasScheduler=optimized&loginPerfTest=static-auth

No-decor-motion is expected to look identical on a fully settled Login with no loading indicator. A null result is useful. Static-auth's background becomes the existing Auth theme background, rather than a frozen fingerprint image. Form, theme, validation, modal controls and authentication remain functional. A one-shot 150-ms DEV pulse completion callback replaces the missing canvas's success/error completion so authentication does not wait indefinitely. Essential asynchronous auth/PWA work remains; this is not a timer monkey-patch. No application WAAPI decorative loop needed cancellation. Do not explicitly activate other old diagnostic samplers during this comparison.

For each run warm up, then record 15 seconds untouched foreground and a separate hidden interval. Do not type, hover repeatedly or toggle panels. Record renderer and GPU-process CPU plus Windows power label, noting the latter is qualitative. Compare PageAnimator/Commit/paint cadence, main scripting and raster/compositor tracks. In no-canvas/static-auth, `document.querySelectorAll('.stanza-auth-shell canvas').length` must be zero. Use `document.getAnimations()` once outside the capture to inspect any residual animations. Revert by removing loginPerfTest and reloading; nothing is persisted.

If only canvas removal improves power, investigate canvas/raster/composition before assuming JS drawing is the entire cost. If no-decor-motion improves it, identify the active CSS animation and mounting state. If static-auth is still heavy, first verify zero canvas/no active visual animations, then examine browser/extension/shared GPU work and remaining rendering; do not infer a lanyard cause.

## Changes and validation

Changes this turn: `src/components/AuthShell.tsx`, new `src/components/dev/login-perf-test.ts`, new `scripts/login-perf-isolation-test.ts`, and this report. Previous diagnostic edits are retained. No production optimization, Dashboard/Geo change, or Git state mutation.

The new test renders the actual bundled AuthShell in all modes, confirms that forms remain and the canvas/fixed wrapper disappear only as requested, checks CSS mode separation, and verifies production ignores diagnostic query strings. This is structural/lifecycle wiring validation, not a Chrome power benchmark. Real-Chrome A/B results for these new modes remain pending the user's testing.

Passed: `npx tsx scripts/login-perf-isolation-test.ts`, `npx tsx scripts/login-canvas-scheduler-test.ts`, `npx tsx scripts/auth-idle-isolation-test.ts`, `node --jitless --max-old-space-size=4096 node_modules/typescript/bin/tsc --noEmit`, `npm run build`, and whitespace checking of the edited AuthShell. Production JS was searched and contains none of `loginPerfTest`, `loginTransitionTest`, `loginCanvasScheduler`, or the transition recorder global. Existing Lexical annotation/large-chunk build warnings remain. Build regenerated ignored dist artifacts.
