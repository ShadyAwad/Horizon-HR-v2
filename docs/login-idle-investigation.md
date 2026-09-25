# Login idle work investigation

## Finding and scope

Current source has a confirmed idle frame generator: `AuthShell` mounts
`FingerprintCanvas` without static mode in normal operation. `pulseState='idle'`
does not stop its animation. This establishes ongoing work, not its share of the
observed Chrome CPU/GPU cost. No real Chrome trace or new Task Manager measurements
were captured in this pass. Production behavior and the Geo button fix are unchanged.

There are two distinct topographic implementations. `public/topography.svg` is
indeed static. Its only source references are the Dashboard's light/dark mask
layers (`src/pages/Dashboard.tsx:4900`, `:4915`). Login instead inherits an animated
Canvas2D background from `src/components/AuthShell.tsx:23`. If the deployed Login
DOM has no canvas, that deployment differs from this workspace; establish its build
before transferring this diagnosis. Do not delete or simplify the SVG.

## Mounted tree after session bootstrap, while logged out

```text
main.tsx → StrictMode → StanzaPreferencesProvider
  App → ThemeProvider → LanguageProvider → root div
    AuthShell [fixed full-viewport background wrapper]
      FingerprintCanvas [Canvas2D; default staticMode=false]
      Login
        theme/language toolbar [backdrop-blur-md]
        main card [backdrop-blur-xl; finite entry animation]
          static StanzaFingerprintMark / BrandWordmark
          form, static icons, collapsed demo-account contents
          PwaInstallPrompt [static mark, collapsed instructions]
        PrivacyPolicyModal [returns null unless opened]
        recovery overlay [only when opened]
        DEV benchmark launch button [benchmark itself only when opened]
    DemoNoticeModal [may be open on first visit; null when dismissed]
    service-worker update banner [only if a waiting update is reported]
```

`App.tsx:284–330` conditionally mounts auth transition loaders instead of Login
during bootstrap/transitions. Dashboard, lanyard, dashboard polling, live-employees
intervals, tutorials and their effects are not mounted on the settled Login route.
Signup is preloaded after a one-shot 700ms timeout (`App.tsx:205`); its map is created
inside a component effect, so preloading does not mount its map/render loop.

## Ranked suspects and smallest tests

| Rank / location | Evidence and idle behavior | Smallest isolation / interpretation |
|---|---|---|
| 1. `FingerprintCanvas.tsx:65,120,243`; `AuthShell.tsx:24` | **Confirmed continuous while visible**, except reduced-motion/static mode. End of `drawFrame` schedules another RAF regardless of idle auth state. Clears/fills viewport, creates a radial gradient, computes and strokes distorted rings every frame. At 1920px width: 69 rings × 126 angle samples = 8,694 path points/frame. Native DPR increases backing pixels quadratically. React can be completely idle while this runs. | `freeze-canvas`: retain artwork, cease recursive frames. A repeatable large fall identifies drawing plus downstream invalidation as major cost. `no-canvas` is a secondary comparison for residual surface/compositor cost. |
| 2. `Login.tsx:395` | Large translucent card with backdrop-blur-xl over the changing canvas. **No self-scheduling JS**, but repeatedly changing pixels behind it can require backdrop work. Static blur alone is not evidence of a loop. | `no-card-blur`, with canvas still animated. Then repeat with frozen canvas to test their interaction. |
| 3. `Login.tsx:354` | Smaller toolbar with backdrop-blur-md. Same mechanism, smaller area. | `no-toolbar-blur` alone, then together with card blur disabled. |
| 4. `DemoNoticeModal.tsx:18`, `PrivacyPolicyModal.tsx:29`, `App.tsx:332`, `Login.tsx:635` | Full-screen modal backdrops / translucent update banner / recovery blur can amplify changing pixels. **Conditional**, not normal closed-dialog idle work. | Dismiss notices and close recovery/privacy/PWA dialogs before the baseline. Compare the same open/closed dialog separately only if that state reproduces the issue. No blanket global blur removal added. |
| 5. `index.css:543,558`; `StanzaFingerprintLoader.tsx:20`; `Login.tsx:496`; `AuthTransitionLoader.tsx:22` | Loading fingerprints animate transform/shadow, groove opacity and dash offset indefinitely. **Only while loading elements are mounted**; Login's ordinary logo and PWA mark default to static paths. A stuck request/transition could keep them active. | Inspect running animations and loading DOM; `no-css-motion` isolates auth-shell CSS animations/transitions while leaving Canvas2D running. No expected steady-idle change means these are not the current culprit. |
| 6. `FingerprintCanvas.tsx:87,108`; `ThemeContext.tsx:27`; `LanguageContext.tsx:3762`; `StanzaPreferencesContext.tsx:181` | ResizeObserver redraws on size changes; MutationObserver resolves cached palette on root theme/style changes. Providers write root attributes only on corresponding dependency changes or storage events. **Reactive**, not polling. Canvas attribute/style writes are not on the observed root and its absolute parent does not size from the canvas; no obvious feedback loop found. | Frozen mode should reach a stable frame count after initial layout/theme delivery. Repeated callbacks in a quiet trace would elevate this suspect. Inspect their call stacks before adding more diagnostics. |
| 7. `dev-performance.ts:186,304`; `dev-login-canvas.ts`; `dev/LoginFlickerBenchmark.tsx:36` | Existing DEV interaction samplers can run bounded RAF/countdown work when explicitly armed. The canvas measurement accumulates up to 600 existing frames and creates no RAF. **Not an additional idle loop by default**. | Reload with benchmark closed/unarmed, wait for startup to settle; compare production separately after controlled DEV isolation. Do not use the flicker benchmark while taking idle measurements. |
| 8. `App.tsx:112,205`; `pwa-install-prompt.ts:27`; `main.tsx:25`; `public/service-worker.js` | Session probe once, preload timeout once, event-driven PWA subscriptions/update banner. Login online/offline handlers and language/theme events are interaction/event driven. Service worker handles lifecycle/message/fetch events; no recurring timer found. | Network panel after settling: unexplained recurring requests require their Initiator stack. React Profiler should show no ongoing idle commits; if it does, identify owner before blaming visual layers. |

CSS entry animations (`index.css:475,486`) run once. Login's button `transition-all`
and hover scale at `Login.tsx:489` react to interaction, not stationary idle. They
were not changed. No persistent pointer/mouse listener, animated mask/gradient
position, `will-change`, blend animation or SVG SMIL was found on the normal Login
mount path. The canvas gradient itself changes with time and is redrawn in JS.

The static Dashboard topography uses repeated 520px SVG masks, themed color and
static opacity under an absolute clipped atmosphere parent, alongside static
radial gradients and 420/520px blur-3xl glows. No autonomous animation on those
mask layers was found. They can contribute when other content changes, but those
Dashboard layers are absent on Login. The SVG contains paths and no animate/set,
script, filter, mask, event handler or foreignObject constructs.

Repository searches covered RAF, timers, infinite CSS/Tailwind motion, pointer/mouse
handlers, observers, filters, masks, transforms and shared mount paths. The two
setInterval matches in client source belong to dashboard attention counts and
LiveEmployeesPanel, not Login. Server/worker timers do not paint the browser.

## History interpretation

The August 2 reference `0bd1c7d` already has the continuous Canvas2D loop, breathing
glow and animated ring geometry. July 12 `11aec93` added radial glow/static-mode
support; July 13 `f650ad6` strengthened breathing glow/ring intensity. August 8
`1725157` added per-frame theme resolution/parsing (already cached by prior work)
and theme CSS. Therefore August 8 is not a demonstrated introduction date for the
idle RAF generator. The separate Geo hover regression is already fixed and was
not modified. A recurring loop can explain current cost without proving when a
hardware/browser-dependent performance regression started.

## Minimal diagnostics added

`AuthShell.tsx` reads whitelisted `loginIdle` query options **only in DEV** through
`components/dev/auth-idle-isolation.ts`. Reload to change a mode. There is no new
panel, timer, observer, persistence, React update loop or performance sampler.
The existing `staticMode` freezes canvas artwork; blur overrides are scoped to the
auth shell. No matching option means baseline behavior. Production excludes the
mode parser and diagnostic CSS. Options may be combined by repeating the parameter.

Use these while staying logged out on the idle form. **Remove the query and reload
before signing in**: freezing/removing the background can prevent the auth success
wave from completing. These modes are deliberately not an alternative login flow.

## Chrome test protocol

Use the same development origin, window dimensions, zoom, DPR, refresh rate, theme,
and power mode for every run. Keep the Login tab selected and visible: hiding it
pauses the canvas and invalidates comparisons. Close the first-visit notice,
recovery/privacy/PWA dialogs and old benchmarks. Move the pointer off the form.
Keep DevTools undocked or its dimensions fixed; docking resizes the canvas.

On the existing origin (normally `http://localhost:3000/`), reload these URLs:

| Trial | Query | Changes |
|---|---|---|
| A | none | Baseline |
| B | `?loginIdle=freeze-canvas` | Draw once; retain canvas artwork/blur |
| C | `?loginIdle=no-card-blur` | Main card backdrop filter only |
| D | `?loginIdle=no-toolbar-blur` | Toolbar backdrop filter only |
| E | `?loginIdle=no-card-blur&loginIdle=no-toolbar-blur` | Both filters; animated canvas retained |
| F | `?loginIdle=freeze-canvas&loginIdle=no-card-blur&loginIdle=no-toolbar-blur` | Interaction check after individual trials |
| G | `?loginIdle=no-canvas` | Remove canvas entirely; retain shell and card |
| H | `?loginIdle=no-css-motion` | Auth-shell CSS motion only; canvas unchanged |

1. Chrome Task Manager (`Shift+Esc`): wait 10 seconds after each reload, then observe
   for 20 seconds. Record typical/range CPU for **Tab: Login — Stanza**, **GPU Process**,
   and **Browser** separately; record GPU memory if the column is available. Repeat
   A→B→A at least twice, then the other trials. Avoid DevTools profiling during
   these measurements. GPU Process's CPU column is CPU use by that process, not
   hardware GPU utilization. Windows Task Manager's GPU column is a separate metric.
2. Separate DevTools Performance recordings: capture 10 seconds of no-input idle
   in A, B, C and E. Inspect Main for `drawFrame`, animation-frame callbacks and
   ring trigonometry/path operations. Compare scripting, paint/raster and compositor
   work. A quiet React tree does not imply a quiet canvas. Avoid comparing a
   profiled run to an unprofiled Task Manager baseline.
3. Rendering → Paint flashing / layer borders can reveal changing regions. Canvas
   and compositor work may not all appear as DOM paint flashing; absence of green
   flashes alone does not disprove rendering. Inspect Layers where available for
   the full-screen canvas and backdrop surfaces. Record the active mode in notes.
4. One-shot console checks (no new polling):

   ```js
   document.querySelector('.stanza-auth-shell')?.dataset.loginIdleIsolation
   document.querySelectorAll('.stanza-auth-shell canvas').length
   document.getAnimations().filter(a => a.playState === 'running')
   window.__stanzaLoginCanvasMeasurements?.at(-1)
   ```

   In B the canvas count remains 1 and frame count should stabilize after initial
   observer deliveries. In G it is 0. Baseline's existing measurement stops at 600
   frames even though rendering continues: a capped counter is not proof of sleep.
   With reduced motion enabled, the baseline is already static; record that setting.

If B removes most cost, continuous drawing plus its downstream effects are the
leading cause. If C/E help greatly with the canvas still running, backdrop sampling
is a significant amplifier. If only G helps, investigate retained surface composition
or unexpected invalidation. If B/G do not help, use the trace to find remaining
callbacks/layers rather than remove more visuals. If the inspected page lacks the
expected canvas/mode marker, verify server/build/origin before interpreting results.

These tests target ordinary office hardware; an RTX 5060 Ti result is not a baseline
for acceptable cost. No production optimization is authorized by a source finding
alone, and none was made in this pass.

## Validation and changed files

Passed: TypeScript lint, production build, `auth-idle-isolation-test.ts`,
`chrome-regression-test.ts` (including frozen canvas redraw ownership), theme,
PWA, navigation and performance (110/110). The built production JavaScript was
searched for the unique diagnostic mode strings: none were present. Existing
Lexical annotation and bundle-size build warnings remain. No Chrome cost reduction
or visual verification is inferred from these tests.

Only these files were changed for this investigation:

- `src/components/AuthShell.tsx` — DEV-gated query integration.
- `src/components/dev/auth-idle-isolation.ts` — whitelisted, scoped isolation modes.
- `scripts/auth-idle-isolation-test.ts` — mode/default/production-exclusion tests.
- `scripts/chrome-regression-test.ts` — additional static-mode scheduling check.
- `docs/login-idle-investigation.md` — findings and Chrome test protocol.

No changes to Login markup, global CSS, canvas renderer, theme providers, static SVG,
lanyard, or Geo button implementation. Existing working-tree edits were preserved;
Git state was not mutated.
