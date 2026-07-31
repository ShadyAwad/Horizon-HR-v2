export const MAX_RECENT_COMMANDS = 6;

export function normaliseRecentCommandIds(
  commandIds: readonly string[],
  availableCommandIds?: ReadonlySet<string>,
  maximum = MAX_RECENT_COMMANDS,
) {
  const unique: string[] = [];
  for (const value of commandIds) {
    if (typeof value !== 'string' || !value || unique.includes(value)) continue;
    if (availableCommandIds && !availableCommandIds.has(value)) continue;
    unique.push(value);
    if (unique.length >= maximum) break;
  }
  return unique;
}

export function recordRecentCommand(
  current: readonly string[],
  commandId: string,
  availableCommandIds?: ReadonlySet<string>,
) {
  return normaliseRecentCommandIds(
    [commandId, ...current.filter((value) => value !== commandId)],
    availableCommandIds,
  );
}
