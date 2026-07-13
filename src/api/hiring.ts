import type { AuthUser } from '../App';
import { apiUrl } from '../lib/api';

export const HIRING_STAGES = ['new', 'screening', 'hr_review', 'hiring_manager_review', 'interview', 'final_review', 'offer', 'hired', 'rejected', 'withdrawn'] as const;
export const HIRING_NOTE_TYPES = ['general', 'screening', 'interview', 'decision', 'handoff'] as const;
export const HIRING_NOTE_VISIBILITIES = ['hiring_team', 'hr_only'] as const;

export type HiringStage = typeof HIRING_STAGES[number];
export type HiringStatus = 'active' | 'archived';
export type HiringNoteType = typeof HIRING_NOTE_TYPES[number];
export type HiringNoteVisibility = typeof HIRING_NOTE_VISIBILITIES[number];
export type HiringHandoffStatus = 'pending' | 'acknowledged' | 'completed' | 'cancelled';

export type HiringApplicantListItem = {
  id: string; fullName: string; email: string | null; phone: string | null; positionTitle: string;
  department: string | null; stage: HiringStage; status: HiringStatus; currentOwnerId: string | null;
  currentOwnerName: string | null; appliedAt: string | null; createdAt: string; updatedAt: string;
  latestNoteAt: string | null; pendingHandoffs: number;
};

export type HiringApplicantNote = {
  id: string; noteText: string; noteType: HiringNoteType; visibility: HiringNoteVisibility;
  createdAt: string; updatedAt: string | null; authorName: string; authorRole: string;
};

export type HiringHandoff = {
  id: string; applicantId: string; fromUserId: string | null; toUserId: string; handedOffBy: string;
  fromStage: HiringStage | null; toStage: HiringStage | null; message: string | null;
  status: HiringHandoffStatus; createdAt: string; acknowledgedAt: string | null; completedAt: string | null;
  fromUserName: string | null; toUserName: string; handedOffByName: string;
};

export type HiringStageHistoryEntry = {
  id: string; previousStage: HiringStage | null; newStage: HiringStage; reason: string | null;
  createdAt: string; actorName: string;
};

export type HiringApplicantDetails = HiringApplicantListItem & {
  source: string | null; archivedAt: string | null; currentOwnerName: string | null;
  notes: HiringApplicantNote[]; handoffs: HiringHandoff[]; stageHistory: HiringStageHistoryEntry[];
};

export type HiringReviewer = { id: string; displayName: string; role: string; roleLabel: string | null; permissions: string[] };
export type HiringApplicantFilters = {
  page?: number; pageSize?: number; search?: string; stage?: HiringStage | ''; status?: HiringStatus;
  position?: string; department?: string; ownerId?: string; assignedToMe?: boolean;
};
export type HiringApplicantInput = {
  fullName: string; email?: string; phone?: string; positionTitle: string; department?: string;
  source?: string; appliedAt?: string; currentOwnerId?: string;
};

type ApiEnvelope<T> = { success: boolean; error?: string; code?: string } & T;

export class HiringApiError extends Error {
  constructor(public status: number, public code?: string, message?: string) {
    super(message || 'Unable to complete the Hiring request.');
  }
}

function authHeaders(user: AuthUser, json = false) {
  const headers: Record<string, string> = {
    'x-employee-id': user.id,
    'x-tenant-id': user.tenantId,
  };
  if (user.authToken) headers.Authorization = `Bearer ${user.authToken}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

function camelize<T>(value: T): T {
  if (Array.isArray(value)) return value.map(camelize) as T;
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
    key.replace(/_([a-z])/g, (_, character: string) => character.toUpperCase()),
    camelize(nested),
  ])) as T;
}

async function request<T>(user: AuthUser, path: string, init: RequestInit = {}) {
  try {
    const response = await fetch(apiUrl(path), {
      ...init,
      headers: { ...authHeaders(user, Boolean(init.body)), ...(init.headers || {}) },
    });
    const body = await response.json().catch(() => ({})) as ApiEnvelope<T>;
    if (!response.ok || !body.success) throw new HiringApiError(response.status, body.code, body.error);
    return camelize(body) as ApiEnvelope<T>;
  } catch (error) {
    if (error instanceof HiringApiError) throw error;
    throw new HiringApiError(0, 'HIRING_NETWORK_ERROR', 'Unable to reach Hiring. Check your connection and try again.');
  }
}

export async function listHiringApplicants(user: AuthUser, filters: HiringApplicantFilters) {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== '' && value !== false) query.set(key, String(value));
  });
  return request<{ applicants: HiringApplicantListItem[]; total: number; page: number; pageSize: number }>(user, `/api/hiring/applicants?${query}`);
}

export const createHiringApplicant = (user: AuthUser, payload: HiringApplicantInput) => request<{ applicant: HiringApplicantListItem; warnings: Array<{ code: string; applicantId: string; message: string }> }>(user, '/api/hiring/applicants', { method: 'POST', body: JSON.stringify(payload) });
export const getHiringApplicant = (user: AuthUser, id: string) => request<{ applicant: Omit<HiringApplicantDetails, 'notes' | 'handoffs' | 'stageHistory'>; notes: HiringApplicantNote[]; handoffs: HiringHandoff[]; stageHistory: HiringStageHistoryEntry[] }>(user, `/api/hiring/applicants/${id}`);
export const updateHiringApplicant = (user: AuthUser, id: string, payload: Partial<HiringApplicantInput>) => request<{ applicant: HiringApplicantListItem }>(user, `/api/hiring/applicants/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
export const addHiringNote = (user: AuthUser, id: string, payload: { noteText: string; noteType: HiringNoteType; visibility: HiringNoteVisibility }) => request<{ note: HiringApplicantNote }>(user, `/api/hiring/applicants/${id}/notes`, { method: 'POST', body: JSON.stringify(payload) });
export const updateHiringNote = (user: AuthUser, noteId: string, noteText: string) => request<{ note: HiringApplicantNote }>(user, `/api/hiring/notes/${noteId}`, { method: 'PATCH', body: JSON.stringify({ noteText }) });
export const changeHiringStage = (user: AuthUser, id: string, payload: { targetStage: HiringStage; reason?: string; expectedCurrentStage: HiringStage }) => request<{ applicant: HiringApplicantListItem }>(user, `/api/hiring/applicants/${id}/stage`, { method: 'POST', body: JSON.stringify(payload) });
export const createHiringHandoff = (user: AuthUser, id: string, payload: { reviewerId: string; targetStage?: HiringStage; message?: string }) => request<{ handoff: HiringHandoff }>(user, `/api/hiring/applicants/${id}/handoff`, { method: 'POST', body: JSON.stringify(payload) });
export const acknowledgeHiringHandoff = (user: AuthUser, id: string) => request<{ handoff: HiringHandoff }>(user, `/api/hiring/handoffs/${id}/acknowledge`, { method: 'POST' });
export const archiveHiringApplicant = (user: AuthUser, id: string) => request<{ applicant: HiringApplicantListItem }>(user, `/api/hiring/applicants/${id}/archive`, { method: 'POST' });
export const listHiringReviewers = (user: AuthUser) => request<{ reviewers: HiringReviewer[] }>(user, '/api/hiring/reviewers');
