export const HIRING_STAGES = ['new', 'screening', 'hr_review', 'hiring_manager_review', 'interview', 'final_review', 'offer', 'hired', 'rejected', 'withdrawn'] as const;
export const HIRING_STATUSES = ['active', 'archived'] as const;
export const HIRING_NOTE_TYPES = ['general', 'screening', 'interview', 'decision', 'handoff'] as const;
export const HIRING_NOTE_VISIBILITIES = ['hiring_team', 'hr_only'] as const;
export const HIRING_HANDOFF_STATUSES = ['pending', 'acknowledged', 'completed', 'cancelled'] as const;

export type HiringStage = typeof HIRING_STAGES[number];
export type HiringStatus = typeof HIRING_STATUSES[number];
export type HiringNoteType = typeof HIRING_NOTE_TYPES[number];
export type HiringNoteVisibility = typeof HIRING_NOTE_VISIBILITIES[number];

const ACTIVE_STAGES = HIRING_STAGES.filter((stage) => !['hired', 'rejected', 'withdrawn'].includes(stage));

export const HIRING_STAGE_TRANSITIONS: Readonly<Record<HiringStage, readonly HiringStage[]>> = {
  new: ['screening', 'rejected', 'withdrawn'],
  screening: ['hr_review', 'rejected', 'withdrawn'],
  hr_review: ['hiring_manager_review', 'rejected', 'withdrawn'],
  hiring_manager_review: ['interview', 'rejected', 'withdrawn'],
  interview: ['final_review', 'rejected', 'withdrawn'],
  final_review: ['offer', 'rejected', 'withdrawn'],
  offer: ['hired', 'rejected', 'withdrawn'],
  hired: [],
  rejected: [],
  withdrawn: [],
};

export function isHiringStage(value: unknown): value is HiringStage {
  return typeof value === 'string' && HIRING_STAGES.includes(value as HiringStage);
}

export function canTransitionHiringStage(from: HiringStage, to: HiringStage, permissions: readonly string[] = []) {
  if (!HIRING_STAGE_TRANSITIONS[from].includes(to)) return false;
  return !isFinalHiringTransition(from, to) || permissions.includes('hiring.make_final_decision');
}

export function isFinalHiringTransition(from: HiringStage, to: HiringStage) {
  return (from === 'final_review' && ['offer', 'rejected'].includes(to)) || (from === 'offer' && ['hired', 'rejected'].includes(to));
}

export function normalizeApplicantEmail(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  return typeof value === 'string' ? value.trim().toLowerCase() : null;
}

export function isActiveHiringStage(stage: HiringStage) {
  return ACTIVE_STAGES.includes(stage);
}
