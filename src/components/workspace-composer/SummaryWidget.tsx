import {GRIEVANCE_COPY} from '../../lib/grievance-copy';
import { useLanguage } from '../../lib/LanguageContext';
import type { WidgetInstance } from './workspace-model';
import type { WidgetResult } from './useWidgetData';
export default function SummaryWidget({widget,result}:{widget:WidgetInstance;result?:WidgetResult}){
 const {isRtl}=useLanguage();const text=(en:string,ar:string)=>isRtl?ar:en;
 if(!result)return <p role="status">{text('Loading…','جار التحميل…')}</p>;
 if(result.error)return <p role="alert">{result.error}</p>;
 const data=result.data;
 if(widget.widgetId==='attendance')return <><p className="composer-metric">{data.isClockedIn?text('Clocked in','داخل الدوام'):text('Clocked out','خارج الدوام')}</p>{!widget.config.compact&&<p>{data.clockedIn?new Date(data.clockedIn).toLocaleString(isRtl?'ar':'en'):text('No active shift.','لا يوجد دوام نشط.')}<br/>{data.locationStatus||''}</p>}</>;
 let rows:Array<{title:string;detail?:string}>=[];
 switch(widget.widgetId){
 case 'communications':rows=(data.messages||[]).map((r:{subject:string;status:string})=>({title:r.subject,detail:r.status}));break;
 case 'meetings':rows=(data.meetings||[]).map((r:{title:string;starts_at:string;timezone:string})=>({title:r.title,detail:new Date(r.starts_at).toLocaleString(isRtl?'ar':'en',{timeZone:r.timezone})+' '+r.timezone}));break;
 case 'breaks': rows=[...(data.breaks||[]).filter((b:any)=>!b.ended_at||b.exception_status==='unresolved').map((b:any)=>({title:b.employee_name||text('Break','استراحة'),detail:!b.ended_at?text('Active','نشطة'):text('Unresolved','تحتاج مراجعة')})),...(data.requests||[]).filter((r:any)=>r.status==='pending').map((r:any)=>({title:r.employee_name||text('Break request','طلب استراحة'),detail:`${r.duration_minutes} ${text('min · Pending','دقيقة · معلق')}`}))];break;
 case 'leave':rows=(data.requests||[]).map((r:any)=>({title:r.employee?.name||r.employeeName||r.leaveType,detail:`${r.startDate} → ${r.endDate}`}));break;
 case 'expenses':rows=(data.claims||[]).map((r:any)=>({title:r.merchantName,detail:`${r.amount} ${r.currency} · ${r.status}`}));break;
 case 'goals':rows=[...(data.overdueGoals||[]),...(data.goals||[])].map((r:any)=>({title:r.title,detail:r.status}));break;
 case 'grievances':rows=(data.grievances||[]).map((r:any)=>({title:`${r.case_number} · ${r.title}`,detail:GRIEVANCE_COPY[r.status as keyof typeof GRIEVANCE_COPY]?.[isRtl?1:0]||r.status}));break;
 case 'hiring':rows=(data.applicants||[]).map((r:any)=>({title:r.positionTitle,detail:`${r.fullName} · ${r.stage}`}));break;
 case 'feed':rows=(data.posts||[]).map((r:any)=>({title:r.title,detail:(r.content_text||r.contentText||'').slice(0,180)}));break;
 }
 return <>{widget.widgetId==='grievances'&&data.summary&&<p>{text('Unassigned','غير مسندة')}: {data.summary.unassigned} · {text('High / urgent','عالية / عاجلة')}: {data.summary.high} · {text('Waiting','بانتظار رد')}: {data.summary.waiting} · {text('Assigned to me','مسندة لي')}: {data.summary.mine}</p>}{typeof data.total==='number'&&<p>{data.total} {text('matching records','سجلاً مطابقاً')}</p>}{rows.length?<ul className="composer-records">{rows.slice(0,widget.config.limit||5).map((r,i)=><li key={i}><strong>{r.title}</strong><p>{r.detail}</p></li>)}</ul>:<p>{text('No items to show.','لا توجد عناصر.')}</p>}<p className="composer-caption">{text('Snapshot · Open the module for full details and actions.','لقطة حالية · افتح القسم للتفاصيل والإجراءات.')}</p></>;
}
