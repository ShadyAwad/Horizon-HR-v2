import { useEffect, useRef } from 'react';
import { resolveLoginCanvasPalette } from '../lib/login-canvas-palette';
import { createLoginCanvasMeasurement } from '../lib/dev-login-canvas';
import type { AuthVisualState } from '../auth/auth-contract';
import { createCanvasCadence } from '../lib/login-canvas-scheduler';
import { createCanvasSchedulerCounters } from '../lib/dev-login-canvas-counters';

interface FingerprintCanvasProps {
  pulseState: AuthVisualState;
  onPulseComplete?: () => void;
  staticMode?: boolean;
  refreshKey?: string | number;
}

export function FingerprintCanvas({ pulseState, onPulseComplete, staticMode = false, refreshKey }: FingerprintCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Use mutable refs to lock parameters without triggering re-effects
  const pulseStateRef = useRef(pulseState);
  const onPulseCompleteRef = useRef(onPulseComplete);
  const pulseStartTimeRef = useRef<number | null>(null);
  const reducedMotionRef = useRef(false);
  const staticModeRef = useRef(staticMode);
  const requestStaticRedrawRef = useRef<() => void>(() => undefined);
  
  // Track structural dimensions globally inside the hook context
  const dimensionsRef = useRef({ width: 0, height: 0 });

  // Sync incoming dynamic values immediately without tearing down the canvas loop
  useEffect(() => {
    if (pulseState !== pulseStateRef.current) {
      pulseStateRef.current = pulseState;
      if (pulseState === 'success' || pulseState === 'error') {
        pulseStartTimeRef.current = performance.now();
      } else {
        pulseStartTimeRef.current = null;
      }
    }
    onPulseCompleteRef.current = onPulseComplete;
    staticModeRef.current = staticMode;

    requestStaticRedrawRef.current();

    if (reducedMotionRef.current && (pulseState === 'success' || pulseState === 'error') && onPulseComplete) {
      const timeoutId = window.setTimeout(onPulseComplete, 150);
      return () => window.clearTimeout(timeoutId);
    }
  }, [pulseState, onPulseComplete]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const measurement = import.meta.env.DEV ? createLoginCanvasMeasurement() : undefined;
    let palette = resolveLoginCanvasPalette(document.documentElement);
    measurement?.palette();
    let disposed = false;
    let hiddenAt: number | null = document.hidden ? performance.now() : null;
    let drawFrame: ((time: number) => void) | undefined;
    const counters = import.meta.env.DEV ? createCanvasSchedulerCounters() : undefined;
    const cadence = createCanvasCadence({
      now: () => performance.now(), raf: (callback) => requestAnimationFrame(callback),
      cancelRaf: (id) => cancelAnimationFrame(id),
      timer: (callback, delay) => window.setTimeout(callback, delay),
      cancelTimer: (id) => window.clearTimeout(id), hidden: () => document.hidden,
    }, (time) => { counters?.raf(); drawFrame?.(time); }, () => pulseStateRef.current);
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    reducedMotionRef.current = prefersReducedMotion;

    const scheduleFrame = (immediate = true) => cadence.request(immediate);
    const scheduleStaticRedraw = () => scheduleFrame();
    requestStaticRedrawRef.current = scheduleStaticRedraw;
    const onVisibilityChange = () => {
      counters?.visibility();
      if (document.hidden) {
        cadence.cancel();
        hiddenAt = performance.now();
      } else {
        if (hiddenAt !== null && pulseStartTimeRef.current !== null) {
          pulseStartTimeRef.current += performance.now() - Math.max(hiddenAt, pulseStartTimeRef.current);
        }
        hiddenAt = null;
        scheduleFrame();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    // High DPI & dynamic scaling via ResizeObserver safely writing to dimensionsRef
    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        // Handle physical viewport calculations correctly
        const w = entry.contentRect.width;
        const h = entry.contentRect.height;
        dimensionsRef.current = { width: w, height: h };
        
        const dpr = window.devicePixelRatio || 1;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        scheduleStaticRedraw();
      }
    });

    resizeObserver.observe(parent);

    const themeObserver = new MutationObserver(() => {
      if (disposed) return;
      // One resolution per delivered mutation batch, including Custom's inline tokens.
      palette = resolveLoginCanvasPalette(document.documentElement);
      measurement?.palette();
      scheduleFrame();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'data-background-preset', 'data-light-intensity', 'style'],
    });

    drawFrame = (time: number) => {
      if (disposed || document.hidden) return;
      const drawStarted = counters?.draw();
      const started = measurement?.active ? performance.now() : undefined;
      const { width, height } = dimensionsRef.current;
      
      // Safety check: skip render cycles if dimensions haven't been captured yet
      if (width === 0 || height === 0) {
        // ResizeObserver requests the first frame once dimensions are available.
        return;
      }

      // Clear the canvas buffer cleanly
      ctx.clearRect(0, 0, width, height);

      const { isDark, authBackground, authRingRgb, baseRed, baseGreen, baseBlue, pulseRed, pulseGreen, pulseBlue } = palette;
      if (prefersReducedMotion) {
        ctx.fillStyle = authBackground;
        ctx.fillRect(0, 0, width, height);
        if (started !== undefined) measurement?.frame(performance.now() - started, 0);
        if (drawStarted !== undefined) counters?.redrawn(drawStarted);
        return;
      }
      const cx = width / 2;
      const cy = height / 2;

      // Solid background filling to optimize canvas operations
      ctx.fillStyle = authBackground;
      ctx.fillRect(0, 0, width, height);

      const currentPulseState = pulseStateRef.current;
      const ambientBreath = 0.5 + 0.5 * Math.sin(time * 0.0026);
      const glow = ctx.createRadialGradient(cx, cy * 0.78, 0, cx, cy * 0.78, Math.max(width, height) * 0.46);
      glow.addColorStop(0, isDark
        ? `rgba(${authRingRgb}, ${0.075 + ambientBreath * 0.035})`
        : `rgba(${authRingRgb}, ${0.08 + ambientBreath * 0.03})`);
      glow.addColorStop(0.55, isDark
        ? `rgba(${authRingRgb}, ${0.028 + ambientBreath * 0.012})`
        : `rgba(${authRingRgb}, ${0.03 + ambientBreath * 0.01})`);
      glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      const maxRadius = Math.max(width, height) * 0.8;
      const baseSpacing = 22; 
      const ringsCount = Math.floor(maxRadius / baseSpacing);

      // Extract raw data from active refs securely
      const pulseStartTime = pulseStartTimeRef.current;

      let pulseRadius = -1;
      let isPulsing = false;
      const pulseSpeed = 1.2; 
      const pulseWidth = 100; 

      if (currentPulseState !== 'idle' && pulseStartTime !== null) {
        isPulsing = true;
        const elapsed = time - pulseStartTime;
        pulseRadius = elapsed * pulseSpeed;

        if (pulseRadius > maxRadius + pulseWidth && onPulseCompleteRef.current) {
          // Success and error share one complete wave before returning idle.
          const callback = onPulseCompleteRef.current;
          pulseStartTimeRef.current = null;
          pulseStateRef.current = 'idle';
          callback();
        }
      }

      for (let rIdx = 1; rIdx <= ringsCount; rIdx++) {
        ctx.beginPath();
        let ringBaseR = rIdx * baseSpacing;
        
        // Steady-state breathing animation
        const breathingOffset = Math.sin(time * 0.001 + rIdx * 0.1) * 2;
        ringBaseR += breathingOffset;

        // Draw topographic fingerprint paths
        for (let angle = 0; angle <= Math.PI * 2; angle += 0.05) {
          const distortion1 = Math.sin(angle * 3 + time * 0.0005) * 8 * (rIdx / ringsCount);
          const distortion2 = Math.cos(angle * 5 - time * 0.0003) * 5;
          const r = ringBaseR + distortion1 + distortion2;

          const x = cx + Math.cos(angle) * r;
          const y = cy + Math.sin(angle) * r;

          if (angle === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();

        // Numeric palette is prepared only when the theme changes.
        let rVal = baseRed;
        let gVal = baseGreen;
        let bVal = baseBlue;
        let globalAlpha = 0.145 - (rIdx / ringsCount) * 0.085;

        globalAlpha += ambientBreath * 0.012;

        if (isPulsing) {
          const distToPulse = Math.abs(ringBaseR - pulseRadius);
          
          if (distToPulse < pulseWidth) {
            const pulseFactor = 1.0 - (distToPulse / pulseWidth);
            globalAlpha = globalAlpha + pulseFactor * 0.42;

            if (currentPulseState === 'success') {
              rVal = Math.floor(rVal + pulseFactor * (pulseRed - rVal));
              gVal = Math.floor(gVal + pulseFactor * (pulseGreen - gVal));
              bVal = Math.floor(bVal + pulseFactor * (pulseBlue - bVal));
            } else if (currentPulseState === 'error') {
              rVal = Math.floor(rVal + pulseFactor * (239 - rVal));
              gVal = Math.floor(gVal + pulseFactor * (68 - gVal));
              bVal = Math.floor(bVal + pulseFactor * (68 - bVal));
            }
          }
        }

        ctx.strokeStyle = `rgba(${rVal}, ${gVal}, ${bVal}, ${globalAlpha})`;
        ctx.lineWidth = 1.35;
        ctx.stroke();
      }

      if (started !== undefined) measurement?.frame(performance.now() - started, ringsCount);
      if (drawStarted !== undefined) counters?.redrawn(drawStarted);
      if (!staticModeRef.current) scheduleFrame(false);
    };

    scheduleFrame();

    return () => {
      disposed = true;
      measurement?.stop();
      cadence.stop();
      counters?.stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      requestStaticRedrawRef.current = () => undefined;
    };
  }, []); // Run ONCE at initial component mount. Never crash or restart loop.

  useEffect(() => {
    requestStaticRedrawRef.current();
  }, [refreshKey]);

  return (
    <div className="absolute inset-0 z-0 overflow-hidden bg-transparent pointer-events-none">
      <canvas ref={canvasRef} data-auth-state={pulseState} className="block antialiased" />
    </div>
  );
}
