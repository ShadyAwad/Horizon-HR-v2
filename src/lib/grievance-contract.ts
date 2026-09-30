export const CASE_STATUSES = ['submitted', 'triaged', 'assigned', 'in_progress', 'waiting', 'resolved', 'closed'] as const;
export type CaseStatus = typeof CASE_STATUSES[number];
export const CASE_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export const CASE_CATEGORIES = ['general', 'workplace', 'conduct', 'payroll', 'safety', 'equipment', 'leave_request', 'other'] as const;
export const CASE_TRANSITIONS: Record<CaseStatus, readonly CaseStatus[]> = {
    submitted: ['triaged'], triaged: ['assigned', 'in_progress'], assigned: ['in_progress', 'waiting'], in_progress: ['waiting', 'resolved'], waiting: ['in_progress', 'resolved'], resolved: ['in_progress', 'closed'], closed: [],
};
export class CaseError extends Error {
    constructor(public statusCode: number, public code: string, message: string) { super(message); }
}
export const caseFail = (status: number, code: string, message: string) => new CaseError(status, code, message);
export function caseId(value: unknown): string { if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
    throw caseFail(400, 'INVALID_ID', 'Invalid identifier.'); return value; }
export function caseText(value: unknown, max: number, required = true): string { if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim()))
    throw caseFail(400, 'INVALID_TEXT', 'Enter text within the allowed length.'); return value.trim(); }
export function caseVersion(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw caseFail(400, 'VERSION_REQUIRED', 'Reload the case and retry.'); return Number(value); }
export function caseTransition(from: CaseStatus, to: unknown): CaseStatus { if (!CASE_TRANSITIONS[from]?.includes(to as CaseStatus))
    throw caseFail(409, 'INVALID_TRANSITION', 'This case transition is not allowed.'); return to as CaseStatus; }
export function casePage(value: unknown): number { const n = Number(value ?? 1); if (!Number.isInteger(n) || n < 1 || n > 10000)
    throw caseFail(400, 'INVALID_PAGE', 'Invalid page.'); return n; }
export function caseObject(value: unknown, keys: readonly string[]): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k)))
    throw caseFail(400, 'INVALID_FIELDS', 'Unexpected case fields.'); return value as Record<string, unknown>; }
