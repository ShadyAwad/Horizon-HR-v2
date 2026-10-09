import {hiringLabel} from '../lib/hiring-presentation';
import { useEffect, useState } from 'react';
import { useLanguage } from '../lib/LanguageContext';
import { apiFetch } from '../lib/api';
export default function PublicOffer({ token }: {
    token: string;
}) { const { isRtl } = useLanguage(), t = (e: string, a: string) => isRtl ? a : e; const [o, setOffer] = useState<any>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [ack, setAck] = useState(false); useEffect(() => { const a = new AbortController(); apiFetch('/api/public/offers/' + token, { signal: a.signal, cache: 'no-store' }).then(async (r) => { const d = await r.json(); if (!r.ok)
    throw Error(d.error); setOffer(d.offer); }).catch(e => { if (!a.signal.aborted)
    setError(e.message); }); return () => a.abort(); }, [token]); return <main dir={isRtl ? 'rtl' : 'ltr'} className="hiring-public mx-auto max-w-2xl p-5 space-y-4"><meta name="referrer" content="no-referrer"/><h1 className="text-2xl font-bold">{t('Confidential employment offer', 'عرض عمل خاص')}</h1>{error && <p role="alert">{error}</p>}{o && <><h2 className="text-xl font-bold">{o.company} · {o.title}</h2><p>{o.candidate} · {t('Version', 'الإصدار')} {o.version}</p><p>{o.department} · {o.location} · {hiringLabel(o.employmentType,isRtl)}</p><p>{t('Compensation', 'التعويض')}: {o.salary} {o.currency}</p><p>{t('Start date', 'تاريخ البداية')}: {o.startDate} · {t('Expiry', 'انتهاء العرض')}: {o.expiresOn}</p><p role="status" className="hiring-status">{hiringLabel(o.status,isRtl)}</p><a className="underline" href={'/api/public/offers/' + token + '/document'}>{t('Download this offer document', 'تنزيل مستند هذا العرض')}</a><p>{t('This link is private. Do not share it. Acceptance records your explicit acknowledgement; it is not a provider-backed digital signature.', 'هذا الرابط خاص فلا تشاركه. القبول يسجل إقرارك الصريح ولا يمثل توقيعاً رقمياً من مزود توقيع.')}</p>{o.status === 'sent' && <><label className="block"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} disabled={busy}/>{t('I reviewed this version and acknowledge my decision.', 'راجعت هذا الإصدار وأقر بقراري.')}</label><div className="flex flex-wrap gap-3">{['accepted', 'rejected'].map(response => <button className="stanza-interactive-control" key={response} disabled={!ack || busy} onClick={async () => { setBusy(true); setError(''); try {
    const r = await apiFetch('/api/public/offers/' + token + '/respond', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: o.version, response, acknowledged: true }) });
    const d = await r.json();
    if (!r.ok)
        throw Error(d.error);
    setOffer((v: any) => ({ ...v, status: d.status }));
}
catch (e) {
    setError((e as Error).message);
}
finally {
    setBusy(false);
} }}>{response === 'accepted' ? t('Accept this offer', 'قبول هذا العرض') : t('Reject this offer', 'رفض هذا العرض')}</button>)}</div></>}</>}</main>; }
