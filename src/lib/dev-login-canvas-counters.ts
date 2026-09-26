export function createCanvasSchedulerCounters() {
  let visibleSince: number | null = document.hidden ? null : performance.now();
  let visibleMs = 0;
  const seconds = () => (visibleMs + (visibleSince === null ? 0 : performance.now() - visibleSince)) / 1000;
  const record = {
    mode: 'production', rafCallbacks: 0, drawFrameCalls: 0, redraws: 0, totalDrawMs: 0, stopped: false,
    get visibleSeconds() { return seconds(); },
    get rafPerSecond() { return seconds() > 0 ? this.rafCallbacks / seconds() : 0; },
    get drawFramePerSecond() { return seconds() > 0 ? this.drawFrameCalls / seconds() : 0; },
    get averageDrawMs() { return this.redraws ? this.totalDrawMs / this.redraws : 0; },
  };
  const target = window as Window & { __stanzaCanvasSchedulers?: typeof record[] };
  const records = target.__stanzaCanvasSchedulers ??= [];
  records.push(record);
  if (records.length > 4) records.shift();
  const visibility = () => {
    if (visibleSince !== null) visibleMs += performance.now() - visibleSince;
    visibleSince = document.hidden || record.stopped ? null : performance.now();
  };
  return {
    raf() { record.rafCallbacks++; },
    draw() { record.drawFrameCalls++; return performance.now(); },
    redrawn(start: number) { record.redraws++; record.totalDrawMs += performance.now() - start; },
    visibility,
    stop() { record.stopped = true; visibility(); },
  };
}
