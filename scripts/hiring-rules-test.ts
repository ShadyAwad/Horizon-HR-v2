import assert from 'node:assert/strict';
import {
  HIRING_STAGES,
  canTransitionHiringStage,
  isFinalHiringTransition,
  normalizeApplicantEmail,
} from '../src/server/hiring/hiring-rules';

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
