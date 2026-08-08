export const BACKGROUND_PRESET_IDS = ['emerald', 'slate', 'midnight', 'graphite', 'warm_sand', 'amethyst', 'ember'] as const;

export type BackgroundPresetId = (typeof BACKGROUND_PRESET_IDS)[number];

export type BackgroundPreset = {
  id: BackgroundPresetId;
  labelKey: string;
  descriptionKey: string;
  lightPreview: string;
  darkPreview: string;
};

export const backgroundPresets: readonly BackgroundPreset[] = [
  { id: 'emerald', labelKey: 'background.emerald', descriptionKey: 'background.emeraldDescription', lightPreview: '#e8f5ed', darkPreview: '#082219' },
  { id: 'slate', labelKey: 'background.slate', descriptionKey: 'background.slateDescription', lightPreview: '#eef3f7', darkPreview: '#101923' },
  { id: 'midnight', labelKey: 'background.midnight', descriptionKey: 'background.midnightDescription', lightPreview: '#eef2f8', darkPreview: '#0a1325' },
  { id: 'graphite', labelKey: 'background.graphite', descriptionKey: 'background.graphiteDescription', lightPreview: '#f2f3f3', darkPreview: '#171a1c' },
  { id: 'warm_sand', labelKey: 'background.warmSand', descriptionKey: 'background.warmSandDescription', lightPreview: '#f8f3e9', darkPreview: '#25211d' },
  { id: 'amethyst', labelKey: 'background.amethyst', descriptionKey: 'background.amethystDescription', lightPreview: '#f5f0fb', darkPreview: '#1d162b' },
  { id: 'ember', labelKey: 'background.ember', descriptionKey: 'background.emberDescription', lightPreview: '#fbf1ee', darkPreview: '#2a1819' },
];

export function isBackgroundPresetId(value: unknown): value is BackgroundPresetId {
  return typeof value === 'string' && (BACKGROUND_PRESET_IDS as readonly string[]).includes(value);
}

export function normaliseBackgroundPreset(value: unknown): BackgroundPresetId {
  // `default` was the original emerald Stanza theme. Keep existing browser
  // preferences intact by migrating that legacy value rather than resetting it.
  if (value === 'default') return 'emerald';
  return isBackgroundPresetId(value) ? value : 'emerald';
}

export function applyBackgroundPreset(preset: unknown) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.backgroundPreset = normaliseBackgroundPreset(preset);
}
