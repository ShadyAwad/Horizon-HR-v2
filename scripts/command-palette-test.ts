import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildCommandRegistry } from '../src/components/command-palette/command-registry';
import {
  MAX_RECENT_COMMANDS,
  normaliseRecentCommandIds,
  recordRecentCommand,
} from '../src/components/command-palette/command-palette-state';
import {
  normaliseCommandSearchText,
  searchCommands,
} from '../src/components/command-palette/command-search';
import type { StanzaCommandInput } from '../src/components/command-palette/command-palette-types';
import type { DashboardNavigationItem } from '../src/components/navigation/DashboardNavigation';
import { readStanzaPreferences } from '../src/lib/StanzaPreferencesContext';

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const dashboard = read('src/pages/Dashboard.tsx');
const palette = read('src/components/command-palette/CommandPalette.tsx');
const registrySource = read('src/components/command-palette/command-registry.ts');
const searchSource = read('src/components/command-palette/command-search.ts');
const navigation = read('src/components/navigation/DashboardNavigation.tsx');
const preferences = read('src/lib/StanzaPreferencesContext.tsx');

let executions = 0;
const navigationItems: DashboardNavigationItem[] = [
  {
    id: 'roster',
    label: 'Weekly Roster',
    group: 'workspace',
    icon: null,
    active: true,
    onSelect: () => { executions += 1; },
  },
  {
    id: 'feed',
    label: 'Company Feed',
    group: 'administration',
    icon: null,
    active: false,
    onSelect: () => { executions += 1; },
  },
];
const additionalCommands: StanzaCommandInput[] = [
  {
    id: 'roster:leave',
    type: 'internal_view',
    group: 'quickActions',
    label: 'Open Leave',
    description: 'View leave requests.',
    keywords: ['leave', 'time off', 'إجازة'],
    icon: null,
    execute: () => { executions += 1; },
    allowed: true,
    contextId: 'roster',
  },
  {
    id: 'expenses:approvals',
    type: 'internal_view',
    group: 'quickActions',
    label: 'Open Expense Approvals',
    description: 'Open an authorised queue.',
    keywords: ['expense approval'],
    icon: null,
    execute: () => { executions += 1; },
    allowed: false,
    contextId: 'expenses',
  },
];
const commands = buildCommandRegistry({
  navigationItems,
  additionalCommands,
  openLabel: (label) => `Open ${label}`,
  moduleDescription: (label) => `Navigate to ${label}`,
});

assert.deepEqual(
  commands.map((command) => command.id),
  ['navigation:roster', 'navigation:feed', 'roster:leave'],
  'only authorised navigation and additional commands are registered',
);
assert.equal(commands.every((command) => command.dangerous === false), true);
assert.equal(commands.every((command) => !('permission' in command)), true, 'raw permission evidence is not exposed');
assert.equal(commands[0].sourceNavigationId, 'roster', 'global module commands retain their stable navigation id');
assert.equal(commands.find((command) => command.id === 'roster:leave')?.sourceNavigationId, undefined, 'internal workflows are not treated as global module navigation');
commands[0].execute();
assert.equal(executions, 1, 'navigation commands reuse the original navigation action');

assert.equal(normaliseCommandSearchText('  RÓSTER   Schedule '), 'roster schedule');
assert.equal(normaliseCommandSearchText('إِجَازَة'), 'اجازة');
assert.equal(searchCommands(commands, 'weekly')[0]?.id, 'navigation:roster', 'prefix search');
assert.equal(searchCommands(commands, 'company')[0]?.id, 'navigation:feed', 'substring search');
assert.equal(searchCommands(commands, 'time off')[0]?.id, 'roster:leave', 'keyword search');
assert.equal(
  searchCommands(commands, 'إجازة').some((command) => command.id === 'roster:leave'),
  true,
  'Arabic search',
);
assert.equal(searchCommands(commands, '  time   off  ')[0]?.id, 'roster:leave', 'whitespace normalisation');
assert.equal(searchCommands(commands, 'rstr')[0]?.id, 'navigation:roster', 'lightweight subsequence matching');
assert.equal(searchCommands(commands, 'not-a-command').length, 0, 'no-results search');
assert.equal(
  searchCommands(commands, '', { currentContextId: 'roster' })[0]?.contextId,
  'roster',
  'current context receives a deterministic boost',
);

const availableIds = new Set(commands.map((command) => command.id));
assert.deepEqual(
  normaliseRecentCommandIds(['unknown', 'roster:leave', 'roster:leave', 'navigation:feed'], availableIds),
  ['roster:leave', 'navigation:feed'],
  'unknown and unavailable recent commands are removed',
);
let recent = recordRecentCommand([], 'navigation:feed', availableIds);
recent = recordRecentCommand(recent, 'roster:leave', availableIds);
recent = recordRecentCommand(recent, 'navigation:feed', availableIds);
assert.deepEqual(recent, ['navigation:feed', 'roster:leave'], 'recent commands are newest first without duplicates');
assert.equal(
  normaliseRecentCommandIds(Array.from({ length: 20 }, (_, index) => `command:${index}`)).length,
  MAX_RECENT_COMMANDS,
  'recent commands are bounded',
);
const restoredPreferences = readStanzaPreferences(JSON.stringify({
  recentCommandIds: ['roster:leave', 'roster:leave', 'navigation:feed'],
}));
assert.deepEqual(restoredPreferences.recentCommandIds, ['roster:leave', 'navigation:feed']);
assert.equal('query' in restoredPreferences, false, 'query text is never persisted');

const checks: Array<[string, boolean]> = [
  ['palette is lazy loaded', /const CommandPalette = lazy/.test(dashboard)],
  ['module commands come from the authorised navigation registry', /buildCommandRegistry\(\{\s*navigationItems/.test(dashboard) && /navigationItems\.map/.test(registrySource)],
  ['role names are not part of command visibility checks', !/user\.role/.test(registrySource) && !/role ===/.test(registrySource)],
  ['privileged workflows use explicit capability checks', /explicitCommandPermissions\.has\('hiring\.create'\)/.test(dashboard) && /explicitCommandPermissions\.has\('assets\.manage'\)/.test(dashboard)],
  ['permission loss prunes recent commands', /normaliseRecentCommandIds\(recentCommandIds, availableCommandIds\)/.test(dashboard)],
  ['Ctrl and Cmd K share one shortcut contract', /event\.ctrlKey \|\| event\.metaKey/.test(dashboard) && /event\.key\.toLowerCase\(\) === 'k'/.test(dashboard)],
  ['repeated shortcut focuses the existing search input', /showCommandPalette[\s\S]*setCommandPaletteFocusRequest/.test(dashboard) && /focusRequest/.test(palette)],
  ['slash ignores editable fields and blocking dialogs', /event\.key === '\/'/.test(dashboard) && /input, textarea, select, \[contenteditable="true"\]/.test(dashboard) && /querySelector\('\[role="dialog"\]\[aria-modal="true"\]'\)/.test(dashboard)],
  ['Escape closes and focus is restored', /event\.key === 'Escape'/.test(palette) && /returnFocusTarget\?\.isConnected/.test(dashboard)],
  ['launcher search opens the palette without maintaining a second input', /onOpenCommandPalette\(launcherRef\.current\)/.test(navigation) && !/Search modules/.test(navigation)],
  ['only global module commands feed launcher usage tracking', /command\.type === 'navigation' && command\.sourceNavigationId/.test(dashboard) && /recordModuleNavigation\(command\.sourceNavigationId\)/.test(dashboard) && /sourceNavigationId: item\.id/.test(registrySource)],
  ['launcher remains queryless while palette search stays authoritative', /data-launcher-section="recent"/.test(navigation) && /data-launcher-section="frequent"/.test(navigation) && !/useState\([^)]*query/.test(navigation) && /searchCommands/.test(palette)],
  ['launcher opening alone does not autofocus a search field', !/querySelector<HTMLInputElement>/.test(navigation) && !/autoFocus/.test(navigation)],
  ['mobile navigation exposes the same explicit search action', /Search Stanza/.test(navigation) && /bottom-\[calc\(5\.5rem\+env\(safe-area-inset-bottom\)\)\]/.test(navigation)],
  ['dialog uses portal, accessible semantics, and a focus trap', /createPortal/.test(palette) && /role="dialog"/.test(palette) && /aria-modal="true"/.test(palette) && /trapFocus/.test(palette)],
  ['results expose listbox, option, active descendant, and polite count', /role="listbox"/.test(palette) && /role="option"/.test(palette) && /aria-activedescendant/.test(palette) && /aria-live="polite"/.test(palette)],
  ['Arrow, Home, End, Enter, and Escape interactions exist', ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', 'Escape'].every((key) => palette.includes(`'${key}'`))],
  ['selected options scroll into view', /scrollIntoView\(\{ block: 'nearest' \}\)/.test(palette)],
  ['RTL and dark/light surfaces are explicit', /dir=\{isRtl \? 'rtl' : 'ltr'\}/.test(palette) && /bg-white/.test(palette) && /dark:bg/.test(palette)],
  ['mobile widths and safe areas are bounded without page overflow', /w-full max-w-2xl/.test(palette) && /safe-area-inset-bottom/.test(palette) && /overflow-hidden/.test(palette)],
  ['reduced motion is respected', /motion-reduce:transition-none/.test(palette)],
  ['palette stays above navigation and Settings but below critical z-100 dialogs', /z-\[80\]/.test(palette)],
  ['search is local, deterministic, and network free', !/fetch|apiFetch|XMLHttpRequest/.test(searchSource) && /registryIndex/.test(searchSource)],
  ['no arbitrary URL execution exists', !/window\.location|javascript:|href=/.test(registrySource + palette)],
  ['Open Clock In reveals but does not invoke attendance', /id: 'attendance:open-clock'/.test(dashboard) && /revealControl\('geofence'/.test(dashboard) && !/id: 'attendance:open-clock'[\s\S]{0,700}handleClockAction/.test(dashboard)],
  ['safe workflows open existing signals and deep links', /setLeaveRequestSignal/.test(dashboard) && /setExpenseDeepLink/.test(dashboard) && /setHiringCreateSignal/.test(dashboard) && /setAssetCreateSignal/.test(dashboard)],
  ['unsafe direct command IDs are absent', !/id: '(?:approve|reject|reimburse|logout|delete|revoke|archive|clock-in|clock-out)'/.test(dashboard)],
  ['command metadata does not index private record names', !/candidateName|employeeName|claimId.*keywords|applicantName/.test(registrySource)],
  ['preferences remain in the existing stanza preferences object', /STANZA_PREFERENCES_KEY = 'stanza\.preferences\.v1'/.test(preferences) && /recentCommandIds/.test(preferences)],
];

let failed = false;
for (const [label, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${label}`);
  failed ||= !passed;
}
if (failed) process.exitCode = 1;
else console.log('Command palette permission, search, recents, safety, accessibility, and shell contracts passed');
