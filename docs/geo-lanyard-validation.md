# Geo × lanyard and control validation — 2026-09-06

Continued the existing unstaged tree. No staging, commits or other Git mutations. This investigation was limited to the five requested modules, Geo surfaces, stretch distance and the specified controls.

## Findings and limits

The reported real-Chrome Geo slowdown was **not reproduced reliably** by the available in-app Chromium measurements. Geo has a materially different surface structure from Session Center: a 1225 × 1096 px rounded, overflow-clipped wrapper with backdrop blur(8px), a large shadow, a full-size tinted overlay and nested translucent panels. Session Center's observed 1240 × 520 px wrapper has a shadow but no backdrop blur, and its internal section is transparent without clipping or positioned stacking layers. The backdrop/clipping/overlap combination is the strongest structural candidate; it is not a proven performance cause.

The transparent WebGL canvas covers the viewport in every module; stretching does not resize that canvas. A moving badge/rope can change the screen-space region needing composition, but no GPU damage-region trace or Chrome process CPU measurement was available. CSS inventory identifies potential stacking/compositing triggers, not actual GPU layer allocation. No permanent Geo simplification, lanyard solver tuning, geometry/texture change, drag-range restriction or automatic Chromium adaptation was applied.

## Method

1280 × 720 in-app Chromium, Custom #6366F1, light mode, full/Auto quality unless stated otherwise. Modules were opened once to warm imports, switched away and revisited before measurement. Tests use the existing dev capture and actual lanyard advance/render/physics probes. Drag path: approximately (35,440) → (300,440), a short automated gesture followed by the capture's two-second settling window. This samples wake/release/settling; it is **not** a sustained five-second held drag or a smoothness/input-latency verdict. Manual Chrome testing must repeat sustained and extreme drags at matching size.

Idle/disabled captures were about 5.3 seconds; the first Geo idle capture was 22 seconds due to tool overhead. Subsequent drag captures were about 2.5 seconds. The panel's `twoFramePaintMs` is a capture-start two-frame baseline, not isolated input-to-paint latency. Its display RAF count is separate from actual lanyard render count. DOM totals include the open diagnostic UI and growing timeline, so small differences are instrumentation noise.

A delayed tutorial intercepted the first no-filter drag: zero pointer/wake/render samples proved it invalid. That result was excluded. The tutorial provider was then disabled through the existing development switch for controlled isolation repeats. Earlier captures were not all taken with this switch disabled; their observed zero running animations does not exclude static overlay interference. A browser/server restart separated Profile and later experiments from the initial four-module matrix. These limitations prevent causal ranking from small timing differences.

## Cached module × lanyard matrix

`L` is actual lanyard renders (advance and frame counters agreed). `P` is observed Rapier steps. Paint/worst are milliseconds. `Display` is diagnostic RAF count, not lanyard frames.

| Module | State | L / P | End tier | Paint | Worst display interval | Display | DOM before → after | Mutations |
|---|---|---:|---|---:|---:|---:|---|---:|
| Geo | settled | 0 / 0 | settled | 28.7 | 17.0 | 1321 | 514 → 514 | 0 |
| Geo | short drag | 59 / 135 | passive | 20.9 | 17.3 | 152 | 525 → 525 | 10 |
| Geo | disabled | 0 / 0 | unmounted | 23.1 | 17.0 | 321 | 524 → 524 | 0 |
| Session Center | settled | 0 / 0 | settled | 24.3 | 16.9 | 320 | 709 → 709 | 0 |
| Session Center | short drag | 59 / 134 | passive | 20.4 | 16.9 | 151 | 714 → 714 | 10 |
| Session Center | disabled | 0 / 0 | unmounted | 22.5 | 17.1 | 320 | 710 → 710 | 0 |
| Hiring | settled | 0 / 0 | settled | 27.0 | 17.0 | 320 | 797 → 797 | 0 |
| Hiring | short drag | 57 / 131 | passive | 21.0 | 16.8 | 150 | 802 → 802 | 10 |
| Hiring | disabled | 0 / 0 | unmounted | 26.4 | 16.9 | 320 | 798 → 798 | 0 |
| Weekly Roster | settled | 0 / 0 | settled | 22.4 | 17.0 | 321 | 772 → 772 | 0 |
| Weekly Roster | short drag | 59 / 134 | passive | 16.8 | 16.9 | 151 | 774 → 774 | 10 |
| Weekly Roster | disabled | 0 / 0 | unmounted | 24.2 | 16.9 | 320 | 769 → 769 | 0 |
| Profile | settled | 0 / 0 | settled | 27.8 | 17.3 | 320 | 2949 → 2949 | 0 |
| Profile | short drag | 60 / 140 | passive | 22.3 | 33.2 | 157 | 2954 → 2954 | 10 |
| Profile | disabled | 0 / 0 | unmounted | 27.6 | 16.8 | 320 | 2952 → 2952 | 0 |

All rows: measured React render delta 0, long-task count/duration 0, active CSS animation count 0. Canvas count remained one for settled/drag and zero for disabled. Each valid drag recorded exactly one wake. Display sampling was near 60 Hz, except the isolated 33.2 ms Profile interval. The existing capture reported handler/Event Timing count and duration 0 throughout: lanyard pointer handling is separately counted, so these zeros do not establish zero pointer-handler cost or latency. No resource loads occurred in drag rows. One resource arrived in Hiring's idle row; imports were not the comparison stimulus.

Later visible-surface inventory (tutorials off; counts exclude the diagnostic panel, but include browser overlays):

| Module | Backdrop | Filter / blur | Mask | Shadow | Transform | DOM |
|---|---:|---:|---:|---:|---:|---:|
| Geo at top | 1 | 3 / 2 | 1 | 4 | 3 | 557 approximately |
| Session Center | 0 | 3 / 2 | 1 | 2 | 0 | 712 |
| Hiring | 1 | 3 / 2 | 1 | 5 | 0 | 827 |
| Weekly Roster | 2 | 3 / 2 | 1 | 4 | 1 | 775 |
| Profile | 1 | 3 / 2 | 1 | 2 | 1 | 3038 |

The shared atmosphere explains much of the common filter/mask count. Each had two fixed surfaces, no visible sticky surfaces and no mix-blend, isolation, perspective, clip-path or will-change flags in this audit. More DOM or more backdrop surfaces alone did not predict worse short-drag cadence.

## Geo surface inventory and experiments

Observed Custom light-mode major panels:

- Perimeter wrapper: 1225 × 1096, relative, overflow hidden, rounded corners, backdrop blur(8px), large 20/25 px and 8/10 px shadow components. Opaque derived base plus a full-size translucent tinted overlay.
- Clock In area: 1191 × 360, positioned above overlay, overflow hidden, derived surface at .88 alpha. Circular control uses a semantic accent gradient and bounded glow/shadow, with transform feedback. Idle state has no continuous animation.
- Request Break / Break Status: each 590 × 289, .88-alpha derived surfaces, no own filter/backdrop/mask or large shadow. Nested inputs and status cards add overlap.
- Approval queue: 1191 × 131; locations: 1191 × 165. Both positioned, .88-alpha derived surfaces, no own blur/mask/shadow. Locations includes another translucent card.
- The inspected major panels have no generated ::before/::after content. None is sticky/fixed. The shared page atmosphere/topography and fixed transparent canvas sit outside these panels.

Geo experiments, same approximate medium gesture:

| Variant | L / P | Paint | Worst display interval | Finding |
|---|---:|---:|---:|---|
| Current repeat | 58 / 133 | 21.4 | 16.9 | baseline |
| Opaque panels | 59 / 135 | 22.8 | 16.9 | no clear improvement |
| No large shadows | 59 / 134 | 21.7 | 16.9 | shadow count reduced; no clear improvement |
| No filters, valid repeat | 59 / 135 | 23.0 | 17.0 | Geo backdrop count 1 → 0; no clear improvement |
| No topography | 58 / 133 | 22.2 | 17.5 | mask count 1 → 0; no clear improvement |
| Flat Geo background | 58 / 134 | 30.6 | 16.8 | glows/mask removed; one resource arrived; no clear improvement |

All valid experiment rows had one wake, 10 mutations, zero measured React rerenders/long tasks, and ended passive. Removing an effect was verified through computed surface counts. Results do not justify production simplification.

## Stretch and 45/20 profile

Horizontal targets 110, 300 and 780 px represent about 75, 265 and 745 px pointer movement. The long target is within the viewport; it is not proof of the maximum physically reachable stretch. The source has a fixed joint graph (four rope joints plus the card connection), a kinematic drag target and one fixed-step world. Distance does not create constraints or select extra substeps.

| Movement | Renders / physics steps | Mean physics step | Mean render submission | Max physics step |
|---|---:|---:|---:|---:|
| Small | 58 / 133 | .0398 ms | .276 ms | .20 ms |
| Medium | 58 / 133 | .0406 ms | .284 ms | .20 ms |
| Long | 58 / 133 | .0406 ms | .222 ms | .20 ms |

All three had one wake and a 16.9 ms worst display interval. No dramatic solver escalation appeared. These CPU submission/step timings exclude GPU execution. Long sustained holds and offscreen extremes remain manual checks; there is no evidence supporting a drag clamp or solver modification.

Lightweight Geo: 50 renders / 136 physics steps, paint 22.8 ms, worst display interval 19.6 ms. Lightweight Session Center: 50 / 132, paint 22.6 ms, worst 18.4 ms. Mean render submission .222/.246 ms and mean physics step .0426/.0348 ms respectively. Both had one wake, no long tasks/rerenders and ten mutations. Lower rendering frequency is verified, but a visual-quality or CPU improvement is not. Auto remains full 60/24; 45/20 stays development-only. No 50 FPS promotion or UA classification change.

## Exact black-flicker controls

User confirmed **Clock In** and **Request Break** in Geo Operations. They now have stable `data-geo-interaction` selectors. The dev panel applies current, no-transform, opaque-parent, no-backdrop, no-transition, no-shadow and no-pseudo modes directly to these controls/their actual Geo ancestors. Both controls were exercised with press-and-cancel (release outside) to avoid submitting attendance/break actions. The sampled computed fills remained the Custom semantic gradient with white text; no opaque-black state was demonstrated. Immediate post-mode-change reads can still catch a transform transition in flight, so allow it to finish before judging the variant.

No variant demonstrably eliminated a reproducible flash in this environment. Existing business state remained unchanged. The smallest effective real-Chrome fix is still unknown. No generic black override, blanket will-change/translateZ or speculative permanent transform removal was added.

For manual reproduction: open Perf → Real Geo button experiment. Optionally enable **Capture real Geo control styles**, perform the actual problematic press, then Refresh metrics and inspect **Real Geo control frame samples**. This reuses the bounded 12-frame sampler and 240-sample cap, now on the real controls. It detaches when the panel closes or the module changes; keep it off for performance comparisons. Surface modes are Geo-only and removed on module change. All new diagnostic UI is excluded from production.

## Visual fixes

Add Passkey previously used hard-coded Emerald utility colors; it now uses `stanza-primary-action stanza-theme-primary` with semantic foreground, accent gradient, hover, focus, press and disabled opacity/cursor. Disabled primary hover no longer changes the background. The native authenticator action and disabled conditions are unchanged.

Close controls now use `stanza-close-action`: transparent default/hover/press background, muted default X, semantic accent on hover, glyph scale 1.08 hover / .97 pressed, 140 ms transform/color transition and semantic focus outline on the stationary target. Reduced motion disables scaling/transitions. Launcher, Settings, tutorial, mobile shortcuts, command palette, Privacy, Demo Notice and crop-dialog X controls share the class; destructive/unpin X actions were not changed. Settings retains a 64 × 40 target to avoid reducing its former text Close hit area; other targets keep their existing sizes (the tiny Demo Notice target was enlarged).

Live checks covered all eight themes in light/dark: Add Passkey retained enabled primary styling and preset-specific gradient/foreground; every inspected Settings X background was transparent. Custom light used #5659D2/#4F52C1 with white; Custom dark used #8C8EF5/#9597F6 with black. A live Custom-dark X hover returned transparent background, accent rgb(140,142,245), matrix scale 1.08; keyboard focus returned a 2 px solid semantic ring. Existing Custom contrast tests still report minimum button 4.88:1 and text 4.60:1 across 20 palettes. Original preset snapshots, selected navigation and semantic status contracts remain intact. No passkey was registered during visual testing.

## Validation and files

Changed this continuation: Dashboard.tsx; index.css; navigation/DashboardNavigation.tsx and MobileShortcutEditor.tsx; command-palette/CommandPalette.tsx; tutorials/TutorialOverlay.tsx; DemoNoticeModal.tsx, PrivacyPolicyModal.tsx, ProfilePhotoCropDialog.tsx; dev/PerformanceIsolationPanel.tsx and performance-isolation.css; lib/dev-performance.ts; scripts/theme-test.ts, tutorials-test.ts and performance-test.ts; this report. The larger working-tree diff includes preexisting work from earlier tasks.

Validation: lint, build, performance (110), navigation, theme, tutorials, PWA, security, audit (13), sessions (6), HR background and lanyard tests passed. Added focused semantic Passkey/transparent X tests and strengthened production diagnostic exclusion. The old tutorial assertion requiring stanza-icon-action was updated to the new close class. Task-file whitespace checks passed. Existing warnings remain: development CSP disabled, credentials absent for optional authenticated security fixtures, vendor Lexical PURE annotations/large chunks, and R3F's THREE.Clock deprecation in the scheduler test.

Real Chrome/Edge sustained drag, GPU/renderer process CPU, damage/layer tracing, transient black-flash recording and Firefox visual parity remain required before claiming the performance/flicker root cause is resolved. No CPU improvement is claimed.
