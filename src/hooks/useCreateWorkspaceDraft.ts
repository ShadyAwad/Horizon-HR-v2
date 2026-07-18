import { useCallback, useEffect, useRef, useState } from 'react';

export const CREATE_WORKSPACE_DRAFT_KEY = 'stanza.create-workspace-draft.v3';
const LEGACY_CREATE_WORKSPACE_DRAFT_PREFIX = 'stanza.create-workspace-draft.v2';
const CREATE_WORKSPACE_FLOW_KEY = 'stanza.create-workspace-flow';
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

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
  version: 3;
  updatedAt: string;
  currentStep: number;
  data: CreateWorkspaceDraftData;
};

type DraftStatus = 'idle' | 'saving' | 'saved' | 'restored' | 'unavailable';

function isValidDraft(value: unknown): value is CreateWorkspaceDraftV1 {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Partial<CreateWorkspaceDraftV1>;
  if (draft.version !== 3 || typeof draft.updatedAt !== 'string' || !draft.data || typeof draft.currentStep !== 'number') return false;
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
    // Exact geofence coordinates are intentionally never persisted in browser storage.
    && data.lat === null
    && data.lng === null
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
      && location.lat === null
      && location.lng === null
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

function removeLegacyDrafts(storage: Storage | null) {
  if (!storage) return;
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (key?.startsWith(LEGACY_CREATE_WORKSPACE_DRAFT_PREFIX)) storage.removeItem(key);
  }
}

function getDraftKey() {
  const storage = safeStorage();
  if (!storage) return CREATE_WORKSPACE_DRAFT_KEY;
  let flowId = storage.getItem(CREATE_WORKSPACE_FLOW_KEY);
  if (!flowId) {
    flowId = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    storage.setItem(CREATE_WORKSPACE_FLOW_KEY, flowId);
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
    try {
      const storage = safeStorage();
      storage?.removeItem(getDraftKey());
      storage?.removeItem(CREATE_WORKSPACE_FLOW_KEY);
    } catch { /* storage can be unavailable */ }
    setStatus('idle');
  }, []);

  const restoreDraft = useCallback(() => {
    try {
      const storage = safeStorage();
      removeLegacyDrafts(storage);
      const raw = storage?.getItem(getDraftKey());
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!isValidDraft(parsed)) {
        storage?.removeItem(getDraftKey());
        storage?.removeItem(CREATE_WORKSPACE_FLOW_KEY);
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
      const persistableData: CreateWorkspaceDraftData = {
        ...draft.data,
        lat: null,
        lng: null,
        locations: draft.data.locations.map((location) => ({ ...location, lat: null, lng: null })),
      };
      safeStorage()?.setItem(getDraftKey(), JSON.stringify({ ...draft, data: persistableData }));
      setStatus('saved');
    } catch {
      setStatus('unavailable');
    }
  }, []);

  const saveDraft = useCallback((currentStep: number, data: CreateWorkspaceDraftData, immediate = false) => {
    latestRef.current = { version: 3, updatedAt: new Date().toISOString(), currentStep, data };
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
