import express from 'express';
import multer from 'multer';
import { DocumentExtractionService } from './extraction-service';
import {
  ExtractionError,
  MODE_PERMISSIONS,
  isExtractionMode,
  type ExtractionMode,
} from './extraction-types';
import { EXTRACTION_MAX_BYTES } from './extraction-validation';

type Middleware = express.RequestHandler;
type Dependencies = {
  standardAuth: Middleware;
  mutationGuard: Middleware;
  rateLimiter: Middleware;
  service?: DocumentExtractionService;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: EXTRACTION_MAX_BYTES,
    files: 1,
    fields: 1,
    parts: 3,
  },
}).single('file');

function hasExplicitPermission(req: express.Request, mode: ExtractionMode) {
  return Boolean(req.authUser?.permissions?.includes(MODE_PERMISSIONS[mode]));
}

function parseUpload(req: express.Request, res: express.Response) {
  return new Promise<Express.Multer.File>((resolve, reject) => {
    upload(req, res, (error) => {
      if (error) return reject(error);
      if (!req.file) return reject(new ExtractionError('INVALID_IMAGE', 'Select one image to extract.', 400));
      resolve(req.file);
    });
  });
}

function sendError(res: express.Response, error: unknown) {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ success: false, code: 'FILE_TOO_LARGE', message: 'The selected file must be 10 MB or smaller.' });
    }
    return res.status(400).json({ success: false, code: 'INVALID_MULTIPART', message: 'Send exactly one file and one extraction mode.' });
  }
  if (error instanceof ExtractionError) {
    return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
  }
  if (process.env.NODE_ENV !== 'production') console.error('[document-extraction failed]', error);
  return res.status(500).json({ success: false, code: 'EXTRACTION_FAILED', message: 'The document could not be extracted.' });
}

function requireModePermission(req: express.Request, res: express.Response, mode: ExtractionMode) {
  if (hasExplicitPermission(req, mode)) return true;
  res.status(403).json({
    success: false,
    code: 'EXTRACTION_PERMISSION_DENIED',
    message: 'You do not have permission to use this extraction mode.',
  });
  return false;
}

export function registerDocumentExtractionRoutes(
  app: express.Express,
  { standardAuth, mutationGuard, rateLimiter, service = new DocumentExtractionService() }: Dependencies,
) {
  app.post('/api/document-extractions', rateLimiter, standardAuth, mutationGuard, async (req, res) => {
    try {
      const file = await parseUpload(req, res);
      const fields = Object.keys(req.body || {});
      if (fields.length !== 1 || fields[0] !== 'mode' || !isExtractionMode(req.body.mode)) {
        throw new ExtractionError('INVALID_EXTRACTION_MODE', 'Select a supported extraction mode.', 400);
      }
      if (!requireModePermission(req, res, req.body.mode)) return;
      const extraction = await service.create(
        { tenantId: req.authUser!.tenantId, employeeId: req.authUser!.employeeId },
        req.body.mode,
        file,
      );
      return res.status(extraction.status === 'completed' ? 201 : 202).json({ success: true, ...extraction });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.get('/api/document-extractions/:extractionId', standardAuth, async (req, res) => {
    try {
      if (!UUID_PATTERN.test(req.params.extractionId)) {
        throw new ExtractionError('INVALID_EXTRACTION_ID', 'Invalid extraction id.', 400);
      }
      const identity = { tenantId: req.authUser!.tenantId, employeeId: req.authUser!.employeeId };
      const extraction = await service.getOwn(identity, req.params.extractionId);
      if (!requireModePermission(req, res, extraction.mode)) return;
      return res.json({ success: true, ...extraction });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.delete('/api/document-extractions/:extractionId', rateLimiter, standardAuth, mutationGuard, async (req, res) => {
    try {
      if (!UUID_PATTERN.test(req.params.extractionId)) {
        throw new ExtractionError('INVALID_EXTRACTION_ID', 'Invalid extraction id.', 400);
      }
      const identity = { tenantId: req.authUser!.tenantId, employeeId: req.authUser!.employeeId };
      const extraction = await service.getOwn(identity, req.params.extractionId);
      if (!requireModePermission(req, res, extraction.mode)) return;
      const result = await service.deleteOwn(identity, req.params.extractionId);
      return res.json(result);
    } catch (error) {
      return sendError(res, error);
    }
  });
}
