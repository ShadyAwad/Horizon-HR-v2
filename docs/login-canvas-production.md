# Production Login canvas scheduler

The user-approved production scheduler now targets 24 FPS while idle with the already-tested timer plus RAF strategy (about 20 FPS on a 60-Hz display in the deterministic lifecycle test). Loading/success/error run at display cadence. Theme, resize and visual-state updates preempt the idle timer for the next available animation frame. Hidden tabs cancel timer and RAF, visibility resumes drawing without replaying hidden pulse time, and unmount disposes both scheduling handles and observers. Reduced-motion and explicit static rendering remain supported.

The drawing routine was compared textually before/after the edit: canvas clear/fill, fingerprint geometry, gradients, ring count, opacity and color math are unchanged. Runtime command-parity tests additionally compare the historical artwork and current renderer at matching timestamps, plus current development/production rendering in both palettes and pulse states.

## Exact files changed this turn

Modified:
- `src/components/FingerprintCanvas.tsx` — production cadence, removal of full-rate fallback and diagnostic selection.
- `src/components/AuthShell.tsx` — remove temporary isolation wrappers/attributes and fallback callback; ordinary canvas and auth callback wiring retained.
- `src/vite-env.d.ts` — remove diagnostic flag type.
- `vite.config.ts` — remove diagnostic build define.
- `scripts/login-canvas-scheduler-test.ts` — production scheduler lifecycle and bundle-exclusion assertions.
- `scripts/chrome-regression-test.ts` — deterministic timer clock and production renderer validation; existing Geo assertions unchanged.

Added:
- `src/lib/login-canvas-scheduler.ts` — existing tested cadence promoted to production module.
- `src/lib/dev-login-canvas-counters.ts` — reusable passive DEV counters split from scheduler; no scheduling or production output.
- `docs/login-canvas-production.md` — this report.

Removed:
- `src/lib/dev-login-canvas-scheduler.ts` — replaced by the two modules above; scheduler query parser removed.
- `src/lib/login-canvas-diagnostic.ts`
- `src/components/dev/login-perf-test.ts`
- `src/components/dev/login-transition-test.ts`
- `src/components/dev/auth-idle-isolation.ts`
- `scripts/login-production-diagnostic-test.ts`
- `scripts/login-perf-isolation-test.ts`
- `scripts/auth-idle-isolation-test.ts`
- `docs/login-production-canvas-diagnostic.md` — obsolete build/URL instructions.

Other historical investigation reports are retained as evidence, not active instructions; their old diagnostic URLs no longer work. Earlier unrelated working-tree changes are not included in this list. Build regenerated ignored dist artifacts. No Git state was mutated.

## Validation

Passed:
- TypeScript: `node --jitless --max-old-space-size=4096 node_modules/typescript/bin/tsc --noEmit`.
- `npm run build` (existing Lexical annotation and large-chunk warnings).
- `npx tsx scripts/login-canvas-scheduler-test.ts`: idle cadence, immediate invalidation, active states, hidden/resume, disposal, production scheduler inclusion and diagnostic exclusion.
- `npx tsx scripts/chrome-regression-test.ts`: artwork parity, auth success/error completion, theme/Custom palette refresh, resize, reduced motion, static mode, visibility and cleanup/remount. These use deterministic/Canvas2D stubs, not Chrome GPU timing.
- `npm run test:theme`.
- `npm run test:pwa`.
- Production browser assets contain no STANZA_LOGIN_CANVAS_DIAGNOSTIC, LOGIN_CANVAS_DIAGNOSTIC, loginCanvasTest, loginCanvasScheduler, loginPerfTest, loginTransitionTest, loginIdle, or removed recorder/counter globals.

`npm run test:authorization` did NOT pass. Its source assertion still searches only server.ts for `targetLevel > actorLevel`, while the existing guard now lives in `src/server/organisation/legacy-role-routes.ts:468` (self-escalation check at 471). The test stopped before live requests; credentials were explicitly cleared for this invocation. No auth/authorization implementation or unrelated test was changed. Auth pulse behavior relevant to this scheduler is covered by the passing renderer regressions.

## Remaining performance limits

The user's real-Chrome diagnostic production A/B established a clear reduction from lower redraw frequency, with no-canvas only about two CPU percentage points below optimized. A 24-FPS target does not make the page idle: canvas drawing and its paint/composition costs remain, and active auth visuals intentionally use display cadence. This is not a claim of zero power cost or a new post-change Chrome measurement. No further artwork/compositor/layout optimization is included. Normal production now uses the tested path without query flags.
