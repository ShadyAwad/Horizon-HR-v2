export const PERFORMANCE_ISOLATION_STORAGE_KEY = 'stanza.performance-isolation.v1';

export type PerformanceIsolation = Record<
  'lanyard' | 'topography' | 'atmosphere' | 'shadows' | 'translucentSurfaces' |
  'settingsBackdrop' | 'tutorials' | 'attentionPolling' | 'recentFrequent' |
  'badges' | 'mobileNavigation' | 'geoSecondaryPanels' | 'transitions' | 'visualAtmosphere',
  boolean
>;

export const defaultPerformanceIsolation: PerformanceIsolation = {
  lanyard: true, topography: true, atmosphere: true, shadows: true,
  translucentSurfaces: true, settingsBackdrop: true, tutorials: true,
  attentionPolling: true, recentFrequent: true, badges: true,
  mobileNavigation: true, geoSecondaryPanels: true, transitions: true,
  visualAtmosphere: true,
};

export function normalisePerformanceIsolation(value: unknown): PerformanceIsolation {
  if (!value || typeof value !== 'object') return defaultPerformanceIsolation;
  const candidate = value as Partial<PerformanceIsolation>;
  return Object.fromEntries(Object.entries(defaultPerformanceIsolation).map(([key, fallback]) => [key, typeof candidate[key as keyof PerformanceIsolation] === 'boolean' ? candidate[key as keyof PerformanceIsolation] : fallback])) as PerformanceIsolation;
}
