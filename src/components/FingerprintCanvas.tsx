import { useEffect, useRef } from 'react';

interface FingerprintCanvasProps {
  pulseState: 'idle' | 'success' | 'error';
  onPulseComplete?: () => void;
}

export function FingerprintCanvas({ pulseState, onPulseComplete }: FingerprintCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Use mutable refs to lock parameters without triggering re-effects
  const pulseStateRef = useRef(pulseState);
  const onPulseCompleteRef = useRef(onPulseComplete);
  const pulseStartTimeRef = useRef<number | null>(null);
  const reducedMotionRef = useRef(false);
  
  // Track structural dimensions globally inside the hook context
  const dimensionsRef = useRef({ width: 0, height: 0 });

  // Sync incoming dynamic values immediately without tearing down the canvas loop
  useEffect(() => {
    if (pulseState !== pulseStateRef.current) {
      pulseStateRef.current = pulseState;
      if (pulseState !== 'idle') {
        pulseStartTimeRef.current = performance.now();
      } else {
        pulseStartTimeRef.current = null;
      }
    }
    onPulseCompleteRef.current = onPulseComplete;

    if (reducedMotionRef.current && pulseState !== 'idle' && onPulseComplete) {
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

    let animationFrameId: number;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    reducedMotionRef.current = prefersReducedMotion;

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
      }
    });

    resizeObserver.observe(parent);

    if (prefersReducedMotion) {
      const { width, height } = parent.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      dimensionsRef.current = { width, height };
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = document.documentElement.classList.contains('dark') ? '#020403' : '#f8fafc';
      ctx.fillRect(0, 0, width, height);

      return () => {
        resizeObserver.disconnect();
      };
    }

    const draw = (time: number) => {
      const { width, height } = dimensionsRef.current;
      
      // Safety check: skip render cycles if dimensions haven't been captured yet
      if (width === 0 || height === 0) {
        animationFrameId = requestAnimationFrame(draw);
        return;
      }

      // Clear the canvas buffer cleanly
      ctx.clearRect(0, 0, width, height);

      const isDark = document.documentElement.classList.contains('dark');
      const cx = width / 2;
      const cy = height / 2;

      // Solid background filling to optimize canvas operations
      ctx.fillStyle = isDark ? '#020403' : '#f8fafc';
      ctx.fillRect(0, 0, width, height);

      const maxRadius = Math.max(width, height) * 0.8;
      const baseSpacing = 22; 
      const ringsCount = Math.floor(maxRadius / baseSpacing);

      // Extract raw data from active refs securely
      const currentPulseState = pulseStateRef.current;
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
          // Trigger the callback cleanly and reset immediately
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
let globalAlpha = 0.16 - (rIdx / ringsCount) * 0.11;

        if (isPulsing) {
          const distToPulse = Math.abs(ringBaseR - pulseRadius);
          
          if (distToPulse < pulseWidth) {
            const pulseFactor = 1.0 - (distToPulse / pulseWidth);
            globalAlpha = globalAlpha + pulseFactor * 0.6; 

            if (currentPulseState === 'success') {
              rVal = Math.floor(rVal + pulseFactor * (16 - rVal));
              gVal = Math.floor(gVal + pulseFactor * (185 - gVal));
              bVal = Math.floor(bVal + pulseFactor * (129 - bVal));
            } else if (currentPulseState === 'error') {
              rVal = Math.floor(rVal + pulseFactor * (239 - rVal));
              gVal = Math.floor(gVal + pulseFactor * (68 - gVal));
              bVal = Math.floor(bVal + pulseFactor * (68 - bVal));
            }
          }
        }

        ctx.strokeStyle = `rgba(${rVal}, ${gVal}, ${bVal}, ${globalAlpha})`;
        ctx.lineWidth = 1.8;
        ctx.stroke();
      }

      animationFrameId = requestAnimationFrame(draw);
    };

    animationFrameId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
    };
  }, []); // Run ONCE at initial component mount. Never crash or restart loop.

  return (
    <div className="absolute inset-0 z-0 overflow-hidden bg-transparent pointer-events-none">
      <canvas ref={canvasRef} className="block antialiased" />
    </div>
  );
}
