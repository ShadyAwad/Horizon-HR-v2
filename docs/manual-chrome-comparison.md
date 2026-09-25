# Manual Chrome diagnostics — 2026-09-06

## Button evidence and pointer-entry path

The supplied video confirms transient fill loss on Clock In at 48.323–48.356s and 49.023s, and Request Break at 49.790–49.823s. Pointer entry precedes the flash; surrounding panels stay stable. No new live Chrome result is claimed.

Both exact buttons in Dashboard have click handlers for business actions, but no local pointerenter/mouseenter/mouseover React handler. Clock In has `hover:scale-105`, `active:scale-95`, clipping and a positioned child; Request Break has no local hover transform. Shared active styling applies `scale(.98)`. Shared `.stanza-theme-primary` supplies a gradient, a hover background shorthand switching to solid accent-hover, and transitions including background-color, shadow, transform and opacity. Hover also changes shadow. The Geo outer group-hover overlay can change independently when entering the overall workspace; it is not a button-specific entry handler. Neither real button declares a local before/after pseudo-element effect. Their ancestors include translucent panels and the Geo backdrop-filter documented in the preceding surface audit.

**Concrete candidate, not confirmed root cause:** the primary gradient has a transparent computed background-color underneath it. Hover removes the gradient while transitioning that base toward an opaque accent. This can expose the dark underlay during the transition without ever computing an opaque black background. It is shared by both buttons, unlike Clock In's hover scale. The retained-gradient/opaque-base experiment directly tests this; no-transition provides a second discriminating check. Computed-style history alone cannot prove compositor behavior or pixel output.

## Opt-in exact-control logger and variants

In development, open Perf → Capture real Geo control styles. The bounded logger captures pointerenter, mouseover, mouseenter, pointermove, pointerdown, pointerup and mouseleave, plus existing over/out/focus/click events. Each event includes its timestamp, current performance.now(), className, interaction/disabled state, fill, opacity, transform/scale, filter, shadow, border, outline, transition properties, parent styles, pseudos and ancestor context candidates. Entry events start up to 12 RAF samples. Movement records directly into a bounded 240-sample buffer without React state updates and does not cancel the entry RAF series. It detaches on panel close/module change. Style reads perturb timing: disable this logger for CPU comparisons.

Use Real Geo button experiment:

- `current`: baseline.
- `no-transform`: removes transform plus independent scale/translate/rotate from the two controls and descendants; color/border feedback stays.
- `opaque-button`: retains a semantic opaque base and gradient through hover/active for the primary controls, including disabled primary styling. Business success/error/non-primary states retain their own existing fills. This is the most specific shared fill-transition candidate.
- `no-transition` and `color-only`: isolate all transitions versus only background-color, border-color and color.
- `no-pseudo`, `opaque-parent`, `no-backdrop`, `no-shadow`: existing scoped isolation choices.

Restore current between trials. Allow the prior transition to finish, repeatedly enter/leave both real buttons, and check disabled states without submitting attendance or break requests. Confirm an effective variant removes the flash repeatedly and restoring current brings it back. Only then promote the smallest change. No permanent fix, generic black override, will-change or translateZ was introduced. New computed-style logs and manual Chrome confirmation remain pending.

## Sustained manual lanyard workflow

Perf → Manual lanyard comparison offers FULL 60/24, LIGHT 45/20, VERY LIGHT 30/15 and DISABLED. Auto stays production FULL. Very Light is diagnostic only; physics remains fixed at 1/60. Canvas over flat opaque background fills transparent WebGL pixels using the semantic surface color without changing dimensions, hit area, alpha configuration or physics. Compare normal versus flat separately.

1. Open Geo Operations, select FULL, leave other isolation choices at current, and disable style logging.
2. Start sustained drag capture. Manually drag for approximately five seconds, including a long stretch; release, wait for sleep, then Finish. The capture automatically finishes after 50 seconds and releases observers; changing module/profile or closing the panel cancels it.
3. Enter Chrome tab peak CPU, GPU Process peak CPU and smoothness 1–5 in that row. Blank values mean unmeasured. CPU fields describe the latest trial and clear when a new trial is saved.
4. Repeat LIGHT, VERY LIGHT and optional disabled baseline; repeat in Session Center. Keep viewport, theme and movement equivalent.
5. Use Copy lanyard comparison. Clipboard failure exposes a selectable output field. No upload or persistent storage is used. Up to four trials per row stay in page memory across panel closure; reload/HMR clears them.

Reports include actual frame/render/physics counts, measured wall-clock frame intervals, scheduler tiers, wakes, per-gesture duration and release-to-settle time. A completed gesture of at least 4.5 seconds is labelled approximately five seconds; unfinished or short drags are not. Drag work excludes pre-drag and settling samples. Missing intervals/settle events are null, not zero. Saturation is flagged at 20,000 samples. Guided capture also reports long tasks, two-frame paint and Event Timing (absence of event entries does not mean zero input cost).

Cost split: gl.render CPU submission, Rapier step CPU, pointer-handler CPU, pointer-to-kinematic-target CPU, and inclusive R3F advance CPU. Advance overlaps the other categories; do not add them. Pointer timing excludes R3F raycasting/event dispatch. No measurement here supplies GPU execution time or composited-layer count. Similar geometry/physics timing between modules would support further underlay investigation, not prove that blending is the cause.

**Actual Chrome Geo/Session results are still pending.** No CPU reduction, flicker disappearance or production Chromium profile promotion is claimed. Custom and the original presets were not redesigned.

## Validation and changed files

Passed lint, build, performance (110/110), navigation, theme, tutorials, PWA, security, audit (13), sessions (6), HR background and lanyard tests. The lanyard harness now covers 30/15: 151 active and 76 passive renders in five seconds; FULL 300/121 and LIGHT 226/101 also pass. These are deterministic scheduling results, not real Chrome CPU/visual measurements. Summary tests cover drag/settle separation, short/unfinished gestures, missing intervals, and separate CPU categories. Production JS excludes the new report UI/markers, and production CSS excludes the flat-canvas diagnostic rule.

Audit/sessions initially hit shared-server HTTP 429. Audit passed against a separate local server on port 3011; sessions passed after configuring that server's expected origin to its actual local URL (the initial origin mismatch correctly returned 403). The temporary server was stopped. Existing warnings remain: build chunk sizes/Lexical annotations, THREE.Clock deprecation, security deployment/optional authenticated-fixture warnings.

Changed this task:

- `src/lib/dev-performance.ts`
- `src/components/lanyard/Lanyard.tsx`
- `src/components/lanyard/lanyard-frame-scheduler.ts`
- `src/components/dev/PerformanceIsolationPanel.tsx`
- `src/components/dev/performance-isolation.css`
- `src/components/dev/LanyardComparison.tsx` (new)
- `src/components/dev/lanyard-comparison.ts` (new)
- `scripts/lanyard-scheduler-test.ts`
- `scripts/performance-test.ts`
- This report.

Preexisting unstaged changes were preserved. No Git mutation command was used.
