import { useCallback, useEffect, useRef, useState } from 'react';

export const CREATE_WORKSPACE_DRAFT_KEY = 'stanza.create-workspace-draft.v2';
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type CreateWorkspaceDraftData = {
  companyName: string;
  tenantSlug: string;
  adminRole: string;
  currency: string;
  capacity: string;
  allowsLoans: boolean;
  lat: number | null;
  lng: number | null;
  radius: number;
  locations: Array<{
    name: string;
    locationType: 'headquarters' | 'branch' | 'warehouse' | 'remote_site' | 'other';
    address: string;
    lat: number | null;
    lng: number | null;
    radius: number;
    isPrimary: boolean;
  }>;
  customRoles: Array<{ name: string; description: string }>;
  selectedLocationIndex: number;
  welcomeEmailOptions: {
    sendWelcomeEmail: boolean;
    includeWorkspaceName: boolean;
    includeLoginEmail: boolean;
  };
};

type CreateWorkspaceDraftV1 = {
  version: 2;
  updatedAt: string;
  currentStep: number;
  data: CreateWorkspaceDraftData;
};

type DraftStatus = 'idle' | 'saving' | 'saved' | 'restored' | 'unavailable';

function isFiniteCoordinate(value: unknown, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function isValidDraft(value: unknown): value is CreateWorkspaceDraftV1 {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Partial<CreateWorkspaceDraftV1>;
  if (draft.version !== 2 || typeof draft.updatedAt !== 'string' || !draft.data || typeof draft.currentStep !== 'number') return false;
  const updatedAt = new Date(draft.updatedAt).getTime();
  if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > DRAFT_TTL_MS) return false;
  const data = draft.data;
  return typeof data.companyName === 'string'
    && typeof data.tenantSlug === 'string'
    && typeof data.adminRole === 'string'
    && typeof data.currency === 'string'
    && typeof data.capacity === 'string'
    && typeof data.allowsLoans === 'boolean'
    && Array.isArray(data.locations)
    && Array.isArray(data.customRoles)
    && (data.lat === null || isFiniteCoordinate(data.lat, -90, 90))
    && (data.lng === null || isFiniteCoordinate(data.lng, -180, 180))
    && typeof data.radius === 'number' && data.radius >= 25 && data.radius <= 5000
    && Number.isInteger(data.selectedLocationIndex)
    && typeof data.welcomeEmailOptions?.sendWelcomeEmail === 'boolean'
    && typeof data.welcomeEmailOptions?.includeWorkspaceName === 'boolean'
    && typeof data.welcomeEmailOptions?.includeLoginEmail === 'boolean'
    && data.locations.length > 0
    && data.locations.every((location) => (
      location && typeof location.name === 'string'
      && typeof location.address === 'string'
      && ['headquarters', 'branch', 'warehouse', 'remote_site', 'other'].includes(location.locationType)
      && typeof location.isPrimary === 'boolean'
      && typeof location.radius === 'number' && location.radius >= 25 && location.radius <= 5000
      && (location.lat === null || isFiniteCoordinate(location.lat, -90, 90))
      && (location.lng === null || isFiniteCoordinate(location.lng, -180, 180))
    ))
    && data.customRoles.every((role) => role && typeof role.name === 'string' && typeof role.description === 'string');
}

function safeStorage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function getDraftKey() {
  const storage = safeStorage();
  if (!storage) return CREATE_WORKSPACE_DRAFT_KEY;
  let flowId = storage.getItem('stanza.create-workspace-flow');
  if (!flowId) {
    flowId = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    storage.setItem('stanza.create-workspace-flow', flowId);
  }
  return `${CREATE_WORKSPACE_DRAFT_KEY}.${flowId}`;
}

export function useCreateWorkspaceDraft() {
  const timeoutRef = useRef<number | null>(null);
  const latestRef = useRef<CreateWorkspaceDraftV1 | null>(null);
  const [status, setStatus] = useState<DraftStatus>('idle');

  const clearDraft = useCallback(() => {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    latestRef.current = null;
    try { safeStorage()?.removeItem(getDraftKey()); } catch { /* storage can be unavailable */ }
    setStatus('idle');
  }, []);

  const restoreDraft = useCallback(() => {
    try {
      const storage = safeStorage();
      const raw = storage?.getItem(getDraftKey());
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!isValidDraft(parsed)) {
        storage?.removeItem(getDraftKey());
        return null;
      }
      latestRef.current = parsed;
      setStatus('restored');
      return parsed;
    } catch {
      setStatus('unavailable');
      return null;
    }
  }, []);

  const flush = useCallback(() => {
    const draft = latestRef.current;
    if (!draft) return;
    try {
      safeStorage()?.setItem(getDraftKey(), JSON.stringify(draft));
      setStatus('saved');
    } catch {
      setStatus('unavailable');
    }
  }, []);

  const saveDraft = useCallback((currentStep: number, data: CreateWorkspaceDraftData, immediate = false) => {
    latestRef.current = { version: 2, updatedAt: new Date().toISOString(), currentStep, data };
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    if (immediate) {
      flush();
      return;
    }
    setStatus('saving');
    timeoutRef.current = window.setTimeout(flush, 350);
  }, [flush]);

  useEffect(() => {
    const flushOnExit = () => flush();
    const onVisibilityChange = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('beforeunload', flushOnExit);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      window.removeEventListener('beforeunload', flushOnExit);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [flush]);

  return { clearDraft, restoreDraft, saveDraft, status };
}
