import type {Intent} from './intelligent-router';
const read=(key:string,commandId:string,description:string,permissions:string[],aliases:string[]):Intent=>({key,commandId,actionKey:'OPEN_'+key.toUpperCase(),category:'display',safety:'read_only',description,permissions,aliases,enabled:true,entities:{required:[],optional:[]}});
export const READ_INTENTS:readonly Intent[]=[
 read('not_clocked_in_today','navigation:liveEmployees','Read active employees without a clock-in event today, under the existing company-wide Live Employees boundary.',['attendance.view_live'],[]),
 read('my_attendance_status','router:attendance','Read the authenticated employee current clock-in and break state.',['attendance.clock'],['my clock status','my attendance status today','حالة حضوري الآن']),
 read('team_approved_leave','roster:leave','Read approved leave in the actor authorized employee scope.',['leave.view.scoped','leave.approve'],['who is on approved leave today','team approved leave','اجازات فريقي المعتمدة']),
 read('team_schedule','roster:schedule','Read scheduled shifts inside current roster permission scopes.',['roster.view_all'],['team shift schedule','جدول مناوبات فريقي']),
 read('my_schedule','roster:schedule','Read my scheduled shifts for an explicit date window.',[],['my upcoming shifts','مناوباتي القادمة']),
 read('employee_directory_lookup','organisation:hierarchy','Read public company directory fields for an unambiguously resolved employee.',['organisation.view'],['employee reporting details','بيانات الموظف التنظيمية']),
 read('manager_direct_reports','organisation:hierarchy','Read direct reporting relationships from the company directory.',['organisation.view'],['my direct reports']),
 read('asset_inventory_query','navigation:assets','Read authorized equipment availability and condition.',['assets.view'],['unassigned equipment','damaged assets','معدات غير مسندة']),
 read('location_directory','navigation:locations','Read permitted company location names.',['locations.read'],['list company offices','مواقع الشركة المتاحة']),
 read('hiring_upcoming_interviews','hiring:applicants','Read upcoming scheduled hiring interviews.',['hiring.view'],['upcoming recruitment interviews','مقابلات التوظيف القادمة']),
];
export const READ_KEYS=new Set(READ_INTENTS.map(i=>i.key));
