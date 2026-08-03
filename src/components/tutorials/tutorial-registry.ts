import type { TutorialContext, TutorialDefinition } from './tutorial-types';

const hasModule = (context: TutorialContext, module: string) => context.availableModules.includes(module);
const hasPermission = (context: TutorialContext, permission: string) => context.permissions.includes(permission);

export const tutorialRegistry: readonly TutorialDefinition[] = [
  {
    id: 'welcome', version: 1, module: 'dashboard', titleKey: 'tutorial.welcome.title', automatic: true, replayable: true,
    eligible: () => true,
    steps: [
      { id: 'welcome', placement: 'center', titleKey: 'tutorial.welcome.step.welcome.title', bodyKey: 'tutorial.welcome.step.welcome.body' },
      { id: 'launcher', target: 'stanza-launcher', placement: 'end', titleKey: 'tutorial.welcome.step.launcher.title', bodyKey: 'tutorial.welcome.step.launcher.body' },
      { id: 'command', target: 'command-palette-trigger', placement: 'bottom', titleKey: 'tutorial.welcome.step.command.title', bodyKey: 'tutorial.welcome.step.command.body', when: (context) => !context.isMobile },
      { id: 'quick-actions', target: 'quick-actions', placement: 'bottom', titleKey: 'tutorial.welcome.step.quickActions.title', bodyKey: 'tutorial.welcome.step.quickActions.body' },
      { id: 'settings', target: 'settings-button', placement: 'top', titleKey: 'tutorial.welcome.step.settings.title', bodyKey: 'tutorial.welcome.step.settings.body' },
    ],
  },
  {
    id: 'geo-operations', version: 1, module: 'geofence', titleKey: 'tutorial.geo.title', automatic: true, replayable: true,
    eligible: (context) => hasModule(context, 'geofence'),
    steps: [
      { id: 'clock', target: 'geo-clock', placement: 'bottom', titleKey: 'tutorial.geo.step.clock.title', bodyKey: 'tutorial.geo.step.clock.body' },
      { id: 'breaks', target: 'geo-breaks', placement: 'top', titleKey: 'tutorial.geo.step.breaks.title', bodyKey: 'tutorial.geo.step.breaks.body' },
      { id: 'approvals', target: 'geo-break-approvals', placement: 'top', titleKey: 'tutorial.geo.step.approvals.title', bodyKey: 'tutorial.geo.step.approvals.body', when: (context) => hasPermission(context, 'break_requests.review') },
    ],
  },
  {
    id: 'roster', version: 1, module: 'roster', titleKey: 'tutorial.roster.title', automatic: true, replayable: true,
    eligible: (context) => hasModule(context, 'roster'),
    steps: [
      { id: 'tabs', target: 'roster-tabs', placement: 'bottom', titleKey: 'tutorial.roster.step.tabs.title', bodyKey: 'tutorial.roster.step.tabs.body' },
      { id: 'employee', target: 'roster-employee-selector', placement: 'bottom', titleKey: 'tutorial.roster.step.employee.title', bodyKey: 'tutorial.roster.step.employee.body', when: (context) => hasPermission(context, 'roster.manage_scoped') || hasPermission(context, 'roster.manage') },
      { id: 'mobile-view', target: 'roster-presentation-selector', placement: 'top', titleKey: 'tutorial.roster.step.mobileView.title', bodyKey: 'tutorial.roster.step.mobileView.body', when: (context) => context.isMobile },
    ],
  },
  {
    id: 'expenses', version: 1, module: 'expenses', titleKey: 'tutorial.expenses.title', automatic: true, replayable: true,
    eligible: (context) => hasModule(context, 'expenses'),
    steps: [
      { id: 'claims', target: 'expenses-workspace', placement: 'bottom', titleKey: 'tutorial.expenses.step.claims.title', bodyKey: 'tutorial.expenses.step.claims.body' },
      { id: 'ocr', target: 'expense-ocr', placement: 'top', titleKey: 'tutorial.expenses.step.ocr.title', bodyKey: 'tutorial.expenses.step.ocr.body' },
      { id: 'approvals', target: 'expense-approvals', placement: 'top', titleKey: 'tutorial.expenses.step.approvals.title', bodyKey: 'tutorial.expenses.step.approvals.body', when: (context) => hasPermission(context, 'expenses.review') || hasPermission(context, 'expenses.approve') },
    ],
  },
  {
    id: 'hiring', version: 1, module: 'hiring', titleKey: 'tutorial.hiring.title', automatic: true, replayable: true,
    eligible: (context) => hasModule(context, 'hiring'),
    steps: [
      { id: 'workspace', target: 'hiring-workspace', placement: 'bottom', titleKey: 'tutorial.hiring.step.workspace.title', bodyKey: 'tutorial.hiring.step.workspace.body' },
      { id: 'counters', target: 'hiring-review-counters', placement: 'bottom', titleKey: 'tutorial.hiring.step.counters.title', bodyKey: 'tutorial.hiring.step.counters.body' },
      { id: 'add', target: 'hiring-add-applicant', placement: 'bottom', titleKey: 'tutorial.hiring.step.add.title', bodyKey: 'tutorial.hiring.step.add.body', when: (context) => hasPermission(context, 'hiring.create') },
    ],
  },
  {
    id: 'organisation', version: 1, module: 'organisation', titleKey: 'tutorial.organisation.title', automatic: true, replayable: true,
    eligible: (context) => hasModule(context, 'organisation'),
    steps: [
      { id: 'workspace', target: 'organisation-workspace', placement: 'bottom', titleKey: 'tutorial.organisation.step.workspace.title', bodyKey: 'tutorial.organisation.step.workspace.body' },
      { id: 'roles', target: 'organisation-roles', placement: 'bottom', titleKey: 'tutorial.organisation.step.roles.title', bodyKey: 'tutorial.organisation.step.roles.body', when: (context) => hasPermission(context, 'roles.view') },
    ],
  },
];

export function getEligibleTutorials(context: TutorialContext) {
  return tutorialRegistry.filter((tutorial) => tutorial.eligible(context));
}
