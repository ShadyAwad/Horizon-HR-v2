import type { DashboardNavigationItem } from '../../navigation/navigation-contracts';
import { getWorkspaceAliases } from '../../navigation/workspace-registry';
import type {
  CommandGroup,
  StanzaCommand,
  StanzaCommandInput,
} from './command-palette-types';

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
    keywords: [item.id, item.label, ...getWorkspaceAliases(item.id)],
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
