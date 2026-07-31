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
assert.equal(defaults.desktopNavigationMode, 'launcher');
const restored = readStanzaPreferences(JSON.stringify({ mobileShortcuts: ['unknown', 'roster', 'roster', 'feed'], rosterPresentationMode: 'fit', desktopNavigationMode: 'rail' }));
assert.deepEqual(restored.mobileShortcuts, ['unknown', 'roster', 'feed']);
assert.equal(restored.rosterPresentationMode, 'fit');
assert.equal(restored.desktopNavigationMode, 'rail');
assert.equal(readStanzaPreferences(JSON.stringify({ desktopNavigationMode: 'unknown' })).desktopNavigationMode, 'launcher');

const checks: Array<[string, boolean]> = [
  ['horizontal global strip is removed from the rendered dashboard', /<div className="hidden">[\s\S]*Tab Contents/.test(dashboard)],
  ['only the registry-backed desktop rail is live', (dashboard.match(/<DashboardNavigation\s/g) || []).length === 1 && /\{false && <aside/.test(dashboard)],
  ['launcher-only is the default desktop mode and has no permanent module rail', /desktopMode = 'launcher'/.test(nav) && /desktopMode === 'rail' && <nav/.test(nav)],
  ['launcher-only has one external command button and no external settings button', /desktopMode === 'rail' && <button[^>]*onClick=\{onOpenControlCenter\}/.test(nav) && /desktopMode === 'rail' && <nav/.test(nav)],
  ['compact rail is an optional registry-backed presentation', /desktopMode === 'rail'/.test(nav) && /items\.map\(\(item\) => itemButton/.test(nav)],
  ['desktop navigation preference persists and preserves the active route', /desktopNavigationMode/.test(dashboard) && /setDesktopNavigationMode\(mode\)/.test(dashboard) && /setActiveTab/.test(dashboard)],
  ['launcher-only dock stays fixed and does not reserve a rail layout column', /md:fixed md:start-4 md:top-4/.test(nav) && /desktopMode === 'rail'\s*\? 'md:static/.test(nav)],
  ['launcher-only main content has a modest logical start safe inset without a full rail', /desktopNavigationMode === 'launcher' && 'md:ps-28'/.test(dashboard) && !/md:ps-\[.*rail/.test(dashboard)],
  ['legacy rail cannot reserve layout width or create a second navigation landmark', /\{false && <aside[\s\S]*?<\/aside>\}/.test(dashboard)],
  ['desktop rail occupies the sole predictable layout column while the panel overlays content', /md:static/.test(nav) && /fixed z-30/.test(nav) && /md:start-\[5\.5rem\]/.test(nav)],
  ['main content has no legacy sidebar offset and header is contextual rather than global navigation', /<main className=\{cn\(/.test(dashboard) && /activeNavigationLabel/.test(dashboard) && /flex-wrap items-center gap-2/.test(dashboard)],
  ['registry-backed rail and launcher are rendered', /<DashboardNavigation[\s\S]*items=\{navigationItems\}/.test(dashboard) && /aria-expanded/.test(nav)],
  ['launcher owns navigation and control center stays separate', /onOpenControlCenter/.test(nav) && /Control Center/.test(nav) && !/showControlCenter/.test(nav)],
  ['launcher supports Escape, outside click, and focus restoration', /event\.key === 'Escape'/.test(nav) && /launcherRef\.current\?\.focus/.test(nav) && /window\.addEventListener\('mousedown'/.test(nav)],
  ['mobile shortcuts use stable ids with a minimum and crowding warning', /mobileShortcuts/.test(dashboard) && /selected\.length <= 4/.test(shortcuts) && /selected\.length > 5/.test(shortcuts)],
  ['shortcuts can be reordered by keyboard controls and reset safely', /move\(index, -1\)/.test(shortcuts) && /move\(index, 1\)/.test(shortcuts) && /Reset defaults/.test(shortcuts)],
  ['permission-filtered registry drives desktop and mobile surfaces', /\.filter\(Boolean\)/.test(dashboard) && /allowedIds/.test(nav) && /validShortcuts/.test(nav)],
  ['roster defaults by viewport and keeps detailed overflow local', /rosterPresentationMode === 'auto'/.test(dashboard) && /rosterDisplayMode === 'fit'/.test(dashboard) && /role="region"/.test(dashboard)],
  ['fit screen exposes accessible expandable day cards', /expandedRosterDate/.test(dashboard) && /aria-expanded=\{expanded\}/.test(dashboard) && /Read-only schedule/.test(dashboard)],
  ['shared native scrollbar treatment is theme-token based', /.stanza-scrollbar/.test(css) && /scrollbar-color/.test(css) && /::-webkit-scrollbar-thumb/.test(css)],
  ['one lazy lanyard remains anchored to the launcher without a layout column', (dashboard.match(/<StanzaDashboardLanyard/g) || []).length === 1 && /stanza-control-center-trigger/.test(dashboard) && /pointer-events-none fixed inset-0/.test(read('src/components/lanyard/StanzaDashboardLanyard.tsx'))],
  ['external lanyard hides while the complete navigation panel is open', /hidden=\{!isLanyardSceneReady \|\| isNavigationOpen \|\| showControlCenter\}/.test(dashboard) && /onOpenChange=\{setIsNavigationOpen\}/.test(dashboard) && /onOpenChange\?\.\(open\)/.test(nav)],
  ['launcher lanyard has a transparent centred short strap and no layout column', /showLanyardDock/.test(nav) && /aria-hidden="true"/.test(nav) && /left-1\/2 top-full/.test(nav) && /h-7 w-px/.test(nav) && /pointer-events-none/.test(nav)],
  ['lanyard hides when Control Center opens and is absent when disabled', /showLanyardDock=\{shouldMountLanyard && isLanyardIdleReady && !showControlCenter\}/.test(dashboard) && /paused=\{!isDashboardVisible \|\| isNavigationOpen \|\| showControlCenter\}/.test(dashboard)],
  ['Control Center remains separate from launcher navigation', /onOpenControlCenter/.test(nav) && /<Settings/.test(nav) && !/onClick=\{onOpenControlCenter\}[^\n]*StanzaFingerprintMark/.test(nav)],
  ['mobile bottom navigation and More sheet remain intact', /md:hidden/.test(nav) && /MoreHorizontal/.test(nav) && /bottom-\[calc\(\.75rem\+env\(safe-area-inset-bottom\)\)\]/.test(nav)],
  ['navigation surface is RTL and theme safe', /isRtl/.test(nav) && /dark:bg/.test(nav) && /lang === 'ar'/.test(nav)],
  ['preference control is keyboard-accessible and reduced-motion safe', /role="radiogroup"/.test(dashboard) && /role="radio"/.test(dashboard) && /motion-reduce:transition-none/.test(dashboard) && /motion-reduce:transition-none/.test(nav)],
  ['launcher uses short transform-only interaction polish with reduced-motion fallback', /transition-\[transform,box-shadow,background-color,border-color\]/.test(nav) && /hover:-translate-y-px/.test(nav) && /active:scale-\[\.97\]/.test(nav) && /motion-reduce:transform-none/.test(nav)],
];
let failed = false;
for (const [label, passed] of checks) { console.log(`${passed ? 'PASS' : 'FAIL'} ${label}`); failed ||= !passed; }
if (failed) process.exitCode = 1;
