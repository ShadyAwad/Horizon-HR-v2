import type { TutorialContext, TutorialDefinition } from './tutorial-types';

const hasModule = (context: TutorialContext, module: string) => context.availableModules.includes(module);
const hasPermission = (context: TutorialContext, permission: string) => context.permissions.includes(permission);
export const getTutorialModuleTarget = (module: string) => `module-${module.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`)}`;

type ModuleTutorialConfig = Pick<TutorialDefinition, 'id' | 'module' | 'titleKey' | 'descriptionKey'>;

const moduleTutorial = ({ id, module, titleKey, descriptionKey }: ModuleTutorialConfig): TutorialDefinition => ({
  id,
  version: 1,
  module,
  titleKey,
  descriptionKey,
  automatic: true,
  replayable: true,
  eligible: (context) => hasModule(context, module),
  steps: [
    { id: 'overview', target: getTutorialModuleTarget(module), placement: 'bottom', titleKey: 'tutorial.shared.overview.title', bodyKey: 'tutorial.shared.overview.body' },
    { id: 'controls', target: getTutorialModuleTarget(module), placement: 'bottom', titleKey: 'tutorial.shared.controls.title', bodyKey: 'tutorial.shared.controls.body' },
    { id: 'safe-guide', target: getTutorialModuleTarget(module), placement: 'top', titleKey: 'tutorial.shared.safeGuide.title', bodyKey: 'tutorial.shared.safeGuide.body' },
  ],
});

export const tutorialRegistry: readonly TutorialDefinition[] = [
  {
    id: 'welcome', version: 3, module: 'dashboard', titleKey: 'tutorial.welcome.title', descriptionKey: 'tutorial.welcome.description', automatic: true, replayable: true,
    eligible: () => true,
    steps: [
      { id: 'welcome', placement: 'center', titleKey: 'tutorial.welcome.step.welcome.title', bodyKey: 'tutorial.welcome.step.welcome.body' },
      { id: 'launcher', target: 'stanza-launcher', placement: 'end', titleKey: 'tutorial.welcome.step.launcher.title', bodyKey: 'tutorial.welcome.step.launcher.body', advanceOn: { type: 'click', target: 'stanza-launcher' } },
      { id: 'command', target: 'command-palette-trigger', placement: 'bottom', titleKey: 'tutorial.welcome.step.command.title', bodyKey: 'tutorial.welcome.step.command.body', when: (context) => !context.isMobile, advanceOn: { type: 'click', target: 'command-palette-trigger' } },
      { id: 'quick-actions', target: 'quick-actions', placement: 'bottom', titleKey: 'tutorial.welcome.step.quickActions.title', bodyKey: 'tutorial.welcome.step.quickActions.body' },
      { id: 'settings', target: 'settings-button', placement: 'top', titleKey: 'tutorial.welcome.step.settings.title', bodyKey: 'tutorial.welcome.step.settings.body', advanceOn: { type: 'click', target: 'settings-button' } },
    ],
  },
  {
    id: 'geo-operations', version: 1, module: 'geofence', titleKey: 'tutorial.geo.title', descriptionKey: 'tutorial.geo.description', automatic: true, replayable: true,
    eligible: (context) => hasModule(context, 'geofence'),
    steps: [
      { id: 'perimeter', target: 'geo-clock', placement: 'bottom', titleKey: 'tutorial.geo.step.perimeter.title', bodyKey: 'tutorial.geo.step.perimeter.body' },
      { id: 'clock', target: 'geo-clock', placement: 'bottom', titleKey: 'tutorial.geo.step.clock.title', bodyKey: 'tutorial.geo.step.clock.body' },
      { id: 'readiness', target: 'geo-clock', placement: 'top', titleKey: 'tutorial.geo.step.readiness.title', bodyKey: 'tutorial.geo.step.readiness.body' },
      { id: 'breaks', target: 'geo-breaks', placement: 'top', titleKey: 'tutorial.geo.step.breaks.title', bodyKey: 'tutorial.geo.step.breaks.body' },
      { id: 'break-status', target: 'geo-breaks', placement: 'top', titleKey: 'tutorial.geo.step.breakStatus.title', bodyKey: 'tutorial.geo.step.breakStatus.body' },
      { id: 'approvals', target: 'geo-break-approvals', placement: 'top', titleKey: 'tutorial.geo.step.approvals.title', bodyKey: 'tutorial.geo.step.approvals.body', when: (context) => hasPermission(context, 'break_requests.review') },
    ],
  },
  {
    id: 'roster', version: 1, module: 'roster', titleKey: 'tutorial.roster.title', descriptionKey: 'tutorial.roster.description', automatic: true, replayable: true,
    eligible: (context) => hasModule(context, 'roster'),
    steps: [
      { id: 'week-navigation', target: 'roster-tabs', placement: 'bottom', titleKey: 'tutorial.roster.step.weekNavigation.title', bodyKey: 'tutorial.roster.step.weekNavigation.body' },
      { id: 'tabs', target: 'roster-tabs', placement: 'bottom', titleKey: 'tutorial.roster.step.tabs.title', bodyKey: 'tutorial.roster.step.tabs.body' },
      { id: 'employee', target: 'roster-employee-selector', placement: 'bottom', titleKey: 'tutorial.roster.step.employee.title', bodyKey: 'tutorial.roster.step.employee.body', when: (context) => hasPermission(context, 'roster.manage_scoped') || hasPermission(context, 'roster.manage') },
      { id: 'swaps', target: 'roster-tabs', placement: 'bottom', titleKey: 'tutorial.roster.step.swaps.title', bodyKey: 'tutorial.roster.step.swaps.body' },
      { id: 'approvals', target: 'roster-tabs', placement: 'bottom', titleKey: 'tutorial.roster.step.approvals.title', bodyKey: 'tutorial.roster.step.approvals.body', when: (context) => hasPermission(context, 'shift_swaps.approve') || hasPermission(context, 'roster.manage') },
      { id: 'leave', target: 'roster-tabs', placement: 'bottom', titleKey: 'tutorial.roster.step.leave.title', bodyKey: 'tutorial.roster.step.leave.body' },
      { id: 'mobile-view', target: 'roster-presentation-selector', placement: 'top', titleKey: 'tutorial.roster.step.mobileView.title', bodyKey: 'tutorial.roster.step.mobileView.body', when: (context) => context.isMobile },
    ],
  },
  {
    id: 'expenses', version: 1, module: 'expenses', titleKey: 'tutorial.expenses.title', descriptionKey: 'tutorial.expenses.description', automatic: true, replayable: true,
    eligible: (context) => hasModule(context, 'expenses'),
    steps: [
      { id: 'claims', target: 'expenses-workspace', placement: 'bottom', titleKey: 'tutorial.expenses.step.claims.title', bodyKey: 'tutorial.expenses.step.claims.body' },
      { id: 'new-claim', target: 'expenses-workspace', placement: 'bottom', titleKey: 'tutorial.expenses.step.newClaim.title', bodyKey: 'tutorial.expenses.step.newClaim.body' },
      { id: 'ocr', target: 'expense-ocr', placement: 'top', titleKey: 'tutorial.expenses.step.ocr.title', bodyKey: 'tutorial.expenses.step.ocr.body' },
      { id: 'approvals', target: 'expense-approvals', placement: 'top', titleKey: 'tutorial.expenses.step.approvals.title', bodyKey: 'tutorial.expenses.step.approvals.body', when: (context) => hasPermission(context, 'expenses.review') || hasPermission(context, 'expenses.approve') },
    ],
  },
  {
    id: 'hiring', version: 1, module: 'hiring', titleKey: 'tutorial.hiring.title', descriptionKey: 'tutorial.hiring.description', automatic: true, replayable: true,
    eligible: (context) => hasModule(context, 'hiring'),
    steps: [
      { id: 'workspace', target: 'hiring-workspace', placement: 'bottom', titleKey: 'tutorial.hiring.step.workspace.title', bodyKey: 'tutorial.hiring.step.workspace.body' },
      { id: 'filters', target: 'hiring-workspace', placement: 'bottom', titleKey: 'tutorial.hiring.step.filters.title', bodyKey: 'tutorial.hiring.step.filters.body' },
      { id: 'counters', target: 'hiring-review-counters', placement: 'bottom', titleKey: 'tutorial.hiring.step.counters.title', bodyKey: 'tutorial.hiring.step.counters.body' },
      { id: 'add', target: 'hiring-add-applicant', placement: 'bottom', titleKey: 'tutorial.hiring.step.add.title', bodyKey: 'tutorial.hiring.step.add.body', when: (context) => hasPermission(context, 'hiring.create') },
      { id: 'review', target: 'hiring-workspace', placement: 'bottom', titleKey: 'tutorial.hiring.step.review.title', bodyKey: 'tutorial.hiring.step.review.body' },
    ],
  },
  {
    id: 'organisation', version: 1, module: 'organisation', titleKey: 'tutorial.organisation.title', descriptionKey: 'tutorial.organisation.description', automatic: true, replayable: true,
    eligible: (context) => hasModule(context, 'organisation'),
    steps: [
      { id: 'workspace', target: 'organisation-workspace', placement: 'bottom', titleKey: 'tutorial.organisation.step.workspace.title', bodyKey: 'tutorial.organisation.step.workspace.body' },
      { id: 'people', target: 'organisation-workspace', placement: 'bottom', titleKey: 'tutorial.organisation.step.people.title', bodyKey: 'tutorial.organisation.step.people.body' },
      { id: 'structure', target: 'organisation-workspace', placement: 'bottom', titleKey: 'tutorial.organisation.step.structure.title', bodyKey: 'tutorial.organisation.step.structure.body' },
      { id: 'departments', target: 'organisation-workspace', placement: 'bottom', titleKey: 'tutorial.organisation.step.departments.title', bodyKey: 'tutorial.organisation.step.departments.body' },
      { id: 'teams', target: 'organisation-workspace', placement: 'bottom', titleKey: 'tutorial.organisation.step.teams.title', bodyKey: 'tutorial.organisation.step.teams.body' },
      { id: 'titles', target: 'organisation-workspace', placement: 'bottom', titleKey: 'tutorial.organisation.step.titles.title', bodyKey: 'tutorial.organisation.step.titles.body' },
      { id: 'roles', target: 'organisation-roles', placement: 'bottom', titleKey: 'tutorial.organisation.step.roles.title', bodyKey: 'tutorial.organisation.step.roles.body', when: (context) => hasPermission(context, 'roles.view') },
      { id: 'delegations', target: 'organisation-workspace', placement: 'bottom', titleKey: 'tutorial.organisation.step.delegations.title', bodyKey: 'tutorial.organisation.step.delegations.body', when: (context) => hasPermission(context, 'delegations.manage') },
    ],
  },
  moduleTutorial({ id: 'locations', module: 'locations', titleKey: 'tutorial.locations.title', descriptionKey: 'tutorial.locations.description' }),
  moduleTutorial({ id: 'employees', module: 'liveEmployees', titleKey: 'tutorial.employees.title', descriptionKey: 'tutorial.employees.description' }),
  moduleTutorial({ id: 'company-feed', module: 'feed', titleKey: 'tutorial.feed.title', descriptionKey: 'tutorial.feed.description' }),
  moduleTutorial({ id: 'payroll', module: 'payroll', titleKey: 'tutorial.payroll.title', descriptionKey: 'tutorial.payroll.description' }),
  moduleTutorial({ id: 'grievances', module: 'grievances', titleKey: 'tutorial.grievances.title', descriptionKey: 'tutorial.grievances.description' }),
  moduleTutorial({ id: 'resignations', module: 'resignations', titleKey: 'tutorial.resignations.title', descriptionKey: 'tutorial.resignations.description' }),
  moduleTutorial({ id: 'assets', module: 'assets', titleKey: 'tutorial.assets.title', descriptionKey: 'tutorial.assets.description' }),
  moduleTutorial({ id: 'performance', module: 'performance', titleKey: 'tutorial.performance.title', descriptionKey: 'tutorial.performance.description' }),
  moduleTutorial({ id: 'audit-trail', module: 'audit', titleKey: 'tutorial.audit.title', descriptionKey: 'tutorial.audit.description' }),
  moduleTutorial({ id: 'session-center', module: 'sessionCenter', titleKey: 'tutorial.sessions.title', descriptionKey: 'tutorial.sessions.description' }),
  moduleTutorial({ id: 'profile', module: 'profile', titleKey: 'tutorial.profile.title', descriptionKey: 'tutorial.profile.description' }),
  {
    ...moduleTutorial({ id: 'settings', module: 'settings', titleKey: 'tutorial.settings.title', descriptionKey: 'tutorial.settings.description' }),
    automatic: false,
    eligible: () => true,
    steps: [
      { id: 'settings-overview', target: 'settings-help', placement: 'bottom', titleKey: 'tutorial.settings.step.overview.title', bodyKey: 'tutorial.settings.step.overview.body' },
      { id: 'settings-help', target: 'settings-help', placement: 'top', titleKey: 'tutorial.settings.step.help.title', bodyKey: 'tutorial.settings.step.help.body' },
    ],
  },
];

export function getEligibleTutorials(context: TutorialContext) {
  return tutorialRegistry.filter((tutorial) => tutorial.eligible(context));
}
