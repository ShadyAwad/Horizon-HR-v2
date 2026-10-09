import {useEffect,useState} from 'react';
import {ComposerDialog} from '../workspace-composer/ComposerDialog';
import {Input,Textarea} from '../ui/FormControls';
import {useLanguage} from '../../lib/LanguageContext';
import {apiFetch,apiUrl} from '../../lib/api';
import {readApiJson} from '../../lib/api-response';
import {formatAttendanceDuration} from '../../lib/attendance-duration';
const button='stanza-secondary-action min-h-11 rounded-lg border border-[var(--stanza-border-subtle)] px-3 py-2 text-sm font-bold disabled:opacity-50';
async function request(path:string,body:unknown){return readApiJson(await apiFetch(apiUrl(path),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));}
export function EarlyClockOutDialog({attendance,onClose,onConfirm,busy}:{attendance:any;onClose:()=>void;onConfirm:(note:string)=>void;busy:boolean}){
 const {isRtl}=useLanguage(),text=(en:string,ar:string)=>isRtl?ar:en;const [note,setNote]=useState('');
 const time=(v:string)=>new Date(v).toLocaleString(isRtl?'ar':'en',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
 return <ComposerDialog title={text('Clock out early?','تسجيل الانصراف مبكراً؟')} onClose={()=>{if(!busy)onClose();}}><div className="space-y-4 text-start">
 <p>{text('Your scheduled shift ends at','تنتهي ورديتك المجدولة في')} {time(attendance.scheduledEnd)}.</p>
 {attendance.approvedDeparture&&<p>{text('Approved departure:','الانصراف المعتمد:')} {time(attendance.approvedDeparture)}</p>}
 <p role="status">{text('Remaining until your authorized end:','الوقت المتبقي حتى موعد الانصراف المعتمد:')} {formatAttendanceDuration(attendance.remainingSeconds,isRtl?'ar':'en')}.</p>
 <p>{text('You can still clock out now. This ends your attendance and any active break.','يمكنك تسجيل الانصراف الآن. سينتهي حضورك وأي استراحة نشطة.')}</p>
 <label className="block text-sm">{text('Note (optional)','ملاحظة (اختيارية)')}<Textarea className="mt-1 w-full" value={note} maxLength={500} onChange={e=>setNote(e.target.value)}/></label>
 <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={onClose}>{text('Cancel','إلغاء')}</button><button className={button+' stanza-primary-action stanza-theme-primary'} disabled={busy} onClick={()=>onConfirm(note)}>{text('Clock out early','تسجيل الانصراف مبكراً')}</button></div>
 </div></ComposerDialog>;
}
export function AttendanceActions({attendance,hasShift,canClock,offline,onChanged,onClockOut}:{attendance:any;hasShift:boolean;canClock:boolean;offline:boolean;onChanged:()=>void;onClockOut:()=>void}){
 const {isRtl}=useLanguage(),text=(en:string,ar:string)=>isRtl?ar:en;const [dialog,setDialog]=useState<'no_location'|'request'|null>(null),[note,setNote]=useState(''),[departure,setDeparture]=useState(''),[preview,setPreview]=useState<any>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const time=(v:string)=>new Date(v).toLocaleString(isRtl?'ar':'en',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
 // One timeout at the next authoritative boundary, suspended while the document is hidden.
 useEffect(()=>{let timer:ReturnType<typeof setTimeout>|undefined;const sync=()=>{if(timer)clearTimeout(timer);if(!document.hidden&&attendance?.nextChangeAt)timer=setTimeout(onChanged,Math.max(100,new Date(attendance.nextChangeAt).getTime()-new Date(attendance.serverNow).getTime()+50));};const visible=()=>{if(document.hidden){if(timer)clearTimeout(timer);}else onChanged();};sync();document.addEventListener('visibilitychange',visible);return()=>{if(timer)clearTimeout(timer);document.removeEventListener('visibilitychange',visible);};},[attendance?.serverNow,attendance?.nextChangeAt,onChanged]);
 useEffect(()=>{setPreview(null);if(dialog!=='request'||!departure)return;let cancelled=false;const timer=setTimeout(()=>{void request('/api/attendance/early-leave/preview',{timeLogId:attendance.timeLogId,departureTime:new Date(departure).toISOString()}).then(p=>{if(!cancelled){setPreview(p);setError('');}}).catch(e=>{if(!cancelled)setError(e.message);});},300);return()=>{cancelled=true;clearTimeout(timer);};},[departure,dialog,attendance?.timeLogId]);
 const open=(next:'no_location'|'request')=>{setNote('');setError('');setPreview(null);setDeparture('');setDialog(next);};
 const submit=async()=>{setBusy(true);setError('');try{await request(dialog==='no_location'?'/api/attendance/clock-in-without-location':'/api/attendance/early-leave',dialog==='no_location'?{confirm:true,note}:{timeLogId:attendance.timeLogId,departureTime:new Date(departure).toISOString(),reason:note});setDialog(null);onChanged();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const current=attendance?.earlyLeaveRequest;
 return <div className="w-full space-y-2 text-start">
 <div className="flex flex-wrap justify-center gap-2">{canClock&&hasShift&&(attendance?.activeBreak||attendance?.plannedBreaks?.some((b:any)=>b.state==='due'))&&<button className={button} disabled={offline||busy} onClick={onClockOut}>{text('Clock out','تسجيل الانصراف')}</button>}{canClock&&!hasShift&&<button className={button} disabled={offline||busy} onClick={()=>open('no_location')}>{text('Clock in without location','تسجيل الحضور دون موقع')}</button>}
 {canClock&&hasShift&&attendance?.remainingSeconds>0&&!['pending','approved'].includes(current?.status)&&<button className={button} disabled={offline||busy} onClick={()=>open('request')}>{text('Request early leave','طلب انصراف مبكر')}</button>}</div>
 {attendance?.plannedBreaks?.length>0&&<details className="text-sm"><summary className="cursor-pointer text-center">{text('Planned breaks','الاستراحات المجدولة')}</summary><ul className="mt-2 space-y-1">{attendance.plannedBreaks.map((b:any)=><li key={b.startTime}>{time(b.startTime)} – {time(b.endTime)} · {({upcoming:text('Upcoming','قادمة'),due:text('Due now','حان موعدها'),active:text('On break','في استراحة'),completed:text('Completed','مكتملة'),missed:text('Missed','فات موعدها'),outside_authorized_shift:text('After approved departure','بعد موعد الانصراف المعتمد')} as Record<string,string>)[b.state]}</li>)}</ul></details>}
 {attendance?.scheduledEnd&&<p className="text-center text-xs">{text('Scheduled end:','نهاية الوردية:')} {time(attendance.scheduledEnd)}{attendance.approvedDeparture&&<> · {text('Approved departure:','الانصراف المعتمد:')} {time(attendance.approvedDeparture)}</>}</p>}
 {current&&<p className="text-center text-sm" role="status">{text('Early leave request:','طلب الانصراف المبكر:')} {({pending:text('Pending','معلق'),approved:text('Approved','معتمد'),rejected:text('Rejected','مرفوض')} as Record<string,string>)[current.status]} · {time(current.requested_departure_time)}{current.review_note&&' · '+current.review_note}</p>}
 {dialog&&<ComposerDialog title={dialog==='no_location'?text('Clock in without location','تسجيل الحضور دون موقع'):text('Request early leave','طلب انصراف مبكر')} onClose={()=>{if(!busy)setDialog(null);}}><form className="space-y-4 text-start" onSubmit={e=>{e.preventDefault();void submit();}}>
 <p>{dialog==='no_location'?text('This skips location verification. Your attendance will be recorded as a no-location clock-in and can be viewed by authorized managers or HR.','سيُسجل حضورك دون التحقق من الموقع. يمكن للمديرين أو الموارد البشرية المصرح لهم الاطلاع على طريقة تسجيل الحضور.'):text('Ask for approval to leave before your scheduled end. Sending this request will not clock you out.','اطلب الموافقة على الانصراف قبل نهاية ورديتك. إرسال الطلب لا يسجل انصرافك.')}</p>
 {dialog==='request'&&<><p>{text('Scheduled end:','نهاية الوردية:')} {time(attendance.scheduledEnd)}</p><label className="block text-sm">{text('Requested departure','موعد الانصراف المطلوب')}<Input type="datetime-local" required className="mt-1 w-full" value={departure} onChange={e=>setDeparture(e.target.value)}/></label>{preview&&<p role="status">{formatAttendanceDuration(preview.earlySeconds,isRtl?'ar':'en')} {text('early','مبكراً')}</p>}</>}
 <label className="block text-sm">{text('Note (optional)','ملاحظة (اختيارية)')}<Textarea className="mt-1 w-full" value={note} maxLength={500} onChange={e=>setNote(e.target.value)}/></label>
 {error&&<p role="alert">{error}</p>}<div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={()=>setDialog(null)}>{text('Cancel','إلغاء')}</button><button className={button+' stanza-primary-action stanza-theme-primary'} disabled={busy||offline||(dialog==='request'&&!preview)}>{dialog==='no_location'?text('Clock in without location','تسجيل الحضور دون موقع'):text('Send request','إرسال الطلب')}</button></div>
 </form></ComposerDialog>}
 </div>;
}
