import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getEligibleTutorials, tutorialRegistry } from '../src/components/tutorials/tutorial-registry';
import { getAutomaticTutorialCandidate, readTutorialProgress } from '../src/components/tutorials/tutorial-state';
import { HELP_ARTICLES, getEligibleHelpArticles, getHelpArticle, searchHelpArticles } from '../src/components/tutorials/help-registry';

const employeeContext = { permissions: [], availableModules: ['geofence', 'roster', 'expenses'], isMobile: true };
const employeeTutorials = getEligibleTutorials(employeeContext);

assert.ok(employeeTutorials.some((tutorial) => tutorial.id === 'welcome'));
assert.ok(employeeTutorials.some((tutorial) => tutorial.id === 'roster'));
assert.ok(!employeeTutorials.some((tutorial) => tutorial.id === 'hiring'));
assert.equal(tutorialRegistry.every((tutorial) => tutorial.version > 0 && tutorial.steps.length > 0), true);
const welcome = tutorialRegistry.find((tutorial) => tutorial.id === 'welcome');
const lanyardTutorial = tutorialRegistry.find((tutorial) => tutorial.id === 'interactive-lanyard');
assert.ok(lanyardTutorial);
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
  const article = HELP_ARTICLES.find((candidate) => candidate.moduleId === moduleId);
  assert.ok(article, `${moduleId} must have a Help article`);
  assert.ok(article?.tutorialId && tutorialRegistry.some((tutorial) => tutorial.id === article.tutorialId), `${moduleId} Help must start a registered tutorial`);
  assert.equal(article?.sections.length, 5, `${moduleId} Help must explain purpose, audience, features, workflow, and notes`);
}
assert.ok(authorisedTutorials.some((tutorial) => tutorial.id === 'settings'));
assert.ok(!getEligibleTutorials({ permissions: [], availableModules: ['geofence'], isMobile: false }).some((tutorial) => tutorial.id === 'hiring'));
assert.ok(!tutorialRegistry.some((tutorial) => /\b(?:hr_admin|manager|employee)\b/i.test(tutorial.eligible.toString())), 'eligibility must not be based on role names');

const capableLanyardContext = { ...authorisedContext, lanyardAvailable: true, lanyardEnabled: true };
const capableTutorials = getEligibleTutorials(capableLanyardContext);
const baseProgress = { tutorialsEnabled: true, tutorialsAutoStart: true, completedTutorials: { welcome: welcome!.version }, dismissedTutorials: {} };
assert.equal(getAutomaticTutorialCandidate(capableTutorials, 'geofence', baseProgress, capableLanyardContext)?.id, 'interactive-lanyard');
assert.equal(getAutomaticTutorialCandidate(capableTutorials, 'geofence', { ...baseProgress, completedTutorials: {}, dismissedTutorials: { welcome: welcome!.version } }, capableLanyardContext)?.id, 'interactive-lanyard');
assert.notEqual(getAutomaticTutorialCandidate(capableTutorials, 'geofence', { ...baseProgress, dismissedTutorials: { 'interactive-lanyard': lanyardTutorial!.version } }, capableLanyardContext)?.id, 'interactive-lanyard');
const disabledLanyardContext = { ...capableLanyardContext, lanyardEnabled: false };
assert.notEqual(getAutomaticTutorialCandidate(getEligibleTutorials(disabledLanyardContext), 'geofence', baseProgress, disabledLanyardContext)?.id, 'interactive-lanyard');
assert.ok(getEligibleTutorials(disabledLanyardContext).some((tutorial) => tutorial.id === 'interactive-lanyard'), 'manual Help replay remains available while disabled');
const mobileLanyardContext = { ...employeeContext, lanyardAvailable: false, lanyardEnabled: true };
assert.ok(!getEligibleTutorials(mobileLanyardContext).some((tutorial) => tutorial.id === 'interactive-lanyard'));

const [dashboard, translations, provider, overlay, helpCenter, helpRegistry, styles, presetSource] = await Promise.all([
  readFile('src/pages/Dashboard.tsx', 'utf8'),
  readFile('src/lib/LanguageContext.tsx', 'utf8'),
  readFile('src/components/tutorials/TutorialProvider.tsx', 'utf8'),
  readFile('src/components/tutorials/TutorialOverlay.tsx', 'utf8'),
  readFile('src/components/tutorials/HelpCenter.tsx', 'utf8'),
  readFile('src/components/tutorials/help-registry.ts', 'utf8'),
  readFile('src/index.css', 'utf8'),
  readFile('src/lib/background-presets.ts', 'utf8'),
]);
const registrySource = await readFile('src/components/tutorials/tutorial-registry.ts', 'utf8');
assert.doesNotMatch(registrySource, /\b(?:fetch\(|onClick|set[A-Z]\w+\()/);
assert.match(dashboard, /data-tutorial-target=\{getTutorialModuleTarget\(/);
assert.match(dashboard, /data-tutorial-target="settings-help"/);
assert.match(dashboard, /prepareTutorial=\{prepareTutorial\}/);
assert.match(dashboard, /\{tutorialsEnabled && performanceIsolation\.tutorials && <TutorialProvider/);
assert.match(provider, /prepareTutorial\(tutorial\)/);
assert.match(provider, /pendingStartTimer/);
assert.match(provider, /pendingStartWasAutomatic/);
assert.match(provider, /if \(automatic && blockedRef\.current\) return/);
assert.match(provider, /if \(!isBlocked\) return/);
assert.match(provider, /if \(!current\?\.automatic\) return current/);
assert.match(provider, /automaticStarted\.current = false/);
assert.match(provider, /useEffect\(\(\) => \(\) => clearPendingStart\(\), \[clearPendingStart\]\)/);
assert.match(provider, /document\.querySelector\(`\[data-tutorial-target=/);
assert.match(provider, /stanza-tutorial-action/);
assert.match(registrySource, /advanceOn: \{ type: 'click', target: 'stanza-launcher' \}/);
assert.match(overlay, /aria-modal="true"/);
assert.match(overlay, /event\.key === 'Tab'/);
assert.match(overlay, /stanza-tutorial-highlight/);
assert.match(overlay, /isCompactViewport/);
assert.match(overlay, /safe-area-inset-bottom/);
assert.match(overlay, /stanza-tutorial-primary stanza-primary-action min-h-11/);
assert.match(overlay, /stanza-tutorial-tertiary/);
assert.match(overlay, /stanza-secondary-action min-h-11/);
assert.match(overlay, /stanza-close-action/);
assert.match(styles, /\.stanza-tutorial-primary \{[\s\S]*background-color: var\(--stanza-control-selected\);[\s\S]*color: var\(--stanza-control-selected-foreground\);/);
assert.match(styles, /\.stanza-tutorial-primary:disabled \{[\s\S]*background-color: var\(--stanza-surface-muted\);[\s\S]*box-shadow: none;/);
assert.match(styles, /\.stanza-tutorial-primary:not\(:disabled\):hover \{[\s\S]*background-color: var\(--stanza-accent-hover\);/);
assert.match(styles, /\.stanza-tutorial-primary:focus-visible \{[\s\S]*var\(--stanza-focus-ring\)/);
assert.match(styles, /\.stanza-primary-action:not\(:disabled\):active/);
assert.doesNotMatch(styles.match(/\.stanza-tutorial-primary \{[\s\S]*?\}/)?.[0] || '', /transition:\s*all/);
assert.match(styles, /\[class\*="bg-emerald"\][\s\S]*:not\(\.stanza-tutorial-primary\)/);
for (const preset of ['emerald', 'slate', 'midnight', 'graphite', 'warm_sand', 'amethyst', 'ember']) assert.match(presetSource, new RegExp(`id: '${preset}'`));
assert.match(overlay, /pointer-events-none fixed inset-0/);
assert.match(overlay, /calc\(env\(safe-area-inset-bottom\) \+ 5\.5rem\)/);
assert.match(overlay, /window\.removeEventListener\('scroll'/);
assert.match(overlay, /step\.helpAction/);
assert.match(overlay, /onHelpAction\(step\.helpAction!\.action\)/);
assert.doesNotMatch(overlay, /dangerouslySetInnerHTML/);
assert.match(provider, /action\.type === 'start-tutorial'/);
assert.match(provider, /action\.type === 'open-settings'/);
assert.match(dashboard, /handleTutorialHelpAction/);
assert.match(dashboard, /setPersonalizationOpenSignal/);
assert.match(dashboard, /data-settings-highlight=\{lanyardHighlightSignal/);
assert.match(dashboard, /data-tutorial-target="settings-lanyard"/);
assert.match(dashboard, /lanyardToggleRef\.current\?\.focus/);
assert.match(dashboard, /aria-describedby=\{lanyardHighlightSignal/);
assert.match(dashboard, /openSignal=\{personalizationOpenSignal\}/);
assert.match(dashboard, /action\.type === 'open-article'/);
assert.match(dashboard, /setShowControlCenter\(true\)/);
assert.match(helpCenter, /data-help-article-body=\{selected\.id\}/);
assert.match(helpCenter, /completedTutorials\[tutorial\.id\] === tutorial\.version/);
assert.match(helpCenter, /completed \? t\('help\.replayTour'\) : t\('help\.startTour'\)/);
assert.match(helpCenter, /onStartTutorial\(tutorial\.id\)/);
assert.match(helpCenter, /onOpenModule\(selected\.moduleId!/);
assert.doesNotMatch(helpCenter, /(?:IntersectionObserver|ResizeObserver|MutationObserver|setInterval|setTimeout)/);
assert.doesNotMatch(helpRegistry, /(?:fetch\(|import\(|dangerouslySetInnerHTML|IntersectionObserver|ResizeObserver|requestAnimationFrame)/);
assert.equal((helpCenter.match(/data-help-article-body/g) || []).length, 1, 'only the selected Help body may have a mount point');
assert.ok((tutorialRegistry.find((tutorial) => tutorial.id === 'settings')?.steps.length ?? 0) >= 8);
assert.ok((tutorialRegistry.find((tutorial) => tutorial.id === 'roster')?.steps.length ?? 0) >= 8);
for (const tutorial of tutorialRegistry.filter((candidate) => navigationModuleIds.includes(candidate.module))) {
  assert.ok(tutorial.steps.length >= 3 && tutorial.steps.length <= 12, `${tutorial.id} must have useful, bounded depth`);
}
for (const step of tutorialRegistry.flatMap((tutorial) => tutorial.steps)) {
  if (!step.helpAction) continue;
  assert.ok(['open-article', 'start-tutorial', 'open-module', 'open-settings'].includes(step.helpAction.action.type));
  if (step.helpAction.action.type === 'open-article') assert.ok(getHelpArticle(step.helpAction.action.articleId));
}
for (const tutorial of tutorialRegistry) {
  for (const key of [tutorial.titleKey, tutorial.descriptionKey, ...tutorial.steps.flatMap((step) => [step.titleKey, step.bodyKey, ...(step.primaryLabelKey ? [step.primaryLabelKey] : []), ...(step.helpAction ? [step.helpAction.labelKey] : [])])]) {
    assert.equal((translations.match(new RegExp(`'${key}':`, 'g')) || []).length, 2, `${key} must be translated in English and Arabic`);
  }
}
assert.equal(new Set(HELP_ARTICLES.map((article) => article.id)).size, HELP_ARTICLES.length);
assert.equal(HELP_ARTICLES.every((article) => article.title.en && article.title.ar && article.summary.en && article.summary.ar), true);
assert.ok(searchHelpArticles(HELP_ARTICLES, 'geofence', 'en').some((article) => article.id === 'geo-operations'));
assert.ok(searchHelpArticles(HELP_ARTICLES, '\u0627\u0644\u062c\u062f\u0648\u0644', 'ar').some((article) => article.id === 'weekly-roster'));
assert.deepEqual(getEligibleHelpArticles({ availableModules: ['geofence'] }).filter((article) => article.moduleId).map((article) => article.moduleId), ['geofence']);
assert.ok(!getEligibleHelpArticles({ availableModules: ['geofence'] }).some((article) => article.moduleId === 'hiring'));
const lanyardArticle = getHelpArticle('interactive-lanyard-performance');
assert.equal(lanyardArticle?.tutorialId, 'interactive-lanyard');
assert.equal(lanyardArticle?.action?.value.type, 'open-settings');
assert.ok(getEligibleHelpArticles(capableLanyardContext).some((article) => article.id === 'interactive-lanyard-performance'));
assert.ok(!getEligibleHelpArticles(mobileLanyardContext).some((article) => article.id === 'interactive-lanyard-performance'));
assert.match(helpCenter, /onHelpAction\(selected\.action!\.value\)/);
assert.match(translations, /'tutorial\.lanyard\.body': 'The interactive badge adds a 3D effect/);
assert.match(translations, /'tutorial\.lanyard\.body': 'تضيف بطاقة التعريف التفاعلية/);
assert.deepEqual(readTutorialProgress({ tutorialsAutoStart: false, completedTutorials: { welcome: 1 } }), {
  tutorialsEnabled: true,
  tutorialsAutoStart: false,
  completedTutorials: { welcome: 1 },
  dismissedTutorials: {},
});
assert.deepEqual(readTutorialProgress({ completedTutorials: { 'bad key': 9 } }).completedTutorials, {});

console.log('Tutorial contracts passed.');
