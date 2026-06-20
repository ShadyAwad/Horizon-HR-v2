import { useEffect, useRef } from 'react';

interface FingerprintCanvasProps {
  pulseState: 'idle' | 'success' | 'error';
  onPulseComplete?: () => void;
}

export function FingerprintCanvas({ pulseState, onPulseComplete }: FingerprintCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pulseStartTimeRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    let animationFrameId: number;
    let width = 0;
    let height = 0;

    // Use ResizeObserver for high DPI and dynamic scaling
    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        width = entry.contentRect.width;
        height = entry.contentRect.height;
        
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    });

    resizeObserver.observe(parent);

    // If state changes FROM something TO pulse, record current time
    if (pulseState !== 'idle') {
      pulseStartTimeRef.current = performance.now();
    } else {
      pulseStartTimeRef.current = null;
    }

    const draw = (time: number) => {
      // Clear the canvas completely before drawing the next frame
      ctx.clearRect(0, 0, width, height);

      const isDark = document.documentElement.classList.contains('dark');
      
      const cx = width / 2;
      const cy = height / 2;

      // Deep dark slate background to match theme specifications
      ctx.fillStyle = isDark ? '#020617' : '#f8fafc';
      ctx.fillRect(0, 0, width, height);

      const maxRadius = Math.max(width, height) * 0.8;
      const baseSpacing = 22; 
      const ringsCount = Math.floor(maxRadius / baseSpacing);

      // Determine pulse properties
      let pulseRadius = -1;
      let isPulsing = false;
      const pulseSpeed = 1.2; // pixels per ms
      const pulseWidth = 100; // width of the pulse ripple

      if (pulseState !== 'idle' && pulseStartTimeRef.current !== null) {
        isPulsing = true;
        const elapsed = time - pulseStartTimeRef.current;
        pulseRadius = elapsed * pulseSpeed;

        if (pulseRadius > maxRadius + pulseWidth && onPulseComplete) {
          onPulseComplete();
        }
      }

      for (let rIdx = 1; rIdx <= ringsCount; rIdx++) {
        ctx.beginPath();
        
        let ringBaseR = rIdx * baseSpacing;
        
        // Low-amplitude breathing offset
        const breathingOffset = Math.sin(time * 0.001 + rIdx * 0.1) * 2;
        ringBaseR += breathingOffset;

        // Draw distorted concentric ring (Topographic fingerprint feel)
        for (let angle = 0; angle <= Math.PI * 2; angle += 0.05) {
          // Mathematical distortion to simulate organic fingerprint loops
          const distortion1 = Math.sin(angle * 3 + time * 0.0005) * 8 * (rIdx / ringsCount);
          const distortion2 = Math.cos(angle * 5 - time * 0.0003) * 5;
          const r = ringBaseR + distortion1 + distortion2;

          const x = cx + Math.cos(angle) * r;
          const y = cy + Math.sin(angle) * r;

          if (angle === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();

        // Color Logic per ring
        // Default color is subtle slate/emerald
        let rVal = isDark ? 15 : 226; // slate-950 vs slate-200
        let gVal = isDark ? 23 : 232;
        let bVal = isDark ? 42 : 240; 
        let globalAlpha = 0.4 - (rIdx / ringsCount) * 0.3; // fade outer rings

        if (isPulsing) {
          // Distance from pulse frontier
          const distToPulse = Math.abs(ringBaseR - pulseRadius);
          
          if (distToPulse < pulseWidth) {
            // Pulse active on this ring! Factor 0.0 to 1.0 (1.0 = dead center of pulse)
            const pulseFactor = 1.0 - (distToPulse / pulseWidth);
            globalAlpha = globalAlpha + pulseFactor * 0.6; // Brigthen

            if (pulseState === 'success') {
              // Emerald Green #10b981
              rVal = Math.floor(rVal + pulseFactor * (16 - rVal));
              gVal = Math.floor(gVal + pulseFactor * (185 - gVal));
              bVal = Math.floor(bVal + pulseFactor * (129 - bVal));
            } else if (pulseState === 'error') {
              // Alert Red #ef4444
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
  }, [pulseState, onPulseComplete]);

  return (
    <div className="absolute inset-0 z-0 overflow-hidden bg-transparent">
      <canvas ref={canvasRef} className="block antialiased" />
    </div>
  );
}
