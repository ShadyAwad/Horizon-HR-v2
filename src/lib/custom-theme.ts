export const DEFAULT_CUSTOM_ACCENT = '#6366F1';

export const CURSOR_EFFECTS = ['none', 'glow', 'dot-trail', 'lerp-trail', 'portfolio-trail', 'comet', 'ribbon', 'sparks', 'orbit'] as const;
export const CURSOR_APPEARANCES = ['system', 'dot', 'ring', 'dot-ring', 'crosshair', 'orb', 'minimal-arrow'] as const;
export type CursorAppearance = (typeof CURSOR_APPEARANCES)[number];
export type LanyardStyle = { appearanceMode?: 'theme' | 'custom'; cardColor: string | null; accentColor: string | null; strapColor: string | null };
export type CustomThemeConfig = {
  lanyardStyle: LanyardStyle;
  accent: string;
  textColor: string | null;
  hoverHighlight: string | null;
  primaryAction: string | null;
  secondaryAction: string | null;
  surfaceTint: string | null;
  backgroundTint: string | null;
  cursorEffect: (typeof CURSOR_EFFECTS)[number];
  cursorColor: string | null;
  cursorTrailIntensity: number;
  cursorTrailLength: number;
  cursorAppearance: CursorAppearance;
  pointerColor: string | null;
  pointerSize: number;
  pointerOpacity: number;
  pointerOutline: number;
  pointerGlow: number;
  cursorTrailSize: number;
  cursorTrailGlow: number;
  cursorSmoothness: number;
  cursorFadeSpeed: number;
  cursorVelocityResponse: number;
};
export const DEFAULT_CUSTOM_THEME: Readonly<CustomThemeConfig> = Object.freeze({
  lanyardStyle: { appearanceMode: 'theme' as const, cardColor: null, accentColor: null, strapColor: null },
  hoverHighlight: null, textColor: null, accent: DEFAULT_CUSTOM_ACCENT, primaryAction: null, secondaryAction: null,
  surfaceTint: null, backgroundTint: null, cursorEffect: 'none', cursorColor: null,
  cursorTrailIntensity: 40, cursorTrailLength: 6,
  cursorAppearance: 'system', pointerColor: null, pointerSize: 16, pointerOpacity: 90,
  pointerOutline: 2, pointerGlow: 0, cursorTrailSize: 6, cursorTrailGlow: 0,
  cursorSmoothness: 50, cursorFadeSpeed: 50, cursorVelocityResponse: 40,
});

export function normaliseCustomTheme(value: unknown, legacyAccent?: unknown): CustomThemeConfig {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const bounded = (value: unknown, fallback: number, min: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback;
  return {
    lanyardStyle: normaliseLanyardStyle(raw.lanyardStyle),
    accent: normaliseCustomAccent(raw.accent) ?? normaliseCustomAccent(legacyAccent) ?? DEFAULT_CUSTOM_ACCENT,
    primaryAction: normaliseCustomAccent(raw.primaryAction), secondaryAction: normaliseCustomAccent(raw.secondaryAction),
    surfaceTint: normaliseCustomAccent(raw.surfaceTint), backgroundTint: normaliseCustomAccent(raw.backgroundTint),
    textColor: normaliseCustomAccent(raw.textColor),
    hoverHighlight: normaliseCustomAccent(raw.hoverHighlight),
    cursorColor: normaliseCustomAccent(raw.cursorColor),
    cursorAppearance: CURSOR_APPEARANCES.includes(raw.cursorAppearance as CursorAppearance) ? raw.cursorAppearance as CursorAppearance : 'system',
    pointerColor: normaliseCustomAccent(raw.pointerColor),
    pointerSize: bounded(raw.pointerSize, 16, 6, 32),
    pointerOpacity: bounded(raw.pointerOpacity, 90, 35, 100),
    pointerOutline: bounded(raw.pointerOutline, 2, 1, 4),
    pointerGlow: bounded(raw.pointerGlow, 0, 0, 80),
    cursorTrailSize: bounded(raw.cursorTrailSize, 6, 2, 14),
    cursorTrailGlow: bounded(raw.cursorTrailGlow, 0, 0, 80),
    cursorSmoothness: bounded(raw.cursorSmoothness, 50, 0, 100),
    cursorFadeSpeed: bounded(raw.cursorFadeSpeed, 50, 0, 100),
    cursorVelocityResponse: bounded(raw.cursorVelocityResponse, 40, 0, 100),
    cursorEffect: CURSOR_EFFECTS.includes(raw.cursorEffect as CustomThemeConfig['cursorEffect'])
      ? raw.cursorEffect as CustomThemeConfig['cursorEffect'] : 'none',
    cursorTrailIntensity: bounded(raw.cursorTrailIntensity, 40, 10, 80),
    cursorTrailLength: bounded(raw.cursorTrailLength, 6, 3, 12),
  };
}

export function normaliseCustomAccent(value: unknown): string | null {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim().toUpperCase() : null;
}

const rgb = (hex: string) => [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
export function mixColor(a: string, b: string, amount: number) {
  const other = rgb(b);
  return '#' + rgb(a).map((channel, index) => Math.round(channel * (1 - amount) + other[index] * amount).toString(16).padStart(2, '0')).join('').toUpperCase();
}
const luminance = (hex: string) => rgb(hex).map((channel) => {
  const value = channel / 255;
  return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
}).reduce((total, value, index) => total + value * [.2126, .7152, .0722][index], 0);
export function contrastRatio(a: string, b: string) {
  const first = luminance(a), second = luminance(b);
  return (Math.max(first, second) + .05) / (Math.min(first, second) + .05);
}

// Match the existing sRGB palette. Contrast is evaluated in linear-light sRGB,
// including rounding to the exact hex values the browser receives.
function readableAccent(base: string, surfaces: string[], light: boolean) {
  for (let step = 0; step <= 100; step++) {
    const candidate = mixColor(base, light ? '#000000' : '#FFFFFF', step / 100);
    if (surfaces.every((surface) => contrastRatio(candidate, surface) >= 4.6)) return candidate;
  }
  return light ? '#000000' : '#FFFFFF';
}

export function deriveCustomTheme(value: string | CustomThemeConfig, mode: 'light' | 'dark') {
  const config = normaliseCustomTheme(typeof value === 'string' ? { accent: value } : value);
  const base = config.accent;
  const light = mode === 'light';
  const background = config.backgroundTint ?? base;
  const page = mixColor(light ? '#F8FAFC' : '#0B1018', background, light ? .035 : .04);
  const surface = mixColor(light ? '#FFFFFF' : '#151D29', config.surfaceTint ?? base, .035);
  const raised = mixColor(light ? '#FFFFFF' : '#1D2735', config.surfaceTint ?? base, .035);
  const selected = mixColor(surface, base, light ? .12 : .17);
  const requestedHover = config.hoverHighlight ?? mixColor(surface, base, light ? .07 : .10);
  // Keep hover visible without losing the established text polarity.
  let hover = requestedHover;
  const defaultText = light ? '#172033' : '#F1F5F9';
  for (let step = 0; step <= 100; step++) {
    hover = mixColor(requestedHover, surface, step / 100);
    if (contrastRatio(defaultText, hover) >= 4.6) break;
  }
  if (config.hoverHighlight && contrastRatio(hover, surface) < 1.15) hover = mixColor(surface, light ? '#000000' : '#FFFFFF', light ? .10 : .15);
  const secondarySoft = mixColor(surface, config.secondaryAction ?? base, .10);
  const surfaces = [page, surface, raised, selected, hover];
  if (config.secondaryAction) surfaces.push(secondarySoft);
  const accent = readableAccent(base, surfaces, light);
  const accentHover = mixColor(accent, light ? '#000000' : '#FFFFFF', .08);
  const foreground = light ? '#FFFFFF' : '#000000';
  const requestedText = config.textColor ?? (light ? '#172033' : '#F1F5F9');
  // Protect the most transparent shared surface (24%) even over extreme content.
  const textSurfaces = [...surfaces, mixColor(surface, light ? '#000000' : '#FFFFFF', .24)];
  const primary = readableAccent(requestedText, textSurfaces, light);
  const secondary = readableAccent(config.textColor ? mixColor(primary, surface, .18) : light ? '#39465A' : '#CBD5E1', textSurfaces, light);
  const muted = readableAccent(config.textColor ? mixColor(primary, surface, .28) : light ? '#4B586D' : '#B1BDCE', textSurfaces, light);
  const soft = mixColor(surface, base, .10);
  const action = readableAccent(config.primaryAction ?? base, surfaces, light);
  const secondaryAction = readableAccent(config.secondaryAction ?? base, surfaces, light);
  const topography = readableAccent(background, surfaces, light);
  const tokens: Record<string, string> = {
    'primary-action': action, 'primary-action-hover': mixColor(action, light ? '#000000' : '#FFFFFF', .08),
    'primary-action-foreground': foreground,
    'secondary-action': secondaryAction, 'secondary-action-soft': secondarySoft,
    'accent': accent, 'accent-hover': accentHover, 'accent-active': accentHover,
    'accent-soft': soft, 'accent-muted': soft, 'accent-border': accent,
    'accent-foreground': foreground, 'accent-contrast': foreground,
    'focus-ring': accent, 'focus-ring-soft': `${accent}40`,
    'page-bg': page, 'surface': surface, 'surface-elevated': raised, 'surface-muted': page,
    'navigation-surface': surface, 'sidebar-surface': surface,
    'hover-surface': hover, 'selected-surface': selected, 'subtle-accent-surface': soft,
    'border-subtle': mixColor(surface, primary, .20), 'border-default': mixColor(surface, primary, .30),
    'border-strong': mixColor(surface, primary, .45), 'border-accent': config.secondaryAction ? secondaryAction : accent,
    'text-disabled': muted, 'text-primary': primary, 'text-secondary': secondary, 'text-muted': muted, 'icon-muted': muted,
    'nav-active-foreground': primary, 'control-selected-foreground': foreground,
    'input-bg': page, 'dropdown-bg': raised, 'editor-toolbar-bg': raised,
    'auth-background': page, 'auth-text': primary,
    'auth-ring-rgb': rgb(accent).join(', '), 'auth-pulse-rgb': rgb(accentHover).join(', '),
    'dark-atmosphere': `radial-gradient(circle at top left, ${background}24, transparent 34%), radial-gradient(circle at bottom right, ${background}14, transparent 42%), ${page}`,
    'topography-color': topography, 'dark-glow-strong': `${background}1A`, 'dark-glow-soft': `${background}0D`,
    'light-atmosphere': `radial-gradient(circle at top left, ${background}12, transparent 45%), ${page}`,
    'light-topography': `${topography}18`, 'light-glow-top': `${background}24`, 'light-glow-bottom': `${background}14`,
  };
  return { base, hoverAdjusted: config.hoverHighlight !== null && hover !== requestedHover, textAdjusted: primary !== requestedText, adjusted: (config.hoverHighlight !== null && hover !== requestedHover) || primary !== requestedText || accent !== base || (config.primaryAction !== null && action !== config.primaryAction)
    || (config.secondaryAction !== null && secondaryAction !== config.secondaryAction), tokens };
}

export function customThemeVariables(accent: string | CustomThemeConfig) {
  const config = normaliseCustomTheme(typeof accent === 'string' ? { accent } : accent);
  const values: Record<string, string> = { '--stanza-custom-base': config.accent };
  for (const mode of ['light', 'dark'] as const) {
    for (const [token, value] of Object.entries(deriveCustomTheme(accent, mode).tokens)) values[`--stanza-custom-${mode}-${token}`] = value;
  }
  return values;
}

export function applyCustomAccent(accent: string | CustomThemeConfig) {
  if (typeof document === 'undefined') return;
  const config = normaliseCustomTheme(typeof accent === 'string' ? { accent } : accent);
  document.documentElement.dataset.customPrimary = String(config.primaryAction !== null);
  document.documentElement.dataset.customSecondary = String(config.secondaryAction !== null);
  const variables=customThemeVariables(accent);
  for (const [name, value] of Object.entries(variables)) {
    if(document.documentElement.style.getPropertyValue?.(name)!==value) document.documentElement.style.setProperty(name, value);
  }
}

export const POINTER_PRESETS = ['system', 'minimal', 'neon', 'portfolio', 'precision', 'soft-glow', 'cyber'] as const;
export type PointerPreset = (typeof POINTER_PRESETS)[number];
export function applyPointerPreset(config: CustomThemeConfig, preset: PointerPreset): CustomThemeConfig {
  // Reset only pointer settings; all theme colors and action overrides are retained.
  const defaults = Object.fromEntries(Object.entries(DEFAULT_CUSTOM_THEME).filter(([key]) => key.startsWith('cursor') || key.startsWith('pointer')));
  const choices: Record<PointerPreset, Partial<CustomThemeConfig>> = {
    system: {},
    minimal: { cursorAppearance: 'dot', pointerSize: 6, pointerOpacity: 90 },
    neon: { cursorAppearance: 'ring', pointerSize: 20, pointerGlow: 55, cursorEffect: 'comet', cursorTrailGlow: 50 },
    portfolio: { cursorEffect: 'portfolio-trail', cursorTrailSize: 3, cursorTrailLength: 12, cursorTrailIntensity: 65, cursorTrailGlow: 30, cursorSmoothness: 60, cursorVelocityResponse: 75 },
    precision: { cursorAppearance: 'crosshair', pointerSize: 20, pointerOutline: 1 },
    'soft-glow': { cursorAppearance: 'orb', pointerSize: 12, pointerGlow: 25, cursorEffect: 'glow', cursorTrailIntensity: 25 },
    cyber: { cursorAppearance: 'dot-ring', pointerSize: 20, pointerGlow: 25, cursorEffect: 'orbit', cursorTrailSize: 3, cursorTrailLength: 3 },
  };
  return normaliseCustomTheme({ ...config, ...defaults, ...choices[preset] });
}
export const hasCustomCursor = (config: CustomThemeConfig) => config.cursorAppearance !== 'system' || config.cursorEffect !== 'none';

export function normaliseLanyardStyle(value: unknown): LanyardStyle {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const legacyCustom = ['cardColor','accentColor','strapColor'].some(key => normaliseCustomAccent(raw[key]) !== null);
  return { appearanceMode: raw.appearanceMode === 'theme' ? 'theme' : raw.appearanceMode === 'custom' || raw.appearanceMode === undefined && legacyCustom ? 'custom' : 'theme', cardColor: normaliseCustomAccent(raw.cardColor), accentColor: normaliseCustomAccent(raw.accentColor), strapColor: normaliseCustomAccent(raw.strapColor) };
}
export function resolveLanyardColors(style: LanyardStyle) {
  const card = style.cardColor ?? '#061B13';
  const text = contrastRatio(card, '#FFFFFF') >= contrastRatio(card, '#000000') ? '#FFFFFF' : '#000000';
  const accent = readableAccent(style.accentColor ?? '#18C98B', [card], text === '#000000');
  return { card, text, accent };
}
