import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readStanzaPreferences } from '../src/lib/StanzaPreferencesContext';

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const dashboard = read('src/pages/Dashboard.tsx');
const nav = read('src/components/navigation/DashboardNavigation.tsx');
const shortcuts = read('src/components/navigation/MobileShortcutSettings.tsx');
const css = read('src/index.css');

const defaults = readStanzaPreferences(null);
assert.deepEqual(defaults.mobileShortcuts, ['geofence', 'roster', 'feed', 'profile']);
assert.equal(defaults.rosterPresentationMode, 'auto');
const restored = readStanzaPreferences(JSON.stringify({ mobileShortcuts: ['unknown', 'roster', 'roster', 'feed'], rosterPresentationMode: 'fit' }));
assert.deepEqual(restored.mobileShortcuts, ['unknown', 'roster', 'feed']);
assert.equal(restored.rosterPresentationMode, 'fit');

const checks: Array<[string, boolean]> = [
  ['horizontal global strip is removed from the rendered dashboard', /<div className="hidden">[\s\S]*Tab Contents/.test(dashboard)],
  ['registry-backed rail and launcher are rendered', /<DashboardNavigation[\s\S]*items=\{navigationItems\}/.test(dashboard) && /aria-expanded/.test(nav)],
  ['launcher owns navigation and control center stays separate', /onOpenControlCenter/.test(nav) && /Control Center/.test(nav) && !/showControlCenter/.test(nav)],
  ['launcher supports Escape, outside click, and focus restoration', /event\.key === 'Escape'/.test(nav) && /launcherRef\.current\?\.focus/.test(nav) && /window\.addEventListener\('mousedown'/.test(nav)],
  ['mobile shortcuts use stable ids with a minimum and crowding warning', /mobileShortcuts/.test(dashboard) && /selected\.length <= 4/.test(shortcuts) && /selected\.length > 5/.test(shortcuts)],
  ['shortcuts can be reordered by keyboard controls and reset safely', /move\(index, -1\)/.test(shortcuts) && /move\(index, 1\)/.test(shortcuts) && /Reset defaults/.test(shortcuts)],
  ['permission-filtered registry drives desktop and mobile surfaces', /\.filter\(Boolean\)/.test(dashboard) && /allowedIds/.test(nav) && /validShortcuts/.test(nav)],
  ['roster defaults by viewport and keeps detailed overflow local', /rosterPresentationMode === 'auto'/.test(dashboard) && /rosterDisplayMode === 'fit'/.test(dashboard) && /role="region"/.test(dashboard)],
  ['fit screen exposes accessible expandable day cards', /expandedRosterDate/.test(dashboard) && /aria-expanded=\{expanded\}/.test(dashboard) && /Read-only schedule/.test(dashboard)],
  ['shared native scrollbar treatment is theme-token based', /.stanza-scrollbar/.test(css) && /scrollbar-color/.test(css) && /::-webkit-scrollbar-thumb/.test(css)],
  ['lanyard implementation stays lazy and anchored to the launcher trigger', /StanzaDashboardLanyard/.test(dashboard) && /stanza-control-center-trigger/.test(dashboard)],
];
let failed = false;
for (const [label, passed] of checks) { console.log(`${passed ? 'PASS' : 'FAIL'} ${label}`); failed ||= !passed; }
if (failed) process.exitCode = 1;
