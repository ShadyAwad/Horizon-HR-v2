import { useEffect, useState } from 'react';
import { BadgeCheck, Building2, CircleAlert, ShieldCheck } from 'lucide-react';
import { apiUrl } from '../lib/api';
import { useLanguage } from '../lib/LanguageContext';

type Verification = { verified: boolean; status: 'active' | 'lost' | 'inactive'; companyName?: string; publicAssetLabel?: string; assetType?: string; manufacturerModel?: string; broadStatus?: string; verifiedAt?: string };

export function PublicAssetVerification({ token }: { token: string }) {
  const { t, lang } = useLanguage();
  const [verification, setVerification] = useState<Verification | null>(null);
  const [state, setState] = useState<'loading' | 'invalid' | 'ready'>('loading');
  useEffect(() => {
    document.title = t('assetQr.publicTitle' as never);
    const controller = new AbortController();
    void fetch(apiUrl(`/api/public/verify/asset/${token}`), { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => ({})) as Verification & { success?: boolean };
        if (!response.ok || !data.success || !['active', 'lost', 'inactive'].includes(data.status)) throw new Error('unavailable');
        setVerification(data); setState('ready');
      }).catch(() => { if (!controller.signal.aborted) setState('invalid'); });
    return () => controller.abort();
  }, [t, token]);
  const checked = verification?.verifiedAt ? new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(verification.verifiedAt)) : null;
  const message = state === 'invalid' ? 'assetQr.invalid' : verification?.status === 'lost' ? 'assetQr.lost' : verification?.status === 'inactive' ? 'assetQr.inactive' : 'assetQr.verified';
  return <main className="flex min-h-[100dvh] items-center justify-center bg-[#020f0a] px-4 py-[calc(env(safe-area-inset-top)+1.5rem)] text-emerald-50">
    <section className="w-full max-w-md rounded-2xl border border-emerald-400/20 bg-[#061411]/95 p-6 shadow-2xl shadow-black/45" aria-live="polite">
      <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-400/30 bg-emerald-400/10 text-emerald-300"><ShieldCheck aria-hidden="true" /></span><div><p className="text-sm font-black tracking-wide text-emerald-100">Stanza</p><p className="text-xs text-emerald-100/60">{t('assetQr.publicLiveCheck' as never)}</p></div></div>
      {state === 'loading' && <div className="mt-8 min-h-36 animate-pulse rounded-xl bg-emerald-500/10" />}
      {state !== 'loading' && <div className="mt-8 text-center"><>{state === 'ready' && verification?.status === 'active' ? <BadgeCheck className="mx-auto h-14 w-14 text-emerald-300" /> : <CircleAlert className="mx-auto h-12 w-12 text-amber-300" />}</><h1 className="mt-4 text-xl font-black">{t(message as never)}</h1>{state === 'ready' && verification?.status === 'active' && <><p className="mt-3 text-lg font-bold text-white">{verification.publicAssetLabel}</p><p className="mt-1 text-sm text-emerald-100/70">{[verification.assetType, verification.manufacturerModel].filter(Boolean).join(' · ')}</p></>}{verification?.companyName && <p className="mt-5 inline-flex items-center gap-2 rounded-xl border border-emerald-400/15 bg-black/20 px-3 py-2 text-sm text-emerald-100/80"><Building2 className="h-4 w-4 text-emerald-300" />{verification.companyName}</p>}{checked && <p className="mt-5 text-xs text-emerald-100/50">{t('assetQr.checkedLive' as never)} <span dir="ltr">{checked}</span></p>}<a href="/?returnTo=assets" className="mt-6 inline-flex min-h-11 items-center rounded-lg border border-emerald-400/30 px-4 py-2 text-sm font-bold text-emerald-100 hover:bg-emerald-400/10">{t('assetQr.signIn' as never)}</a></div>}
    </section>
  </main>;
}
