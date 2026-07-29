import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  LIGHT_INTENSITIES,
  readStanzaPreferences,
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

assert.deepEqual(LIGHT_INTENSITIES, ['bright', 'balanced', 'deep']);
assert.equal(readStanzaPreferences(null).lightIntensity, 'balanced');
assert.equal(readStanzaPreferences('{"lightIntensity":"bright"}').lightIntensity, 'bright');
assert.equal(readStanzaPreferences('{"lightIntensity":"balanced"}').lightIntensity, 'balanced');
assert.equal(readStanzaPreferences('{"lightIntensity":"deep"}').lightIntensity, 'deep');
assert.equal(readStanzaPreferences('{"lightIntensity":"midnight"}').lightIntensity, 'balanced');
assert.equal(readStanzaPreferences('{not-json').lightIntensity, 'balanced');
assert.match(preferences, /STANZA_PREFERENCES_KEY = 'stanza\.preferences\.v1'/);
assert.match(preferences, /applyLightIntensity/);
assert.match(preferences, /document\.documentElement\.dataset\.lightIntensity/);
assert.match(preferences, /window\.localStorage\.setItem\(STANZA_PREFERENCES_KEY/);
assert.match(indexHtml, /stanza\.preferences\.v1/);
assert.match(indexHtml, /data-light-intensity/);
assert.match(indexHtml, /\['bright', 'balanced', 'deep'\]/);

for (const intensity of LIGHT_INTENSITIES) {
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
assert.match(dashboard, /role="radiogroup"/);
assert.match(dashboard, /role="radio"/);
assert.match(dashboard, /aria-checked=\{lightIntensity === intensity\}/);
assert.match(dashboard, /stanza-light-intensity-label/);
assert.match(dashboard, /stanza-light-intensity-help/);
assert.match(dashboard, /grid-cols-3/);
assert.match(dashboard, /dir=\{isRtl \? 'rtl' : 'ltr'\}/);
assert.match(dashboard, /focus-visible:ring-2/);
assert.match(dashboard, /stanza-dashboard h-screen/);
assert.match(dashboard, /stanza-light-atmosphere/);
assert.match(dashboard, /stanza-light-topography/);
assert.match(dashboard, /stanza-light-glow/);
assert.doesNotMatch(
  dashboard.match(/const renderControlCenterSettings[\s\S]*?\n  \);/)?.[0] || '',
  /hr_admin|manager|team_leader|delegation/,
);

for (const key of [
  'dash.lightIntensity',
  'dash.lightIntensityDescription',
  'dash.lightIntensityAppliesToLight',
  'dash.lightIntensityBright',
  'dash.lightIntensityBalanced',
  'dash.lightIntensityDeep',
]) {
  assert.match(translations, new RegExp(`'${key}':`));
}

assert.match(richTextEditor, /stanza-select/);
assert.match(richTextEditor, /role="toolbar"/);
assert.match(leaveWorkspace, /data-leave-workspace/);
assert.match(leaveWorkspace, /dir=\{isRtl \? 'rtl' : 'ltr'\}/);
assert.match(organisationPanel, /dir=\{isRtl/);
assert.match(locationsPanel, /dir=\{isRtl/);

console.log('Light intensity preference, semantic surface token, accessibility, and cross-role contracts passed');
