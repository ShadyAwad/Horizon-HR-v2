import { useCallback, useEffect, useRef, useState } from 'react';
import { apiUrl } from '../lib/api';

export type DashboardAttentionCounts = {
  grievances: number;
  resignations: number;
  leaveRequests: number;
  breakRequests: number;
  payroll: number;
  loans: number;
  notifications: number;
  hiring: number;
};

const EMPTY_COUNTS: DashboardAttentionCounts = {
  grievances: 0,
  resignations: 0,
  leaveRequests: 0,
  breakRequests: 0,
  payroll: 0,
  loans: 0,
  notifications: 0,
  hiring: 0,
};

type AttentionUser = {
  id: string;
  tenantId: string;
  authToken?: string;
};

const normalizeCount = (value: unknown) => Math.max(0, Math.trunc(Number(value) || 0));

export function useDashboardAttentionCounts(user: AttentionUser, enabled = true) {
  const [counts, setCounts] = useState<DashboardAttentionCounts>(EMPTY_COUNTS);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled || !user.id || !user.tenantId || (typeof navigator !== 'undefined' && !navigator.onLine)) return;

    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;

    try {
      const response = await fetch(apiUrl('/api/dashboard/attention-counts'), {
        headers: {
          'x-employee-id': user.id,
          'x-tenant-id': user.tenantId,
          ...(user.authToken ? { Authorization: `Bearer ${user.authToken}` } : {}),
        },
        signal: controller.signal,
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Unable to load dashboard attention counts.');
      }

      setCounts({
        grievances: normalizeCount(data.counts?.grievances),
        resignations: normalizeCount(data.counts?.resignations),
        leaveRequests: normalizeCount(data.counts?.leaveRequests),
        breakRequests: normalizeCount(data.counts?.breakRequests),
        payroll: normalizeCount(data.counts?.payroll),
        loans: normalizeCount(data.counts?.loans),
        notifications: normalizeCount(data.counts?.notifications),
        hiring: normalizeCount(data.counts?.hiring),
      });
      setError(null);
    } catch (requestError) {
      if ((requestError as Error).name !== 'AbortError') {
        setError(requestError instanceof Error ? requestError.message : 'Unable to load dashboard attention counts.');
      }
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, [enabled, user.authToken, user.id, user.tenantId]);

  useEffect(() => {
    if (!enabled) {
      setCounts(EMPTY_COUNTS);
      return;
    }

    void refresh();
    return () => requestRef.current?.abort();
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled) return;

    const refreshWhenAvailable = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) void refresh();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshWhenAvailable();
    };

    window.addEventListener('focus', refreshWhenAvailable);
    window.addEventListener('online', refreshWhenAvailable);
    document.addEventListener('visibilitychange', onVisibilityChange);
    const intervalId = window.setInterval(refreshWhenAvailable, 45_000);

    return () => {
      window.removeEventListener('focus', refreshWhenAvailable);
      window.removeEventListener('online', refreshWhenAvailable);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.clearInterval(intervalId);
    };
  }, [enabled, refresh]);

  return { counts, error, refresh };
}
