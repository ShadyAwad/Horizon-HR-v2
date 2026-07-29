import type express from 'express';
import { QrTokenService } from './qr-token-service';
import { isQrTokenPurpose, QrTokenError, type QrTokenPurpose } from './qr-token-types';
import {
  hashQrToken,
  isValidQrToken,
  normalizeInviteExpiryMinutes,
  requireUuid,
  strictQrObject,
} from './qr-token-validation';

type Middleware = express.RequestHandler;
type Dependencies = {
  standardAuth: Middleware;
  mutationGuard: Middleware;
  issuanceRateLimiter: Middleware;
  publicRateLimiter: Middleware;
  service?: QrTokenService;
};

const PUBLIC_PURPOSES: Array<{ path: string; purpose: QrTokenPurpose }> = [
  { path: '/api/public/verify/employee/:token', purpose: 'employee_verification' },
  { path: '/api/public/assets/:token', purpose: 'asset_lookup' },
  { path: '/api/public/onboarding-invites/:token', purpose: 'onboarding_invite' },
];

function hidden(res: express.Response) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  return res.status(404).json({
    success: false,
    code: 'QR_TOKEN_NOT_FOUND',
    message: 'QR token is invalid or unavailable.',
  });
}

function sendError(res: express.Response, error: unknown) {
  if (error instanceof QrTokenError) {
    return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
  }
  if (process.env.NODE_ENV !== 'production') console.error('[qr-token request failed]', error);
  return res.status(500).json({ success: false, code: 'QR_REQUEST_FAILED', message: 'The QR token request could not be completed.' });
}

export function registerQrTokenRoutes(
  app: express.Express,
  {
    standardAuth,
    mutationGuard,
    issuanceRateLimiter,
    publicRateLimiter,
    service = new QrTokenService(),
  }: Dependencies,
) {
  app.post('/api/qr/tokens', issuanceRateLimiter, standardAuth, mutationGuard, async (req, res) => {
    try {
      const body = strictQrObject(req.body, ['purpose', 'subjectId', 'expiresInMinutes']);
      if (!isQrTokenPurpose(body.purpose)) throw new QrTokenError(400, 'QR_INVALID_PURPOSE', 'QR token purpose is invalid.');
      const purpose = body.purpose;
      const identity = { tenantId: req.authUser!.tenantId, employeeId: req.authUser!.employeeId };
      let employeeId: string | null = null;
      let assetId: string | null = null;
      let expiresInMinutes: number | null = null;
      if (purpose === 'employee_verification') {
        employeeId = body.subjectId === undefined
          ? identity.employeeId
          : requireUuid(body.subjectId, 'Employee');
        if (body.expiresInMinutes !== undefined) throw new QrTokenError(400, 'QR_INVALID_REQUEST', 'Employee tokens do not accept an expiry override.');
      } else if (purpose === 'asset_lookup') {
        assetId = requireUuid(body.subjectId, 'Asset');
        if (body.expiresInMinutes !== undefined) throw new QrTokenError(400, 'QR_INVALID_REQUEST', 'Asset tokens do not accept an expiry override.');
      } else {
        if (body.subjectId !== undefined) throw new QrTokenError(400, 'QR_INVALID_REQUEST', 'Onboarding tokens do not accept a subject identifier.');
        expiresInMinutes = normalizeInviteExpiryMinutes(body.expiresInMinutes);
      }
      const token = await service.issue(identity, {
        purpose,
        employeeId,
        assetId,
        expiresInMinutes,
      });
      return res.status(201).json({ success: true, token });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post('/api/qr/tokens/:tokenRecordId/rotate', issuanceRateLimiter, standardAuth, mutationGuard, async (req, res) => {
    try {
      const tokenRecordId = requireUuid(req.params.tokenRecordId, 'Token');
      strictQrObject(req.body || {}, []);
      const token = await service.rotate(
        { tenantId: req.authUser!.tenantId, employeeId: req.authUser!.employeeId },
        tokenRecordId,
      );
      return res.json({ success: true, token });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.delete('/api/qr/tokens/:tokenRecordId', issuanceRateLimiter, standardAuth, mutationGuard, async (req, res) => {
    try {
      const tokenRecordId = requireUuid(req.params.tokenRecordId, 'Token');
      const result = await service.revoke(
        { tenantId: req.authUser!.tenantId, employeeId: req.authUser!.employeeId },
        tokenRecordId,
      );
      return res.json(result);
    } catch (error) {
      return sendError(res, error);
    }
  });

  for (const route of PUBLIC_PURPOSES) {
    app.get(route.path, publicRateLimiter, async (req, res) => {
      if (!isValidQrToken(req.params.token)) return hidden(res);
      try {
        const result = await service.resolvePublic(route.purpose, hashQrToken(req.params.token));
        if (!result) return hidden(res);
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Referrer-Policy', 'no-referrer');
        return res.json({ success: true, ...result });
      } catch {
        return hidden(res);
      }
    });
  }

  app.post('/api/public/onboarding-invites/:token/consume', publicRateLimiter, async (req, res) => {
    if (!isValidQrToken(req.params.token)) return hidden(res);
    try {
      strictQrObject(req.body || {}, []);
      const result = await service.consumeOnboardingInvite(hashQrToken(req.params.token));
      if (!result) return hidden(res);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      return res.json({ success: true, ...result });
    } catch {
      return hidden(res);
    }
  });
}
