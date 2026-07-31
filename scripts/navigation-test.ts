import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readStanzaPreferences } from '../src/lib/StanzaPreferencesContext';
import {
  FREQUENT_MODULE_LIMIT,
  FREQUENT_MODULE_THRESHOLD,
  MODULE_USAGE_COOLDOWN_MS,
  RECENT_MODULE_LIMIT,
  getFrequentModuleIds,
  getRecentModuleIds,
  normaliseModuleUsage,
  recordModuleUsage,
} from '../src/components/navigation/module-usage';

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const dashboard = read('src/pages/Dashboard.tsx');
const nav = read('src/components/navigation/DashboardNavigation.tsx');
const shortcuts = read('src/components/navigation/MobileShortcutSettings.tsx');
const css = read('src/index.css');
const language = read('src/lib/LanguageContext.tsx');
const moduleUsageSource = read('src/components/navigation/module-usage.ts');

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

const now = Date.now();
const allowedModuleIds = new Set(['roster', 'feed', 'hiring', 'expenses', 'profile', 'geofence']);
let moduleUsage = recordModuleUsage({}, 'roster', allowedModuleIds, now);
moduleUsage = recordModuleUsage(moduleUsage, 'roster', allowedModuleIds, now + MODULE_USAGE_COOLDOWN_MS - 1);
assert.equal(moduleUsage.roster.count, 1, 'same-module navigation inside the cooldown does not inflate usage');
moduleUsage = recordModuleUsage(moduleUsage, 'roster', allowedModuleIds, now + MODULE_USAGE_COOLDOWN_MS);
assert.equal(moduleUsage.roster.count, 2, 'usage increments after the cooldown');
assert.deepEqual(
  recordModuleUsage(moduleUsage, 'unknown', allowedModuleIds, now + MODULE_USAGE_COOLDOWN_MS * 2),
  moduleUsage,
  'unavailable navigation is ignored',
);
assert.deepEqual(
  normaliseModuleUsage({
    roster: { count: 3, lastOpenedAt: now - 100 },
    unknown: { count: 9, lastOpenedAt: now },
    feed: { count: -1, lastOpenedAt: now },
    hiring: { count: 2, lastOpenedAt: 'private' },
  }, allowedModuleIds, now),
  { roster: { count: 3, lastOpenedAt: now - 100 } },
  'malformed, unknown, and unavailable usage entries are discarded',
);
const rankedUsage = {
  roster: { count: 2, lastOpenedAt: now - 100 },
  feed: { count: 2, lastOpenedAt: now - 200 },
  hiring: { count: 8, lastOpenedAt: now - 300 },
  expenses: { count: 4, lastOpenedAt: now - 400 },
  profile: { count: 7, lastOpenedAt: now - 500 },
  geofence: { count: FREQUENT_MODULE_THRESHOLD - 1, lastOpenedAt: now - 600 },
};
assert.deepEqual(
  getRecentModuleIds(rankedUsage, [...allowedModuleIds]),
  ['roster', 'feed', 'hiring', 'expenses'],
  'recent modules are newest first and bounded',
);
assert.deepEqual(
  getRecentModuleIds(rankedUsage, [...allowedModuleIds], 'roster'),
  ['feed', 'roster', 'hiring', 'expenses'],
  'the current module yields first position to another recent module',
);
assert.equal(getRecentModuleIds(rankedUsage, [...allowedModuleIds]).length, RECENT_MODULE_LIMIT);
assert.deepEqual(
  getFrequentModuleIds(rankedUsage, [...allowedModuleIds], new Set(['roster', 'feed', 'hiring', 'expenses']), now),
  ['profile'],
  'frequent modules use count-first ranking, require the threshold, and exclude recent entries',
);
assert.ok(FREQUENT_MODULE_LIMIT === RECENT_MODULE_LIMIT && FREQUENT_MODULE_LIMIT === 4);
const storedUsage = readStanzaPreferences(JSON.stringify({ moduleUsage: rankedUsage })).moduleUsage;
assert.deepEqual(Object.keys(storedUsage), ['roster', 'feed', 'hiring', 'expenses', 'profile', 'geofence']);
assert.equal(/label|query|recordId|employeeId|candidateId/.test(JSON.stringify(storedUsage)), false, 'usage stores no labels, queries, or record identifiers');

const checks: Array<[string, boolean]> = [
  ['horizontal global strip is removed from the rendered dashboard', /<div className="hidden">[\s\S]*Tab Contents/.test(dashboard)],
  ['only the registry-backed desktop rail is live', (dashboard.match(/<DashboardNavigation\s/g) || []).length === 1 && /\{false && <aside/.test(dashboard)],
  ['launcher-only is the default desktop mode and has no permanent module rail', /desktopMode = 'launcher'/.test(nav) && /desktopMode === 'rail' && <nav/.test(nav)],
  ['launcher-only has one external command button and no external settings button', /desktopMode === 'rail' && <button[^>]*onClick=\{onOpenControlCenter\}/.test(nav) && /desktopMode === 'rail' && <nav/.test(nav)],
  ['compact rail is an optional registry-backed presentation', /desktopMode === 'rail'/.test(nav) && /orderedRailItems\.map/.test(nav)],
  ['desktop navigation preference persists and preserves the active route', /desktopNavigationMode/.test(dashboard) && /setDesktopNavigationMode\(mode\)/.test(dashboard) && /setActiveTab/.test(dashboard)],
  ['launcher-only dock is portalled into the contextual header instead of fixed over it', /createPortal\(launcherAnchor, desktopLauncherTarget\)/.test(nav) && /desktopMode === 'rail'\s*\? 'md:static/.test(nav) && /: 'md:hidden'/.test(nav) && !/md:fixed md:start-3 md:top-3/.test(nav)],
  ['launcher-only header uses a 60px logical-start grid slot without narrowing cards below', /data-dashboard-context-header/.test(dashboard) && /--launcher-header-slot:3\.75rem/.test(dashboard) && /grid-cols-\[var\(--launcher-header-slot\)_minmax\(0,1fr\)\]/.test(dashboard) && /data-launcher-header-slot/.test(dashboard) && /data-dashboard-context-content/.test(dashboard) && /<main className="min-w-0 w-full max-w-full flex-1/.test(dashboard)],
  ['legacy rail cannot reserve layout width or create a second navigation landmark', /\{false && <aside[\s\S]*?<\/aside>\}/.test(dashboard)],
  ['desktop rail occupies the sole predictable layout column while the panel overlays content', /md:static/.test(nav) && /fixed z-30/.test(nav) && /md:start-\[5\.5rem\]/.test(nav)],
  ['main content has no legacy sidebar offset and header is contextual rather than global navigation', /<main className="min-w-0 w-full max-w-full flex-1/.test(dashboard) && /activeNavigationLabel/.test(dashboard) && /flex-wrap items-center gap-2/.test(dashboard)],
  ['registry-backed rail and launcher are rendered', /<DashboardNavigation[\s\S]*items=\{navigationItems\}/.test(dashboard) && /aria-expanded/.test(nav)],
  ['one launcher focus target is shared by mobile, rail, and the desktop header portal', (nav.match(/id="stanza-control-center-trigger"/g) || []).length === 1 && /desktopLauncherTarget/.test(nav) && /isMobileLayout/.test(nav)],
  ['launcher owns navigation and Settings stays separate', /onOpenControlCenter/.test(nav) && /Settings/.test(nav) && !/showControlCenter/.test(nav)],
  ['launcher supports Escape, outside click, and focus restoration', /event\.key === 'Escape'/.test(nav) && /launcherRef\.current\?\.focus/.test(nav) && /window\.addEventListener\('mousedown'/.test(nav)],
  ['mobile shortcuts use stable ids with a minimum and crowding warning', /mobileShortcuts/.test(dashboard) && /selected\.length <= 4/.test(shortcuts) && /selected\.length > 5/.test(shortcuts)],
  ['shortcuts can be reordered by keyboard controls and reset to the recommended set safely', /move\(index, -1\)/.test(shortcuts) && /move\(index, 1\)/.test(shortcuts) && /Reset to recommended/.test(shortcuts)],
  ['permission-filtered registry drives desktop and mobile surfaces', /\.filter\(Boolean\)/.test(dashboard) && /allowedIds/.test(nav) && /validShortcuts/.test(nav)],
  ['module navigation records from launcher, rail, mobile shortcuts, palette navigation, and valid notification links', /onModuleNavigate\?\.\(item\.id\)/.test(nav) && /command\.type === 'navigation'/.test(dashboard) && /recordModuleNavigation\('expenses'\)/.test(dashboard) && /recordModuleNavigation\('roster'\)/.test(dashboard)],
  ['opening or searching the launcher does not record module use', /onClick=\{\(\) => setOpen\(\(value\) => !value\)\}/.test(nav) && /onOpenCommandPalette\(launcherRef\.current\)/.test(nav) && !/setOpen\(\(value\) => !value\)[\s\S]{0,100}onModuleNavigate/.test(nav)],
  ['usage storage is bounded, validated, local-only, and contains stable navigation ids only', /MODULE_USAGE_LIMIT = 30/.test(moduleUsageSource) && /MODULE_USAGE_COUNT_LIMIT = 9_999/.test(moduleUsageSource) && /isStableNavigationId/.test(moduleUsageSource) && !/fetch|apiFetch|XMLHttpRequest/.test(moduleUsageSource)],
  ['permission loss prunes module usage against the authorised navigation registry', /normaliseModuleUsage\(moduleUsage, availableNavigationIds\)/.test(dashboard)],
  ['launcher shows compact translated recent and frequent sections above the complete groups', /data-launcher-section="recent"/.test(nav) && /data-launcher-section="frequent"/.test(nav) && /Recent/.test(nav) && /الأخيرة/.test(nav) && /Frequently used/.test(nav) && /الأكثر استخدامًا/.test(nav) && /groups\.map/.test(nav)],
  ['usage reset clears only module usage and preserves every other preference', /resetModuleUsage/.test(dashboard) && /Reset recent and frequent modules/.test(dashboard) && /\\u0625\\u0639\\u0627\\u062f\\u0629/.test(dashboard) && /moduleUsage: \{\}/.test(read('src/lib/StanzaPreferencesContext.tsx'))],
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
  ['mobile shortcuts use a long-press pointer swap while ordinary taps still select a route', /setTimeout\(\(\) => \{ setDraggedShortcutId/.test(nav) && /swapShortcuts/.test(nav) && /onClick=\{\(\) => \{ if \(suppressShortcutClickRef/.test(nav)],
  ['launcher search is not focused automatically when navigation opens', !/querySelector<HTMLInputElement>\('input'\)\?\.focus/.test(nav)],
  ['mobile shortcut editor height is content-driven and scrolls only within its viewport cap', /max-h-full/.test(read('src/components/navigation/MobileShortcutEditor.tsx')) && !/flex h-full/.test(read('src/components/navigation/MobileShortcutEditor.tsx'))],
  ['launcher uses restrained transform-only interaction polish with reduced-motion fallback', /transition-\[transform,box-shadow,background-color,border-color\]/.test(nav) && /hover:scale-\[1\.015\]/.test(nav) && /active:scale-\[\.97\]/.test(nav) && /scale-\[1\.025\]/.test(nav) && /motion-reduce:transform-none/.test(nav)],
  ['panel wordmark uses a structural accented initial without unsafe HTML', /lang === 'ar' \? <span>Stanza<\/span> : <>\s*<span className="text-emerald-600 dark:text-emerald-400">S<\/span><span>tanza<\/span>/.test(nav) && !/dangerouslySetInnerHTML/.test(nav)],
  ['selected navigation typography remains readable and stable', /font-extrabold tracking-normal text-emerald-700/.test(nav)],
];
let failed = false;
for (const [label, passed] of checks) { console.log(`${passed ? 'PASS' : 'FAIL'} ${label}`); failed ||= !passed; }
if (failed) process.exitCode = 1;
