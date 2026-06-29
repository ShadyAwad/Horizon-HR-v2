import React, { useEffect, useState ,useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { motion, AnimatePresence } from 'motion/react';
import { Fingerprint, CheckCircle2, ArrowRight, ArrowLeft, MapPin, Building2, Wallet, Settings2, Globe } from 'lucide-react';
import { cn } from '../lib/utils';
import { useLanguage } from '../lib/LanguageContext';
import { FingerprintCanvas } from '../components/FingerprintCanvas';
import { apiUrl } from '../lib/api';


type InteractiveMapProps = {
  lat: number;
  lng: number;
  radius: number;
  setLat: (value: number) => void;
  setLng: (value: number) => void;
  setRadius: (value: number) => void;
};

const InteractiveMap = ({
  lat,
  lng,
  radius,
  setLat,
  setLng,
  setRadius,
}: InteractiveMapProps) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);

  const [manualMode, setManualMode] = useState(false);
  const [locationStatus, setLocationStatus] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle');
  const [tileStatus, setTileStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );

  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [lat, lng],
      zoom: 15,
      zoomControl: true,
      attributionControl: true,
    });

    mapInstanceRef.current = map;

    const tileLayer = L.tileLayer(apiUrl('/api/map-tiles/{z}/{x}/{y}.png'), {
      tileSize: 256,
      zoomOffset: 0,
      minZoom: 1,
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    });

    tileLayer
      .on('load', () => setTileStatus('ready'))
      .on('tileerror', () => setTileStatus('error'))
      .addTo(map);

    const worksiteIcon = L.divIcon({
      className: '',
      html: `
        <div style="
          width: 26px;
          height: 26px;
          border-radius: 9999px;
          background: #10b981;
          border: 3px solid #020403;
          box-shadow: 0 0 0 4px rgba(16,185,129,0.25), 0 0 28px rgba(16,185,129,0.65);
        "></div>
      `,
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    });

    const marker = L.marker([lat, lng], {
      draggable: true,
      icon: worksiteIcon,
    }).addTo(map);

    markerRef.current = marker;

    const circle = L.circle([lat, lng], {
      radius,
      color: '#10b981',
      fillColor: '#10b981',
      fillOpacity: 0.16,
      weight: 2,
    }).addTo(map);

    circleRef.current = circle;

    marker.on('dragend', () => {
      const position = marker.getLatLng();

      setLat(Number(position.lat.toFixed(6)));
      setLng(Number(position.lng.toFixed(6)));
    });

    setTimeout(() => {
      map.invalidateSize();
    }, 200);

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!markerRef.current || !circleRef.current) return;

    const nextPosition: [number, number] = [lat, lng];

    markerRef.current.setLatLng(nextPosition);
    circleRef.current.setLatLng(nextPosition);
    circleRef.current.setRadius(radius);
  }, [lat, lng, radius]);

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setLocationStatus('error');
      return;
    }

    setLocationStatus('loading');

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nextLat = Number(position.coords.latitude.toFixed(6));
        const nextLng = Number(position.coords.longitude.toFixed(6));

        setLat(nextLat);
        setLng(nextLng);

        mapInstanceRef.current?.setView([nextLat, nextLng], 16);

        setLocationStatus('success');
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

  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-xl border border-emerald-500/15 bg-[#04110d]/80">
        <div ref={mapContainerRef} className="h-[330px] w-full" />

        {tileStatus === 'error' && (
          <div className="absolute inset-0 z-[600] flex items-center justify-center bg-black/80 px-6 text-center backdrop-blur-sm">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-emerald-400">
                Map provider unavailable
              </p>
              <p className="mt-2 text-[11px] text-emerald-100/50">
                Check the server map tile configuration, then restart the dev server.
              </p>
            </div>
          </div>
        )}

        <div className="pointer-events-none absolute inset-0 rounded-xl border border-emerald-500/10 shadow-[inset_0_0_45px_rgba(16,185,129,0.12)]" />

        <div className="absolute left-4 top-4 z-[500] rounded-lg border border-emerald-500/15 bg-black/70 px-3 py-2 backdrop-blur-md">
          <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">
            Worksite Geofence
          </p>
          <p className="text-[10px] text-emerald-100/45">
            Drag the pin, use your current location, or enter coordinates manually.
          </p>
        </div>

        <button
          type="button"
          onClick={useCurrentLocation}
          className="absolute right-4 top-4 z-[500] rounded-lg bg-emerald-500 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-black transition hover:bg-emerald-400"
        >
          {locationStatus === 'loading' ? 'Locating...' : 'Use My Location'}
        </button>

        {locationStatus === 'error' && (
          <div className="absolute bottom-4 left-4 right-4 z-[500] rounded-lg border border-red-500/30 bg-red-950/80 px-3 py-2 text-[11px] text-red-200 backdrop-blur-md">
            Unable to access location. You can still enter coordinates manually.
          </div>
        )}

        {locationStatus === 'success' && (
          <div className="absolute bottom-4 left-4 right-4 z-[500] rounded-lg border border-emerald-500/20 bg-black/70 px-3 py-2 text-[11px] text-emerald-200 backdrop-blur-md">
            Location detected. Drag the pin if you need to fine-tune the worksite.
          </div>
        )}
      </div>

      <div className="rounded-xl border border-emerald-500/15 bg-[#04110d]/60 p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-emerald-400">
              Geofence Radius
            </p>
            <p className="text-[11px] text-emerald-100/45">
              Controls the allowed clock-in zone around the selected worksite.
            </p>
          </div>

          <span className="rounded-lg border border-emerald-500/20 bg-black/35 px-3 py-1 text-xs font-bold text-emerald-300">
            {radius}m
          </span>
        </div>

        <input
          type="range"
          min="25"
          max="1000"
          step="25"
          value={radius}
          onChange={(e) => setRadius(Number(e.target.value))}
          className="mt-4 w-full accent-emerald-500"
        />

        <div className="mt-2 flex justify-between text-[10px] text-emerald-100/35">
          <span>25m</span>
          <span>1000m</span>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setManualMode((prev) => !prev)}
        className="text-[10px] font-bold uppercase tracking-widest text-emerald-100/45 transition hover:text-emerald-400"
      >
        {manualMode ? 'Hide Manual Coordinates' : 'Enter Coordinates Manually'}
      </button>

      {manualMode && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-emerald-100/50">
              Latitude
            </label>
            <input
              type="number"
              step="0.000001"
              value={lat}
              onChange={(e) => setLat(Number(e.target.value))}
              className="w-full rounded-lg border border-emerald-500/15 bg-[#04110d]/80 px-3 py-2 text-xs font-mono text-emerald-50 outline-none transition focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-emerald-100/50">
              Longitude
            </label>
            <input
              type="number"
              step="0.000001"
              value={lng}
              onChange={(e) => setLng(Number(e.target.value))}
              className="w-full rounded-lg border border-emerald-500/15 bg-[#04110d]/80 px-3 py-2 text-xs font-mono text-emerald-50 outline-none transition focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-emerald-100/50">
              Radius
            </label>
            <input
              type="number"
              min="25"
              max="1000"
              value={radius}
              onChange={(e) => setRadius(Number(e.target.value))}
              className="w-full rounded-lg border border-emerald-500/15 bg-[#04110d]/80 px-3 py-2 text-xs font-mono text-emerald-50 outline-none transition focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500"
            />
          </div>
        </div>
      )}
    </div>
  );
};

export function Signup({ onNavigateLogin, onSignupComplete }: { onNavigateLogin: () => void, onSignupComplete: () => void }) {
  const { t, isRtl } = useLanguage();
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Form State
const [formData, setFormData] = useState({
  companyName: '',
  tenantSlug: '',
  adminFullName: '',
  adminEmail: '',
  adminPassword: '',
  adminRole: 'hr_admin',
  currency: 'USD',
  capacity: '100-500',
  allowsLoans: false,
  lat: 25.197,
  lng: 55.274,
  radius: 100
});

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const val = type === 'checkbox' ? (e.target as HTMLInputElement).checked : value;
    setFormData(prev => ({ ...prev, [name]: val }));
  };

  const nextStep = () => setStep(prev => Math.min(prev + 1, 3));
  const prevStep = () => setStep(prev => Math.max(prev - 1, 1));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step < 3) {
      nextStep();
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      const res = await fetch(apiUrl('/api/auth/register-tenant'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      const data = await res.json();
      
      if (data.success) {
        onSignupComplete();
      } else {
        alert(data.error || 'Registration failed');
        setIsSubmitting(false);
      }
    } catch(err) {
      alert('Network anomaly detected.');
      setIsSubmitting(false);
    }
  };

  return (
<div className="relative min-h-screen w-full flex items-center justify-center bg-slate-50 dark:bg-[#020403] overflow-hidden font-sans transition-colors duration-300">      
      <FingerprintCanvas pulseState={isSubmitting ? 'success' : 'idle'} onPulseComplete={() => { if(isSubmitting) onSignupComplete(); }} />

      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
className="relative z-10 w-full max-w-2xl px-6 py-10 md:p-10 bg-white/85 dark:bg-black/55 backdrop-blur-xl border border-slate-200 dark:border-emerald-500/15 rounded-2xl shadow-xl dark:shadow-[0_0_45px_rgba(16,185,129,0.08)]"      >
        <div className="flex flex-col md:flex-row items-center justify-between mb-8 gap-4">
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

        <form onSubmit={handleSubmit} className="space-y-6">
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                <h2 className="text-sm font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400 mb-4 border-b border-emerald-500/20 pb-2">{t('signup.step1')}</h2>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-emerald-700/80 dark:text-emerald-100/70 uppercase px-1">{t('signup.companyName')}</label>
                    <input required name="companyName" value={formData.companyName} onChange={handleChange} className={cn(
  "w-full bg-white/80 dark:bg-[#04110d]/80 border border-emerald-500/15 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500/50 text-slate-900 dark:text-emerald-50 placeholder:text-emerald-900/70 transition-all",
  isRtl && "text-right"
)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-emerald-700/80 dark:text-emerald-100/70 uppercase px-1">{t('signup.tenantSlug')}</label>
                    <input required name="tenantSlug" value={formData.tenantSlug} onChange={handleChange} className={cn(
  "w-full bg-white/80 dark:bg-[#04110d]/80 border border-emerald-500/15 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500/50 font-mono text-slate-900 dark:text-emerald-50 placeholder:text-emerald-900/70 transition-all",
  isRtl && "text-right"
)} />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-emerald-700/80 dark:text-emerald-100/70 uppercase px-1">Admin Full Name</label>
                    <input required name="adminFullName" value={formData.adminFullName} onChange={handleChange} className={cn(
  "w-full bg-white/80 dark:bg-[#04110d]/80 border border-emerald-500/15 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500/50 text-slate-900 dark:text-emerald-50 placeholder:text-emerald-900/70 transition-all",
  isRtl && "text-right"
)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-emerald-700/80 dark:text-emerald-100/70 uppercase px-1">{t('signup.adminEmail')}</label>
                    <input type="email" required name="adminEmail" value={formData.adminEmail} onChange={handleChange} className={cn(
  "w-full bg-white/80 dark:bg-[#04110d]/80 border border-emerald-500/15 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500/50 font-mono text-slate-900 dark:text-emerald-50 placeholder:text-emerald-900/70 transition-all",
  isRtl && "text-right"
)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-emerald-700/80 dark:text-emerald-100/70 uppercase px-1">{t('signup.adminPass')}</label>
                    <input type="password" required minLength={8} name="adminPassword" value={formData.adminPassword} onChange={handleChange} className={cn(
  "w-full bg-white/80 dark:bg-[#04110d]/80 border border-emerald-500/15 rounded-lg px-4 py-2.5 text-sm outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500/50 font-mono text-slate-900 dark:text-emerald-50 placeholder:text-emerald-900/70 transition-all",
  isRtl && "text-right"
)} />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-emerald-700/80 dark:text-emerald-100/70 uppercase px-1">
                    Initial Account Role
                  </label>

                  <select
                    required
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
                    <select name="currency" value={formData.currency} onChange={handleChange} className={cn(
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
                    <select name="capacity" value={formData.capacity} onChange={handleChange} className={cn(
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
                      <input type="checkbox" name="allowsLoans" checked={formData.allowsLoans} onChange={handleChange} className="sr-only" />
                      <div className={cn("w-6 h-6 rounded border flex items-center justify-center transition-colors", formData.allowsLoans ? "bg-emerald-500 border-emerald-500" : "bg-transparent border-slate-300 dark:border-slate-600")}>
                        {formData.allowsLoans && <CheckCircle2 className="w-4 h-4 text-white" />}
                      </div>
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-slate-900 dark:text-white">{t('signup.loans')}</h3>
<p className="text-xs text-emerald-700/60 dark:text-emerald-100/45">Enable payroll deductions and standard corporate loan requests.</p>
                    </div>
                  </label>
                </div>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                <h2 className="text-sm font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400 mb-4 border-b border-emerald-500/20 pb-2">{t('signup.step3')}</h2>
                
                <InteractiveMap 
                  lat={formData.lat} lng={formData.lng} radius={formData.radius}
                  setLat={(val: number) => setFormData(p => ({ ...p, lat: val }))}
                  setLng={(val: number) => setFormData(p => ({ ...p, lng: val }))}
                  setRadius={(val: number) => setFormData(p => ({ ...p, radius: val }))}
                />

                <div className="mt-4 p-4 bg-white/70 dark:bg-[#04110d]/60 border border-emerald-500/15 rounded-xl">
                  <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} className="flex items-center gap-2 text-xs font-bold text-emerald-700/70 dark:text-emerald-100/55 uppercase tracking-widest hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors">
                    <Settings2 className="w-4 h-4"/> Advanced Spatial Parameters
                  </button>
                  <AnimatePresence>
                    {showAdvanced && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden mt-3">
                        <div className="p-3 bg-white dark:bg-[#020617] rounded border border-slate-200 dark:border-emerald-900/40 text-[10px] font-mono text-emerald-600 dark:text-emerald-400 space-y-1">
                          <p>ST_MakePoint({formData.lng}, {formData.lat})</p>
                          <p>ST_Buffer(geom, {formData.radius})</p>
                          <p>CREATE INDEX geom_idx ON tenants USING GIST (boundary);</p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

              </motion.div>
            )}
          </AnimatePresence>

          {/* Navigation Buttons */}
<div className="flex items-center justify-between pt-6 border-t border-emerald-500/10">             <button 
               type="button" 
               onClick={prevStep}
               className={cn("px-4 py-2 font-bold text-sm text-emerald-700/70 hover:text-emerald-600 dark:text-emerald-100/45 dark:hover:text-emerald-300 transition-colors flex items-center gap-2 uppercase tracking-widest", step === 1 && "invisible")}
             >
               <ArrowLeft className="w-4 h-4" /> {t('signup.back')}
             </button>

             <button 
               type="submit"
               disabled={isSubmitting}
               className={cn("px-6 py-2.5 rounded-lg font-bold text-sm transition-all focus:outline-none flex items-center gap-2 uppercase tracking-widest shadow-lg", 
                 isSubmitting ? "bg-emerald-600 opacity-80 text-white" : 
                 "bg-gradient-to-tr from-emerald-600 to-emerald-400 text-slate-950 hover:scale-105 hover:shadow-[0_0_20px_rgba(16,185,129,0.4)]"
               )}
             >
               {isSubmitting ? (
                 <span className="flex items-center gap-2">
                   <span className="w-4 h-4 border-2 border-slate-900 border-t-transparent rounded-full animate-spin"></span>
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

        <div className="mt-6 text-center">
            <button onClick={onNavigateLogin} className="text-[10px] font-bold text-emerald-700/70 hover:text-emerald-600 dark:text-emerald-100/45 dark:hover:text-emerald-400 tracking-widest uppercase transition-colors">
              {t('signup.login')}
            </button>
        </div>

      </motion.div>
    </div>
  );
}
