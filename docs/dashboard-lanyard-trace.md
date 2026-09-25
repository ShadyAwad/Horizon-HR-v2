# Dashboard lanyard trace investigation — 2026-09-18

Scope: `C:/Users/10/Downloads/Trace-20260918T105256.json`, Dashboard/Geo Operations. This does not explain Login. No production optimization, quality change, Geo styling change, or Git mutation is part of this investigation.

## Trace evidence

Renderer main is PID 19412 / TID 7192. Its complete-duration event span is 5.132 seconds (approximately 5.16 seconds for the profile capture). Inclusive totals reproduced from the trace:

| Event | Count | Total ms |
|---|---:|---:|
| RunTask | 1793 | 1465.004 |
| Commit | 125 | 554.662 |
| FunctionCall | 1854 | 386.079 |
| FireAnimationFrame | 61 | 123.446 |
| Layout | 27 | 68.621 |
| EventDispatch | 437 | 53.095 |
| Paint | 118 | 19.891 |
| pointermove dispatch | 74 | 11.849 |
| mousemove dispatch | 74 | 3.088 |

These categories nest: **do not add their durations**. `Commit` here is Chromium rendering/compositor work, not a React component commit count. The trace does not establish per-pointer React rerenders or identify the Canvas as the sole source of Commit work.

The recurring `w` at `StanzaDashboardLanyard-C-AHWVUl.js:4265:2265896` maps directly to **`createLanyardFrameScheduler`'s `tick`**, `src/components/lanyard/lanyard-frame-scheduler.ts:57`. The exact local dist asset matched the trace URL when inspected (SHA256 `9086cc259debbc2788a5c4ae39bd77e82ad757c29b66fbb37ed3f0bb96119d03`). Mapping used the scheduler's distinctive deadline guard, cumulative simulation time, `advance`, and rescheduling body; no source map was available.

Its 49 calls total **112.722 ms**, median **0.950 ms**, maximum **48.224 ms**. First-to-last invocation spans 3.020 seconds. This is inclusive of R3F subscribers, Rapier and rendering reached through `advance`, not 112 ms of timer bookkeeping. Early deadline returns mean callback count is not necessarily actual rendered-frame count.

CPU-profile samples falling inside these tick spans include approximately 18.4 ms in Three `WebGLProgram.onFirstUse` (program/shader status work), 14.0 ms in `WebGLState.texSubImage2D` (texture upload), and 1.8 ms directly in the application's Band frame callback, plus WebGL state, WASM and other work. Sampling estimates are not exact instrumented function durations. The longest tick also includes V8 compilation/deoptimization and GC activity. Startup/load events are present: this is not a clean, warmed steady-interaction capture.

The main bundle's `Ce` (`index-D9jEngYG.js:26:1357`) maps to React scheduler task processing: 43 calls / 166.591 ms. Its other calls include React commit machinery. The bundle name alone cannot attribute all those tasks to R3F. Separately, the CPU profile includes about 65.7 ms sampled in React DevTools extension `measureHostInstance`; repeat with that extension disabled to separate measurement overhead from app cost.

## Source audit and ranked suspects

| Rank / source | Work and activation | Smallest useful isolation |
|---|---|---|
| 1. Manual frame path: `lanyard-frame-scheduler.ts:58–70`, `Lanyard.tsx:378–390` | Trace-confirmed recurring work; `advance()` executes subscribers and rendering. One large initialization outlier matters. Does not prove physics dominates sustained interaction. | Completely unmount with `stanzaLanyard=off`; compare warmed captures and total Main-thread time. |
| 2. Large transparent WebGL surface: `StanzaDashboardLanyard.tsx:86–100`, `Lanyard.tsx:237–268` | Canvas covers its Dashboard container, despite the badge occupying a small area. Alpha composition and antialiasing can amplify costs when frames change. Commit attribution to this surface remains unproven. | Same unmount A/B, then inspect compositor/layer tracks if Commit time falls. Do not equate GPU Process CPU with GPU utilization. |
| 3. Physics and rope: `Lanyard.tsx:273`, `:842–914`, `:960–996` | Rapier follows each manual frame with fixed 1/60 steps and interpolation. Rope samples 28 spline points and calls MeshLine `setPoints` when uninitialized, dragging or any body remains awake. Five dynamic bodies plus one fixed body. | Compare existing render/advance/physics counters and CPU stacks during sustained drag; compare events-on/off with equal forced frame workload. |
| 4. Dashboard-wide R3F event source: `Dashboard.tsx:4865`, `Lanyard.tsx:259`, `:1032` | Mouse movement anywhere in Dashboard can enter R3F event processing even when frame scheduling has settled. Default Fiber recursively raycasts registered interaction objects, not DOM cards. Pointer dispatch totals are small in this trace, so it is lower priority than frame work. | `stanzaLanyard=no-events` removes R3F DOM listeners/raycasting while leaving the scene mounted. |

### Frame ownership and stationary behavior

- Canvas is **`frameloop="never"`**, not `always` (`Lanyard.tsx:257`). Only its manual scheduler advances this root. Production Full remains active 60 / passive 24 FPS; production Auto is unchanged.
- Two application `useFrame` callbacks: lifecycle at `Lanyard.tsx:325` (priority -100, DEV frame counter; no production work in its body), and Band at `:842` (drag projection, sleep/velocity checks, rope geometry, flip/rest animation and tier selection).
- Installed Rapier's `UseFrameStepper` (`node_modules/@react-three/rapier/dist/react-three-rapier.esm.js:155`) adds the physics frame callback. Physics defaults to `updateLoop="follow"` (`:772`); its independent RAF mode and Debug component are not selected here. DEV before/after-physics probes are hooks in that step, not separate RAF loops.
- A visually stationary scene may still advance at passive 24 FPS. It stops only after all five dynamic bodies sleep, card velocity is low, dragging/flipping ends, stable duration passes, and the visual pivot returns to rest. Settled, hidden or paused scenes have no scheduled frames. This is the source contract, not a newly measured Chrome idle result.
- `pointermove` does not itself always wake the scheduler: Band's handler exits without a pending drag gesture. Drag activation/down/flip, initialization, artwork/anchor changes and context restoration can request frames. Hover updates local React state and the body cursor; it does not directly request active frames. The supplied trace alone does not prove ordinary hover repeatedly wakes physics.

### Raycasting and GPU settings

One application interaction group contains four mesh descendants (badge face, edge, clip and clamp); nested groups are traversed too. The rope is a sibling without handlers. Physics colliders are not Three raycast meshes. This is the source count; the diagnostic below reports the mounted count. It does not report triangle-test count or actual hits. Installed Fiber's `intersect` / `intersectObject(..., true)` is in `dist/events-b389eeca.esm.js:586–617`, before the application's `interactionEnabled` guard.

Production DPR is explicitly **1**, antialiasing **on**, transparent context **on**, high-performance power preference requested. Ambient and directional lights exist; Canvas shadows and postprocessing are not enabled. DPR is not implicitly the display's high-DPI value. Full-container alpha/MSAA still deserve measurement; they are not proven causes merely from these settings.

## DEV-only isolation

Use the development server, retaining the same Dashboard route, theme, module and settings. Append `?stanzaLanyard=off` (or `&stanzaLanyard=off` when a query already exists) and reload. The Dashboard mount condition becomes false: the whole lazy lanyard subtree, Canvas, physics, scheduler and events are absent. This is not CSS hiding and does not save a preference.

For the second capture use `stanzaLanyard=no-events` and reload. Canvas, artwork and physics remain mounted. A custom event manager installs **no DOM listeners** and has events disabled, rather than merely returning early from mesh callbacks. The badge intentionally cannot drag or flip. Remove the parameter and reload for normal behavior. Existing capability/preferences still govern whether a lanyard mounts at all.

Run once in DevTools Console after mount:

```js
window.__STANZA_LANYARD_ISOLATION__?.()
```

Expected normal: `frameloop: "never"`, events enabled/connected, one interaction root and four mesh descendants. Expected no-events: Canvas connected, events disabled/disconnected; registered object counts can remain the same. Expected off: audit function absent and `document.querySelectorAll('[data-lanyard-canvas-surface] canvas').length === 0`. The audit reads on demand; it adds no polling or per-pointer instrumentation.

## Chrome comparison protocol

1. Reset earlier DEV GPU/visual experiments; close the diagnostic panel and disable style capture. Keep viewport/zoom and Full 60/24 constant. Use real Chrome, with React DevTools extension disabled for the primary measurement. Warm each mode until artwork is ready and loading/initial shader work has finished.
2. Record normal / no-events / off, at least three repeats each. For each capture: 5 seconds still, 10 seconds moving over the same blank area and same controls, then 5 seconds still. Keep the tab foreground. Do not drag the badge in this first comparison: no-events cannot reproduce a drag, so that would confound the result.
3. Take before/after `window.__STANZA_PERFORMANCE_DIAGNOSTICS__.snapshot().runtime` snapshots outside the timed interval. Compare deltas in `lanyardTotals`, frame tier and pending scheduler work. Totals are cumulative; the existing reset function does not reset those totals. If normal and no-events have different frame counts, their difference cannot be attributed solely to raycasting.
4. If necessary, equalize rendering in normal and no-events using the existing DEV-only 15-second active-frame experiment, separately from natural behavior. Console: `const gpu = await import('/src/lib/dev-gpu-experiments.ts'); gpu.setDevGpuExperiment({forceActive:true});`. Capture a matching 10-second interval inside that window; verify actual frame/physics deltas. This deliberately changes frame activity and must be labelled a controlled isolation, not normal idle behavior. It automatically expires after 15 seconds.
5. In Performance, compare total busy Main-thread time and long tasks; inspect Bottom-up/Call tree under `FireAnimationFrame → tick → advance` and under `Event: pointermove → handlePointer → intersect`. Separate shader/texture initialization from repeated physics, geometry and render submissions. Inspect rendering/compositor tracks for Commit attribution. These numbers overlap and must not be summed.
6. Record Chrome Task Manager's Stanza renderer CPU and shared GPU Process CPU alongside each interval. Note other visible tabs/contexts; GPU Process is shared. An RTX 5060 Ti is not representative office hardware. No acceptability or rate-policy conclusion follows from usability on this machine.
7. Only normal mode supports a separate sustained-drag capture. Record several seconds including a long stretch and release; inspect frame, physics, render and advance deltas. This locates sustained frame work but is not a like-for-like no-events comparison.

Interpretation: if no-events improves performance while frame workloads match, R3F input/raycasting contributes. If only off improves it, scene rendering/physics/composition is implicated. If both improve it, both may contribute; the size of each contribution still needs matched workloads. If neither helps, inspect the remaining main-bundle and compositor work. No permanent fix or switch to 45/20 is justified yet.

## Change scope and validation

This investigation changes only `src/pages/Dashboard.tsx` (DEV mount guard), `src/components/lanyard/Lanyard.tsx` (DEV event factory and audit registration), adds `src/lib/dev-lanyard-isolation.ts`, adds `scripts/lanyard-isolation-test.ts`, and this report. All earlier working-tree changes are outside this list.

The isolation test uses installed R3F with a stub renderer: no-events installs zero listeners while an explicit advance still runs a frame callback and renderer. It is not a browser/GPU benchmark. The supplied Chrome trace was analyzed; the new three-way real-Chrome A/B has not yet been recorded. Production visuals, rates, physics and Geo button styles remain unchanged.

Validation passed: `npx tsx scripts/lanyard-isolation-test.ts`, `npm run test:lanyard`, `npx tsx scripts/chrome-regression-test.ts`, TypeScript via `node --jitless --max-old-space-size=4096 node_modules/typescript/bin/tsc --noEmit`, and `npm run build`. Ordinary TypeScript execution failed with V8 native `Zone` out-of-memory; the same checker completed with JIT disabled. Build emitted existing Lexical annotation and large-chunk warnings. Production JS contains neither the `stanzaLanyard` query key nor the isolation audit global/text. Build regenerated ignored `dist` artifacts; no Git state was mutated.
