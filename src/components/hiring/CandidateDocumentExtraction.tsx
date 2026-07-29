import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
} from 'react';
import {
  FileImage,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { apiFetch, apiUrl } from '../../lib/api';
import { useLanguage } from '../../lib/LanguageContext';
import { cn } from '../../lib/utils';

export type CandidateSuggestionKey = 'fullName' | 'email' | 'phone';
type ExtractionFieldKey = 'fullName' | 'email' | 'phoneNumber';
type ConfidenceLevel = 'high' | 'medium' | 'low' | 'unavailable';

type ExtractedField = {
  value: string | null;
  confidence: number | null;
  confidenceLevel: ConfidenceLevel;
  warning: string | null;
};

type CandidateFields = Record<ExtractionFieldKey, ExtractedField>;

type ExtractionPayload = {
  success?: boolean;
  extractionId?: string;
  status?: string;
  fields?: CandidateFields | null;
  warnings?: Array<{ code?: string; field?: string | null }>;
  code?: string;
};

type Props = {
  enabled: boolean;
  creationCompleted: boolean;
  onApplySuggestion: (field: CandidateSuggestionKey, value: string) => void;
  onInitialSuggestions: (suggestions: Partial<Record<CandidateSuggestionKey, string>>) => void;
  onProcessingChange?: (processing: boolean) => void;
};

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 10 * 1024 * 1024;
const FIELD_MAP: Array<{
  extraction: ExtractionFieldKey;
  applicant: CandidateSuggestionKey;
  labelKey: 'hiring.fullName' | 'hiring.email' | 'hiring.phone';
}> = [
  { extraction: 'fullName', applicant: 'fullName', labelKey: 'hiring.fullName' },
  { extraction: 'email', applicant: 'email', labelKey: 'hiring.email' },
  { extraction: 'phoneNumber', applicant: 'phone', labelKey: 'hiring.phone' },
];

class CandidateExtractionUiError extends Error {}

function responseCode(payload: unknown) {
  return payload && typeof payload === 'object' && 'code' in payload && typeof payload.code === 'string'
    ? payload.code
    : '';
}

function safeCandidateFields(payload: ExtractionPayload): CandidateFields | null {
  if (!payload.fields || typeof payload.fields !== 'object') return null;
  const result = {} as CandidateFields;
  for (const { extraction } of FIELD_MAP) {
    const candidate = payload.fields[extraction];
    if (!candidate || typeof candidate !== 'object') return null;
    result[extraction] = {
      value: typeof candidate.value === 'string' ? candidate.value : null,
      confidence: typeof candidate.confidence === 'number' ? candidate.confidence : null,
      confidenceLevel: ['high', 'medium', 'low', 'unavailable'].includes(candidate.confidenceLevel)
        ? candidate.confidenceLevel
        : 'unavailable',
      warning: typeof candidate.warning === 'string' ? candidate.warning : null,
    };
  }
  return result;
}

export function CandidateDocumentExtraction({
  enabled,
  creationCompleted,
  onApplySuggestion,
  onInitialSuggestions,
  onProcessingChange,
}: Props) {
  const { t } = useLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const extractionRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [fields, setFields] = useState<CandidateFields | null>(null);
  const [ignored, setIgnored] = useState<Set<CandidateSuggestionKey>>(new Set());
  const [warningFields, setWarningFields] = useState<Set<string>>(new Set());
  const [missingFields, setMissingFields] = useState<ExtractionFieldKey[]>([]);
  const [error, setError] = useState('');

  const cleanupExtraction = useCallback(async () => {
    const extractionId = extractionRef.current;
    extractionRef.current = null;
    if (!extractionId) return;
    try {
      await apiFetch(apiUrl(`/api/document-extractions/${extractionId}`), { method: 'DELETE' });
    } catch {
      // Expiry is the fallback when best-effort cleanup is unavailable.
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      onProcessingChange?.(false);
      void cleanupExtraction();
    };
  }, [cleanupExtraction, onProcessingChange]);

  useEffect(() => {
    if (creationCompleted) void cleanupExtraction();
  }, [cleanupExtraction, creationCompleted]);

  if (!enabled) return null;

  const setProcessingState = (value: boolean) => {
    if (mountedRef.current) setProcessing(value);
    onProcessingChange?.(value);
  };

  const setSelectedFile = (nextFile: File | null) => {
    setError('');
    if (!nextFile) {
      setFile(null);
      return;
    }
    if (!ACCEPTED_TYPES.includes(nextFile.type)) {
      setFile(null);
      setError(t('hiring.extractionUnsupported'));
      return;
    }
    if (nextFile.size > MAX_BYTES) {
      setFile(null);
      setError(t('hiring.extractionTooLarge'));
      return;
    }
    setFile(nextFile);
  };

  const mapError = (status: number, payload: unknown, aborted: boolean) => {
    if (aborted) return t('hiring.extractionTimeout');
    const code = responseCode(payload);
    if (status === 429 || code.includes('RATE')) return t('hiring.extractionRateLimit');
    if (status === 403 || code.includes('PERMISSION')) return t('hiring.extractionPermission');
    if (code.includes('TYPE') || code.includes('MODE')) return t('hiring.extractionUnsupported');
    if (status === 413 || code.includes('SIZE')) return t('hiring.extractionTooLarge');
    if (code.includes('INVALID_IMAGE') || code.includes('MALFORMED') || code.includes('COMPLEX')) return t('hiring.extractionUnreadable');
    if (code.includes('TIMEOUT')) return t('hiring.extractionTimeout');
    if (status === 404 || code.includes('EXPIRED') || code.includes('NOT_FOUND')) return t('hiring.extractionExpired');
    return t('hiring.extractionUnavailable');
  };

  const completeExtraction = (payload: ExtractionPayload) => {
    const safeFields = safeCandidateFields(payload);
    if (!safeFields || !FIELD_MAP.some(({ extraction }) => safeFields[extraction].value)) {
      setFields(safeFields);
      setError(t('hiring.extractionNoFields'));
      return;
    }
    setFields(safeFields);
    setIgnored(new Set());
    setWarningFields(new Set((payload.warnings || []).map((warning) => warning.field || '').filter(Boolean)));
    setMissingFields(FIELD_MAP.filter(({ extraction }) => !safeFields[extraction].value).map(({ extraction }) => extraction));
    const initial: Partial<Record<CandidateSuggestionKey, string>> = {};
    for (const { extraction, applicant } of FIELD_MAP) {
      const value = safeFields[extraction].value;
      if (value) initial[applicant] = value;
    }
    onInitialSuggestions(initial);
  };

  const processFile = async () => {
    if (!file || processing) return;
    setProcessingState(true);
    setError('');
    const priorExtraction = extractionRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 25_000);
    try {
      const body = new FormData();
      body.append('mode', 'candidate_document');
      body.append('file', file);
      const response = await apiFetch(apiUrl('/api/document-extractions'), {
        method: 'POST',
        body,
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({})) as ExtractionPayload;
      if (!response.ok || !payload.success || !payload.extractionId) {
        throw new CandidateExtractionUiError(mapError(response.status, payload, false));
      }
      extractionRef.current = payload.extractionId;
      if (priorExtraction && priorExtraction !== payload.extractionId) {
        void apiFetch(apiUrl(`/api/document-extractions/${priorExtraction}`), { method: 'DELETE' }).catch(() => undefined);
      }
      completeExtraction(payload);
    } catch (caught) {
      if (!mountedRef.current) return;
      setError(
        caught instanceof DOMException && caught.name === 'AbortError'
          ? mapError(0, null, true)
          : caught instanceof CandidateExtractionUiError
            ? caught.message
            : t('hiring.extractionUnavailable'),
      );
    } finally {
      window.clearTimeout(timeout);
      abortRef.current = null;
      if (mountedRef.current) setProcessingState(false);
    }
  };

  const removeFile = async () => {
    abortRef.current?.abort();
    setFile(null);
    setFields(null);
    setIgnored(new Set());
    setWarningFields(new Set());
    setMissingFields([]);
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    await cleanupExtraction();
  };

  return (
    <section
      aria-labelledby="candidate-extraction-title"
      className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.035] p-3 sm:p-4"
    >
      <div className="flex items-start gap-3">
        <FileImage className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-300" />
        <div className="min-w-0">
          <h4 id="candidate-extraction-title" className="font-black text-slate-900 dark:text-emerald-50">
            {t('hiring.extractionTitle')}
          </h4>
          <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-emerald-100/60">
            {t('hiring.extractionFormats')}
          </p>
        </div>
      </div>

      <div
        onDragEnter={(event) => { event.preventDefault(); setDropActive(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => { event.preventDefault(); setDropActive(false); }}
        onDrop={(event: DragEvent<HTMLDivElement>) => {
          event.preventDefault();
          setDropActive(false);
          setSelectedFile(event.dataTransfer.files[0] || null);
        }}
        className={cn(
          'mt-3 rounded-xl border-2 border-dashed p-4 text-center transition-colors',
          dropActive
            ? 'border-emerald-500 bg-emerald-500/10'
            : 'border-emerald-500/25 bg-white/55 dark:bg-black/15',
        )}
      >
        <Upload className="mx-auto h-7 w-7 text-emerald-500" />
        <p className="mt-2 text-sm font-bold text-slate-800 dark:text-emerald-50">
          {t('hiring.extractionDrop')}
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="mt-3 min-h-10 rounded-lg border border-emerald-500/25 px-3 py-2 text-sm font-bold text-emerald-700 hover:bg-emerald-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-emerald-300"
        >
          {file ? t('hiring.extractionReplace') : t('hiring.extractionChoose')}
        </button>
        {file && (
          <div className="mx-auto mt-3 flex max-w-md items-center justify-between gap-3 rounded-lg border border-emerald-500/15 bg-white p-2.5 text-start dark:bg-black/25">
            <span className="min-w-0 truncate text-sm font-semibold">{file.name}</span>
            <button
              type="button"
              onClick={() => void removeFile()}
              aria-label={t('hiring.extractionRemove')}
              className="min-h-10 min-w-10 rounded-lg text-red-600 hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:text-red-300"
            >
              <Trash2 className="mx-auto h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <p className="mt-2 text-xs text-slate-500 dark:text-emerald-100/50">
        {t('hiring.extractionTemporary')}
      </p>
      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-100">
          {error} {t('hiring.extractionContinueManual')}
        </p>
      )}

      <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {error && file && (
          <button
            type="button"
            disabled={processing}
            onClick={() => void processFile()}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-emerald-500/25 px-3 py-2 text-sm font-bold text-emerald-700 disabled:opacity-50 dark:text-emerald-300"
          >
            <RefreshCw className="h-4 w-4" />
            {t('hiring.extractionRetry')}
          </button>
        )}
        <button
          type="button"
          disabled={!file || processing}
          onClick={() => void processFile()}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {processing ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <FileImage className="h-4 w-4" />}
          {processing ? t('hiring.extractionProcessing') : t('hiring.extractionAction')}
        </button>
      </div>

      {fields && (
        <div className="mt-4 space-y-2" aria-live="polite">
          <h5 className="text-sm font-black text-slate-900 dark:text-emerald-50">
            {t('hiring.extractionSuggestions')}
          </h5>
          {missingFields.length > 0 && (
            <p className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-2.5 text-xs text-amber-900 dark:text-amber-100">
              {t('hiring.extractionPartial')}
              {' '}
              {missingFields.map((field) => t(`hiring.extractionMissing.${field}` as never)).join(', ')}
            </p>
          )}
          {FIELD_MAP.map(({ extraction, applicant, labelKey }) => {
            const suggestion = fields[extraction];
            const hidden = ignored.has(applicant);
            if (!suggestion.value || hidden) return null;
            const hasWarning = Boolean(suggestion.warning || warningFields.has(extraction));
            return (
              <article key={extraction} className="rounded-lg border border-emerald-500/15 bg-white/70 p-3 dark:bg-black/20">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-emerald-100/50">
                      {t(labelKey)}
                    </p>
                    <p className="mt-1 break-words text-sm font-semibold text-slate-900 dark:text-emerald-50">
                      {suggestion.value}
                    </p>
                    <p className="mt-1 text-xs text-slate-600 dark:text-emerald-100/60">
                      {t(`hiring.confidence.${suggestion.confidenceLevel}` as never)}
                      {hasWarning ? ` · ${t(`hiring.extractionWarning.${extraction}` as never)}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => onApplySuggestion(applicant, suggestion.value!)}
                      className="min-h-10 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-black text-[#02110b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                    >
                      {t('hiring.extractionApply')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIgnored((current) => new Set(current).add(applicant))}
                      className="min-h-10 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-emerald-500/20 dark:text-emerald-100"
                    >
                      {t('hiring.extractionIgnore')}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
