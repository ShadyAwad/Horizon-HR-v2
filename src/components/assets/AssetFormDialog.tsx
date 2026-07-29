import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { LoaderCircle, X } from 'lucide-react';
import { apiFetch, apiUrl } from '../../lib/api';
import { useLanguage } from '../../lib/LanguageContext';
import { AssetLabelExtraction, type AssetSuggestionKey } from './AssetLabelExtraction';

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
  onClose: () => void;
  onSaved: () => Promise<void>;
};

const categories = ['laptop', 'desktop', 'monitor', 'phone', 'tablet', 'accessory', 'badge', 'furniture', 'other'];
const conditions = ['new', 'good', 'fair', 'damaged', 'unusable'];
const inputClass = 'mt-1 w-full rounded-lg border border-emerald-500/20 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/30 dark:bg-black/35 dark:text-emerald-50';

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

export function AssetFormDialog({ asset, canExtract, onClose, onSaved }: Props) {
  const { t, isRtl } = useLanguage();
  const [form, setForm] = useState(() => initialForm(asset));
  const [saving, setSaving] = useState(false);
  const [extractionProcessing, setExtractionProcessing] = useState(false);
  const [saveCompleted, setSaveCompleted] = useState(false);
  const [error, setError] = useState('');
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      restoreFocusRef.current?.focus();
    };
  }, [onClose, saving]);

  const update = (field: keyof AssetForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const applySuggestion = (field: Exclude<AssetSuggestionKey, 'barcodeText'>, value: string) => {
    if (field === 'serialNumber' && asset?.serialNumber && asset.serialNumber !== value) {
      if (!window.confirm(t('assets.confirmSerialChange'))) return;
    }
    update(field, value);
  };

  const applyInitialSuggestions = (suggestions: Partial<Record<Exclude<AssetSuggestionKey, 'barcodeText'>, string>>) => {
    if (asset) return;
    setForm((current) => {
      const next = { ...current };
      for (const [field, value] of Object.entries(suggestions) as Array<[Exclude<AssetSuggestionKey, 'barcodeText'>, string]>) {
        if (!next[field]) next[field] = value;
      }
      return next;
    });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.assetTag.trim() || !form.name.trim()) {
      setError(t('assets.requiredFields'));
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

  const dialog = (
    <div className="fixed inset-0 z-[90] flex items-end bg-black/65 p-3 sm:items-center sm:justify-center" onMouseDown={() => !saving && onClose()}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="asset-form-title"
        dir={isRtl ? 'rtl' : 'ltr'}
        onMouseDown={(event) => event.stopPropagation()}
        className="max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl overflow-y-auto overflow-x-hidden rounded-xl border border-emerald-500/25 bg-white p-4 shadow-2xl dark:bg-[#061411] sm:p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 id="asset-form-title" className="text-base font-black text-slate-900 dark:text-emerald-50">{asset ? t('assets.editAsset') : t('assets.createAsset')}</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-emerald-100/55">{t('assets.formHelp')}</p>
          </div>
          <button ref={closeButtonRef} type="button" disabled={saving} onClick={onClose} aria-label={t('assets.close')} className="min-h-10 min-w-10 rounded-lg text-slate-500 hover:bg-emerald-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-50"><X className="mx-auto h-5 w-5" /></button>
        </div>
        {error && <p role="alert" className="mt-4 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-200">{error}</p>}
        <form onSubmit={submit} className="mt-4 space-y-4">
          <AssetLabelExtraction enabled={canExtract} saveCompleted={saveCompleted} onApply={applySuggestion} onInitialSuggestions={applyInitialSuggestions} onProcessingChange={setExtractionProcessing} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-700 dark:text-emerald-100">{t('assets.assetTag')}<input required value={form.assetTag} maxLength={100} onChange={(event) => update('assetTag', event.target.value)} className={inputClass} /></label>
            <label className="text-xs font-semibold text-slate-700 dark:text-emerald-100">{t('assets.itemName')}<input required value={form.name} maxLength={180} onChange={(event) => update('name', event.target.value)} className={inputClass} /></label>
            <label className="text-xs font-semibold text-slate-700 dark:text-emerald-100">{t('assets.category')}<select value={form.category} onChange={(event) => update('category', event.target.value)} className={`${inputClass} stanza-select`}>{categories.map((item) => <option key={item} value={item}>{t(`assets.category.${item}` as never)}</option>)}</select></label>
            <label className="text-xs font-semibold text-slate-700 dark:text-emerald-100">{t('assets.condition')}<select value={form.condition} onChange={(event) => update('condition', event.target.value)} className={`${inputClass} stanza-select`}>{conditions.map((item) => <option key={item} value={item}>{t(`assets.condition.${item}` as never)}</option>)}</select></label>
            <label className="text-xs font-semibold text-slate-700 dark:text-emerald-100">{t('assets.manufacturer')}<input value={form.manufacturer} maxLength={120} onChange={(event) => update('manufacturer', event.target.value)} className={inputClass} /></label>
            <label className="text-xs font-semibold text-slate-700 dark:text-emerald-100">{t('assets.modelNumber')}<input value={form.model} maxLength={120} onChange={(event) => update('model', event.target.value)} className={inputClass} /></label>
            <label className="text-xs font-semibold text-slate-700 dark:text-emerald-100 sm:col-span-2">{t('assets.serialNumber')}<input value={form.serialNumber} maxLength={160} onChange={(event) => update('serialNumber', event.target.value)} className={inputClass} /></label>
            <label className="text-xs font-semibold text-slate-700 dark:text-emerald-100 sm:col-span-2">{t('assets.notes')}<textarea value={form.notes} maxLength={4000} onChange={(event) => update('notes', event.target.value)} className={`${inputClass} min-h-24 resize-y`} /></label>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" disabled={saving} onClick={onClose} className="min-h-11 rounded-lg border border-emerald-500/20 px-4 py-2 text-sm font-bold disabled:opacity-50">{t('assets.cancel')}</button>
            <button type="submit" disabled={saving || extractionProcessing} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{saving ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : t('assets.save')}</button>
          </div>
        </form>
      </section>
    </div>
  );
  return createPortal(dialog, document.body);
}
