import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, FileText } from 'lucide-react';
import type { AuthUser } from '../../auth/auth-contract';
import { apiFetch, apiUrl } from '../../lib/api';
import { useLanguage } from '../../lib/LanguageContext';
import { cn } from '../../lib/utils';

type ResignationStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'processed';

type ResignationRequest = {
  id: string;
  employee_id: string;
  full_name?: string;
  email?: string;
  resignation_type: string;
  requested_last_working_day: string;
  reason?: string | null;
  status: ResignationStatus;
  review_note?: string | null;
  outstanding_asset_count?: number;
};

type ResignationForm = {
  requestedLastWorkingDay: string;
  resignationType: string;
  reason: string;
};

type ResignationsPanelProps = {
  user: AuthUser;
  isOffline: boolean;
  canViewAssets: boolean;
  onBack: () => void;
  onViewAssets: () => void;
  onChanged: () => Promise<void> | void;
};

const emptyForm: ResignationForm = {
  requestedLastWorkingDay: '',
  resignationType: 'voluntary',
  reason: '',
};

const isAuthenticatedUser = (user: AuthUser) => (
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(user.id)
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(user.tenantId)
);

const formatLabel = (value: string) => (
  value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
);

export function ResignationsPanel({
  user,
  isOffline,
  canViewAssets,
  onBack,
  onViewAssets,
  onChanged,
}: ResignationsPanelProps) {
  const { t } = useLanguage();
  const [myResignations, setMyResignations] = useState<ResignationRequest[]>([]);
  const [tenantResignations, setTenantResignations] = useState<ResignationRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');
  const [form, setForm] = useState<ResignationForm>(emptyForm);

  const canReview = user.role === 'hr_admin'
    || user.role === 'manager'
    || Boolean(user.permissions?.includes('resignations.review'));
  const canProcess = user.role === 'hr_admin'
    || Boolean(user.permissions?.includes('resignations.process'));
  const displayEnum = (value: string) => {
    const labels: Record<string, ReturnType<typeof t>> = {
      pending: t('enum.pending'),
      approved: t('enum.approved'),
      rejected: t('enum.rejected'),
    };
    return labels[value.toLowerCase()] || formatLabel(value);
  };

  const requestHeaders = useCallback((): Record<string, string> => ({
    'Content-Type': 'application/json',
    'x-employee-id': user.id,
    'x-tenant-id': user.tenantId,
  }), [user.id, user.tenantId]);

  const loadResignations = useCallback(async () => {
    if (!isAuthenticatedUser(user)) return;
    setLoading(true);
    try {
      const ownResponse = await apiFetch(apiUrl('/api/resignations/me'), {
        headers: requestHeaders(),
      });
      const ownData = await ownResponse.json() as {
        success?: boolean;
        error?: string;
        resignations?: ResignationRequest[];
      };
      if (!ownResponse.ok) throw new Error(ownData.error || t('dash.resignationLoadError'));
      setMyResignations(ownData.resignations || []);

      if (canReview) {
        const tenantResponse = await apiFetch(apiUrl('/api/resignations'), {
          headers: requestHeaders(),
        });
        const tenantData = await tenantResponse.json() as {
          success?: boolean;
          error?: string;
          resignations?: ResignationRequest[];
        };
        if (!tenantResponse.ok) throw new Error(tenantData.error || t('dash.resignationLoadError'));
        setTenantResignations(tenantData.resignations || []);
      } else {
        setTenantResignations([]);
      }
    } catch (error) {
      setMessageType('error');
      setMessage(error instanceof Error ? error.message : t('dash.resignationLoadError'));
    } finally {
      setLoading(false);
    }
  }, [canReview, requestHeaders, t, user]);

  useEffect(() => {
    void loadResignations();
  }, [loadResignations]);

  const submitResignation = async () => {
    if (!form.requestedLastWorkingDay) {
      setMessageType('error');
      setMessage(t('dash.lastWorkingDayRequired'));
      return;
    }

    setSubmitting(true);
    try {
      const response = await apiFetch(apiUrl('/api/resignations'), {
        method: 'POST',
        headers: requestHeaders(),
        body: JSON.stringify(form),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || t('dash.resignationSubmitError'));
      setMessageType('success');
      setMessage(t('dash.resignationSubmitted'));
      setForm(emptyForm);
      await loadResignations();
      await onChanged();
    } catch (error) {
      setMessageType('error');
      setMessage(error instanceof Error ? error.message : t('dash.resignationSubmitError'));
    } finally {
      setSubmitting(false);
    }
  };

  const updateResignation = async (
    id: string,
    path: 'withdraw' | 'review' | 'process',
    body?: Record<string, string>,
  ) => {
    setUpdatingId(id);
    try {
      const response = await apiFetch(apiUrl(`/api/resignations/${id}/${path}`), {
        method: 'PATCH',
        headers: requestHeaders(),
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || t('dash.resignationUpdateError'));
      setMessageType('success');
      setMessage(
        path === 'withdraw'
          ? t('dash.resignationWithdrawn')
          : path === 'process'
            ? t('dash.resignationProcessed')
            : body?.status === 'approved'
              ? t('dash.resignationApproved')
              : t('dash.resignationRejected'),
      );
      await loadResignations();
      await onChanged();
    } catch (error) {
      setMessageType('error');
      setMessage(error instanceof Error ? error.message : t('dash.resignationUpdateError'));
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-slate-800 dark:text-slate-200">
            <FileText className="h-4 w-4 text-emerald-500" />
            {t('dash.resignations')}
          </h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {t('dash.resignationsHelp')}
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-emerald-500/15 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-neutral-600 dark:text-emerald-100/60"
        >
          {t('dash.back')}
        </button>
      </div>

      <div className="rounded-xl border border-emerald-500/15 bg-white/70 p-4 dark:bg-black/35">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <label>
            <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-500 dark:text-emerald-100/45">
              {t('dash.lastWorkingDay')}
            </span>
            <input
              type="date"
              value={form.requestedLastWorkingDay}
              onChange={(event) => setForm((current) => ({
                ...current,
                requestedLastWorkingDay: event.target.value,
              }))}
              className="mt-1 w-full rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 dark:bg-black/40 dark:text-emerald-50"
            />
          </label>
          <label>
            <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-500 dark:text-emerald-100/45">
              {t('dash.resignationType')}
            </span>
            <select
              value={form.resignationType}
              onChange={(event) => setForm((current) => ({
                ...current,
                resignationType: event.target.value,
              }))}
              className="mt-1 w-full rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 dark:bg-black/40 dark:text-emerald-50"
            >
              <option value="voluntary">{t('dash.voluntary')}</option>
              <option value="personal_reasons">{t('dash.personalReasons')}</option>
              <option value="career_change">{t('dash.careerChange')}</option>
              <option value="other">{t('dash.other')}</option>
            </select>
          </label>
          <label className="md:col-span-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-500 dark:text-emerald-100/45">
              {t('dash.reason')}
            </span>
            <textarea
              value={form.reason}
              maxLength={2000}
              onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))}
              rows={2}
              className="mt-1 w-full rounded border border-emerald-500/15 bg-white px-3 py-2 text-xs text-neutral-800 dark:bg-black/40 dark:text-emerald-50"
            />
          </label>
          <button
            type="button"
            onClick={submitResignation}
            disabled={isOffline || submitting}
            className="rounded bg-emerald-500 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-950 disabled:opacity-60 md:col-span-4"
          >
            {submitting ? t('dash.submitting') : t('dash.submitResignation')}
          </button>
        </div>
      </div>

      {message && (
        <p className={cn(
          'rounded-lg border px-3 py-2 text-xs font-semibold',
          messageType === 'success'
            ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
            : 'border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300',
        )}>
          {message}
        </p>
      )}

      <div className="rounded-xl border border-emerald-500/15 bg-white/70 p-4 dark:bg-black/30">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-xs font-bold uppercase tracking-widest text-slate-700 dark:text-slate-300">
            {t('dash.myResignations')}
          </h4>
          <button
            type="button"
            onClick={loadResignations}
            className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-300"
          >
            {t('dash.refresh')}
          </button>
        </div>
        <div className="space-y-2">
          {myResignations.map((request) => (
            <div key={request.id} className="rounded-lg border border-emerald-500/15 p-3 text-xs">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-bold text-slate-800 dark:text-slate-100">
                    {displayEnum(request.resignation_type)}
                  </p>
                  <p className="mt-1 text-neutral-500 dark:text-emerald-100/45">
                    {t('dash.lastWorkingDay')}: <span dir="ltr">{request.requested_last_working_day}</span>
                  </p>
                  {request.reason && (
                    <p className="mt-1 text-neutral-500 dark:text-emerald-100/45">{request.reason}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full border border-emerald-500/20 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700 dark:text-emerald-300">
                    {displayEnum(request.status)}
                  </span>
                  {request.status === 'pending' && (
                    <button
                      type="button"
                      onClick={() => updateResignation(request.id, 'withdraw')}
                      disabled={updatingId === request.id}
                      className="text-[10px] font-bold uppercase text-red-600 dark:text-red-300"
                    >
                      {t('dash.withdraw')}
                    </button>
                  )}
                </div>
              </div>
              {request.review_note && (
                <p className="mt-2 text-[11px] text-neutral-500 dark:text-emerald-100/45">
                  {request.review_note}
                </p>
              )}
            </div>
          ))}
          {!loading && myResignations.length === 0 && (
            <p className="p-4 text-center text-xs text-neutral-500 dark:text-emerald-100/45">
              {t('dash.noResignationRequests')}
            </p>
          )}
        </div>
      </div>

      {canReview && (
        <div className="rounded-xl border border-emerald-500/15 bg-white/70 p-4 dark:bg-black/30">
          <h4 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-700 dark:text-slate-300">
            {t('dash.tenantResignations')}
          </h4>
          <div className="space-y-2">
            {tenantResignations.map((request) => (
              <div key={request.id} className="rounded-lg border border-emerald-500/15 p-3 text-xs">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-bold text-slate-800 dark:text-slate-100">
                      {request.full_name || request.employee_id}
                    </p>
                    <p className="text-[10px] text-neutral-500 dark:text-emerald-100/45" dir="ltr">
                      {request.email}
                    </p>
                    <p className="mt-1 text-neutral-500 dark:text-emerald-100/45">
                      {t('dash.lastWorkingDay')}: <span dir="ltr">{request.requested_last_working_day}</span> · {request.reason}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {request.status === 'pending' && (
                      <>
                        <button
                          type="button"
                          onClick={() => updateResignation(request.id, 'review', { status: 'approved' })}
                          className="rounded border border-emerald-500/20 px-2 py-1 text-[10px] font-bold uppercase text-emerald-700 dark:text-emerald-300"
                        >
                          {t('dash.approve')}
                        </button>
                        <button
                          type="button"
                          onClick={() => updateResignation(request.id, 'review', { status: 'rejected' })}
                          className="rounded border border-red-500/20 px-2 py-1 text-[10px] font-bold uppercase text-red-600 dark:text-red-300"
                        >
                          {t('dash.reject')}
                        </button>
                      </>
                    )}
                    {request.status === 'approved' && canProcess && (
                      <button
                        type="button"
                        onClick={() => updateResignation(request.id, 'process')}
                        className="rounded border border-emerald-500/20 px-2 py-1 text-[10px] font-bold uppercase text-emerald-700 dark:text-emerald-300"
                      >
                        {t('dash.markProcessed')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {!loading && tenantResignations.length === 0 && (
              <p className="p-4 text-center text-xs text-neutral-500 dark:text-emerald-100/45">
                {t('dash.noResignationRequests')}
              </p>
            )}
          </div>
        </div>
      )}

      {canReview && tenantResignations
        .filter((request) => (request.outstanding_asset_count || 0) > 0)
        .map((request) => (
          <div
            key={`assets-warning-${request.id}`}
            className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
          >
            <span>
              <AlertTriangle className="me-1 inline h-3.5 w-3.5" />
              {request.full_name || t('dash.employee')}: {t('assets.outstandingAssets').replace(
                '{{count}}',
                String(request.outstanding_asset_count || 0),
              )}
            </span>
            {canViewAssets && (
              <button
                type="button"
                onClick={onViewAssets}
                className="font-bold text-emerald-700 underline dark:text-emerald-300"
              >
                {t('assets.viewAssets')}
              </button>
            )}
          </div>
        ))}
    </div>
  );
}
