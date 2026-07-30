import { useEffect, useState } from 'react';
import { BadgeCheck, Building2, CircleAlert, ShieldCheck } from 'lucide-react';
import { apiUrl } from '../lib/api';
import { useLanguage } from '../lib/LanguageContext';

type Verification = {
  verified: boolean;
  status: 'active' | 'inactive';
  employeeDisplayName?: string;
  companyName?: string;
  jobTitle?: string;
  departmentName?: string;
  issuedByCompany?: true;
  verifiedAt?: string;
  badgeLastUpdatedAt?: string;
};

export function PublicEmployeeVerification({ token }: { token: string }) {
  const { t, lang } = useLanguage();
  const [verification, setVerification] = useState<Verification | null>(null);
  const [state, setState] = useState<'loading' | 'invalid' | 'ready'>('loading');

  useEffect(() => {
    document.title = t('badge.publicTitle');
    const controller = new AbortController();
    void fetch(apiUrl(`/api/public/verify/employee/${token}`), { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json().catch(() => ({})) as Verification & { success?: boolean };
        if (!response.ok || !data.success || (data.status !== 'active' && data.status !== 'inactive')) throw new Error('unavailable');
        setVerification(data);
        setState('ready');
      })
      .catch(() => {
        if (!controller.signal.aborted) setState('invalid');
      });
    return () => controller.abort();
  }, [t, token]);

  const locale = lang === 'ar' ? 'ar-EG' : 'en-US';
  const time = verification?.verifiedAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(verification.verifiedAt))
    : null;

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[#020f0a] px-4 py-[calc(env(safe-area-inset-top)+1.5rem)] text-emerald-50">
      <section className="w-full max-w-md rounded-2xl border border-emerald-400/20 bg-[#061411]/95 p-6 shadow-2xl shadow-black/45" aria-live="polite">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-400/30 bg-emerald-400/10 text-emerald-300"><ShieldCheck aria-hidden="true" /></span>
          <div>
            <p className="text-sm font-black tracking-wide text-emerald-100">Stanza</p>
            <p className="text-xs text-emerald-100/60">{t('badge.publicLiveCheck')}</p>
          </div>
        </div>

        {state === 'loading' && <div className="mt-8 min-h-36 animate-pulse rounded-xl bg-emerald-500/10" aria-label={t('badge.loading')} />}

        {state === 'invalid' && (
          <div className="mt-8 text-center">
            <CircleAlert className="mx-auto h-12 w-12 text-amber-300" aria-hidden="true" />
            <h1 className="mt-4 text-xl font-black">{t('badge.couldNotVerify')}</h1>
            <p className="mt-2 text-sm leading-6 text-emerald-100/65">{t('badge.invalidHelp')}</p>
          </div>
        )}

        {state === 'ready' && verification?.status === 'active' && (
          <div className="mt-8 text-center">
            <BadgeCheck className="mx-auto h-14 w-14 text-emerald-300" aria-hidden="true" />
            <p className="mt-4 text-xs font-black uppercase tracking-[0.2em] text-emerald-300">{t('badge.verifiedEmployee')}</p>
            <h1 className="mt-2 text-2xl font-black text-white">{verification.employeeDisplayName}</h1>
            <div className="mt-3 space-y-1 text-sm text-emerald-100/70">
              {verification.jobTitle && <p>{verification.jobTitle}</p>}
              {verification.departmentName && <p>{verification.departmentName}</p>}
            </div>
            <div className="mt-6 rounded-xl border border-emerald-400/15 bg-black/20 p-3 text-sm text-emerald-100/80">
              <span className="inline-flex items-center gap-2"><Building2 className="h-4 w-4 text-emerald-300" aria-hidden="true" />{verification.companyName}</span>
            </div>
            {time && <p className="mt-5 text-xs text-emerald-100/50">{t('badge.checkedLive')} <span dir="ltr">{time}</span></p>}
          </div>
        )}

        {state === 'ready' && verification?.status === 'inactive' && (
          <div className="mt-8 text-center">
            <CircleAlert className="mx-auto h-12 w-12 text-amber-300" aria-hidden="true" />
            <h1 className="mt-4 text-xl font-black">{t('badge.inactiveEmployee')}</h1>
            {verification.companyName && <p className="mt-3 text-sm text-emerald-100/65">{verification.companyName}</p>}
          </div>
        )}
      </section>
    </main>
  );
}
