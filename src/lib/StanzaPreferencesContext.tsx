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
export const LIGHT_INTENSITIES = ['bright', 'balanced', 'deep'] as const;

export type LightIntensity = typeof LIGHT_INTENSITIES[number];

export type StanzaPreferences = {
  lanyardEnabled: boolean;
  interfaceScale: number;
  lightIntensity: LightIntensity;
};

const DEFAULT_PREFERENCES: StanzaPreferences = {
  lanyardEnabled: true,
  interfaceScale: 1,
  lightIntensity: 'balanced',
};

export function isLightIntensity(value: unknown): value is LightIntensity {
  return typeof value === 'string' && LIGHT_INTENSITIES.includes(value as LightIntensity);
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
      lightIntensity: isLightIntensity(parsed.lightIntensity)
        ? parsed.lightIntensity
        : DEFAULT_PREFERENCES.lightIntensity,
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
  document.documentElement.dataset.lightIntensity = isLightIntensity(lightIntensity)
    ? lightIntensity
    : DEFAULT_PREFERENCES.lightIntensity;
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
  setLightIntensity: (intensity: LightIntensity) => void;
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

  const setLightIntensity = useCallback((lightIntensity: LightIntensity) => {
    setPreferences((current) => ({ ...current, lightIntensity }));
  }, []);

  const value = useMemo<StanzaPreferencesContextValue>(() => ({
    ...preferences,
    setLanyardEnabled,
    setInterfaceScale,
    resetInterfaceScale,
    setLightIntensity,
  }), [preferences, resetInterfaceScale, setInterfaceScale, setLanyardEnabled, setLightIntensity]);

  return <StanzaPreferencesContext.Provider value={value}>{children}</StanzaPreferencesContext.Provider>;
}

export function useStanzaPreferences() {
  const context = useContext(StanzaPreferencesContext);
  if (!context) throw new Error('useStanzaPreferences must be used within StanzaPreferencesProvider.');
  return context;
}
