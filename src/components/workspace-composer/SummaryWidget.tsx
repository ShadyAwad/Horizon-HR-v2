import {assetLabel} from '../../lib/asset-presentation';
import {hiringLabel,hiringDate} from '../../lib/hiring-presentation';
import {useState,type ReactNode} from 'react';
import {apiFetch} from '../../lib/api';
import {SupportRequestButton} from '../support/SupportPanel';
import {GRIEVANCE_COPY} from '../../lib/grievance-copy';
import { useLanguage } from '../../lib/LanguageContext';
import type { WidgetInstance } from './workspace-model';
import type { WidgetResult } from './useWidgetData';
export default function SummaryWidget({widget,result,onRefresh}:{widget:WidgetInstance;result?:WidgetResult;onRefresh?:()=>void}){
 const [busy,setBusy]=useState<string|null>(null),[error,setError]=useState('');
 const {isRtl,t}=useLanguage();const text=(en:string,ar:string)=>isRtl?ar:en;
 if(!result)return <p role="status">{text('Loading…','جار التحميل…')}</p>;
 if(result.error)return <p role="alert">{result.error}</p>;
 const data=result.data;
 if(widget.widgetId==='attendance')return <><p className="composer-metric">{data.isClockedIn?text('Clocked in','داخل الدوام'):text('Clocked out','خارج الدوام')}</p>{!widget.config.compact&&<p>{data.clockedIn?new Date(data.clockedIn).toLocaleString(isRtl?'ar':'en'):text('No active shift.','لا يوجد دوام نشط.')}<br/>{data.locationStatus||''}</p>}</>;
 if(widget.widgetId==='equipment')return <>{(data.assets??[]).length?<ul className="composer-records">{data.assets.slice(0,widget.config.limit||5).map((a:any)=><li key={a.id}><strong>{a.name}</strong><p><bdi dir="ltr">{a.assetTag}</bdi> · {assetLabel(a.condition,isRtl)} · {assetLabel(a.status,isRtl)}</p>{a.status==='active'&&<SupportRequestButton asset={a} onCreated={onRefresh}/>}</li>)}</ul>:<p>{text('No equipment assigned.','لا توجد عهدة مسندة.')}</p>}</>;
 if(widget.widgetId==='goals')return <>{error&&<p role="alert">{error}</p>}<ul className="composer-records">{[...(data.overdueGoals??[]),...(data.goals??[])].slice(0,widget.config.limit||5).map((g:any)=><li key={g.id}><strong>{g.title}</strong><p>{g.status} · {g.dueDate??g.weekStart}</p>{data.capabilities?.canComplete&&['pending','in_progress'].includes(g.status)&&<button disabled={busy!==null} type="button" onClick={async()=>{setBusy(g.id);setError('');try{const r=await apiFetch('/api/roster/goals/'+g.id+'/status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'completed'})});const d=await r.json();if(!r.ok)throw Error(d.error||'Task update failed.');onRefresh?.();}catch(e){setError((e as Error).message);}finally{setBusy(null);}}}>{busy===g.id?text('Saving…','جار الحفظ…'):text('Mark completed','وضع علامة مكتمل')}</button>}</li>)}</ul>{!(data.goals?.length||data.overdueGoals?.length)&&<p>{text('No tasks this week.','لا توجد مهام لهذا الأسبوع.')}</p>}</>;
 let rows:Array<{title:string;detail?:ReactNode}>=[];
 switch(widget.widgetId){
 case 'inventory':rows=(data.assets||[]).map((r:any)=>({title:r.name,detail:<><bdi dir="ltr">{r.assetTag}</bdi> · {assetLabel(r.status,isRtl)}</>}));break;
 case 'support':rows=(data.tickets||[]).map((r:any)=>({title:r.summary,detail:r.status+' · '+(r.handler_name||text('Awaiting handler','بانتظار مسؤول'))}));break;
 case 'communications':rows=(data.messages||[]).map((r:{subject:string;status:string})=>({title:r.subject,detail:r.status}));break;
 case 'meetings':rows=(data.meetings||[]).map((r:{title:string;starts_at:string;timezone:string})=>({title:r.title,detail:new Date(r.starts_at).toLocaleString(isRtl?'ar':'en',{timeZone:r.timezone})+' '+r.timezone}));break;
 case 'breaks': rows=[...(data.breaks||[]).filter((b:any)=>!b.ended_at||b.exception_status==='unresolved').map((b:any)=>({title:b.employee_name||text('Break','استراحة'),detail:!b.ended_at?text('Active','نشطة'):text('Unresolved','تحتاج مراجعة')})),...(data.requests||[]).filter((r:any)=>r.status==='pending').map((r:any)=>({title:r.employee_name||text('Break request','طلب استراحة'),detail:`${r.duration_minutes} ${text('min · Pending','دقيقة · معلق')}`}))];break;
 case 'leave':rows=(data.requests||[]).map((r:any)=>({title:r.employee?.displayName||r.employee?.name||r.employeeName||r.leaveType,detail:`${r.startDate} → ${r.endDate}`}));break;
 case 'expenses':rows=(data.claims||[]).map((r:any)=>({title:r.merchantName,detail:`${r.amount} ${r.currency} · ${r.status}`}));break;

 case 'grievances':rows=(data.grievances||[]).map((r:any)=>({title:`${r.case_number} · ${r.title}`,detail:GRIEVANCE_COPY[r.status as keyof typeof GRIEVANCE_COPY]?.[isRtl?1:0]||r.status}));break;
 case 'openRoles':rows=(data.jobs||[]).map((r:any)=>({title:r.title,detail:hiringLabel(r.status,isRtl)}));break;
 case 'hiringInterviews':rows=(data.interviews||[]).map((r:any)=>({title:r.title,detail:hiringDate(r.starts_at,isRtl)}));break;
 case 'pendingOffers':return <p className="composer-metric">{data.offersPending??text('Permission required','تتطلب صلاحية')}</p>;
 case 'hiring':rows=(data.applicants||[]).map((r:any)=>({title:r.positionTitle,detail:`${r.fullName} · ${t(`hiring.stage.${r.stage}` as never)}`}));break;
 case 'newHires':case 'onboardingRisk':case 'equipmentPending':case 'accessPending':case 'firstDayReadiness':rows=(data[widget.widgetId]?.hires||[]).map((h:any)=>({title:h.full_name,detail:hiringLabel(h.readiness,isRtl)+' · '+h.reasons.map((r:string)=>r.replace(/ · ([a-z_]+)$/,(_match,key)=>' · '+hiringLabel(key,isRtl))).join('; ')}));break;
 case 'feed':rows=(data.posts||[]).map((r:any)=>({title:r.title,detail:(r.content_text||r.contentText||'').slice(0,180)}));break;
 }
 return <>{widget.widgetId==='grievances'&&data.summary&&<p>{text('Unassigned','غير مسندة')}: {data.summary.unassigned} · {text('High / urgent','عالية / عاجلة')}: {data.summary.high} · {text('Waiting','بانتظار رد')}: {data.summary.waiting} · {text('Assigned to me','مسندة لي')}: {data.summary.mine}</p>}{typeof data.total==='number'&&<p>{data.total} {text('matching records','سجلاً مطابقاً')}</p>}{rows.length?<ul className="composer-records">{rows.slice(0,widget.config.limit||5).map((r,i)=><li key={i}><strong>{r.title}</strong><p>{r.detail}</p></li>)}</ul>:<p>{text('No items to show.','لا توجد عناصر.')}</p>}<p className="composer-caption">{text('Snapshot · Open the module for full details and actions.','لقطة حالية · افتح القسم للتفاصيل والإجراءات.')}</p></>;
}
