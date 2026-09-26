# Login commit causality follow-up

## Updated conclusion

The user's real-Chrome autofill baseline/off A/B differs by about one CPU percentage point. Autofill transitions are ruled out as the dominant remaining load. Their presence in the older trace is not justification for changing autofill CSS. General transition-off, static-auth and canvas-removal results also remain accepted.

The remaining cause is **not yet identified**. Viz remains the largest measured thread. New correlation shows that the extra commits between canvas callbacks are mostly cheap main-thread commits. Counting them as equivalent to redraw-associated commits exaggerated their importance. This does not explain or assign the shared Viz CPU cost, and does not override the user's no-canvas A/B.

## Correlation, not just event counts

Analyzed `C:/Users/10/Downloads/Trace-20260925T212207.json`. Renderer PID 13348/TID 20524; start 23536188783 microseconds. The read-only reproduction script is `scripts/login-commit-trace.mjs` (specific to this capture's thread IDs/time origin).

Partition events into consecutive `BeginMainThreadFrame` intervals. Include only intervals completely inside each measurement window. Assign RAF and Commit slices to the same interval; this is temporal correlation, not proof that RAF caused every operation in that interval. Times below are elapsed Commit slices, not CPU utilization, and nested slices must not be added to RunTask totals.

| Window | With RAF: commits / Commit time | Without RAF: commits / Commit time |
|---|---:|---:|
| 11–13 s | 39 / 256.816 ms | 80 / 23.912 ms |
| 26–27 s | 19 / 147.188 ms | 40 / 11.695 ms |
| 2–35 s, mixed Auth interaction | 799 / 5576.459 ms | 1152 / 373.455 ms |

The first interval puts 91.5% of elapsed Commit time in frames containing RAF. The complete-frame criterion drops boundary frames, explaining differences from earlier PageAnimator buckets (81 rather than 80 without RAF). The 26–27 s sample contains finite panel transitions; neither sample is a controlled long idle capture.

In 11–13 s, no-RAF frames have 110 Paint events (11.977 ms total), 8.495 ms style work and 5.241 ms FunctionCall time; max Commit is 0.740 ms. RAF frames have max Commit 8.081 ms. Across 2–35 s the max no-RAF Commit is 2.472 ms versus 14.652 ms with RAF. These maxima are Commit durations, not full-frame durations. No-RAF frame intervals have median 16.138 ms across the mixed window, consistent with display cadence.

Concrete no-RAF example at 12.037 s:

1. Renderer compositor `RequestMainThreadFrame`, layerTreeId 5, at 12.037051 s.
2. Main `BeginMainThreadFrame` at 12.037067 s.
3. `UpdateLayoutTree` 63 microseconds; `ScheduleStyleRecalculation` occurs inside it, without a JS stack identifying a writer.
4. `PageAnimator::serviceScriptedAnimations` takes 12 microseconds, with no RAF callback or FunctionCall.
5. PrePaint 6 microseconds; Layerize 1 microsecond; no Paint.
6. Commit 60 microseconds. Entire enclosing RunTask: 242 microseconds.

Thus Chrome's compositor requests main-thread animation/style service without application JS in this frame. The request contains only a layer-tree ID, not the invalidation requester. Other no-RAF frames paint the document and Login card. The capture has **zero detailed paint/style invalidation tracking events**. Paint records have layerId 0 and node IDs, so they cannot establish which composited layer originated invalidation. The Viz tasks lack native child operations explaining their sustained cost.

## Animation inventory: observed versus currently unverified

At 11.1 s the trace has two active input background-color transitions; at 12.1 s only the email background transition has a recorded open lifecycle. At 26.1 s it has the email transition plus short chevron rotation and grid expansion. These are trace observations, not a fresh audit of the user's current quiet Login. Animation lifetimes that begin before capture or unrecorded native animation work may be missing.

| Target / source | Properties; configured duration / iterations | Trace evidence and quiet-state relevance | Compositor evidence |
|---|---|---|---|
| Email/password autofill, `src/index.css:624` and related rules | background-color; 9999 s / 1, finite | Running lifecycles reach into the measured lower-input intervals. User A/B rules out dominant cost; no repeat isolation proposed. | No proof of compositor-only execution from this trace. |
| Theme/language/buttons/inputs/App wrapper | color, border colors, background, shadow, scale, outline, padding, text-fill; generally 150–300 ms / 1 | 1946 color transition starts in the mixed capture; longest observed color lifecycle 328 ms. Interaction/theme-related activity, not evidence of a persistent idle animation. | Trace explicitly reports unsupported color/border/shadow/outline/padding/text-fill properties for compositing. Scale is a candidate, not proof. |
| Login card, `src/pages/Login.tsx:402`, `src/index.css:475` | opacity and transform; 180 ms / 1 | Finite entrance; one observed lifecycle about 203 ms. Does not explain sustained settled Login. Recovery card: 160 ms; its overlay: opacity 120 ms, conditional. | Transform/opacity are candidates; layer promotion not proved. |
| Login expanders, `src/pages/Login.tsx:560,568`; PWA summary | rotate/transform; 200 ms / 1. Grid rows 180–200 ms / 1, PWA opacity 200 ms | Short interaction-driven lifecycles; active at 26.1 s. Not an untouched recurring clock. | grid-template-rows explicitly unsupported in trace. |
| Pending fingerprint loader, `src/index.css:543`, `src/components/StanzaFingerprintLoader.tsx:24` | transform + box-shadow; 1050 ms / infinite | Six loader surface lifecycles in trace, none longer than 300 ms. Only during pending operations; none open at 11.1/12.1/26.1 s. | Trace rejects box-shadow compositing. Not a purely compositor-only effect. |
| Pending loader SVG grooves, `src/index.css:558` | opacity + stroke-dashoffset; 1050 ms / infinite, staggered delays | 54 groove lifecycles, max observed 300 ms; same pending-only condition. Static Login/PWA marks default `animated=false`. | Trace rejects stroke-dashoffset compositing. |
| Success loader / grooves, `src/index.css:547,563` | surface 420 ms / 1; groove 180 ms / 1 with delays and fill | Finite conditional success effects; not found running in the lower-input samples. Filled finished effects need not generate new frames. Error grooves inherit infinite animation while their loader remains mounted. | Mixed properties; cannot assume off-main-thread execution. |

No independent SVG SMIL, WAAPI, pseudo-element animation, animated gradient/background-position, per-frame custom-property writer or will-change declaration was found in the mounted settled Login path. This source statement is not a substitute for the live animation audit. CSS animation is not itself inherited; inherited animated values can affect descendants.

## Compositing structure

- `src/components/AuthShell.tsx:18`: relative isolated stacking context. Its fixed full-viewport background wrapper is at line 21, containing the canvas and its absolute wrapper (`FingerprintCanvas.tsx:274`). Isolation/fixed positioning can affect layers but do not themselves request recurring frames.
- `src/pages/Login.tsx:361`: translucent toolbar, backdrop-blur-md, small shadow, above the background.
- `src/pages/Login.tsx:402`: translucent Login card, backdrop-blur-xl, rounded border and shadow. This is the most consistently repainted Auth content surface (1106 paints in the full trace), alongside the document (1476). It is an affected surface, **not a proven invalidation source**. The prior blur A/B is accepted; no new blur isolation is proposed.
- Conditional recovery/PWA dialogs and update toast add translucent/filter surfaces only when shown. No static topography SVG layer is mounted by the current AuthShell; the global CSS class definitions alone do not mount one.
- Canvas uploads/composition and backdrop dependencies may contribute to the expensive redraw-associated frames, but the trace cannot identify the native Viz operation or claim those account for the remaining whole-browser load. No canvas geometry changes are justified.

## Global activity audit

Mounted tree remains main -> preferences -> App -> ThemeProvider -> LanguageProvider -> AuthShell -> Login/canvas. No Dashboard/lanyard mounts in settled Login.

- `App.tsx`: initial session request, one-shot Signup preload after 700 ms, action-driven navigation delay. No session/presence/clock polling or recurring notification provider.
- Theme (`ThemeContext.tsx:26`) changes root classes/data/color-scheme on theme changes only; Language changes dir/lang on language changes only. Preferences write tokens/scale on initialization and preference/storage events. No recurring frequency.
- PWA install store emits on install/display-mode events. Registration/update/controller messages are event-driven; no update interval. Service-worker load remains negligible as already measured.
- Canvas is the known timer + RAF cadence, with event-driven resize/theme/visibility observers. No second loop found. Its eight theme observer callbacks over the full trace do not constitute a 60-Hz writer.
- Login handlers are action/network driven, with one-shot demo submission. DEV demo-motion and telemetry are compiled out. No new production telemetry/subscription loop found.

## On-demand production audit

New `src/diagnostics/login-animation-audit.ts` is imported only when the build explicitly sets `STANZA_LOGIN_ANIMATION_AUDIT=true`. It exposes `window.__STANZA_ANIMATION_AUDIT__()` and changes no rendering. No query switch, polling, timer, RAF, observer, computed-style read, animation pause/cancel or DOM mutation is installed. WeakMap IDs remain stable between manual snapshots. Returned data are plain snapshot values, with Infinity serialized safely.

The snapshot covers `document.getAnimations()` (document-wide equivalent of a subtree animation query), target/ancestors/pseudo-element, CSS animation name/transition property, discovered keyframe property names, currentTime, playback rate, pending/play state, specified/computed timing, and finite/infinite classification. It reports eligibility only, not actual compositor promotion. Native caret blinking, browser UI, canvas drawing, cross-origin frames, all SVG SMIL and native Viz work are outside this API. No credentials or keyframe values are captured.

```powershell
$env:STANZA_LOGIN_AUTOFILL_DIAGNOSTIC='false'
$env:STANZA_LOGIN_ANIMATION_AUDIT='true'
npm.cmd run build
Remove-Item Env:STANZA_LOGIN_AUTOFILL_DIAGNOSTIC
Remove-Item Env:STANZA_LOGIN_ANIMATION_AUDIT
npm.cmd run preview -- --host 127.0.0.1 --port 4173 --strictPort
```

If preview is already running, reload it rather than starting another listener. URL: **http://localhost:4173/** — no diagnostic query parameters.

Wait until Login settles, do not submit or expand panels, and manually run:

```js
copy(JSON.stringify(window.__STANZA_ANIMATION_AUDIT__(), null, 2))
```

Save that output, wait several seconds and run it once more. These snapshots are outside the timed performance recording; they are not a CPU benchmark with DevTools closed. Compare audit IDs/currentTime/playState; ignore finished fill effects as frame-request evidence. I have not executed this in the user's Chrome, respecting the no-Computer-Use instruction, so **the current live animation inventory remains pending**.

The next measurement is a 15-second untouched recording with animation audit outputs plus paint-invalidation details/layer information enabled for causality, separate from CPU/power measurements with DevTools closed. This is observational, not another visual A/B matrix. If no unruled-out continuously running animation is present, the next single environment A/B is the same build/URL/viewport/theme in the current profile versus a fresh Chrome profile with only this page open, matching form focus/autofill and hardware acceleration. It distinguishes profile/shared-browser work from page work; it does not assume extension scripting is responsible. Do not choose a visual effect to disable until the audit or invalidation evidence identifies one.

Normal restoration: build with `STANZA_LOGIN_ANIMATION_AUDIT=false` and `STANZA_LOGIN_AUTOFILL_DIAGNOSTIC=false` (or both unset). No functional Login/CSS/auth/canvas changes were made.

## Validation and changed files

This continuation modifies only `src/main.tsx`, `src/vite-env.d.ts`, `vite.config.ts`; adds `src/diagnostics/login-animation-audit.ts`, `scripts/login-animation-audit-test.ts`, `scripts/login-commit-trace.mjs`, and this report. Earlier working-tree changes are preserved. The old autofill experiment remains disabled in this build.

TypeScript, on-demand audit tests, normal production build and diagnostic production build passed. Normal assets exclude animation/autofill diagnostics and DEV telemetry. In fact the normal app bundle retains the original optimized-production hash `index-4y680VBq.js`. Diagnostic assets include `login-animation-audit-1vPz9ntY.js` and exclude autofill instrumentation, DEV telemetry, Vite client and React Refresh markers. HTTP GET localhost:4173 returned 200 and matched the current diagnostic build's HTML. `git diff --check` passed. Existing build warnings concern Lexical annotations and chunk size. No Git mutation, Computer Use or unrelated tests/code changes.
