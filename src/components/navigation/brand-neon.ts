type NeonEnvironment = {
  document: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>;
  queries: MediaQueryList[];
  setTimeout: (fn: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
  random: () => number;
};

/** One pending timer, a finite electrical event, and no frame or React update loop. */
export function startBrandFlicker(mark: Pick<HTMLElement, 'setAttribute' | 'removeAttribute'>, env: NeonEnvironment) {
  let timer: number | undefined;
  let disposed = false;
  const random = () => Math.min(1, Math.max(0, env.random()));
  const enabled = () => !disposed && !env.document.hidden && !env.queries.some(q => q.matches);
  const clear = () => {
    if (timer !== undefined) env.clearTimeout(timer);
    timer = undefined;
    mark.removeAttribute('data-neon-power');
  };
  const later = (fn: () => void, ms: number) => {
    timer = env.setTimeout(() => { timer = undefined; if (enabled()) fn(); }, ms);
  };
  const schedule = () => {
    if (!enabled()) return;
    later(() => {
      mark.setAttribute('data-neon-power', 'dip');
      later(() => {
        mark.removeAttribute('data-neon-power');
        schedule();
      }, 65 + random() * 35);
    }, 75_000 + random() * 105_000);
  };
  const sync = () => { clear(); schedule(); };
  env.document.addEventListener('visibilitychange', sync);
  for (const q of env.queries) q.addEventListener('change', sync);
  schedule();
  return () => {
    disposed = true; clear();
    env.document.removeEventListener('visibilitychange', sync);
    for (const q of env.queries) q.removeEventListener('change', sync);
  };
}
