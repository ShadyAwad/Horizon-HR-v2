import type { AuthUser } from '../../auth/auth-contract';
import type { DashboardWorkspaceId } from '../../navigation/workspace-registry';
export type WidgetId = 'equipment' | 'inventory' | 'support' | 'communications' | 'meetings' | 'attendance' | 'breaks' | 'leave' | 'expenses' | 'goals' | 'grievances' | 'hiring' | 'openRoles' | 'hiringInterviews' | 'pendingOffers' | 'newHires' | 'onboardingRisk' | 'equipmentPending' | 'accessPending' | 'firstDayReadiness' | 'feed';
export type WidgetConfig = { compact?: boolean; limit?: number };
export type WidgetDefinition = { id: WidgetId; title: string; titleAr: string; description: string; group: string; module: DashboardWorkspaceId; additionalModules?: readonly DashboardWorkspaceId[]; permissions: readonly string[]; minWidth: number; minHeight: number; defaultWidth: number; defaultHeight: number };
const define = (id: WidgetId, title: string, titleAr: string, group: string, module: DashboardWorkspaceId, permissions: string[], description: string): WidgetDefinition => ({ id,title,titleAr,group,module,permissions,description,minWidth:4,minHeight:4,defaultWidth:6,defaultHeight:5 });
export const WIDGETS: readonly WidgetDefinition[] = [
 define('equipment','My Equipment','عهدتي','Support','profile',[],'Assigned equipment and same-company support requests.'),
 define('inventory','Asset Inventory','مخزون الأصول','Support','assets',['assets.view'],'Inventory within your authorized asset scope.'),
 define('support','My Support Requests','طلبات الدعم الخاصة بي','Support','support',[],'Track your own IT and equipment requests.'),
 define('communications','Recent Communications','أحدث المراسلات','Communications','communications',['communications.view','communications.send'],'Recent messages you sent. Open Communications for details.'),
 define('meetings','Upcoming Meetings','الاجتماعات القادمة','Communications','communications',['communications.meetings.view','communications.meetings.manage'],'Upcoming meetings within your authorized scope.'),
 define('attendance','Attendance Status','حالة الحضور','Attendance','geofence',['attendance.clock'],'Your current shift. Open Geo Operations to clock in or pause.'),
 define('breaks','Break Queue','قائمة الاستراحات','Attendance','geofence',['break_requests.view_all','break_requests.review'],'Recent requests and active breaks within your authorized scope.'),
 define('leave','Leave Approvals','اعتماد الإجازات','Leave','roster',['leave.approve','leave.manage','leave.view.scoped'],'Pending requests you are authorized to review.'),
 define('expenses','Expense Approvals','اعتماد المصروفات','Finance','expenses',['expenses.approve','expenses.manage','expenses.view.scoped','expenses.reimburse'],'Pending expense claims within your authorized scope.'),
 {...define('goals','Goals / Tasks','الأهداف والمهام','Performance','roster',['roster.goals.view_self','roster.goals.view_scoped','roster.goals.manage'],'Your goals for this week and overdue tasks.'),additionalModules:['performance']},
 define('grievances','Grievance Inbox','صندوق الشكاوى','Grievances','grievances',['grievances.view','grievances.review'],'Recent cases. Open the canonical inbox to review securely.'),
 define('hiring','Hiring Pipeline Summary','ملخص التوظيف','Hiring','hiring',['hiring.view'],'Recent active applicants and their current stages.'),
 define('openRoles','Open Roles','الوظائف المفتوحة','Hiring','hiring',['hiring.view'],'Published company job openings.'),
 define('hiringInterviews','Upcoming Interviews','المقابلات القادمة','Hiring','hiring',['hiring.view'],'Upcoming hiring interviews.'),
 define('pendingOffers','Offers Pending','العروض المعلقة','Hiring','hiring',['hiring.manage_offers'],'Offers awaiting a recorded response.'),
 define('newHires','New Hires This Week','التعيينات هذا الأسبوع','Hiring','hiring',['hiring.onboarding.view'],'Authoritative onboarding checklist snapshot.'),
 define('onboardingRisk','Onboarding At Risk','تهيئة تحتاج متابعة','Hiring','hiring',['hiring.onboarding.view'],'Authoritative onboarding checklist snapshot.'),
 define('equipmentPending','Equipment Pending','عهدة معلقة','Hiring','hiring',['hiring.onboarding.view'],'Authoritative onboarding checklist snapshot.'),
 define('accessPending','Accounts / Access Pending','حسابات وصلاحيات معلقة','Hiring','hiring',['hiring.onboarding.view'],'Authoritative onboarding checklist snapshot.'),
 define('firstDayReadiness','First-Day Readiness','استعداد اليوم الأول','Hiring','hiring',['hiring.onboarding.view'],'Authoritative onboarding checklist snapshot.'),
 define('feed','Company Feed','أخبار الشركة','Communications','feed',[],'Recent company announcements visible to you.'),
];
export function widgetDefinition(id: string) { return WIDGETS.find(w=>w.id===id); }
export function canUseWidget(user: AuthUser, widget: WidgetDefinition) {
 return widget.permissions.length===0 || (user.permissions ? widget.permissions.some(p=>user.permissions!.includes(p)) : user.role==='hr_admin');
}
export function widgetPath(id: WidgetId, now = new Date()) {
 const monday=new Date(now);monday.setDate(monday.getDate()-((monday.getDay()+6)%7));
 const date=`${monday.getFullYear()}-${String(monday.getMonth()+1).padStart(2,'0')}-${String(monday.getDate()).padStart(2,'0')}`;
 const paths: Record<WidgetId,string>={equipment:'/api/me/assets',inventory:'/api/hr/assets',support:'/api/support',communications:'/api/communications/messages',meetings:'/api/communications/meetings?upcoming=true',attendance:'/api/clock-status',breaks:'/api/attendance/breaks?team=true',leave:'/api/hr/leave-requests?status=pending&pageSize=5',expenses:'/api/finance/expense-claims?status=pending&pageSize=5',goals:`/api/roster/goals?weekStart=${date}`,grievances:'/api/grievances',hiring:'/api/hiring/applicants?status=active&pageSize=5',openRoles:'/api/hiring/summary',hiringInterviews:'/api/hiring/summary',pendingOffers:'/api/hiring/summary',newHires:'/api/hiring/onboarding/summary',onboardingRisk:'/api/hiring/onboarding/summary',equipmentPending:'/api/hiring/onboarding/summary',accessPending:'/api/hiring/onboarding/summary',firstDayReadiness:'/api/hiring/onboarding/summary',feed:'/api/company-feed'};
 return paths[id];
}
