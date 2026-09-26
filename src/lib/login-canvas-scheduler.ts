import type { AuthVisualState } from '../auth/auth-contract';

type Host = {
  now(): number;
  raf(callback: (time: number) => void): number;
  cancelRaf(id: number): void;
  timer(callback: () => void, delay: number): number;
  cancelTimer(id: number): void;
  hidden(): boolean;
};

/** Production cadence: real-time artwork, 24 FPS idle target; no full-rate skip loop. */
export function createCanvasCadence(host: Host, draw: (time: number) => void, state: () => AuthVisualState) {
  let raf: number | undefined;
  let timer: number | undefined;
  let lastFrame = -Infinity;
  let disposed = false;
  const cancel = () => {
    if (raf !== undefined) host.cancelRaf(raf);
    if (timer !== undefined) host.cancelTimer(timer);
    raf = timer = undefined;
  };
  const enqueue = () => {
    if (disposed || host.hidden() || raf !== undefined) return;
    raf = host.raf((time) => {
      raf = undefined;
      if (disposed || host.hidden()) return;
      lastFrame = time;
      draw(time);
    });
  };
  return {
    request(immediate = true) {
      if (disposed || host.hidden()) return;
      if (immediate) {
        if (timer !== undefined) host.cancelTimer(timer);
        timer = undefined;
        enqueue();
      } else if (raf === undefined && timer === undefined) {
        const delay = state() === 'idle' ? Math.max(0, 1000 / 24 - (host.now() - lastFrame)) : 0;
        if (delay > 0) timer = host.timer(() => { timer = undefined; enqueue(); }, delay);
        else enqueue();
      }
    },
    cancel,
    stop() { disposed = true; cancel(); },
  };
}

