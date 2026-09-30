export const FONT_SCALES = [0.95, 1, 1.1, 1.2] as const;

export function normaliseFontScale(value: unknown): number {
  return typeof value === 'number' && FONT_SCALES.includes(value as typeof FONT_SCALES[number]) ? value : 1;
}
export function applyFontScale(value: unknown) {
  if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty('--stanza-font-scale', String(normaliseFontScale(value)));
  }
}
