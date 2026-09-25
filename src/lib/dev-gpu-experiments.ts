import type { WebGLRenderer } from 'three';

export const GPU_SURFACES = ['current', 'css-opaque', 'alpha-opaque', 'precomposed', 'opaque-dom', 'flat-geo', 'flat-test'] as const;
export const GPU_ISOLATIONS = ['current', 'no-backdrop', 'no-filters', 'no-glows', 'no-topography', 'no-shadows', 'no-clipping', 'no-masks', 'no-transform', 'no-isolation', 'no-contain'] as const;
export type GpuExperiment = { surface: typeof GPU_SURFACES[number]; isolation: typeof GPU_ISOLATIONS[number]; antialias: boolean; dpr: 1 | .75; forceActive: boolean };
const defaults: GpuExperiment = { surface: 'current', isolation: 'current', antialias: true, dpr: 1, forceActive: false };
let current = { ...defaults };
let activityTimer: ReturnType<typeof setTimeout> | undefined;
let canvasReader: (() => unknown) | undefined;
export function getDevGpuExperiment(): GpuExperiment { return import.meta.env.DEV ? { ...current } : { ...defaults }; }
export function setDevGpuExperiment(next: Partial<GpuExperiment>) {
  if (!import.meta.env.DEV) return;
  current = { ...current, ...next };
  if (next.forceActive !== undefined) {
    clearTimeout(activityTimer);
    if (next.forceActive) activityTimer = setTimeout(() => setDevGpuExperiment({ forceActive: false }), 15000);
  }
  window.dispatchEvent(new Event('stanza-gpu-experiment'));
}
export function resetDevGpuExperiment() { setDevGpuExperiment(defaults); }
export function readDevCanvasAudit() { return import.meta.env.DEV ? canvasReader?.() ?? null : null; }
export function registerDevCanvasAudit(gl: WebGLRenderer) {
  if (!import.meta.env.DEV) return () => undefined;
  const reader = () => {
    const context = gl.getContext();
    const ancestors = [];
    for (let node: HTMLElement | null = gl.domElement; node; node = node.parentElement) {
      const css = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      ancestors.push({ element: `${node.tagName}.${node.className}`, width: rect.width, height: rect.height, styles: Object.fromEntries(['opacity', 'position', 'z-index', 'pointer-events', 'overflow', 'border-radius', 'mask-image', 'clip-path', 'filter', 'backdrop-filter', 'transform', 'scale', 'isolation', 'contain', 'background-color', 'background-image'].map(key => [key, css.getPropertyValue(key)])) });
    }
    return { requested: getDevGpuExperiment(), actualContextAttributes: context.getContextAttributes(), contextLost: context.isContextLost(), drawingBuffer: [context.drawingBufferWidth, context.drawingBufferHeight], pixelRatio: gl.getPixelRatio(), clearAlpha: gl.getClearAlpha(), toneMapping: gl.toneMapping, outputColorSpace: gl.outputColorSpace, ancestors, note: 'CSS ancestry is not a composited-layer tree or GPU utilization measurement.' };
  };
  canvasReader = reader;
  return () => { if (canvasReader === reader) canvasReader = undefined; };
}

/** One pre-rasterized semantic wash, not a screenshot or visual replica of the DOM. */
export function createDevPrecomposedSurface() {
  if (!import.meta.env.DEV) return '';
  const canvas = document.createElement('canvas');
  canvas.width = Math.min(innerWidth, 1920); canvas.height = Math.min(innerHeight, 1080);
  const context = canvas.getContext('2d');
  if (!context) return '';
  const css = getComputedStyle(document.documentElement);
  context.fillStyle = css.getPropertyValue('--stanza-page-bg').trim() || '#101820';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const gradient = context.createRadialGradient(0, 0, 0, 0, 0, canvas.width);
  gradient.addColorStop(0, css.getPropertyValue('--stanza-accent').trim() || '#6366f1');
  gradient.addColorStop(1, 'transparent');
  context.globalAlpha = .12; context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  return `url("${canvas.toDataURL()}")`;
}
