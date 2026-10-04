import { ADDITIONAL_INTENTS } from './router-intents';
/** Shared allowlist. IDs refer to existing palette commands, never provider URLs/tools. */
export type ActionCategory = 'navigate' | 'display' | 'open_existing_flow';
export type SafetyLevel = 'read_only' | 'requires_confirmation' | 'mutation';
export type Intent = { key: string; commandId: string; actionKey: string; category: ActionCategory; safety: SafetyLevel; description: string; permissions: readonly string[]; aliases: readonly string[]; rule?: RegExp; enabled: boolean };
const intent = (key: string, commandId: string, description: string, permissions: string[], aliases: string[], rule?: RegExp): Intent => ({ key, commandId, actionKey: `OPEN_${key.toUpperCase()}`, category: ['leave:request','expenses:new','router:submit-grievance'].includes(commandId) ? 'open_existing_flow' : 'navigate', safety: 'read_only', description, permissions, aliases, rule, enabled: true });
export const INTENTS: readonly Intent[] = [
  intent('request_leave', 'leave:request', 'Open personal leave request form for user review; never submit.', ['leave.request.self', 'leave.create'], ['request leave', 'apply for leave', 'طلب اجازة', 'عايز اجازة'], /^(?:i (?:want|need|would like) (?:to request |to take )?(?:leave|time off)|(?:عايز|محتاج) (?:اخد )?اجازه)(?:\s.*)?$/u),
  intent('leave_balance', 'roster:leave', 'Open personal leave workspace and balances.', ['leave.view.self', 'leave.create'], ['leave balance', 'pto balance', 'رصيد الاجازات', 'فاضلي كام يوم اجازه']),
  intent('attendance', 'router:attendance', 'Open attendance workspace history controls.', [], ['attendance history', 'my attendance', 'سجل الحضور']),
  intent('clock_in_help', 'attendance:open-clock', 'Open existing clock UI; user must choose and confirm clock action.', ['attendance.clock'], ['clock in', 'clock in help', 'تسجيل الحضور', 'اسجل حضور ازاي']),
  intent('payslips', 'router:payslips', 'Open personal payroll statements.', ['payroll.view_self'], ['payslips', 'show payslip', 'قسيمة الراتب', 'مفردات المرتب']),
  intent('my_assets', 'router:my-assets', 'Open personal assigned equipment in profile.', [], ['my assets', 'my equipment', 'معداتى', 'عهدتي', 'العهدة اللي معايا']),
  intent('goals_tasks', 'router:goals', 'Open personal roster goals and tasks.', ['roster.goals.view_self'], ['my goals', 'my tasks', 'مهامي', 'اهدافي']),
  intent('my_grievances', 'navigation:grievances', 'Open personal grievance workspace.', ['grievances.view_own', 'grievances.create'], ['my grievances', 'submit grievance', 'شكاوي', 'تقديم شكوى']),
  intent('grievance_inbox', 'router:grievance-inbox', 'Open authorized grievance inbox; case access stays scope-controlled.', ['grievances.view', 'grievances.review'], ['grievance inbox', 'case inbox', 'صندوق الشكاوى']),
  intent('submit_expense', 'expenses:new', 'Open expense form for user review; never submit.', ['expenses.submit.self'], ['submit expense', 'expense claim', 'طلب مصروفات']),
  intent('communications', 'navigation:communications', 'Open communications workspace.', ['communications.view'], ['communications', 'my messages', 'رسائلي']),
  intent('meetings', 'router:meetings', 'Open meetings in existing communications workspace.', ['communications.meetings.view'], ['my meetings', 'meetings', 'اجتماعاتي']),
  intent('company_feed', 'navigation:feed', 'Open company feed.', [], ['company feed', 'company news', 'اخبار الشركة']),
  intent('workspace_composer', 'navigation:composer', 'Open Workspace Composer.', [], ['workspace composer', 'composer', 'منشئ مساحة العمل']),
  intent('hiring', 'hiring:applicants', 'Open authorized hiring workspace.', ['hiring.view'], ['hiring', 'applicants', 'التوظيف']),
  ...ADDITIONAL_INTENTS.map(([key,command,description,permissions,aliases])=>intent(key,command,description,[...permissions],aliases.split('|'))),
];
// Existing module commands remain the final authority; aliases never grant permissions.
export const ACTIONS = new Map(INTENTS.map(i => [i.actionKey, { commandId: i.commandId, category: i.category, safety: i.safety }]));
export const getIntent = (key: unknown) => typeof key === 'string' ? INTENTS.find(i => i.key === key && i.enabled && i.safety !== 'mutation' && ACTIONS.has(i.actionKey)) : undefined;
export function normalizeQuery(text: string) {
  return text.normalize('NFKC').toLowerCase().replace(/[\u064b-\u065f\u0670\u0640]/gu, '').replace(/[أإآ]/gu, 'ا').replace(/ى/gu, 'ي').replace(/ة/gu, 'ه').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/gu, ' ').trim();
}
/** Unsupported operational verbs must not become equivalent to read/open intents. */
export const unsafeOperation = (text: string) => /(?:\b(?:cancel|delete|close|modify|change salary|approve|reject|execute|sql|javascript)\b|الغاء|الغي|احذف|اغلاق|اقفل|تعديل الراتب|غير المرتب)/u.test(text);
export type RouteMethod = 'existing' | 'exact' | 'rule' | 'semantic' | 'llm' | 'none';
export type ProviderFailureReason = 'model_unavailable' | 'authorization_rejected' | 'rate_limited' | 'request_rejected' | 'network_error' | 'incomplete_response' | 'catalog_invalid';
export type ProviderDiagnostics = { upstreamCode?:string; errorType?:string; parameter?:string; detail?:string; requestId?:string; eventType?:string; responseStatus?:string; termination?:string; contentType?:string };
export type RouterDataAnswer = {kind:"shift";timeZone:string;start:string|null;end:string|null}|{kind:"profile";field:string;value:string|null}|{kind:"payday";date:null}|{kind:"meetings";timeZone:string;total:number;items:{title:string;start:string;end:string}[]};
export type RouterResult = { outcome: 'matched' | 'ambiguous' | 'no_match' | 'provider_unavailable' | 'unauthorized'; method: RouteMethod; intentKey?: string; actionKey?: string; commandId?: string; choices?: string[]; score?: number; competingScore?: number; margin?: number; fallbackUsed: boolean; semanticStatus?: 'matched'|'ambiguous'|'weak'|'unavailable'; reasoningUnavailable?:boolean; unsupported?:boolean; providerFailure?: { reason: ProviderFailureReason; stage: 'models' | 'responses'; httpStatus?: number; } & ProviderDiagnostics; candidateId?: string; latencyMs?: number; answer?:RouterDataAnswer; embeddingLatencyMs?:number; promotedSemanticHit?:boolean };
