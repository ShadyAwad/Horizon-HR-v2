import { useEffect, useRef } from 'react';
import type { AuthVisualState } from './AuthShell';

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

    let animationFrameId: number | undefined;
    let drawFrame: ((time: number) => void) | undefined;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    reducedMotionRef.current = prefersReducedMotion;

    const scheduleStaticRedraw = () => {
      if (!staticModeRef.current || !drawFrame) return;

      if (animationFrameId !== undefined) {
        cancelAnimationFrame(animationFrameId);
      }
      animationFrameId = requestAnimationFrame(drawFrame);
    };
    requestStaticRedrawRef.current = scheduleStaticRedraw;

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

    const themeObserver = new MutationObserver(scheduleStaticRedraw);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    });

    if (prefersReducedMotion) {
      const { width, height } = parent.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      dimensionsRef.current = { width, height };
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = document.documentElement.classList.contains('dark') ? '#020604' : '#f7fbf8';
      ctx.fillRect(0, 0, width, height);

      return () => {
        resizeObserver.disconnect();
        themeObserver.disconnect();
      };
    }

    drawFrame = (time: number) => {
      const { width, height } = dimensionsRef.current;
      
      // Safety check: skip render cycles if dimensions haven't been captured yet
      if (width === 0 || height === 0) {
        animationFrameId = requestAnimationFrame(drawFrame!);
        return;
      }

      // Clear the canvas buffer cleanly
      ctx.clearRect(0, 0, width, height);

      const isDark = document.documentElement.classList.contains('dark');
      const cx = width / 2;
      const cy = height / 2;

      // Solid background filling to optimize canvas operations
      ctx.fillStyle = isDark ? '#020604' : '#f7fbf8';
      ctx.fillRect(0, 0, width, height);

      const currentPulseState = pulseStateRef.current;
      const ambientBreath = 0.5 + 0.5 * Math.sin(time * 0.0026);
      const glow = ctx.createRadialGradient(cx, cy * 0.78, 0, cx, cy * 0.78, Math.max(width, height) * 0.46);
      glow.addColorStop(0, isDark
        ? `rgba(16, 185, 129, ${0.075 + ambientBreath * 0.035})`
        : `rgba(16, 185, 129, ${0.08 + ambientBreath * 0.03})`);
      glow.addColorStop(0.55, isDark
        ? `rgba(6, 78, 59, ${0.028 + ambientBreath * 0.012})`
        : `rgba(16, 185, 129, ${0.03 + ambientBreath * 0.01})`);
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

        // Theme palette color mappings
let rVal = 16;
let gVal = 185;
let bVal = 129;
let globalAlpha = 0.145 - (rIdx / ringsCount) * 0.085;

        globalAlpha += ambientBreath * 0.012;

        if (isPulsing) {
          const distToPulse = Math.abs(ringBaseR - pulseRadius);
          
          if (distToPulse < pulseWidth) {
            const pulseFactor = 1.0 - (distToPulse / pulseWidth);
            globalAlpha = globalAlpha + pulseFactor * 0.42;

            if (currentPulseState === 'success') {
              rVal = Math.floor(rVal + pulseFactor * (52 - rVal));
              gVal = Math.floor(gVal + pulseFactor * (211 - gVal));
              bVal = Math.floor(bVal + pulseFactor * (153 - bVal));
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

      if (!staticModeRef.current) {
        animationFrameId = requestAnimationFrame(drawFrame);
      }
    };

    animationFrameId = requestAnimationFrame(drawFrame);

    return () => {
      if (animationFrameId !== undefined) {
        cancelAnimationFrame(animationFrameId);
      }
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
