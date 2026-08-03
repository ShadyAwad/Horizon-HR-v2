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
import {
  moveShortcutPosition,
  swapShortcutPositions,
} from '../src/components/navigation/mobile-shortcut-order';

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const dashboard = read('src/pages/Dashboard.tsx');
const nav = read('src/components/navigation/DashboardNavigation.tsx');
const shortcuts = read('src/components/navigation/MobileShortcutSettings.tsx');
const shortcutEditor = read('src/components/navigation/MobileShortcutEditor.tsx');
const shortcutOrder = read('src/components/navigation/mobile-shortcut-order.ts');
const preferences = read('src/lib/StanzaPreferencesContext.tsx');
const css = read('src/index.css');
const language = read('src/lib/LanguageContext.tsx');
const moduleUsageSource = read('src/components/navigation/module-usage.ts');
const quickActions = read('src/components/navigation/QuickActionSettings.tsx');
const login = read('src/pages/Login.tsx');

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
assert.deepEqual(readStanzaPreferences(null).pinnedQuickActionIds, []);
assert.equal(readStanzaPreferences(null).pinnedQuickActionsCustomised, false);

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

const originalShortcutOrder = ['geofence', 'roster', 'expenses', 'hiring'];
assert.deepEqual(
  swapShortcutPositions(originalShortcutOrder, 'hiring', 'geofence'),
  ['hiring', 'roster', 'expenses', 'geofence'],
  'drop swaps only the source and target positions',
);
assert.deepEqual(originalShortcutOrder, ['geofence', 'roster', 'expenses', 'hiring'], 'swap does not mutate its input');
assert.deepEqual(swapShortcutPositions(originalShortcutOrder, 'unknown', 'roster'), originalShortcutOrder, 'invalid drops preserve order');
assert.deepEqual(moveShortcutPosition(originalShortcutOrder, 'expenses', 'up'), ['geofence', 'expenses', 'roster', 'hiring']);
assert.deepEqual(moveShortcutPosition(originalShortcutOrder, 'expenses', 'down'), ['geofence', 'roster', 'hiring', 'expenses']);
assert.deepEqual(moveShortcutPosition(originalShortcutOrder, 'expenses', 'start'), ['expenses', 'geofence', 'roster', 'hiring']);
assert.deepEqual(moveShortcutPosition(originalShortcutOrder, 'roster', 'end'), ['geofence', 'expenses', 'hiring', 'roster']);
assert.equal(new Set(swapShortcutPositions(originalShortcutOrder, 'hiring', 'geofence')).size, originalShortcutOrder.length, 'swap cannot duplicate or lose ids');

const checks: Array<[string, boolean]> = [
  ['horizontal global strip is removed from the rendered dashboard', /<div className="hidden">[\s\S]*Tab Contents/.test(dashboard)],
  ['only the registry-backed desktop rail is live', (dashboard.match(/<DashboardNavigation\s/g) || []).length === 1 && /\{false && <aside/.test(dashboard)],
  ['launcher-only is the default desktop mode and has no permanent module rail', /desktopMode = 'launcher'/.test(nav) && /desktopMode === 'rail' && <nav/.test(nav)],
  ['launcher-only has one external command button and no external settings button', /desktopMode === 'rail' && <button[^>]*onClick=\{onOpenControlCenter\}/.test(nav) && /desktopMode === 'rail' && <nav/.test(nav)],
  ['compact rail is an optional registry-backed presentation', /desktopMode === 'rail'/.test(nav) && /orderedRailItems\.map/.test(nav)],
  ['desktop navigation preference persists and preserves the active route', /desktopNavigationMode/.test(dashboard) && /setDesktopNavigationMode\(mode\)/.test(dashboard) && /setActiveTab/.test(dashboard)],
  ['launcher-only uses one fixed portal assembly rather than a header-bound sticky anchor', /data-stanza-launcher-assembly/.test(nav) && /createPortal\(launcherAssembly, document\.body\)/.test(nav) && /fixed inset-0 z-20/.test(nav) && !/desktopLauncherTarget/.test(nav)],
  ['launcher-only reserves an explicit logical-start header slot without narrowing main content', /data-dashboard-context-header/.test(dashboard) && /data-navigation-mode=\{desktopNavigationMode\}/.test(dashboard) && /data-launcher-header-slot/.test(dashboard) && /md:grid-cols-\[3\.75rem_minmax\(0,1fr\)\]/.test(dashboard) && /<main className="min-w-0 w-full max-w-full flex-1/.test(dashboard)],
  ['legacy rail cannot reserve layout width or create a second navigation landmark', /\{false && <aside[\s\S]*?<\/aside>\}/.test(dashboard)],
  ['desktop rail occupies the sole predictable layout column while the panel overlays content', /md:static/.test(nav) && /fixed z-30/.test(nav) && /md:start-\[5\.5rem\]/.test(nav)],
  ['main content has no legacy sidebar offset and the contextual header keeps wordmark, module, and workspace on one desktop row', /<main className="min-w-0 w-full max-w-full flex-1/.test(dashboard) && /activeNavigationLabel/.test(dashboard) && /md:flex-nowrap/.test(dashboard) && /shrink truncate whitespace-nowrap/.test(dashboard) && /shrink-0 whitespace-nowrap rounded/.test(dashboard)],
  ['Geo Operations uses the shared dashboard workspace width with aligned summary and full-width sections', /geo-operations-content dashboard-workspace-content relative flex[\s\S]*max-w-full/.test(dashboard) && !/geo-operations-content[\s\S]{0,220}max-w-\[72rem\]/.test(dashboard) && /geo-operations-summary-grid[\s\S]*canCreateBreakRequests && "md:grid-cols-2"/.test(dashboard) && (dashboard.match(/geo-operations-full-section/g) || []).length === 2],
  ['Geo Operations retains a responsive single-column fallback with RTL-safe logical centering', /geo-operations-summary-grid[\s\S]*grid-cols-1[\s\S]*md:grid-cols-2/.test(dashboard) && /isRtl \? "text-right" : "text-left"/.test(dashboard) && /overflow-x-hidden/.test(dashboard)],
  ['registry-backed rail and launcher are rendered', /<DashboardNavigation[\s\S]*items=\{navigationItems\}/.test(dashboard) && /aria-expanded/.test(nav)],
  ['one launcher focus target is shared by mobile, rail, and the desktop fixed assembly', (nav.match(/id="stanza-control-center-trigger"/g) || []).length === 1 && /data-stanza-launcher-assembly/.test(nav) && /isMobileLayout/.test(nav)],
  ['launcher owns navigation and Settings stays separate', /onOpenControlCenter/.test(nav) && /Settings/.test(nav) && !/showControlCenter/.test(nav)],
  ['launcher supports Escape, outside click, and focus restoration', /event\.key === 'Escape'/.test(nav) && /launcherRef\.current\?\.focus/.test(nav) && /window\.addEventListener\('mousedown'/.test(nav)],
  ['mobile shortcuts use stable ids with a minimum and crowding warning', /mobileShortcuts/.test(dashboard) && /selected\.length <= 4/.test(shortcuts) && /selected\.length > 5/.test(shortcuts)],
  ['shortcuts offer immediate up, down, start, and end controls plus a safe recommended reset', ["'up'", "'down'", "'start'", "'end'"].every((move) => shortcuts.includes(move)) && /moveShortcutPosition/.test(shortcuts) && /Reset to recommended/.test(shortcuts)],
  ['permission-filtered registry drives desktop and mobile surfaces', /\.filter\(Boolean\)/.test(dashboard) && /allowedIds/.test(nav) && /validShortcuts/.test(nav)],
  ['module navigation records from launcher, rail, mobile shortcuts, palette navigation, and valid notification links', /onModuleNavigate\?\.\(item\.id\)/.test(nav) && /command\.type === 'navigation'/.test(dashboard) && /recordModuleNavigation\('expenses'\)/.test(dashboard) && /recordModuleNavigation\('roster'\)/.test(dashboard)],
  ['opening or searching the launcher does not record module use', /onClick=\{\(\) => setOpen\(\(value\) => !value\)\}/.test(nav) && /onOpenCommandPalette\(launcherRef\.current\)/.test(nav) && !/setOpen\(\(value\) => !value\)[\s\S]{0,100}onModuleNavigate/.test(nav)],
  ['usage storage is bounded, validated, local-only, and contains stable navigation ids only', /MODULE_USAGE_LIMIT = 30/.test(moduleUsageSource) && /MODULE_USAGE_COUNT_LIMIT = 9_999/.test(moduleUsageSource) && /isStableNavigationId/.test(moduleUsageSource) && !/fetch|apiFetch|XMLHttpRequest/.test(moduleUsageSource)],
  ['permission loss prunes module usage against the authorised navigation registry', /normaliseModuleUsage\(moduleUsage, availableNavigationIds\)/.test(dashboard)],
  ['launcher shows compact translated recent and frequent sections above the complete groups', /data-launcher-section="recent"/.test(nav) && /data-launcher-section="frequent"/.test(nav) && /Recent/.test(nav) && /الأخيرة/.test(nav) && /Frequently used/.test(nav) && /الأكثر استخدامًا/.test(nav) && /groups\.map/.test(nav)],
  ['launcher and mobile sheet render a registry-backed Quick Actions section only when actions exist', /data-launcher-section="quick-actions"/.test(nav) && /quickActions\.length > 0/.test(nav) && /quickActions=\{pinnedQuickActions\}/.test(dashboard) && /sm:grid-cols-2/.test(nav)],
  ['quick actions execute through the existing command path and do not own workflow state', /executeRegisteredCommand/.test(dashboard) && /onExecuteQuickAction=\{executePinnedQuickAction\}/.test(dashboard) && /command\.execute\(\)/.test(dashboard) && !/setLeaveRequestSignal|setExpenseDeepLink/.test(nav)],
  ['quick action settings preserve ordered ids, provide drag alternatives, and allow an intentional empty launcher section', /MAX_PINNED_QUICK_ACTIONS/.test(quickActions) && /data-quick-action-order-id/.test(quickActions) && /useLongPressShortcutSwap/.test(quickActions) && ['start', 'up', 'down', 'end'].every((move) => quickActions.includes(`'${move}'`)) && /Clear pinned actions/.test(quickActions) && /Reset to recommended/.test(quickActions)],
  ['quick action settings use authorised registry commands with RTL-safe accessible controls', /getPinnableCommands/.test(quickActions) && /aria-live="polite"/.test(quickActions) && /focus-visible:ring-2/.test(quickActions) && /ثبّت ما يصل إلى ستة إجراءات/.test(quickActions)],
  ['usage reset clears only module usage and preserves every other preference', /resetModuleUsage/.test(dashboard) && /dash\.resetRecentFrequent/.test(dashboard) && /'dash\.resetRecentFrequent': 'إعادة تعيين الوحدات الأخيرة والأكثر استخدامًا'/.test(language) && /moduleUsage: \{\}/.test(read('src/lib/StanzaPreferencesContext.tsx'))],
  ['roster uses Fit Screen and Detailed Grid controls only on the mobile roster layout', /isMobileNavigationLayout[\s\S]*rosterPresentationMode === 'auto'/.test(dashboard) && /data-roster-presentation-selector/.test(dashboard) && /isMobileNavigationLayout && <div data-roster-presentation-selector/.test(dashboard) && /: 'detailed'/.test(dashboard) && /role="region"/.test(dashboard)],
  ['fit screen exposes accessible expandable day cards', /expandedRosterDate/.test(dashboard) && /aria-expanded=\{expanded\}/.test(dashboard) && /Read-only schedule/.test(dashboard)],
  ['shared native scrollbar treatment is theme-token based', /.stanza-scrollbar/.test(css) && /scrollbar-color/.test(css) && /::-webkit-scrollbar-thumb/.test(css)],
  ['one lazy lanyard remains inside the launcher assembly without a layout column', (dashboard.match(/<StanzaDashboardLanyard/g) || []).length === 1 && /data-stanza-lanyard-anchor/.test(nav) && /pointer-events-none absolute inset-0 z-10 h-full w-full/.test(read('src/components/lanyard/StanzaDashboardLanyard.tsx')) && /lanyardSlot=\{launcherLanyard\}/.test(dashboard)],
  ['external lanyard remains mounted while navigation or Settings is open', /hidden=\{!isLanyardSceneReady\}/.test(dashboard) && !/hidden=\{!isLanyardSceneReady \|\| showControlCenter\}/.test(dashboard) && /interactionEnabled=\{!showControlCenter && isDashboardVisible\}/.test(dashboard)],
  ['launcher has no independent decorative starter line or origin dot', /<div data-stanza-lanyard-anchor className="relative shrink-0">[\s\S]*?<\/div>\s*\);/.test(nav) && !/showLanyardDock/.test(nav) && !/h-7 w-px/.test(nav) && !/bg-gradient-to-b from-emerald-400/.test(nav)],
  ['3D lanyard anchor begins directly at the shared launcher wrapper bottom edge', /querySelector<HTMLElement>\('\[data-stanza-lanyard-anchor\]'\)/.test(dashboard) && /y: -\(rect\.bottom \/ viewportHeight\) \* 2 \+ 1/.test(dashboard) && !/LANYARD_ANCHOR_VERTICAL_OFFSET_PX/.test(dashboard) && !/translateY\(12px\)/.test(read('src/components/lanyard/StanzaDashboardLanyard.tsx'))],
  ['lanyard remains a Launcher-only presentation and stays visually connected beneath Settings', /shouldMountLanyard = lanyardEnabled && isLanyardCapable && desktopNavigationMode === 'launcher'/.test(dashboard) && /paused=\{!isDashboardVisible\}/.test(dashboard) && /z-20/.test(nav) && /z-40/.test(dashboard)],
  ['launcher assembly has no broad interaction hitbox while the lanyard endpoint follows the dynamic connector', /pointer-events-none fixed inset-0/.test(nav) && /pointer-events-auto absolute start/.test(nav) && /CONNECTOR_ROPE_OVERLAP = 0\.045/.test(read('src/components/lanyard/Lanyard.tsx')) && /connectorDirection\.normalize\(\), CONNECTOR_ROPE_OVERLAP/.test(read('src/components/lanyard/Lanyard.tsx')) && /useRopeJoint\(j3, j4/.test(read('src/components/lanyard/Lanyard.tsx')) && /useSphericalJoint\(j4, card/.test(read('src/components/lanyard/Lanyard.tsx'))],
  ['Settings remains separate from launcher navigation and replaces visible Control Center copy', /onOpenControlCenter/.test(nav) && /<Settings/.test(nav) && !/Control Center/.test(nav) && /'dash\.controlCenterTitle': 'Stanza Settings'/.test(language) && /'dash\.controlCenterTitle': 'إعدادات Stanza'/.test(language) && !/onClick=\{onOpenControlCenter\}[^\n]*StanzaFingerprintMark/.test(nav)],
  ['Settings has one panel title and one descriptive Appearance group without duplicate headings', /dash\.controlCenterTitle/.test(dashboard) && /dash\.appearance/.test(dashboard) && /renderControlCenterAccordion\(\s*'settings',\s*t\('dash\.settings'\)/.test(dashboard) && /'dash\.appearance': 'Appearance'/.test(language) && /'dash\.appearance': 'المظهر'/.test(language)],
  ['Arabic launcher and Settings labels use concise RTL-aware terminology', ['نمط التنقل', 'زر Stanza فقط', 'شريط مختصر', 'إعادة تعيين الوحدات الأخيرة والأكثر استخدامًا', 'درجة سطوع الوضع الفاتح', 'داكن نسبيًا'].every((copy) => language.includes(copy)) && /dash\.navigationStyle/.test(dashboard) && /dash\.launcherOnly/.test(dashboard) && /dash\.compactRail/.test(dashboard) && /isRtl && '-scale-x-100'/.test(nav)],
  ['mobile bottom navigation keeps a fixed Stanza launcher and a dedicated shortcut customiser', /md:hidden/.test(nav) && /Customise shortcuts/.test(nav) && /<Plus/.test(nav) && /bottom-\[calc\(\.75rem\+env\(safe-area-inset-bottom\)\)\]/.test(nav)],
  ['navigation surface is RTL and theme safe', /isRtl/.test(nav) && /dark:bg/.test(nav) && /lang === 'ar'/.test(nav)],
  ['preference controls are keyboard-accessible and reduced-motion safe', /type="range"/.test(dashboard) && /aria-valuetext/.test(dashboard) && /motion-reduce:transition-none/.test(dashboard) && /motion-reduce:transition-none/.test(nav)],
  ['navigation groups resolve through translated internal keys and the RTL logout icon alone is mirrored', /nav\.group\.\$\{group\}/.test(nav) && /isRtl && '-scale-x-100'/.test(nav) && /'nav\.group\.workspace'/.test(language)],
  ['rail ordering persists stable ids, filters unavailable ids, supports drag, and offers keyboard controls in Settings', /desktopRailOrder/.test(read('src/lib/StanzaPreferencesContext.tsx')) && /orderedRailItems/.test(nav) && /draggable=\{Boolean\(onRailOrderChange\)\}/.test(nav) && /DesktopRailOrderSettings/.test(dashboard) && /normaliseDesktopRailOrder/.test(read('src/components/navigation/DesktopRailOrderSettings.tsx'))],
  ['mobile settings editor follows the actual layout breakpoint and is absent from desktop render paths', /isMobileNavigationLayout && <div/.test(dashboard) && /matchMedia\('\(max-width: 767px\)'\)/.test(dashboard)],
  ['focused mobile customiser reuses shortcut state, locks scrolling, restores focus, and supports Escape', /MobileShortcutEditor/.test(dashboard) && /document\.body\.style\.overflow = 'hidden'/.test(shortcutEditor) && /returnFocusRef\.current\?\.focus/.test(shortcutEditor) && /event\.key === 'Escape'/.test(shortcutEditor)],
  ['shortcut selection cannot retrigger dialog teardown or focus restoration', /onCloseRef/.test(shortcutEditor) && /focus\(\{ preventScroll: true \}\)/.test(shortcutEditor) && /\}, \[returnFocusRef\]\);/.test(shortcutEditor) && /onClose=\{closeMobileShortcutEditor\}/.test(dashboard)],
  ['available option rows keep stable registry order and selected shortcuts append without sorting the option list', /\{items\.map\(\(item\)/.test(shortcuts) && /onChange\(\[\.\.\.selected, id\]\)/.test(shortcuts) && !/items\.sort|sort\(.*selected/.test(shortcuts)],
  ['one shortcut preference update avoids duplicate persistence writes', /current\.mobileShortcuts\.every/.test(preferences) && /\? current\s*: \{ \.\.\.current, mobileShortcuts: next \}/.test(preferences)],
  ['all selected mobile shortcuts render in a contained horizontal scroller without a five-item cap', /stanza-mobile-shortcuts/.test(nav) && /overflow-x-auto/.test(nav) && /shortcutItems\.map/.test(nav) && !/shortcutItems\.slice\(0, 5\)/.test(nav)],
  ['mobile shortcuts use a cancellable long-press pointer swap while ordinary taps still select a route', /holdTimerRef/.test(shortcutOrder) && /MOVE_TOLERANCE_PX/.test(shortcutOrder) && /reset\(true, true\)/.test(shortcutOrder) && /reset\(false\)/.test(shortcutOrder) && /consumeSuppressedClick/.test(nav) && /choose\(item\)/.test(nav)],
  ['drag movement highlights one target and commits only once on pointer release', /setTargetId\(candidate\)/.test(shortcutOrder) && /onPointerUp/.test(shortcutOrder) && /onSwapRef\.current/.test(shortcutOrder) && !/onPointerMove[\s\S]{0,900}onSwapRef\.current/.test(shortcutOrder)],
  ['selected-only order rows expose named drag handles, logical RTL-safe controls, and polite announcements', /data-mobile-shortcut-order-id/.test(shortcuts) && /Reorder \$\{item\.label\}/.test(shortcuts) && /aria-live="polite"/.test(shortcuts) && /\\u0646\\u0642\\u0644/.test(shortcuts)],
  ['launcher search is not focused automatically when navigation opens', !/querySelector<HTMLInputElement>\('input'\)\?\.focus/.test(nav)],
  ['demo account accordion keeps its lightweight content mounted behind a stable opaque surface', /id="demo-account-panel"/.test(login) && /bg-\[#061f17\]/.test(login) && /transition-\[grid-template-rows,opacity\]/.test(login) && /duration-\[180ms\]/.test(login) && !/backdrop-blur/.test(login.slice(login.indexOf('demo-account-panel') - 900, login.indexOf('demo-account-panel') + 2200))],
  ['shortcut sheet and selected ordering area are content-sized before deliberate scrolling caps apply', /data-mobile-shortcut-sheet/.test(shortcutEditor) && /h-auto/.test(shortcutEditor) && !/flex max-h-full/.test(shortcutEditor) && /order-1 mt-3/.test(shortcuts) && /order-2 mt-4/.test(shortcuts) && /max-h-\[min\(30dvh,15rem\)\]/.test(shortcuts) && !/max-h-56/.test(shortcuts)],
  ['touch reorder begins only from a labelled handle and keeps a visible offset preview with bounded list scrolling', /Reorder \$\{item\.label\}/.test(shortcuts) && /data-mobile-shortcut-drag-preview/.test(shortcuts) && /previewPoint\.y - \(drag\.previewPoint\.touch \? 48 : 18\)/.test(shortcuts) && /scrollContainerRef/.test(shortcutOrder) && /const edge = 36/.test(shortcutOrder) && /scrollTop \+= step/.test(shortcutOrder)],
  ['launcher uses restrained transform-only interaction polish with reduced-motion fallback', /transition-\[transform,box-shadow,background-color,border-color\]/.test(nav) && /hover:scale-\[1\.015\]/.test(nav) && /active:scale-\[\.97\]/.test(nav) && /scale-\[1\.025\]/.test(nav) && /motion-reduce:transform-none/.test(nav)],
  ['panel wordmark uses a structural accented initial without unsafe HTML', /lang === 'ar' \? <span>Stanza<\/span> : <>\s*<span className="text-emerald-600 dark:text-emerald-400">S<\/span><span>tanza<\/span>/.test(nav) && !/dangerouslySetInnerHTML/.test(nav)],
  ['selected navigation typography remains readable and stable', /font-extrabold tracking-normal text-emerald-700/.test(nav)],
];
let failed = false;
for (const [label, passed] of checks) { console.log(`${passed ? 'PASS' : 'FAIL'} ${label}`); failed ||= !passed; }
if (failed) process.exitCode = 1;
