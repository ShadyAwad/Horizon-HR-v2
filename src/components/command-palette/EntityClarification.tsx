import type { EntityChoices, EntityRoute } from '../../lib/router-entities';
export function EntityClarification({route,isRtl,busy,onChoose}:{route:EntityRoute;isRtl:boolean;busy:boolean;onChoose:(type:keyof EntityChoices,id:string)=>void}) {
 const text=(en:string,ar:string)=>isRtl?ar:en;
 const buttonClass='w-full min-w-0 whitespace-normal break-words rounded border p-2 text-start hover:bg-emerald-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50';
 return <div dir={isRtl?'rtl':'ltr'} className="mt-2 space-y-2" data-entity-status={route.status}>
  {route.entities.filter(entity=>entity.status==='ambiguous').map(entity=><fieldset key={entity.type} disabled={busy} className="min-w-0 space-y-2"><legend>{entity.type==='employee'?text('Which employee did you mean?','أي موظف تقصد؟'):text('Which location did you mean?','أي موقع تقصد؟')}</legend>{entity.candidates?.map(candidate=><button key={candidate.id} type="button" className={buttonClass} onClick={()=>onChoose(entity.type,candidate.id)}>{candidate.label}</button>)}{entity.truncated&&<p>{text('More matches exist. Enter a full name or identifier.','توجد نتائج أخرى. أدخل الاسم الكامل أو المعرّف.')}</p>}</fieldset>)}
  {route.entities.some(entity=>entity.type==='location')&&<p>{text("Location refers to the employee's current team, not the incident location.",'الموقع يشير إلى فريق الموظف الحالي وليس موقع الواقعة.')}</p>}
  {route.status==='ambiguous'&&route.cases.length>0&&<fieldset disabled={busy} className="min-w-0 space-y-2"><legend>{text('Which case did you mean?','أي قضية تقصد؟')}</legend>{route.cases.map(row=><button key={row.id} type="button" className={buttonClass} onClick={()=>onChoose('case',row.id)}>{row.reference} · {row.title}</button>)}{route.cases.length===8&&<p>{text('Use a case reference to narrow the results.','استخدم رقم القضية لتحديد النتائج.')}</p>}</fieldset>}
  {route.status==='resolved'&&<p>{route.cases.find(row=>row.id===route.caseId)?.reference} · {route.cases.find(row=>row.id===route.caseId)?.title}</p>}
 </div>;
}
