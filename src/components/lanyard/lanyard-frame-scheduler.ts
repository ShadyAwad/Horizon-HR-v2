export type LanyardFrameTier = 'active' | 'passive' | 'settled';
export const FULL_LANYARD_RATES = { active: 60, passive: 24 } as const;
export const LIGHT_LANYARD_RATES = { active: 45, passive: 20 } as const;
export const VERY_LIGHT_LANYARD_RATES = { active: 30, passive: 15 } as const;
export const MAX_LANYARD_DELTA_SECONDS = .1;

type SchedulerHost = {
  now: () => number;
  timeout: (callback: () => void, delay: number) => number;
  clearTimeout: (handle: number) => void;
  raf: (callback: (now: number) => void) => number;
  cancelRaf: (handle: number) => void;
};
type Options = {
  host: SchedulerHost;
  initialTime: number;
  initialTier: LanyardFrameTier;
  rates: () => { active: number; passive: number };
  advance: (simulationTime: number) => void;
  onTier?: (tier: LanyardFrameTier, previous: LanyardFrameTier) => void;
  onPending?: (timer: boolean, raf: boolean) => void;
};

/** Sole owner of this canvas's frames. Rapier invalidation is disabled by R3F
 * frameloop="never". The injectable clock tests the same scheduler we ship. */
export function createLanyardFrameScheduler(options: Options) {
  const { host } = options;
  let tier = options.initialTier;
  let paused = false;
  let disposed = false;
  let advancing = false;
  let timer: number | undefined;
  let raf: number | undefined;
  let deadline: number | undefined;
  let lastFrame: number | undefined;
  let simulationTime = options.initialTime;

  const pending = () => options.onPending?.(timer !== undefined, raf !== undefined);
  const cancel = () => {
    if (timer !== undefined) host.clearTimeout(timer);
    if (raf !== undefined) host.cancelRaf(raf);
    timer = raf = undefined;
    pending();
  };
  const stop = () => { cancel(); deadline = lastFrame = undefined; };
  const running = () => tier !== 'settled' && !paused && !disposed;
  const schedule = () => {
    if (disposed || paused || tier === 'settled' || advancing || timer !== undefined || raf !== undefined) return;
    deadline ??= host.now();
    timer = host.timeout(() => {
      timer = undefined;
      raf = host.raf(tick);
      pending();
    }, Math.max(0, deadline - host.now() - 8));
    pending();
  };
  const tick = (now: number) => {
    raf = undefined;
    pending();
    if (disposed || paused || tier === 'settled') return;
    if (now + .1 < deadline!) { raf = host.raf(tick); pending(); return; }
    const elapsed = lastFrame === undefined ? 1 / 60 : Math.max(0, Math.min((now - lastFrame) / 1000, MAX_LANYARD_DELTA_SECONDS));
    lastFrame = now;
    simulationTime += elapsed;
    advancing = true;
    try { options.advance(simulationTime); }
    finally { advancing = false; }
    if (running()) {
      deadline = Math.max((deadline ?? now) + 1000 / options.rates()[tier], now);
      schedule();
    }
  };
  const request = (next: LanyardFrameTier = tier) => {
    if (disposed) return;
    const previous = tier;
    tier = next;
    if (previous !== next) options.onTier?.(next, previous);
    if (tier === 'settled') { stop(); return; }
    if (previous !== next) { cancel(); deadline = undefined; }
    schedule();
  };
  return {
    request,
    setPaused(value: boolean) {
      if (paused === value || disposed) return;
      paused = value;
      if (paused) stop();
      else schedule(); // A settled scene stays settled on Settings/visibility recovery.
    },
    dispose() { disposed = true; stop(); },
    snapshot: () => ({ tier, paused, disposed, timerPending: timer !== undefined, rafPending: raf !== undefined, simulationTime }),
  };
}
