import React, { useEffect, useState ,useRef } from 'react';
import type { GeoJSONSource, Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, ArrowRight, ArrowLeft, MapPin, Building2, Wallet, Globe, Info, Eye, EyeOff } from 'lucide-react';
import { cn } from '../lib/utils';
import { useLanguage, type TranslationKey } from '../lib/LanguageContext';
import { PrivacyPolicyModal } from '../components/PrivacyPolicyModal';
import { AuthTransitionLoader } from '../components/AuthTransitionLoader';
import type { AuthVisualState } from '../components/AuthShell';
import { apiUrl } from '../lib/api';
import type { AuthUser } from '../App';
import {
  validateEmail,
  validatePasswordStrength,
  validateRadiusMeters,
  type PasswordRuleKey,
} from '../lib/validation';


type InteractiveMapProps = {
  locationKey?: string | number;
  lat: number | null;
  lng: number | null;
  radius: number;
  setLat: (value: number) => void;
  setLng: (value: number) => void;
  setRadius: (value: number) => void;
  locationAccuracy?: number;
  disabled?: boolean;
};

type SignupLocationType = 'headquarters' | 'branch' | 'warehouse' | 'remote_site' | 'other';

type SignupLocation = {
  name: string;
  locationType: SignupLocationType;
  address: string;
  lat: number | null;
  lng: number | null;
  radius: number;
  isPrimary: boolean;
};

type SignupCustomRole = {
  name: string;
  description: string;
};

const locationTypeOptions: Array<{ value: SignupLocationType; labelKey: TranslationKey }> = [
  { value: 'headquarters', labelKey: 'signup.locationTypeHeadquarters' },
  { value: 'branch', labelKey: 'signup.locationTypeBranch' },
  { value: 'warehouse', labelKey: 'signup.locationTypeWarehouse' },
  { value: 'remote_site', labelKey: 'signup.locationTypeRemote' },
  { value: 'other', labelKey: 'signup.locationTypeOther' },
];

type CircleFeature = {
  type: 'Feature';
  properties: Record<string, never>;
  geometry: {
    type: 'Polygon';
    coordinates: number[][][];
  };
};

type EmptyFeatureCollection = {
  type: 'FeatureCollection';
  features: [];
};

type RadiusGeoJson = CircleFeature | EmptyFeatureCollection;
type LocationStatus = 'idle' | 'locating' | 'accurate' | 'approximate' | 'low_accuracy' | 'manual' | 'manual_coordinates' | 'error';
type MapStyleId = 'streets' | 'satellite';
type MapLibreModule = typeof import('maplibre-gl');
type PendingLocation = {
  lat: number;
  lng: number;
  accuracy: number;
} | null;

const neutralMapCenter: [number, number] = [0, 20];
const mapStyleOptions: Array<{ id: MapStyleId; labelKey: TranslationKey; maptilerId: string }> = [
  { id: 'streets', labelKey: 'signup.mapStyleStreets', maptilerId: 'streets-v2' },
  { id: 'satellite', labelKey: 'signup.mapStyleSatellite', maptilerId: 'satellite' },
];

const toRadians = (degrees: number) => degrees * (Math.PI / 180);
const toDegrees = (radians: number) => radians * (180 / Math.PI);

function createCirclePolygon(lng: number, lat: number, radiusMeters: number, steps = 96): CircleFeature {
  const earthRadiusMeters = 6371008.8;
  const angularDistance = radiusMeters / earthRadiusMeters;
  const latRadians = toRadians(lat);
  const lngRadians = toRadians(lng);
  const coordinates: number[][] = [];

  for (let index = 0; index <= steps; index += 1) {
    const bearing = (index / steps) * Math.PI * 2;
    const pointLat = Math.asin(
      Math.sin(latRadians) * Math.cos(angularDistance) +
      Math.cos(latRadians) * Math.sin(angularDistance) * Math.cos(bearing),
    );
    const pointLng = lngRadians + Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latRadians),
      Math.cos(angularDistance) - Math.sin(latRadians) * Math.sin(pointLat),
    );

    coordinates.push([Number(toDegrees(pointLng).toFixed(7)), Number(toDegrees(pointLat).toFixed(7))]);
  }

  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [coordinates],
    },
  };
}

function createRadiusGeoJson(lng: number | null, lat: number | null, radiusMeters: number): RadiusGeoJson {
  if (lat === null || lng === null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { type: 'FeatureCollection', features: [] };
  }

  return createCirclePolygon(lng, lat, radiusMeters);
}

function mapStyleUrl(styleId: MapStyleId, key: string) {
  const style = mapStyleOptions.find((option) => option.id === styleId) || mapStyleOptions[0];
  return `https://api.maptiler.com/maps/${style.maptilerId}/style.json?key=${key}`;
}

const InteractiveMap = ({
  locationKey,
  lat,
  lng,
  radius,
  setLat,
  setLng,
  setRadius,
  locationAccuracy,
  disabled = false,
}: InteractiveMapProps) => {
  const { t } = useLanguage();
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const maplibreModuleRef = useRef<MapLibreModule | null>(null);
  const mapInstanceRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<MapLibreMarker | null>(null);
  const lastCenterRef = useRef<[number, number] | null>(null);
  const setLatRef = useRef(setLat);
  const setLngRef = useRef(setLng);
  const latRef = useRef(lat);
  const lngRef = useRef(lng);
  const radiusRef = useRef(radius);
  const currentMapStyleRef = useRef<MapStyleId>('streets');

  const [manualMode, setManualMode] = useState(false);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>('idle');
  const [mapStatus, setMapStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [selectedMapStyle, setSelectedMapStyle] = useState<MapStyleId>('streets');
  const [accuracy, setAccuracy] = useState<number | null>(locationAccuracy ?? null);
  const [pendingLocation, setPendingLocation] = useState<PendingLocation>(null);
  const [coordinateError, setCoordinateError] = useState('');
  const maptilerKey = import.meta.env.VITE_MAPTILER_KEY as string | undefined;
  const hasCoordinates = lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng);
  const locationStatusCopy: Record<LocationStatus, string> = {
    idle: hasCoordinates
      ? t('signup.geofenceInstruction')
      : t('signup.useMyLocation'),
    locating: t('signup.detecting'),
    accurate: t('signup.locationDetected'),
    approximate: t('signup.approximateLocation'),
    low_accuracy: t('signup.lowAccuracyLocation'),
    manual: t('signup.manualAdjustment'),
    manual_coordinates: t('signup.manualCoordinates'),
    error: t('signup.mapUnavailable'),
  };

  const ensureRadiusLayer = (map: MapLibreMap) => {
    if (!map.isStyleLoaded()) return;

    if (!map.getSource('signup-geofence-radius')) {
      map.addSource('signup-geofence-radius', {
        type: 'geojson',
        data: createRadiusGeoJson(lngRef.current, latRef.current, radiusRef.current),
      });
    }

    if (!map.getLayer('signup-geofence-radius-fill')) {
      map.addLayer({
        id: 'signup-geofence-radius-fill',
        type: 'fill',
        source: 'signup-geofence-radius',
        paint: {
          'fill-color': '#10b981',
          'fill-opacity': 0.16,
        },
      });
    }

    if (!map.getLayer('signup-geofence-radius-outline')) {
      map.addLayer({
        id: 'signup-geofence-radius-outline',
        type: 'line',
        source: 'signup-geofence-radius',
        paint: {
          'line-color': '#34d399',
          'line-width': 2,
          'line-opacity': 0.9,
        },
      });
    }

    const source = map.getSource('signup-geofence-radius') as GeoJSONSource | undefined;
    source?.setData(createRadiusGeoJson(lngRef.current, latRef.current, radiusRef.current));
  };

  useEffect(() => {
    setLatRef.current = setLat;
    setLngRef.current = setLng;
    latRef.current = lat;
    lngRef.current = lng;
    radiusRef.current = radius;
  }, [lat, lng, radius, setLat, setLng]);

  useEffect(() => {
    setPendingLocation(null);
    setLocationStatus('idle');
    setAccuracy(locationAccuracy ?? null);
  }, [locationAccuracy, locationKey]);

  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current || !maptilerKey) return;

    const initialCenter: [number, number] = hasCoordinates ? [lng, lat] : neutralMapCenter;
    let disposed = false;
    let resizeObserver: ResizeObserver | undefined;

    const loadMap = async () => {
      setMapStatus('loading');

      try {
        const [maplibreModule] = await Promise.all([
          import('maplibre-gl'),
          import('maplibre-gl/dist/maplibre-gl.css'),
        ]);

        if (disposed || !mapContainerRef.current) return;

        maplibreModuleRef.current = maplibreModule;
        const maplibre = maplibreModule;
        const map = new maplibre.Map({
          container: mapContainerRef.current,
          style: mapStyleUrl(selectedMapStyle, maptilerKey),
          center: initialCenter,
          zoom: hasCoordinates ? 15 : 1.5,
          attributionControl: { compact: true },
        });

        mapInstanceRef.current = map;
        currentMapStyleRef.current = selectedMapStyle;
        lastCenterRef.current = hasCoordinates ? initialCenter : null;
        map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'bottom-right');

        resizeObserver = new ResizeObserver(() => {
          if (mapContainerRef.current?.clientWidth && mapContainerRef.current?.clientHeight) {
            map.resize();
          }
        });
        resizeObserver.observe(mapContainerRef.current);

        map.on('load', () => {
          ensureRadiusLayer(map);
          setMapStatus('ready');
          requestAnimationFrame(() => map.resize());
        });

        map.on('error', () => setMapStatus('error'));

        requestAnimationFrame(() => map.resize());
      } catch {
        if (!disposed) setMapStatus('error');
      }
    };

    void loadMap();

    return () => {
      disposed = true;
      mapInstanceRef.current?.remove();
      mapInstanceRef.current = null;
      markerRef.current = null;
      resizeObserver?.disconnect();
    };
  }, [maptilerKey]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !maptilerKey) return;
    if (currentMapStyleRef.current === selectedMapStyle) return;

    const currentCenter = map.getCenter();
    const currentZoom = map.getZoom();
    currentMapStyleRef.current = selectedMapStyle;
    setMapStatus('loading');

    const restoreMapOverlays = () => {
      map.jumpTo({
        center: [currentCenter.lng, currentCenter.lat],
        zoom: currentZoom,
      });
      ensureRadiusLayer(map);
      setMapStatus('ready');
      requestAnimationFrame(() => map.resize());
    };

    map.once('style.load', restoreMapOverlays);
    map.setStyle(mapStyleUrl(selectedMapStyle, maptilerKey));

    return () => {
      map.off('style.load', restoreMapOverlays);
    };
  }, [maptilerKey, selectedMapStyle]);

  useEffect(() => {
    if (locationAccuracy !== undefined) {
      setAccuracy(locationAccuracy);
    }
  }, [locationAccuracy]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const source = map.getSource('signup-geofence-radius') as GeoJSONSource | undefined;
    source?.setData(createRadiusGeoJson(lng, lat, radius));

    if (!hasCoordinates) {
      markerRef.current?.remove();
      markerRef.current = null;
      lastCenterRef.current = null;
      return;
    }

    const nextCenter: [number, number] = [lng, lat];

    if (!markerRef.current) {
      const markerElement = document.createElement('div');
      markerElement.className = 'h-7 w-7 rounded-full border-[3px] border-black bg-emerald-500 shadow-[0_0_0_5px_rgba(16,185,129,0.25),0_0_28px_rgba(16,185,129,0.65)]';
      const maplibre = maplibreModuleRef.current;
      if (!maplibre) return;

      const marker = new maplibre.Marker({
        element: markerElement,
        draggable: !disabled,
      })
        .setLngLat(nextCenter)
        .addTo(map);

      marker.on('dragend', () => {
        const position = marker.getLngLat();

        setLatRef.current(Number(position.lat.toFixed(6)));
        setLngRef.current(Number(position.lng.toFixed(6)));
        setLocationStatus('manual');
      });

      markerRef.current = marker;
    }

    const marker = markerRef.current;
    marker.setLngLat(nextCenter);
    marker.setDraggable(!disabled);

    const previousCenter = lastCenterRef.current;
    const movedFarEnough = !previousCenter ||
      Math.abs(previousCenter[0] - lng) > 0.000001 ||
      Math.abs(previousCenter[1] - lat) > 0.000001;

    if (movedFarEnough) {
      map.easeTo({
        center: nextCenter,
        zoom: Math.max(map.getZoom(), 15),
        duration: 450,
      });
      lastCenterRef.current = nextCenter;
    }

  }, [disabled, hasCoordinates, lat, lng, radius]);

  const useCurrentLocation = (event?: React.MouseEvent<HTMLButtonElement>) => {
    event?.preventDefault();
    event?.stopPropagation();

    if (!navigator.geolocation) {
      setLocationStatus('error');
      return;
    }

    setLocationStatus('locating');
    setPendingLocation(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nextLat = Number(position.coords.latitude.toFixed(6));
        const nextLng = Number(position.coords.longitude.toFixed(6));
        const nextAccuracy = Math.round(position.coords.accuracy);

        setAccuracy(nextAccuracy);

        if (nextAccuracy > 1000) {
          setPendingLocation({ lat: nextLat, lng: nextLng, accuracy: nextAccuracy });
          setLocationStatus('low_accuracy');
          return;
        }

        setLat(nextLat);
        setLng(nextLng);

        mapInstanceRef.current?.flyTo({
          center: [nextLng, nextLat],
          zoom: 16,
          duration: 700,
        });
        lastCenterRef.current = [nextLng, nextLat];

        setLocationStatus(nextAccuracy <= 100 ? 'accurate' : 'approximate');
      },
      () => {
        setLocationStatus('error');
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  };

  const useApproximateLocation = (event?: React.MouseEvent<HTMLButtonElement>) => {
    event?.preventDefault();
    event?.stopPropagation();

    if (!pendingLocation) return;

    setLat(pendingLocation.lat);
    setLng(pendingLocation.lng);
    setAccuracy(pendingLocation.accuracy);
    setLocationStatus('approximate');
    setPendingLocation(null);

    mapInstanceRef.current?.flyTo({
      center: [pendingLocation.lng, pendingLocation.lat],
      zoom: 14,
      duration: 700,
    });
    lastCenterRef.current = [pendingLocation.lng, pendingLocation.lat];
  };

  const applyManualLatitude = (value: string) => {
    if (value === '') return;

    const nextLat = Number(value);
    if (!Number.isFinite(nextLat) || nextLat < -90 || nextLat > 90) {
      setCoordinateError(t('signup.latitudeValidation'));
      return;
    }

    setLat(Number(nextLat.toFixed(6)));
    setPendingLocation(null);
    setCoordinateError('');
    setLocationStatus('manual_coordinates');
  };

  const applyManualLongitude = (value: string) => {
    if (value === '') return;

    const nextLng = Number(value);
    if (!Number.isFinite(nextLng) || nextLng < -180 || nextLng > 180) {
      setCoordinateError(t('signup.longitudeValidation'));
      return;
    }

    setLng(Number(nextLng.toFixed(6)));
    setPendingLocation(null);
    setCoordinateError('');
    setLocationStatus('manual_coordinates');
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-emerald-500/15 bg-[#04110d]/80 p-3">
        <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">
              Worksite Geofence
            </p>
            <p className="mt-1 text-[11px] text-emerald-100/45">
              Drag the pin to the exact office entrance or worksite center.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="inline-flex rounded-lg border border-emerald-500/15 bg-black/25 p-1">
              {mapStyleOptions.map((style) => (
                <button
                  key={style.id}
                  type="button"
                  aria-label={`${t('signup.locationType')}: ${t(style.labelKey)}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setSelectedMapStyle(style.id);
                  }}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition',
                    selectedMapStyle === style.id
                      ? 'bg-emerald-500 text-black'
                      : 'text-emerald-100/55 hover:text-emerald-200',
                  )}
                >
                  {t(style.labelKey)}
                </button>
              ))}
            </div>

            <button
              type="button"
              aria-label={t('signup.useMyLocation')}
              onClick={useCurrentLocation}
              disabled={locationStatus === 'locating'}
              className="w-full rounded-lg bg-emerald-500 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-black transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-70 sm:w-auto"
            >
              {locationStatus === 'locating' ? t('signup.detecting') : t('signup.useMyLocation')}
            </button>
          </div>
        </div>

        <div className="relative min-h-[300px] overflow-hidden rounded-xl border border-emerald-500/15 bg-black [backface-visibility:hidden]">
          <div ref={mapContainerRef} className="h-[300px] min-h-[300px] w-full md:h-[400px] md:min-h-[400px]" />

          {!maptilerKey && (
            <div className="absolute inset-0 z-[600] flex items-center justify-center bg-black/80 px-6 text-center backdrop-blur-sm">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-emerald-400">
                  {t('signup.mapKeyMissing')}
                </p>
                <p className="mt-2 text-[11px] text-emerald-100/50">
                  {t('signup.mapKeyMissingHelp')}
                </p>
              </div>
            </div>
          )}

          {maptilerKey && mapStatus === 'loading' && (
            <div className="absolute inset-0 z-[550] flex items-center justify-center bg-black/50 px-6 text-center backdrop-blur-[1px]">
              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">
                {t('signup.mapLoading')}
              </p>
            </div>
          )}

          {mapStatus === 'error' && (
            <div className="absolute inset-0 z-[600] flex items-center justify-center bg-black/80 px-6 text-center backdrop-blur-sm">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-emerald-400">
                  {t('signup.mapUnavailable')}
                </p>
                <p className="mt-2 text-[11px] text-emerald-100/50">
                  {t('signup.mapUnavailableHelp')}
                </p>
              </div>
            </div>
          )}

          <div className="pointer-events-none absolute inset-0 rounded-xl border border-emerald-500/10 shadow-[inset_0_0_45px_rgba(16,185,129,0.12)]" />
        </div>

        <div className={cn(
          'mt-3 rounded-lg border px-3 py-2 text-[11px]',
          locationStatus === 'error'
            ? 'border-red-500/30 bg-red-950/50 text-red-200'
            : locationStatus === 'low_accuracy' || locationStatus === 'approximate'
              ? 'border-amber-500/25 bg-amber-950/20 text-amber-100/85'
              : 'border-emerald-500/15 bg-black/25 text-emerald-100/65',
        )}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-bold uppercase tracking-widest">
                {locationStatus === 'low_accuracy' ? t('signup.lowAccuracyLocation') : locationStatus === 'approximate' ? t('signup.approximateLocation') : locationStatus === 'accurate' ? t('signup.locationDetected') : locationStatus === 'manual' ? t('signup.manualAdjustment') : locationStatus === 'manual_coordinates' ? t('signup.manualCoordinates') : t('signup.locationStatus')}
              </p>
              <p className="mt-1">{locationStatusCopy[locationStatus]}</p>
              {locationStatus === 'low_accuracy' && (
                <p className="mt-1 text-amber-100/70">
                  {t('signup.approximateWarning')}
                </p>
              )}
            </div>
            {pendingLocation && locationStatus === 'low_accuracy' && (
              <button
                type="button"
                aria-label={t('signup.useApproximateAnyway')}
                onClick={useApproximateLocation}
                className="rounded-lg border border-amber-300/30 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-amber-100 transition hover:border-amber-200/60"
              >
                {t('signup.useApproximateAnyway')}
              </button>
            )}
          </div>
        </div>

        <p className="mt-2 text-[9px] text-emerald-100/35">
          {t('signup.mapProviderNote')}
        </p>
        <div className="mt-2 flex gap-2 rounded-lg border border-emerald-500/15 bg-black/20 px-3 py-2 text-[10px] leading-4 text-emerald-100/55">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden="true" />
          <div>
            <p className="font-bold text-emerald-200">{t('demo.mapNoticeTitle')}</p>
            <p className="mt-0.5">{t('demo.mapNoticeBody')}</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-emerald-500/15 bg-[#04110d]/60 p-4">
        <div className="mb-4 grid grid-cols-1 gap-2 md:grid-cols-2">
          <div className="rounded-lg border border-emerald-500/10 bg-black/25 px-3 py-2">
            <p className="text-xs font-bold uppercase tracking-widest text-emerald-100/45">{t('signup.latitude')}</p>
            <p className="mt-1 font-mono text-xs text-emerald-300">{lat === null ? t('signup.notSelected') : lat.toFixed(7)}</p>
          </div>
          <div className="rounded-lg border border-emerald-500/10 bg-black/25 px-3 py-2">
            <p className="text-xs font-bold uppercase tracking-widest text-emerald-100/45">{t('signup.longitude')}</p>
            <p className="mt-1 font-mono text-xs text-emerald-300">{lng === null ? t('signup.notSelected') : lng.toFixed(7)}</p>
          </div>
        </div>

        {accuracy !== null && (
          <div className="mb-4 rounded-lg border border-emerald-500/10 bg-black/25 px-3 py-2">
            <p className="text-xs font-bold uppercase tracking-widest text-emerald-100/45">
              {t('signup.locationAccuracy')}
            </p>
            <p className="mt-1 text-xs text-emerald-300">±{accuracy} {t('signup.meters')}</p>
            {accuracy > 100 && (
              <p className="mt-1 text-[11px] text-amber-200/80">
                {t('signup.accuracyHelp')}
              </p>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-emerald-400">
              {t('signup.geofenceRadius')}
            </p>
            <p className="text-[11px] text-emerald-100/45">
              {t('signup.geofenceRadiusHelp')}
            </p>
          </div>

          <span className="rounded-lg border border-emerald-500/20 bg-black/35 px-3 py-1 text-xs font-bold text-emerald-300">
            {radius}m
          </span>
        </div>

        <input
          type="range"
          aria-label={t('signup.geofenceRadius')}
          min="25"
          max="5000"
          step="25"
          value={radius}
          onChange={(e) => setRadius(Number(e.target.value))}
          className="mt-4 w-full accent-emerald-500"
        />

        <div className="mt-2 flex justify-between text-[10px] text-emerald-100/35">
          <span>25m</span>
          <span>5000m</span>
        </div>
      </div>

      <button
        type="button"
        aria-label={manualMode ? t('signup.hideManualCoordinates') : t('signup.enterCoordinatesManually')}
        onClick={() => setManualMode((prev) => !prev)}
        className="text-[10px] font-bold uppercase tracking-widest text-emerald-100/45 transition hover:text-emerald-400"
      >
        {manualMode ? t('signup.hideManualCoordinates') : t('signup.enterCoordinatesManually')}
      </button>

      {manualMode && (
        <div className="rounded-xl border border-emerald-500/15 bg-[#04110d]/60 p-4">
          <div className="mb-4 rounded-lg border border-emerald-500/10 bg-black/25 p-3">
            <p className="text-xs font-bold uppercase tracking-widest text-emerald-300">{t('signup.howToGetCoordinates')}</p>
            <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs leading-5 text-emerald-100/65">
              <li>{t('signup.coordinateStepGoogleMaps')}</li>
              <li>{t('signup.coordinateStepPress')}</li>
              <li>{t('signup.coordinateStepCopy')}</li>
              <li>{t('signup.coordinateStepPaste')}</li>
              <li>{t('signup.coordinateStepConfirm')}</li>
            </ol>
            <p className="mt-2 text-xs text-emerald-100/45">
              {t('signup.coordinateOrderHelp')}
            </p>
            <div className="mt-3 grid grid-cols-1 gap-2 rounded-lg border border-emerald-500/10 bg-black/25 p-3 font-mono text-xs text-emerald-200 sm:grid-cols-2">
              <span>{t('signup.latitude')}: 30.0444</span>
              <span>{t('signup.longitude')}: 31.2357</span>
            </div>
          </div>

          {coordinateError && (
            <p className="mb-3 rounded-lg border border-red-500/25 bg-red-950/35 px-3 py-2 text-xs text-red-200">
              {coordinateError}
            </p>
          )}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase tracking-widest text-emerald-100/55">
                {t('signup.latitude')}
              </label>
              <input
                type="number"
                aria-label={t('signup.latitude')}
                step="0.000001"
                min="-90"
                max="90"
                value={lat ?? ''}
                onChange={(e) => applyManualLatitude(e.target.value)}
                placeholder="30.0444"
                className="w-full rounded-lg border border-emerald-500/15 bg-[#04110d]/80 px-3 py-2 text-xs font-mono text-emerald-50 outline-none transition focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold uppercase tracking-widest text-emerald-100/55">
                {t('signup.longitude')}
              </label>
              <input
                type="number"
                aria-label={t('signup.longitude')}
                step="0.000001"
                min="-180"
                max="180"
                value={lng ?? ''}
                onChange={(e) => applyManualLongitude(e.target.value)}
                placeholder="31.2357"
                className="w-full rounded-lg border border-emerald-500/15 bg-[#04110d]/80 px-3 py-2 text-xs font-mono text-emerald-50 outline-none transition focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold uppercase tracking-widest text-emerald-100/55">
                {t('signup.radius')}
              </label>
              <input
                type="number"
                aria-label={t('signup.radius')}
                min="25"
                max="5000"
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
                className="w-full rounded-lg border border-emerald-500/15 bg-[#04110d]/80 px-3 py-2 text-xs font-mono text-emerald-50 outline-none transition focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export function Signup({ onNavigateLogin, onSignupComplete, onPulseStateChange }: {
  onNavigateLogin: () => void;
  onSignupComplete: (user?: AuthUser) => void;
  onPulseStateChange?: (pulseState: AuthVisualState) => void;
}) {
  const { t, isRtl } = useLanguage();
  const formRef = useRef<HTMLFormElement | null>(null);
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>({});
  const [formError, setFormError] = useState('');
  const [registerFieldErrors, setRegisterFieldErrors] = useState<Record<string, string>>({});
  const [showPrivacyPolicy, setShowPrivacyPolicy] = useState(false);
  useEffect(() => {
    onPulseStateChange?.(isSubmitting ? 'loading' : 'idle');
  }, [isSubmitting, onPulseStateChange]);
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Form State
const [formData, setFormData] = useState<{
  companyName: string;
  tenantSlug: string;
  adminFullName: string;
  adminEmail: string;
  adminPassword: string;
  adminRole: string;
  currency: string;
  capacity: string;
  allowsLoans: boolean;
  lat: number | null;
  lng: number | null;
  radius: number;
}>({
  companyName: '',
  tenantSlug: '',
  adminFullName: '',
  adminEmail: '',
  adminPassword: '',
  adminRole: 'hr_admin',
  currency: 'USD',
  capacity: '100-500',
  allowsLoans: false,
  lat: null,
  lng: null,
  radius: 100
});
  const [locations, setLocations] = useState<SignupLocation[]>([
    {
      name: t('signup.locationTypeHeadquarters'),
      locationType: 'headquarters',
      address: '',
      lat: null,
      lng: null,
      radius: 100,
      isPrimary: true,
    },
  ]);
  const [customRoles, setCustomRoles] = useState<SignupCustomRole[]>([]);
  const [selectedLocationIndex, setSelectedLocationIndex] = useState(0);

  const selectedLocation = locations[selectedLocationIndex] || locations[0];
  const adminEmailValidation = validateEmail(formData.adminEmail);
  const adminPasswordValidation = validatePasswordStrength(formData.adminPassword);
  const confirmPasswordValid = Boolean(confirmPassword) && confirmPassword === formData.adminPassword;
  const showAdminEmailError = (touchedFields.adminEmail || Boolean(formData.adminEmail.trim())) && !adminEmailValidation.valid;
  const adminEmailServerError = registerFieldErrors.adminEmail;
  const tenantSlugServerError = registerFieldErrors.tenantSlug;
  const showAdminPasswordChecklist = touchedFields.adminPassword || Boolean(formData.adminPassword);
  const showConfirmPasswordError = touchedFields.confirmPassword && !confirmPasswordValid;
  const passwordRuleTranslationKeys: Record<PasswordRuleKey, Parameters<typeof t>[0]> = {
    length: 'validation.passwordLength',
    uppercase: 'validation.passwordUppercase',
    lowercase: 'validation.passwordLowercase',
    number: 'validation.passwordNumber',
    special: 'validation.passwordSpecial',
  };
  const stepOneValid = Boolean(
    formData.companyName.trim() &&
    formData.tenantSlug.trim() &&
    formData.adminFullName.trim() &&
    adminEmailValidation.valid &&
    adminPasswordValidation.valid &&
    confirmPasswordValid
  );

  const updateLocation = (index: number, updates: Partial<SignupLocation>) => {
    setLocations((current) => current.map((location, locationIndex) => (
      locationIndex === index ? { ...location, ...updates } : location
    )));
  };

  const addLocation = () => {
    setLocations((current) => {
      const nextLocation: SignupLocation = {
        name: `Branch ${current.length}`,
        locationType: 'branch',
        address: '',
        lat: selectedLocation?.lat ?? null,
        lng: selectedLocation?.lng ?? null,
        radius: selectedLocation?.radius || 100,
        isPrimary: false,
      };

      setSelectedLocationIndex(current.length);
      return [...current, nextLocation];
    });
  };

  const removeLocation = (index: number) => {
    if (locations.length === 1) return;

    setLocations((current) => {
      const removedWasPrimary = current[index]?.isPrimary;
      const nextLocations = current.filter((_, locationIndex) => locationIndex !== index);

      if (removedWasPrimary && nextLocations[0]) {
        nextLocations[0] = { ...nextLocations[0], isPrimary: true };
      }

      setSelectedLocationIndex(Math.max(0, Math.min(index - 1, nextLocations.length - 1)));
      return nextLocations;
    });
  };

  const setPrimaryLocation = (index: number) => {
    setLocations((current) => current.map((location, locationIndex) => ({
      ...location,
      isPrimary: locationIndex === index,
      locationType: locationIndex === index && location.locationType === 'branch' && index === 0 ? 'headquarters' : location.locationType,
    })));
  };

  const addCustomRole = () => {
    setCustomRoles((current) => [...current, { name: '', description: '' }]);
  };

  const updateCustomRole = (index: number, updates: Partial<SignupCustomRole>) => {
    setCustomRoles((current) => current.map((role, roleIndex) => (
      roleIndex === index ? { ...role, ...updates } : role
    )));
  };

  const removeCustomRole = (index: number) => {
    setCustomRoles((current) => current.filter((_, roleIndex) => roleIndex !== index));
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const val = type === 'checkbox' ? (e.target as HTMLInputElement).checked : value;
    setFormData(prev => ({ ...prev, [name]: val }));
    if (formError) setFormError('');
    if (registerFieldErrors[name]) {
      setRegisterFieldErrors((current) => {
        const next = { ...current };
        delete next[name];
        return next;
      });
    }
  };

  const markTouched = (field: string) => {
    setTouchedFields((current) => ({ ...current, [field]: true }));
  };

  const nextStep = () => setStep(prev => Math.min(prev + 1, 3));
  const prevStep = () => setStep(prev => Math.max(prev - 1, 1));

  const handleNextStep = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (formRef.current && !formRef.current.reportValidity()) {
      return;
    }

    if (step === 1) {
      setTouchedFields((current) => ({
        ...current,
        adminEmail: true,
        adminPassword: true,
        confirmPassword: true,
      }));

      if (!stepOneValid) {
        setFormError(!adminEmailValidation.valid ? t('validation.email') : t('validation.passwordChecklist'));
        return;
      }
    }

    nextStep();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step < 3) {
      if (step === 1 && !stepOneValid) {
        setTouchedFields((current) => ({
          ...current,
          adminEmail: true,
          adminPassword: true,
          confirmPassword: true,
        }));
        setFormError(!adminEmailValidation.valid ? t('validation.email') : t('validation.passwordChecklist'));
        return;
      }
      nextStep();
      return;
    }

    if (!stepOneValid) {
      setTouchedFields((current) => ({
        ...current,
        adminEmail: true,
        adminPassword: true,
        confirmPassword: true,
      }));
      setFormError(!adminEmailValidation.valid ? t('validation.email') : t('validation.passwordChecklist'));
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      const primaryLocation = locations.find((location) => location.isPrimary) || locations[0];
      const locationsHaveCoordinates = locations.every((location) => (
        location.lat !== null &&
        location.lng !== null &&
        Number.isFinite(location.lat) &&
        Number.isFinite(location.lng)
      ));

      if (!primaryLocation || !locationsHaveCoordinates) {
        setFormError(t('validation.companyLocationRequired'));
        setIsSubmitting(false);
        return;
      }

      if (locations.some((location) => !validateRadiusMeters(location.radius))) {
        setFormError(t('signup.radiusValidation'));
        setIsSubmitting(false);
        return;
      }

      const normalizedLocations = locations.map((location) => ({
        ...location,
        lat: location.lat as number,
        lng: location.lng as number,
      }));
      const normalizedPrimaryLocation = normalizedLocations.find((location) => location.isPrimary) || normalizedLocations[0];

      const res = await fetch(apiUrl('/api/auth/register-tenant'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          adminEmail: adminEmailValidation.value,
          lat: normalizedPrimaryLocation.lat,
          lng: normalizedPrimaryLocation.lng,
          radius: normalizedPrimaryLocation.radius,
          locations: normalizedLocations,
          customRoles: customRoles.filter((role) => role.name.trim()),
        })
      });
      const data = await res.json();
      
      if (data.success) {
        if (data.user) {
          window.localStorage.setItem('horizon-auth-user', JSON.stringify(data.user));
        }
        onSignupComplete(data.user);
      } else {
        const duplicateEmail = data.code === 'EMAIL_UNAVAILABLE';
        const duplicateWorkspace = data.code === 'WORKSPACE_UNAVAILABLE';
        const rateLimited = data.code === 'RATE_LIMITED';
        const fieldErrors = duplicateEmail
          ? { adminEmail: t('signup.emailUnavailable') }
          : duplicateWorkspace
            ? { tenantSlug: t('signup.workspaceUnavailable') }
            : data.fields || {};

        setRegisterFieldErrors(fieldErrors);
        setFormError(
          duplicateEmail
            ? t('signup.emailUnavailable')
            : duplicateWorkspace
              ? t('signup.workspaceUnavailable')
              : rateLimited
                ? t('signup.rateLimited')
              : data.message || data.error || t('signup.registerError'),
        );
        setIsSubmitting(false);
      }
    } catch(err) {
      setFormError('Unable to reach the server. Check the backend connection and try again.');
      setIsSubmitting(false);
    }
  };

  return (
<div className="relative isolate min-h-[100dvh] w-full overflow-x-hidden bg-transparent px-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-[calc(env(safe-area-inset-top)+1rem)] font-sans transition-colors duration-300 md:px-6 md:py-8">

      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
className={cn(
  "relative z-10 mx-auto w-full rounded-2xl border border-slate-200 bg-white/95 px-5 py-6 shadow-xl backdrop-blur-none transition-[max-width] duration-300 dark:border-emerald-500/12 dark:bg-[#030b08]/88 dark:shadow-[0_0_42px_rgba(16,185,129,0.055)] md:bg-white/85 md:backdrop-blur-xl md:dark:bg-[#030b08]/70 md:p-8",
  step === 3 ? "max-w-5xl" : "max-w-2xl"
)}      >
        {isSubmitting && <AuthTransitionLoader transition="creating-workspace" contained />}
        <div className="mb-6 flex flex-col items-center justify-between gap-4 md:flex-row">
          <div className="flex items-center gap-4">
<div className="w-12 h-12 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center justify-center text-emerald-600 dark:text-emerald-400 shadow-[0_0_25px_rgba(16,185,129,0.18)]">              <Building2 className="w-6 h-6" />
            </div>
            <div>
<h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{t('signup.title')}</h1>
<p className="text-sm text-emerald-700/70 dark:text-emerald-100/55">{t('signup.subtitle')}</p>
            </div>
          </div>
          
          <div className="flex gap-2">
            {[1, 2, 3].map(i => (
              <div key={i} className={cn("w-3 h-3 rounded-full transition-all", step >= i ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-emerald-950/60 border border-emerald-500/10")} />
            ))}
          </div>
        </div>

        <form ref={formRef} onSubmit={handleSubmit} className="space-y-6">
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                <h2 className="text-sm font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400 mb-4 border-b border-emerald-500/20 pb-2">{t('signup.step1')}</h2>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-emerald-700/80 dark:text-emerald-100/70 uppercase px-1">{t('signup.companyName')}</label>
                    <input required aria-label={t('signup.companyName')} name="companyName" value={formData.companyName} onChange={handleChange} className={cn(
  "w-full bg-white/80 dark:bg-[#04110d]/80 border border-emerald-500/15 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500/50 text-slate-900 dark:text-emerald-50 placeholder:text-emerald-900/70 transition-all",
  isRtl && "text-right"
)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-emerald-700/80 dark:text-emerald-100/70 uppercase px-1">{t('signup.tenantSlug')}</label>
                    <input required aria-invalid={Boolean(tenantSlugServerError)} aria-describedby={tenantSlugServerError ? 'signup-tenant-slug-error' : undefined} aria-label={t('signup.tenantSlug')} name="tenantSlug" value={formData.tenantSlug} onChange={handleChange} className={cn(
  "w-full bg-white/80 dark:bg-[#04110d]/80 border border-emerald-500/15 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500/50 font-mono text-slate-900 dark:text-emerald-50 placeholder:text-emerald-900/70 transition-all",
  isRtl && "text-right"
)} />
                    {tenantSlugServerError && (
                      <p id="signup-tenant-slug-error" className="px-1 text-xs font-medium text-red-500">{tenantSlugServerError}</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-emerald-700/80 dark:text-emerald-100/70 uppercase px-1">{t('signup.adminFullName')}</label>
                    <input required aria-label={t('signup.adminFullName')} name="adminFullName" value={formData.adminFullName} onChange={handleChange} className={cn(
  "w-full bg-white/80 dark:bg-[#04110d]/80 border border-emerald-500/15 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500/50 text-slate-900 dark:text-emerald-50 placeholder:text-emerald-900/70 transition-all",
  isRtl && "text-right"
)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-emerald-700/80 dark:text-emerald-100/70 uppercase px-1">{t('signup.adminEmail')}</label>
                    <input
                      type="email"
                      required
                      aria-invalid={showAdminEmailError || Boolean(adminEmailServerError)}
                      aria-describedby={showAdminEmailError || adminEmailServerError ? 'signup-email-error' : undefined}
                      aria-label={t('signup.adminEmail')}
                      name="adminEmail"
                      value={formData.adminEmail}
                      onBlur={() => markTouched('adminEmail')}
                      onChange={handleChange}
                      className={cn(
  "w-full bg-white/80 dark:bg-[#04110d]/80 border border-emerald-500/15 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500/50 font-mono text-slate-900 dark:text-emerald-50 placeholder:text-emerald-900/70 transition-all",
  isRtl && "text-right"
)} />
                    {(showAdminEmailError || adminEmailServerError) && (
                      <p id="signup-email-error" className="px-1 text-xs font-medium text-red-500">{showAdminEmailError ? t('validation.email') : adminEmailServerError}</p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-emerald-700/80 dark:text-emerald-100/70 uppercase px-1">{t('signup.adminPass')}</label>
                    <div className="relative">
                    <input
                      type={showAdminPassword ? 'text' : 'password'}
                      required
                      minLength={8}
                      aria-label={t('signup.adminPass')}
                      name="adminPassword"
                      value={formData.adminPassword}
                      onBlur={() => markTouched('adminPassword')}
                      onChange={handleChange}
                      className={cn(
  "w-full bg-white/80 dark:bg-[#04110d]/80 border border-emerald-500/15 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500/50 font-mono text-slate-900 dark:text-emerald-50 placeholder:text-emerald-900/70 transition-all",
  isRtl ? "pl-12 text-right" : "pr-12"
)} />
                    <button type="button" onClick={() => setShowAdminPassword((current) => !current)} aria-label={showAdminPassword ? t('login.hidePassword') : t('login.showPassword')} title={showAdminPassword ? t('login.hidePassword') : t('login.showPassword')} aria-pressed={showAdminPassword} className={cn("absolute top-1/2 -translate-y-1/2 rounded p-1.5 text-emerald-700/70 transition hover:text-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 dark:text-emerald-100/55", isRtl ? "left-2" : "right-2")}>
                      {showAdminPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                    </div>
                    {showAdminPasswordChecklist && (
                      <div className="rounded-lg border border-emerald-500/15 bg-black/5 p-3 text-xs dark:bg-black/20">
                        <p className="mb-2 font-bold text-emerald-700 dark:text-emerald-200">{t('validation.passwordChecklist')}</p>
                        <ul className="space-y-1">
                          {adminPasswordValidation.rules.map((rule) => (
                            <li key={rule.key} className={cn("flex items-center gap-2", rule.valid ? "text-emerald-600 dark:text-emerald-300" : "text-neutral-500 dark:text-emerald-100/45")}>
                              <CheckCircle2 className={cn("h-3.5 w-3.5", rule.valid ? "opacity-100" : "opacity-25")} />
                              <span>{t(passwordRuleTranslationKeys[rule.key])}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-emerald-700/80 dark:text-emerald-100/70 uppercase px-1">{t('signup.confirmPass')}</label>
                    <div className="relative">
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      required
                      aria-invalid={showConfirmPasswordError}
                      aria-describedby={showConfirmPasswordError ? 'signup-confirm-password-error' : undefined}
                      aria-label={t('signup.confirmPass')}
                      value={confirmPassword}
                      onBlur={() => markTouched('confirmPassword')}
                      onChange={(event) => {
                        setConfirmPassword(event.target.value);
                        if (formError) setFormError('');
                      }}
                      className={cn(
                        "w-full bg-white/80 dark:bg-[#04110d]/80 border border-emerald-500/15 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500/50 font-mono text-slate-900 dark:text-emerald-50 placeholder:text-emerald-900/70 transition-all",
                        isRtl ? "pl-12 text-right" : "pr-12"
                      )}
                    />
                    <button type="button" onClick={() => setShowConfirmPassword((current) => !current)} aria-label={showConfirmPassword ? t('login.hidePassword') : t('login.showPassword')} title={showConfirmPassword ? t('login.hidePassword') : t('login.showPassword')} aria-pressed={showConfirmPassword} className={cn("absolute top-1/2 -translate-y-1/2 rounded p-1.5 text-emerald-700/70 transition hover:text-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 dark:text-emerald-100/55", isRtl ? "left-2" : "right-2")}>
                      {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                    </div>
                    {showConfirmPasswordError && (
                      <p id="signup-confirm-password-error" className="px-1 text-xs font-medium text-red-500">{t('validation.confirmPassword')}</p>
                    )}
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-emerald-700/80 dark:text-emerald-100/70 uppercase px-1">
                    Initial Account Role
                  </label>

                  <select
                    required
                    aria-label="Initial account role"
                    name="adminRole"
                    value={formData.adminRole}
                    onChange={handleChange}
                    className={cn(
                      "w-full bg-white/80 dark:bg-[#04110d]/80 border border-emerald-500/15 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500/50 font-mono text-slate-900 dark:text-emerald-50 transition-all",
                      isRtl && "text-right"
                    )}
                  >
                    <option value="hr_admin">HR Admin</option>
                    <option value="manager">Manager</option>
                    <option value="employee">Employee</option>
                  </select>

                  <p className="text-[10px] text-emerald-700/50 dark:text-emerald-100/40 px-1">
                    Choose the role for the first account created under this tenant.
                  </p>
                </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                <h2 className="text-sm font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400 mb-4 border-b border-emerald-500/20 pb-2">{t('signup.step2')}</h2>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-emerald-700/80 dark:text-emerald-100/70 uppercase px-1 flex items-center gap-2"><Wallet className="w-4 h-4"/>{t('signup.currency')}</label>
                    <select name="currency" aria-label={t('signup.currency')} value={formData.currency} onChange={handleChange} className={cn(
  "w-full bg-white/80 dark:bg-[#04110d]/80 border border-emerald-500/15 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500/50 font-mono text-slate-900 dark:text-emerald-50 transition-all",
  isRtl && "text-right"
)}>
                      <option value="USD">USD ($)</option>
                      <option value="EUR">EUR (€)</option>
                      <option value="GBP">GBP (£)</option>
                      <option value="AED">AED (د.إ)</option>
                      <option value="SAR">SAR (ر.س)</option>
                      <option value="EGP">EGP (ج.م)</option>
                    </select>
                  </div>
                  
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-emerald-700/80 dark:text-emerald-100/70 uppercase px-1">{t('signup.capacity')}</label>
                    <select name="capacity" aria-label={t('signup.capacity')} value={formData.capacity} onChange={handleChange} className={cn(
  "w-full bg-white/80 dark:bg-[#04110d]/80 border border-emerald-500/15 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500/50 font-mono text-slate-900 dark:text-emerald-50 transition-all",
  isRtl && "text-right"
)}>
                      <option value="1-50">1 - 50</option>
                      <option value="50-100">50 - 100</option>
                      <option value="100-500">100 - 500</option>
                      <option value="500+">500+</option>
                    </select>
                  </div>
                </div>

                <div className="pt-4">
                  <label className="flex items-center gap-3 p-4 border border-emerald-500/15 rounded-xl bg-white/70 dark:bg-[#04110d]/60 cursor-pointer hover:border-emerald-500/50 transition-colors">
                    <div className="relative flex items-center justify-center">
                      <input type="checkbox" aria-label={t('signup.loans')} name="allowsLoans" checked={formData.allowsLoans} onChange={handleChange} className="sr-only" />
                      <div className={cn("w-6 h-6 rounded border flex items-center justify-center transition-colors", formData.allowsLoans ? "bg-emerald-500 border-emerald-500" : "bg-transparent border-emerald-500/20 dark:border-emerald-500/20")}>
                        {formData.allowsLoans && <CheckCircle2 className="w-4 h-4 text-white" />}
                      </div>
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-slate-900 dark:text-white">{t('signup.loans')}</h3>
                      <p className="text-xs text-emerald-700/60 dark:text-emerald-100/45">{t('signup.enableLoansHelp')}</p>
                    </div>
                  </label>
                </div>

                <div className="rounded-xl border border-emerald-500/15 bg-white/70 p-4 dark:bg-[#04110d]/60">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-bold text-sm text-slate-900 dark:text-white">{t('signup.customRoles')}</h3>
                      <p className="text-xs text-emerald-700/60 dark:text-emerald-100/45">{t('signup.customRolesHelp')}</p>
                    </div>
                    <button
                      type="button"
                      aria-label={t('signup.addRole')}
                      onClick={addCustomRole}
                      className="rounded-lg border border-emerald-500/20 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-emerald-600 transition hover:border-emerald-400 dark:text-emerald-300"
                    >
                      {t('signup.addRole')}
                    </button>
                  </div>

                  <div className="space-y-2">
                    {customRoles.map((role, index) => (
                      <div key={index} className="grid grid-cols-1 gap-2 rounded-lg border border-emerald-500/10 p-3 md:grid-cols-[1fr_1fr_auto]">
                        <input
                          aria-label={`${t('signup.roleName')} ${index + 1}`}
                          value={role.name}
                          onChange={(event) => updateCustomRole(index, { name: event.target.value })}
                          placeholder={t('signup.roleName')}
                          className="rounded border border-emerald-500/15 bg-white/80 px-3 py-2 text-xs text-slate-900 outline-none focus:border-emerald-400 dark:bg-[#04110d]/80 dark:text-emerald-50"
                        />
                        <input
                          aria-label={`${t('signup.roleDescription')} ${index + 1}`}
                          value={role.description}
                          onChange={(event) => updateCustomRole(index, { description: event.target.value })}
                          placeholder={t('signup.roleDescription')}
                          className="rounded border border-emerald-500/15 bg-white/80 px-3 py-2 text-xs text-slate-900 outline-none focus:border-emerald-400 dark:bg-[#04110d]/80 dark:text-emerald-50"
                        />
                        <button
                          type="button"
                          aria-label={`${t('signup.remove')} ${index + 1}`}
                          onClick={() => removeCustomRole(index)}
                          className="rounded border border-red-500/20 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-red-500 transition hover:border-red-400"
                        >
                          {t('signup.remove')}
                        </button>
                      </div>
                    ))}
                    {customRoles.length === 0 && (
                      <p className="rounded-lg border border-emerald-500/10 p-3 text-xs text-emerald-700/50 dark:text-emerald-100/40">
                        {t('signup.noCustomRoles')}
                      </p>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                <h2 className="text-sm font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400 mb-4 border-b border-emerald-500/20 pb-2">{t('signup.step3')}</h2>

                <div className="grid grid-cols-1 gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
                  <div className="space-y-4">
                    <div className="rounded-xl border border-emerald-500/15 bg-white/70 p-4 dark:bg-[#04110d]/60">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-widest text-emerald-700/70 dark:text-emerald-100/55">
                            {t('signup.locations')}
                          </p>
                          <p className="mt-1 text-xs text-emerald-700/50 dark:text-emerald-100/35">
                            {t('signup.locationsHelp')}
                          </p>
                        </div>
                        <button
                          type="button"
                          aria-label={t('signup.addLocation')}
                          onClick={addLocation}
                          className="rounded-lg border border-emerald-500/20 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-600 transition hover:border-emerald-400 dark:text-emerald-300"
                        >
                          {t('signup.addLocation')}
                        </button>
                      </div>

                      <div className="space-y-2">
                        {locations.map((location, index) => (
                          <button
                            key={`${location.name}-${index}`}
                            type="button"
                            aria-label={`${t('signup.locationDetails')}: ${location.name || index + 1}`}
                            onClick={() => setSelectedLocationIndex(index)}
                            className={cn(
                              "w-full rounded-xl border p-3 text-left transition",
                              selectedLocationIndex === index
                                ? "border-emerald-500/50 bg-emerald-500/10"
                                : "border-emerald-500/15 bg-white/70 hover:border-emerald-500/35 dark:bg-black/25"
                            )}
                          >
                            <span className="block text-xs font-bold text-slate-900 dark:text-emerald-50">{location.name || t('signup.unnamedLocation')}</span>
                            <span className="mt-1 flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-widest text-emerald-700/60 dark:text-emerald-100/40">
                              <span>{t(locationTypeOptions.find((option) => option.value === location.locationType)?.labelKey || 'signup.locationTypeOther')}</span>
                              <span>{location.radius}m</span>
                              {location.lat !== null && location.lng !== null && <span>{t('signup.coordinatesSet')}</span>}
                              {location.isPrimary && <span className="text-emerald-500">{t('signup.primaryLocation')}</span>}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-xl border border-emerald-500/15 bg-white/70 p-4 dark:bg-[#04110d]/60">
                      <div className="mb-3">
                        <p className="text-xs font-bold uppercase tracking-widest text-emerald-700/70 dark:text-emerald-100/55">{t('signup.locationDetails')}</p>
                        <p className="mt-1 text-xs text-emerald-700/50 dark:text-emerald-100/35">{t('signup.locationDetailsHelp')}</p>
                      </div>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-emerald-100/50">{t('signup.locationName')}</label>
                          <input
                            aria-label={t('signup.locationName')}
                            value={selectedLocation.name}
                            onChange={(event) => updateLocation(selectedLocationIndex, { name: event.target.value })}
                            className="w-full rounded-lg border border-emerald-500/15 bg-white/80 px-3 py-2 text-xs text-slate-900 outline-none focus:border-emerald-400 dark:bg-[#04110d]/80 dark:text-emerald-50"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-emerald-100/50">{t('signup.locationType')}</label>
                          <select
                            aria-label={t('signup.locationType')}
                            value={selectedLocation.locationType}
                            onChange={(event) => updateLocation(selectedLocationIndex, { locationType: event.target.value as SignupLocationType })}
                            className="w-full rounded-lg border border-emerald-500/15 bg-white/80 px-3 py-2 text-xs text-slate-900 outline-none focus:border-emerald-400 dark:bg-[#04110d]/80 dark:text-emerald-50"
                          >
                            {locationTypeOptions.map((option) => (
                              <option key={option.value} value={option.value}>{t(option.labelKey)}</option>
                            ))}
                          </select>
                        </div>

                        <div className="space-y-1 md:col-span-2">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-emerald-100/50">{t('signup.addressOptional')}</label>
                          <input
                            aria-label={t('signup.addressOptional')}
                            value={selectedLocation.address}
                            onChange={(event) => updateLocation(selectedLocationIndex, { address: event.target.value })}
                            placeholder={t('signup.addressPlaceholder')}
                            className="w-full rounded-lg border border-emerald-500/15 bg-white/80 px-3 py-2 text-xs text-slate-900 outline-none focus:border-emerald-400 dark:bg-[#04110d]/80 dark:text-emerald-50"
                          />
                        </div>

                        <label className="flex items-center gap-3 rounded-lg border border-emerald-500/15 bg-black/10 px-3 py-2 dark:bg-black/20">
                          <input
                            type="checkbox"
                            aria-label={t('signup.primaryLocation')}
                            checked={selectedLocation.isPrimary}
                            onChange={() => setPrimaryLocation(selectedLocationIndex)}
                            className="h-4 w-4 accent-emerald-500"
                          />
                          <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-700/70 dark:text-emerald-100/55">{t('signup.primaryLocation')}</span>
                        </label>

                        <button
                          type="button"
                          aria-label={t('signup.removeLocation')}
                          onClick={() => removeLocation(selectedLocationIndex)}
                          disabled={locations.length === 1}
                          className="rounded-lg border border-red-500/20 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-red-500 transition hover:border-red-400 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {t('signup.removeLocation')}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="min-w-0 space-y-4">
                    <InteractiveMap 
                      locationKey={selectedLocationIndex}
                      lat={selectedLocation.lat}
                      lng={selectedLocation.lng}
                      radius={selectedLocation.radius}
                      setLat={(val: number) => {
                        updateLocation(selectedLocationIndex, { lat: val });
                        setFormData(p => ({ ...p, lat: val }));
                      }}
                      setLng={(val: number) => {
                        updateLocation(selectedLocationIndex, { lng: val });
                        setFormData(p => ({ ...p, lng: val }));
                      }}
                      setRadius={(val: number) => {
                        updateLocation(selectedLocationIndex, { radius: val });
                        setFormData(p => ({ ...p, radius: val }));
                      }}
                    />
                  </div>
                </div>

              </motion.div>
            )}
          </AnimatePresence>

          {formError && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-600 dark:text-red-300">
              <p>{formError}</p>
              {Object.keys(registerFieldErrors).length > 0 && (
                <ul className="mt-2 list-disc space-y-1 ps-5 font-medium">
                  {Object.entries(registerFieldErrors).map(([field, message]) => (
                    <li key={field}>{message}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Navigation Buttons */}
<div className="flex items-center justify-between pt-6 border-t border-emerald-500/10">             <button 
               type="button" 
               onClick={prevStep}
               className={cn("px-4 py-2 font-bold text-sm text-emerald-700/70 hover:text-emerald-600 dark:text-emerald-100/45 dark:hover:text-emerald-300 transition-colors flex items-center gap-2 uppercase tracking-widest", step === 1 && "invisible")}
             >
               <ArrowLeft className="w-4 h-4" /> {t('signup.back')}
             </button>

             <button 
               type={step < 3 ? 'button' : 'submit'}
               onClick={step < 3 ? handleNextStep : undefined}
               disabled={isSubmitting || (step === 1 && !stepOneValid)}
               className={cn("px-6 py-2.5 rounded-lg font-bold text-sm transition-all focus:outline-none flex items-center gap-2 uppercase tracking-widest shadow-lg", 
                 isSubmitting ? "bg-emerald-600 opacity-80 text-white" : 
                 "bg-gradient-to-tr from-emerald-600 to-emerald-400 text-slate-950 hover:scale-105 hover:shadow-[0_0_20px_rgba(16,185,129,0.4)]"
               )}
             >
               {isSubmitting ? (
                 <span className="flex items-center gap-2">
                   {t('signup.complete')}
                 </span>
               ) : step < 3 ? (
                 <>
                   {t('signup.next')} <ArrowRight className="w-4 h-4" />
                 </>
               ) : (
                 <>
                   <CheckCircle2 className="w-4 h-4" /> {t('signup.complete')}
                 </>
               )}
             </button>
          </div>
        </form>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-center">
            <button type="button" onClick={onNavigateLogin} className="text-[10px] font-bold text-emerald-700/70 hover:text-emerald-600 dark:text-emerald-100/45 dark:hover:text-emerald-400 tracking-widest uppercase transition-colors">
              {t('signup.login')}
            </button>
            <button type="button" onClick={() => setShowPrivacyPolicy(true)} className="text-[10px] font-bold text-emerald-700/70 hover:text-emerald-600 dark:text-emerald-100/45 dark:hover:text-emerald-400 tracking-widest uppercase transition-colors">
              {t('privacy.link')}
            </button>
        </div>

      </motion.div>
      <PrivacyPolicyModal open={showPrivacyPolicy} onClose={() => setShowPrivacyPolicy(false)} />
    </div>
  );
}
