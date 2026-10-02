import { useEffect, useState } from 'react';
import { apiFetch, apiUrl } from '../../lib/api';
import { Select } from '../ui/FormControls';
export function OpenAIConnection({connected,accountLabel,model,persistent,expiresAt,scopes,refreshedAt,isRtl,onChanged}:{connected:boolean;accountLabel?:string;model?:string;persistent?:boolean;expiresAt?:string;scopes?:string[];refreshedAt?:string;isRtl:boolean;onChanged:()=>void}) {
  const [url,setUrl]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [models,setModels]=useState<{id:string;label:string}[]|null>(null);
  const [probe,setProbe]=useState<any>(null),[rawPassed,setRawPassed]=useState(false);
  useEffect(()=>{setProbe(null);setRawPassed(false);},[connected,model]);
  const text=(en:string,ar:string)=>isRtl?ar:en;
  async function change(disconnect:boolean) {
    setBusy(true);setMessage('');setUrl('');
    try {
      const response=await apiFetch(apiUrl('/api/command-router/openai/'+(disconnect?'disconnect':'connect')),{method:'POST'});
      if(!response.ok)throw Error();const result=await response.json();
      if(disconnect){setMessage(result.remoteRevoked?text('Disconnected.','تم قطع الاتصال.'):text('Disconnected locally; remote revocation was not confirmed. Disconnect Stanza in ChatGPT Settings.','تم قطع الاتصال محليًا؛ لم يتم تأكيد الإلغاء عن بُعد. ألغِ اتصال Stanza من إعدادات ChatGPT.'));onChanged();}
      else {const link=new URL(result.authorizationUrl);if(link.origin!=='https://auth.openai.com' || link.pathname!=='/api/accounts/authorize')throw Error();setUrl(link.href);}
    }catch{setMessage(text('Authorization is unavailable. Try again.','التفويض غير متاح. حاول مرة أخرى.'));}
    finally{setBusy(false);}
  }
  async function loadModels() {
    setBusy(true);setMessage('');
    try{const r=await apiFetch(apiUrl('/api/command-router/openai/models'));if(!r.ok)throw Error();setModels((await r.json()).models);}
    catch{setMessage(text('Could not load available ChatGPT models.','تعذر تحميل نماذج ChatGPT المتاحة.'));}finally{setBusy(false);}
  }
  async function selectModel(value:string) {
    setBusy(true);setMessage('');
    try{const r=await apiFetch(apiUrl('/api/command-router/openai/model'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:value})});if(!r.ok)throw Error();onChanged();}
    catch{setMessage(text('This model is unavailable.','هذا النموذج غير متاح.'));}finally{setBusy(false);}
  }
  async function checkProvider(structured:boolean) {
    setBusy(true);setMessage('');
    try{const r=await apiFetch(apiUrl('/api/command-router/openai/probe'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:structured?'structured':'raw'})});if(!r.ok)throw Error();const result=(await r.json()).probe;setProbe({mode:structured?'structured':'raw',...result});if(!structured)setRawPassed(result.working===true);}
    catch{setMessage(text('Connection check unavailable.','اختبار الاتصال غير متاح.'));}finally{setBusy(false);}
  }
  return <div className="border-b px-3 py-2 text-xs" dir={isRtl?'rtl':'ltr'}>
    {connected && <p>{text('Connected ChatGPT account: ','حساب ChatGPT المتصل: ')}{accountLabel || text('Verified account','حساب تم التحقق منه')}</p>}
    <p>{persistent ? text('ChatGPT credentials are encrypted on this computer. Disconnect to revoke access. Each AI query uses your ChatGPT plan allowance.','بيانات اتصال ChatGPT مشفرة على هذا الكمبيوتر. اقطع الاتصال لإلغاء الوصول. يستهلك كل طلب من حصة خطتك.') : text('ChatGPT connection is session-only. Each AI query needs consent and uses your ChatGPT plan allowance.','اتصال ChatGPT لهذه الجلسة فقط. يتطلب كل طلب ذكاء اصطناعي موافقتك ويستهلك من حصة خطتك.')}</p>
    <button type="button" disabled={busy} className="stanza-interactive-control mt-2 rounded px-2 py-1 focus-visible:ring-2 focus-visible:ring-emerald-500" onClick={()=>void change(connected)}>{connected?text('Disconnect ChatGPT','قطع اتصال ChatGPT'):text('Connect ChatGPT','ربط ChatGPT')}</button>
    {connected && <div className="mt-2">
      <button type="button" disabled={busy} className="underline focus-visible:ring-2 focus-visible:ring-emerald-500" onClick={()=>void loadModels()}>{text('Choose an available ChatGPT model','اختر نموذج ChatGPT متاحًا')}</button>
      {models && <label className="mt-2 block">{text('ChatGPT model','نموذج ChatGPT')}<Select className="mt-1" disabled={busy} value={models.some(m=>m.id===model)?model:''} onChange={e=>void selectModel(e.target.value)}>
        <option value="" disabled>{text('Select a model available to your account','اختر نموذجًا متاحًا لحسابك')}</option>
        {models.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}
      </Select></label>}
    </div>}
    {url && !connected && <p className="mt-2"><a className="underline focus-visible:ring-2 focus-visible:ring-emerald-500" href={url} target="_blank" rel="noopener noreferrer">{text('Continue with ChatGPT','المتابعة باستخدام ChatGPT')}</a> — <button type="button" className="underline focus-visible:ring-2 focus-visible:ring-emerald-500" onClick={onChanged}>{text('Refresh connection status','تحديث حالة الاتصال')}</button></p>}
    {connected && <details className="mt-2"><summary>{text('Connection diagnostics','تشخيص الاتصال')}</summary>
      <p>{text('Access expiry: ','انتهاء صلاحية الوصول: ')}{expiresAt || '—'}</p><p>{text('Granted scopes: ','الصلاحيات الممنوحة: ')}{scopes?.join(' ') || '—'}</p><p>{text('Last refresh: ','آخر تجديد: ')}{refreshedAt || text('Not refreshed','لم يتم التجديد')}</p>
      <button type="button" disabled={busy} className="mt-2 underline focus-visible:ring-2 focus-visible:ring-emerald-500" onClick={()=>void checkProvider(false)}>{text('Run raw connection check (uses plan allowance)','اختبار اتصال مباشر (يستهلك من حصة الخطة)')}</button>
      {rawPassed && <button type="button" disabled={busy} className="ms-2 underline focus-visible:ring-2 focus-visible:ring-emerald-500" onClick={()=>void checkProvider(true)}>{text('Run structured output check','اختبار الإخراج المنظم')}</button>}
      {probe && <pre role="status" className="mt-2 whitespace-pre-wrap break-words" dir="ltr">{JSON.stringify(probe,null,2)}</pre>}
    </details>}
    {message && <p role="status" className="mt-2">{message}</p>}
  </div>;
}
