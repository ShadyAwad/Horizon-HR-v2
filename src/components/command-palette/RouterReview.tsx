import { useEffect, useState } from 'react';
import { apiFetch, apiUrl } from '../../lib/api';
type Candidate = {id:string;normalized_query:string;proposed_intent:string};
export function RouterReview({isRtl,onClose}:{isRtl:boolean;onClose:()=>void}) {
  const [rows,setRows]=useState<Candidate[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const text=(en:string,ar:string)=>isRtl?ar:en;
  async function load(signal?:AbortSignal) { const res=await apiFetch(apiUrl('/api/command-router/candidates'),{signal}); if(!res.ok)throw Error('review'); const payload=await res.json();setRows(payload.candidates); }
  useEffect(()=>{const c=new AbortController();void load(c.signal).catch(()=>{if(!c.signal.aborted)setError(text('Review unavailable.','المراجعة غير متاحة.'));});return ()=>c.abort();},[]);
  async function decide(id:string,decision:'approve'|'reject') { setBusy(true);setError('');try { const res=await apiFetch(apiUrl(`/api/command-router/candidates/${id}/review`),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({decision})});if(!res.ok)throw Error('review');await load(); }catch{setError(text('Review failed. No example was activated.','تعذرت المراجعة. لم يتم تفعيل المثال.'));}finally{setBusy(false);} }
  return <section aria-label={text('Review routing examples','مراجعة أمثلة التوجيه')} className="max-h-72 overflow-auto border-t p-4 text-sm">
    <button type="button" onClick={onClose}>{text('Close review','إغلاق المراجعة')}</button><p>{text('Queries may contain personal details. Approve only safe, reusable phrases with the correct intent.','قد تحتوي الطلبات على بيانات شخصية. وافق فقط على العبارات الآمنة والقابلة لإعادة الاستخدام ذات النية الصحيحة.')}</p>
    {error&&<p role="alert">{error}</p>}{rows.map(r=><article key={r.id} className="mt-3 rounded border p-2"><p>{r.normalized_query}</p><p>{r.proposed_intent}</p><button type="button" disabled={busy} onClick={()=>void decide(r.id,'approve')}>{text('Approve and embed','موافقة وتضمين')}</button> · <button type="button" disabled={busy} onClick={()=>void decide(r.id,'reject')}>{text('Reject','رفض')}</button></article>)}{!rows.length&&<p>{text('No confirmed candidates awaiting review.','لا توجد أمثلة مؤكدة تنتظر المراجعة.')}</p>}
  </section>;
}
