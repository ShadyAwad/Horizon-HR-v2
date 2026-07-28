import type express from 'express';
import type { PoolClient } from 'pg';
import { withTenant } from '../../lib/hr-background';
import { recordAuditEvent } from '../audit/audit-events';
import { hasCompanyPermission } from '../organisation/scoped-permissions';

type Middleware = express.RequestHandler;
type Dependencies = { standardAuth: Middleware; mutationGuard: Middleware; rateLimiter: Middleware };
type LocationBody = { name?: unknown; code?: unknown; address?: unknown; latitude?: unknown; longitude?: unknown; radius?: unknown; locationType?: unknown; isPrimary?: unknown };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{3,4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{3,12}$/i;
const LOCATION_TYPES = new Set(['headquarters', 'branch', 'warehouse', 'remote_site', 'other']);
const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
const uuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
const cleanText = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : '';

async function requireLocationPermission(client: PoolClient, req: express.Request, key: 'locations.view' | 'locations.manage' | 'geofences.manage') {
  const user = req.authUser!;
  const result = await hasCompanyPermission(client, user.tenantId, user.employeeId, key);
  if (!result.allowed) throw fail(403, 'You do not have permission to manage company locations.');
}

function normalizeLocation(body: LocationBody, fallback?: { name: string; code: string | null; address: string | null; latitude: string; longitude: string; radius_meters: number; location_type: string; is_primary: boolean }) {
  const name = body.name === undefined ? fallback?.name || '' : cleanText(body.name, 120);
  const codeValue = body.code === undefined ? fallback?.code || '' : cleanText(body.code, 60).toUpperCase();
  const address = body.address === undefined ? fallback?.address || null : cleanText(body.address, 300) || null;
  const latitude = Number(body.latitude === undefined ? fallback?.latitude : body.latitude);
  const longitude = Number(body.longitude === undefined ? fallback?.longitude : body.longitude);
  const radius = Number(body.radius === undefined ? fallback?.radius_meters : body.radius);
  const locationType = body.locationType === undefined ? fallback?.location_type || 'branch' : body.locationType;
  const isPrimary = body.isPrimary === undefined ? fallback?.is_primary || false : body.isPrimary === true;
  if (!name) throw fail(400, 'Location name is required.');
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw fail(400, 'Latitude must be between -90 and 90.');
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw fail(400, 'Longitude must be between -180 and 180.');
  if (!Number.isFinite(radius) || radius < 25 || radius > 5000) throw fail(400, 'Radius must be between 25 and 5000 metres.');
  if (typeof locationType !== 'string' || !LOCATION_TYPES.has(locationType)) throw fail(400, 'Location type is invalid.');
  return { name, code: codeValue || null, address, latitude, longitude, radius: Math.round(radius), locationType, isPrimary };
}

async function getUsage(client: PoolClient, tenantId: string, locationId: string) {
  const usage = await client.query(`SELECT
    (SELECT count(*)::int FROM organisation_teams WHERE tenant_id=$1 AND location_id=$2 AND is_active) AS "activeTeams",
    0::int AS "activeEmployees",
    -- Roster shifts currently have no location foreign key. Do not infer one
    -- through an employee or team, which could rewrite historical meaning.
    0::int AS "futureShifts",
    0::int AS "activeShiftSwaps"`, [tenantId, locationId]);
  return usage.rows[0] as { activeTeams: number; activeEmployees: number; futureShifts: number; activeShiftSwaps: number };
}

function locationSelect() {
  return `location.id,location.name,location.code,location.address,location.location_type AS "locationType",location.latitude::float8 AS latitude,location.longitude::float8 AS longitude,location.radius_meters AS radius,location.is_primary AS "isPrimary",location.is_active AS "isActive",location.archived_at AS "archivedAt",location.created_at AS "createdAt",location.updated_at AS "updatedAt"`;
}

export function registerLocationRoutes(app: express.Express, { standardAuth, mutationGuard, rateLimiter }: Dependencies) {
  app.get('/api/hr/locations', standardAuth, async (req, res) => {
    try {
      const user = req.authUser!; const page = Math.max(1, Number(req.query.page) || 1); const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
      const search = cleanText(req.query.search, 120) || null; const status = req.query.status === 'archived' ? 'archived' : 'active';
      const result = await withTenant(user.tenantId, async client => {
        await requireLocationPermission(client, req, 'locations.view');
        const where = `location.tenant_id=$1 AND ${status === 'active' ? 'location.is_active' : 'NOT location.is_active'} AND ($2::text IS NULL OR location.name ILIKE '%'||$2||'%' OR COALESCE(location.code,'') ILIKE '%'||$2||'%')`;
        const rows = (await client.query(`SELECT ${locationSelect()},COUNT(DISTINCT team.id) FILTER(WHERE team.is_active)::int AS "teamCount",0::int AS "employeeCount",0::int AS "futureShiftCount" FROM company_locations location LEFT JOIN organisation_teams team ON team.tenant_id=location.tenant_id AND team.location_id=location.id WHERE ${where} GROUP BY location.id ORDER BY location.is_primary DESC,location.name LIMIT $3 OFFSET $4`, [user.tenantId, search, pageSize, (page - 1) * pageSize])).rows;
        const total = (await client.query(`SELECT count(*)::int AS count FROM company_locations location WHERE ${where}`, [user.tenantId, search])).rows[0].count;
        const summary = (await client.query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE is_active)::int AS active,count(*) FILTER(WHERE NOT is_active)::int AS archived FROM company_locations WHERE tenant_id=$1`, [user.tenantId])).rows[0];
        return { locations: rows, total, page, pageSize, summary };
      });
      res.json({ success: true, ...result });
    } catch (error) { const typed = error as { statusCode?: number; message?: string }; res.status(typed.statusCode || 500).json({ success: false, error: typed.statusCode ? typed.message : 'Unable to load locations.' }); }
  });

  app.get('/api/hr/locations/:locationId', standardAuth, async (req, res) => {
    try { const user = req.authUser!; if (!uuid(req.params.locationId)) throw fail(404, 'Location not found.'); const location = await withTenant(user.tenantId, async client => { await requireLocationPermission(client, req, 'locations.view'); return (await client.query(`SELECT ${locationSelect()} FROM company_locations location WHERE location.tenant_id=$1 AND location.id=$2`, [user.tenantId, req.params.locationId])).rows[0]; }); if (!location) throw fail(404, 'Location not found.'); res.json({ success: true, location }); } catch (error) { const typed = error as { statusCode?: number; message?: string }; res.status(typed.statusCode || 500).json({ success: false, error: typed.statusCode ? typed.message : 'Unable to load location.' }); }
  });

  const mutate = (method: 'create' | 'update') => async (req: express.Request, res: express.Response) => {
    try {
      const user = req.authUser!; const locationId = req.params.locationId; if (method === 'update' && !uuid(locationId)) throw fail(404, 'Location not found.');
      const location = await withTenant(user.tenantId, async client => {
        await requireLocationPermission(client, req, 'locations.manage'); await requireLocationPermission(client, req, 'geofences.manage');
        const existing = method === 'update' ? (await client.query(`SELECT name,code,address,latitude,longitude,radius_meters,location_type,is_primary FROM company_locations WHERE tenant_id=$1 AND id=$2 AND is_active FOR UPDATE`, [user.tenantId, locationId])).rows[0] : undefined;
        if (method === 'update' && !existing) throw fail(404, 'Location not found.'); const value = normalizeLocation(req.body || {}, existing);
        if (value.isPrimary) await client.query(`UPDATE company_locations SET is_primary=false,updated_at=NOW() WHERE tenant_id=$1 AND id<>COALESCE($2::uuid,'00000000-0000-0000-0000-000000000000')`, [user.tenantId, method === 'update' ? locationId : null]);
        const sql = method === 'create'
          ? `INSERT INTO company_locations(tenant_id,name,code,address,location_type,latitude,longitude,radius_meters,boundary,is_primary,is_active,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,ST_Buffer(ST_SetSRID(ST_MakePoint($7,$6),4326)::geography,$8)::geometry,$9,true,$10) RETURNING ${locationSelect().replaceAll('location.', '')}`
          : `UPDATE company_locations location SET name=$3,code=$4,address=$5,location_type=$6,latitude=$7,longitude=$8,radius_meters=$9,boundary=ST_Buffer(ST_SetSRID(ST_MakePoint($8,$7),4326)::geography,$9)::geometry,is_primary=$10,updated_at=NOW() WHERE location.tenant_id=$1 AND location.id=$2 RETURNING ${locationSelect().replaceAll('location.', '')}`;
        const values = method === 'create' ? [user.tenantId, value.name, value.code, value.address, value.locationType, value.latitude, value.longitude, value.radius, value.isPrimary, user.employeeId] : [user.tenantId, locationId, value.name, value.code, value.address, value.locationType, value.latitude, value.longitude, value.radius, value.isPrimary];
        const row = (await client.query(sql, values)).rows[0];
        await recordAuditEvent(client, { tenantId: user.tenantId, actorId: user.employeeId, action: method === 'create' ? 'location.created' : 'location.updated', targetType: 'company_location', targetId: row.id, metadata: { locationId: row.id, geofenceType: 'circle', active: true } });
        return row;
      });
      res.status(method === 'create' ? 201 : 200).json({ success: true, location });
    } catch (error) { const typed = error as { statusCode?: number; code?: string; message?: string }; const duplicate = typed.code === '23505'; res.status(typed.statusCode || (duplicate ? 409 : 500)).json({ success: false, error: duplicate ? 'An active location already uses this name or code.' : typed.statusCode ? typed.message : 'Unable to save location.' }); }
  };
  app.post('/api/hr/locations', rateLimiter, standardAuth, mutationGuard, mutate('create'));
  app.patch('/api/hr/locations/:locationId', rateLimiter, standardAuth, mutationGuard, mutate('update'));

  app.get('/api/hr/locations/:locationId/usage', standardAuth, async (req, res) => {
    try { const user = req.authUser!; if (!uuid(req.params.locationId)) throw fail(404, 'Location not found.'); const usage = await withTenant(user.tenantId, async client => { await requireLocationPermission(client, req, 'locations.view'); const exists = (await client.query(`SELECT 1 FROM company_locations WHERE tenant_id=$1 AND id=$2`, [user.tenantId, req.params.locationId])).rows[0]; if (!exists) throw fail(404, 'Location not found.'); return getUsage(client, user.tenantId, req.params.locationId); }); res.json({ success: true, usage }); } catch (error) { const typed = error as { statusCode?: number; message?: string }; res.status(typed.statusCode || 500).json({ success: false, error: typed.statusCode ? typed.message : 'Unable to load location usage.' }); }
  });

  for (const action of ['archive', 'restore'] as const) app.post(`/api/hr/locations/:locationId/${action}`, rateLimiter, standardAuth, mutationGuard, async (req, res) => {
    try { const user = req.authUser!; if (!uuid(req.params.locationId)) throw fail(404, 'Location not found.'); const location = await withTenant(user.tenantId, async client => { await requireLocationPermission(client, req, 'locations.manage'); const existing = (await client.query(`SELECT id,name,code,is_active FROM company_locations WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [user.tenantId, req.params.locationId])).rows[0]; if (!existing) throw fail(404, 'Location not found.'); const usage = await getUsage(client, user.tenantId, existing.id); if (action === 'archive' && (usage.activeTeams || usage.activeEmployees || usage.futureShifts || usage.activeShiftSwaps)) throw fail(409, 'Location is still in active use. Reassign teams and resolve future work before archiving.'); if (action === 'restore' && existing.is_active) return { ...existing, usage }; const row = (await client.query(`UPDATE company_locations SET is_active=$3,archived_at=CASE WHEN $3 THEN NULL ELSE NOW() END,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING ${locationSelect().replaceAll('location.', '')}`, [user.tenantId, existing.id, action === 'restore'])).rows[0]; await recordAuditEvent(client, { tenantId: user.tenantId, actorId: user.employeeId, action: action === 'archive' ? 'location.archived' : 'location.restored', targetType: 'company_location', targetId: existing.id, metadata: { locationId: existing.id, active: action === 'restore', usageCounts: usage } }); return { ...row, usage }; }); res.json({ success: true, location }); } catch (error) { const typed = error as { statusCode?: number; message?: string }; res.status(typed.statusCode || 500).json({ success: false, error: typed.statusCode ? typed.message : `Unable to ${action} location.` }); }
  });
}
