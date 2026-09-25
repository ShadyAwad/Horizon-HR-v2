# Real Chrome video follow-up — 2026-09-06

## Primary evidence

Recording: `New Tab - Google Chrome 2026-09-06 10-24-24.mp4`, 52.973 seconds, 1920 × 1040, approximately 30 frames/second. Timestamped overview sheets and consecutive button crops were inspected.

- Clock In loses its green fill at 48.323–48.356 seconds, recovering through a darker green at 48.390. A second dark frame occurs at 49.023, followed by recovery.
- Request Break loses its green fill at 49.790–49.823 seconds, recovering through darker green at 49.856.
- Both follow pointer entry. The surrounding panels remain visually stable; Clock In's dashed surround remains visible. The recording does not provide pointer-button telemetry, so pointerdown/up cannot be distinguished conclusively from hover entry.
- The recording includes lanyard movement in Geo Operations and Locations, plus module navigation and initial loading. It does not contain a controlled Session Center comparison, identified FULL/LIGHT trials, frame/physics counters, or Chrome Task Manager CPU readings. CPU correlation cannot be inferred from this recording.

These observations confirm a visible transient loss of button fill. They do not establish a compositor root cause or identify a successful isolation variant.

## Real Chrome access retry with Full Access

The actual Chrome window was discovered as `Dashboard — Stanza - Google Chrome`. Screenshot capture failed with `SetIsBorderRequired failed: No such interface supported (0x80004002)`. Refreshing the returned window and retrying once produced the same error. This differs from the preceding URL-validation failure. The browser connection exposed only Codex In-app Browser, with no real Chrome connection.

No live flash disappearance, layer promotion/recreation, sustained manual drag, visual brightness, or real Chrome CPU result was verified in this retry. No permanent button fix or production frame-profile change was made. Auto remains FULL 60/24 and LIGHT 45/20 remains diagnostic. Earlier in-app short-drag results in `geo-lanyard-validation.md` are not sustained Chrome measurements.

## Remaining controlled capture

For each button, use the existing Perf → Real Geo button experiment, one variable at a time: current, no-transform, no-transition, opaque-parent, no-backdrop, no-pseudo. Return other surface switches to current, allow mode-change transitions to finish, and repeatedly enter/leave the actual button with the pointer. Record whether the same flash disappears and returns when restoring current. Keep control-style capture off during lanyard performance trials.

For each module/profile below, capture several seconds of continuous manual dragging, including a long stretch. Record drag duration separately from settling. Collect actual render/physics deltas, worst frame interval, long tasks, two-frame paint timing, and Event Timing from the existing diagnostic capture. Do not interpret missing Event Timing entries as zero input cost. Use equivalent viewport, theme, movement and capture duration; avoid HMR/build activity during capture.

| Real Chrome trial | Renderer CPU peak | GPU-process CPU peak | Sustained drag duration | Capture / visual result |
|---|---|---|---|---|
| Geo / FULL 60/24 | Pending | Pending | Pending | Pending |
| Geo / LIGHT 45/20 | Pending | Pending | Pending | Pending |
| Session / FULL 60/24 | Pending | Pending | Pending | Pending |
| Session / LIGHT 45/20 | Pending | Pending | Pending | Pending |
| Geo / disabled baseline | Pending | Pending | Not applicable | Pending |
| Session / disabled baseline | Pending | Pending | Not applicable | Pending |

GPU-process CPU is not GPU utilization. Layer count, repaint damage and GPU execution require separate tracing; CSS stacking-context inventory alone does not measure them. Production Chromium should not switch to 45/20 without meaningful measured savings and sustained visual parity. Firefox remains unchanged.

## Validation in this retry

Passed: `lint`, `build`, `test:performance` (110/110), `test:navigation`, `test:theme`, `test:tutorials`, `test:pwa`, `test:security`, `test:audit` (13), `test:sessions` (6), `test:hr-background`, and `test:lanyard`. Theme checks cover original preset snapshots, Custom persistence/contrast, semantic Passkey styling and transparent close-glyph interaction contracts. They do not replace requested visual verification in real Chrome.

Existing warnings remain: Lexical PURE annotations and large build chunks, THREE.Clock deprecation in the scheduler harness, and two security fixture/deployment warnings including missing optional authenticated-test credentials. Scheduler harness results (300/121 FULL and 226/101 LIGHT active/passive renders over five seconds) are deterministic scheduling checks, not live Chrome drag or CPU measurements.

Only this report was added in this retry; application source was not changed. The build regenerated ignored build output. Existing unstaged work was preserved and no Git mutation command was used.
