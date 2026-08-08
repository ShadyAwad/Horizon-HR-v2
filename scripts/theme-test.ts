import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_LIGHT_INTENSITY,
  LIGHT_INTENSITY_STOPS,
  readStanzaPreferences,
  resolveLightIntensityStop,
} from '../src/lib/StanzaPreferencesContext';
import { BACKGROUND_PRESET_IDS, backgroundPresets, normaliseBackgroundPreset } from '../src/lib/background-presets';

const [preferences, css, dashboard, translations, indexHtml, themeBootstrap, richTextEditor, leaveWorkspace, organisationPanel, locationsPanel, quickActionSettings, authShell, fingerprintCanvas] = await Promise.all([
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
}
assert.doesNotMatch(css, /data-background-preset="default"/);

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
assert.match(css, /--stanza-accent: #a95749/);
assert.doesNotMatch(css, /--stanza-accent: #ef4444/);
assert.match(css, /\.stanza-auth-shell/);
assert.match(css, /--stanza-auth-ring-rgb:/);
assert.match(authShell, /stanza-auth-shell/);
assert.doesNotMatch(authShell, /bg-\[#020604\]/);
assert.match(fingerprintCanvas, /data-background-preset/);
assert.match(fingerprintCanvas, /--stanza-auth-ring-rgb/);
assert.match(dashboard, /stanza-settings-overlay fixed inset-0 z-40/);
assert.match(dashboard, /stanza-modal-backdrop absolute inset-0/);
assert.match(dashboard, /stanza-settings-drawer/);
assert.doesNotMatch(dashboard, /stanza-settings-overlay fixed inset-0 z-40[^"`]*\bbg-(?:white|black|\[#)/);
assert.doesNotMatch(dashboard, /stanza-modal-backdrop absolute inset-0[^"`]*\bbg-(?:white|black|\[#)/);
assert.match(css, /\.stanza-settings-overlay\s*\{\s*background: transparent;/);
assert.match(css, /\.stanza-modal-backdrop\s*\{\s*background-color: rgb\(0 0 0 \/ 0\.35\)/);
assert.match(css, /\.stanza-settings-drawer\s*\{\s*background-color: var\(--stanza-surface-panel\) !important;/);
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

console.log('Light intensity preference, semantic surface token, accessibility, and cross-role contracts passed');
