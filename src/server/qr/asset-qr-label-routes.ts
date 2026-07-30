import type express from 'express';
import { QrTokenService } from './qr-token-service';
import { QrTokenError } from './qr-token-types';
import { requireUuid, strictQrObject } from './qr-token-validation';

type Middleware = express.RequestHandler;
type Dependencies = { standardAuth: Middleware; mutationGuard: Middleware; issuanceRateLimiter: Middleware; service?: QrTokenService };

function identity(req: express.Request) {
  return { tenantId: req.authUser!.tenantId, employeeId: req.authUser!.employeeId };
}

function fail(res: express.Response, error: unknown) {
  if (error instanceof QrTokenError) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
  if (process.env.NODE_ENV !== 'production') console.error('[asset QR label] request failed', error);
  return res.status(500).json({ success: false, code: 'ASSET_QR_LABEL_FAILED', message: 'Asset QR label is unavailable.' });
}

export function registerAssetQrLabelRoutes(app: express.Express, {
  standardAuth, mutationGuard, issuanceRateLimiter, service = new QrTokenService(),
}: Dependencies) {
  const path = '/api/hr/assets/:assetId/qr-label';
  app.get(path, standardAuth, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { return res.json({ success: true, label: await service.getAssetQrLabel(identity(req), requireUuid(req.params.assetId, 'Asset')) }); }
    catch (error) { return fail(res, error); }
  });
  app.post(`${path}/issue`, issuanceRateLimiter, standardAuth, mutationGuard, async (req, res) => {
    try {
      strictQrObject(req.body || {}, []);
      const result = await service.issueAssetQrLabel(identity(req), requireUuid(req.params.assetId, 'Asset'));
      return res.status(result.created ? 201 : 200).json({ success: true, ...result });
    } catch (error) { return fail(res, error); }
  });
  app.post(`${path}/rotate`, issuanceRateLimiter, standardAuth, mutationGuard, async (req, res) => {
    try { strictQrObject(req.body || {}, []); return res.json({ success: true, label: await service.rotateAssetQrLabel(identity(req), requireUuid(req.params.assetId, 'Asset')) }); }
    catch (error) { return fail(res, error); }
  });
  app.post(`${path}/revoke`, issuanceRateLimiter, standardAuth, mutationGuard, async (req, res) => {
    try { strictQrObject(req.body || {}, []); return res.json({ success: true, label: await service.revokeAssetQrLabel(identity(req), requireUuid(req.params.assetId, 'Asset')) }); }
    catch (error) { return fail(res, error); }
  });
}
