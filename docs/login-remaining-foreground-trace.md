# Remaining foreground work: production trace 20260925T212207

## Conclusion and confidence

The new trace proves that lowering canvas cadence did not lower all frame production: approximately 20 canvas RAF callbacks/sec coexist with approximately 60 renderer commits/sec in multiple Login intervals. The largest measured CPU-thread consumer is Chrome's GPU-process **VizCompositorThread**, followed by renderer main. This is browser rendering work, not evidence of a second expensive application JS loop. The exact native Viz operation is not exposed by this trace's generic RunTask slices, and the GPU process is shared.

A newly implicated first-party mechanism is the **9999-second autofill background-color transition** in `src/index.css:624` (also 643, 656, 678 for other autofill selectors). The trace contains long background-color animations on Login inputs, including one running from 4.718 to 23.623 seconds (18.905 seconds), with others restarted/cancelled. Their times are trace lifetimes, not the configured full duration. This warrants a narrow test; it does not prove they account for all Viz cost.

This differs from the previously deprioritized short color-transition spam. The old transition-off/static-auth diagnostic emitted unlayered `transition:none !important` rules. The autofill transition is `!important` inside `@layer base`: important layered declarations outrank important unlayered declarations. Consequently those tests did not establish that these particular transitions were disabled. The new test uses the same base layer with greater specificity and an on-demand computed-duration audit. No permanent CSS/theme change is made.

## Trace and measurement method

Input: `C:/Users/10/Downloads/Trace-20260925T212207.json`, recorded URL `http://localhost:4173/`. Renderer 13348, main thread 20524; 35.001 seconds. Source bundle `index-4y680VBq.js` existed locally before builds in this investigation.

The callback at one-based line 105/column 273443 is verified by generated body as the production scheduler's RAF wrapper (`createCanvasCadence`): it clears RAF, checks hidden/disposed, saves the timestamp and invokes draw. The callback at 273690 is its idle timer, which enqueues RAF. There are 834 scheduler RAF calls (506.08 ms inclusive) and 667 idle timer calls (31.54 ms). The full capture has 853 FireAnimationFrame events, 2071 PageAnimator events and 2073 main Commit events. Some loading periods legitimately run faster, so the whole-capture RAF average is not an idle rate.

All figures below use complete trace events. RunTask duration (`dur`) measures elapsed time; recorded thread duration (`tdur`) is the CPU-thread-time estimate. Nested events are not added to RunTask totals. For window boundaries, intersecting RunTask wall spans are clipped and thread time prorated at the boundary. This small boundary approximation is not an OS-wide CPU percentage. Exclude the first two seconds, including initial profiling overhead.

### Process/thread accounting, seconds 2–35 (33 seconds)

| Thread/work | Recorded thread time | Mean ms per second | Interpretation |
|---|---:|---:|---|
| GPU process 6000 / VizCompositorThread 6696 | 20,891.86 ms | 633.1 | Largest recorded thread load; about 63% of one CPU-thread equivalent, not 63% GPU utilization |
| Renderer 13348 / CrRendererMain 20524 | 8,128.40 ms | 246.3 | Second largest; rendering commits dominate over JS |
| Renderer raster workers, RasterTask only | 1,247.74 ms | 37.8 | 7,330 tasks; sum across workers, separate from main |
| Browser 2068 / CrBrowserMain 1928 | 796.14 ms | 24.1 | Smaller; shared browser work |
| Renderer / Compositor 15496 | 512.21 ms | 15.5 | Much smaller than Viz |
| GPU process / CrGpuMain 5996 | 17.40 ms | 0.53 | Small in captured categories; not a hardware-GPU busy-time metric |
| Renderer / ServiceWorker thread 23856 | 3.38 ms | 0.10 | Negligible; request-driven activity |

This capture contains navigation/loading and Signup activity toward the end. Treat whole-capture results as mixed Auth activity, not 33 seconds of untouched Login. After two seconds, the longest gap between selected input events is only 1.026 seconds; a long clean idle interval is missing.

### Lower-input Login intervals

Seconds 11–13: 39 RAF callbacks, 120 Commit events, 148 Paint events. Main FunctionCall time 32.79 ms, Commit time 280.77 ms, main RunTask thread time 355.03 ms, Viz thread time 1082.54 ms. Service worker: zero tasks. A long input background-color transition remains active in this interval.

Seconds 26–27: 20 RAF callbacks, 60 commits; 18.24 ms FunctionCall time, 165.44 ms Commit time, 216.42 ms main thread time, 534.35 ms Viz thread time; service worker zero tasks. An input background-color transition is active; finite panel transitions also overlap, so this is not a pure idle sample.

Associate events by consecutive PageAnimator timestamps: 81 of 120 commits in seconds 11–13 occur in cycles without a FireAnimationFrame callback; 40 of 60 in seconds 26–27 do likewise. Across the capture there are 1228 such commits. This is temporal evidence that commits continue between canvas redraws, not a native causal stack for each commit.

Paint target counts over the full capture include 1476 `#document`, 1106 Login-card, 124 Login-toolbar and 80 Signup-card paints. Paint targets locate affected surfaces; they do not by themselves identify the frame requester. No further blur/layout isolation is introduced.

## Service worker, extensions and global sources

The service worker has 33 RunTasks totaling 3.80 ms elapsed / 3.43 ms thread time over the full capture. Three FunctionCalls map to `public/service-worker.js:141`'s fetch listener at 13.281, 14.248 and 14.977 seconds, totaling 0.726 ms. There is no recurring worker activity in the lower-input windows. The source has install/activate cache setup, user-requested SKIP_WAITING and fetch handling. Static cache revalidation runs in response to a fetch; it is not a timer/polling loop. No update-check interval or foreground message loop exists in the worker or registration path (`src/main.tsx`).

Visible extension FunctionCalls total only 5.718 ms across the entire trace: React DevTools extension 211 calls / 4.673 ms; extension bgnkhhnnamicmpeenaelnjfhikgbkllg 21 calls / 1.045 ms. This does not implicate extension scripting as the dominant cost. Native extension/browser effects or other contexts are not fully excluded by these samples. `handleWindowMessage_` with an empty URL cannot be assigned confidently to Stanza.

Current mounted-tree audit:
- FingerprintCanvas / login-canvas-scheduler: the known idle timer + RAF, display-rate active pulses; visibility cancels both. Theme/resize observers are event-driven, not a second clock.
- AuthShell: no RAF, timer or observer after prior diagnostic cleanup.
- Login: one-shot demo submit; online/offline listeners and state-driven auth requests, no periodic idle polling.
- App: initial session fetch, one-shot 700-ms Signup preload, event-driven navigation delay/pulse completion, service-worker event listeners. No auth/session polling interval.
- Theme/Language/StanzaPreferences providers: preference/storage-driven class/data/token changes; no idle clock or per-frame store updates.
- PWA store: useSyncExternalStore listeners publish only on install/media-query events; no polling.
- API helper: one fetch per call, no retry timer or loop.
- Ordinary fingerprint marks and branding: static SVG. Fingerprint loaders have conditional 1.05-second infinite CSS animations during pending requests. They appear in this trace around loading activity, not continuously across the low-input windows.
- CSS autofill background transition: 9999 seconds, browser animation work without JS callbacks; the new narrow suspect.
- DEV telemetry is absent from the normal production bundle. No additional production WAAPI loop, clock component, IntersectionObserver loop or global animation provider was found in the mounted tree.

## Next narrow A/B, not a permanent fix

A new **optional production diagnostic** is enabled only at build time:

```powershell
$env:STANZA_LOGIN_AUTOFILL_DIAGNOSTIC='true'
npm.cmd run build
Remove-Item Env:STANZA_LOGIN_AUTOFILL_DIAGNOSTIC
npm.cmd run preview -- --host 127.0.0.1 --port 4173 --strictPort
```

If preview is already running, do not start another listener; reload after building.

- Baseline: http://localhost:4173/?loginAutofillTest=baseline
- Autofill transition disabled: http://localhost:4173/?loginAutofillTest=off

Use the same saved-credential autofill state, theme, viewport and browser profile. Do not submit credentials. Once the Login surface and autofill have settled, run `window.__STANZA_AUTOFILL_AUDIT__()` once. Confirm baseline autofilled inputs expose the long transition, while off reports `transitionProperty: none` and duration zero, and no long input background transition remains in its animation list. If no inputs are autofilled, this test does not exercise the suspect. No input values are collected.

Close DevTools, wait five seconds, then measure 15 seconds with no mouse/keyboard interaction. Repeat each mode at least twice. Record CPU/power and, separately, short traces containing a clearly untouched interval. Compare canvas cadence (~20), Commit cadence, main thread time and Viz thread time. The diagnostic audit has no timers, observers, RAF or automatic sampling; getComputedStyle/getAnimations run only on explicit invocation outside the measurement. It changes only autofilled Auth input transitions, not their declared backgrounds, shadows, text, layout or the canvas scheduler.

If disabling the confirmed long transition makes extra commits/Viz work disappear, that establishes its contribution. If it does not, do not alter the autofill styling: compare this same production URL against a blank tab in a separate Chrome profile with extensions disabled, keeping window size and hardware acceleration unchanged. Detailed browser/Viz native tracing would then be needed because these generic RunTask slices cannot name the expensive native operation.

Normal build restoration:

```powershell
$env:STANZA_LOGIN_AUTOFILL_DIAGNOSTIC='false'
npm.cmd run build
Remove-Item Env:STANZA_LOGIN_AUTOFILL_DIAGNOSTIC
```

## Change scope and verification

Modified only diagnostic bootstrapping: `vite.config.ts`, `src/vite-env.d.ts`, `src/main.tsx`. Added `src/diagnostics/login-autofill.ts`, `scripts/login-autofill-diagnostic-test.ts`, and this report. Existing production scheduler/artwork/CSS and other app behavior are unchanged. No Git mutation.

The diagnostic test passes: baseline makes no style writes; off emits a selector limited to autofilled Auth inputs in the correct layer; neither installation nor idle operation reads styles or schedules work. TypeScript passed. Normal production build passed and its asset scan excludes the diagnostic query/global/style marker. Diagnostic production build is separately checked for inclusion and absence of DEV instrumentation. The user's new A/B, not these build checks, must settle causal attribution.

Final verification: diagnostic build passed, includes `login-autofill-C7EHJmBk.js`, and excludes the old canvas production diagnostic keys, Vite client and React Refresh markers. HTTP GET of `http://localhost:4173/` returned 200 and its HTML matches the current diagnostic build. `git diff --check` passed. Existing scheduler-task working-tree changes were preserved; this investigation adds only the six diagnostic/report files listed above.
