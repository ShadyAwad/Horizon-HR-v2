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
const language = read('src/lib/LanguageContext.tsx');

const defaults = readStanzaPreferences(null);
assert.deepEqual(defaults.mobileShortcuts, ['geofence', 'roster', 'feed', 'profile']);
assert.equal(defaults.rosterPresentationMode, 'auto');
assert.equal(defaults.desktopNavigationMode, 'launcher');
const restored = readStanzaPreferences(JSON.stringify({ mobileShortcuts: ['unknown', 'roster', 'roster', 'feed'], rosterPresentationMode: 'fit', desktopNavigationMode: 'rail' }));
assert.deepEqual(restored.mobileShortcuts, ['unknown', 'roster', 'feed']);
assert.equal(restored.rosterPresentationMode, 'fit');
assert.equal(restored.desktopNavigationMode, 'rail');
assert.equal(readStanzaPreferences(JSON.stringify({ desktopNavigationMode: 'unknown' })).desktopNavigationMode, 'launcher');
assert.deepEqual(readStanzaPreferences(JSON.stringify({ desktopRailOrder: ['payroll', 'unknown', 'payroll'] })).desktopRailOrder, ['payroll', 'unknown']);

const checks: Array<[string, boolean]> = [
  ['horizontal global strip is removed from the rendered dashboard', /<div className="hidden">[\s\S]*Tab Contents/.test(dashboard)],
  ['only the registry-backed desktop rail is live', (dashboard.match(/<DashboardNavigation\s/g) || []).length === 1 && /\{false && <aside/.test(dashboard)],
  ['launcher-only is the default desktop mode and has no permanent module rail', /desktopMode = 'launcher'/.test(nav) && /desktopMode === 'rail' && <nav/.test(nav)],
  ['launcher-only has one external command button and no external settings button', /desktopMode === 'rail' && <button[^>]*onClick=\{onOpenControlCenter\}/.test(nav) && /desktopMode === 'rail' && <nav/.test(nav)],
  ['compact rail is an optional registry-backed presentation', /desktopMode === 'rail'/.test(nav) && /orderedRailItems\.map/.test(nav)],
  ['desktop navigation preference persists and preserves the active route', /desktopNavigationMode/.test(dashboard) && /setDesktopNavigationMode\(mode\)/.test(dashboard) && /setActiveTab/.test(dashboard)],
  ['launcher-only dock stays fixed in a dedicated top-start slot without reserving a rail column', /md:fixed md:start-3 md:top-3/.test(nav) && /desktopMode === 'rail'\s*\? 'md:static/.test(nav)],
  ['launcher-only header has a deliberate logical start slot without narrowing cards', /desktopNavigationMode === 'launcher' && "md:ps-\[4\.5rem\] md:pt-1"/.test(dashboard) && /<main className="min-w-0 w-full max-w-full flex-1/.test(dashboard)],
  ['legacy rail cannot reserve layout width or create a second navigation landmark', /\{false && <aside[\s\S]*?<\/aside>\}/.test(dashboard)],
  ['desktop rail occupies the sole predictable layout column while the panel overlays content', /md:static/.test(nav) && /fixed z-30/.test(nav) && /md:start-\[5\.5rem\]/.test(nav)],
  ['main content has no legacy sidebar offset and header is contextual rather than global navigation', /<main className="min-w-0 w-full max-w-full flex-1/.test(dashboard) && /activeNavigationLabel/.test(dashboard) && /flex-wrap items-center gap-2/.test(dashboard)],
  ['registry-backed rail and launcher are rendered', /<DashboardNavigation[\s\S]*items=\{navigationItems\}/.test(dashboard) && /aria-expanded/.test(nav)],
  ['launcher owns navigation and Settings stays separate', /onOpenControlCenter/.test(nav) && /Settings/.test(nav) && !/showControlCenter/.test(nav)],
  ['launcher supports Escape, outside click, and focus restoration', /event\.key === 'Escape'/.test(nav) && /launcherRef\.current\?\.focus/.test(nav) && /window\.addEventListener\('mousedown'/.test(nav)],
  ['mobile shortcuts use stable ids with a minimum and crowding warning', /mobileShortcuts/.test(dashboard) && /selected\.length <= 4/.test(shortcuts) && /selected\.length > 5/.test(shortcuts)],
  ['shortcuts can be reordered by keyboard controls and reset safely', /move\(index, -1\)/.test(shortcuts) && /move\(index, 1\)/.test(shortcuts) && /Reset defaults/.test(shortcuts)],
  ['permission-filtered registry drives desktop and mobile surfaces', /\.filter\(Boolean\)/.test(dashboard) && /allowedIds/.test(nav) && /validShortcuts/.test(nav)],
  ['roster defaults by viewport and keeps detailed overflow local', /rosterPresentationMode === 'auto'/.test(dashboard) && /rosterDisplayMode === 'fit'/.test(dashboard) && /role="region"/.test(dashboard)],
  ['fit screen exposes accessible expandable day cards', /expandedRosterDate/.test(dashboard) && /aria-expanded=\{expanded\}/.test(dashboard) && /Read-only schedule/.test(dashboard)],
  ['shared native scrollbar treatment is theme-token based', /.stanza-scrollbar/.test(css) && /scrollbar-color/.test(css) && /::-webkit-scrollbar-thumb/.test(css)],
  ['one lazy lanyard remains anchored to the launcher without a layout column', (dashboard.match(/<StanzaDashboardLanyard/g) || []).length === 1 && /data-stanza-lanyard-anchor/.test(dashboard) && /pointer-events-none fixed inset-0/.test(read('src/components/lanyard/StanzaDashboardLanyard.tsx'))],
  ['external lanyard remains mounted while the launcher panel is open', /hidden=\{!isLanyardSceneReady \|\| showControlCenter\}/.test(dashboard) && !/hidden=\{!isLanyardSceneReady \|\| isNavigationOpen/.test(dashboard)],
  ['launcher lanyard has a transparent centred short strap in the shared launcher wrapper', /<div data-stanza-lanyard-anchor className="relative shrink-0">[\s\S]*showLanyardDock/.test(nav) && /aria-hidden="true"/.test(nav) && /left-1\/2 top-full/.test(nav) && /h-7 w-px/.test(nav) && /pointer-events-none/.test(nav)],
  ['3D lanyard anchor begins at the shared launcher wrapper bottom edge', /querySelector<HTMLElement>\('\[data-stanza-lanyard-anchor\]'\)/.test(dashboard) && /y: -\(rect\.bottom \/ viewportHeight\) \* 2 \+ 1/.test(dashboard) && !/LANYARD_ANCHOR_VERTICAL_OFFSET_PX/.test(dashboard)],
  ['lanyard hides when Settings opens, remains a Launcher-only presentation, and is absent when disabled', /shouldMountLanyard = lanyardEnabled && isLanyardCapable && desktopNavigationMode === 'launcher'/.test(dashboard) && /showLanyardDock=\{shouldMountLanyard && isLanyardIdleReady && !showControlCenter\}/.test(dashboard) && /paused=\{!isDashboardVisible \|\| showControlCenter\}/.test(dashboard)],
  ['Settings remains separate from launcher navigation and replaces visible Control Center copy', /onOpenControlCenter/.test(nav) && /<Settings/.test(nav) && !/Control Center/.test(nav) && /'dash\.controlCenterTitle': 'Stanza Settings'/.test(language) && /'dash\.controlCenterTitle': 'إعدادات Stanza'/.test(language) && !/onClick=\{onOpenControlCenter\}[^\n]*StanzaFingerprintMark/.test(nav)],
  ['mobile bottom navigation keeps a fixed Stanza launcher and a dedicated shortcut customiser', /md:hidden/.test(nav) && /Customise shortcuts/.test(nav) && /<Plus/.test(nav) && /bottom-\[calc\(\.75rem\+env\(safe-area-inset-bottom\)\)\]/.test(nav)],
  ['navigation surface is RTL and theme safe', /isRtl/.test(nav) && /dark:bg/.test(nav) && /lang === 'ar'/.test(nav)],
  ['preference controls are keyboard-accessible and reduced-motion safe', /type="range"/.test(dashboard) && /aria-valuetext/.test(dashboard) && /motion-reduce:transition-none/.test(dashboard) && /motion-reduce:transition-none/.test(nav)],
  ['navigation groups resolve through translated internal keys and the RTL logout icon alone is mirrored', /nav\.group\.\$\{group\}/.test(nav) && /isRtl && '-scale-x-100'/.test(nav) && /'nav\.group\.workspace'/.test(language)],
  ['rail ordering persists stable ids, filters unavailable ids, supports drag, and offers keyboard controls in Settings', /desktopRailOrder/.test(read('src/lib/StanzaPreferencesContext.tsx')) && /orderedRailItems/.test(nav) && /draggable=\{Boolean\(onRailOrderChange\)\}/.test(nav) && /DesktopRailOrderSettings/.test(dashboard) && /normaliseDesktopRailOrder/.test(read('src/components/navigation/DesktopRailOrderSettings.tsx'))],
  ['mobile settings editor follows the actual layout breakpoint and is absent from desktop render paths', /isMobileNavigationLayout && <div/.test(dashboard) && /matchMedia\('\(max-width: 767px\)'\)/.test(dashboard)],
  ['focused mobile customiser reuses shortcut state, locks scrolling, restores focus, and supports Escape', /MobileShortcutEditor/.test(dashboard) && /document\.body\.style\.overflow = 'hidden'/.test(read('src/components/navigation/MobileShortcutEditor.tsx')) && /returnFocusRef\.current\?\.focus/.test(read('src/components/navigation/MobileShortcutEditor.tsx')) && /event\.key === 'Escape'/.test(read('src/components/navigation/MobileShortcutEditor.tsx'))],
  ['all selected mobile shortcuts render in a contained horizontal scroller without a five-item cap', /stanza-mobile-shortcuts/.test(nav) && /overflow-x-auto/.test(nav) && /shortcutItems\.map/.test(nav) && !/shortcutItems\.slice\(0, 5\)/.test(nav)],
  ['launcher uses restrained transform-only interaction polish with reduced-motion fallback', /transition-\[transform,box-shadow,background-color,border-color\]/.test(nav) && /hover:scale-\[1\.015\]/.test(nav) && /active:scale-\[\.97\]/.test(nav) && /scale-\[1\.025\]/.test(nav) && /motion-reduce:transform-none/.test(nav)],
  ['panel wordmark uses a structural accented initial without unsafe HTML', /lang === 'ar' \? <span>Stanza<\/span> : <>\s*<span className="text-emerald-600 dark:text-emerald-400">S<\/span><span>tanza<\/span>/.test(nav) && !/dangerouslySetInnerHTML/.test(nav)],
  ['selected navigation typography remains readable and stable', /font-extrabold tracking-normal text-emerald-700/.test(nav)],
];
let failed = false;
for (const [label, passed] of checks) { console.log(`${passed ? 'PASS' : 'FAIL'} ${label}`); failed ||= !passed; }
if (failed) process.exitCode = 1;
