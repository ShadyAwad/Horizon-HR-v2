import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export const STANZA_PREFERENCES_KEY = 'stanza.preferences.v1';
export const MIN_INTERFACE_SCALE = 0.85;
export const MAX_INTERFACE_SCALE = 1.2;
export const INTERFACE_SCALE_STEP = 0.05;
export const LIGHT_INTENSITY_STOPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100] as const;
export const DEFAULT_LIGHT_INTENSITY = 50;

export type LightIntensity = number;
export type RosterPresentationMode = 'auto' | 'fit' | 'detailed';
export type DesktopNavigationMode = 'launcher' | 'rail';

export type StanzaPreferences = {
  lanyardEnabled: boolean;
  interfaceScale: number;
  lightIntensity: LightIntensity;
  mobileShortcuts: string[];
  rosterPresentationMode: RosterPresentationMode;
  desktopNavigationMode: DesktopNavigationMode;
};

const DEFAULT_PREFERENCES: StanzaPreferences = {
  lanyardEnabled: true,
  interfaceScale: 1,
  lightIntensity: DEFAULT_LIGHT_INTENSITY,
  mobileShortcuts: ['geofence', 'roster', 'feed', 'profile'],
  rosterPresentationMode: 'auto',
  desktopNavigationMode: 'launcher',
};

export function clampLightIntensity(value: unknown): LightIntensity {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_LIGHT_INTENSITY;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function resolveLightIntensityStop(value: LightIntensity) {
  const normalized = clampLightIntensity(value);
  return LIGHT_INTENSITY_STOPS.reduce((nearest, stop) => (
    Math.abs(stop - normalized) < Math.abs(nearest - normalized) ? stop : nearest
  ), LIGHT_INTENSITY_STOPS[0]);
}

function readLightIntensity(value: unknown): LightIntensity {
  if (value === 'bright') return 15;
  if (value === 'balanced') return 50;
  if (value === 'deep') return 85;
  return clampLightIntensity(value);
}

const clampScale = (value: number) => Math.min(
  MAX_INTERFACE_SCALE,
  Math.max(MIN_INTERFACE_SCALE, Math.round(value * 100) / 100),
);

export function readStanzaPreferences(rawValue?: string | null): StanzaPreferences {
  try {
    const stored = rawValue === undefined
      ? (typeof window === 'undefined' ? null : window.localStorage.getItem(STANZA_PREFERENCES_KEY))
      : rawValue;
    if (!stored) return DEFAULT_PREFERENCES;

    const parsed = JSON.parse(stored) as Partial<StanzaPreferences>;
    return {
      lanyardEnabled: typeof parsed.lanyardEnabled === 'boolean'
        ? parsed.lanyardEnabled
        : DEFAULT_PREFERENCES.lanyardEnabled,
      interfaceScale: typeof parsed.interfaceScale === 'number' && Number.isFinite(parsed.interfaceScale)
        ? clampScale(parsed.interfaceScale)
        : DEFAULT_PREFERENCES.interfaceScale,
      lightIntensity: readLightIntensity(parsed.lightIntensity),
      mobileShortcuts: Array.isArray(parsed.mobileShortcuts)
        ? [...new Set(parsed.mobileShortcuts.filter((value): value is string => typeof value === 'string'))].slice(0, 20)
        : DEFAULT_PREFERENCES.mobileShortcuts,
      rosterPresentationMode: parsed.rosterPresentationMode === 'fit' || parsed.rosterPresentationMode === 'detailed'
        ? parsed.rosterPresentationMode
        : 'auto',
      desktopNavigationMode: parsed.desktopNavigationMode === 'rail'
        ? 'rail'
        : 'launcher',
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function applyInterfaceScale(interfaceScale: number) {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--stanza-ui-scale', String(clampScale(interfaceScale)));
}

export function applyLightIntensity(lightIntensity: LightIntensity) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.lightIntensity = String(resolveLightIntensityStop(lightIntensity));
}

export function initializeStanzaPreferences() {
  const preferences = readStanzaPreferences();
  applyInterfaceScale(preferences.interfaceScale);
  applyLightIntensity(preferences.lightIntensity);
  return preferences;
}

type StanzaPreferencesContextValue = StanzaPreferences & {
  setLanyardEnabled: (enabled: boolean) => void;
  setInterfaceScale: (scale: number) => void;
  resetInterfaceScale: () => void;
  setLightIntensity: (intensity: number) => void;
  setMobileShortcuts: (shortcuts: string[]) => void;
  setRosterPresentationMode: (mode: RosterPresentationMode) => void;
  setDesktopNavigationMode: (mode: DesktopNavigationMode) => void;
};

const StanzaPreferencesContext = createContext<StanzaPreferencesContextValue | null>(null);

export function StanzaPreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<StanzaPreferences>(readStanzaPreferences);

  useEffect(() => {
    applyInterfaceScale(preferences.interfaceScale);
    applyLightIntensity(preferences.lightIntensity);
    try {
      window.localStorage.setItem(STANZA_PREFERENCES_KEY, JSON.stringify(preferences));
    } catch {
      // Preferences remain usable for this session when storage is unavailable.
    }
  }, [preferences]);

  useEffect(() => {
    const syncPreferences = (event: StorageEvent) => {
      if (event.key !== STANZA_PREFERENCES_KEY) return;
      const nextPreferences = readStanzaPreferences(event.newValue);
      applyInterfaceScale(nextPreferences.interfaceScale);
      applyLightIntensity(nextPreferences.lightIntensity);
      setPreferences(nextPreferences);
    };

    window.addEventListener('storage', syncPreferences);
    return () => window.removeEventListener('storage', syncPreferences);
  }, []);

  const setLanyardEnabled = useCallback((enabled: boolean) => {
    setPreferences((current) => ({ ...current, lanyardEnabled: enabled }));
  }, []);

  const setInterfaceScale = useCallback((scale: number) => {
    setPreferences((current) => ({ ...current, interfaceScale: clampScale(scale) }));
  }, []);

  const resetInterfaceScale = useCallback(() => setInterfaceScale(1), [setInterfaceScale]);

  const setLightIntensity = useCallback((lightIntensity: number) => {
    setPreferences((current) => ({ ...current, lightIntensity: clampLightIntensity(lightIntensity) }));
  }, []);
  const setMobileShortcuts = useCallback((mobileShortcuts: string[]) => {
    setPreferences((current) => ({ ...current, mobileShortcuts: [...new Set(mobileShortcuts)].slice(0, 20) }));
  }, []);
  const setRosterPresentationMode = useCallback((rosterPresentationMode: RosterPresentationMode) => {
    setPreferences((current) => ({ ...current, rosterPresentationMode }));
  }, []);
  const setDesktopNavigationMode = useCallback((desktopNavigationMode: DesktopNavigationMode) => {
    setPreferences((current) => ({ ...current, desktopNavigationMode }));
  }, []);

  const value = useMemo<StanzaPreferencesContextValue>(() => ({
    ...preferences,
    setLanyardEnabled,
    setInterfaceScale,
    resetInterfaceScale,
    setLightIntensity,
    setMobileShortcuts,
    setRosterPresentationMode,
    setDesktopNavigationMode,
  }), [preferences, resetInterfaceScale, setDesktopNavigationMode, setInterfaceScale, setLanyardEnabled, setLightIntensity, setMobileShortcuts, setRosterPresentationMode]);

  return <StanzaPreferencesContext.Provider value={value}>{children}</StanzaPreferencesContext.Provider>;
}

export function useStanzaPreferences() {
  const context = useContext(StanzaPreferencesContext);
  if (!context) throw new Error('useStanzaPreferences must be used within StanzaPreferencesProvider.');
  return context;
}
