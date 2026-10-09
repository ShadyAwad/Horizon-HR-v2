export const FONT_SCALES = [0.95, 1, 1.1, 1.2] as const;

export function normaliseFontScale(value: unknown): number {
  return typeof value === 'number' && FONT_SCALES.includes(value as typeof FONT_SCALES[number]) ? value : 1;
}
export function applyFontScale(value: unknown) {
  if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty('--stanza-font-scale', String(normaliseFontScale(value)));
  }
}

// Each profile has an explicit Arabic companion. CSS loads only faces used by
// rendered text; downloaded faces are same-origin PWA runtime-cache assets.
export const FONT_PROFILES = [
  { id: 'modern', label: 'Modern', labelAr: 'عصري', latin: 'Inter', arabic: 'Noto Sans Arabic' },
  { id: 'technical', label: 'Technical', labelAr: 'تقني', latin: 'IBM Plex Sans', arabic: 'IBM Plex Sans Arabic' },
  { id: 'comfortable', label: 'Comfortable', labelAr: 'مريح', latin: 'Manrope', arabic: 'Noto Sans Arabic' },
  { id: 'system', label: 'System', labelAr: 'خط الجهاز', latin: 'System UI', arabic: 'Tahoma / Arial' },
] as const;
export type FontProfileId = typeof FONT_PROFILES[number]['id'];
export function normaliseFontProfile(value: unknown): FontProfileId {
  return FONT_PROFILES.some(profile => profile.id === value) ? value as FontProfileId : 'modern';
}
export function applyFontProfile(value: unknown) {
  if (typeof document !== 'undefined') document.documentElement.dataset.fontProfile = normaliseFontProfile(value);
}
