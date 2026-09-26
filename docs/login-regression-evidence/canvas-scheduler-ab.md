# FingerprintCanvas scheduler A/B — DEV only

## Trace and cause

Parsed Trace-20260925T091217.json directly. Renderer pid 18672/tid 17460:
896 drawFrame FunctionCalls, 487.524ms; 900 FireAnimationFrame events,
514.248ms; 896 PageAnimator::serviceScriptedAnimations, 548.851ms.
These are nested inclusive durations, not three additive CPU costs.

The recurring work is full-canvas drawing at display cadence even during slow
idle ambient animation. Idle is not static. No conclusion about browser-wide CPU
or GPU utilization follows from FunctionCall duration alone.

## Visual/state inspection

| State | Frame-to-frame changes | Scheduling needed |
| --- | --- | --- |
| idle | Radial glow breathes; ring opacity changes; ring radius breathes; two time-dependent angular distortions deform contours | Continuous ambient sampling |
| loading | Same ambient artwork as idle; no separate loading wave in this renderer | Continuous; retain display-rate cadence in this experiment |
| success | Ambient artwork plus outward green pulse | Display-rate until pulse completes, then ambient cadence |
| error | Ambient artwork plus outward red pulse | Display-rate until pulse completes, then ambient cadence |
| reduced motion | Solid theme background, existing behavior | One shot on relevant invalidation |

Ambient glow phase uses sin(time * .0026), radius uses sin(time * .001 + ring
phase), and distortions use time * .0005 and time * .0003. Original RAF timestamps
are passed through unchanged, so reduced sampling does not slow animation time.
Completion callbacks and wave geometry/color math remain unchanged.

Paths are rebuilt every draw: at 1920x1080, 69 rings times 126 angle samples =
8,694 points. One radial gradient and its three color stops are rebuilt per draw.
The gradient's stop opacity changes continuously, so it cannot be frozen without
changing the artwork. Neither can the complete ring paths, since they deform.

Static cache candidates: angle samples and their trigonometric bases, ring base
radii, ring phase offsets, dimension-dependent centers/counts, and gradient
coordinates. A layered glow representation may be possible but would need pixel
parity checks. This experiment adds no geometry/raster cache, isolating scheduling.

DPR/backing-size assignment runs in ResizeObserver, not each frame; it currently
rewrites size for every delivered entry. Pure DPR changes without a size delivery
are an existing limitation, not changed here. Theme palette/numeric colors are
already cached on mount and relevant root attribute mutations, not each frame.

Resize, theme and refresh invalidations already request a redraw. Optimized mode
also requests an immediate redraw on auth-state updates. Hidden tabs already
cancel production RAF and shift the pulse start time on resume. The experiment
additionally cancels its pending timer. Existing normal visible idle always
reschedules RAF; staticMode and reduced-motion are exceptions.

## DEV change

`loginCanvasScheduler=optimized` enables a timer-to-RAF cadence with a 1000/24ms
idle interval. It avoids a display-rate RAF loop that merely skips draws. Timer
plus vsync quantization can yield around 20 FPS on a 60Hz display; 24 is a ceiling,
not a guaranteed measured rate. Busy browsers may achieve less.

Initial mount, resize, theme, refresh and state invalidations preempt the idle
timer and request one coalesced RAF. Loading/success/error schedule RAF directly.
When a pulse settles, the high-rate loop becomes idle timer cadence. Reduced
motion/static mode stop after the requested draw. Zero-sized optimized canvases
wait for ResizeObserver instead of spinning. Visibility/unmount cancels both
timer and RAF. No React state updates or recurring counter timers were added.

Production uses the original scheduling and artwork. The query parser, cadence
controller and counters are removed by the DEV build guard. No Login layout,
Demo Accounts, theme architecture, Dashboard, lanyard or Geo source was changed.

## Exact test URLs

- Current: http://localhost:3000/?loginCanvasScheduler=current
- Optimized: http://localhost:3000/?loginCanvasScheduler=optimized

Use no other isolation parameters; compare the same viewport/theme and interaction
sequence. Missing or unknown scheduler values select current. Reload between modes.

In Chrome Console, take a counter snapshot with:

```js
JSON.stringify(window.__stanzaCanvasSchedulers.at(-1), null, 2)
```

Counters: rafCallbacks, drawFrameCalls, redraws, visibleSeconds, rafPerSecond,
drawFramePerSecond, totalDrawMs, averageDrawMs, stopped. Rates are cumulative
averages per visible second since mount, not a rolling last-second estimate.
Use a fresh reload for each steady-idle sample. Hidden time is excluded; only the
four latest mounts are retained, and StrictMode can leave an earlier stopped entry.

Expected steady idle: about 20–24 RAF/draws per second versus the supplied trace's
~53/s (roughly 55–62% fewer draws). Active states remain display-rate. This is an
expected draw-frequency reduction, not measured Chrome CPU savings.

## Validation and remaining acceptance

Deterministic scheduler test: 201 draws over 10 simulated seconds at 60Hz;
coalescing, invalidation preemption, active-state cadence, settlement, hidden/resume
and disposal passed. Existing canvas harness extended to compare exact drawing
commands/styles at identical timestamps for idle/loading/success/error, both
palettes and resized dimensions. Pulse completion counts and reduced-motion
redraw behavior are checked. The harness uses a synthetic scheduler clock;
its draw-duration fields are not performance benchmarks.

Production build, TypeScript, theme, PWA and regression/scheduler tests passed.
Production bundle exclusion is also asserted. Existing Lexical annotation and
chunk-size warnings remain.

Real Chrome acceptance is pending: idle motion fidelity, interaction smoothness,
loading/success/error appearance, resize, theme changes and actual CPU savings.
The identical renderer commands establish spatial/color parity at sampled times;
they do not prove that lower temporal cadence is perceptually acceptable.
