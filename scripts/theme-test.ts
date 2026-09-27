import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_LIGHT_INTENSITY,
  LIGHT_INTENSITY_STOPS,
  readStanzaPreferences,
  resolveLightIntensityStop,
} from '../src/lib/StanzaPreferencesContext';
import { BACKGROUND_PRESET_IDS, backgroundPresets, normaliseBackgroundPreset } from '../src/lib/background-presets';
import { contrastRatio, DEFAULT_CUSTOM_ACCENT, deriveCustomTheme, mixColor, normaliseCustomAccent, normaliseCustomTheme, DEFAULT_CUSTOM_THEME } from '../src/lib/custom-theme';

const [preferences, css, dashboard, translations, indexHtml, themeBootstrap, richTextEditor, leaveWorkspace, organisationPanel, locationsPanel, quickActionSettings, authShell, fingerprintCanvas, expensesPanel, shiftSwapsPanel, commandPalette] = await Promise.all([
  readFile('src/lib/StanzaPreferencesContext.tsx', 'utf8'),
  readFile('src/index.css', 'utf8'),
  readFile('src/pages/Dashboard.tsx', 'utf8'),
  readFile('src/lib/LanguageContext.tsx', 'utf8'),
  readFile('index.html', 'utf8'),
  readFile('public/stanza-bootstrap.js', 'utf8'),
  readFile('src/components/RichTextEditor.tsx', 'utf8'),
  readFile('src/components/roster/LeaveWorkspace.tsx', 'utf8'),
  readFile('src/components/organisation/OrganisationPanel.tsx', 'utf8'),
  readFile('src/components/locations/LocationsPanel.tsx', 'utf8'),
  readFile('src/components/navigation/QuickActionSettings.tsx', 'utf8'),
  readFile('src/components/AuthShell.tsx', 'utf8'),
  readFile('src/components/FingerprintCanvas.tsx', 'utf8'),
  readFile('src/components/expenses/ExpensesPanel.tsx', 'utf8'),
  readFile('src/components/roster/ShiftSwapsPanel.tsx', 'utf8'),
  readFile('src/components/command-palette/CommandPalette.tsx', 'utf8'),
]);

assert.deepEqual(LIGHT_INTENSITY_STOPS, [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
assert.equal(readStanzaPreferences(null).lightIntensity, DEFAULT_LIGHT_INTENSITY);
assert.equal(readStanzaPreferences('{"lightIntensity":"bright"}').lightIntensity, 15);
assert.equal(readStanzaPreferences('{"lightIntensity":"balanced"}').lightIntensity, 50);
assert.equal(readStanzaPreferences('{"lightIntensity":"deep"}').lightIntensity, 85);
assert.equal(readStanzaPreferences('{"lightIntensity":-4}').lightIntensity, 0);
assert.equal(readStanzaPreferences('{"lightIntensity":104}').lightIntensity, 100);
assert.equal(readStanzaPreferences('{"lightIntensity":"midnight"}').lightIntensity, DEFAULT_LIGHT_INTENSITY);
assert.equal(readStanzaPreferences('{not-json').lightIntensity, DEFAULT_LIGHT_INTENSITY);
assert.equal(readStanzaPreferences(null).backgroundPreset, 'emerald');
assert.equal(readStanzaPreferences('{"backgroundPreset":"midnight","mobileShortcuts":["roster"]}').backgroundPreset, 'midnight');
assert.equal(readStanzaPreferences('{"backgroundPreset":"unsafe"}').backgroundPreset, 'emerald');
assert.equal(readStanzaPreferences('{"backgroundPreset":"default"}').backgroundPreset, 'emerald');
assert.equal(normaliseBackgroundPreset('warm_sand'), 'warm_sand');
assert.equal(normaliseBackgroundPreset('Warm Sand'), 'emerald');
assert.equal(resolveLightIntensityStop(16), 20);
assert.match(preferences, /STANZA_PREFERENCES_KEY = 'stanza\.preferences\.v1'/);
assert.match(preferences, /applyLightIntensity/);
assert.match(preferences, /document\.documentElement\.dataset\.lightIntensity/);
assert.match(preferences, /window\.localStorage\.setItem\(STANZA_PREFERENCES_KEY/);
assert.match(indexHtml, /<script src="\/stanza-bootstrap\.js"><\/script>/);
assert.match(indexHtml, /data-light-intensity/);
assert.match(themeBootstrap, /stanza\.preferences\.v1/);
assert.match(themeBootstrap, /legacyIntensity/);
assert.match(themeBootstrap, /dataset\.backgroundPreset/);
assert.match(themeBootstrap, /backgroundPresets/);
assert.deepEqual(BACKGROUND_PRESET_IDS, ['emerald', 'slate', 'midnight', 'graphite', 'warm_sand', 'amethyst', 'ember']);
assert.equal(new Set(backgroundPresets.map((preset) => preset.id)).size, backgroundPresets.length);
assert.equal((backgroundPresets as readonly { id: string }[]).some((preset) => preset.id === 'default'), false);

for (const intensity of LIGHT_INTENSITY_STOPS) {
  assert.match(css, new RegExp(`:root\\[data-theme="light"\\]\\[data-light-intensity="${intensity}"\\]`));
}

for (const token of [
  'stanza-page-bg',
  'stanza-surface',
  'stanza-surface-elevated',
  'stanza-surface-muted',
  'stanza-navigation-surface',
  'stanza-sidebar-surface',
  'stanza-input-bg',
  'stanza-dropdown-bg',
  'stanza-editor-toolbar-bg',
  'stanza-hover-surface',
  'stanza-selected-surface',
  'stanza-subtle-accent-surface',
  'stanza-border-subtle',
  'stanza-border-strong',
  'stanza-text-primary',
  'stanza-text-secondary',
  'stanza-text-muted',
  'stanza-icon-muted',
]) {
  assert.match(css, new RegExp(`--${token}:`));
}

assert.match(css, /\.stanza-light-atmosphere/);
assert.match(css, /\.stanza-light-topography/);
assert.match(css, /\.stanza-light-glow-top/);
assert.match(css, /\.stanza-light-glow-bottom/);
assert.match(css, /\.stanza-dashboard \.bg-white/);
assert.match(css, /stanza-input-bg/);
assert.match(css, /stanza-menu-bg/);
assert.match(css, /stanza-select-option-bg/);
assert.doesNotMatch(css, /filter:\s*brightness/i);
assert.doesNotMatch(css, /:root[^\{]*\{[^}]*opacity:/s);
assert.doesNotMatch(css, /:root\[data-theme="dark"\]\[data-light-intensity/);
assert.match(css, /\.dark \{/);
for (const preset of BACKGROUND_PRESET_IDS) {
  assert.match(css, new RegExp(`data-background-preset="${preset}"`));
  const escapedPreset = preset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lightRule = [...css.matchAll(new RegExp(`:root\\[data-background-preset="${escapedPreset}"\\]\\[data-theme="light"\\] \\{([^}]*)\\}`, 'g'))]
    .map((match) => match[1])
    .join('\n');
  const darkRule = [...css.matchAll(new RegExp(`:root\\[data-background-preset="${escapedPreset}"\\]:not\\(\\[data-theme="light"\\]\\) \\{([^}]*)\\}`, 'g'))]
    .map((match) => match[1])
    .join('\n');
  const unscopedRules = [...css.matchAll(new RegExp(`:root\\[data-background-preset="${escapedPreset}"\\] \\{([^}]*)\\}`, 'g'))]
    .map((match) => match[1]);
  assert.match(lightRule, /--stanza-hover-surface:/, `${preset} light hover surface is explicit`);
  assert.match(lightRule, /--stanza-selected-surface:/, `${preset} light selected surface is explicit`);
  assert.match(darkRule, /--stanza-hover-surface:/, `${preset} dark hover surface is explicit`);
  assert.match(darkRule, /--stanza-selected-surface:/, `${preset} dark selected surface is explicit`);
  assert.equal(
    unscopedRules.some((rule) => /--stanza-surface-(?:hover|selected):/.test(rule)),
    false,
    `${preset} accent rules do not override mode-aware surface aliases`,
  );
}
assert.doesNotMatch(css, /data-background-preset="default"/);
assert.equal(backgroundPresets.find((preset) => preset.id === 'emerald')?.lightPreview, '#f4faf6');
assert.equal(backgroundPresets.find((preset) => preset.id === 'emerald')?.darkPreview, '#020403');
assert.match(css, /data-background-preset="emerald"\]:not\(\[data-theme="light"\]\) \{ --stanza-page-bg: #020403;/);
assert.match(css, /--stanza-surface: #04110d; --stanza-surface-elevated: #061811; --stanza-surface-muted: #03100b;/);
assert.match(css, /data-background-preset="emerald"\]:not\(\[data-theme="light"\]\) \{ --stanza-auth-background: #020604; --stanza-auth-text: #ecfdf5;/);

assert.match(dashboard, /useStanzaPreferences\(\)/);
assert.match(dashboard, /lightIntensity/);
assert.match(dashboard, /setLightIntensity/);
assert.match(dashboard, /type="range"/);
assert.match(dashboard, /min="0"/);
assert.match(dashboard, /max="100"/);
assert.match(dashboard, /aria-valuetext/);
assert.match(dashboard, /stanza-light-intensity-label/);
assert.match(dashboard, /stanza-light-intensity-help/);
assert.match(dashboard, /dash\.lightIntensityBright/);
assert.match(dashboard, /renderControlCenterSettings/);
assert.match(dashboard, /backgroundPresets\.map/);
assert.match(dashboard, /role="radiogroup"/);
assert.match(dashboard, /role="radio"/);
assert.match(dashboard, /background\.selected/);
assert.match(dashboard, /stanza-dark-atmosphere/);
assert.match(dashboard, /stanza-dark-topography/);
assert.match(dashboard, /stanza-dark-glow-strong/);
assert.doesNotMatch(dashboard, /bg-\[radial-gradient\(circle_at_top_left,rgba\(16,185,129/);
assert.match(css, /\.stanza-dark-atmosphere \{ background: var\(--stanza-dark-atmosphere\); \}/);
assert.match(css, /\.stanza-dark-topography \{ background-color: var\(--stanza-topography-color\);/);
assert.match(css, /--stanza-dark-atmosphere:/);
assert.match(css, /--stanza-topography-color:/);
assert.match(css, /--stanza-dark-glow-strong:/);
assert.match(dashboard, /dir=\{isRtl \? 'rtl' : 'ltr'\}/);
assert.match(dashboard, /focus-visible:ring-2/);
assert.match(dashboard, /stanza-dashboard h-screen/);
assert.match(dashboard, /stanza-light-atmosphere/);
assert.match(dashboard, /stanza-light-topography/);
assert.match(dashboard, /stanza-light-glow/);
const settingsSource = dashboard.slice(
  dashboard.indexOf('const renderControlCenterSettings'),
  dashboard.indexOf('return (', dashboard.indexOf('const renderControlCenterSettings')),
);
assert.doesNotMatch(settingsSource, /hr_admin|manager|team_leader|delegation/);

for (const key of [
  'dash.appearance',
  'dash.lightIntensity',
  'dash.lightIntensityDescription',
  'dash.lightIntensityAppliesToLight',
  'dash.lightIntensityBright',
  'dash.lightIntensityBalanced',
  'dash.lightIntensityDeep',
  'background.title',
  'background.default',
  'background.warmSand',
  'background.amethyst',
  'background.ember',
]) {
  assert.match(translations, new RegExp(`'${key}':`));
}
for (const token of ['stanza-accent-active', 'stanza-accent-soft', 'stanza-accent-foreground', 'stanza-surface-panel', 'stanza-surface-raised', 'stanza-border-accent', 'stanza-nav-active-bg', 'stanza-control-track']) {
  assert.match(css, new RegExp(`--${token}:`));
}
assert.match(css, /data-background-preset="amethyst"/);
assert.match(css, /data-background-preset="ember"/);
assert.match(css, /\.stanza-generic-surface/);
assert.match(css, /\.stanza-generic-control/);
assert.match(css, /--stanza-surface-hover: var\(--stanza-hover-surface\)/);
assert.match(css, /--stanza-surface-selected: var\(--stanza-selected-surface\)/);
assert.match(css, /--stanza-nav-active-foreground: color-mix\(in srgb, var\(--stanza-accent-hover\) 40%, var\(--stanza-text-primary\) 60%\)/);
assert.match(css, /:root\[data-background-preset\]\[data-theme="light"\] \{\s*--stanza-nav-active-foreground: color-mix\(in srgb, var\(--stanza-accent\) 40%, var\(--stanza-text-primary\) 60%\);\s*\}/);
assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)/);
assert.match(css, /\.stanza-navigation-item\[data-selected="true"\]/);
assert.match(css, /color-mix\(in srgb, var\(--stanza-surface-selected\) 82%, var\(--stanza-accent\) 18%\)/);
assert.match(css, /transform: scale\(\.98\)/);
assert.match(css, /outline: 2px solid var\(--stanza-focus-ring\)/);
assert.match(css, /:not\(:disabled\):not\(\[aria-disabled="true"\]\)[\s\S]*cursor: pointer;/);
assert.match(css, /\.stanza-destructive-action:not\(:disabled\):hover/);
assert.match(css, /\.stanza-toggle-track\s*\{\s*background-color: var\(--stanza-control-track\);/);
assert.match(css, /\.stanza-toggle-track\[aria-checked="true"\]\s*\{\s*background-color: var\(--stanza-control-selected\);/);
assert.match(css, /:not\(\.stanza-toggle-track\):hover/);
assert.match(dashboard, /role="radio"[\s\S]{0,240}stanza-interactive-control/);
assert.match(dashboard, /text-\[var\(--stanza-text-muted\)\]/);
assert.doesNotMatch(dashboard, /flex items-center justify-between gap-2 text-xs font-bold text-neutral-800 dark:text-emerald-50/);
assert.match(dashboard, /aria-pressed=\{lang === 'en'\}[\s\S]{0,180}stanza-interactive-control/);
assert.match(dashboard, /aria-pressed=\{lang === 'ar'\}[\s\S]{0,180}stanza-interactive-control/);
assert.match(dashboard, /stanza-interactive-control stanza-toggle-track/);
assert.doesNotMatch(dashboard, /selected \? 'border-emerald-500 bg-emerald-500\/10'/);
assert.doesNotMatch(dashboard, /desktopNavigationMode === mode[\s\S]{0,120}bg-emerald/);
assert.doesNotMatch(dashboard, /rosterDisplayMode === mode[\s\S]{0,140}bg-emerald/);
assert.match(expensesPanel, /role="tab"[\s\S]{0,300}stanza-interactive-control/);
assert.doesNotMatch(expensesPanel, /activeView === tab\.id \? 'bg-emerald/);
assert.match(leaveWorkspace, /role="tab"[\s\S]{0,340}stanza-interactive-control/);
assert.doesNotMatch(leaveWorkspace, /view === value \? 'bg-emerald/);
assert.match(shiftSwapsPanel, /aria-pressed=\{role === value\}[\s\S]{0,180}stanza-interactive-control/);
assert.doesNotMatch(shiftSwapsPanel, /role === value \? 'border-emerald/);
assert.match(commandPalette, /role="option"[\s\S]{0,300}stanza-interactive-control/);
assert.doesNotMatch(commandPalette, /selected\s*\? 'border-emerald-500\/30 bg-emerald/);
assert.match(css, /--stanza-accent: #a95749/);
assert.doesNotMatch(css, /--stanza-accent: #ef4444/);
assert.match(css, /\.stanza-auth-shell/);
assert.match(css, /--stanza-auth-ring-rgb:/);
assert.match(authShell, /stanza-auth-shell/);
assert.doesNotMatch(authShell, /bg-\[#020604\]/);
assert.match(fingerprintCanvas, /data-background-preset/);
assert.match(await readFile('src/lib/login-canvas-palette.ts', 'utf8'), /--stanza-auth-ring-rgb/);
assert.match(dashboard, /stanza-settings-overlay fixed inset-0 z-40/);
assert.match(dashboard, /stanza-modal-backdrop absolute inset-0/);
assert.match(dashboard, /stanza-settings-drawer/);
assert.doesNotMatch(dashboard, /stanza-settings-overlay fixed inset-0 z-40[^"`]*\bbg-(?:white|black|\[#)/);
assert.doesNotMatch(dashboard, /stanza-modal-backdrop absolute inset-0[^"`]*\bbg-(?:white|black|\[#)/);
assert.match(css, /\.stanza-settings-overlay\s*\{\s*background: transparent;/);
assert.match(css, /\.stanza-modal-backdrop\s*\{\s*background-color: rgb\(0 0 0 \/ 0\.52\)/);
assert.match(css, /\.stanza-settings-drawer\s*\{\s*background-color: var\(--stanza-surface-panel\) !important;/);
assert.doesNotMatch(css, /\.stanza-modal-backdrop\s*\{[^}]*backdrop-filter/s);
assert.doesNotMatch(css, /\.stanza-settings-overlay\s*\{[^}]*stanza-surface-panel/s);
assert.doesNotMatch(css, /transition:\s*all/);
assert.match(translations, /'dash\.appearance': 'المظهر'/);
assert.match(translations, /'dash\.lightIntensity': 'درجة سطوع الوضع الفاتح'/);
assert.match(translations, /'dash\.lightIntensityDeep': 'داكن نسبيًا'/);

assert.match(richTextEditor, /stanza-select/);
assert.match(richTextEditor, /role="toolbar"/);
assert.match(leaveWorkspace, /data-leave-workspace/);
assert.match(leaveWorkspace, /dir=\{isRtl \? 'rtl' : 'ltr'\}/);
assert.match(organisationPanel, /dir=\{isRtl/);
assert.match(locationsPanel, /dir=\{isRtl/);
assert.match(quickActionSettings, /bg-white\/75/);
assert.match(quickActionSettings, /dark:bg-black\/40/);
assert.match(quickActionSettings, /focus-visible:ring-2/);
assert.match(quickActionSettings, /motion-reduce/);

const originalRules = JSON.parse(await readFile('scripts/fixtures/original-theme-rules.json', 'utf8'));
assert.deepEqual([...css.matchAll(/:root\[data-background-preset="(?:emerald|slate|midnight|graphite|warm_sand|amethyst|ember)"\][^{]*\{[^}]*\}/g)].map((match) => match[0]), originalRules, 'Original preset rules match the baseline including the Login dark-mode scoping fix');
assert.equal(normaliseBackgroundPreset('custom'), 'custom');
assert.equal(readStanzaPreferences('{"backgroundPreset":"custom","customAccent":"#2563eb"}').customAccent, '#2563EB');
assert.equal(readStanzaPreferences('{"backgroundPreset":"emerald","customAccent":"#EC4899"}').customAccent, '#EC4899', 'Switching away retains the custom color');
for (const invalid of [null, 4, '', '#fff', 'red', '#1234567', '#GG0000', 'url(javascript:alert(1))']) assert.equal(normaliseCustomAccent(invalid), null);
assert.equal(readStanzaPreferences('{"customAccent":"bad"}').customAccent, DEFAULT_CUSTOM_ACCENT);
const samples = ['#6366F1', '#2563EB', '#EC4899', '#F59E0B', '#111827', '#F8FAFC', '#000000', '#FFFFFF', '#FFFF00', '#000018'];
let lowestText = Infinity, lowestButton = Infinity;
for (const color of samples) for (const mode of ['light', 'dark'] as const) {
  const { base, tokens } = deriveCustomTheme(color, mode);
  assert.equal(base, color, 'Never replace the saved base accent');
  for (const shade of ['accent', 'accent-hover', 'accent-active']) {
    const contrast = contrastRatio(tokens[shade], tokens['accent-foreground']);
    lowestButton = Math.min(lowestButton, contrast);
    assert.ok(contrast >= 4.5, `${color} ${mode} ${shade} button: ${contrast}`);
  }
  for (const surface of ['page-bg', 'surface', 'surface-elevated', 'selected-surface', 'hover-surface']) {
    for (const text of ['text-primary', 'text-secondary', 'text-muted', 'accent', 'accent-hover']) {
      const contrast = contrastRatio(tokens[surface], tokens[text]);
      lowestText = Math.min(lowestText, contrast);
      assert.ok(contrast >= 4.5, `${color} ${mode} ${text} on ${surface}: ${contrast}`);
    }
    assert.ok(contrastRatio(tokens['focus-ring'], tokens[surface]) >= 3);
  }
  for (const state of ['selected-surface', 'hover-surface']) assert.ok(contrastRatio(tokens['nav-active-foreground'], mixColor(tokens[state], tokens.accent, .18)) >= 4.5);
  assert.ok(Object.keys(tokens).every((token) => !/success|approved|secure|online|valid|warning|pending|destructive|rejected|error/.test(token)), 'Identity tokens never define status colors');
}
const customEditor = await readFile('src/components/CustomThemeEditor.tsx', 'utf8');
assert.match(customEditor, /type="color"/);
assert.match(customEditor, /aria-invalid=\{invalid\}/);
assert.match(customEditor, /dir=\{isRtl \? 'rtl' : 'ltr'\}/);
assert.match(customEditor, /onClick=\{commit\}/);
assert.match(customEditor, /setDraft\(\(current\) =>/);
assert.match(await readFile('src/components/PointerStudio.tsx', 'utf8'), /data-custom-cursor-preview/);
assert.doesNotMatch(customEditor, /setBackgroundPreset|localStorage|querySelectorAll|insertRule/);
console.log(`Custom contrast: minimum button ${lowestButton.toFixed(2)}:1, text ${lowestText.toFixed(2)}:1 across ${samples.length * 2} palettes`);
console.log('Original preset snapshots, Custom contrast/persistence, light intensity, accessibility, and cross-role contracts passed');
// Icon close styling is a scoped semantic contract, independent of preset values.
const closeRules = css.slice(css.indexOf('/* Close controls keep their hit target still;'));
assert.match(closeRules, /background: transparent !important/);
assert.match(closeRules, /:hover \{ color: var\(--stanza-accent\) !important/);
assert.match(closeRules, /scale\(1\.08\)/);
assert.match(closeRules, /scale\(\.97\)/);
assert.match(closeRules, /outline: 2px solid var\(--stanza-focus-ring\)/);
assert.match(closeRules, /prefers-reduced-motion/);
assert.doesNotMatch(closeRules, /transition:\s*all|emerald/);
const passkeyButton = dashboard.slice(dashboard.indexOf('onClick={addPasskey}'), dashboard.indexOf("{passkeySaving ? t('dash.opening')"));
assert.match(passkeyButton, /stanza-primary-action stanza-theme-primary/);
assert.doesNotMatch(passkeyButton, /bg-emerald|text-black/);
for (const path of ['src/components/navigation/DashboardNavigation.tsx', 'src/components/navigation/MobileShortcutEditor.tsx', 'src/components/tutorials/TutorialOverlay.tsx', 'src/components/command-palette/CommandPalette.tsx', 'src/components/PrivacyPolicyModal.tsx', 'src/components/DemoNoticeModal.tsx']) {
  assert.match(await readFile(path, 'utf8'), /stanza-close-action/, path);
}
console.log('Semantic primary Passkey and transparent close glyph interaction contracts passed');

// Existing custom palettes retain their exact values when new fields are unset.
const legacyTokens = samples.flatMap((color) => (['light', 'dark'] as const).map((mode) =>
  Object.fromEntries(Object.entries(deriveCustomTheme(color, mode).tokens).filter(([key]) => !key.startsWith('primary-action') && !key.startsWith('secondary-action')))));
assert.equal(createHash('sha256').update(JSON.stringify(legacyTokens)).digest('hex'), '34ff665118583a9f0f4d00ce33a39e6bae25fbb7b49072747be5e264e8eb835b');
const migrated = readStanzaPreferences(JSON.stringify({ customAccent: '#2563eb', backgroundPreset: 'custom' }));
assert.deepEqual(migrated.customTheme, { ...DEFAULT_CUSTOM_THEME, accent: '#2563EB' });
for (const malformed of [null, [], 'invalid', 7, { accent: 'bad', primaryAction: 'red', cursorEffect: 'anything', cursorTrailLength: Infinity, cursorTrailIntensity: '90' }]) {
  assert.deepEqual(normaliseCustomTheme(malformed), DEFAULT_CUSTOM_THEME);
}
const configured = normaliseCustomTheme({ accent: '#ffffff', primaryAction: '#ffff00', secondaryAction: '#00ff00', surfaceTint: '#000000', backgroundTint: '#FFFFFF', cursorColor: '#aabbcc', cursorEffect: 'lerp-trail', cursorTrailLength: 999, cursorTrailIntensity: -10 });
assert.equal(configured.cursorTrailLength, 12); assert.equal(configured.cursorTrailIntensity, 10);
assert.equal(configured.cursorColor, '#AABBCC');
const persisted = readStanzaPreferences(JSON.stringify({ ...migrated, customTheme: configured }));
assert.deepEqual(persisted.customTheme, configured);
assert.equal(persisted.customAccent, configured.accent, 'Legacy alias stays synchronized');
assert.deepEqual(readStanzaPreferences(JSON.stringify(persisted)), persisted, 'Persistence readback is stable');
assert.match(preferences, /applyCustomAccent\(nextPreferences.customTheme\)/, 'Cross-tab changes apply the full configuration');
assert.match(preferences, /applyCustomAccent\(preferences.customTheme\)/, 'Pre-render initialization uses the configuration');
for (const color of samples) for (const tint of samples) for (const mode of ['light', 'dark'] as const) {
  const config = { ...DEFAULT_CUSTOM_THEME, accent: color, primaryAction: tint, secondaryAction: tint, surfaceTint: tint, backgroundTint: tint };
  const { tokens } = deriveCustomTheme(config, mode);
  for (const surface of ['page-bg', 'surface', 'surface-elevated', 'selected-surface', 'hover-surface', 'secondary-action-soft']) {
    for (const text of ['text-primary', 'text-secondary', 'text-muted', 'accent', 'secondary-action']) {
      assert.ok(contrastRatio(tokens[surface], tokens[text]) >= 4.5, `${mode} ${color} ${tint} ${text} on ${surface}`);
    }
    assert.ok(contrastRatio(tokens[surface], tokens['focus-ring']) >= 3);
  }
  for (const state of ['primary-action', 'primary-action-hover']) assert.ok(contrastRatio(tokens[state], tokens['primary-action-foreground']) >= 4.5);
}
assert.equal(deriveCustomTheme(configured, 'light').adjusted, true);
console.log('Theme Studio migration, malformed input, readback, legacy parity and 200 expanded contrast palettes passed');

const extendedCursor = readStanzaPreferences(JSON.stringify({ customAccent: '#abcdef', customTheme: { cursorAppearance: 'ring', pointerColor: '#123456', pointerSize: 24, cursorEffect: 'portfolio-trail', cursorColor: '#654321', cursorTrailLength: 12 } }));
assert.equal(extendedCursor.customTheme.accent, '#ABCDEF');
assert.equal(extendedCursor.customTheme.cursorAppearance, 'ring');
assert.equal(extendedCursor.customTheme.cursorEffect, 'portfolio-trail');
assert.equal(extendedCursor.customTheme.pointerSize, 24);
assert.deepEqual(readStanzaPreferences(JSON.stringify(extendedCursor)), extendedCursor);
console.log('Expanded pointer settings persist through the existing preference reader');
