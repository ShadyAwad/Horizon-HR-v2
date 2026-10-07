import type { AuthUser } from '../../auth/auth-contract';
import type { DashboardWorkspaceId } from '../../navigation/workspace-registry';
export type WidgetId = 'equipment' | 'inventory' | 'support' | 'communications' | 'meetings' | 'attendance' | 'breaks' | 'leave' | 'expenses' | 'goals' | 'grievances' | 'hiring' | 'feed';
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
 define('feed','Company Feed','أخبار الشركة','Communications','feed',[],'Recent company announcements visible to you.'),
];
export function widgetDefinition(id: string) { return WIDGETS.find(w=>w.id===id); }
export function canUseWidget(user: AuthUser, widget: WidgetDefinition) {
 return widget.permissions.length===0 || (user.permissions ? widget.permissions.some(p=>user.permissions!.includes(p)) : user.role==='hr_admin');
}
export function widgetPath(id: WidgetId, now = new Date()) {
 const monday=new Date(now);monday.setDate(monday.getDate()-((monday.getDay()+6)%7));
 const date=`${monday.getFullYear()}-${String(monday.getMonth()+1).padStart(2,'0')}-${String(monday.getDate()).padStart(2,'0')}`;
 const paths: Record<WidgetId,string>={equipment:'/api/me/assets',inventory:'/api/hr/assets',support:'/api/support',communications:'/api/communications/messages',meetings:'/api/communications/meetings?upcoming=true',attendance:'/api/clock-status',breaks:'/api/attendance/breaks?team=true',leave:'/api/hr/leave-requests?status=pending&pageSize=5',expenses:'/api/finance/expense-claims?status=pending&pageSize=5',goals:`/api/roster/goals?weekStart=${date}`,grievances:'/api/grievances',hiring:'/api/hiring/applicants?status=active&pageSize=5',feed:'/api/company-feed'};
 return paths[id];
}
