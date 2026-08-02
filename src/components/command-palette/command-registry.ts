import type { DashboardNavigationItem } from '../navigation/DashboardNavigation';
import type {
  CommandGroup,
  StanzaCommand,
  StanzaCommandInput,
} from './command-palette-types';

const NAVIGATION_ALIASES: Record<string, readonly string[]> = {
  geofence: ['attendance', 'clock', 'clock in', 'location', 'geo', 'الحضور', 'الموقع'],
  roster: ['schedule', 'shift', 'leave', 'roster', 'جدول', 'مناوبة', 'إجازة'],
  expenses: ['claim', 'receipt', 'reimbursement', 'pay', 'مصروفات', 'مطالبة'],
  hiring: ['applicant', 'candidate', 'recruitment', 'توظيف', 'مرشح'],
  performance: ['review', 'goals', 'okr', 'recognition', 'أداء', 'أهداف'],
  organisation: ['people', 'department', 'team', 'roles', 'hierarchy', 'موظف', 'قسم', 'فريق'],
  locations: ['site', 'office', 'geofence', 'موقع', 'فرع'],
  liveEmployees: ['employee', 'attendance', 'live', 'موظف', 'حضور'],
  assets: ['equipment', 'hardware', 'device', 'asset', 'أصول', 'معدات'],
  feed: ['news', 'announcement', 'company', 'منشور', 'إعلان'],
  payroll: ['pay', 'salary', 'compensation', 'رواتب', 'راتب'],
  grievances: ['complaint', 'case', 'شكوى'],
  resignations: ['resign', 'exit', 'استقالة'],
  audit: ['history', 'security', 'trail', 'تدقيق', 'سجل'],
  sessionCenter: ['session', 'device', 'security', 'جلسة', 'جهاز'],
  profile: ['account', 'digital id', 'badge', 'ملف', 'هوية'],
};

const VALID_GROUPS = new Set<CommandGroup>([
  'workspace',
  'peopleOperations',
  'administration',
  'quickActions',
  'settings',
]);

export function buildCommandRegistry({
  navigationItems,
  additionalCommands = [],
  openLabel,
  moduleDescription,
}: {
  navigationItems: readonly DashboardNavigationItem[];
  additionalCommands?: readonly StanzaCommandInput[];
  openLabel: (moduleLabel: string) => string;
  moduleDescription: (moduleLabel: string) => string;
}) {
  const commands: StanzaCommand[] = navigationItems.map((item) => ({
    id: `navigation:${item.id}`,
    type: 'navigation',
    group: VALID_GROUPS.has(item.group as CommandGroup)
      ? item.group as CommandGroup
      : 'workspace',
    label: openLabel(item.label),
    description: moduleDescription(item.label),
    keywords: [item.id, item.label, ...(NAVIGATION_ALIASES[item.id] || [])],
    icon: item.icon,
    execute: item.onSelect,
    mobileAvailable: true,
    dangerous: false,
    pinnable: false,
    contextId: item.id,
    sourceNavigationId: item.id,
  }));

  for (const input of additionalCommands) {
    if (!input.allowed || !VALID_GROUPS.has(input.group)) continue;
    commands.push({
      ...input,
      mobileAvailable: input.mobileAvailable ?? true,
      dangerous: false,
      pinnable: input.pinnable === true,
    });
  }

  const ids = new Set<string>();
  return commands.filter((command) => {
    if (!command.id || ids.has(command.id)) return false;
    ids.add(command.id);
    return true;
  });
}
