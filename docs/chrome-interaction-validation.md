# Lanyard, Custom theme, and interaction validation

Validated 2026-09-05 from the existing unstaged working tree. No Git state was mutated. Unrelated preexisting work was preserved.

## Lanyard scheduling

The previous outer timer did not own all frames. Installed @react-three/rapier 2.2.0 calls `invalidate()` for active rigid bodies, which lets R3F's demand loop render between the outer scheduler's deadlines. A passive/settled tier label therefore was insufficient evidence of 24/0 actual FPS; previous label-based idle claims were misleading. This does not establish that every fully sleeping scene rendered continuously.

`Lanyard.tsx` now uses Canvas `frameloop="never"` and one scheduler in `lanyard-frame-scheduler.ts`. R3F ignores invalidation for a never-loop root. Only this scheduler calls the root-bound `advance(simulationTime, false)`. There is at most one pending timer or RAF; settling, pause and disposal cancel both. The last canvas image stays mounted under Settings. No geometry, texture, DPR, antialiasing or asset-quality reductions were made.

The installed R3F 9.6.1 implementation subtracts `clock.elapsedTime` from the supplied timestamp in never mode, then assigns the timestamp back to elapsedTime. Thus the supplied value is cumulative simulation **seconds**, not RAF milliseconds. The scheduler initializes from the existing clock, advances by measured elapsed seconds while running, and retains fractional deadlines. Rapier still uses a fixed 1/60-second timestep and interpolation. Wake/resume starts with 1/60 second; subsequent deltas are bounded at 0.1 second. Ten seconds asleep or hidden are never replayed. The previous large wake delta could hit Rapier's 0.5-second clamp and produce roughly 30 fixed steps.

Pointer processing still consumes the latest position per rendered frame. An outstanding pointer gesture stays active before the drag threshold. Cleanup requests passive frames only when a real gesture ends; pointer state is cleared before releasing capture to avoid reentrant cleanup. Settings/visibility pause preserves the prior tier, so reopening a settled scene does not wake it.

### Actual frame evidence

The regression test runs the production scheduler against installed R3F createRoot/advance/invalidate with a deterministic 60 Hz display clock and a counted renderer in place of GPU hardware. Each frame issues five Rapier-style invalidations. They schedule zero bypass RAFs.

| Profile/tier | Actual renders and advances over 5 seconds | Target |
|---|---:|---:|
| Full active | 300 | 60 FPS |
| Full passive | 121 | 24 FPS |
| Lightweight active | 226 | 45 FPS |
| Lightweight passive | 101 | 20 FPS |
| Settled, each profile | 0 | 0 FPS |
| Paused, each profile | 0 | 0 FPS |

The one-frame boundary tolerance in reduced rates is expected. Simulation time remains approximately five seconds at each rate. Duplicate wake requests produce one transition. Ten-second idle/pause, settled resume, disposal and stale scheduler requests are covered. Component source contracts verify visibility/Settings wiring, fixed timestep, gesture guard and one advance site; these are not a substitute for a real browser lifecycle stress test.

In the available in-app Chromium view, a settled five-second window kept actual render/frame/advance counts at 83 and physics steps at 209; no timer or RAF was pending. A later Settings-open interval kept render/advance counts at 180, physics at 484 and wakes at 1. Closing Settings returned to settled with those exact counts and no pending timer/RAF; the canvas count remained one.

Short actual WebGL drag captures:

| Profile | Active frames / observed cadence | Passive frames / observed cadence | Physics active / passive |
|---|---|---|---|
| Full | 7 / 59.88 FPS | 51 / 24.24 FPS | 7 / 126 |
| Lightweight | 6 / 50.35 FPS | 42 / 20.16 FPS | 6 / 123 |

The lightweight active sample lasted only about 0.1 second: its 50.35 observed value is a boundary-skewed burst, not a steady 45 FPS measurement. The deterministic five-second test above verifies 45 cadence. Both browser drags recorded one wake, first delta 16.67 ms and one first physics step. Both subsequently settled. No gross rope separation, explosion or persistent runaway motion appeared in sampled views. Continuous drag smoothness, input latency and 60-versus-45 visual parity require manual Chrome verification; 50 FPS has not been evaluated because no reliable visual rejection of 45 was established.

Mean renderer CPU submission was about 0.27 ms active / 0.54 ms passive for the full short capture and 0.38 ms passive for lightweight. These are not GPU times or Chrome process CPU measurements. No CPU reduction is claimed.

Production Auto remains full 60/24 on all browsers. There is no new UA detection and no Firefox/Safari classification change. The 45/20 experiment is development-only pending Chrome/Edge CPU and visual evidence.

## Button flicker

The existing interaction lab now reproduces Settings choice classes and navigation controls with current, no-pressed-transform, no-transform, opaque-parent, no-backdrop, no-shadow, no-pseudo and no-transition variants, plus plain and parent-filter negative controls. The plain baseline explicitly excludes dashboard selection styles. Optional computed-frame capture records hover/press/focus, pseudo styles and ancestor stacking properties for a bounded interval; keep it disabled during CPU comparisons.

Across the tested local variants, no computed background became opaque black. Transparent `rgba(0,0,0,0)` is not a black painted surface. Transform-disabled variants reported no transform; short presses can sample an identity matrix before the transition progresses, while the no-transition variant captured scale(.98). Neither a transform cause nor a parent/compositor cause was demonstrated. No permanent button transform removal, black override, blanket will-change or translateZ fix was applied. Transient flicker was not reproduced in sampled in-app observations and requires manual Chrome verification.

## Login expansion

The benchmark is a docked nonmodal panel beside the actual control and resets expansion before each ten-second idle countdown. All four cases were exercised in the in-app Chromium view:

| Case | Capture two-frame baseline | Observed long tasks | Sampled black artifact |
|---|---:|---:|---|
| Current animation | 25.2 ms | 0 | Not observed |
| No animation | 26.4 ms | 0 | Not observed |
| No grid transition | 26.6 ms | 0 | Not observed |
| No opacity transition | 24.5 ms | 0 | Not observed |

These two-frame numbers are the capture's baseline, not isolated expansion latency. Capture lengths varied with automation, so total RAF samples cannot compare performance. Each run recorded seven DOM mutations. Screenshots sample the resulting expansion and cannot exclude a one-frame artifact. Retain production grid-template-rows plus opacity; no transition mechanism was implicated. Chrome and Firefox visual verification remain manual.

## Custom theme

`src/lib/custom-theme.ts` derives separate light/dark tinted surfaces and semantic accent, hover, soft/muted, border, foreground and focus colors from the saved six-digit hex. `src/components/CustomThemeEditor.tsx` provides native picker, validated hex, local live preview, Apply/blur/Enter commit, and reset. Derived display shades may change for readability; the chosen base is preserved. All seven original preset CSS rule blocks are protected byte-for-byte by `scripts/fixtures/original-theme-rules.json`, in addition to existing theme token tests. Presets retain their original order and Custom follows them.

The existing preference storage persists Custom and its normalized color. Switching Custom → Emerald → Custom restored #EC4899 in the actual Settings UI. Reset returned #6366F1 while retaining Custom. Reload persistence and invalid saved values are covered by preference contracts. Updates write a fixed set of root CSS variables; there is no DOM traversal or per-color stylesheet. Picker drags update the local preview, not storage/the whole app each frame. Separate preference effects avoid reapplying theme attributes for unrelated changes.

Tests cover #6366F1, #2563EB, #EC4899, #F59E0B, #111827, #F8FAFC, black, white, bright yellow and dark navy in both modes (20 palettes): minimum primary-button contrast 4.88:1 and text contrast 4.60:1. Semantic status tokens remain independent; scoped Settings success badges retain green. Arabic Custom, accent, reset and invalid-hex labels were verified, with computed preview direction RTL. At 390 px width the document had no horizontal overflow and the Custom preview/reset layout fit. Brand names remain unchanged.

## Files and validation

Task implementation touches Lanyard and its new scheduler; custom-theme/editor; preference/background/language/bootstrap wiring; Dashboard, Login and index.css; existing dev-performance and performance-isolation infrastructure; PerformanceIsolationPanel, GuidedChromeBenchmark, InteractionMicrobenchmark, LoginFlickerBenchmark and their diagnostic CSS; performance/theme tests, the preset fixture, the new lanyard test and its package script. This is not a claim of ownership of every file in the extensive preexisting Git diff.

Passed: lint, build, test:performance (110/110), test:navigation, test:theme, test:tutorials, test:pwa, test:security, test:audit (13), test:sessions (6), test:hr-background and test:lanyard. Production bundle checks exclude dev UI, capture markers, lanyard totals and override event names. The final source change only strengthens this bundle assertion.

Warnings: security test reports development CSP disabled and missing credentials for optional authenticated security fixtures. Build reports vendor Lexical PURE annotations and large chunks. The installed R3F test emits a THREE.Clock deprecation warning. A session test initially failed while the local server was restarting, then passed all six checks. A brittle readiness source assertion was changed to tolerate line endings and performance tests passed. Read-only git diff --check reports preexisting trailing whitespace at server.ts:3100, outside this task; it was preserved.

Manual Chrome/Edge checks: compare Auto/full and 45/20 at identical Dashboard size with Chrome renderer and GPU-process CPU recorded separately; check sustained drags, flip, release, ten-second sleep/wake, document hiding, Settings during a drag and repeated remounts. Use computed-style capture separately from CPU measurements. Reproduce button and login flicker with screen recording in each isolated variant, then compare Firefox before promoting a production visual change. Test 50 FPS if sustained 45 FPS is visibly worse. No real Chrome process CPU measurement or Firefox run was available here.
