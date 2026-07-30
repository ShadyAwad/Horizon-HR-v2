import type express from 'express';
import { QrTokenService } from './qr-token-service';
import { QrTokenError } from './qr-token-types';
import { requireUuid, strictQrObject } from './qr-token-validation';

type Middleware = express.RequestHandler;
type Dependencies = {
  standardAuth: Middleware;
  mutationGuard: Middleware;
  issuanceRateLimiter: Middleware;
  service?: QrTokenService;
};

function fail(res: express.Response, error: unknown) {
  if (error instanceof QrTokenError) {
    return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
  }
  if (process.env.NODE_ENV !== 'production') console.error('[digital badge] request failed', error);
  return res.status(500).json({ success: false, code: 'DIGITAL_BADGE_FAILED', message: 'Digital badge is unavailable.' });
}

function identity(req: express.Request) {
  return { tenantId: req.authUser!.tenantId, employeeId: req.authUser!.employeeId };
}

export function registerEmployeeBadgeRoutes(app: express.Express, {
  standardAuth,
  mutationGuard,
  issuanceRateLimiter,
  service = new QrTokenService(),
}: Dependencies) {
  app.get('/api/me/digital-badge', standardAuth, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      return res.json({ success: true, badge: await service.getEmployeeBadge(identity(req)) });
    } catch (error) {
      return fail(res, error);
    }
  });

  app.post('/api/me/digital-badge/issue', issuanceRateLimiter, standardAuth, mutationGuard, async (req, res) => {
    try {
      strictQrObject(req.body || {}, []);
      const result = await service.issueEmployeeBadge(identity(req));
      return res.status(result.created ? 201 : 200).json({ success: true, badge: result.badge, created: result.created });
    } catch (error) {
      return fail(res, error);
    }
  });

  app.post('/api/me/digital-badge/rotate', issuanceRateLimiter, standardAuth, mutationGuard, async (req, res) => {
    try {
      strictQrObject(req.body || {}, []);
      return res.json({ success: true, badge: await service.rotateEmployeeBadge(identity(req)) });
    } catch (error) {
      return fail(res, error);
    }
  });

  app.post('/api/me/digital-badge/revoke', issuanceRateLimiter, standardAuth, mutationGuard, async (req, res) => {
    try {
      strictQrObject(req.body || {}, []);
      return res.json({ success: true, badge: await service.revokeEmployeeBadge(identity(req)) });
    } catch (error) {
      return fail(res, error);
    }
  });

  const hrPath = '/api/hr/employees/:employeeId/digital-badge';
  app.get(hrPath, standardAuth, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      return res.json({ success: true, badge: await service.getEmployeeBadge(identity(req), requireUuid(req.params.employeeId, 'Employee')) });
    } catch (error) {
      return fail(res, error);
    }
  });
  app.post(`${hrPath}/issue`, issuanceRateLimiter, standardAuth, mutationGuard, async (req, res) => {
    try {
      strictQrObject(req.body || {}, []);
      const result = await service.issueEmployeeBadge(identity(req), requireUuid(req.params.employeeId, 'Employee'));
      return res.status(result.created ? 201 : 200).json({ success: true, badge: result.badge, created: result.created });
    } catch (error) { return fail(res, error); }
  });
  app.post(`${hrPath}/rotate`, issuanceRateLimiter, standardAuth, mutationGuard, async (req, res) => {
    try {
      strictQrObject(req.body || {}, []);
      return res.json({ success: true, badge: await service.rotateEmployeeBadge(identity(req), requireUuid(req.params.employeeId, 'Employee')) });
    } catch (error) { return fail(res, error); }
  });
  app.post(`${hrPath}/revoke`, issuanceRateLimiter, standardAuth, mutationGuard, async (req, res) => {
    try {
      strictQrObject(req.body || {}, []);
      return res.json({ success: true, badge: await service.revokeEmployeeBadge(identity(req), requireUuid(req.params.employeeId, 'Employee')) });
    } catch (error) { return fail(res, error); }
  });
}
