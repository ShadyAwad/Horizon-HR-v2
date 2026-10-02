import { logServerError } from '../../lib/server-logging';
import crypto from 'crypto';
import type express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { assetEvidenceStorage } from '../../lib/asset-evidence-storage';
import { withTenant } from '../../lib/hr-background';
import { recordAuditEvent } from '../audit/audit-events';
import { hasPermissionClaim } from '../auth/permission-claims';

const ASSET_EVIDENCE_MAX_BYTES = 6 * 1024 * 1024;
const ASSET_EVIDENCE_MAX_INPUT_PIXELS = 24_000_000;
const ASSET_EVIDENCE_MAX_INPUT_DIMENSION = 8_000;
const ASSET_EVIDENCE_MAX_STORED_DIMENSION = 2_000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AssetEvidenceRouteDependencies = {
  standardAuth: express.RequestHandler;
  rateLimiter: express.RequestHandler;
  isSameOriginRequest: (req: express.Request) => boolean;
};

function isUuid(value: string | undefined) {
  return Boolean(value && uuidPattern.test(value));
}

const assetEvidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: ASSET_EVIDENCE_MAX_BYTES, files: 1, fields: 2 },
}).single('image');

function parseAssetEvidenceUpload(req: express.Request, res: express.Response) {
  return new Promise<Express.Multer.File>((resolve, reject) => {
    assetEvidenceUpload(req, res, (error) => {
      if (error) return reject(error);
      if (!req.file) {
        return reject(Object.assign(new Error('Select a JPEG, PNG, or WebP image.'), { statusCode: 400 }));
      }
      resolve(req.file);
    });
  });
}

export function registerAssetEvidenceRoutes(
  app: express.Express,
  { standardAuth, rateLimiter, isSameOriginRequest }: AssetEvidenceRouteDependencies,
) {
  app.post('/api/assets/:assetId/evidence', rateLimiter, standardAuth, async (req, res) => {
    const { assetId } = req.params;
    const authUser = req.authUser!;
    if (!isUuid(assetId)) return res.status(400).json({ success: false, error: 'Invalid asset id.' });
    if (!isSameOriginRequest(req)) return res.status(403).json({ success: false, error: 'Evidence upload must originate from Stanza.' });

    let storageKey: string | null = null;
    try {
      const file = await parseAssetEvidenceUpload(req, res);
      const condition = typeof req.body.condition === 'string' ? req.body.condition : 'damaged';
      const notes = typeof req.body.notes === 'string' ? req.body.notes.trim().slice(0, 4000) : null;
      if (!['new', 'good', 'fair', 'damaged', 'unusable'].includes(condition)) return res.status(400).json({ success: false, error: 'Invalid asset condition.' });

      const decoded = sharp(file.buffer, { animated: false, failOn: 'error', limitInputPixels: ASSET_EVIDENCE_MAX_INPUT_PIXELS });
      const metadata = await decoded.metadata();
      if (!metadata.format || !['jpeg', 'png', 'webp'].includes(metadata.format) || (metadata.pages || 1) !== 1) {
        return res.status(415).json({ success: false, error: 'Only JPEG, PNG, and WebP images are supported.' });
      }
      const width = metadata.width || 0;
      const height = metadata.height || 0;
      if (!width || !height || width > ASSET_EVIDENCE_MAX_INPUT_DIMENSION || height > ASSET_EVIDENCE_MAX_INPUT_DIMENSION || width * height > ASSET_EVIDENCE_MAX_INPUT_PIXELS) {
        return res.status(422).json({ success: false, error: 'Image dimensions are not supported.' });
      }
      const processed = await decoded.rotate().resize({ width: ASSET_EVIDENCE_MAX_STORED_DIMENSION, height: ASSET_EVIDENCE_MAX_STORED_DIMENSION, fit: 'inside', withoutEnlargement: true }).webp({ quality: 84 }).toBuffer();
      const evidenceId = crypto.randomUUID();
      storageKey = await assetEvidenceStorage.write(authUser.tenantId, evidenceId, processed);
      const report = await withTenant(authUser.tenantId, async (client) => {
        const asset = await client.query<{ id: string; asset_tag: string; status: string }>('SELECT id, asset_tag, status FROM assets WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [authUser.tenantId, assetId]);
        if (!asset.rows[0]) throw Object.assign(new Error('Asset not found.'), { statusCode: 404 });
        const canManage = hasPermissionClaim(authUser, 'assets.manage');
        const assignment = await client.query<{ id: string }>(`SELECT id FROM asset_assignments WHERE tenant_id=$1 AND asset_id=$2 AND employee_id=$3 AND status='active' FOR UPDATE`, [authUser.tenantId, assetId, authUser.employeeId]);
        if (!canManage && !assignment.rows[0]) throw Object.assign(new Error('Active asset assignment not found.'), { statusCode: 404 });
        if (asset.rows[0].status === 'lost' || asset.rows[0].status === 'retired') throw Object.assign(new Error('Evidence cannot be added for this asset state.'), { statusCode: 409 });
        const created = await client.query(`INSERT INTO asset_condition_reports(tenant_id,asset_id,assignment_id,reported_by,condition,notes,evidence_url) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [authUser.tenantId, assetId, assignment.rows[0]?.id || null, authUser.employeeId, condition, notes || null, storageKey]);
        await client.query(`UPDATE assets SET condition=$3,status=CASE WHEN $3 IN ('damaged','unusable') AND status='available' THEN 'maintenance' ELSE status END,updated_at=NOW() WHERE tenant_id=$1 AND id=$2`, [authUser.tenantId, assetId, condition]);
        await recordAuditEvent(client, { tenantId: authUser.tenantId, actorId: authUser.employeeId, action: 'asset.condition_reported', targetType: 'asset', targetId: assetId, metadata: { assetTag: asset.rows[0].asset_tag, condition } });
        return created.rows[0];
      });
      return res.status(201).json({ success: true, report: { id: report.id, evidenceUrl: `/api/assets/evidence/${report.id}` } });
    } catch (error) {
      if (storageKey) await assetEvidenceStorage.remove(storageKey).catch(() => undefined);
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ success: false, error: 'Image must be 6 MB or smaller.' });
      const statusCode = Number((error as { statusCode?: number }).statusCode) || 422;
      if (process.env.NODE_ENV !== 'production') logServerError('[Asset Evidence] Upload failed:', error);
      return res.status(statusCode).json({ success: false, error: statusCode === 404 || statusCode === 409 ? (error as Error).message : 'Unable to process evidence image.' });
    }
  });

  app.get('/api/assets/evidence/:reportId', standardAuth, async (req, res) => {
    if (!isUuid(req.params.reportId)) return res.status(404).end();
    const authUser = req.authUser!;
    try {
      const report = await withTenant(authUser.tenantId, async (client) => {
        const canView = hasPermissionClaim(authUser, 'assets.view');
        const result = await client.query<{ evidence_url: string }>(`SELECT evidence_url FROM asset_condition_reports WHERE tenant_id=$1 AND id=$2 AND evidence_url IS NOT NULL AND ($3::boolean OR reported_by=$4 OR EXISTS(SELECT 1 FROM asset_assignments WHERE tenant_id=asset_condition_reports.tenant_id AND asset_id=asset_condition_reports.asset_id AND employee_id=$4 AND status='active'))`, [authUser.tenantId, req.params.reportId, canView, authUser.employeeId]);
        return result.rows[0] || null;
      });
      if (!report) return res.status(404).end();
      const contents = await assetEvidenceStorage.read(report.evidence_url);
      res.setHeader('Content-Type', 'image/webp');
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', 'inline');
      return res.send(contents);
    } catch {
      return res.status(404).end();
    }
  });
}
