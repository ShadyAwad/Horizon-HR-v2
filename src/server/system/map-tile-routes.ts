import type express from 'express';

function isTileCoordinate(value: string | undefined) {
  return typeof value === 'string' && /^\d+$/.test(value);
}

function getMapTilerMapId() {
  return process.env.MAPTILER_MAP_ID || 'streets-v4';
}

export function registerMapTileRoutes(app: express.Express) {
  app.get('/api/map-tiles/:z/:x/:y.png', async (req, res) => {
    const { z, x, y } = req.params;
    const maptilerKey = process.env.MAPTILER_KEY;

    if (!maptilerKey) {
      return res.status(503).json({
        success: false,
        error: 'Map tile provider is not configured.',
      });
    }

    if (!isTileCoordinate(z) || !isTileCoordinate(x) || !isTileCoordinate(y)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid tile coordinates.',
      });
    }

    const tileUrl = new URL(
      `https://api.maptiler.com/maps/${getMapTilerMapId()}/256/${z}/${x}/${y}.png`,
    );
    tileUrl.searchParams.set('key', maptilerKey);

    try {
      const upstreamResponse = await fetch(tileUrl);
      if (!upstreamResponse.ok || !upstreamResponse.body) {
        return res.status(upstreamResponse.status || 502).json({
          success: false,
          error: 'Unable to load map tile.',
        });
      }

      res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
      res.setHeader('Content-Type', upstreamResponse.headers.get('content-type') || 'image/png');
      const tileBuffer = Buffer.from(await upstreamResponse.arrayBuffer());
      res.send(tileBuffer);
    } catch (error) {
      console.error('[Map Tiles] Failed to proxy tile:', error);
      res.status(502).json({
        success: false,
        error: 'Unable to load map tile.',
      });
    }
  });
}
