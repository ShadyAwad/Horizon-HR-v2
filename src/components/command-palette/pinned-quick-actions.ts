import type { StanzaCommand } from './command-palette-types';

export const MAX_PINNED_QUICK_ACTIONS = 6;

export function getPinnableCommands(commands: readonly StanzaCommand[]) {
  return commands.filter((command) => command.pinnable && command.dangerous === false);
}

export function normalisePinnedQuickActionIds(
  commandIds: readonly string[],
  commands: readonly StanzaCommand[],
) {
  const allowedIds = new Set(getPinnableCommands(commands).map((command) => command.id));
  const result: string[] = [];

  for (const commandId of commandIds) {
    if (typeof commandId !== 'string' || commandId.length > 120) continue;
    if (!allowedIds.has(commandId) || result.includes(commandId)) continue;
    result.push(commandId);
    if (result.length === MAX_PINNED_QUICK_ACTIONS) break;
  }

  return result;
}

export function getRecommendedPinnedQuickActionIds(commands: readonly StanzaCommand[]) {
  return getPinnableCommands(commands)
    .filter((command) => typeof command.recommendedPriority === 'number')
    .sort((left, right) => (
      (left.recommendedPriority ?? Number.MAX_SAFE_INTEGER)
      - (right.recommendedPriority ?? Number.MAX_SAFE_INTEGER)
      || left.label.localeCompare(right.label)
    ))
    .slice(0, MAX_PINNED_QUICK_ACTIONS)
    .map((command) => command.id);
}
