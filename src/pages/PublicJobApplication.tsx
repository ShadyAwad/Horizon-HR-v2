import {QuestionInputs,collectAnswers} from '../components/hiring/HiringDepth';
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { useLanguage } from '../lib/LanguageContext';
export default function PublicJobApplication({ token }: {
    token: string;
}) {
    const { isRtl } = useLanguage(), t = (en: string, ar: string) => isRtl ? ar : en;
    const [job, setJob] = useState<any>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [done, setDone] = useState(false);
    useEffect(() => { const abort = new AbortController(); apiFetch('/api/public/jobs/' + token, { signal: abort.signal, cache: 'no-store' }).then(async (r) => { const d = await r.json(); if (!r.ok)
        throw Error(d.error); setJob(d.job); }).catch(e => { if (!abort.signal.aborted)
        setError(e.message); }); return () => abort.abort(); }, [token]);
    return <main dir={isRtl ? 'rtl' : 'ltr'} className="mx-auto max-w-2xl p-5 space-y-4"><h1 className="text-2xl font-bold">{job?.company_name || 'Stanza'}</h1>{error && <p role="alert">{error}</p>}{job && <><h2 className="text-xl font-bold">{job.title}</h2><p>{job.department} · {job.location} · {job.employment_type}</p><p className="whitespace-pre-wrap break-words">{job.description}</p><h3 className="font-bold">{t('Requirements', 'المتطلبات')}</h3><p className="whitespace-pre-wrap break-words">{job.requirements}</p>{done ? <p role="status">{t('Application received. Thank you.', 'تم استلام طلبك. شكراً لك.')}</p> : <form className="stanza-support-form" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setError(''); try {
        const f = new FormData(e.currentTarget);collectAnswers(f,job.questions||[]);
        const r = await apiFetch('/api/public/jobs/' + token + '/apply', { method: 'POST', body: f });
        const d = await r.json();
        if (!r.ok)
            throw Error(d.error);
        setDone(true);
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setBusy(false);
    } }}>{[['fullName', t('Full name', 'الاسم الكامل'), 'text', 160], ['email', t('Email', 'البريد الإلكتروني'), 'email', 254], ['phone', t('Phone (optional)', 'الهاتف (اختياري)'), 'tel', 40]].map(([name, label, type, max]) => <label key={name}>{label}<input className="stanza-form-control" name={String(name)} type={String(type)} maxLength={Number(max)} required={name !== 'phone'} disabled={busy}/></label>)}<QuestionInputs questions={job.questions||[]} disabled={busy}/><label>{t('Cover note', 'رسالة التقديم')}<textarea className="stanza-form-control" name="coverNote" maxLength={4000} rows={5} disabled={busy}/></label><label>{t('Resume: PDF, up to 6 MB, maximum 50 pages', 'السيرة الذاتية: PDF، حتى ٦ ميجابايت، بحد أقصى ٥٠ صفحة')}<input className="stanza-form-control" name="resume" type="file" accept="application/pdf" required disabled={busy}/></label><label><input type="checkbox" name="consent" value="true" required disabled={busy}/>{t('I consent to this company storing and reviewing my application for recruitment. My resume and details are visible only to its authorized hiring team. Contact the company for retention or deletion requests.', 'أوافق على حفظ الشركة لطلبي ومراجعته للتوظيف. لا يرى السيرة والبيانات إلا فريق التوظيف المصرح له. تواصل مع الشركة لطلبات الاحتفاظ أو الحذف.')}</label><button className="stanza-interactive-control" disabled={busy} type="submit">{busy ? t('Submitting…', 'جار الإرسال…') : t('Submit application', 'إرسال الطلب')}</button></form>}</>}</main>;
}
