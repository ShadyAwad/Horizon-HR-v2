import type express from 'express';
import { hasDatabaseConfig, withTenant } from '../../lib/hr-background';
import { recordAuditEvent } from '../audit/audit-events';
import { hasPermissionClaim } from '../auth/permission-claims';
import {
  normalizeCompanyLocations,
  type CompanyLocationInput,
  type CompanyLocationType,
} from './company-location-input';

type EmployeeRole = 'employee' | 'manager' | 'hr_admin';

type CompanyLocationRouteDependencies = {
  standardAuth: express.RequestHandler;
  requireRole: (roles: EmployeeRole[]) => express.RequestHandler;
};

export function registerCompanyLocationCompatibilityRoutes(
  app: express.Express,
  { standardAuth: demoAuth, requireRole }: CompanyLocationRouteDependencies,
) {
  app.get(
    '/api/company-locations',
    demoAuth,
    requireRole(['employee', 'manager', 'hr_admin']),
    async (req, res) => {
      const tenantId = req.authUser!.tenantId;
      const canViewPreciseLocations = req.authUser!.role !== 'employee'
        || hasPermissionClaim(req.authUser!, 'locations.read');
  
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ success: false, error: 'DATABASE_URL is required for company locations' });
      }
  
      try {
        const locations = await withTenant(tenantId, async (client) => {
          const result = await client.query(
            `
              SELECT
                id,
                name,
                location_type,
                address,
                ${canViewPreciseLocations ? 'latitude, longitude, radius_meters' : 'NULL::numeric AS latitude, NULL::numeric AS longitude, NULL::numeric AS radius_meters'},
                is_primary,
                is_active,
                created_at,
                updated_at
              FROM company_locations
              WHERE tenant_id = $1
                AND is_active = true
              ORDER BY is_primary DESC, created_at DESC
            `,
            [tenantId],
          );
  
          return result.rows;
        });
  
        res.json({ success: true, locations, coordinatesRestricted: !canViewPreciseLocations });
      } catch (error) {
        console.error('[Company Locations] Failed to load locations:', error);
        res.status(500).json({ success: false, error: 'Unable to load company locations' });
      }
    },
  );
  
  app.post(
    '/api/company-locations',
    demoAuth,
    requireRole(['hr_admin']),
    async (req, res) => {
      const tenantId = req.authUser!.tenantId;
      const actorEmployeeId = req.authUser!.employeeId;
      const normalized = normalizeCompanyLocations([req.body as CompanyLocationInput]);
  
      if (!normalized.ok) {
        return res.status(400).json({ success: false, error: normalized.error });
      }
  
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ success: false, error: 'DATABASE_URL is required for company locations' });
      }
  
      const location = normalized.locations[0];
  
      try {
        const createdLocation = await withTenant(tenantId, async (client) => {
          if (location.isPrimary) {
            await client.query(
              `
                UPDATE company_locations
                SET is_primary = false, updated_at = NOW()
                WHERE tenant_id = $1
              `,
              [tenantId],
            );
          }
  
          const result = await client.query(
            `
              INSERT INTO company_locations (
                tenant_id,
                name,
                location_type,
                address,
                latitude,
                longitude,
                radius_meters,
                boundary,
                is_primary,
                is_active
              )
              VALUES (
                $1,
                $2,
                $3,
                $4,
                $5,
                $6,
                $7,
                ST_Buffer(
                  ST_SetSRID(ST_MakePoint($6, $5), 4326)::geography,
                  $7
                )::geometry,
                $8,
                $9
              )
              RETURNING
                id,
                name,
                location_type,
                address,
                latitude,
                longitude,
                radius_meters,
                is_primary,
                is_active,
                created_at,
                updated_at
            `,
            [
              tenantId,
              location.name,
              location.locationType,
              location.address,
              location.latitude,
              location.longitude,
              location.radiusMeters,
              location.isPrimary,
              location.isActive,
            ],
          );
  
          const created = result.rows[0];
  
          await recordAuditEvent(client, {
            tenantId,
            actorId: actorEmployeeId,
            action: 'geofence.created',
            targetType: 'company_location',
            targetId: created.id,
            metadata: {
              name: location.name,
              locationType: location.locationType,
              radius: location.radiusMeters,
              isPrimary: location.isPrimary,
            },
          });
  
          return created;
        });
  
        res.status(201).json({ success: true, location: createdLocation });
      } catch (error) {
        console.error('[Company Locations] Failed to create location:', error);
        res.status(500).json({ success: false, error: 'Unable to create company location' });
      }
    },
  );
  
  app.patch(
    '/api/company-locations/:id',
    demoAuth,
    requireRole(['hr_admin']),
    async (req, res) => {
      const { id } = req.params;
      const tenantId = req.authUser!.tenantId;
      const actorEmployeeId = req.authUser!.employeeId;
  
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ success: false, error: 'DATABASE_URL is required for company locations' });
      }
  
      try {
        const updatedLocation = await withTenant(tenantId, async (client) => {
          const existingResult = await client.query<{
            name: string;
            location_type: CompanyLocationType;
            address: string | null;
            latitude: string;
            longitude: string;
            radius_meters: number;
            is_primary: boolean;
            is_active: boolean;
          }>(
            `
              SELECT name, location_type, address, latitude, longitude, radius_meters, is_primary, is_active
              FROM company_locations
              WHERE tenant_id = $1
                AND id = $2
              LIMIT 1
              FOR UPDATE
            `,
            [tenantId, id],
          );
  
          if (existingResult.rowCount === 0) {
            throw Object.assign(new Error('Company location not found.'), { statusCode: 404 });
          }
  
          const existing = existingResult.rows[0];
          const body = req.body as CompanyLocationInput;
          const normalized = normalizeCompanyLocations([
            {
              name: body.name ?? existing.name,
              locationType: body.locationType ?? existing.location_type,
              address: body.address ?? existing.address ?? undefined,
              lat: body.lat ?? existing.latitude,
              lng: body.lng ?? existing.longitude,
              radius: body.radius ?? existing.radius_meters,
              isPrimary: body.isPrimary ?? existing.is_primary,
              isActive: body.isActive ?? existing.is_active,
            },
          ]);
  
          if (!normalized.ok) {
            throw Object.assign(new Error(normalized.error), { statusCode: 400 });
          }
  
          const location = normalized.locations[0];
  
          if (location.isPrimary) {
            await client.query(
              `
                UPDATE company_locations
                SET is_primary = false, updated_at = NOW()
                WHERE tenant_id = $1
                  AND id <> $2
              `,
              [tenantId, id],
            );
          }
  
          const result = await client.query(
            `
              UPDATE company_locations
              SET
                name = $3,
                location_type = $4,
                address = $5,
                latitude = $6,
                longitude = $7,
                radius_meters = $8,
                boundary = ST_Buffer(
                  ST_SetSRID(ST_MakePoint($7, $6), 4326)::geography,
                  $8
                )::geometry,
                is_primary = $9,
                is_active = $10,
                updated_at = NOW()
              WHERE tenant_id = $1
                AND id = $2
              RETURNING
                id,
                name,
                location_type,
                address,
                latitude,
                longitude,
                radius_meters,
                is_primary,
                is_active,
                created_at,
                updated_at
            `,
            [
              tenantId,
              id,
              location.name,
              location.locationType,
              location.address,
              location.latitude,
              location.longitude,
              location.radiusMeters,
              location.isPrimary,
              location.isActive,
            ],
          );
  
          const updated = result.rows[0];
  
          await recordAuditEvent(client, {
            tenantId,
            actorId: actorEmployeeId,
            action: 'geofence.updated',
            targetType: 'company_location',
            targetId: id,
            metadata: {
              name: location.name,
              locationType: location.locationType,
              radius: location.radiusMeters,
              isPrimary: location.isPrimary,
              isActive: location.isActive,
            },
          });
  
          return updated;
        });
  
        res.json({ success: true, location: updatedLocation });
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
  
        if (statusCode === 400 || statusCode === 404) {
          return res.status(statusCode).json({
            success: false,
            error: (error as Error).message,
          });
        }
  
        console.error('[Company Locations] Failed to update location:', error);
        res.status(500).json({ success: false, error: 'Unable to update company location' });
      }
    },
  );
}
