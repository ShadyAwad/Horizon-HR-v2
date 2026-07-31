import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_LIGHT_INTENSITY,
  LIGHT_INTENSITY_STOPS,
  readStanzaPreferences,
  resolveLightIntensityStop,
} from '../src/lib/StanzaPreferencesContext';

const [preferences, css, dashboard, translations, indexHtml, richTextEditor, leaveWorkspace, organisationPanel, locationsPanel] = await Promise.all([
  readFile('src/lib/StanzaPreferencesContext.tsx', 'utf8'),
  readFile('src/index.css', 'utf8'),
  readFile('src/pages/Dashboard.tsx', 'utf8'),
  readFile('src/lib/LanguageContext.tsx', 'utf8'),
  readFile('index.html', 'utf8'),
  readFile('src/components/RichTextEditor.tsx', 'utf8'),
  readFile('src/components/roster/LeaveWorkspace.tsx', 'utf8'),
  readFile('src/components/organisation/OrganisationPanel.tsx', 'utf8'),
  readFile('src/components/locations/LocationsPanel.tsx', 'utf8'),
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
assert.equal(resolveLightIntensityStop(16), 20);
assert.match(preferences, /STANZA_PREFERENCES_KEY = 'stanza\.preferences\.v1'/);
assert.match(preferences, /applyLightIntensity/);
assert.match(preferences, /document\.documentElement\.dataset\.lightIntensity/);
assert.match(preferences, /window\.localStorage\.setItem\(STANZA_PREFERENCES_KEY/);
assert.match(indexHtml, /stanza\.preferences\.v1/);
assert.match(indexHtml, /data-light-intensity/);
assert.match(indexHtml, /legacyIntensity/);

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
assert.match(dashboard, /dash\.appearance/);
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
]) {
  assert.match(translations, new RegExp(`'${key}':`));
}
assert.match(translations, /'dash\.appearance': 'المظهر'/);
assert.match(translations, /'dash\.lightIntensity': 'درجة سطوع الوضع الفاتح'/);
assert.match(translations, /'dash\.lightIntensityDeep': 'داكن نسبيًا'/);

assert.match(richTextEditor, /stanza-select/);
assert.match(richTextEditor, /role="toolbar"/);
assert.match(leaveWorkspace, /data-leave-workspace/);
assert.match(leaveWorkspace, /dir=\{isRtl \? 'rtl' : 'ltr'\}/);
assert.match(organisationPanel, /dir=\{isRtl/);
assert.match(locationsPanel, /dir=\{isRtl/);

console.log('Light intensity preference, semantic surface token, accessibility, and cross-role contracts passed');
