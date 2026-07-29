import type { HiringApplicantInput } from '../../api/hiring';
import type { CandidateSuggestionKey } from './CandidateDocumentExtraction';

export type CandidateFieldOrigin = 'untouched' | 'extraction-prefilled' | 'manually-edited';
export type CandidateFieldOrigins = Record<CandidateSuggestionKey, CandidateFieldOrigin>;

export const INITIAL_CANDIDATE_FIELD_ORIGINS: CandidateFieldOrigins = {
  fullName: 'untouched',
  email: 'untouched',
  phone: 'untouched',
};

export function canUseCandidateDocumentExtraction(permissions: readonly string[] | undefined) {
  return Boolean(permissions?.includes('document_extraction.candidate.manage'));
}

export function mergeInitialCandidateSuggestions(
  form: HiringApplicantInput,
  origins: CandidateFieldOrigins,
  suggestions: Partial<Record<CandidateSuggestionKey, string>>,
) {
  const nextForm = { ...form };
  const nextOrigins = { ...origins };
  for (const [field, value] of Object.entries(suggestions) as Array<[CandidateSuggestionKey, string]>) {
    if (!value || origins[field] !== 'untouched') continue;
    nextForm[field] = value;
    nextOrigins[field] = 'extraction-prefilled';
  }
  return { form: nextForm, origins: nextOrigins };
}

export function markCandidateFieldEdited(
  origins: CandidateFieldOrigins,
  field: CandidateSuggestionKey,
): CandidateFieldOrigins {
  return { ...origins, [field]: 'manually-edited' };
}

export function markCandidateSuggestionApplied(
  origins: CandidateFieldOrigins,
  field: CandidateSuggestionKey,
): CandidateFieldOrigins {
  return { ...origins, [field]: 'extraction-prefilled' };
}
