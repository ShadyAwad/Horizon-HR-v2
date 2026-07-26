import { useCallback, useEffect, useRef, useState } from 'react';
import { collectFeedImageIds, FEED_EDITOR_FORMAT, validateFeedEditorDocument } from '../lib/feed-editor-contract';
import { apiFetch, apiUrl } from '../lib/api';

const DRAFT_KEY_PREFIX = 'stanza.company-feed.recovery.v1';
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DRAFT_MAX_BYTES = 60_000;
const AUTOSAVE_DELAY_MS = 1_000;
const MAX_RETRIES = 2;

export type CompanyFeedDraftContent = {
  title: string;
  contentText: string;
  contentJson: unknown | null;
};

export type CompanyFeedDraftRecord = CompanyFeedDraftContent & {
  id: string;
  contentFormat: string;
  attachmentReferences: { imageIds: string[] };
  version: number;
  createdAt: string;
  updatedAt: string;
};

type LocalDraft = CompanyFeedDraftContent & {
  storageVersion: 1;
  updatedAt: string;
  serverVersion: number | null;
  attachmentReferences: { imageIds: string[] };
};

export type CompanyFeedDraftStatus =
  | 'idle'
  | 'loading'
  | 'saving'
  | 'saved'
  | 'saved_local'
  | 'offline'
  | 'error'
  | 'restored';

type DraftResponse = { success?: boolean; draft?: CompanyFeedDraftRecord | null; error?: string; code?: string };

function safeStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getStorageKey(tenantId: string, employeeId: string) {
  return `${DRAFT_KEY_PREFIX}.${tenantId}.${employeeId}`;
}

function validLocalDraft(value: unknown): value is LocalDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Partial<LocalDraft>;
  if (draft.storageVersion !== 1 || typeof draft.updatedAt !== 'string' || typeof draft.title !== 'string' || typeof draft.contentText !== 'string') return false;
  const updatedAt = new Date(draft.updatedAt).getTime();
  if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > DRAFT_TTL_MS) return false;
  if (!draft.contentJson || !draft.attachmentReferences || !Array.isArray(draft.attachmentReferences.imageIds)) return false;
  if (typeof draft.serverVersion !== 'number' && draft.serverVersion !== null) return false;
  const validation = validateFeedEditorDocument(draft.contentJson, draft.contentText);
  return validation.ok;
}

function hasMeaningfulContent(content: CompanyFeedDraftContent) {
  return Boolean(content.title.trim() || content.contentText.trim() || collectFeedImageIds(content.contentJson).length);
}

function toLocalDraft(content: CompanyFeedDraftContent, serverVersion: number | null): LocalDraft | null {
  if (!content.contentJson || !hasMeaningfulContent(content)) return null;
  const validation = validateFeedEditorDocument(content.contentJson, content.contentText);
  if (!validation.ok) return null;
  const draft: LocalDraft = {
    storageVersion: 1,
    updatedAt: new Date().toISOString(),
    serverVersion,
    title: content.title.slice(0, 160),
    contentText: content.contentText.slice(0, 20_000),
    contentJson: validation.document,
    attachmentReferences: { imageIds: collectFeedImageIds(content.contentJson) },
  };
  return JSON.stringify(draft).length <= DRAFT_MAX_BYTES ? draft : null;
}

export function useCompanyFeedDraft({
  tenantId,
  employeeId,
  enabled,
  content,
  publishing,
  onRestore,
}: {
  tenantId: string;
  employeeId: string;
  enabled: boolean;
  content: CompanyFeedDraftContent;
  publishing: boolean;
  onRestore: (content: CompanyFeedDraftContent) => void;
}) {
  const [status, setStatus] = useState<CompanyFeedDraftStatus>('idle');
  const [message, setMessage] = useState('');
  const [hasDraft, setHasDraft] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const contentRef = useRef(content);
  const recordRef = useRef<CompanyFeedDraftRecord | null>(null);
  const timerRef = useRef<number | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const sequenceRef = useRef(0);
  const loadedIdentityRef = useRef<string | null>(null);

  contentRef.current = content;

  const clearLocal = useCallback(() => {
    safeStorage()?.removeItem(getStorageKey(tenantId, employeeId));
  }, [employeeId, tenantId]);

  const writeLocal = useCallback((nextContent = contentRef.current) => {
    const local = toLocalDraft(nextContent, recordRef.current?.version ?? null);
    if (!local) return false;
    try {
      safeStorage()?.setItem(getStorageKey(tenantId, employeeId), JSON.stringify(local));
      return true;
    } catch {
      return false;
    }
  }, [employeeId, tenantId]);

  const readLocal = useCallback(() => {
    try {
      const storage = safeStorage();
      const key = getStorageKey(tenantId, employeeId);
      const raw = storage?.getItem(key);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!validLocalDraft(parsed)) {
        storage?.removeItem(key);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }, [employeeId, tenantId]);

  const applyRecord = useCallback((record: CompanyFeedDraftRecord | null) => {
    recordRef.current = record;
    setHasDraft(Boolean(record));
    setLastSavedAt(record?.updatedAt || null);
  }, []);

  const restore = useCallback(async (force = false) => {
    if (!enabled || !tenantId || !employeeId) return;
    const identity = `${tenantId}:${employeeId}`;
    if (!force && loadedIdentityRef.current === identity) return;
    loadedIdentityRef.current = identity;
    setStatus('loading');
    setMessage('');

    let serverDraft: CompanyFeedDraftRecord | null = null;
    try {
      const response = await apiFetch(apiUrl('/api/me/company-feed/draft'));
      const body = await response.json().catch(() => ({})) as DraftResponse;
      if (response.ok && body.success) serverDraft = body.draft || null;
    } catch {
      // The local buffer is deliberately a recovery fallback when the network is unavailable.
    }

    const localDraft = readLocal();
    const serverTime = serverDraft ? new Date(serverDraft.updatedAt).getTime() : 0;
    const localTime = localDraft ? new Date(localDraft.updatedAt).getTime() : 0;
    const chosen = localDraft && localTime > serverTime
      ? localDraft
      : serverDraft;
    applyRecord(serverDraft);

    if (chosen) {
      onRestore({ title: chosen.title, contentText: chosen.contentText, contentJson: chosen.contentJson });
      setStatus('restored');
      setMessage(localDraft && localTime > serverTime ? 'local' : 'server');
    } else {
      setStatus('idle');
    }
  }, [applyRecord, employeeId, enabled, onRestore, readLocal, tenantId]);

  const saveNow = useCallback(async (allowRetry = true): Promise<CompanyFeedDraftRecord | null> => {
    if (!enabled || publishing || !tenantId || !employeeId) return recordRef.current;
    const snapshot = contentRef.current;
    if (!hasMeaningfulContent(snapshot)) return null;
    const localSaved = writeLocal(snapshot);
    if (!navigator.onLine) {
      setStatus(localSaved ? 'offline' : 'error');
      setMessage(localSaved ? 'offline' : 'local_unavailable');
      return null;
    }

    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const sequence = ++sequenceRef.current;
    setStatus('saving');
    setMessage('');
    const expectedVersion = recordRef.current?.version ?? 0;

    for (let attempt = 0; attempt <= (allowRetry ? MAX_RETRIES : 0); attempt += 1) {
      try {
        const response = await apiFetch(apiUrl('/api/me/company-feed/draft'), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            title: snapshot.title,
            contentText: snapshot.contentText,
            contentJson: snapshot.contentJson,
            contentFormat: FEED_EDITOR_FORMAT,
            expectedVersion,
          }),
        });
        if (response.status === 204) {
          if (sequence === sequenceRef.current) applyRecord(null);
          clearLocal();
          setStatus('idle');
          return null;
        }
        const body = await response.json().catch(() => ({})) as DraftResponse;
        if (response.ok && body.success && body.draft) {
          if (sequence !== sequenceRef.current) return body.draft;
          applyRecord(body.draft);
          clearLocal();
          setStatus('saved');
          setMessage('');
          return body.draft;
        }
        if (response.status === 409) {
          if (body.draft) applyRecord(body.draft);
          setStatus('error');
          setMessage('conflict');
          return null;
        }
        setStatus(localSaved ? 'saved_local' : 'error');
        setMessage(body.error || 'save_failed');
        return null;
      } catch (error) {
        if (controller.signal.aborted) return null;
        if (attempt < (allowRetry ? MAX_RETRIES : 0)) {
          await new Promise((resolve) => window.setTimeout(resolve, 250 * (attempt + 1)));
          continue;
        }
        setStatus(localSaved ? 'saved_local' : 'error');
        setMessage(error instanceof Error ? error.message : 'save_failed');
        return null;
      } finally {
        if (requestRef.current === controller && sequence === sequenceRef.current) requestRef.current = null;
      }
    }
    return null;
  }, [applyRecord, clearLocal, employeeId, enabled, publishing, tenantId, writeLocal]);

  const discard = useCallback(async () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    requestRef.current?.abort();
    clearLocal();
    try {
      const response = await apiFetch(apiUrl('/api/me/company-feed/draft'), { method: 'DELETE' });
      if (!response.ok) throw new Error('discard_failed');
      applyRecord(null);
      setStatus('idle');
      setMessage('');
      return true;
    } catch {
      setStatus('error');
      setMessage('discard_failed');
      return false;
    }
  }, [applyRecord, clearLocal]);

  useEffect(() => {
    if (!enabled || publishing || !hasMeaningfulContent(content)) return;
    writeLocal(content);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => { void saveNow(); }, AUTOSAVE_DELAY_MS);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [content, enabled, publishing, saveNow, writeLocal]);

  useEffect(() => {
    void restore();
  }, [restore]);

  useEffect(() => {
    const flush = () => {
      writeLocal();
      void saveNow(false);
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      requestRef.current?.abort();
    };
  }, [saveNow, writeLocal]);

  return {
    status,
    message,
    hasDraft,
    lastSavedAt,
    saveNow,
    retry: () => saveNow(false),
    discard,
    restore: () => restore(true),
    clearLocal,
    markPublished: () => {
      applyRecord(null);
      clearLocal();
      setStatus('idle');
      setMessage('');
    },
  };
}
