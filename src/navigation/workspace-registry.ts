import type { TranslationKey } from '../lib/LanguageContext';

export type DashboardWorkspaceId =
  | 'geofence'
  | 'roster'
  | 'expenses'
  | 'hiring'
  | 'performance'
  | 'organisation'
  | 'locations'
  | 'liveEmployees'
  | 'assets'
  | 'feed'
  | 'payroll'
  | 'grievances'
  | 'resignations'
  | 'audit'
  | 'sessionCenter'
  | 'profile';

export type DashboardTabId = Exclude<DashboardWorkspaceId, 'payroll' | 'grievances'>;
export type WorkspaceGroup = 'workspace' | 'peopleOperations' | 'administration';
export type WorkspaceVisibilityKey =
  | 'hiring'
  | 'performance'
  | 'organisation'
  | 'locations'
  | 'liveEmployees'
  | 'assets'
  | 'payroll'
  | 'audit'
  | 'sessionCenter';
export type WorkspaceAttentionKey =
  | 'breakRequests'
  | 'leaveRequests'
  | 'hiring'
  | 'payroll'
  | 'grievances'
  | 'resignations';
export type WorkspaceIconKey =
  | 'map'
  | 'calendar'
  | 'receipt'
  | 'briefcase'
  | 'chart'
  | 'network'
  | 'mapPin'
  | 'users'
  | 'box'
  | 'newspaper'
  | 'dollar'
  | 'message'
  | 'file'
  | 'audit'
  | 'shield'
  | 'user';

export type WorkspaceDescriptor = {
  id: DashboardWorkspaceId;
  targetTab: DashboardTabId;
  labelKey: TranslationKey;
  group: WorkspaceGroup;
  icon: WorkspaceIconKey;
  visibility?: WorkspaceVisibilityKey;
  attention?: WorkspaceAttentionKey;
  helpArticleId: string;
  tutorialId: string;
  aliases: readonly string[];
  mobileEligible: boolean;
  quickActionEligible: boolean;
};

export const WORKSPACE_REGISTRY: readonly WorkspaceDescriptor[] = [
  { id: 'geofence', targetTab: 'geofence', labelKey: 'dash.geoOp', group: 'workspace', icon: 'map', attention: 'breakRequests', helpArticleId: 'geo-operations', tutorialId: 'geo-operations', aliases: ['attendance', 'clock', 'clock in', 'location', 'geo', 'الحضور', 'الموقع'], mobileEligible: true, quickActionEligible: true },
  { id: 'roster', targetTab: 'roster', labelKey: 'dash.roster', group: 'workspace', icon: 'calendar', attention: 'leaveRequests', helpArticleId: 'weekly-roster', tutorialId: 'roster', aliases: ['schedule', 'shift', 'leave', 'roster', 'جدول', 'مناوبة', 'إجازة'], mobileEligible: true, quickActionEligible: true },
  { id: 'expenses', targetTab: 'expenses', labelKey: 'dash.expenses', group: 'workspace', icon: 'receipt', helpArticleId: 'expenses', tutorialId: 'expenses', aliases: ['claim', 'receipt', 'reimbursement', 'pay', 'مصروفات', 'مطالبة'], mobileEligible: true, quickActionEligible: true },
  { id: 'hiring', targetTab: 'hiring', labelKey: 'hiring.title', group: 'workspace', icon: 'briefcase', visibility: 'hiring', attention: 'hiring', helpArticleId: 'hiring', tutorialId: 'hiring', aliases: ['applicant', 'candidate', 'recruitment', 'توظيف', 'مرشح'], mobileEligible: true, quickActionEligible: true },
  { id: 'performance', targetTab: 'performance', labelKey: 'performance.title', group: 'workspace', icon: 'chart', visibility: 'performance', helpArticleId: 'performance', tutorialId: 'performance', aliases: ['review', 'goals', 'okr', 'recognition', 'أداء', 'أهداف'], mobileEligible: true, quickActionEligible: true },
  { id: 'organisation', targetTab: 'organisation', labelKey: 'organisation.title', group: 'peopleOperations', icon: 'network', visibility: 'organisation', helpArticleId: 'organisation', tutorialId: 'organisation', aliases: ['people', 'department', 'team', 'roles', 'hierarchy', 'موظف', 'قسم', 'فريق'], mobileEligible: true, quickActionEligible: true },
  { id: 'locations', targetTab: 'locations', labelKey: 'dash.locations', group: 'peopleOperations', icon: 'mapPin', visibility: 'locations', helpArticleId: 'locations', tutorialId: 'locations', aliases: ['site', 'office', 'geofence', 'موقع', 'فرع'], mobileEligible: true, quickActionEligible: true },
  { id: 'liveEmployees', targetTab: 'liveEmployees', labelKey: 'liveEmployees.title', group: 'peopleOperations', icon: 'users', visibility: 'liveEmployees', helpArticleId: 'employees', tutorialId: 'employees', aliases: ['employee', 'attendance', 'live', 'موظف', 'حضور'], mobileEligible: true, quickActionEligible: true },
  { id: 'assets', targetTab: 'assets', labelKey: 'assets.title', group: 'peopleOperations', icon: 'box', visibility: 'assets', helpArticleId: 'assets', tutorialId: 'assets', aliases: ['equipment', 'hardware', 'device', 'asset', 'أصول', 'معدات'], mobileEligible: true, quickActionEligible: true },
  { id: 'feed', targetTab: 'feed', labelKey: 'dash.companyFeed', group: 'administration', icon: 'newspaper', helpArticleId: 'company-feed', tutorialId: 'company-feed', aliases: ['news', 'announcement', 'company', 'منشور', 'إعلان'], mobileEligible: true, quickActionEligible: true },
  { id: 'payroll', targetTab: 'profile', labelKey: 'profile.payroll', group: 'administration', icon: 'dollar', visibility: 'payroll', attention: 'payroll', helpArticleId: 'payroll', tutorialId: 'payroll', aliases: ['pay', 'salary', 'compensation', 'رواتب', 'راتب'], mobileEligible: true, quickActionEligible: true },
  { id: 'grievances', targetTab: 'profile', labelKey: 'dash.grievances', group: 'administration', icon: 'message', attention: 'grievances', helpArticleId: 'grievances', tutorialId: 'grievances', aliases: ['complaint', 'case', 'شكوى'], mobileEligible: true, quickActionEligible: true },
  { id: 'resignations', targetTab: 'resignations', labelKey: 'dash.resignations', group: 'administration', icon: 'file', attention: 'resignations', helpArticleId: 'resignations', tutorialId: 'resignations', aliases: ['resign', 'exit', 'استقالة'], mobileEligible: true, quickActionEligible: true },
  { id: 'audit', targetTab: 'audit', labelKey: 'audit.title', group: 'administration', icon: 'audit', visibility: 'audit', helpArticleId: 'audit-trail', tutorialId: 'audit-trail', aliases: ['history', 'security', 'trail', 'تدقيق', 'سجل'], mobileEligible: true, quickActionEligible: true },
  { id: 'sessionCenter', targetTab: 'sessionCenter', labelKey: 'sessions.sessionCenter', group: 'administration', icon: 'shield', visibility: 'sessionCenter', helpArticleId: 'session-center', tutorialId: 'session-center', aliases: ['session', 'device', 'security', 'جلسة', 'جهاز'], mobileEligible: true, quickActionEligible: true },
  { id: 'profile', targetTab: 'profile', labelKey: 'dash.profile', group: 'administration', icon: 'user', helpArticleId: 'profile', tutorialId: 'profile', aliases: ['account', 'digital id', 'badge', 'ملف', 'هوية'], mobileEligible: true, quickActionEligible: true },
];

const workspaceById = new Map<DashboardWorkspaceId, WorkspaceDescriptor>(
  WORKSPACE_REGISTRY.map((workspace) => [workspace.id, workspace]),
);

export function getWorkspaceDescriptor(id: string) {
  return workspaceById.get(id as DashboardWorkspaceId);
}

export function getWorkspaceAliases(id: string) {
  return getWorkspaceDescriptor(id)?.aliases || [];
}

export function isDashboardWorkspaceId(id: string): id is DashboardWorkspaceId {
  return workspaceById.has(id as DashboardWorkspaceId);
}
