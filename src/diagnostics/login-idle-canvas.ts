import type { AuthVisualState } from '../auth/auth-contract';

// Included only in explicitly enabled diagnostic builds. Counters never schedule
// work; the console snapshot is manually invoked and contains no DOM reads.
export function createIdleCanvasDiagnostic() {
  const mode = new URLSearchParams(window.location.search).get('loginIdleCanvas') === 'idle-static' ? 'idle-static' : 'baseline';
  let rafCallbacks = 0, redraws = 0, stopped = false;
  const snapshot = () => ({ mode, rafCallbacks, redraws, stopped, capturedAt: performance.now() });
  (window as Window & { __STANZA_IDLE_CANVAS__?: typeof snapshot }).__STANZA_IDLE_CANVAS__ = snapshot;
  return {
    raf() { rafCallbacks++; },
    redrawn() { redraws++; },
    stop() { stopped = true; },
    nextFrame(request: (immediate?: boolean) => void, renderedState: AuthVisualState, nextState: AuthVisualState) {
      if (mode === 'idle-static' && nextState === 'idle') {
        // A completing active draw still used active-state inputs. Render one
        // final idle frame, then the next call takes the stop branch.
        if (renderedState !== 'idle') request(true);
        return;
      }
      request(false);
    },
  };
}
