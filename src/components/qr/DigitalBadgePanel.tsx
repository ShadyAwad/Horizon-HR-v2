import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { Copy, QrCode, RefreshCw, ShieldCheck, ShieldOff } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { apiFetch, apiUrl } from '../../lib/api';
import { useLanguage } from '../../lib/LanguageContext';
import { cn } from '../../lib/utils';
import { UserAvatar } from '../UserAvatar';

type Badge = {
  state: 'active' | 'inactive' | 'revoked' | 'not_issued';
  canIssue: boolean;
  canRotate: boolean;
  canRevoke: boolean;
  requiresRotation: boolean;
  verificationUrl: string | null;
  issuedAt: string | null;
  lastUpdatedAt: string | null;
  revokedAt: string | null;
  display: { name: string; companyName: string; jobTitle: string | null; departmentName: string | null; avatarUrl: string | null };
};

type Action = 'issue' | 'rotate' | 'revoke' | null;

export function DigitalBadgePanel({ offline = false }: { offline?: boolean }) {
  const { t, lang } = useLanguage();
  const [badge, setBadge] = useState<Badge | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Action>(null);
  const [message, setMessage] = useState('');
  const [confirmation, setConfirmation] = useState<Action>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiFetch(apiUrl('/api/me/digital-badge'), { cache: 'no-store' });
      const data = await response.json().catch(() => ({})) as { success?: boolean; badge?: Badge; message?: string };
      if (!response.ok || !data.success || !data.badge) throw new Error(data.message || t('badge.loadError'));
      setBadge(data.badge);
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('badge.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { triggerRef.current?.focus(); }, []);

  const mutate = async (action: Exclude<Action, null>) => {
    setBusy(action);
    setMessage('');
    try {
      const response = await apiFetch(apiUrl(`/api/me/digital-badge/${action}`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      const data = await response.json().catch(() => ({})) as { success?: boolean; badge?: Badge; message?: string };
      if (!response.ok || !data.success || !data.badge) throw new Error(data.message || t('badge.actionError'));
      setBadge(data.badge);
      setMessage(action === 'rotate' ? t('badge.rotated') : action === 'revoke' ? t('badge.revoked') : t('badge.issued'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('badge.actionError'));
    } finally {
      setBusy(null);
      setConfirmation(null);
      window.setTimeout(() => triggerRef.current?.focus(), 0);
    }
  };

  const copyLink = async () => {
    if (!badge?.verificationUrl) return;
    try {
      await navigator.clipboard.writeText(badge.verificationUrl);
      setMessage(t('badge.linkCopied'));
    } catch { setMessage(t('badge.copyUnavailable')); }
  };

  const timestamp = badge?.lastUpdatedAt
    ? new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(badge.lastUpdatedAt))
    : null;

  return (
    <section className="rounded-xl border border-emerald-500/15 bg-white/70 p-4 dark:bg-black/35" aria-labelledby="digital-badge-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3"><QrCode className="h-6 w-6 text-emerald-600 dark:text-emerald-400" aria-hidden="true" /><div><h3 id="digital-badge-title" className="text-sm font-black uppercase tracking-widest text-neutral-800 dark:text-emerald-50">{t('badge.title')}</h3><p className="mt-1 text-xs text-neutral-500 dark:text-emerald-100/50">{t('badge.subtitle')}</p></div></div>
        <button type="button" onClick={() => void load()} disabled={loading || busy !== null} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-emerald-500/20 px-3 text-xs font-bold text-emerald-700 hover:border-emerald-400 disabled:opacity-60 dark:text-emerald-300"><RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden="true" />{t('badge.refresh')}</button>
      </div>

      {loading ? <div className="mt-4 min-h-64 animate-pulse rounded-xl bg-emerald-500/5" aria-label={t('badge.loading')} /> : badge ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
          <div className="rounded-xl border border-emerald-500/15 bg-black/[0.025] p-4 dark:bg-black/25">
            <div className="flex items-start gap-3"><UserAvatar name={badge.display.name} imageUrl={badge.display.avatarUrl} className="h-14 w-14" /><div className="min-w-0"><p className="truncate text-lg font-black text-neutral-900 dark:text-emerald-50">{badge.display.name}</p><p className="mt-1 text-sm text-neutral-600 dark:text-emerald-100/65">{badge.display.companyName}</p>{badge.display.jobTitle && <p className="mt-1 text-xs text-neutral-500 dark:text-emerald-100/50">{badge.display.jobTitle}{badge.display.departmentName ? ` · ${badge.display.departmentName}` : ''}</p>}</div></div>
            <div className={cn('mt-4 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-black', badge.state === 'active' ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-200')}><span aria-hidden="true">{badge.state === 'active' ? '●' : '!'}</span>{t(`badge.state.${badge.state}` as const)}</div>
            {timestamp && <p className="mt-3 text-xs text-neutral-500 dark:text-emerald-100/45">{t('badge.lastUpdated')} <span dir="ltr">{timestamp}</span></p>}
            {badge.requiresRotation && <p className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">{t('badge.rotationRequired')}</p>}
            <p className="mt-4 text-xs leading-5 text-neutral-500 dark:text-emerald-100/50">{t('badge.shareSafety')}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {badge.canIssue && <ActionButton action="issue" busy={busy} offline={offline} onClick={(event) => { triggerRef.current = event.currentTarget; setConfirmation('issue'); }} label={t('badge.issue')} />}
              {badge.canRotate && <ActionButton action="rotate" busy={busy} offline={offline} onClick={(event) => { triggerRef.current = event.currentTarget; setConfirmation('rotate'); }} label={t('badge.rotate')} />}
              {badge.canRevoke && <button ref={triggerRef} type="button" disabled={offline || busy !== null} onClick={(event) => { triggerRef.current = event.currentTarget; setConfirmation('revoke'); }} className="min-h-10 rounded-lg border border-red-500/25 px-3 text-xs font-bold text-red-700 hover:border-red-400 disabled:opacity-60 dark:text-red-300">{t('badge.revoke')}</button>}
              {badge.verificationUrl && <button type="button" onClick={() => void copyLink()} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-emerald-500/20 px-3 text-xs font-bold text-emerald-700 hover:border-emerald-400 dark:text-emerald-300"><Copy className="h-4 w-4" aria-hidden="true" />{t('badge.copyLink')}</button>}
            </div>
          </div>
          <div className="flex min-h-[220px] items-center justify-center rounded-xl border border-emerald-500/15 bg-[#f8fffc] p-3 text-center">
            {badge.verificationUrl ? <div><QRCodeSVG value={badge.verificationUrl} size={184} level="M" marginSize={4} bgColor="#ffffff" fgColor="#061411" aria-label={t('badge.qrAlt')} /><p className="mt-3 text-xs font-bold text-[#061411]">{t('badge.scanToVerify')}</p><a href={badge.verificationUrl} className="sr-only">{t('badge.openVerification')}</a></div> : <div className="max-w-[180px] text-xs leading-5 text-neutral-600">{badge.state === 'inactive' ? t('badge.inactiveHelp') : t('badge.noActiveBadge')}</div>}
          </div>
        </div>
      ) : <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-200" role="status">{message || t('badge.loadError')}<button type="button" onClick={() => void load()} className="ms-3 underline">{t('badge.retry')}</button></div>}

      {message && badge && <p className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-200" role="status">{message}</p>}
      {confirmation && <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/10 p-4" role="dialog" aria-modal="true" aria-label={t('badge.confirmTitle')}><p className="text-sm font-bold text-neutral-900 dark:text-emerald-50">{confirmation === 'rotate' ? t('badge.rotateConfirm') : confirmation === 'revoke' ? t('badge.revokeConfirm') : t('badge.issueConfirm')}</p><div className="mt-3 flex gap-2"><button type="button" onClick={() => void mutate(confirmation)} disabled={busy !== null} className="min-h-10 rounded-lg bg-emerald-500 px-3 text-xs font-black text-black disabled:opacity-60">{busy === confirmation ? t('badge.working') : t('badge.confirm')}</button><button type="button" onClick={() => { setConfirmation(null); triggerRef.current?.focus(); }} disabled={busy !== null} className="min-h-10 rounded-lg border border-emerald-500/20 px-3 text-xs font-bold text-neutral-700 dark:text-emerald-100">{t('badge.cancel')}</button></div></div>}
    </section>
  );
}

function ActionButton({ action, busy, offline, onClick, label }: { action: 'issue' | 'rotate'; busy: Action; offline: boolean; onClick: (event: MouseEvent<HTMLButtonElement>) => void; label: string }) {
  return <button type="button" disabled={offline || busy !== null} onClick={onClick} className="min-h-10 rounded-lg bg-emerald-500 px-3 text-xs font-black text-black transition hover:bg-emerald-400 disabled:opacity-60">{busy === action ? '…' : label}</button>;
}
