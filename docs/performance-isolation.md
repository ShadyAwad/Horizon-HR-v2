# Performance diagnostics

Performance tooling is development-only unless a diagnostic build flag is explicitly enabled. Diagnostic switches are not user appearance preferences and must not be enabled in a public deployment. They isolate rendering sources without changing permissions, stored data or business workflows.

## Runtime ownership

Dashboard conditionally mounts lazy feature modules. Navigation launcher and settings accordion state are locally owned. Preference changes update root theme/typography variables; language and account changes intentionally refresh their consumers. Attention counts refresh while visible and preserve state identity when unchanged.

The lanyard uses demand rendering: interaction wakes it, settling uses a reduced cadence, and stable sleep requests no frames. Settings and hidden documents pause it. FingerprintCanvas has a bounded idle scheduler and finite state transitions. Loading spinners and attendance progress indicators are limited to their request/workflow lifetime. Static ready status must not become a decorative continuous animation over retained dashboard layers.

## Development workflow

Start `npm run dev`, sign in to a disposable local account and open the Perf panel. Reset render counters, perform one action, then refresh metrics. Render counters do not use a recurring timer; optional frame sampling runs for a bounded interval. Compare idle, launcher open/close, settings accordions, module switching, theme and language changes. React Strict Mode can produce two development renders per logical update.

Use the same viewport, module, browser profile and interaction for each isolation preset: Normal, No Lanyard, No Atmosphere, No Transforms, Opaque Shell and Minimal Compositor. Switches are browser-session diagnostics, not persisted appearance changes.

In Chrome Task Manager, record the active renderer and GPU process separately. Use DevTools Rendering paint flashing and a Performance trace to distinguish JavaScript/style/layout work from raster/compositor/WebGL/filter work. Inclusive nested trace durations cannot be summed as independent CPU time. Compare settled idle after the interaction; a short peak does not establish a permanent loop.

The interaction lab at `/?stanzaPerfLab=1` is available in development. It isolates equally sized control variants from business mutations. Login and lanyard diagnostic query parameters are implemented under `src/components/dev/` and the relevant page/canvas modules. Their production-build opt-in flags are listed in `.env.example`; normal builds leave them disabled.

## Tests and limits

Run `npm run test:performance`, `npm run test:lanyard`, `npm run test:theme`, and `npm run test:custom-cursor`. Scheduler tests cover idle/visibility/cancellation behavior; source contracts prevent accidental continuous animation in settled dashboard states. These are not hardware benchmarks.

Retest on ordinary office hardware, with browser extensions and DevTools overhead controlled. Native select rendering and GPU/browser compositing differ by platform. Dashboard remains large and mixes several feature controllers; extracting those controllers is separate architectural work. No historical measurements in this repository should be treated as a general performance guarantee.

Development processes use Node watch with the tsx loader. Express loads Vite configuration through its in-memory runner to avoid temporary config modules feeding back into the backend watcher. `npm run test:rendering` compiles current source into bounded clock/DOM/canvas mocks; it needs no historical Git commits and does not measure browser GPU performance.
