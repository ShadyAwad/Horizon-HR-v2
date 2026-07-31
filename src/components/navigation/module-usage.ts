export type ModuleUsageEntry = {
  count: number;
  lastOpenedAt: number;
};

export type ModuleUsage = Record<string, ModuleUsageEntry>;

export const MODULE_USAGE_COOLDOWN_MS = 45_000;
export const MODULE_USAGE_LIMIT = 30;
export const MODULE_USAGE_COUNT_LIMIT = 9_999;
export const RECENT_MODULE_LIMIT = 4;
export const FREQUENT_MODULE_LIMIT = 4;
export const FREQUENT_MODULE_THRESHOLD = 2;

const MAX_TIMESTAMP_DRIFT_MS = 5 * 60_000;

function isStableNavigationId(value: string) {
  return /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value);
}

export function normaliseModuleUsage(
  value: unknown,
  allowedIds?: ReadonlySet<string>,
  now = Date.now(),
): ModuleUsage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.entries(value as Record<string, unknown>)
    .filter(([id]) => isStableNavigationId(id) && (!allowedIds || allowedIds.has(id)))
    .flatMap(([id, rawEntry]) => {
      if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) return [];
      const entry = rawEntry as Partial<ModuleUsageEntry>;
      if (!Number.isSafeInteger(entry.count) || (entry.count ?? 0) < 1) return [];
      if (typeof entry.lastOpenedAt !== 'number' || !Number.isFinite(entry.lastOpenedAt)) return [];
      if (entry.lastOpenedAt <= 0 || entry.lastOpenedAt > now + MAX_TIMESTAMP_DRIFT_MS) return [];
      return [[id, {
        count: Math.min(MODULE_USAGE_COUNT_LIMIT, entry.count as number),
        lastOpenedAt: Math.floor(entry.lastOpenedAt),
      }] as const];
    })
    .sort(([, left], [, right]) => right.lastOpenedAt - left.lastOpenedAt)
    .slice(0, MODULE_USAGE_LIMIT)
    .reduce<ModuleUsage>((usage, [id, entry]) => {
      usage[id] = entry;
      return usage;
    }, {});
}

export function recordModuleUsage(
  current: ModuleUsage,
  navigationId: string,
  allowedIds: ReadonlySet<string>,
  now = Date.now(),
  cooldownMs = MODULE_USAGE_COOLDOWN_MS,
): ModuleUsage {
  if (!allowedIds.has(navigationId) || !isStableNavigationId(navigationId)) {
    return normaliseModuleUsage(current, allowedIds, now);
  }

  const usage = normaliseModuleUsage(current, allowedIds, now);
  const previous = usage[navigationId];
  if (previous && now - previous.lastOpenedAt < cooldownMs) return usage;

  return normaliseModuleUsage({
    ...usage,
    [navigationId]: {
      count: Math.min(MODULE_USAGE_COUNT_LIMIT, (previous?.count ?? 0) + 1),
      lastOpenedAt: now,
    },
  }, allowedIds, now);
}

export function getRecentModuleIds(
  usage: ModuleUsage,
  orderedAllowedIds: readonly string[],
  currentNavigationId?: string,
): string[] {
  const allowedIds = new Set(orderedAllowedIds);
  const recent = Object.entries(normaliseModuleUsage(usage, allowedIds))
    .sort(([leftId, left], [rightId, right]) => (
      right.lastOpenedAt - left.lastOpenedAt
      || orderedAllowedIds.indexOf(leftId) - orderedAllowedIds.indexOf(rightId)
      || leftId.localeCompare(rightId)
    ))
    .map(([id]) => id)
    .slice(0, RECENT_MODULE_LIMIT);

  if (recent.length > 1 && recent[0] === currentNavigationId) {
    [recent[0], recent[1]] = [recent[1], recent[0]];
  }
  return recent;
}

export function getFrequentModuleIds(
  usage: ModuleUsage,
  orderedAllowedIds: readonly string[],
  excludedIds: ReadonlySet<string> = new Set(),
  now = Date.now(),
): string[] {
  const allowedIds = new Set(orderedAllowedIds);
  const dayMs = 24 * 60 * 60 * 1_000;
  const recencyBonus = (lastOpenedAt: number) => Math.max(0, 1 - ((now - lastOpenedAt) / (30 * dayMs)));

  return Object.entries(normaliseModuleUsage(usage, allowedIds, now))
    .filter(([id, entry]) => !excludedIds.has(id) && entry.count >= FREQUENT_MODULE_THRESHOLD)
    .sort(([leftId, left], [rightId, right]) => (
      (right.count + recencyBonus(right.lastOpenedAt)) - (left.count + recencyBonus(left.lastOpenedAt))
      || right.lastOpenedAt - left.lastOpenedAt
      || orderedAllowedIds.indexOf(leftId) - orderedAllowedIds.indexOf(rightId)
      || leftId.localeCompare(rightId)
    ))
    .map(([id]) => id)
    .slice(0, FREQUENT_MODULE_LIMIT);
}
