import {hiringLabel,hiringDate,hiringDay} from '../../lib/hiring-presentation';
import {StanzaIcon} from '../ui/StanzaIcon';
import { useEffect, useState, type ReactNode } from 'react';
import { apiFetch } from '../../lib/api';
import { useLanguage } from '../../lib/LanguageContext';
import { ComposerDialog } from '../workspace-composer/ComposerDialog';
import {hiringRequest} from '../../api/hiring-workflow';
import {QuestionEditor,CandidateDepth,OfferRevisionControls,OnboardingChecklist} from './HiringDepth';
type Field = {
    key: string;
    en: string;
    ar: string;
    type?: string;
    options?: {
        id: string;
        name: string;
    }[];
    required?: boolean;
    multiple?: boolean;
    max?: number;
};
export function WorkflowForm({ title, fields, onSave, onClose, intro }: {
    title: string;
    fields: Field[];
    intro?:ReactNode;
    onSave: (values: Record<string, string>) => Promise<void>;
    onClose: () => void;
}) {
    const { isRtl } = useLanguage(), [busy, setBusy] = useState(false), [error, setError] = useState('');
    return <ComposerDialog title={title} onClose={() => { if (!busy)
        onClose(); }}><form className="hiring-dialog stanza-support-form" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); setBusy(true); setError(''); try {
        const values = Object.fromEntries(f) as Record<string, string>;
        for (const field of fields)
            if (field.multiple)
                values[field.key] = f.getAll(field.key).join(',');
        await onSave(values);
        onClose();
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setBusy(false);
    } }}>{intro}{fields.map(f => <label key={f.key}>{isRtl ? f.ar : f.en}{f.options ? <select aria-label={isRtl ? f.ar : f.en} className="stanza-form-control" name={f.key} multiple={f.multiple} size={f.multiple ? 5 : undefined} required={f.required} disabled={busy}><option value="">{isRtl ? 'اختر…' : 'Choose…'}</option>{f.options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select> : f.type === 'textarea' ? <textarea className="stanza-form-control" name={f.key} required={f.required} maxLength={f.max || 4000} rows={4} disabled={busy}/> : <input className="stanza-form-control" name={f.key} type={f.type || 'text'} required={f.required} maxLength={f.max || 200} disabled={busy}/>}</label>)}{error && <p role="alert">{error}</p>}<button className="stanza-interactive-control" type="submit" disabled={busy}>{busy ? (isRtl ? 'جار الحفظ…' : 'Saving…') : (isRtl ? 'مراجعة وحفظ' : 'Review and save')}</button></form></ComposerDialog>;
}
export function JobOpenings({onChanged}:{onChanged?:()=>void}) {
    const { isRtl } = useLanguage(), t = (en: string, ar: string) => isRtl ? ar : en;
    const [jobs, setJobs] = useState<any[]>([]), [page, setPage] = useState(1), [total, setTotal] = useState(0), [error, setError] = useState(''), [open, setOpen] = useState(false), [options, setOptions] = useState<any>({}), [can, setCan] = useState(false), [refresh, setRefresh] = useState(0), [busy, setBusy] = useState(false),[questionJob,setQuestionJob]=useState<any>(null),[jobStatus,setJobStatus]=useState(''),[copied,setCopied]=useState('');
    useEffect(() => { let live = true; Promise.all([hiringRequest('/jobs?page=' + page + '&status=' + encodeURIComponent(jobStatus)), hiringRequest('/workflow-capabilities')]).then(([d, c]) => { if (live) {
        setJobs(d.jobs);
        setTotal(d.total);
        setCan(c.capabilities.manage_jobs);
    } }).catch(e => { if (live)
        setError(e.message); }); return () => { live = false; }; }, [page, refresh,jobStatus]);
    const action = async (id: string, status: string) => { setBusy(true); setError(''); try {
        await hiringRequest('/jobs/' + id + '/status', { status });
        setRefresh(v => v + 1);
        onChanged?.();
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setBusy(false);
    } };
    return <section dir={isRtl?'rtl':'ltr'} className="hiring-jobs hiring-section" aria-label={t('Job openings','الوظائف المتاحة')}><header className="hiring-section-header"><h3>{t('Job openings','الوظائف المتاحة')}</h3>{can&&<button className="stanza-interactive-control" onClick={async()=>{try{setOptions(await hiringRequest('/job-options'));setOpen(true);}catch(e){setError((e as Error).message);}}}>{t('Create job','إنشاء وظيفة')}</button>}</header><label>{t('Job status','حالة الوظيفة')}<select className="stanza-form-control" value={jobStatus} onChange={e=>{setJobStatus(e.target.value);setPage(1);}}><option value="">{t('All jobs','كل الوظائف')}</option>{['draft','open','paused','closed','filled'].map(v=><option value={v} key={v}>{hiringLabel(v,isRtl)}</option>)}</select></label>{jobStatus&&<p className="hiring-filter-state">{t('Filtered by','تصفية حسب')}: {hiringLabel(jobStatus,isRtl)} <button className="stanza-interactive-control" onClick={()=>{setJobStatus('');setPage(1);}}>{t('Clear job filter','مسح مرشح الوظائف')}</button></p>}{error&&<p role="alert">{error}</p>}{!jobs.length&&<p className="hiring-secondary">{jobStatus?t('No jobs match this status.','لا توجد وظائف بهذه الحالة.'):t('No roles created yet. Create a draft to begin.','لا توجد وظائف بعد. أنشئ مسودة للبدء.')}</p>}
    {jobs.map(j=><article key={j.id} className="hiring-record hiring-job"><header className="hiring-record-heading"><strong>{j.title}</strong><span className="hiring-status">{hiringLabel(j.status,isRtl)}</span></header><p className="hiring-secondary">{j.department||t('No department specified','لم يُحدد قسم')} · {t('Headcount','عدد الوظائف')}: {j.headcount}</p>
    <p className="hiring-secondary">{hiringLabel(j.public_application_state||'unavailable',isRtl)}</p><div className="hiring-actions">{j.public_application_available?<><a className="stanza-interactive-control" href={'/careers/'+j.public_token} target="_blank" rel="noreferrer">{t('Open public application page','فتح صفحة التقديم العامة')}<StanzaIcon name="forward" className="hiring-direction"/></a><button disabled={busy} className="stanza-interactive-control" onClick={async()=>{try{await navigator.clipboard.writeText(location.origin+'/careers/'+j.public_token);setCopied(j.id);}catch{setError(t('Copy unavailable. Open the public page to copy its address.','تعذر النسخ. افتح الصفحة العامة لنسخ عنوانها.'));}}}>{copied===j.id?t('Copied','تم النسخ'):t('Copy public link','نسخ رابط التقديم')}</button></>:null}</div>
    <details><summary>{t('Role details / publication','تفاصيل الوظيفة / النشر')}</summary><p className="whitespace-pre-wrap">{j.description}</p>{j.requirements&&<p className="whitespace-pre-wrap">{j.requirements}</p>}<p className="hiring-secondary">{t('Application window','فترة التقديم')}: {j.opens_on?hiringDay(j.opens_on,isRtl):'—'} → {j.closes_on?hiringDay(j.closes_on,isRtl):'—'}</p>{can&&<><button className="stanza-interactive-control" onClick={()=>setQuestionJob(j)}>{t('Application questions','أسئلة التقديم')}</button><div className="hiring-actions">{['open','paused','closed'].filter(v=>v!==j.status).map(v=><button disabled={busy} className="stanza-interactive-control" key={v} onClick={()=>void action(j.id,v)}>{v==='open'?t('Publish','نشر'):v==='paused'?t('Pause','إيقاف مؤقت'):t('Close','إغلاق')}</button>)}</div></>}</details></article>)}
    <div className="hiring-pagination"><span role="status">{total?t(`${(page-1)*20+1}–${Math.min(page*20,total)} of ${total} jobs`,`${(page-1)*20+1}–${Math.min(page*20,total)} من ${total} وظيفة`):t('0 jobs','٠ وظيفة')}</span><button className="stanza-interactive-control" disabled={page===1} onClick={()=>setPage(v=>v-1)}>{t('Previous','السابق')}</button><button className="stanza-interactive-control" disabled={page*20>=total} onClick={()=>setPage(v=>v+1)}>{t('Next','التالي')}</button></div>{questionJob&&<QuestionEditor job={questionJob} onClose={()=>setQuestionJob(null)} onSaved={()=>setRefresh(v=>v+1)}/>} {open && <WorkflowForm title={t('Create draft job', 'إنشاء مسودة وظيفة')} onClose={() => setOpen(false)} onSave={async (values) => { await hiringRequest('/jobs', values); setRefresh(v => v + 1); onChanged?.(); }} fields={[{ key: 'title', en: 'Title', ar: 'المسمى', required: true, max: 160 }, { key: 'description', en: 'Description', ar: 'الوصف', type: 'textarea', required: true, max: 12000 }, { key: 'requirements', en: 'Requirements', ar: 'المتطلبات', type: 'textarea', max: 12000 }, { key: 'departmentId', en: 'Department', ar: 'القسم', options: options.departments }, { key: 'locationId', en: 'Location', ar: 'الموقع', options: options.locations }, { key: 'managerId', en: 'Hiring manager', ar: 'مدير التوظيف', options: options.employees }, { key: 'ownerId', en: 'Recruiter / owner', ar: 'مسؤول التوظيف', options: options.employees }, { key: 'employmentType', en: 'Employment type', ar: 'نوع العمل', options: ['full_time', 'part_time', 'contract', 'internship'].map(id => ({ id, name: hiringLabel(id,isRtl) })) }, { key: 'headcount', en: 'Headcount', ar: 'عدد الوظائف', type: 'number' }, { key: 'opensOn', en: 'Opening date', ar: 'تاريخ الافتتاح', type: 'date' }, { key: 'closesOn', en: 'Closing date', ar: 'تاريخ الإغلاق', type: 'date' }]}/>}</section>;
}
export function CandidateWorkflow({ id, onChanged, onNavigate }: {
    id: string;
    onChanged: () => void;
    onNavigate?: (target: 'organisation' | 'assets' | 'roster') => void;
}) {
    const { isRtl } = useLanguage(), t = (en: string, ar: string) => isRtl ? ar : en;
    const [data, setData] = useState<any>(null), [caps, setCaps] = useState<any>({}), [error, setError] = useState(''), [mode, setMode] = useState(''), [refresh, setRefresh] = useState(0), [interview, setInterview] = useState(''), [offer, setOffer] = useState(''), [busy, setBusy] = useState(false), [people, setPeople] = useState<any[]>([]);
    useEffect(()=>{setData(null);setMode('');setError('');},[id]);
    useEffect(() => { let live = true; Promise.all([hiringRequest('/applicants/' + id + '/workflow'), hiringRequest('/workflow-capabilities')]).then(([d, c]) => { if (live) {
        setData(d);
        setCaps(c.capabilities);
    } }).catch(e => { if (live)
        setError(e.message); }); return () => { live = false; }; }, [id, refresh]);
    const reload = () => { setRefresh(v => v + 1); onChanged(); };
    const mutate = async (path: string, body: unknown) => { setBusy(true); setError(''); try {
        await hiringRequest(path, body);
        reload();
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setBusy(false);
    } };
    if (!data)
        return <p role="status">{error || t('Loading hiring workflow…', 'جار تحميل سير التوظيف…')}</p>;
    const fields: Record<string, Field[]> = {
        interview: [{ key: 'startsAt', en: 'Starts', ar: 'البداية', type: 'datetime-local', required: true }, { key: 'endsAt', en: 'Ends', ar: 'النهاية', type: 'datetime-local', required: true }, { key: 'timezone', en: 'Timezone (e.g. Africa/Cairo)', ar: 'المنطقة الزمنية مثل Africa/Cairo', required: true }, { key: 'location', en: 'Location or HTTPS video link', ar: 'الموقع أو رابط فيديو HTTPS' }, { key: 'interviewerId', en: 'Interviewers (Ctrl/Cmd to select several)', ar: 'المحاورون (Ctrl/Cmd لاختيار أكثر من شخص)', options: people, required: true, multiple: true }, { key: 'interviewType', en: 'Interview type', ar: 'نوع المقابلة', required: true }],
        evaluation: [{ key: 'recommendation', en: 'Recommendation', ar: 'التوصية', required: true, options: ['strong_yes', 'yes', 'no', 'strong_no'].map(id => ({ id, name: hiringLabel(id,isRtl) })) }, { key: 'score', en: 'Score (1–5)', ar: 'التقييم (١–٥)', type: 'number', required: true }, { key: 'strengths', en: 'Strengths', ar: 'نقاط القوة', type: 'textarea', max: 2000 }, { key: 'concerns', en: 'Concerns', ar: 'المخاوف', type: 'textarea', max: 2000 }, { key: 'notes', en: 'Private feedback', ar: 'ملاحظات خاصة', type: 'textarea' }],
        message: [{ key: 'subject', en: 'Subject', ar: 'العنوان', required: true }, { key: 'body', en: 'Candidate message', ar: 'رسالة المرشح', type: 'textarea', required: true }],
        offer: [{ key: 'salary', en: 'Compensation amount', ar: 'مبلغ التعويض', required: true }, { key: 'currency', en: 'Currency (ISO code)', ar: 'العملة (رمز ISO)', required: true, max: 3 }, { key: 'startDate', en: 'Start date', ar: 'تاريخ البداية', type: 'date', required: true }, { key: 'expiresOn', en: 'Expiry', ar: 'انتهاء العرض', type: 'date', required: true }, { key: 'notes', en: 'Offer notes', ar: 'ملاحظات العرض', type: 'textarea' }],
        sent: [{ key: 'messageId', en: 'Delivered candidate message', ar: 'رسالة المرشح المُسلّمة', options: data.messages.filter((m: any) => m.status === 'sent').map((m: any) => ({ id: m.id, name: m.subject })), required: true }],
        accepted: [{ key: 'responseNote', en: 'Verified candidate acceptance (record source/date)', ar: 'قبول المرشح المؤكد (المصدر والتاريخ)', type: 'textarea', required: true }],
        rejected: [{ key: 'responseNote', en: 'Verified candidate rejection (record source/date)', ar: 'رفض المرشح المؤكد (المصدر والتاريخ)', type: 'textarea', required: true }],
        hire: [{ key: 'confirmation', en: 'Type HIRE to confirm employee creation', ar: 'اكتب HIRE لتأكيد إنشاء الموظف', required: true }]
    };
    return <section className="hiring-workflow mt-5 space-y-3"><h4 className="font-bold">{t('Interviews, offers & onboarding', 'المقابلات والعروض وتهيئة الموظف')}</h4>{error && <p role="alert">{error}</p>}<CandidateDepth id={id} data={data} caps={caps} onChanged={reload}/>{data.coverNote && <p className="whitespace-pre-wrap">{data.coverNote}</p>}{data.resumeAvailable && <a className="underline" href={'/api/hiring/applicants/' + id + '/resume'}>{t('Download private resume.pdf (PDF)', 'تنزيل resume.pdf الخاص (PDF)')}</a>}<div className="flex flex-wrap gap-2">{caps.schedule_interviews && <button className="stanza-interactive-control" onClick={async () => { try {
        const r = await apiFetch('/api/communications/recipients');
        const d = await r.json();
        if (!r.ok)
            throw Error(d.error);
        setPeople(d.employees);
        setMode('interview');
    }
    catch (e) {
        setError((e as Error).message);
    } }}>{t('Schedule interview', 'جدولة مقابلة')}</button>}{caps.send && <button className="stanza-interactive-control" onClick={() => setMode('message')}>{t('Draft candidate message', 'مسودة رسالة للمرشح')}</button>}{caps.manage_offers && caps.compensation && <button className="stanza-interactive-control" onClick={() => setMode('offer')}>{t('Draft offer', 'مسودة عرض')}</button>}</div>
 <h4 className="hiring-section-heading">{t('Interviews / evaluations','المقابلات / التقييمات')}</h4>{!data.interviews.length&&<p className="hiring-secondary">{t('No interviews scheduled.','لا توجد مقابلات مجدولة.')}</p>}{data.interviews.map((i: any) => <article key={i.id} className="hiring-record"><strong>{i.title}</strong><p>{hiringDate(i.starts_at,isRtl)} · {i.location} · {hiringLabel(i.status,isRtl)} · {i.interview_type}</p><p className="hiring-secondary">{data.evaluations.filter((v:any)=>v.interview_id===i.id).length} {t('evaluations visible','تقييمات ظاهرة')}</p>{caps.send&&caps.schedule_interviews&&<button className="stanza-interactive-control" disabled={busy} onClick={()=>void mutate('/interviews/'+i.id+'/invitation',{})}>{t('Draft candidate calendar invitation','إعداد مسودة دعوة تقويم للمرشح')}</button>}{caps.evaluate && <button className="stanza-interactive-control" onClick={() => { setInterview(i.id); setMode('evaluation'); }}>{t('Submit feedback', 'إرسال التقييم')}</button>}<p className="hiring-secondary">{t('Meeting details, ICS and invitations are available in Communications.', 'تفاصيل الاجتماع وملف ICS والدعوات متاحة في المراسلات.')}</p></article>)}
 {data.evaluations.map((v: any) => <article key={v.id} className="hiring-record"><p>{v.author_name} · {hiringLabel(v.recommendation,isRtl)} · {v.score}/5</p><p className="whitespace-pre-wrap">{v.strengths}</p><p className="whitespace-pre-wrap">{v.concerns}</p><p className="whitespace-pre-wrap">{v.notes}</p></article>)}
 <details><summary>{t('Candidate messages','رسائل المرشح')}</summary>{data.messages.map((m: any) => <article key={m.id} className="hiring-record"><strong>{m.subject}</strong><p className="whitespace-pre-wrap break-words">{m.body}</p>{m.calendar_attached&&<p>{t('Calendar invitation attached','دعوة تقويم مرفقة')}</p>}<p>{hiringLabel(m.status,isRtl)} {m.failure_code}</p>{m.status === 'draft' && <button disabled={busy} className="stanza-interactive-control" onClick={async () => { if (!window.confirm(t('Send this reviewed candidate message?', 'إرسال رسالة المرشح بعد مراجعتها؟')))
        return; setBusy(true); try {
        const r = await apiFetch('/api/communications/messages/' + m.id + '/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const d = await r.json();
        if (!r.ok)
            throw Error(d.error);
        reload();
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setBusy(false);
    } }}>{t('Review & send', 'مراجعة وإرسال')}</button>}</article>)}
 </details><h4 className="hiring-section-heading">{t('Offers / revisions','العروض / الإصدارات')}</h4>{!data.offers.length&&<p className="hiring-secondary">{t('No offers yet.','لا توجد عروض بعد.')}</p>}
 {data.offers.map((o: any) => <article key={o.id} className="hiring-record hiring-offer space-y-2"><header className="hiring-record-heading"><strong>{t('Offer version','إصدار العرض')} {o.version}</strong><span className="hiring-status">{hiringLabel(o.effective_status,isRtl)}</span></header><p className="hiring-secondary">{o.effective_status==='superseded'?t('Historical revision · previous link invalidated','إصدار سابق · الرابط السابق ملغى'):t('Authoritative offer terms for this revision','شروط العرض الرسمية لهذا الإصدار')}</p><OfferRevisionControls id={id} offer={o} caps={caps} onChanged={reload}/><p>{o.salary} {o.currency} · {hiringLabel(o.effective_status,isRtl)} · {String(o.start_date).slice(0, 10)}</p><p>{t('Expires','ينتهي')}: {String(o.expires_on).slice(0,10)}</p><p className="whitespace-pre-wrap break-words">{o.notes}</p><div className="flex flex-wrap gap-2">{(o.effective_status === 'draft' ? ['sent'] : o.effective_status === 'sent' ? ['accepted', 'rejected'] : []).map(status => <button className="stanza-interactive-control" key={status} onClick={() => { setOffer(o.id); setMode(status); }}>{status === 'sent' ? t('Record confirmed delivery', 'تسجيل التسليم المؤكد') : status === 'accepted' ? t('Record acceptance', 'تسجيل القبول') : t('Record rejection', 'تسجيل الرفض')}</button>)}{['draft', 'sent'].includes(o.effective_status) && <button disabled={busy} className="stanza-interactive-control" onClick={() => void mutate('/offers/' + o.id + '/status', { status: 'withdrawn' })}>{t('Withdraw', 'سحب العرض')}</button>}{o.effective_status === 'accepted' && caps.hire && !data.employeeId && <button className="stanza-interactive-control hiring-primary" onClick={() => setMode('hire')}>{t('Confirm hire', 'تأكيد التعيين')}</button>}</div></article>)}
 {data.offers.some((o:any)=>o.effective_status==='accepted')&&!data.employeeId&&<p className="hiring-hire-summary">{t('Offer accepted · employee not created yet. Confirm hire to begin onboarding.','العرض مقبول · لم يُنشأ الموظف بعد. أكد التعيين لبدء التهيئة.')}</p>}
 {data.employeeId && <article className="hiring-record hiring-hired"><h4>{t('Employee created · onboarding started','تم إنشاء الموظف · بدأت التهيئة')}</h4><p>{t('Employee created. Use employee management to review the profile, reset access and assign roles; equipment, roster and badge actions require their own permissions.', 'تم إنشاء الموظف. راجع الملف والوصول والأدوار من إدارة الموظفين؛ العهدة والدوام والبطاقة تتطلب صلاحياتها.')} </p><div className="flex flex-wrap gap-2 my-3">{caps.people && <button className="stanza-interactive-control" onClick={() => onNavigate?.('organisation')}>{t('Open employee management', 'فتح إدارة الموظفين')}</button>}{caps.equipment && <button className="stanza-interactive-control" onClick={() => onNavigate?.('assets')}>{t('Arrange equipment', 'تجهيز المعدات')}</button>}{caps.roster && <button className="stanza-interactive-control" onClick={() => onNavigate?.('roster')}>{t('Plan first shift', 'تخطيط أول مناوبة')}</button>}{caps.people && caps.roles && <button className="stanza-interactive-control" onClick={() => onNavigate?.('organisation')}>{t('Review role access', 'مراجعة صلاحيات الدور')}</button>}</div>{caps.onboarding_view&&<details><summary>{t('Candidate onboarding checklist','قائمة تهيئة المرشح')}</summary><OnboardingChecklist employeeId={data.employeeId}/></details>} </article>}
 {mode==='hire'&&<p className="hiring-hire-summary">{t('An accepted offer records the candidate’s decision. Confirming hire creates the employee and starts onboarding.','العرض المقبول يسجل قرار المرشح. تأكيد التعيين ينشئ الموظف ويبدأ التهيئة.')}</p>}
 {mode && <WorkflowForm intro={mode==='hire'?<div className="hiring-hire-summary"><strong>{t('Confirm employee creation','تأكيد إنشاء الموظف')}</strong>{data.offers.filter((o:any)=>o.effective_status==='accepted').map((o:any)=><p key={o.id}>{o.terms?.title} · {o.salary} {o.currency} · {String(o.start_date).slice(0,10)}</p>)}<p>{t('Acceptance is recorded. Saving creates the employee and onboarding checklist.','تم تسجيل القبول. الحفظ ينشئ الموظف وقائمة التهيئة.')}</p></div>:undefined} title={t('Hiring action — review before saving', 'إجراء توظيف — راجع قبل الحفظ')} fields={fields[mode]} onClose={() => setMode('')} onSave={async (values) => { if (mode === 'hire') {
        if (values.confirmation !== 'HIRE')
            throw Error(t('Type HIRE to confirm.', 'اكتب HIRE للتأكيد.'));
        await hiringRequest('/applicants/' + id + '/hire', { confirmed: true });
    }
    else if (mode === 'interview') {
        await hiringRequest('/applicants/' + id + '/interviews', { ...values, startsAt: new Date(values.startsAt).toISOString(), endsAt: new Date(values.endsAt).toISOString(), attendeeIds: values.interviewerId.split(',').filter(Boolean) });
    }
    else if (mode === 'evaluation')
        await hiringRequest('/interviews/' + interview + '/evaluations', values);
    else if (['sent', 'accepted', 'rejected'].includes(mode))
        await hiringRequest('/offers/' + offer + '/status', { ...values, status: mode, confirmed: true });
    else
        await hiringRequest('/applicants/' + id + '/' + (mode === 'offer' ? 'offers' : 'message'), values); reload(); }}/>}
 </section>;
}
