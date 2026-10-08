import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { useLanguage } from '../../lib/LanguageContext';
import { ComposerDialog } from '../workspace-composer/ComposerDialog';
import { Surface } from '../ui/Surface';
import {hiringRequest} from '../../api/hiring-workflow';
import {QuestionEditor,CandidateDepth,OnboardingChecklist} from './HiringDepth';
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
export function WorkflowForm({ title, fields, onSave, onClose }: {
    title: string;
    fields: Field[];
    onSave: (values: Record<string, string>) => Promise<void>;
    onClose: () => void;
}) {
    const { isRtl } = useLanguage(), [busy, setBusy] = useState(false), [error, setError] = useState('');
    return <ComposerDialog title={title} onClose={() => { if (!busy)
        onClose(); }}><form className="stanza-support-form" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); setBusy(true); setError(''); try {
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
    } }}>{fields.map(f => <label key={f.key}>{isRtl ? f.ar : f.en}{f.options ? <select aria-label={isRtl ? f.ar : f.en} className="stanza-form-control" name={f.key} multiple={f.multiple} size={f.multiple ? 5 : undefined} required={f.required} disabled={busy}><option value="">{isRtl ? 'اختر…' : 'Choose…'}</option>{f.options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select> : f.type === 'textarea' ? <textarea className="stanza-form-control" name={f.key} required={f.required} maxLength={f.max || 4000} rows={4} disabled={busy}/> : <input className="stanza-form-control" name={f.key} type={f.type || 'text'} required={f.required} maxLength={f.max || 200} disabled={busy}/>}</label>)}{error && <p role="alert">{error}</p>}<button className="stanza-interactive-control" type="submit" disabled={busy}>{busy ? (isRtl ? 'جار الحفظ…' : 'Saving…') : (isRtl ? 'مراجعة وحفظ' : 'Review and save')}</button></form></ComposerDialog>;
}
export function JobOpenings() {
    const { isRtl } = useLanguage(), t = (en: string, ar: string) => isRtl ? ar : en;
    const [jobs, setJobs] = useState<any[]>([]), [page, setPage] = useState(1), [total, setTotal] = useState(0), [error, setError] = useState(''), [open, setOpen] = useState(false), [options, setOptions] = useState<any>({}), [can, setCan] = useState(false), [refresh, setRefresh] = useState(0), [busy, setBusy] = useState(false),[questionJob,setQuestionJob]=useState<any>(null);
    useEffect(() => { let live = true; Promise.all([hiringRequest('/jobs?page=' + page), hiringRequest('/workflow-capabilities')]).then(([d, c]) => { if (live) {
        setJobs(d.jobs);
        setTotal(d.total);
        setCan(c.capabilities.manage_jobs);
    } }).catch(e => { if (live)
        setError(e.message); }); return () => { live = false; }; }, [page, refresh]);
    const action = async (id: string, status: string) => { setBusy(true); setError(''); try {
        await hiringRequest('/jobs/' + id + '/status', { status });
        setRefresh(v => v + 1);
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setBusy(false);
    } };
    return <section dir={isRtl ? 'rtl' : 'ltr'} className="space-y-3 mb-5"><header className="flex flex-wrap gap-3 items-center justify-between"><h3 className="text-lg font-bold">{t('Job openings', 'الوظائف المتاحة')}</h3>{can && <button className="stanza-interactive-control" onClick={async () => { try {
        setOptions(await hiringRequest('/job-options'));
        setOpen(true);
    }
    catch (e) {
        setError((e as Error).message);
    } }}>{t('Create job', 'إنشاء وظيفة')}</button>}</header>{error && <p role="alert">{error}</p>}{jobs.map(j => <Surface key={j.id} className="p-3 space-y-2"><strong>{j.title}</strong><p>{j.department} · {j.status} · {t('Headcount', 'عدد الوظائف')}: {j.headcount}</p>{j.status === 'open' && <a className="underline break-all" href={'/careers/' + j.public_token} target="_blank" rel="noreferrer">{t('Open public application page', 'فتح صفحة التقديم العامة')}</a>}{can && <button className="stanza-interactive-control" onClick={()=>setQuestionJob(j)}>{t('Application questions','أسئلة التقديم')}</button>}{can && <div className="flex flex-wrap gap-2">{['open', 'paused', 'closed'].filter(s => s !== j.status).map(s => <button disabled={busy} className="stanza-interactive-control" key={s} onClick={() => void action(j.id, s)}>{s === 'open' ? t('Publish', 'نشر') : s === 'paused' ? t('Pause', 'إيقاف مؤقت') : t('Close', 'إغلاق')}</button>)}</div>}</Surface>)}<p>{total} {t('jobs', 'وظيفة')}</p><div className="flex gap-2"><button className="stanza-interactive-control" disabled={page === 1} onClick={() => setPage(v => v - 1)}>{t('Previous', 'السابق')}</button><button className="stanza-interactive-control" disabled={page * 20 >= total} onClick={() => setPage(v => v + 1)}>{t('Next', 'التالي')}</button></div>{questionJob&&<QuestionEditor job={questionJob} onClose={()=>setQuestionJob(null)} onSaved={()=>setRefresh(v=>v+1)}/>} {open && <WorkflowForm title={t('Create draft job', 'إنشاء مسودة وظيفة')} onClose={() => setOpen(false)} onSave={async (values) => { await hiringRequest('/jobs', values); setRefresh(v => v + 1); }} fields={[{ key: 'title', en: 'Title', ar: 'المسمى', required: true, max: 160 }, { key: 'description', en: 'Description', ar: 'الوصف', type: 'textarea', required: true, max: 12000 }, { key: 'requirements', en: 'Requirements', ar: 'المتطلبات', type: 'textarea', max: 12000 }, { key: 'departmentId', en: 'Department', ar: 'القسم', options: options.departments }, { key: 'locationId', en: 'Location', ar: 'الموقع', options: options.locations }, { key: 'managerId', en: 'Hiring manager', ar: 'مدير التوظيف', options: options.employees }, { key: 'ownerId', en: 'Recruiter / owner', ar: 'مسؤول التوظيف', options: options.employees }, { key: 'employmentType', en: 'Employment type', ar: 'نوع العمل', options: ['full_time', 'part_time', 'contract', 'internship'].map(id => ({ id, name: id.replaceAll('_', ' ') })) }, { key: 'headcount', en: 'Headcount', ar: 'عدد الوظائف', type: 'number' }, { key: 'opensOn', en: 'Opening date', ar: 'تاريخ الافتتاح', type: 'date' }, { key: 'closesOn', en: 'Closing date', ar: 'تاريخ الإغلاق', type: 'date' }]}/>}</section>;
}
export function CandidateWorkflow({ id, onChanged, onNavigate }: {
    id: string;
    onChanged: () => void;
    onNavigate?: (target: 'organisation' | 'assets' | 'roster') => void;
}) {
    const { isRtl } = useLanguage(), t = (en: string, ar: string) => isRtl ? ar : en;
    const [data, setData] = useState<any>(null), [caps, setCaps] = useState<any>({}), [error, setError] = useState(''), [mode, setMode] = useState(''), [refresh, setRefresh] = useState(0), [interview, setInterview] = useState(''), [offer, setOffer] = useState(''), [busy, setBusy] = useState(false), [people, setPeople] = useState<any[]>([]);
    useEffect(() => { let live = true; setData(null); Promise.all([hiringRequest('/applicants/' + id + '/workflow'), hiringRequest('/workflow-capabilities')]).then(([d, c]) => { if (live) {
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
        evaluation: [{ key: 'recommendation', en: 'Recommendation', ar: 'التوصية', required: true, options: ['strong_yes', 'yes', 'no', 'strong_no'].map(id => ({ id, name: id.replaceAll('_', ' ') })) }, { key: 'score', en: 'Score (1–5)', ar: 'التقييم (١–٥)', type: 'number', required: true }, { key: 'strengths', en: 'Strengths', ar: 'نقاط القوة', type: 'textarea', max: 2000 }, { key: 'concerns', en: 'Concerns', ar: 'المخاوف', type: 'textarea', max: 2000 }, { key: 'notes', en: 'Private feedback', ar: 'ملاحظات خاصة', type: 'textarea' }],
        message: [{ key: 'subject', en: 'Subject', ar: 'العنوان', required: true }, { key: 'body', en: 'Candidate message', ar: 'رسالة المرشح', type: 'textarea', required: true }],
        offer: [{ key: 'salary', en: 'Compensation amount', ar: 'مبلغ التعويض', required: true }, { key: 'currency', en: 'Currency (ISO code)', ar: 'العملة (رمز ISO)', required: true, max: 3 }, { key: 'startDate', en: 'Start date', ar: 'تاريخ البداية', type: 'date', required: true }, { key: 'expiresOn', en: 'Expiry', ar: 'انتهاء العرض', type: 'date', required: true }, { key: 'notes', en: 'Offer notes', ar: 'ملاحظات العرض', type: 'textarea' }],
        sent: [{ key: 'messageId', en: 'Delivered candidate message', ar: 'رسالة المرشح المُسلّمة', options: data.messages.filter((m: any) => m.status === 'sent').map((m: any) => ({ id: m.id, name: m.subject })), required: true }],
        accepted: [{ key: 'responseNote', en: 'Verified candidate acceptance (record source/date)', ar: 'قبول المرشح المؤكد (المصدر والتاريخ)', type: 'textarea', required: true }],
        rejected: [{ key: 'responseNote', en: 'Verified candidate rejection (record source/date)', ar: 'رفض المرشح المؤكد (المصدر والتاريخ)', type: 'textarea', required: true }],
        hire: [{ key: 'confirmation', en: 'Type HIRE to confirm employee creation', ar: 'اكتب HIRE لتأكيد إنشاء الموظف', required: true }]
    };
    return <section className="mt-5 space-y-3"><h4 className="font-bold">{t('Interviews, offers & onboarding', 'المقابلات والعروض وتهيئة الموظف')}</h4>{error && <p role="alert">{error}</p>}<CandidateDepth id={id} data={data} caps={caps} onChanged={reload}/>{data.coverNote && <p className="whitespace-pre-wrap">{data.coverNote}</p>}{data.resumeAvailable && <a className="underline" href={'/api/hiring/applicants/' + id + '/resume'}>{t('Download private resume', 'تنزيل السيرة الذاتية الخاصة')}</a>}<div className="flex flex-wrap gap-2">{caps.schedule_interviews && <button className="stanza-interactive-control" onClick={async () => { try {
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
 {data.interviews.map((i: any) => <Surface key={i.id} className="p-3">{caps.send&&caps.schedule_interviews&&<button className="stanza-interactive-control" disabled={busy} onClick={()=>void mutate('/interviews/'+i.id+'/invitation',{})}>{t('Draft candidate calendar invitation','إعداد مسودة دعوة تقويم للمرشح')}</button>}<strong>{i.title}</strong><p>{new Date(i.starts_at).toLocaleString(isRtl ? 'ar' : 'en')} · {i.location} · {i.status}</p>{caps.evaluate && <button className="stanza-interactive-control" onClick={() => { setInterview(i.id); setMode('evaluation'); }}>{t('Submit feedback', 'إرسال التقييم')}</button>}<p>{t('Meeting details, ICS and invitations are available in Communications.', 'تفاصيل الاجتماع وملف ICS والدعوات متاحة في المراسلات.')}</p></Surface>)}
 {data.evaluations.map((v: any) => <Surface key={v.id} className="p-3"><p>{v.author_name} · {v.recommendation} · {v.score}/5</p><p className="whitespace-pre-wrap">{v.strengths}</p><p className="whitespace-pre-wrap">{v.concerns}</p><p className="whitespace-pre-wrap">{v.notes}</p></Surface>)}
 {data.messages.map((m: any) => <Surface key={m.id} className="p-3"><strong>{m.subject}</strong><p className="whitespace-pre-wrap break-words">{m.body}</p>{m.calendar_attached&&<p>{t('Calendar invitation attached','دعوة تقويم مرفقة')}</p>}<p>{m.status} {m.failure_code}</p>{m.status === 'draft' && <button disabled={busy} className="stanza-interactive-control" onClick={async () => { if (!window.confirm(t('Send this reviewed candidate message?', 'إرسال رسالة المرشح بعد مراجعتها؟')))
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
    } }}>{t('Review & send', 'مراجعة وإرسال')}</button>}</Surface>)}
 {data.offers.map((o: any) => <Surface key={o.id} className="p-3 space-y-2"><p>{o.salary} {o.currency} · {o.effective_status} · {String(o.start_date).slice(0, 10)}</p><p>{t('Expires','ينتهي')}: {String(o.expires_on).slice(0,10)}</p><p className="whitespace-pre-wrap break-words">{o.notes}</p><div className="flex flex-wrap gap-2">{(o.effective_status === 'draft' ? ['sent'] : o.effective_status === 'sent' ? ['accepted', 'rejected'] : []).map(status => <button className="stanza-interactive-control" key={status} onClick={() => { setOffer(o.id); setMode(status); }}>{status === 'sent' ? t('Record confirmed delivery', 'تسجيل التسليم المؤكد') : status === 'accepted' ? t('Record acceptance', 'تسجيل القبول') : t('Record rejection', 'تسجيل الرفض')}</button>)}{['draft', 'sent'].includes(o.effective_status) && <button disabled={busy} className="stanza-interactive-control" onClick={() => void mutate('/offers/' + o.id + '/status', { status: 'withdrawn' })}>{t('Withdraw', 'سحب العرض')}</button>}{o.effective_status === 'accepted' && caps.hire && !data.employeeId && <button className="stanza-interactive-control" onClick={() => setMode('hire')}>{t('Confirm hire', 'تأكيد التعيين')}</button>}</div></Surface>)}
 {data.employeeId && <Surface className="p-3"><p>{t('Employee created. Use employee management to review the profile, reset access and assign roles; equipment, roster and badge actions require their own permissions.', 'تم إنشاء الموظف. راجع الملف والوصول والأدوار من إدارة الموظفين؛ العهدة والدوام والبطاقة تتطلب صلاحياتها.')} <span dir="ltr">{data.employeeId}</span></p><div className="flex flex-wrap gap-2 my-3">{caps.people && <button className="stanza-interactive-control" onClick={() => onNavigate?.('organisation')}>{t('Open employee management', 'فتح إدارة الموظفين')}</button>}{caps.equipment && <button className="stanza-interactive-control" onClick={() => onNavigate?.('assets')}>{t('Arrange equipment', 'تجهيز المعدات')}</button>}{caps.roster && <button className="stanza-interactive-control" onClick={() => onNavigate?.('roster')}>{t('Plan first shift', 'تخطيط أول مناوبة')}</button>}{caps.people && caps.roles && <button className="stanza-interactive-control" onClick={() => onNavigate?.('organisation')}>{t('Review role access', 'مراجعة صلاحيات الدور')}</button>}</div>{caps.onboarding_view&&<OnboardingChecklist employeeId={data.employeeId}/>} </Surface>}
 {mode && <WorkflowForm title={t('Hiring action — review before saving', 'إجراء توظيف — راجع قبل الحفظ')} fields={fields[mode]} onClose={() => setMode('')} onSave={async (values) => { if (mode === 'hire') {
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
