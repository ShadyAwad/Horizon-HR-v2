export const HIRING_STAGES = ['new', 'screening', 'hr_review', 'hiring_manager_review', 'interview', 'final_review', 'offer', 'hired', 'rejected', 'withdrawn'] as const;
export const HIRING_COUNTER_STAGES = ['new', 'hr_review', 'final_review'] as const;
export type HiringStage = typeof HIRING_STAGES[number];
