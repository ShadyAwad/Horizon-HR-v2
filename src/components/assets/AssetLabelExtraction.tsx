import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { FileImage, LoaderCircle, RefreshCw, Trash2, Upload } from 'lucide-react';
import { apiFetch, apiUrl } from '../../lib/api';
import { useLanguage } from '../../lib/LanguageContext';
import { cn } from '../../lib/utils';

export type AssetSuggestionKey = 'serialNumber' | 'modelNumber' | 'manufacturer' | 'barcodeText';
type AssetFormSuggestionKey = 'serialNumber' | 'model' | 'manufacturer';
type ConfidenceLevel = 'high' | 'medium' | 'low' | 'unavailable';
type ExtractedField = {
  value: string | null;
  confidence: number | null;
  confidenceLevel: ConfidenceLevel;
  warning: string | null;
};
type AssetFields = Record<AssetSuggestionKey, ExtractedField>;
type ExtractionPayload = {
  success?: boolean;
  extractionId?: string;
  fields?: AssetFields | null;
  warnings?: Array<{ code?: string; field?: string | null }>;
  code?: string;
};
type Props = {
  enabled: boolean;
  saveCompleted: boolean;
  onApply: (field: AssetFormSuggestionKey, value: string) => void;
  onInitialSuggestions: (suggestions: Partial<Record<AssetFormSuggestionKey, string>>) => void;
  onProcessingChange: (processing: boolean) => void;
};

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 10 * 1024 * 1024;
const FIELD_KEYS: AssetSuggestionKey[] = ['serialNumber', 'modelNumber', 'manufacturer', 'barcodeText'];

class AssetExtractionUiError extends Error {}

function codeOf(payload: unknown) {
  return payload && typeof payload === 'object' && 'code' in payload && typeof payload.code === 'string'
    ? payload.code
    : '';
}

function safeFields(payload: ExtractionPayload): AssetFields | null {
  if (!payload.fields || typeof payload.fields !== 'object') return null;
  const result = {} as AssetFields;
  for (const key of FIELD_KEYS) {
    const field = payload.fields[key];
    if (!field || typeof field !== 'object') return null;
    result[key] = {
      value: typeof field.value === 'string' ? field.value : null,
      confidence: typeof field.confidence === 'number' ? field.confidence : null,
      confidenceLevel: ['high', 'medium', 'low', 'unavailable'].includes(field.confidenceLevel)
        ? field.confidenceLevel
        : 'unavailable',
      warning: typeof field.warning === 'string' ? field.warning : null,
    };
  }
  return result;
}

export function AssetLabelExtraction({
  enabled,
  saveCompleted,
  onApply,
  onInitialSuggestions,
  onProcessingChange,
}: Props) {
  const { t } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);
  const extractionRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [fields, setFields] = useState<AssetFields | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<AssetSuggestionKey, string>>>({});
  const [ignored, setIgnored] = useState<Set<AssetSuggestionKey>>(new Set());
  const [warningFields, setWarningFields] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');

  const cleanup = useCallback(async () => {
    const extractionId = extractionRef.current;
    extractionRef.current = null;
    if (!extractionId) return;
    try {
      await apiFetch(apiUrl(`/api/document-extractions/${extractionId}`), { method: 'DELETE' });
    } catch {
      // The shared expiry policy is the fallback for best-effort cleanup.
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      onProcessingChange(false);
      void cleanup();
    };
  }, [cleanup, onProcessingChange]);

  useEffect(() => {
    if (saveCompleted) void cleanup();
  }, [cleanup, saveCompleted]);

  if (!enabled) return null;

  const setBusy = (value: boolean) => {
    if (mountedRef.current) setProcessing(value);
    onProcessingChange(value);
  };

  const chooseFile = (next: File | null) => {
    setError('');
    if (!next) return setFile(null);
    if (!ACCEPTED_TYPES.includes(next.type)) {
      setFile(null);
      setError(t('assets.extractionUnsupported'));
      return;
    }
    if (next.size > MAX_BYTES) {
      setFile(null);
      setError(t('assets.extractionTooLarge'));
      return;
    }
    setFile(next);
  };

  const mapError = (status: number, payload: unknown, aborted = false) => {
    if (aborted) return t('assets.extractionTimeout');
    const code = codeOf(payload);
    if (status === 429 || code.includes('RATE')) return t('assets.extractionRateLimit');
    if (status === 403 || code.includes('PERMISSION')) return t('assets.extractionPermission');
    if (code.includes('TYPE') || code.includes('MODE')) return t('assets.extractionUnsupported');
    if (status === 413 || code.includes('SIZE')) return t('assets.extractionTooLarge');
    if (code.includes('INVALID_IMAGE') || code.includes('COMPLEX')) return t('assets.extractionUnreadable');
    if (code.includes('TIMEOUT')) return t('assets.extractionTimeout');
    if (status === 404 || code.includes('EXPIRED') || code.includes('NOT_FOUND')) return t('assets.extractionExpired');
    return t('assets.extractionUnavailable');
  };

  const extract = async () => {
    if (!file || processing) return;
    setBusy(true);
    setError('');
    const prior = extractionRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 25_000);
    try {
      const body = new FormData();
      body.append('mode', 'asset_label');
      body.append('file', file);
      const response = await apiFetch(apiUrl('/api/document-extractions'), {
        method: 'POST',
        body,
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({})) as ExtractionPayload;
      if (!response.ok || !payload.success || !payload.extractionId) {
        throw new AssetExtractionUiError(mapError(response.status, payload));
      }
      const normalized = safeFields(payload);
      extractionRef.current = payload.extractionId;
      if (prior && prior !== payload.extractionId) {
        void apiFetch(apiUrl(`/api/document-extractions/${prior}`), { method: 'DELETE' }).catch(() => undefined);
      }
      setFields(normalized);
      setIgnored(new Set());
      setWarningFields(new Set((payload.warnings || []).map((warning) => warning.field || '').filter(Boolean)));
      if (!normalized || !FIELD_KEYS.some((key) => normalized[key].value)) {
        setDrafts({});
        setError(t('assets.extractionNoFields'));
        return;
      }
      const nextDrafts: Partial<Record<AssetSuggestionKey, string>> = {};
      const initial: Partial<Record<AssetFormSuggestionKey, string>> = {};
      for (const key of FIELD_KEYS) {
        const value = normalized[key].value;
        if (!value) continue;
        nextDrafts[key] = value;
        if (key === 'modelNumber') initial.model = value;
        else if (key !== 'barcodeText') initial[key] = value;
      }
      setDrafts(nextDrafts);
      onInitialSuggestions(initial);
    } catch (caught) {
      if (!mountedRef.current) return;
      setError(
        caught instanceof DOMException && caught.name === 'AbortError'
          ? mapError(0, null, true)
          : caught instanceof AssetExtractionUiError
            ? caught.message
            : t('assets.extractionUnavailable'),
      );
    } finally {
      window.clearTimeout(timeout);
      abortRef.current = null;
      if (mountedRef.current) setBusy(false);
    }
  };

  const remove = async () => {
    abortRef.current?.abort();
    setFile(null);
    setFields(null);
    setDrafts({});
    setIgnored(new Set());
    setWarningFields(new Set());
    setError('');
    if (inputRef.current) inputRef.current.value = '';
    await cleanup();
  };

  return (
    <section aria-labelledby="asset-label-extraction-title" className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.035] p-3 sm:p-4">
      <div className="flex items-start gap-3">
        <FileImage className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-300" />
        <div className="min-w-0">
          <h4 id="asset-label-extraction-title" className="font-black text-slate-900 dark:text-emerald-50">{t('assets.extractionTitle')}</h4>
          <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-emerald-100/60">{t('assets.extractionFormats')}</p>
        </div>
      </div>
      <div
        onDragEnter={(event) => { event.preventDefault(); setDropActive(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => { event.preventDefault(); setDropActive(false); }}
        onDrop={(event: DragEvent<HTMLDivElement>) => {
          event.preventDefault();
          setDropActive(false);
          chooseFile(event.dataTransfer.files[0] || null);
        }}
        className={cn('mt-3 rounded-xl border-2 border-dashed p-4 text-center transition-colors', dropActive ? 'border-emerald-500 bg-emerald-500/10' : 'border-emerald-500/25 bg-white/55 dark:bg-black/15')}
      >
        <Upload className="mx-auto h-7 w-7 text-emerald-500" />
        <p className="mt-2 text-sm font-bold">{t('assets.extractionDrop')}</p>
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => chooseFile(event.target.files?.[0] || null)} />
        <button type="button" onClick={() => inputRef.current?.click()} className="mt-3 min-h-10 rounded-lg border border-emerald-500/25 px-3 py-2 text-sm font-bold text-emerald-700 hover:bg-emerald-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-emerald-300">
          {file ? t('assets.extractionReplace') : t('assets.extractionChoose')}
        </button>
        {file && <div className="mx-auto mt-3 flex max-w-md items-center justify-between gap-3 rounded-lg border border-emerald-500/15 bg-white p-2.5 text-start dark:bg-black/25"><span className="min-w-0 truncate text-sm font-semibold">{file.name}</span><button type="button" onClick={() => void remove()} aria-label={t('assets.extractionRemove')} className="min-h-10 min-w-10 rounded-lg text-red-600 hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:text-red-300"><Trash2 className="mx-auto h-4 w-4" /></button></div>}
      </div>
      <p className="mt-2 text-xs text-slate-500 dark:text-emerald-100/50">{t('assets.extractionTemporary')}</p>
      {error && <p role="alert" className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-100">{error} {t('assets.extractionContinueManual')}</p>}
      <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {error && file && <button type="button" disabled={processing} onClick={() => void extract()} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-emerald-500/25 px-3 py-2 text-sm font-bold text-emerald-700 disabled:opacity-50 dark:text-emerald-300"><RefreshCw className="h-4 w-4" />{t('assets.extractionRetry')}</button>}
        <button type="button" disabled={!file || processing} onClick={() => void extract()} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
          {processing ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <FileImage className="h-4 w-4" />}
          {processing ? t('assets.extractionProcessing') : t('assets.extractionAction')}
        </button>
      </div>
      {fields && <div className="mt-4 space-y-2" aria-live="polite"><h5 className="text-sm font-black">{t('assets.extractionSuggestions')}</h5>{FIELD_KEYS.map((key) => {
        const field = fields[key];
        if (!field.value || ignored.has(key)) return null;
        const draft = drafts[key] || '';
        const warning = Boolean(field.warning || warningFields.has(key) || (key === 'serialNumber' && /[OIB][018]|[018][OIB]/i.test(draft)));
        return <article key={key} className="rounded-lg border border-emerald-500/15 bg-white/70 p-3 dark:bg-black/20"><label className="block text-xs font-black uppercase tracking-wide text-slate-500 dark:text-emerald-100/50">{t(`assets.extractionField.${key}` as never)}<input value={draft} maxLength={key === 'serialNumber' ? 160 : key === 'barcodeText' ? 200 : 120} onChange={(event) => setDrafts((current) => ({ ...current, [key]: event.target.value }))} className="mt-1 w-full rounded-lg border border-emerald-500/20 bg-white px-3 py-2 text-sm normal-case tracking-normal text-slate-900 outline-none focus:border-emerald-500 dark:bg-black/35 dark:text-emerald-50" /></label><p className="mt-1 text-xs text-slate-600 dark:text-emerald-100/60">{t(`assets.confidence.${field.confidenceLevel}` as never)}{warning ? ` · ${t(`assets.extractionWarning.${key}` as never)}` : ''}</p><div className="mt-2 flex flex-wrap gap-2">{key !== 'barcodeText' ? <button type="button" onClick={() => onApply(key === 'modelNumber' ? 'model' : key, draft)} className="min-h-10 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-black text-[#02110b]">{t('assets.extractionApply')}</button> : <button type="button" onClick={() => onApply('serialNumber', draft)} className="min-h-10 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-black text-[#02110b]">{t('assets.extractionUseAsSerial')}</button>}<button type="button" onClick={() => setIgnored((current) => new Set(current).add(key))} className="min-h-10 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold dark:border-emerald-500/20">{t('assets.extractionIgnore')}</button></div></article>;
      })}</div>}
    </section>
  );
}
