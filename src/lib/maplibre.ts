import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

// Keep maps lazy; Vite bundles the worker with its shared imports into a same-origin asset.
export async function loadMapLibre() {
  const [maplibre] = await Promise.all([
    import('maplibre-gl'),
    import('maplibre-gl/dist/maplibre-gl.css'),
  ]);
  maplibre.setWorkerUrl(workerUrl);
  return maplibre;
}
