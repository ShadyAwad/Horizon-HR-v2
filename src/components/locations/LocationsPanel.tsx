import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Archive, Edit3, MapPin, Plus, RefreshCw, RotateCcw, X } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { useLanguage } from '../../lib/LanguageContext';

type Location = {
  id: string;
  name: string;
  code: string | null;
  address: string | null;
  locationType: string;
  latitude: number;
  longitude: number;
  radius: number;
  isPrimary: boolean;
  isActive: boolean;
  archivedAt: string | null;
  teamCount: number;
  employeeCount: number;
  futureShiftCount: number;
};
type Usage = {
  activeTeams: number;
  activeEmployees: number;
  futureShifts: number;
  activeShiftSwaps: number;
};
type FormState = {
  name: string;
  code: string;
  address: string;
  locationType: string;
  latitude: string;
  longitude: string;
  radius: string;
  isPrimary: boolean;
};

const emptyForm: FormState = {
  name: '',
  code: '',
  address: '',
  locationType: 'branch',
  latitude: '',
  longitude: '',
  radius: '300',
  isPrimary: false,
};
const locationTypes = [
  { value: 'headquarters', english: 'Headquarters', arabic: 'المقر الرئيسي' },
  { value: 'branch', english: 'Branch', arabic: 'فرع' },
  { value: 'warehouse', english: 'Warehouse', arabic: 'مستودع' },
  { value: 'remote_site', english: 'Remote site', arabic: 'موقع بعيد' },
  { value: 'other', english: 'Other', arabic: 'أخرى' },
] as const;

function MapPreview({
  latitude,
  longitude,
  radius,
  onChange,
}: {
  latitude: string;
  longitude: string;
  radius: string;
  onChange: (latitude: string, longitude: string) => void;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    let disposed = false;
    let map: import('maplibre-gl').Map | null = null;
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!host.current || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
    void (async () => {
      try {
        const [maplibre] = await Promise.all([
          import('maplibre-gl'),
          import('maplibre-gl/dist/maplibre-gl.css'),
        ]);
        if (disposed || !host.current) return;
        map = new maplibre.Map({
          container: host.current,
          style: `https://api.maptiler.com/maps/streets-v2/style.json?key=${import.meta.env.VITE_MAPTILER_KEY || ''}`,
          center: [lng, lat],
          zoom: 13,
          attributionControl: false,
        });
        const marker = new maplibre.Marker({ draggable: true }).setLngLat([lng, lat]).addTo(map);
        const update = (nextLng: number, nextLat: number) => {
          marker.setLngLat([nextLng, nextLat]);
          onChange(nextLat.toFixed(6), nextLng.toFixed(6));
        };
        marker.on('dragend', () => {
          const point = marker.getLngLat();
          update(point.lng, point.lat);
        });
        map.on('click', (event) => update(event.lngLat.lng, event.lngLat.lat));
        map.on('load', () => {
          if (!map || disposed) return;
          map.addSource('radius', {
            type: 'geojson',
            data: {
              type: 'Feature',
              properties: {},
              geometry: { type: 'Point', coordinates: [lng, lat] },
            },
          });
        });
      } catch {
        // Coordinate fields are the accessible fallback.
      }
    })();
    return () => {
      disposed = true;
      map?.remove();
    };
  }, [latitude, longitude, onChange, radius]);
  return (
    <div
      ref={host}
      aria-label="Map location preview"
      className="relative z-0 mt-3 h-44 isolate overflow-hidden rounded-lg border border-emerald-500/20 bg-neutral-950 sm:h-56"
    />
  );
}

export function LocationsPanel() {
  const { lang, isRtl } = useLanguage();
  const tr = (english: string, arabic: string) => lang === 'ar' ? arabic : english;
  const [locations, setLocations] = useState<Location[]>([]);
  const [summary, setSummary] = useState({ total: 0, active: 0, archived: 0 });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Location | null | 'new'>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [usage, setUsage] = useState<Usage | null>(null);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const inputClass = 'mt-1 min-h-11 w-full rounded-lg border border-emerald-500/20 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-emerald-500 dark:bg-black/25 dark:text-emerald-50';

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiFetch(`/api/hr/locations?status=${status}&search=${encodeURIComponent(search)}&pageSize=100`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Unable to load locations.');
      setLocations(body.locations || []);
      setSummary(body.summary || { total: 0, active: 0, archived: 0 });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load locations.');
    } finally {
      setLoading(false);
    }
  }, [search, status]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!editing) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) setEditing(null);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [editing, saving]);
  useEffect(() => {
    if (!editing) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      returnFocus.current?.focus({ preventScroll: true });
    };
  }, [editing]);

  const open = (location: Location | 'new', button: HTMLButtonElement) => {
    returnFocus.current = button;
    setEditing(location);
    setUsage(null);
    setFormError('');
    setForm(location === 'new' ? emptyForm : {
      name: location.name,
      code: location.code || '',
      address: location.address || '',
      locationType: location.locationType,
      latitude: String(location.latitude),
      longitude: String(location.longitude),
      radius: String(location.radius),
      isPrimary: location.isPrimary,
    });
  };
  const resetForm = () => {
    setForm(editing === 'new' ? emptyForm : {
      name: editing?.name || '',
      code: editing?.code || '',
      address: editing?.address || '',
      locationType: editing?.locationType || 'branch',
      latitude: editing ? String(editing.latitude) : '',
      longitude: editing ? String(editing.longitude) : '',
      radius: editing ? String(editing.radius) : '300',
      isPrimary: editing?.isPrimary || false,
    });
    setFormError('');
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      const path = editing === 'new' ? '/api/hr/locations' : `/api/hr/locations/${editing?.id}`;
      const response = await apiFetch(path, {
        method: editing === 'new' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          latitude: Number(form.latitude),
          longitude: Number(form.longitude),
          radius: Number(form.radius),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Unable to save location.');
      setEditing(null);
      await load();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Unable to save location.');
    } finally {
      setSaving(false);
    }
  };
  const loadUsage = async (location: Location) => {
    setUsage(null);
    setFormError('');
    try {
      const response = await apiFetch(`/api/hr/locations/${location.id}/usage`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Unable to load location usage.');
      setUsage(body.usage);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Unable to load location usage.');
    }
  };
  const lifecycle = async (location: Location, action: 'archive' | 'restore') => {
    setFormError('');
    try {
      const response = await apiFetch(`/api/hr/locations/${location.id}/${action}`, { method: 'POST' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Unable to ${action} location.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Unable to ${action} location.`);
    }
  };
  const updateMap = useCallback((latitude: string, longitude: string) => {
    setForm((current) => ({ ...current, latitude, longitude }));
  }, []);
  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setFormError(tr('Location services are not available in this browser.', 'خدمات الموقع غير متاحة في هذا المتصفح.'));
      return;
    }
    setFormError('');
    navigator.geolocation.getCurrentPosition(
      (position) => updateMap(position.coords.latitude.toFixed(6), position.coords.longitude.toFixed(6)),
      () => setFormError(tr('Unable to get your current location. Enter coordinates manually.', 'تعذر الحصول على موقعك الحالي. أدخل الإحداثيات يدوياً.')),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  };
  const hasCoordinatePreview = Number.isFinite(Number(form.latitude)) && Number.isFinite(Number(form.longitude));

  return (
    <section dir={isRtl ? 'rtl' : 'ltr'} className="min-w-0 space-y-4 text-left dark:text-emerald-50">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">{tr('Locations', 'المواقع')}</h2>
          <p className="text-sm text-neutral-500 dark:text-emerald-100/60">
            {tr('Manage worksite geofences safely.', 'إدارة نطاقات مواقع العمل بأمان.')}
          </p>
        </div>
        <button
          type="button"
          onClick={(event) => open('new', event.currentTarget)}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-bold text-black"
        >
          <Plus className="h-4 w-4" />
          {tr('Create location', 'إضافة موقع')}
        </button>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          [tr('Total', 'الإجمالي'), summary.total],
          [tr('Active', 'نشط'), summary.active],
          [tr('Archived', 'مؤرشف'), summary.archived],
          [tr('Teams assigned', 'الفرق المعينة'), locations.reduce((sum, location) => sum + (location.teamCount || 0), 0)],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg border border-emerald-500/15 bg-emerald-500/5 p-3">
            <p className="text-xs text-neutral-500 dark:text-emerald-100/60">{label}</p>
            <p className="mt-1 text-xl font-bold">{value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={tr('Search locations', 'البحث في المواقع')}
          className="min-w-0 flex-1 rounded-lg border border-emerald-500/20 bg-white px-3 py-2 text-sm dark:bg-black/25"
        />
        <button type="button" onClick={() => setStatus(status === 'active' ? 'archived' : 'active')} className="rounded-lg border border-emerald-500/20 px-3 py-2 text-sm">
          {status === 'active' ? tr('Archived', 'المؤرشفة') : tr('Active', 'النشطة')}
        </button>
        <button type="button" onClick={() => void load()} className="rounded-lg border border-emerald-500/20 p-2" aria-label={tr('Refresh', 'تحديث')}>
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-200">
          {error}
          <button type="button" className="ms-2 underline" onClick={() => void load()}>{tr('Retry', 'إعادة المحاولة')}</button>
        </div>
      )}

      {loading ? (
        <div className="min-h-48 animate-pulse rounded-lg bg-emerald-500/5" />
      ) : locations.length === 0 ? (
        <p className="rounded-lg border border-dashed border-emerald-500/25 p-8 text-center text-sm text-neutral-500">
          {tr('No locations found.', 'لا توجد مواقع.')}
        </p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {locations.map((location) => (
            <article key={location.id} className="rounded-lg border border-emerald-500/15 bg-white/80 p-4 shadow-sm dark:bg-black/20">
              <div className="flex justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate font-bold">{location.name}</h3>
                  <p className="text-xs text-neutral-500 dark:text-emerald-100/60">
                    {location.code || tr('No code', 'بدون رمز')} · {location.locationType}
                  </p>
                  <p className="mt-2 text-sm text-neutral-600 dark:text-emerald-100/70">
                    {location.address || tr('Address unavailable', 'العنوان غير متاح')}
                  </p>
                </div>
                <span className={location.isActive ? 'text-xs font-bold text-emerald-600' : 'text-xs font-bold text-amber-600'}>
                  {location.isActive ? tr('Active', 'نشط') : tr('Archived', 'مؤرشف')}
                </span>
              </div>
              <p className="mt-3 text-xs text-neutral-500 dark:text-emerald-100/60">
                {tr('Circle', 'دائرة')} · {location.radius}m · {location.teamCount || 0} {tr('teams', 'فرق')} · {location.futureShiftCount || 0} {tr('future shifts', 'ورديات قادمة')}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={(event) => open(location, event.currentTarget)} className="inline-flex items-center gap-1 rounded border border-emerald-500/25 px-2 py-1.5 text-xs font-bold">
                  <Edit3 className="h-3.5 w-3.5" />{tr('Edit', 'تعديل')}
                </button>
                <button type="button" onClick={() => { setEditing(location); void loadUsage(location); }} className="inline-flex items-center gap-1 rounded border border-emerald-500/25 px-2 py-1.5 text-xs font-bold">
                  <MapPin className="h-3.5 w-3.5" />{tr('Usage', 'الاستخدام')}
                </button>
                <button type="button" onClick={() => void lifecycle(location, location.isActive ? 'archive' : 'restore')} className="inline-flex items-center gap-1 rounded border border-emerald-500/25 px-2 py-1.5 text-xs font-bold">
                  <Archive className="h-3.5 w-3.5" />{location.isActive ? tr('Archive', 'أرشفة') : tr('Restore', 'استعادة')}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {editing && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={editing === 'new' ? tr('Create location', 'إضافة موقع') : tr('Edit location', 'تعديل موقع')}
          data-location-modal
          className="fixed inset-0 z-[90] flex items-end justify-center overflow-hidden bg-black/60 p-3 pt-[calc(env(safe-area-inset-top)+.75rem)] pb-[calc(env(safe-area-inset-bottom)+.75rem)] md:items-center"
        >
          <form
            onSubmit={save}
            className="relative isolate flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-[#07130f]"
          >
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-emerald-500/15 p-4 md:px-6">
              <div>
                <h3 className="font-bold">{editing === 'new' ? tr('Create location', 'إضافة موقع') : tr('Edit location', 'تعديل موقع')}</h3>
                <p className="text-xs text-neutral-500 dark:text-emerald-100/60">
                  {tr('Circle geofence coordinates are validated on the server.', 'يتم التحقق من إحداثيات نطاق الدائرة على الخادم.')}
                </p>
              </div>
              <button type="button" onClick={() => setEditing(null)} disabled={saving} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg outline-none hover:bg-emerald-500/10 focus-visible:ring-2 focus-visible:ring-emerald-400" aria-label={tr('Close', 'إغلاق')}>
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="stanza-scrollbar min-h-0 overflow-y-auto overscroll-contain p-4 md:p-6">
              {formError && (
                <p id="location-form-error" role="alert" className="rounded border border-red-500/30 bg-red-500/10 p-2 text-sm text-red-700 dark:text-red-200">
                  {formError}
                </p>
              )}
              {usage && (
                <div className="mt-3 grid grid-cols-2 gap-2 rounded border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
                  <span>{tr('Active teams', 'الفرق النشطة')}: {usage.activeTeams}</span>
                  <span>{tr('Future shifts', 'الورديات القادمة')}: {usage.futureShifts}</span>
                  <span>{tr('Employees assigned', 'الموظفون المعينون')}: {usage.activeEmployees}</span>
                  <span>{tr('Open swaps', 'طلبات التبديل')}: {usage.activeShiftSwaps}</span>
                </div>
              )}
              <div className="mt-1 grid min-w-0 gap-3 md:grid-cols-2">
                <label className="min-w-0 text-sm font-medium">
                  {tr('Name', 'الاسم')}
                  <input required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className={inputClass} />
                </label>
                <label className="min-w-0 text-sm font-medium">
                  {tr('Code', 'الرمز')}
                  <input value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))} className={inputClass} />
                </label>
                <label className="min-w-0 text-sm font-medium md:col-span-2">
                  {tr('Address', 'العنوان')}
                  <input value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} className={inputClass} />
                </label>
                <label htmlFor="location-type" className="relative z-10 min-w-0 text-sm font-medium">
                  {tr('Location type', 'نوع الموقع')}
                  <select
                    id="location-type"
                    data-location-type-select
                    value={form.locationType}
                    onChange={(event) => setForm((current) => ({ ...current, locationType: event.target.value }))}
                    disabled={saving}
                    aria-describedby={formError ? 'location-form-error' : undefined}
                    className={`${inputClass} stanza-select relative z-10 touch-manipulation pointer-events-auto`}
                  >
                    {locationTypes.map((type) => (
                      <option key={type.value} value={type.value}>{tr(type.english, type.arabic)}</option>
                    ))}
                  </select>
                </label>
                <label className="flex min-h-11 items-center gap-2 self-end text-sm">
                  <input type="checkbox" checked={form.isPrimary} onChange={(event) => setForm((current) => ({ ...current, isPrimary: event.target.checked }))} />
                  {tr('Primary location', 'الموقع الرئيسي')}
                </label>
                <label className="min-w-0 text-sm font-medium">
                  {tr('Latitude', 'خط العرض')}
                  <input required inputMode="decimal" value={form.latitude} onChange={(event) => setForm((current) => ({ ...current, latitude: event.target.value }))} className={inputClass} />
                </label>
                <label className="min-w-0 text-sm font-medium">
                  {tr('Longitude', 'خط الطول')}
                  <input required inputMode="decimal" value={form.longitude} onChange={(event) => setForm((current) => ({ ...current, longitude: event.target.value }))} className={inputClass} />
                </label>
                <label className="min-w-0 text-sm font-medium">
                  {tr('Radius (metres)', 'النطاق (متر)')}
                  <input required min="25" max="5000" type="number" value={form.radius} onChange={(event) => setForm((current) => ({ ...current, radius: event.target.value }))} className={inputClass} />
                </label>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" onClick={useCurrentLocation} disabled={saving} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-emerald-500/25 px-3 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                  <MapPin className="h-4 w-4" />
                  {tr('Use my current location', 'استخدم موقعي الحالي')}
                </button>
                <p className="text-xs text-neutral-500 dark:text-emerald-100/55">
                  {tr('Location permission is requested only after you choose this action.', 'يتم طلب إذن الموقع فقط بعد اختيار هذا الإجراء.')}
                </p>
              </div>
              {hasCoordinatePreview ? (
                <MapPreview latitude={form.latitude} longitude={form.longitude} radius={form.radius} onChange={updateMap} />
              ) : (
                <p data-location-preview-empty className="mt-3 rounded-lg border border-emerald-500/15 bg-emerald-500/5 p-3 text-xs leading-5 text-neutral-600 dark:text-emerald-100/60">
                  {tr('Enter coordinates or use your current location to preview the geofence.', 'أدخل الإحداثيات أو استخدم موقعك الحالي لمعاينة النطاق الجغرافي.')}
                </p>
              )}
            </div>

            <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-emerald-500/15 p-3 md:px-6">
              <button type="button" onClick={() => setEditing(null)} disabled={saving} className="min-h-11 rounded-lg border border-emerald-500/25 px-3 text-sm font-bold">
                {tr('Cancel', 'إلغاء')}
              </button>
              <button type="button" onClick={resetForm} disabled={saving} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-emerald-500/25 px-3 text-sm font-bold">
                <RotateCcw className="h-4 w-4" />{tr('Reset', 'إعادة تعيين')}
              </button>
              <button type="submit" disabled={saving} className="min-h-11 rounded-lg bg-emerald-500 px-4 text-sm font-bold text-black disabled:opacity-50">
                {saving ? tr('Saving...', 'جارٍ الحفظ...') : tr('Save location', 'حفظ الموقع')}
              </button>
            </footer>
          </form>
        </div>
      )}
    </section>
  );
}
