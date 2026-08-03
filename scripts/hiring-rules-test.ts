import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  HIRING_STAGES,
  canTransitionHiringStage,
  isFinalHiringTransition,
  normalizeApplicantEmail,
} from '../src/server/hiring/hiring-rules';
import {
  canUseCandidateDocumentExtraction,
  INITIAL_CANDIDATE_FIELD_ORIGINS,
  markCandidateFieldEdited,
  markCandidateSuggestionApplied,
  mergeInitialCandidateSuggestions,
} from '../src/components/hiring/candidate-prefill-state';

assert.equal(HIRING_STAGES.length, 10);
assert.equal(normalizeApplicantEmail('  Person@Example.COM '), 'person@example.com');
assert.equal(canTransitionHiringStage('new', 'screening'), true);
assert.equal(canTransitionHiringStage('new', 'hired'), false);
assert.equal(canTransitionHiringStage('interview', 'withdrawn'), true);
assert.equal(isFinalHiringTransition('final_review', 'offer'), true);
assert.equal(canTransitionHiringStage('final_review', 'offer'), false);
assert.equal(canTransitionHiringStage('final_review', 'offer', ['hiring.make_final_decision']), true);
assert.equal(canTransitionHiringStage('offer', 'hired', ['hiring.make_final_decision']), true);
assert.equal(canTransitionHiringStage('hired', 'rejected', ['hiring.make_final_decision']), false);

console.log('PASS  Hiring stage rules and email normalization');

const emptyApplicant = {
  fullName: '',
  email: '',
  phone: '',
  positionTitle: 'مهندسة برمجيات',
  department: 'Engineering',
  source: 'Referral',
};
const firstExtraction = mergeInitialCandidateSuggestions(
  emptyApplicant,
  { ...INITIAL_CANDIDATE_FIELD_ORIGINS },
  {
    fullName: 'آمنة عبد الرحمن',
    email: 'amina@example.com',
    phone: '+971 50 123 4567 ext. 8',
  },
);
assert.equal(firstExtraction.form.fullName, 'آمنة عبد الرحمن');
assert.equal(firstExtraction.form.phone, '+971 50 123 4567 ext. 8');
assert.equal(firstExtraction.form.positionTitle, 'مهندسة برمجيات');
assert.equal(firstExtraction.form.source, 'Referral');
assert.deepEqual(Object.values(firstExtraction.origins), [
  'extraction-prefilled',
  'extraction-prefilled',
  'extraction-prefilled',
]);

let manuallyEditedOrigins = markCandidateFieldEdited(firstExtraction.origins, 'email');
manuallyEditedOrigins = markCandidateFieldEdited(manuallyEditedOrigins, 'phone');
const secondExtraction = mergeInitialCandidateSuggestions(
  { ...firstExtraction.form, email: '', phone: '+44 20 7946 0958' },
  manuallyEditedOrigins,
  {
    fullName: 'A different OCR name',
    email: 'replacement@example.com',
    phone: '+20 100 000 0000',
  },
);
assert.equal(secondExtraction.form.fullName, 'آمنة عبد الرحمن');
assert.equal(secondExtraction.form.email, '');
assert.equal(secondExtraction.form.phone, '+44 20 7946 0958');
assert.equal(secondExtraction.form.positionTitle, 'مهندسة برمجيات');
assert.equal(markCandidateSuggestionApplied(secondExtraction.origins, 'email').email, 'extraction-prefilled');
console.log('PASS  Candidate suggestions preserve Unicode, country codes, unrelated fields, and manual edits');

for (const roleCase of [
  { label: 'HR Admin with explicit Hiring authority', permissions: ['hiring.create', 'document_extraction.candidate.manage'], expected: true },
  { label: 'Hiring administrator', permissions: ['hiring.manage', 'document_extraction.candidate.manage'], expected: true },
  { label: 'scoped Hiring manager', permissions: ['hiring.create', 'document_extraction.candidate.manage'], expected: true },
  { label: 'delegated Hiring user', permissions: ['hiring.create', 'document_extraction.candidate.manage'], expected: true },
  { label: 'HR Admin without extraction authority', permissions: ['hiring.create'], expected: false },
  { label: 'Manager without Hiring authority', permissions: [], expected: false },
  { label: 'Employee', permissions: ['hiring.view_self'], expected: false },
  { label: 'unpermissioned user', permissions: undefined, expected: false },
] as const) {
  assert.equal(canUseCandidateDocumentExtraction(roleCase.permissions), roleCase.expected, roleCase.label);
}
console.log('PASS  Candidate extraction visibility follows explicit permission across supported roles');

const panelSource = await readFile('src/components/hiring/HiringPanel.tsx', 'utf8');
const extractionSource = await readFile('src/components/hiring/CandidateDocumentExtraction.tsx', 'utf8');
const languageSource = await readFile('src/lib/LanguageContext.tsx', 'utf8');
assert.equal((panelSource.match(/function ApplicantForm\(/g) || []).length, 1);
assert.match(panelSource, /data-hiring-review-counter/);
assert.match(panelSource, /min-h-9/);
assert.match(panelSource, /tabular-nums/);
assert.match(panelSource, /aria-label=\{`\$\{stageLabel\(stage\)\}: \$\{count\}`\}/);
assert.match(panelSource, /createHiringApplicant\(user, form\)/);
assert.match(panelSource, /canUseCandidateDocumentExtraction\(user\.permissions\)/);
assert.doesNotMatch(panelSource, /role === 'hr_admin'.{0,120}document_extraction/s);
assert.match(extractionSource, /body\.append\('mode', 'candidate_document'\)/);
assert.match(extractionSource, /accept="image\/jpeg,image\/png,image\/webp"/);
assert.doesNotMatch(extractionSource, /accept="[^"]*pdf/i);
assert.match(extractionSource, /onDrop=/);
assert.match(extractionSource, /type="file"/);
assert.match(extractionSource, /type="button"/);
assert.match(extractionSource, /method: 'DELETE'/);
assert.match(extractionSource, /cleanupExtraction\(\)/);
assert.match(extractionSource, /max-h|break-words|min-w-0/);
assert.match(extractionSource, /motion-reduce:animate-none/);
assert.doesNotMatch(extractionSource, /rawOcr|providerPayload|storageKey|temporaryUrl/i);
assert.doesNotMatch(panelSource, /extractionId.{0,120}createHiringApplicant/s);
for (const key of [
  'hiring.extractionTitle',
  'hiring.extractionContinueManual',
  'hiring.confidence.high',
  'hiring.confidence.unavailable',
]) {
  assert.equal((languageSource.match(new RegExp(`'${key.replaceAll('.', '\\.')}'`, 'g')) || []).length, 2);
}
console.log('PASS  Existing applicant form owns private, permission-aware, accessible candidate extraction UI');
