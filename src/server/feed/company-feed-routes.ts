import crypto from 'crypto';
import type express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { hasDatabaseConfig, withTenant } from '../../lib/hr-background';
import { companyFeedImageStorage } from '../../lib/company-feed-image-storage';
import {
  collectFeedImageIds,
  FEED_IMAGE_ALT_MAX_LENGTH,
  FEED_EDITOR_FORMAT,
  FEED_EDITOR_SCHEMA_VERSION,
  normalizeFeedImageDimensions,
  validateFeedEditorDocument,
} from '../../lib/feed-editor-contract';
import { hasPermissionClaim } from '../auth/permission-claims';

type EmployeeRole = 'hr_admin' | 'manager' | 'employee';
type FeedPostType = 'announcement' | 'event' | 'policy_update' | 'general';
type FeedPostStatus = 'draft' | 'published' | 'archived';
type FeedVisibilityType = 'all' | 'role' | 'location';

type FeedVisibilityInput = {
  type?: FeedVisibilityType;
  role?: EmployeeRole;
  locationId?: string;
};

type NormalizedFeedVisibility = {
  type: FeedVisibilityType;
  role?: EmployeeRole;
  locationId?: string;
};

type CreateFeedPostBody = {
  title?: string;
  postType?: FeedPostType;
  contentText?: string;
  contentJson?: unknown;
  editorFormat?: string;
  editorSchemaVersion?: number;
  eventStartsAt?: string | null;
  eventEndsAt?: string | null;
  status?: Exclude<FeedPostStatus, 'archived'>;
  visibility?: FeedVisibilityInput[];
  draftId?: string;
  draftVersion?: number;
};

type UpsertCompanyFeedDraftBody = {
  title?: string;
  contentText?: string;
  contentJson?: unknown;
  contentFormat?: string;
  expectedVersion?: number | null;
};

type UpdateFeedPostStatusBody = {
  status?: FeedPostStatus;
};

type CompanyFeedRouteDependencies = {
  standardAuth: express.RequestHandler;
  requirePermission: (permission: string) => express.RequestHandler;
  imageRateLimiter: express.RequestHandler;
  draftRateLimiter: express.RequestHandler;
  mutationGuard: express.RequestHandler;
  isSameOriginRequest: (req: express.Request) => boolean;
};

const FEED_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const FEED_IMAGE_MAX_INPUT_PIXELS = 40_000_000;
const FEED_IMAGE_MAX_INPUT_DIMENSION = 12_000;
const FEED_IMAGE_MAX_STORED_DIMENSION = 2_400;
const FEED_IMAGE_PENDING_TTL_HOURS = 24;
const FEED_DRAFT_ABANDONMENT_DAYS = 30;
const feedPostTypes: FeedPostType[] = ['announcement', 'event', 'policy_update', 'general'];
const feedPostStatuses: FeedPostStatus[] = ['draft', 'published', 'archived'];
const feedVisibilityTypes: FeedVisibilityType[] = ['all', 'role', 'location'];
const employeeRoles: EmployeeRole[] = ['employee', 'manager', 'hr_admin'];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isFeedPostType(value: unknown): value is FeedPostType {
  return typeof value === 'string' && feedPostTypes.includes(value as FeedPostType);
}

function isFeedPostStatus(value: unknown): value is FeedPostStatus {
  return typeof value === 'string' && feedPostStatuses.includes(value as FeedPostStatus);
}

function isFeedVisibilityType(value: unknown): value is FeedVisibilityType {
  return typeof value === 'string' && feedVisibilityTypes.includes(value as FeedVisibilityType);
}

function isEmployeeRole(value: unknown): value is EmployeeRole {
  return typeof value === 'string' && employeeRoles.includes(value as EmployeeRole);
}

function isUuid(value: string | undefined) {
  return Boolean(value && uuidPattern.test(value));
}

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function normalizeFeedDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function normalizeFeedVisibility(visibility: FeedVisibilityInput[] | undefined) {
  const rawVisibility = Array.isArray(visibility) && visibility.length > 0
    ? visibility
    : [{ type: 'all' as const }];

  if (rawVisibility.some((rule) => rule.type === 'all')) {
    return { ok: true as const, visibility: [{ type: 'all' as const }] };
  }

  const normalizedVisibility: NormalizedFeedVisibility[] = [];

  for (const rule of rawVisibility) {
    if (!isFeedVisibilityType(rule.type)) {
      return { ok: false as const, error: 'visibility type must be all, role, or location.' };
    }

    if (rule.type === 'role') {
      if (!isEmployeeRole(rule.role)) {
        return { ok: false as const, error: 'visibility role must be employee, manager, or hr_admin.' };
      }

      normalizedVisibility.push({ type: 'role', role: rule.role });
    }

    if (rule.type === 'location') {
      if (!rule.locationId) {
        return { ok: false as const, error: 'location visibility requires locationId.' };
      }

      normalizedVisibility.push({ type: 'location', locationId: rule.locationId });
    }
  }

  return {
    ok: true as const,
    visibility: normalizedVisibility.length > 0 ? normalizedVisibility : [{ type: 'all' as const }],
  };
}

function presentCompanyFeedDraft(row: Record<string, unknown> | null) {
  if (!row) return null;
  const contentJson = row.content_json ?? row.contentJson ?? null;
  const validation = validateFeedEditorDocument(contentJson);
  if (validation.ok === false) return null;
  const attachmentReferences = row.attachment_references && typeof row.attachment_references === 'object'
    ? row.attachment_references
    : { imageIds: collectFeedImageIds(validation.document) };

  return {
    id: typeof row.id === 'string' ? row.id : '',
    title: typeof row.title === 'string' ? row.title : '',
    contentText: validation.extractedText,
    contentFormat: typeof row.content_format === 'string' ? row.content_format : FEED_EDITOR_FORMAT,
    contentJson: validation.document,
    attachmentReferences,
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function registerCompanyFeedRoutes(
  app: express.Express,
  {
    standardAuth: demoAuth,
    requirePermission,
    imageRateLimiter: feedImageRateLimiter,
    draftRateLimiter: feedDraftRateLimiter,
    mutationGuard: isSameOriginSessionMutation,
    isSameOriginRequest: isSameOriginSessionRequest,
  }: CompanyFeedRouteDependencies,
) {
  const feedImageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: FEED_IMAGE_MAX_BYTES, files: 1, fields: 2 },
  }).single('image');
  const parseFeedImageUpload = (
    req: express.Request,
    res: express.Response,
  ) => new Promise<Express.Multer.File>((resolve, reject) => {
    feedImageUpload(req, res, (error) => {
      if (error) return reject(error);
      if (!req.file) return reject(Object.assign(new Error('Select an image to upload.'), { statusCode: 400 }));
      resolve(req.file);
    });
  });

  app.post(
    '/api/company-feed/images',
    feedImageRateLimiter,
    demoAuth,
    requirePermission('feed.publish'),
    async (req, res) => {
      if (!isSameOriginSessionRequest(req)) {
        return res.status(403).json({ success: false, error: 'Image upload must originate from Stanza.' });
      }
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ success: false, error: 'DATABASE_URL is required for company feed images.' });
      }
  
      const tenantId = req.authUser!.tenantId;
      const actorEmployeeId = req.authUser!.employeeId;
      const imageId = crypto.randomUUID();
      let storageKey: string | null = null;
  
      try {
        const file = await parseFeedImageUpload(req, res);
        const altText = typeof req.body.altText === 'string' ? req.body.altText.trim() : '';
        if (altText.length > FEED_IMAGE_ALT_MAX_LENGTH) {
          return res.status(400).json({ success: false, error: 'Image alt text is too long.' });
        }
  
        const input = sharp(file.buffer, {
          animated: false,
          failOn: 'error',
          limitInputPixels: FEED_IMAGE_MAX_INPUT_PIXELS,
        });
        const metadata = await input.metadata();
        const width = metadata.width || 0;
        const height = metadata.height || 0;
        if (
          !metadata.format ||
          !['jpeg', 'png', 'webp'].includes(metadata.format) ||
          (metadata.pages || 1) !== 1
        ) {
          return res.status(415).json({ success: false, error: 'Only JPEG, PNG, and WebP images are supported.' });
        }
        if (
          width < 1 ||
          height < 1 ||
          width > FEED_IMAGE_MAX_INPUT_DIMENSION ||
          height > FEED_IMAGE_MAX_INPUT_DIMENSION ||
          width * height > FEED_IMAGE_MAX_INPUT_PIXELS
        ) {
          return res.status(422).json({ success: false, error: 'Image dimensions are not supported.' });
        }
  
        const processed = await input
          .rotate()
          .resize({
            width: FEED_IMAGE_MAX_STORED_DIMENSION,
            height: FEED_IMAGE_MAX_STORED_DIMENSION,
            fit: 'inside',
            withoutEnlargement: true,
          })
          .webp({ quality: 84 })
          .toBuffer({ resolveWithObject: true });
  
        storageKey = await companyFeedImageStorage.write(tenantId, imageId, processed.data);
        const staleStorageKeys = await withTenant(tenantId, async (client) => {
          // A saved private draft keeps only image UUIDs. After 30 inactive days,
          // mark it abandoned so the existing pending-image cleanup can reclaim storage.
          await client.query(
            `UPDATE company_feed_drafts
             SET status = 'discarded', discarded_at = NOW(), updated_at = NOW(), version = version + 1
             WHERE tenant_id = $1 AND status = 'active'
               AND updated_at < NOW() - ($2::integer * INTERVAL '1 day')`,
            [tenantId, FEED_DRAFT_ABANDONMENT_DAYS],
          );
          const stale = await client.query<{ storage_key: string }>(
            `DELETE FROM company_feed_images
             WHERE id IN (
               SELECT id
               FROM company_feed_images
               WHERE company_feed_images.tenant_id = $1
                 AND company_feed_images.post_id IS NULL
                 AND company_feed_images.created_at < NOW() - ($2::integer * INTERVAL '1 hour')
                 AND NOT EXISTS (
                   SELECT 1 FROM company_feed_drafts
                   WHERE company_feed_drafts.tenant_id = company_feed_images.tenant_id
                     AND company_feed_drafts.author_employee_id = company_feed_images.uploaded_by
                     AND company_feed_drafts.status = 'active'
                     AND company_feed_drafts.attachment_references @> jsonb_build_object(
                       'imageIds', jsonb_build_array(company_feed_images.id::text)
                     )
                 )
               ORDER BY created_at
               LIMIT 25
             )
             RETURNING storage_key`,
            [tenantId, FEED_IMAGE_PENDING_TTL_HOURS],
          );
          await client.query(
            `INSERT INTO company_feed_images (
               id, tenant_id, uploaded_by, storage_key, width, height, original_bytes, stored_bytes
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              imageId,
              tenantId,
              actorEmployeeId,
              storageKey,
              processed.info.width,
              processed.info.height,
              file.size,
              processed.data.length,
            ],
          );
          return stale.rows.map((row) => row.storage_key);
        });
        await Promise.all(staleStorageKeys.map((key) => companyFeedImageStorage.remove(key)));
  
        const displayDimensions = normalizeFeedImageDimensions(processed.info.width, processed.info.height);
        return res.status(201).json({
          success: true,
          image: {
            id: imageId,
            url: `/api/company-feed/images/${imageId}`,
            altText,
            width: displayDimensions.width,
            height: displayDimensions.height,
          },
        });
      } catch (error) {
        if (storageKey) await companyFeedImageStorage.remove(storageKey).catch(() => undefined);
        if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ success: false, error: 'Image must be 8 MB or smaller.' });
        }
        const statusCode = Number((error as { statusCode?: number }).statusCode) || 422;
        if (!isProduction()) console.error('[Company Feed Image] Upload failed:', error);
        return res.status(statusCode).json({
          success: false,
          error: statusCode === 400 ? (error as Error).message : 'Unable to process this image.',
        });
      }
    },
  );
  
  app.get(
    '/api/company-feed/images/:id',
    demoAuth,
    requirePermission('feed.read'),
    async (req, res) => {
      const imageId = req.params.id;
      if (!isUuid(imageId)) return res.status(404).end();
  
      const authUser = req.authUser!;
      try {
        const image = await withTenant(authUser.tenantId, async (client) => {
          const canPublish = hasPermissionClaim(authUser, 'feed.publish');
          const result = await client.query<{ storage_key: string }>(
            `SELECT image.storage_key
             FROM company_feed_images image
             LEFT JOIN company_feed_posts post
               ON post.id = image.post_id
              AND post.tenant_id = image.tenant_id
             WHERE image.tenant_id = $1
               AND image.id = $2
               AND (
                 image.uploaded_by = $3
                 OR $4::boolean = true
                 OR (
                   image.status = 'attached'
                   AND post.status = 'published'
                   AND (
                     EXISTS (
                       SELECT 1 FROM company_feed_visibility visibility
                       WHERE visibility.tenant_id = image.tenant_id
                         AND visibility.post_id = post.id
                         AND visibility.visibility_type = 'all'
                     )
                     OR EXISTS (
                       SELECT 1 FROM company_feed_visibility visibility
                       WHERE visibility.tenant_id = image.tenant_id
                         AND visibility.post_id = post.id
                         AND visibility.visibility_type = 'role'
                         AND visibility.role = $5
                     )
                   )
                 )
               )
             LIMIT 1`,
            [authUser.tenantId, imageId, authUser.employeeId, canPublish, authUser.role],
          );
          return result.rows[0] || null;
        });
        if (!image) return res.status(404).end();
  
        const contents = await companyFeedImageStorage.read(image.storage_key);
        res.setHeader('Content-Type', 'image/webp');
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Disposition', 'inline');
        return res.send(contents);
      } catch (error) {
        if (!isProduction()) console.error('[Company Feed Image] Read failed:', error);
        return res.status(404).end();
      }
    },
  );
  
  app.get(
    '/api/me/company-feed/draft',
    feedDraftRateLimiter,
    demoAuth,
    requirePermission('feed.publish'),
    async (req, res) => {
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ success: false, error: 'DATABASE_URL is required for company feed drafts.' });
      }
  
      const authUser = req.authUser!;
      try {
        const draft = await withTenant(authUser.tenantId, async (client) => {
          const result = await client.query(
            `SELECT id, title, content_format, content_json, attachment_references, version, created_at, updated_at
             FROM company_feed_drafts
             WHERE tenant_id = $1
               AND author_employee_id = $2
               AND draft_key = 'company_feed_main'
               AND status = 'active'
             LIMIT 1`,
            [authUser.tenantId, authUser.employeeId],
          );
          return result.rows[0] || null;
        });
  
        return res.json({
          success: true,
          draft: presentCompanyFeedDraft(draft),
        });
      } catch (error) {
        console.error('[Company Feed] Failed to load private draft:', error);
        return res.status(500).json({ success: false, error: 'Unable to load company feed draft.' });
      }
    },
  );
  
  app.put(
    '/api/me/company-feed/draft',
    feedDraftRateLimiter,
    demoAuth,
    requirePermission('feed.publish'),
    isSameOriginSessionMutation,
    async (req, res) => {
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ success: false, error: 'DATABASE_URL is required for company feed drafts.' });
      }
  
      const authUser = req.authUser!;
      const body = req.body as UpsertCompanyFeedDraftBody;
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      const contentText = typeof body.contentText === 'string' ? body.contentText.trim() : '';
      const contentFormat = body.contentFormat || FEED_EDITOR_FORMAT;
      const expectedVersion = body.expectedVersion == null ? null : Number(body.expectedVersion);
      const serializedContentJson = body.contentJson == null ? '' : JSON.stringify(body.contentJson);
  
      if (contentFormat !== FEED_EDITOR_FORMAT || !Number.isInteger(expectedVersion ?? 0) && expectedVersion !== null) {
        return res.status(400).json({ success: false, error: 'Draft version or editor format is not supported.' });
      }
      if (title.length > 160 || contentText.length > 20000 || serializedContentJson.length > 50000) {
        return res.status(400).json({ success: false, error: 'Draft content exceeds the allowed size.' });
      }
      const validation = validateFeedEditorDocument(body.contentJson, contentText);
      if (validation.ok === false) {
        return res.status(400).json({ success: false, error: validation.error });
      }
      const imageIds = collectFeedImageIds(body.contentJson);
      const hasMeaningfulContent = Boolean(title || contentText || imageIds.length > 0);
  
      try {
        const outcome = await withTenant(authUser.tenantId, async (client) => {
          // Serialise one author's standard composer without granting anyone else access.
          await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
            `${authUser.tenantId}:${authUser.employeeId}:company_feed_main`,
          ]);
          const currentResult = await client.query(
            `SELECT id, title, content_format, content_json, attachment_references, version, created_at, updated_at
             FROM company_feed_drafts
             WHERE tenant_id = $1 AND author_employee_id = $2
               AND draft_key = 'company_feed_main' AND status = 'active'
             LIMIT 1 FOR UPDATE`,
            [authUser.tenantId, authUser.employeeId],
          );
          const current = currentResult.rows[0] || null;
  
          if (!hasMeaningfulContent) {
            if (current) {
              await client.query(
                `UPDATE company_feed_drafts
                 SET status = 'discarded', discarded_at = NOW(), updated_at = NOW(), version = version + 1
                 WHERE tenant_id = $1 AND id = $2 AND author_employee_id = $3`,
                [authUser.tenantId, current.id, authUser.employeeId],
              );
            }
            return { empty: true as const, draft: null };
          }
  
          if (current && expectedVersion !== null && Number(current.version) !== expectedVersion) {
            return { conflict: true as const, draft: current };
          }
          if (!current && expectedVersion !== null && expectedVersion !== 0) {
            return { conflict: true as const, draft: null };
          }
  
          if (imageIds.length > 0) {
            const images = await client.query<{ id: string }>(
              `SELECT id FROM company_feed_images
               WHERE tenant_id = $1 AND uploaded_by = $2 AND status = 'pending' AND post_id IS NULL
                 AND id = ANY($3::uuid[]) FOR UPDATE`,
              [authUser.tenantId, authUser.employeeId, imageIds],
            );
            if (images.rowCount !== imageIds.length) {
              throw Object.assign(new Error('One or more draft image references are unavailable.'), { statusCode: 400 });
            }
          }
  
          const values = [
            title || null,
            serializedContentJson,
            JSON.stringify({ imageIds }),
            authUser.tenantId,
            authUser.employeeId,
          ];
          const result = current
            ? await client.query(
              `UPDATE company_feed_drafts
               SET title = $1::varchar, content_json = $2::jsonb, attachment_references = $3::jsonb,
                   version = version + 1, updated_at = NOW()
               WHERE tenant_id = $4 AND author_employee_id = $5 AND id = $6
               RETURNING id, title, content_format, content_json, attachment_references, version, created_at, updated_at`,
              [...values, current.id],
            )
            : await client.query(
              `INSERT INTO company_feed_drafts (
                 tenant_id, author_employee_id, title, content_format, content_json, attachment_references
               ) VALUES ($4::uuid, $5::uuid, $1::varchar, $6::varchar, $2::jsonb, $3::jsonb)
               RETURNING id, title, content_format, content_json, attachment_references, version, created_at, updated_at`,
              [...values, FEED_EDITOR_FORMAT],
            );
          return { conflict: false as const, draft: result.rows[0] };
        });
  
        if ('conflict' in outcome && outcome.conflict) {
          const draft = outcome.draft;
          return res.status(409).json({
            success: false,
            code: 'DRAFT_VERSION_CONFLICT',
            error: 'This draft changed in another session. Continue with the newest saved draft.',
            draft: presentCompanyFeedDraft(draft),
          });
        }
        if ('empty' in outcome && outcome.empty) return res.status(204).end();
  
        const draft = outcome.draft;
        return res.status(200).json({
          success: true,
          draft: presentCompanyFeedDraft(draft),
        });
      } catch (error) {
        const statusCode = Number((error as { statusCode?: number }).statusCode) || 500;
        if (statusCode !== 500) return res.status(statusCode).json({ success: false, error: (error as Error).message });
        console.error('[Company Feed] Failed to save private draft:', error);
        return res.status(500).json({ success: false, error: 'Unable to save company feed draft.' });
      }
    },
  );
  
  app.delete(
    '/api/me/company-feed/draft',
    feedDraftRateLimiter,
    demoAuth,
    requirePermission('feed.publish'),
    isSameOriginSessionMutation,
    async (req, res) => {
      if (!hasDatabaseConfig()) return res.status(503).json({ success: false, error: 'DATABASE_URL is required for company feed drafts.' });
      const authUser = req.authUser!;
      try {
        const discarded = await withTenant(authUser.tenantId, async (client) => {
          const result = await client.query<{ id: string }>(
            `UPDATE company_feed_drafts
             SET status = 'discarded', discarded_at = NOW(), updated_at = NOW(), version = version + 1
             WHERE tenant_id = $1 AND author_employee_id = $2
               AND draft_key = 'company_feed_main' AND status = 'active'
             RETURNING id`,
            [authUser.tenantId, authUser.employeeId],
          );
          if (result.rowCount) {
            await client.query(
              `INSERT INTO audit_logs (tenant_id, actor_employee_id, action, entity_type, entity_id, metadata)
               VALUES ($1, $2, 'company_feed.draft.discarded', 'company_feed_draft', $3, '{}'::jsonb)`,
              [authUser.tenantId, authUser.employeeId, result.rows[0].id],
            );
          }
          return Boolean(result.rowCount);
        });
        return res.json({ success: true, discarded });
      } catch (error) {
        console.error('[Company Feed] Failed to discard private draft:', error);
        return res.status(500).json({ success: false, error: 'Unable to discard company feed draft.' });
      }
    },
  );
  
  app.post(
    '/api/company-feed/posts',
    demoAuth,
    requirePermission('feed.publish'),
    async (req, res) => {
      const {
        title,
        postType = 'announcement',
        contentText,
        contentJson,
        editorFormat = FEED_EDITOR_FORMAT,
        editorSchemaVersion = FEED_EDITOR_SCHEMA_VERSION,
        eventStartsAt,
        eventEndsAt,
        status = 'published',
        visibility,
        draftId,
        draftVersion,
      } = req.body as CreateFeedPostBody;
  
      const tenantId = req.authUser!.tenantId;
      const actorEmployeeId = req.authUser!.employeeId;
      const normalizedTitle = title?.trim() || '';
      const normalizedContent = contentText?.trim() || '';
      const normalizedStartsAt = normalizeFeedDate(eventStartsAt);
      const normalizedEndsAt = normalizeFeedDate(eventEndsAt);
  
      if (!normalizedTitle || !normalizedContent) {
        return res.status(400).json({
          success: false,
          error: 'title and contentText are required.',
        });
      }
  
      if (normalizedTitle.length > 160 || normalizedContent.length > 20000) {
        return res.status(400).json({
          success: false,
          error: 'title must be 160 characters or fewer and contentText must be 20000 characters or fewer.',
        });
      }
  
      if (editorFormat !== FEED_EDITOR_FORMAT || editorSchemaVersion !== FEED_EDITOR_SCHEMA_VERSION) {
        return res.status(400).json({
          success: false,
          error: 'Editor document format is not supported.',
        });
      }
  
      let feedImageIds: string[] = [];
      if (contentJson != null) {
        const validation = validateFeedEditorDocument(contentJson, normalizedContent);
        if (validation.ok === false) {
          return res.status(400).json({
            success: false,
            error: validation.error,
          });
        }
        feedImageIds = collectFeedImageIds(contentJson);
      }
  
      const serializedContentJson = contentJson == null ? null : JSON.stringify(contentJson);
      if (serializedContentJson && serializedContentJson.length > 50000) {
        return res.status(400).json({
          success: false,
          error: 'contentJson is too large.',
        });
      }
  
      if (!isFeedPostType(postType)) {
        return res.status(400).json({
          success: false,
          error: 'postType must be announcement, event, policy_update, or general.',
        });
      }
  
      if (status !== 'draft' && status !== 'published') {
        return res.status(400).json({
          success: false,
          error: 'status must be draft or published.',
        });
      }
  
      if (draftId != null && (!isUuid(draftId) || !Number.isInteger(draftVersion) || Number(draftVersion) < 1)) {
        return res.status(400).json({ success: false, error: 'Draft publication reference is invalid.' });
      }
  
      if (normalizedStartsAt === undefined || normalizedEndsAt === undefined) {
        return res.status(400).json({
          success: false,
          error: 'Event dates must be valid date/time values.',
        });
      }
  
      if (normalizedStartsAt && normalizedEndsAt && new Date(normalizedEndsAt) < new Date(normalizedStartsAt)) {
        return res.status(400).json({
          success: false,
          error: 'eventEndsAt must not be before eventStartsAt.',
        });
      }
  
      const normalizedVisibility = normalizeFeedVisibility(visibility);
      if (!normalizedVisibility.ok) {
        return res.status(400).json({
          success: false,
          error: normalizedVisibility.error,
        });
      }
  
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ success: false, error: 'DATABASE_URL is required for company feed' });
      }
  
      try {
        const post = await withTenant(tenantId, async (client) => {
          let activeDraftId: string | null = null;
          if (draftId) {
            const draftResult = await client.query<{
              id: string;
              status: 'active' | 'published' | 'discarded';
              version: number;
              published_post_id: string | null;
            }>(
              `SELECT id, status, version, published_post_id
               FROM company_feed_drafts
               WHERE tenant_id = $1 AND author_employee_id = $2 AND id = $3
               LIMIT 1 FOR UPDATE`,
              [tenantId, actorEmployeeId, draftId],
            );
            const draft = draftResult.rows[0];
            if (!draft) {
              throw Object.assign(new Error('The private draft is no longer available.'), { statusCode: 409 });
            }
            if (draft.status === 'published' && draft.published_post_id) {
              const existingPost = await client.query(
                `SELECT id, tenant_id, author_employee_id, title, post_type, content_text, content_json,
                        editor_format, editor_schema_version, event_starts_at, event_ends_at, status,
                        created_at, updated_at, published_at, archived_at
                 FROM company_feed_posts
                 WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
                [tenantId, draft.published_post_id],
              );
              if (existingPost.rows[0]) {
                const existing = existingPost.rows[0];
                return {
                  ...existing,
                  contentText: existing.content_text,
                  contentJson: existing.content_json,
                  visibility: normalizedVisibility.visibility,
                };
              }
            }
            if (draft.status !== 'active' || Number(draft.version) !== Number(draftVersion)) {
              throw Object.assign(new Error('This draft changed before it could be published. Reload the draft and try again.'), { statusCode: 409 });
            }
            activeDraftId = draft.id;
          }
  
          const locationIds = normalizedVisibility.visibility
            .filter((rule) => rule.type === 'location')
            .map((rule) => rule.locationId!);
  
          if (locationIds.length > 0) {
            const locationsResult = await client.query(
              `
                SELECT id
                FROM company_locations
                WHERE tenant_id = $1
                  AND id = ANY($2::uuid[])
              `,
              [tenantId, locationIds],
            );
  
            if (locationsResult.rowCount !== new Set(locationIds).size) {
              throw Object.assign(new Error('One or more locations do not belong to this tenant.'), { statusCode: 400 });
            }
          }
  
          const postResult = await client.query(
            `
              INSERT INTO company_feed_posts (
                tenant_id,
                author_employee_id,
                title,
                post_type,
                content_text,
                content_json,
                editor_format,
                editor_schema_version,
                event_starts_at,
                event_ends_at,
                status,
                published_at
              )
              VALUES (
                $1::uuid,
                $2::uuid,
                $3::varchar,
                $4::varchar,
                $5::text,
                $6::jsonb,
                $7::varchar,
                $8::integer,
                $9::timestamptz,
                $10::timestamptz,
                $11::varchar,
                CASE WHEN $11::varchar = 'published' THEN NOW() ELSE NOW() END
              )
              RETURNING
                id,
                tenant_id,
                author_employee_id,
                title,
                post_type,
                content_text,
                content_json,
                editor_format,
                editor_schema_version,
                event_starts_at,
                event_ends_at,
                status,
                created_at,
                updated_at,
                published_at,
                archived_at
            `,
            [
              tenantId,
              actorEmployeeId,
              normalizedTitle,
              postType,
              normalizedContent,
              serializedContentJson,
              editorFormat,
              editorSchemaVersion,
              normalizedStartsAt,
              normalizedEndsAt,
              status,
            ],
          );
  
          const createdPost = postResult.rows[0];
  
          if (feedImageIds.length > 0) {
            const ownedImages = await client.query<{ id: string }>(
              `SELECT id
               FROM company_feed_images
               WHERE tenant_id = $1
                 AND uploaded_by = $2
                 AND status = 'pending'
                 AND post_id IS NULL
                 AND id = ANY($3::uuid[])
               FOR UPDATE`,
              [tenantId, actorEmployeeId, feedImageIds],
            );
            if (ownedImages.rowCount !== feedImageIds.length) {
              throw Object.assign(new Error('One or more feed images are unavailable.'), { statusCode: 400 });
            }
            await client.query(
              `UPDATE company_feed_images
               SET status = 'attached', post_id = $4, attached_at = NOW()
               WHERE tenant_id = $1
                 AND uploaded_by = $2
                 AND id = ANY($3::uuid[])`,
              [tenantId, actorEmployeeId, feedImageIds, createdPost.id],
            );
          }
  
          for (const rule of normalizedVisibility.visibility) {
            await client.query(
              `
                INSERT INTO company_feed_visibility (
                  tenant_id,
                  post_id,
                  visibility_type,
                  role,
                  location_id
                )
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT DO NOTHING
              `,
              [
                tenantId,
                createdPost.id,
                rule.type,
                rule.type === 'role' ? rule.role : null,
                rule.type === 'location' ? rule.locationId : null,
              ],
            );
          }
  
          await client.query(
            `
              INSERT INTO audit_logs (
                tenant_id,
                actor_employee_id,
                action,
                entity_type,
                entity_id,
                metadata
              )
              VALUES ($1, $2, $3, $4, $5, $6::jsonb)
            `,
            [
              tenantId,
              actorEmployeeId,
              'company_feed_post_created',
              'company_feed_post',
              createdPost.id,
              JSON.stringify({
                title: normalizedTitle,
                postType,
                status,
                visibility: normalizedVisibility.visibility,
              }),
            ],
          );
  
          if (activeDraftId && status === 'published') {
            await client.query(
              `UPDATE company_feed_drafts
               SET status = 'published', published_post_id = $4, published_at = NOW(), updated_at = NOW(), version = version + 1
               WHERE tenant_id = $1 AND author_employee_id = $2 AND id = $3 AND status = 'active'`,
              [tenantId, actorEmployeeId, activeDraftId, createdPost.id],
            );
            await client.query(
              `INSERT INTO audit_logs (tenant_id, actor_employee_id, action, entity_type, entity_id, metadata)
               VALUES ($1, $2, 'company_feed.draft.published', 'company_feed_draft', $3, $4::jsonb)`,
              [tenantId, actorEmployeeId, activeDraftId, JSON.stringify({ postId: createdPost.id })],
            );
          }
  
          return {
            ...createdPost,
            contentText: createdPost.content_text,
            contentJson: createdPost.content_json,
            visibility: normalizedVisibility.visibility,
          };
        });
  
        res.status(201).json({
          success: true,
          postId: post.id,
          post,
        });
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
  
        if (statusCode === 400 || statusCode === 409) {
          return res.status(statusCode).json({
            success: false,
            error: (error as Error).message,
          });
        }
  
        console.error('[Company Feed] Failed to create post:', error);
        res.status(500).json({ success: false, error: 'Unable to create company feed post' });
      }
    },
  );
  
  app.get(
    '/api/company-feed',
    demoAuth,
    requirePermission('feed.read'),
    async (req, res) => {
      const tenantId = req.authUser!.tenantId;
      const role = req.authUser!.role;
  
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ success: false, error: 'DATABASE_URL is required for company feed' });
      }
  
      try {
        const posts = await withTenant(tenantId, async (client) => {
          const result = await client.query(
            `
              SELECT
                company_feed_posts.id,
                company_feed_posts.author_employee_id,
                author.full_name AS author_name,
                author.role AS author_role,
                author.profile_image_url AS author_avatar_url,
                company_feed_posts.title,
                company_feed_posts.post_type,
                company_feed_posts.content_text,
                company_feed_posts.content_json,
                company_feed_posts.editor_format,
                company_feed_posts.editor_schema_version,
                company_feed_posts.event_starts_at,
                company_feed_posts.event_ends_at,
                company_feed_posts.status,
                company_feed_posts.created_at,
                company_feed_posts.updated_at,
                company_feed_posts.published_at,
                company_feed_posts.archived_at
              FROM company_feed_posts
              INNER JOIN employees author
                ON author.id = company_feed_posts.author_employee_id
               AND author.tenant_id = company_feed_posts.tenant_id
              WHERE company_feed_posts.tenant_id = $1
                AND company_feed_posts.status = 'published'
                AND (
                  EXISTS (
                    SELECT 1
                    FROM company_feed_visibility
                    WHERE company_feed_visibility.tenant_id = company_feed_posts.tenant_id
                      AND company_feed_visibility.post_id = company_feed_posts.id
                      AND company_feed_visibility.visibility_type = 'all'
                  )
                  OR EXISTS (
                    SELECT 1
                    FROM company_feed_visibility
                    WHERE company_feed_visibility.tenant_id = company_feed_posts.tenant_id
                      AND company_feed_visibility.post_id = company_feed_posts.id
                      AND company_feed_visibility.visibility_type = 'role'
                      AND company_feed_visibility.role = $2
                  )
                )
              ORDER BY company_feed_posts.published_at DESC, company_feed_posts.created_at DESC
              LIMIT 50
            `,
            [tenantId, role],
          );
  
          return result.rows.map((post) => ({
            ...post,
            contentText: post.content_text,
            contentJson: post.content_json,
          }));
        });
  
        res.json({ success: true, posts });
      } catch (error) {
        console.error('[Company Feed] Failed to load visible posts:', error);
        res.status(500).json({ success: false, error: 'Unable to load company feed' });
      }
    },
  );
  
  app.get(
    '/api/company-feed/admin',
    demoAuth,
    requirePermission('feed.publish'),
    async (req, res) => {
      const tenantId = req.authUser!.tenantId;
  
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ success: false, error: 'DATABASE_URL is required for company feed' });
      }
  
      try {
        const posts = await withTenant(tenantId, async (client) => {
          const result = await client.query(
            `
              SELECT
                company_feed_posts.id,
                company_feed_posts.author_employee_id,
                author.full_name AS author_name,
                author.email AS author_email,
                author.role AS author_role,
                author.profile_image_url AS author_avatar_url,
                company_feed_posts.title,
                company_feed_posts.post_type,
                company_feed_posts.content_text,
                company_feed_posts.content_json,
                company_feed_posts.editor_format,
                company_feed_posts.editor_schema_version,
                company_feed_posts.event_starts_at,
                company_feed_posts.event_ends_at,
                company_feed_posts.status,
                company_feed_posts.created_at,
                company_feed_posts.updated_at,
                company_feed_posts.published_at,
                company_feed_posts.archived_at,
                COALESCE(
                  json_agg(
                    json_build_object(
                      'type', company_feed_visibility.visibility_type,
                      'role', company_feed_visibility.role,
                      'locationId', company_feed_visibility.location_id
                    )
                  ) FILTER (WHERE company_feed_visibility.id IS NOT NULL),
                  '[]'::json
                ) AS visibility
              FROM company_feed_posts
              INNER JOIN employees author
                ON author.id = company_feed_posts.author_employee_id
               AND author.tenant_id = company_feed_posts.tenant_id
              LEFT JOIN company_feed_visibility
                ON company_feed_visibility.post_id = company_feed_posts.id
               AND company_feed_visibility.tenant_id = company_feed_posts.tenant_id
              WHERE company_feed_posts.tenant_id = $1
              GROUP BY company_feed_posts.id, author.full_name, author.email, author.role, author.profile_image_url
              ORDER BY company_feed_posts.created_at DESC
              LIMIT 100
            `,
            [tenantId],
          );
  
          return result.rows.map((post) => ({
            ...post,
            contentText: post.content_text,
            contentJson: post.content_json,
          }));
        });
  
        res.json({ success: true, posts });
      } catch (error) {
        console.error('[Company Feed] Failed to load admin posts:', error);
        res.status(500).json({ success: false, error: 'Unable to load company feed posts' });
      }
    },
  );
  
  app.patch(
    '/api/company-feed/posts/:id/status',
    demoAuth,
    requirePermission('feed.publish'),
    async (req, res) => {
      const { id } = req.params;
      const { status } = req.body as UpdateFeedPostStatusBody;
      const tenantId = req.authUser!.tenantId;
      const actorEmployeeId = req.authUser!.employeeId;
  
      if (!isFeedPostStatus(status)) {
        return res.status(400).json({
          success: false,
          error: 'status must be draft, published, or archived.',
        });
      }
  
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ success: false, error: 'DATABASE_URL is required for company feed' });
      }
  
      try {
        const post = await withTenant(tenantId, async (client) => {
          const existingResult = await client.query<{ status: FeedPostStatus; title: string }>(
            `
              SELECT status, title
              FROM company_feed_posts
              WHERE tenant_id = $1
                AND id = $2
              LIMIT 1
              FOR UPDATE
            `,
            [tenantId, id],
          );
  
          if (existingResult.rowCount === 0) {
            throw Object.assign(new Error('Company feed post not found.'), { statusCode: 404 });
          }
  
          const previousStatus = existingResult.rows[0].status;
          const updateResult = await client.query(
            `
              UPDATE company_feed_posts
              SET
                status = $3,
                published_at = CASE
                  WHEN $3 = 'published' THEN COALESCE(published_at, NOW())
                  ELSE published_at
                END,
                archived_at = CASE
                  WHEN $3 = 'archived' THEN NOW()
                  WHEN $3 IN ('draft', 'published') THEN NULL
                  ELSE archived_at
                END,
                updated_at = NOW()
              WHERE tenant_id = $1
                AND id = $2
              RETURNING
                id,
                author_employee_id,
                title,
                post_type,
                content_text,
                content_json,
                event_starts_at,
                event_ends_at,
                status,
                created_at,
                updated_at,
                published_at,
                archived_at
            `,
            [tenantId, id, status],
          );
  
          const updatedPost = updateResult.rows[0];
  
          await client.query(
            `
              INSERT INTO audit_logs (
                tenant_id,
                actor_employee_id,
                action,
                entity_type,
                entity_id,
                metadata
              )
              VALUES ($1, $2, $3, $4, $5, $6::jsonb)
            `,
            [
              tenantId,
              actorEmployeeId,
              'company_feed_post_status_updated',
              'company_feed_post',
              id,
              JSON.stringify({
                previousStatus,
                newStatus: status,
                title: updatedPost.title,
              }),
            ],
          );
  
          return updatedPost;
        });
  
        res.json({ success: true, post });
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
  
        if (statusCode === 404) {
          return res.status(404).json({
            success: false,
            error: (error as Error).message,
          });
        }
  
        console.error('[Company Feed] Failed to update post status:', error);
        res.status(500).json({ success: false, error: 'Unable to update company feed post status' });
      }
    },
  );
}
