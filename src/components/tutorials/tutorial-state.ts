import type { TutorialProgress } from './tutorial-types';

const MAX_TUTORIAL_HISTORY = 20;

function normaliseHistory(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([id, version]) => /^[a-z0-9-]{1,80}$/.test(id) && Number.isInteger(version) && Number(version) > 0 && Number(version) < 100)
      .slice(0, MAX_TUTORIAL_HISTORY),
  ) as Record<string, number>;
}

export function readTutorialProgress(value: unknown): TutorialProgress {
  const raw = value && typeof value === 'object' ? value as Partial<TutorialProgress> : {};
  return {
    tutorialsEnabled: raw.tutorialsEnabled !== false,
    tutorialsAutoStart: raw.tutorialsAutoStart !== false,
    completedTutorials: normaliseHistory(raw.completedTutorials),
    dismissedTutorials: normaliseHistory(raw.dismissedTutorials),
  };
}

export function isTutorialCurrent(history: Record<string, number>, id: string, version: number) {
  return history[id] === version;
}
