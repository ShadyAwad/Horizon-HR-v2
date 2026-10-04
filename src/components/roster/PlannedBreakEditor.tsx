import { useEffect, useState } from 'react';
import { Input } from '../ui/FormControls';
export type BreakWindow = { start: string; end: string };
export function PlannedBreakEditor({value,onSave,editable,isRtl,shiftDate}:{value:BreakWindow[];onSave:(value:BreakWindow[])=>void;editable:boolean;isRtl:boolean;shiftDate:string}) {
 const [draft,setDraft]=useState(value);
 const saved = JSON.stringify(value);
 useEffect(()=>setDraft(JSON.parse(saved) as BreakWindow[]),[saved]);
 const text=(en:string,ar:string)=>isRtl?ar:en;
 if (!editable) return <div className="space-y-1">{value.length ? value.map((b,i)=><p key={i} dir="ltr">{b.start} – {b.end}</p>) : text('No planned breaks','لا توجد استراحات مخططة')}</div>;
 const change=(index:number,field:'start'|'end',time:string)=>setDraft(rows=>rows.map((row,i)=>i===index?{...row,[field]:time}:row));
 return <fieldset className="min-w-0 space-y-2" dir={isRtl?'rtl':'ltr'}><legend className="text-xs font-semibold">{text('Planned breaks','الاستراحات المخططة')}</legend>
 <p className="text-xs text-[var(--stanza-text-secondary)]">{text('Save breaks when finished. Recorded attendance stays separate.','احفظ الاستراحات عند الانتهاء. سجلات الحضور تبقى منفصلة.')}</p>
 {draft.map((b,i)=><div key={i} className="flex flex-wrap items-end gap-2"><label className="min-w-0 text-xs">{text('Start','البداية')} {i+1}<Input type="time" dir="ltr" aria-label={text('Break start','بداية الاستراحة')+' '+(i+1)+' '+shiftDate} value={b.start} onChange={e=>change(i,'start',e.target.value)} className="w-28" /></label><label className="min-w-0 text-xs">{text('End','النهاية')} {i+1}<Input type="time" dir="ltr" aria-label={text('Break end','نهاية الاستراحة')+' '+(i+1)+' '+shiftDate} value={b.end} onChange={e=>change(i,'end',e.target.value)} className="w-28" /></label><button type="button" className="stanza-interactive-control rounded p-2 text-xs" aria-label={text('Remove break','حذف الاستراحة')+' '+(i+1)+' '+shiftDate} onClick={()=>setDraft(rows=>rows.filter((_,index)=>index!==i))}>{text('Remove','حذف')}</button></div>)}
 {!draft.length&&<p className="text-xs">{text('No planned breaks','لا توجد استراحات مخططة')}</p>}
 <div className="flex flex-wrap gap-2"><button type="button" className="stanza-interactive-control rounded border px-2 py-2 text-xs" disabled={draft.length>=8} onClick={()=>setDraft(rows=>[...rows,{start:'',end:''}])}>{text('Add break','إضافة استراحة')}</button><button type="button" className="stanza-interactive-control rounded border px-2 py-2 text-xs" disabled={JSON.stringify(draft)===JSON.stringify(value)||draft.some(b=>!b.start||!b.end)} onClick={()=>onSave(draft)}>{text('Save breaks','حفظ الاستراحات')}</button></div>
 </fieldset>;
}
