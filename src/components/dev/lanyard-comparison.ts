type Sample = { at: number; kind: string; duration: number; tier: string };

/** Summarize real work samples; wall-clock intervals deliberately exclude idle gaps. */
export function summarizeLanyardCapture(samples: Sample[]) {
  const gestures: Array<{ start: number; end: number | null }> = [];
  for (const sample of samples) {
    if (sample.kind === 'drag-start') gestures.push({ start: sample.at, end: null });
    if (sample.kind === 'drag-end' && gestures.at(-1)?.end === null) gestures.at(-1)!.end = sample.at;
  }
  const work = (input: Sample[]) => {
    const durations = (kind: string) => {
      const values = input.filter(s => s.kind === kind).map(s => s.duration);
      return { count: values.length, totalMs: values.reduce((a, b) => a + b, 0), meanMs: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null, maxMs: values.length ? Math.max(...values) : null };
    };
    const frames = input.filter(s => s.kind === 'frame');
    const intervals = frames.slice(1).map((s, i) => s.at - frames[i].at);
    return { actualFrames: frames.length, actualFps: frames.length > 1 && frames.at(-1)!.at > frames[0].at ? (frames.length - 1) * 1000 / (frames.at(-1)!.at - frames[0].at) : null, renderSubmission: durations('render'), physics: durations('physics'), pointerHandler: durations('pointer'), pointerTarget: durations('pointer-target'), r3fAdvanceInclusive: durations('advance'), averageFrameIntervalMs: intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : null, worstFrameIntervalMs: intervals.length ? Math.max(...intervals) : null };
  };
  return {
    wholeCapture: work(samples), wakeCount: samples.filter(s => s.kind === 'wake').length,
    tiers: [...new Set(samples.map(s => s.tier))], sampleLimitReached: samples.length >= 20000,
    gestures: gestures.map(({ start, end }) => ({
      durationMs: end === null ? null : end - start,
      sustainedFiveSeconds: end !== null && end - start >= 4500,
      settleMs: end === null ? null : (() => { const settled = samples.find(s => s.kind === 'settled' && s.at >= end); const nextDrag = samples.find(s => s.kind === 'drag-start' && s.at > start); return settled && (!nextDrag || settled.at < nextDrag.at) ? settled.at - end : null; })(),
      work: work(samples.filter(s => s.at >= start && (end === null || s.at <= end))),
    })),
  };
}
