import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getEligibleTutorials, tutorialRegistry } from '../src/components/tutorials/tutorial-registry';
import { readTutorialProgress } from '../src/components/tutorials/tutorial-state';

const employeeContext = { permissions: [], availableModules: ['geofence', 'roster', 'expenses'], isMobile: true };
const employeeTutorials = getEligibleTutorials(employeeContext);

assert.ok(employeeTutorials.some((tutorial) => tutorial.id === 'welcome'));
assert.ok(employeeTutorials.some((tutorial) => tutorial.id === 'roster'));
assert.ok(!employeeTutorials.some((tutorial) => tutorial.id === 'hiring'));
assert.equal(tutorialRegistry.every((tutorial) => tutorial.version > 0 && tutorial.steps.length > 0), true);
const welcome = tutorialRegistry.find((tutorial) => tutorial.id === 'welcome');
assert.equal(welcome?.steps.length, 5);
assert.deepEqual(welcome?.steps.map((step) => step.id), ['welcome', 'launcher', 'command', 'quick-actions', 'settings']);
for (const tutorialId of ['geo-operations', 'roster', 'expenses', 'hiring', 'organisation']) {
  assert.ok((tutorialRegistry.find((tutorial) => tutorial.id === tutorialId)?.steps.length ?? 0) >= 3, `${tutorialId} should provide guided coverage`);
}
assert.equal(tutorialRegistry.every((tutorial) => tutorial.steps.every((step) => !step.target || /^[a-z0-9-]+$/.test(step.target))), true);
assert.equal(new Set(tutorialRegistry.map((tutorial) => tutorial.id)).size, tutorialRegistry.length, 'tutorial IDs must be stable and unique');
assert.equal(tutorialRegistry.every((tutorial) => tutorial.version > 0 && Boolean(tutorial.descriptionKey) && tutorial.replayable), true);

const navigationModuleIds = ['geofence', 'roster', 'expenses', 'hiring', 'performance', 'organisation', 'locations', 'liveEmployees', 'assets', 'feed', 'payroll', 'grievances', 'resignations', 'audit', 'sessionCenter', 'profile'];
const authorisedContext = { permissions: ['break_requests.review', 'roster.manage', 'expenses.approve', 'hiring.create', 'roles.view'], availableModules: navigationModuleIds, isMobile: false };
const authorisedTutorials = getEligibleTutorials(authorisedContext);
for (const moduleId of navigationModuleIds) {
  assert.ok(authorisedTutorials.some((tutorial) => tutorial.module === moduleId), `${moduleId} must have an eligible tutorial when it is navigable`);
}
assert.ok(authorisedTutorials.some((tutorial) => tutorial.id === 'settings'));
assert.ok(!getEligibleTutorials({ permissions: [], availableModules: ['geofence'], isMobile: false }).some((tutorial) => tutorial.id === 'hiring'));
assert.ok(!tutorialRegistry.some((tutorial) => /\b(?:hr_admin|manager|employee)\b/i.test(tutorial.eligible.toString())), 'eligibility must not be based on role names');

const [dashboard, translations, provider, overlay] = await Promise.all([
  readFile('src/pages/Dashboard.tsx', 'utf8'),
  readFile('src/lib/LanguageContext.tsx', 'utf8'),
  readFile('src/components/tutorials/TutorialProvider.tsx', 'utf8'),
  readFile('src/components/tutorials/TutorialOverlay.tsx', 'utf8'),
]);
const registrySource = await readFile('src/components/tutorials/tutorial-registry.ts', 'utf8');
assert.doesNotMatch(registrySource, /\b(?:fetch\(|onClick|set[A-Z]\w+\()/);
assert.match(dashboard, /data-tutorial-target=\{getTutorialModuleTarget\(/);
assert.match(dashboard, /data-tutorial-target="settings-help"/);
assert.match(dashboard, /prepareTutorial=\{prepareTutorial\}/);
assert.match(provider, /prepareTutorial\(tutorial\)/);
assert.match(provider, /document\.querySelector\(`\[data-tutorial-target=/);
assert.match(provider, /stanza-tutorial-action/);
assert.match(registrySource, /advanceOn: \{ type: 'click', target: 'stanza-launcher' \}/);
assert.match(overlay, /aria-modal="true"/);
assert.match(overlay, /event\.key === 'Tab'/);
assert.match(overlay, /stanza-tutorial-highlight/);
assert.match(overlay, /isCompactViewport/);
assert.match(overlay, /safe-area-inset-bottom/);
assert.match(overlay, /pointer-events-none fixed inset-0/);
assert.match(overlay, /calc\(env\(safe-area-inset-bottom\) \+ 5\.5rem\)/);
assert.match(overlay, /window\.removeEventListener\('scroll'/);
for (const tutorial of tutorialRegistry) {
  for (const key of [tutorial.titleKey, tutorial.descriptionKey, ...tutorial.steps.flatMap((step) => [step.titleKey, step.bodyKey])]) {
    assert.equal((translations.match(new RegExp(`'${key}':`, 'g')) || []).length, 2, `${key} must be translated in English and Arabic`);
  }
}
assert.deepEqual(readTutorialProgress({ tutorialsAutoStart: false, completedTutorials: { welcome: 1 } }), {
  tutorialsEnabled: true,
  tutorialsAutoStart: false,
  completedTutorials: { welcome: 1 },
  dismissedTutorials: {},
});
assert.deepEqual(readTutorialProgress({ completedTutorials: { 'bad key': 9 } }).completedTutorials, {});

console.log('Tutorial contracts passed.');
