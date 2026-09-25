# Interaction hot paths — September 18, 2026

## Evidence status

User runtime observations supersede the earlier idle hypothesis: CPU falls when
interaction stops; freezing/removing Login's canvas or disabling either Login blur
did not materially resolve interaction jank. Do not optimize FingerprintCanvas on
that evidence. The supplied trace description reports Painting and Scripting but
does not include the exported trace, function stacks, samples or affected nodes.
The local trace path has been requested. No measured dominant function, handler
frequency, callback duration, per-event React update count or paint target is
claimed here.

## Repository findings (ranked by source evidence, not measured CPU)

| Candidate | Location and event path | Scope / work / state | Minimal test |
|---|---|---|---|
| Broad R3F event dispatch | `src/pages/Dashboard.tsx:4863` passes `dashboardRootRef.current` to lanyard; `src/components/lanyard/Lanyard.tsx:257` passes it to Canvas | Pointer events across Dashboard can reach R3F even when not dragging. Installed Fiber `dist/events-b389eeca.esm.js:817` handlePointer invokes intersection processing; `:586` intersect and `:617` recursive raycaster.intersectObject operate before mesh callbacks. Sleeping physics/render scheduling is not proof this event path sleeps. Not mounted on Login. | Inspect pointermove stack for handlePointer → intersect → intersectObject/Mesh.raycast. Use existing DEV lanyard-disabled isolation for an initial A/B; this removes more than events, so it alone cannot attribute cost to raycasting. If stacks dominate, add an events-only switch next. |
| Expensive opt-in style recorder | `src/lib/dev-performance.ts:67–97`, observeDevControlFrames → handle → capture → describe | Each matched pointermove synchronously reads button, pseudo-element, parent and ancestor computed styles and allocates a sample. Entry/exit events also schedule a 12-frame read sequence. Style reads may force pending style resolution. No React setters in this callback. The 240-record storage bound does not stop collection. **Only active when explicitly enabled**: `PerformanceIsolationPanel.tsx:126–131`, or the separate InteractionMicrobenchmark. Does not explain normal Login. | Turn off Geo style capture and close the DEV panel; compare same movement. Look for capture/describe/getComputedStyle in the existing trace. Do not record styles during the CPU comparison. |
| CSS hover painting | `src/index.css:959–969,1097–1128`; `src/components/navigation/DashboardNavigation.tsx:159`; `src/pages/Login.tsx:358,425,453,490–493` | Shared controls transition colors, backgrounds, borders and shadows. Launcher combines moving/scaling with an animated shadow; Login uses transition-all and scale on some controls. Crossing controls repeatedly can restart transitions and cause paint/style work even without React commits. Moving within one already-hovered control ordinarily does not restart :hover. Broad theme descendant selectors can add style resolution cost, not independently establish a loop. | Compare movement within one control, across many controls, and across blank space. In a separate DevTools experiment disable only the implicated element's transition declaration, keeping its final hover style; inspect paint targets. Do not alter the Geo background rules. |
| Command palette hover state | `src/components/command-palette/CommandPalette.tsx:348` | onMouseMove invokes setSelectedIndex(resultIndex) on every movement over a result. Calls with the same primitive can bail out; setter count is not render/commit count. Scoped to open palette. | Profile with palette closed/open and move within a row versus across rows; correlate React commits. |
| Drag-only calculations/state | `src/components/navigation/mobile-shortcut-order.ts:137–162`; `src/components/ProfilePhotoCropDialog.tsx:39`; `src/components/lexical/FeedImageNode.tsx:88–107` | Mobile reorder sets preview point, reads a bounding rect, can scroll, uses elementFromPoint and updates target. Crop updates offset. Feed image registers a window pointermove listener per editable image and updates dimensions during resizing; inactive drag exits early. These are feature-scoped, not a global Login cursor effect. | Confirm whether these features are mounted and gestures active in the trace. Count setters separately from React commits; inspect layout reads following writes during actual drag. |

Lanyard mesh callbacks at `Lanyard.tsx:1030–1081` change hover/drag state or refs.
The `interactionEnabled` check is inside application callbacks and does not itself
disable the earlier R3F raycast. `document.body.style.cursor` at `:755–758` changes
on hover/drag state transitions; it is not a cursor-following position effect.

Searches across application source, public scripts, index.html and repository
files outside dependencies/build outputs found no GSAP cursor system, parallax,
global mouse-position provider, or pointer-driven CSS-variable writer above both
Login and Dashboard. Theme/Language/Preferences root style/attribute writes are
preference/event-driven, not wired to pointer movement. This does not exclude
library listeners, browser extensions, or a different deployed build; the trace
is needed to inspect those stacks. CSS cursor declarations alone do not install
pointer listeners.

Static Dashboard SVG masks, large blurred atmosphere glows and translucent cards
can amplify paint/composition while underlying pixels change. They do not explain
which callback initiates the work. The failed Login canvas/blur A/B tests lower
their priority for this reported problem. None were removed.

## What the exported Chrome trace must establish

1. Identify the Stanza renderer's CrRendererMain thread, excluding unrelated
   processes and workers. Select just the active-movement interval, then a quiet
   interval for comparison.
2. Count EventDispatch pointermove/mousemove/over/out/enter/leave/touchmove records
   actually present. Events may be coalesced; counts are dispatched callbacks,
   not hardware mouse polling frequency. Use interval duration for calls/second.
3. Inspect both Bottom-up self time and Call tree inclusive time. Under each
   pointer event follow application, React delegated-dispatch and R3F stacks.
   Do not label a long generic EventDispatch span as a specific application handler.
4. Attribute samples to callback name and source URL/line; include calls/second
   and mean/max callback duration only where actual callback boundaries exist.
   Sampled CPU profiles do not necessarily provide exact invocation counts.
5. React dispatch stacks alone do not prove a rerender on each event. Use existing
   `window.__STANZA_RENDER_DIAGNOSTICS__.snapshot()` deltas for its named Dashboard
   components, plus React Profiler for components outside that coverage. Render
   attempts/commits and setter calls are different metrics. Exact per-handler
   setter rates need targeted counters after the dominant handler is identified.
6. Inspect Recalculate Style / Layout initiators and Paint layer/node metadata,
   where captured. Missing paint metadata cannot identify an element reliably.
   A follow-up recording with paint instrumentation may be needed; compare that
   separately because instrumentation adds overhead.
7. If style setters appear in stacks, identify the exact writer (style.setProperty,
   style attribute/class mutations or library transforms), its element and frequency.
   Do not infer per-frame inline updates merely from seeing frequent paints.

Expected report schema after trace inspection:
`callback | source file/line | calls/sec | setter calls/sec | avg/max callback ms |
self/inclusive CPU | React commits | style/layout/paint attribution`.
Unavailable fields must stay unavailable rather than be estimated from event counts.

No new global listener monkey-patch or pointer-frequency computed-style sampler was
added: both could distort the hot path under investigation. Existing style capture
must be off for the baseline. No subsystem was proven dominant yet, so a new
disable switch would be premature. The exported trace is the next required input.

Only this report was added in this pass. Production source, FingerprintCanvas,
Geo button fix and Git state remain unchanged. No runtime tests were represented
as having run; source inspection alone cannot answer the six runtime questions.
