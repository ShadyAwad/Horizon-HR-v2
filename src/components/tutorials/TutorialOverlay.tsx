import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useLanguage } from '../../lib/LanguageContext';
import type { TutorialStep } from './tutorial-types';

type Props = {
  tutorialId: string;
  steps: readonly TutorialStep[];
  stepIndex: number;
  onBack: () => void;
  onNext: () => void;
  onSkip: (disableAutomatic: boolean) => void;
  onClose: () => void;
};

type Bounds = { top: number; left: number; width: number; height: number } | null;

export function TutorialOverlay({ tutorialId, steps, stepIndex, onBack, onNext, onSkip, onClose }: Props) {
  const { t, isRtl } = useLanguage();
  const [bounds, setBounds] = useState<Bounds>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  const step = steps[stepIndex];
  const isLast = stepIndex === steps.length - 1;

  useLayoutEffect(() => {
    let frame = 0;
    const measure = () => {
      const target = step.target ? document.querySelector<HTMLElement>(`[data-tutorial-target="${step.target}"]`) : null;
      if (!target) { setBounds(null); return; }
      const rect = target.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.bottom < 0 || rect.top > window.innerHeight) { setBounds(null); return; }
      setBounds({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
    };
    const requestMeasure = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    requestMeasure();
    window.addEventListener('resize', requestMeasure);
    window.addEventListener('scroll', requestMeasure, true);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', requestMeasure); window.removeEventListener('scroll', requestMeasure, true); };
  }, [step.target]);

  useEffect(() => {
    dialogRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key === 'Tab' && dialogRef.current) {
        const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button, input, [href], select, textarea, [tabindex]:not([tabindex="-1"])')]
          .filter((element) => !element.hasAttribute('disabled'));
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (first && last) {
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }
      if (event.key === 'ArrowRight' && !isRtl) onNext();
      if (event.key === 'ArrowLeft' && !isRtl && stepIndex > 0) onBack();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); returnFocusRef.current?.focus?.({ preventScroll: true }); };
  }, [isRtl, onBack, onClose, onNext, stepIndex]);

  const left = bounds ? Math.min(Math.max(12, bounds.left + (bounds.width / 2) - 160), window.innerWidth - 332) : Math.max(12, (window.innerWidth - 320) / 2);
  const top = bounds && step.placement === 'top' ? Math.max(12, bounds.top - 250) : bounds ? Math.min(window.innerHeight - 230, bounds.top + bounds.height + 14) : Math.max(24, (window.innerHeight - 260) / 2);
  const isCompactViewport = window.innerWidth < 640;
  const mobileBottom = bounds
    ? 'calc(env(safe-area-inset-bottom) + 5.5rem)'
    : 'calc(env(safe-area-inset-bottom) + .75rem)';

  return <div className="pointer-events-none fixed inset-0 z-[95]" data-tutorial-overlay={tutorialId} aria-live="polite">
    <div className="pointer-events-none absolute inset-0 bg-black/45" aria-hidden="true" />
    {bounds && <div aria-hidden="true" className="stanza-tutorial-highlight pointer-events-none fixed rounded-xl border-2 shadow-[0_0_0_9999px_rgba(0,0,0,.36)] motion-reduce:transition-none" style={{ top: bounds.top - 4, left: bounds.left - 4, width: bounds.width + 8, height: bounds.height + 8 }} />}
    <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="tutorial-title" aria-describedby="tutorial-body" dir={isRtl ? 'rtl' : 'ltr'} className="stanza-tutorial-dialog pointer-events-auto fixed z-10 max-h-[calc(100dvh-1.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-[min(20rem,calc(100vw-1.5rem))] overflow-y-auto rounded-xl border border-emerald-500/25 bg-white p-4 text-slate-900 shadow-2xl outline-none dark:bg-[#061411] dark:text-emerald-50 md:w-80" style={isCompactViewport ? { insetInline: 12, bottom: mobileBottom } : { left, top }}>
      <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-300">{stepIndex + 1} / {steps.length}</p><h2 id="tutorial-title" className="mt-1 text-sm font-black">{t(step.titleKey as never)}</h2></div><button type="button" onClick={onClose} aria-label={t('tutorial.close')} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-emerald-500/10 focus-visible:ring-2 focus-visible:ring-emerald-400"><X className="h-4 w-4" /></button></div>
      <p id="tutorial-body" className="mt-2 text-xs leading-5 text-slate-600 dark:text-emerald-100/70">{t(step.bodyKey as never)}</p>
      <label className="mt-3 flex items-center gap-2 text-[11px] text-slate-600 dark:text-emerald-100/65"><input type="checkbox" onChange={(event) => { if (event.target.checked) onSkip(true); }} className="h-4 w-4 accent-emerald-600" />{t('tutorial.disableAutomatic')}</label>
      <div className="mt-4 flex items-center justify-between gap-2"><button type="button" onClick={() => onSkip(false)} className="min-h-10 rounded-lg px-2 text-xs font-bold text-slate-600 hover:bg-emerald-500/10 focus-visible:ring-2 focus-visible:ring-emerald-400 dark:text-emerald-100/65">{t('tutorial.skip')}</button><div className="flex gap-2">{stepIndex > 0 && <button type="button" onClick={onBack} className="min-h-10 rounded-lg border border-emerald-500/20 px-3 text-xs font-bold focus-visible:ring-2 focus-visible:ring-emerald-400">{t('tutorial.back')}</button>}<button type="button" onClick={onNext} className="min-h-10 rounded-lg bg-emerald-500 px-3 text-xs font-black text-[#02110b] focus-visible:ring-2 focus-visible:ring-emerald-300">{isLast ? t('tutorial.finish') : t('tutorial.next')}</button></div></div>
    </section>
  </div>;
}
