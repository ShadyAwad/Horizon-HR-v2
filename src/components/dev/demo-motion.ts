export type DemoMotion = 'grid' | 'none' | 'max-height';

export function readDemoMotion(search: string) {
  const params = new URLSearchParams(search);
  const requested = params.get('demoMotion');
  const mode: DemoMotion = requested === 'none' || requested === 'max-height' ? requested : 'grid';
  return { mode, trace: params.get('demoTrace') === '1' };
}

export function demoMotionCss(mode: DemoMotion) {
  if (mode === 'none') return `
[data-demo-motion="none"], [data-demo-motion="none"] *,
[data-demo-motion="none"] *::before, [data-demo-motion="none"] *::after {
  transition: none !important;
  animation: none !important;
}`;
  if (mode === 'max-height') return `
[data-demo-motion="max-height"] #demo-account-panel {
  display: block !important;
  grid-template-rows: none !important;
  overflow: hidden;
  transition-property: max-height !important;
}
@media (prefers-reduced-motion: reduce) {
  [data-demo-motion="max-height"] #demo-account-panel { transition: none !important; }
}`;
  return '';
}
