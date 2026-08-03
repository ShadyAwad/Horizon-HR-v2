export const BACKGROUND_PRESET_IDS = ['default', 'emerald', 'slate', 'midnight', 'graphite', 'warm_sand'] as const;

export type BackgroundPresetId = (typeof BACKGROUND_PRESET_IDS)[number];

export type BackgroundPreset = {
  id: BackgroundPresetId;
  labelKey: string;
  descriptionKey: string;
  lightPreview: string;
  darkPreview: string;
};

export const backgroundPresets: readonly BackgroundPreset[] = [
  { id: 'default', labelKey: 'background.default', descriptionKey: 'background.defaultDescription', lightPreview: '#f4faf6', darkPreview: '#020403' },
  { id: 'emerald', labelKey: 'background.emerald', descriptionKey: 'background.emeraldDescription', lightPreview: '#e8f5ed', darkPreview: '#082219' },
  { id: 'slate', labelKey: 'background.slate', descriptionKey: 'background.slateDescription', lightPreview: '#eef3f7', darkPreview: '#101923' },
  { id: 'midnight', labelKey: 'background.midnight', descriptionKey: 'background.midnightDescription', lightPreview: '#eef2f8', darkPreview: '#0a1325' },
  { id: 'graphite', labelKey: 'background.graphite', descriptionKey: 'background.graphiteDescription', lightPreview: '#f2f3f3', darkPreview: '#171a1c' },
  { id: 'warm_sand', labelKey: 'background.warmSand', descriptionKey: 'background.warmSandDescription', lightPreview: '#f8f3e9', darkPreview: '#25211d' },
];

export function isBackgroundPresetId(value: unknown): value is BackgroundPresetId {
  return typeof value === 'string' && (BACKGROUND_PRESET_IDS as readonly string[]).includes(value);
}

export function normaliseBackgroundPreset(value: unknown): BackgroundPresetId {
  return isBackgroundPresetId(value) ? value : 'default';
}

export function applyBackgroundPreset(preset: unknown) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.backgroundPreset = normaliseBackgroundPreset(preset);
}
