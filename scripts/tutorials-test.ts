import assert from 'node:assert/strict';
import { getEligibleTutorials, tutorialRegistry } from '../src/components/tutorials/tutorial-registry';
import { readTutorialProgress } from '../src/components/tutorials/tutorial-state';

const employeeContext = { permissions: [], availableModules: ['geofence', 'roster', 'expenses'], isMobile: true };
const employeeTutorials = getEligibleTutorials(employeeContext);

assert.ok(employeeTutorials.some((tutorial) => tutorial.id === 'welcome'));
assert.ok(employeeTutorials.some((tutorial) => tutorial.id === 'roster'));
assert.ok(!employeeTutorials.some((tutorial) => tutorial.id === 'hiring'));
assert.equal(tutorialRegistry.every((tutorial) => tutorial.version > 0 && tutorial.steps.length > 0), true);
assert.equal(tutorialRegistry.every((tutorial) => tutorial.steps.every((step) => !step.target || /^[a-z0-9-]+$/.test(step.target))), true);
assert.deepEqual(readTutorialProgress({ tutorialsAutoStart: false, completedTutorials: { welcome: 1 } }), {
  tutorialsEnabled: true,
  tutorialsAutoStart: false,
  completedTutorials: { welcome: 1 },
  dismissedTutorials: {},
});
assert.deepEqual(readTutorialProgress({ completedTutorials: { 'bad key': 9 } }).completedTutorials, {});

console.log('Tutorial contracts passed.');
