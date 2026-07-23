import { useCallback, useEffect, useState } from 'react';
import { Laptop, LoaderCircle, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { cn } from '../../lib/utils';
import { useLanguage } from '../../lib/LanguageContext';

type SessionRecord = {
  id: string;
  isCurrent: boolean;
  deviceLabel: string;
  ipMasked: string;
  locationLabel: string;
  createdAt: string;
  lastActiveAt?: string | null;
  expiresAt: string;
  status: 'active' | 'revoked' | 'expired';
};

const formatDate = (value: string | null | undefined, locale: string) => value
  ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : '-';

export function SessionManagementPanel() {
  const { t, lang: language, isRtl } = useLanguage();
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<'others' | string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await apiFetch('/api/auth/sessions');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.message || 'Unable to load sessions.');
      setSessions(Array.isArray(data.sessions) ? data.sessions : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load sessions.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const revoke = async (path: string, confirmation: 'others' | string) => {
    setPending(confirmation); setError('');
    try {
      const response = await apiFetch(path, { method: confirmation === 'others' ? 'POST' : 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.message || 'Unable to revoke session.');
      setConfirming(null);
      await load();
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : 'Unable to revoke session.');
    } finally { setPending(null); }
  };

  const activeRemoteSessions = sessions.filter((session) => session.status === 'active' && !session.isCurrent);
  return (
    <section className="mt-5 border-t border-emerald-500/15 pt-5" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-emerald-50"><ShieldCheck className="h-4 w-4 text-emerald-500" />{t('sessions.title')}</h3><p className="mt-1 text-xs text-slate-500 dark:text-emerald-100/50">{t('sessions.subtitle')}</p></div>
        <div className="flex gap-2"><button type="button" onClick={() => void load()} className="rounded-md border border-emerald-500/20 p-2 text-emerald-600 hover:bg-emerald-500/10" aria-label={t('sessions.retry')}><RefreshCw className="h-4 w-4" /></button>{activeRemoteSessions.length > 0 && <button type="button" onClick={() => setConfirming('others')} className="rounded-md border border-amber-500/30 px-3 py-2 text-xs font-bold text-amber-700 hover:bg-amber-500/10 dark:text-amber-300">{t('sessions.revokeOthers')}</button>}</div>
      </div>
      {error && <div className="mt-3 rounded-md border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-200">{error}</div>}
      {confirming && <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-slate-700 dark:text-emerald-50"><span>{t('sessions.revokeConfirm')}</span><button type="button" onClick={() => void revoke(confirming === 'others' ? '/api/auth/sessions/revoke-others' : `/api/auth/sessions/${confirming}`, confirming)} className="rounded bg-red-600 px-2 py-1 font-bold text-white">{pending === confirming ? <LoaderCircle className="h-3 w-3 animate-spin" /> : t('sessions.revoke')}</button><button type="button" onClick={() => setConfirming(null)} className="rounded border border-emerald-500/20 px-2 py-1">{t('sessions.cancel')}</button></div>}
      {loading ? <div className="flex min-h-24 items-center justify-center"><LoaderCircle className="h-5 w-5 animate-spin text-emerald-500" /></div> : sessions.length === 0 ? <p className="py-6 text-center text-xs text-slate-500 dark:text-emerald-100/50">{t('sessions.empty')}</p> : <>
        <div className="mt-4 hidden overflow-x-auto md:block"><table className="w-full text-left text-xs"><thead className="text-slate-500 dark:text-emerald-100/45"><tr><th className="pb-2">{t('sessions.device')}</th><th className="pb-2">{t('sessions.network')}</th><th className="pb-2">{t('sessions.lastActive')}</th><th className="pb-2">{t('sessions.status')}</th><th /></tr></thead><tbody>{sessions.map((session) => <tr key={session.id} className="border-t border-emerald-500/10"><td className="py-3 font-medium"><span className="flex items-center gap-2"><Laptop className="h-3.5 w-3.5 text-emerald-500" />{session.deviceLabel}{session.isCurrent && <em className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] not-italic text-emerald-700 dark:text-emerald-300">{t('sessions.current')}</em>}</span></td><td className="py-3">{session.ipMasked}</td><td className="py-3">{formatDate(session.lastActiveAt || session.createdAt, language === 'ar' ? 'ar-EG' : 'en-US')}</td><td className="py-3 capitalize">{t(`sessions.${session.status}` as 'sessions.active')}</td><td className="py-3 text-end">{!session.isCurrent && session.status === 'active' && <button type="button" onClick={() => setConfirming(session.id)} className="text-red-600 hover:underline dark:text-red-300">{t('sessions.revoke')}</button>}</td></tr>)}</tbody></table></div>
        <div className="mt-4 space-y-2 md:hidden">{sessions.map((session) => <article key={session.id} className="border border-emerald-500/15 bg-black/5 p-3 dark:bg-black/20"><div className="flex justify-between gap-2"><strong className="text-xs text-slate-900 dark:text-emerald-50">{session.deviceLabel}</strong><span className="text-[10px] text-emerald-600 dark:text-emerald-300">{session.isCurrent ? t('sessions.current') : t(`sessions.${session.status}` as 'sessions.active')}</span></div><p className="mt-1 text-[11px] text-slate-500 dark:text-emerald-100/50">{session.ipMasked} · {formatDate(session.lastActiveAt || session.createdAt, language === 'ar' ? 'ar-EG' : 'en-US')}</p>{!session.isCurrent && session.status === 'active' && <button type="button" onClick={() => setConfirming(session.id)} className="mt-2 flex items-center gap-1 text-xs text-red-600 dark:text-red-300"><Trash2 className="h-3 w-3" />{t('sessions.revoke')}</button>}</article>)}</div>
      </>}
    </section>
  );
}
