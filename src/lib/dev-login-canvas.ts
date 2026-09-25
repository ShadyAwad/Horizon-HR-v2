// Bounded per-mount DEV measurements: no samples, timers, React updates or DOM writes.
// Inspect window.__stanzaLoginCanvasMeasurements in the existing Chrome console.
export function createLoginCanvasMeasurement() {
  const measurement = {
    frames: 0, totalCallbackMs: 0, averageCallbackMs: 0, worstCallbackMs: 0,
    paletteResolutions: 0, themeReads: 0, tokenReads: 0, colorParses: 0,
    legacyEquivalentThemeReads: 0, legacyEquivalentColorParses: 0,
    allocations: 'unavailable', limit: 600, stopped: false,
  };
  const target = window as Window & { __stanzaLoginCanvasMeasurements?: typeof measurement[] };
  const measurements = target.__stanzaLoginCanvasMeasurements ??= [];
  measurements.push(measurement);
  if (measurements.length > 4) measurements.shift();
  return {
    palette() {
      if (measurement.stopped) return;
      measurement.paletteResolutions++;
      measurement.themeReads++;
      measurement.tokenReads += 3;
      measurement.colorParses += 2;
    },
    frame(duration: number, rings: number) {
      if (measurement.stopped) return;
      measurement.frames++;
      measurement.totalCallbackMs += duration;
      measurement.averageCallbackMs = measurement.totalCallbackMs / measurement.frames;
      measurement.worstCallbackMs = Math.max(measurement.worstCallbackMs, duration);
      // Counter equivalents only; these are not executed or timing comparisons.
      measurement.legacyEquivalentThemeReads++;
      measurement.legacyEquivalentColorParses += rings * 2;
      if (measurement.frames >= measurement.limit) measurement.stopped = true;
    },
    get active() { return !measurement.stopped; },
    stop() { measurement.stopped = true; },
  };
}
