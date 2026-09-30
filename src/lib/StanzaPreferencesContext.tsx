import { applyFontScale, normaliseFontScale } from './typography';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  normaliseModuleUsage,
  type ModuleUsage,
} from '../components/navigation/module-usage';
import { readTutorialProgress } from '../components/tutorials/tutorial-state';
import type { TutorialProgress } from '../components/tutorials/tutorial-types';
import { applyBackgroundPreset, normaliseBackgroundPreset, type BackgroundPresetId } from './background-presets';

import { applyCustomAccent, hasCustomCursor, DEFAULT_CUSTOM_ACCENT, DEFAULT_CUSTOM_THEME, normaliseCustomAccent, normaliseCustomTheme, type CustomThemeConfig } from './custom-theme';
import CustomCursorEffect from '../components/CustomCursorEffect';

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
  fontScale: number;
  lightIntensity: LightIntensity;
  mobileShortcuts: string[];
  desktopRailOrder: string[];
  pinnedQuickActionIds: string[];
  pinnedQuickActionsCustomised: boolean;
  recentCommandIds: string[];
  moduleUsage: ModuleUsage;
  rosterPresentationMode: RosterPresentationMode;
  desktopNavigationMode: DesktopNavigationMode;
  backgroundPreset: BackgroundPresetId;
  customAccent: string;
  customTheme: CustomThemeConfig;
  tutorialsEnabled: boolean;
  tutorialsAutoStart: boolean;
  completedTutorials: Record<string, number>;
  dismissedTutorials: Record<string, number>;
};

const DEFAULT_PREFERENCES: StanzaPreferences = {
  lanyardEnabled: true,
  interfaceScale: 1,
  fontScale: 1,
  lightIntensity: DEFAULT_LIGHT_INTENSITY,
  mobileShortcuts: ['geofence', 'roster', 'feed', 'profile'],
  desktopRailOrder: [],
  pinnedQuickActionIds: [],
  pinnedQuickActionsCustomised: false,
  recentCommandIds: [],
  moduleUsage: {},
  rosterPresentationMode: 'auto',
  desktopNavigationMode: 'launcher',
  backgroundPreset: 'emerald',
  customAccent: DEFAULT_CUSTOM_ACCENT,
  customTheme: { ...DEFAULT_CUSTOM_THEME },
  tutorialsEnabled: true,
  tutorialsAutoStart: true,
  completedTutorials: {},
  dismissedTutorials: {},
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
    const customTheme = normaliseCustomTheme(parsed.customTheme, parsed.customAccent);
    const tutorials = readTutorialProgress(parsed);
    return {
      lanyardEnabled: typeof parsed.lanyardEnabled === 'boolean'
        ? parsed.lanyardEnabled
        : DEFAULT_PREFERENCES.lanyardEnabled,
      interfaceScale: typeof parsed.interfaceScale === 'number' && Number.isFinite(parsed.interfaceScale)
        ? clampScale(parsed.interfaceScale)
        : DEFAULT_PREFERENCES.interfaceScale,
      fontScale: normaliseFontScale(parsed.fontScale),
      lightIntensity: readLightIntensity(parsed.lightIntensity),
      mobileShortcuts: Array.isArray(parsed.mobileShortcuts)
        ? [...new Set(parsed.mobileShortcuts.filter((value): value is string => typeof value === 'string'))].slice(0, 20)
        : DEFAULT_PREFERENCES.mobileShortcuts,
      desktopRailOrder: Array.isArray(parsed.desktopRailOrder)
        ? [...new Set(parsed.desktopRailOrder.filter((value): value is string => typeof value === 'string'))].slice(0, 30)
        : DEFAULT_PREFERENCES.desktopRailOrder,
      pinnedQuickActionIds: Array.isArray(parsed.pinnedQuickActionIds)
        ? [...new Set(parsed.pinnedQuickActionIds.filter((value): value is string => typeof value === 'string' && value.length <= 120))].slice(0, 6)
        : DEFAULT_PREFERENCES.pinnedQuickActionIds,
      pinnedQuickActionsCustomised: parsed.pinnedQuickActionsCustomised === true,
      recentCommandIds: Array.isArray(parsed.recentCommandIds)
        ? [...new Set(parsed.recentCommandIds.filter((value): value is string => typeof value === 'string' && value.length <= 120))].slice(0, 6)
        : DEFAULT_PREFERENCES.recentCommandIds,
      moduleUsage: normaliseModuleUsage(parsed.moduleUsage),
      rosterPresentationMode: parsed.rosterPresentationMode === 'fit' || parsed.rosterPresentationMode === 'detailed'
        ? parsed.rosterPresentationMode
        : 'auto',
      desktopNavigationMode: parsed.desktopNavigationMode === 'rail'
        ? 'rail'
        : 'launcher',
      backgroundPreset: normaliseBackgroundPreset(parsed.backgroundPreset),
      customAccent: customTheme.accent,
      customTheme,
      ...tutorials,
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
  applyFontScale(preferences.fontScale);
  applyInterfaceScale(preferences.interfaceScale);
  applyLightIntensity(preferences.lightIntensity);
  applyCustomAccent(preferences.customTheme);
  applyBackgroundPreset(preferences.backgroundPreset);
  return preferences;
}

type StanzaPreferencesContextValue = StanzaPreferences & {
  setLanyardEnabled: (enabled: boolean) => void;
  setInterfaceScale: (scale: number) => void;
  setFontScale: (scale: number) => void;
  resetInterfaceScale: () => void;
  setLightIntensity: (intensity: number) => void;
  setMobileShortcuts: (shortcuts: string[]) => void;
  setDesktopRailOrder: (order: string[]) => void;
  setPinnedQuickActionIds: (commandIds: string[]) => void;
  resetPinnedQuickActions: () => void;
  setRecentCommandIds: (commandIds: string[]) => void;
  setModuleUsage: (moduleUsage: ModuleUsage) => void;
  resetModuleUsage: () => void;
  setRosterPresentationMode: (mode: RosterPresentationMode) => void;
  setDesktopNavigationMode: (mode: DesktopNavigationMode) => void;
  setBackgroundPreset: (preset: BackgroundPresetId) => void;
  setCustomAccent: (accent: string) => void;
  setCustomTheme: (config: CustomThemeConfig) => void;
  lanyardPreview: CustomThemeConfig["lanyardStyle"] | null;
  setLanyardPreview: (style: CustomThemeConfig["lanyardStyle"] | null) => void;
  updateTutorialProgress: (next: Partial<TutorialProgress>) => void;
};

const StanzaPreferencesContext = createContext<StanzaPreferencesContextValue | null>(null);

export function StanzaPreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<StanzaPreferences>(readStanzaPreferences);

  useEffect(() => {
    applyInterfaceScale(preferences.interfaceScale);
  }, [preferences.interfaceScale]);
  useEffect(() => applyFontScale(preferences.fontScale), [preferences.fontScale]);
  useEffect(() => applyLightIntensity(preferences.lightIntensity), [preferences.lightIntensity]);
  useEffect(() => applyBackgroundPreset(preferences.backgroundPreset), [preferences.backgroundPreset]);
  useEffect(() => applyCustomAccent(preferences.customTheme), [preferences.customTheme]);
  useEffect(() => {
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
      applyFontScale(nextPreferences.fontScale);
      applyInterfaceScale(nextPreferences.interfaceScale);
      applyLightIntensity(nextPreferences.lightIntensity);
      applyBackgroundPreset(nextPreferences.backgroundPreset);
      applyCustomAccent(nextPreferences.customTheme);
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

  const setFontScale = useCallback((scale: number) => {
    setPreferences(current => ({ ...current, fontScale: normaliseFontScale(scale) }));
  }, []);

  const resetInterfaceScale = useCallback(() => setInterfaceScale(1), [setInterfaceScale]);

  const setLightIntensity = useCallback((lightIntensity: number) => {
    setPreferences((current) => ({ ...current, lightIntensity: clampLightIntensity(lightIntensity) }));
  }, []);
  const setMobileShortcuts = useCallback((mobileShortcuts: string[]) => {
    const next = [...new Set(mobileShortcuts)].slice(0, 20);
    setPreferences((current) => current.mobileShortcuts.length === next.length
      && current.mobileShortcuts.every((value, index) => value === next[index])
      ? current
      : { ...current, mobileShortcuts: next });
  }, []);
  const setDesktopRailOrder = useCallback((desktopRailOrder: string[]) => {
    setPreferences((current) => ({ ...current, desktopRailOrder: [...new Set(desktopRailOrder)].slice(0, 30) }));
  }, []);
  const setPinnedQuickActionIds = useCallback((pinnedQuickActionIds: string[]) => {
    const next = [...new Set(pinnedQuickActionIds.filter((value) => typeof value === 'string' && value.length <= 120))].slice(0, 6);
    setPreferences((current) => current.pinnedQuickActionsCustomised
      && current.pinnedQuickActionIds.length === next.length
      && current.pinnedQuickActionIds.every((value, index) => value === next[index])
      ? current
      : { ...current, pinnedQuickActionIds: next, pinnedQuickActionsCustomised: true });
  }, []);
  const resetPinnedQuickActions = useCallback(() => {
    setPreferences((current) => ({
      ...current,
      pinnedQuickActionIds: [],
      pinnedQuickActionsCustomised: false,
    }));
  }, []);
  const setRecentCommandIds = useCallback((recentCommandIds: string[]) => {
    setPreferences((current) => ({
      ...current,
      recentCommandIds: [...new Set(recentCommandIds.filter((value) => typeof value === 'string' && value.length <= 120))].slice(0, 6),
    }));
  }, []);
  const setModuleUsage = useCallback((moduleUsage: ModuleUsage) => {
    setPreferences((current) => ({
      ...current,
      moduleUsage: normaliseModuleUsage(moduleUsage),
    }));
  }, []);
  const resetModuleUsage = useCallback(() => {
    setPreferences((current) => ({ ...current, moduleUsage: {} }));
  }, []);
  const setRosterPresentationMode = useCallback((rosterPresentationMode: RosterPresentationMode) => {
    setPreferences((current) => ({ ...current, rosterPresentationMode }));
  }, []);
  const setDesktopNavigationMode = useCallback((desktopNavigationMode: DesktopNavigationMode) => {
    setPreferences((current) => ({ ...current, desktopNavigationMode }));
  }, []);
  const setBackgroundPreset = useCallback((backgroundPreset: BackgroundPresetId) => {
    setPreferences((current) => ({ ...current, backgroundPreset: normaliseBackgroundPreset(backgroundPreset) }));
  }, []);
  const setCustomAccent = useCallback((value: string) => {
    const customAccent = normaliseCustomAccent(value);
    if (customAccent) setPreferences((current) => current.customAccent === customAccent ? current : {
      ...current, customAccent, customTheme: { ...current.customTheme, accent: customAccent },
    });
  }, []);
  const setCustomTheme = useCallback((value: CustomThemeConfig) => {
    const customTheme = normaliseCustomTheme(value);
    setPreferences((current) => ({ ...current, customTheme, customAccent: customTheme.accent }));
  }, []);
  const updateTutorialProgress = useCallback((next: Partial<TutorialProgress>) => {
    setPreferences((current) => ({
      ...current,
      ...readTutorialProgress({ ...current, ...next }),
    }));
  }, []);

  const [lanyardPreview, setLanyardPreview] = useState<CustomThemeConfig["lanyardStyle"] | null>(null);
  const value = useMemo<StanzaPreferencesContextValue>(() => ({
    ...preferences,
    lanyardPreview, setLanyardPreview,
    setLanyardEnabled,
    setFontScale,
    setInterfaceScale,
    resetInterfaceScale,
    setLightIntensity,
    setMobileShortcuts,
    setDesktopRailOrder,
    setPinnedQuickActionIds,
    resetPinnedQuickActions,
    setRecentCommandIds,
    setModuleUsage,
    resetModuleUsage,
    setRosterPresentationMode,
    setDesktopNavigationMode,
    setBackgroundPreset,
    setCustomAccent,
    setCustomTheme,
    updateTutorialProgress,
  }), [preferences, setFontScale, lanyardPreview, setCustomTheme, setCustomAccent, resetInterfaceScale, resetModuleUsage, resetPinnedQuickActions, setBackgroundPreset, setDesktopNavigationMode, setDesktopRailOrder, setInterfaceScale, setLanyardEnabled, setLightIntensity, setMobileShortcuts, setModuleUsage, setPinnedQuickActionIds, setRecentCommandIds, setRosterPresentationMode, updateTutorialProgress]);

  return <StanzaPreferencesContext.Provider value={value}>{children}
    {preferences.backgroundPreset === 'custom' && hasCustomCursor(preferences.customTheme)
      && <CustomCursorEffect config={preferences.customTheme} />}
  </StanzaPreferencesContext.Provider>;
}

export function useStanzaPreferences() {
  const context = useContext(StanzaPreferencesContext);
  if (!context) throw new Error('useStanzaPreferences must be used within StanzaPreferencesProvider.');
  return context;
}
