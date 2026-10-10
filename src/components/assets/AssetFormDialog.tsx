import { ASSET_CATEGORIES } from '../../lib/asset-categories';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ComposerDialog } from '../workspace-composer/ComposerDialog';
import { LoaderCircle } from 'lucide-react';
import { apiFetch, apiUrl } from '../../lib/api';
import { useLanguage } from '../../lib/LanguageContext';
import { AssetLabelExtraction } from './AssetLabelExtraction';
import { AssetQrLabelPanel } from './AssetQrLabelPanel';
import {
  applyUntouchedAssetSuggestions,
  createAssetFieldOrigins,
  originAfterManualChange,
  type AssetFieldOrigins,
  type AssetIdentifierField,
} from './asset-prefill-state';

export type AssetFormRecord = {
  id: string;
  assetTag: string;
  name: string;
  category: string;
  condition: string;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  notes?: string | null;
};

type AssetForm = {
  assetTag: string;
  name: string;
  category: string;
  condition: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  notes: string;
};

type Props = {
  asset: AssetFormRecord | null;
  canExtract: boolean;
  canManageQr?: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
};

const categories = ASSET_CATEGORIES;
const conditions = ['new', 'good', 'fair', 'damaged', 'unusable'];
const inputClass = 'stanza-form-control';

function initialForm(asset: AssetFormRecord | null): AssetForm {
  return {
    assetTag: asset?.assetTag || '',
    name: asset?.name || '',
    category: asset?.category || 'laptop',
    condition: asset?.condition || 'good',
    manufacturer: asset?.manufacturer || '',
    model: asset?.model || '',
    serialNumber: asset?.serialNumber || '',
    notes: asset?.notes || '',
  };
}

function safeMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string') {
    return payload.error;
  }
  return fallback;
}

export function AssetFormDialog({ asset, canExtract, canManageQr = false, onClose, onSaved }: Props) {
  const { t, isRtl } = useLanguage();
  const [form, setForm] = useState(() => initialForm(asset));
  const [fieldOrigins, setFieldOrigins] = useState<AssetFieldOrigins>(() => createAssetFieldOrigins(Boolean(asset)));
  const [saving, setSaving] = useState(false);
  const [extractionProcessing, setExtractionProcessing] = useState(false);
  const [saveCompleted, setSaveCompleted] = useState(false);
  const [error, setError] = useState('');
  const [serialAvailability, setSerialAvailability] = useState<'idle' | 'checking' | 'available' | 'conflict' | 'error'>('idle');
  const fieldOriginsRef = useRef(fieldOrigins);

  useEffect(() => {
    const serialNumber = form.serialNumber.trim();
    if (!serialNumber) {
      setSerialAvailability('idle');
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setSerialAvailability('checking');
      const query = new URLSearchParams({ serialNumber });
      if (asset) query.set('assetId', asset.id);
      try {
        const response = await apiFetch(apiUrl(`/api/hr/assets/serial-availability?${query.toString()}`), {
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({})) as { available?: boolean };
        if (!response.ok || typeof payload.available !== 'boolean') {
          setSerialAvailability('error');
          return;
        }
        setSerialAvailability(payload.available ? 'available' : 'conflict');
      } catch (caught) {
        if (!(caught instanceof DOMException && caught.name === 'AbortError')) setSerialAvailability('error');
      }
    }, 350);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [asset, form.serialNumber]);

  const update = (field: keyof AssetForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const updateIdentifier = (field: AssetIdentifierField, value: string) => {
    update(field, value);
    const nextOrigins = { ...fieldOriginsRef.current, [field]: originAfterManualChange(value) };
    fieldOriginsRef.current = nextOrigins;
    setFieldOrigins(nextOrigins);
  };

  const applySuggestion = (field: AssetIdentifierField, value: string) => {
    if (field === 'serialNumber' && asset?.serialNumber && asset.serialNumber !== value) {
      if (!window.confirm(t('assets.confirmSerialChange'))) return;
    }
    update(field, value);
    const nextOrigins: AssetFieldOrigins = { ...fieldOriginsRef.current, [field]: 'extraction-prefilled' };
    fieldOriginsRef.current = nextOrigins;
    setFieldOrigins(nextOrigins);
  };

  const applyInitialSuggestions = (suggestions: Partial<Record<AssetIdentifierField, string>>) => {
    setForm((current) => {
      const applied = applyUntouchedAssetSuggestions(current, fieldOriginsRef.current, suggestions);
      fieldOriginsRef.current = applied.origins;
      setFieldOrigins(applied.origins);
      return applied.values;
    });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.assetTag.trim() || !form.name.trim()) {
      setError(t('assets.requiredFields'));
      return;
    }
    if (serialAvailability === 'conflict') {
      setError(t('assets.serialExists'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        assetTag: form.assetTag,
        name: form.name,
        category: form.category,
        condition: form.condition,
        manufacturer: form.manufacturer,
        model: form.model,
        serialNumber: form.serialNumber,
        notes: form.notes,
      };
      const response = await apiFetch(apiUrl(asset ? `/api/hr/assets/${asset.id}` : '/api/hr/assets'), {
        method: asset ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(safeMessage(body, t('assets.saveError')));
      setSaveCompleted(true);
      await onSaved();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('assets.saveError'));
    } finally {
      setSaving(false);
    }
  };

  return <ComposerDialog title={asset ? t('assets.editAsset') : t('assets.createAsset')} onClose={()=>{if(!saving)onClose();}}>
      <section className="assets-dialog" dir={isRtl?'rtl':'ltr'}>
        <p className="assets-secondary">{t('assets.formHelp')}</p>
        {error && <p role="alert" className="mt-4 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-200">{error}</p>}
        <form onSubmit={submit} className="mt-4 space-y-4">
          <details className="assets-section"><summary>{isRtl?'قراءة ملصق الجهاز (اختياري)':'Read device label (optional)'}</summary><AssetLabelExtraction enabled={canExtract} saveCompleted={saveCompleted} onApply={applySuggestion} onInitialSuggestions={applyInitialSuggestions} onProcessingChange={setExtractionProcessing} /></details>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-700 dark:text-emerald-100">{t('assets.assetTag')}<input required value={form.assetTag} maxLength={100} onChange={(event) => update('assetTag', event.target.value)} className={inputClass} /></label>
            <label className="text-xs font-semibold text-slate-700 dark:text-emerald-100">{t('assets.itemName')}<input required value={form.name} maxLength={180} onChange={(event) => update('name', event.target.value)} className={inputClass} /></label>
            <label className="text-xs font-semibold text-slate-700 dark:text-emerald-100">{t('assets.category')}<select value={form.category} onChange={(event) => update('category', event.target.value)} className={`${inputClass} stanza-select`}>{categories.map((item) => <option key={item} value={item}>{t(`assets.category.${item}` as never)}</option>)}</select></label>
            <label className="text-xs font-semibold text-slate-700 dark:text-emerald-100">{t('assets.condition')}<select value={form.condition} onChange={(event) => update('condition', event.target.value)} className={`${inputClass} stanza-select`}>{conditions.map((item) => <option key={item} value={item}>{t(`assets.condition.${item}` as never)}</option>)}</select></label>
            <label className="text-xs font-semibold text-slate-700 dark:text-emerald-100">{t('assets.manufacturer')}<input value={form.manufacturer} maxLength={120} onChange={(event) => updateIdentifier('manufacturer', event.target.value)} data-field-origin={fieldOrigins.manufacturer} className={inputClass} /></label>
            <label className="text-xs font-semibold text-slate-700 dark:text-emerald-100">{t('assets.modelNumber')}<input value={form.model} maxLength={120} onChange={(event) => updateIdentifier('model', event.target.value)} data-field-origin={fieldOrigins.model} className={inputClass} /></label>
            <label className="text-xs font-semibold text-slate-700 dark:text-emerald-100 sm:col-span-2">{t('assets.serialNumber')}<input value={form.serialNumber} maxLength={160} onChange={(event) => updateIdentifier('serialNumber', event.target.value)} data-field-origin={fieldOrigins.serialNumber} aria-invalid={serialAvailability === 'conflict'} aria-describedby="asset-serial-status" className={inputClass} /><span id="asset-serial-status" aria-live="polite" className={`mt-1 block text-xs ${serialAvailability === 'conflict' ? 'text-red-700 dark:text-red-200' : 'text-slate-500 dark:text-emerald-100/55'}`}>{serialAvailability === 'checking' ? t('assets.serialChecking') : serialAvailability === 'available' ? t('assets.serialAvailable') : serialAvailability === 'conflict' ? t('assets.serialExists') : serialAvailability === 'error' ? t('assets.serialCheckError') : ''}</span></label>
            <label className="text-xs font-semibold text-slate-700 dark:text-emerald-100 sm:col-span-2">{t('assets.notes')}<textarea value={form.notes} maxLength={4000} onChange={(event) => update('notes', event.target.value)} className={`${inputClass} min-h-24 resize-y`} /></label>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" disabled={saving} onClick={onClose} className="min-h-11 rounded-lg border border-emerald-500/20 px-4 py-2 text-sm font-bold disabled:opacity-50">{t('assets.cancel')}</button>
            <button type="submit" disabled={saving || extractionProcessing || serialAvailability === 'conflict'} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{saving ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : t('assets.save')}</button>
          </div>
        </form>
        {asset && <details className="assets-section"><summary>{isRtl?'رمز QR':'QR label'}</summary><AssetQrLabelPanel assetId={asset.id} canManage={canManageQr}/></details>}
      </section>
    </ComposerDialog>;
}
