export const DEFAULT_CUSTOM_ACCENT = '#6366F1';

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

export function deriveCustomTheme(value: string, mode: 'light' | 'dark') {
  const base = normaliseCustomAccent(value) ?? DEFAULT_CUSTOM_ACCENT;
  const light = mode === 'light';
  const page = mixColor(light ? '#F8FAFC' : '#0B1018', base, light ? .035 : .04);
  const surface = mixColor(light ? '#FFFFFF' : '#151D29', base, .035);
  const raised = mixColor(light ? '#FFFFFF' : '#1D2735', base, .035);
  const selected = mixColor(surface, base, light ? .12 : .17);
  const hover = mixColor(surface, base, light ? .07 : .10);
  const accent = readableAccent(base, [page, surface, raised, selected, hover], light);
  const accentHover = mixColor(accent, light ? '#000000' : '#FFFFFF', .08);
  const foreground = light ? '#FFFFFF' : '#000000';
  const primary = light ? '#172033' : '#F1F5F9';
  const secondary = light ? '#39465A' : '#CBD5E1';
  const muted = light ? '#4B586D' : '#B1BDCE';
  const soft = mixColor(surface, base, .10);
  const tokens: Record<string, string> = {
    'accent': accent, 'accent-hover': accentHover, 'accent-active': accentHover,
    'accent-soft': soft, 'accent-muted': soft, 'accent-border': accent,
    'accent-foreground': foreground, 'accent-contrast': foreground,
    'focus-ring': accent, 'focus-ring-soft': `${accent}40`,
    'page-bg': page, 'surface': surface, 'surface-elevated': raised, 'surface-muted': page,
    'navigation-surface': surface, 'sidebar-surface': surface,
    'hover-surface': hover, 'selected-surface': selected, 'subtle-accent-surface': soft,
    'border-subtle': mixColor(surface, primary, .20), 'border-default': mixColor(surface, primary, .30),
    'border-strong': mixColor(surface, primary, .45), 'border-accent': accent,
    'text-primary': primary, 'text-secondary': secondary, 'text-muted': muted, 'icon-muted': muted,
    'nav-active-foreground': primary, 'control-selected-foreground': foreground,
    'input-bg': page, 'dropdown-bg': raised, 'editor-toolbar-bg': raised,
    'auth-background': page, 'auth-text': primary,
    'auth-ring-rgb': rgb(accent).join(', '), 'auth-pulse-rgb': rgb(accentHover).join(', '),
    'dark-atmosphere': `radial-gradient(circle at top left, ${base}24, transparent 34%), radial-gradient(circle at bottom right, ${base}14, transparent 42%), ${page}`,
    'topography-color': accent, 'dark-glow-strong': `${base}1A`, 'dark-glow-soft': `${base}0D`,
    'light-atmosphere': `radial-gradient(circle at top left, ${base}12, transparent 45%), ${page}`,
    'light-topography': `${accent}18`, 'light-glow-top': `${base}24`, 'light-glow-bottom': `${base}14`,
  };
  return { base, adjusted: accent !== base, tokens };
}

export function customThemeVariables(accent: string) {
  const values: Record<string, string> = { '--stanza-custom-base': normaliseCustomAccent(accent) ?? DEFAULT_CUSTOM_ACCENT };
  for (const mode of ['light', 'dark'] as const) {
    for (const [token, value] of Object.entries(deriveCustomTheme(accent, mode).tokens)) values[`--stanza-custom-${mode}-${token}`] = value;
  }
  return values;
}

export function applyCustomAccent(accent: string) {
  if (typeof document === 'undefined') return;
  for (const [name, value] of Object.entries(customThemeVariables(accent))) document.documentElement.style.setProperty(name, value);
}
