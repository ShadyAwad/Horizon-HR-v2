import type express from 'express';
import { hasDatabaseConfig, withTenant } from '../../lib/hr-background';
import { recordAuditEvent } from '../audit/audit-events';

type EmployeeRole = 'employee' | 'manager' | 'hr_admin';
type CompensationPayType = 'monthly' | 'hourly' | 'weekly' | 'annual';

type UpsertCompensationProfileBody = {
  payType?: CompensationPayType;
  baseAmount?: number | string;
  currency?: string;
  effectiveFrom?: string;
};

type CompensationRouteDependencies = {
  standardAuth: express.RequestHandler;
  requirePermission: (permission: string) => express.RequestHandler;
  requireRole: (roles: EmployeeRole[]) => express.RequestHandler;
};

const compensationPayTypes: CompensationPayType[] = ['monthly', 'hourly', 'weekly', 'annual'];

function isCompensationPayType(value: unknown): value is CompensationPayType {
  return typeof value === 'string' && compensationPayTypes.includes(value as CompensationPayType);
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string | undefined) {
  return Boolean(value && uuidPattern.test(value));
}

function isValidDateInput(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function toWorkDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function registerCompensationRoutes(
  app: express.Express,
  { standardAuth: demoAuth, requirePermission, requireRole }: CompensationRouteDependencies,
) {
  app.get(
    '/api/compensation-profiles',
    demoAuth,
    requirePermission('compensation.manage'),
    async (req, res) => {
      const tenantId = req.authUser!.tenantId;
  
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ success: false, error: 'DATABASE_URL is required for compensation profiles' });
      }
  
      try {
        const profiles = await withTenant(tenantId, async (client) => {
          const result = await client.query(
            `
              SELECT
                employee_compensation_profiles.id,
                employees.id AS employee_id,
                employees.full_name,
                employees.email,
                employees.role,
                employee_compensation_profiles.pay_type,
                employee_compensation_profiles.base_amount,
                employee_compensation_profiles.currency,
                employee_compensation_profiles.effective_from,
                employee_compensation_profiles.effective_to,
                employee_compensation_profiles.is_active,
                employee_compensation_profiles.created_by,
                employee_compensation_profiles.updated_by,
                employee_compensation_profiles.created_at,
                employee_compensation_profiles.updated_at
              FROM employees
              LEFT JOIN LATERAL (
                SELECT *
                FROM employee_compensation_profiles
                WHERE employee_compensation_profiles.tenant_id = employees.tenant_id
                  AND employee_compensation_profiles.employee_id = employees.id
                  AND employee_compensation_profiles.is_active = true
                ORDER BY employee_compensation_profiles.effective_from DESC, employee_compensation_profiles.created_at DESC
                LIMIT 1
              ) employee_compensation_profiles ON true
              WHERE employees.tenant_id = $1
              ORDER BY employees.full_name ASC, employees.email ASC
              LIMIT 200
            `,
            [tenantId],
          );
  
          return result.rows;
        });
  
        res.json({ success: true, profiles });
      } catch (error) {
        console.error('[Compensation] Failed to load profiles:', error);
        res.status(500).json({ success: false, error: 'Unable to load compensation profiles' });
      }
    },
  );
  
  app.get(
    '/api/compensation-profiles/me',
    demoAuth,
    requireRole(['employee', 'manager', 'hr_admin']),
    async (req, res) => {
      const tenantId = req.authUser!.tenantId;
      const employeeId = req.authUser!.employeeId;
  
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ success: false, error: 'DATABASE_URL is required for compensation profiles' });
      }
  
      try {
        const profile = await withTenant(tenantId, async (client) => {
          const result = await client.query(
            `
              SELECT
                employee_compensation_profiles.id,
                employee_compensation_profiles.employee_id,
                employee_compensation_profiles.pay_type,
                employee_compensation_profiles.base_amount,
                employee_compensation_profiles.currency,
                employee_compensation_profiles.effective_from,
                employee_compensation_profiles.effective_to,
                employee_compensation_profiles.is_active,
                employee_compensation_profiles.created_at,
                employee_compensation_profiles.updated_at
              FROM employee_compensation_profiles
              WHERE tenant_id = $1
                AND employee_id = $2
                AND is_active = true
              ORDER BY effective_from DESC, created_at DESC
              LIMIT 1
            `,
            [tenantId, employeeId],
          );
  
          return result.rows[0] || null;
        });
  
        res.json({ success: true, profile });
      } catch (error) {
        console.error('[Compensation] Failed to load employee profile:', error);
        res.status(500).json({ success: false, error: 'Unable to load compensation profile' });
      }
    },
  );
  
  app.put(
    '/api/compensation-profiles/:employeeId',
    demoAuth,
    requirePermission('compensation.manage'),
    async (req, res) => {
      const tenantId = req.authUser!.tenantId;
      const actorEmployeeId = req.authUser!.employeeId;
      const targetEmployeeId = req.params.employeeId;
      const { payType = 'monthly', baseAmount, currency, effectiveFrom } = req.body as UpsertCompensationProfileBody;
  
      const normalizedBaseAmount = Number(baseAmount);
      const normalizedCurrency = currency?.trim().toUpperCase();
      const normalizedEffectiveFrom = effectiveFrom || toWorkDate(new Date());
  
      if (!isUuid(targetEmployeeId)) {
        return res.status(400).json({ success: false, error: 'employeeId must be a valid UUID.' });
      }
  
      if (!isCompensationPayType(payType)) {
        return res.status(400).json({ success: false, error: 'payType must be monthly, hourly, weekly, or annual.' });
      }
  
      if (!Number.isFinite(normalizedBaseAmount) || normalizedBaseAmount < 0) {
        return res.status(400).json({ success: false, error: 'baseAmount must be a non-negative number.' });
      }
  
      if (normalizedCurrency && !/^[A-Z]{3}$/.test(normalizedCurrency)) {
        return res.status(400).json({ success: false, error: 'currency must be a 3-letter code.' });
      }
  
      if (!isValidDateInput(normalizedEffectiveFrom)) {
        return res.status(400).json({ success: false, error: 'effectiveFrom must be a valid YYYY-MM-DD date.' });
      }
  
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ success: false, error: 'DATABASE_URL is required for compensation profiles' });
      }
  
      try {
        const profile = await withTenant(tenantId, async (client) => {
          const employeeResult = await client.query<{ id: string; default_currency: string | null }>(
            `
              SELECT employees.id, tenants.default_currency
              FROM employees
              INNER JOIN tenants
                ON tenants.id = employees.tenant_id
              WHERE employees.tenant_id = $1
                AND employees.id = $2
              LIMIT 1
            `,
            [tenantId, targetEmployeeId],
          );
  
          const employee = employeeResult.rows[0];
          if (!employee) {
            return null;
          }
  
          const profileCurrency = normalizedCurrency || employee.default_currency || 'USD';
  
          await client.query(
            `
              UPDATE employee_compensation_profiles
              SET
                is_active = false,
                effective_to = CASE
                  WHEN effective_from <= (($3::date - INTERVAL '1 day')::date)
                    THEN (($3::date - INTERVAL '1 day')::date)
                  ELSE effective_from
                END,
                updated_by = $4,
                updated_at = NOW()
              WHERE tenant_id = $1
                AND employee_id = $2
                AND is_active = true
            `,
            [tenantId, targetEmployeeId, normalizedEffectiveFrom, actorEmployeeId],
          );
  
          const insertResult = await client.query(
            `
              INSERT INTO employee_compensation_profiles (
                tenant_id,
                employee_id,
                pay_type,
                base_amount,
                currency,
                effective_from,
                is_active,
                created_by,
                updated_by
              )
              VALUES (
                $1,
                $2,
                $3::varchar,
                $4::numeric,
                $5::varchar,
                $6::date,
                true,
                $7,
                $7
              )
              RETURNING
                id,
                employee_id,
                pay_type,
                base_amount,
                currency,
                effective_from,
                effective_to,
                is_active,
                created_at,
                updated_at
            `,
            [
              tenantId,
              targetEmployeeId,
              payType,
              normalizedBaseAmount,
              profileCurrency,
              normalizedEffectiveFrom,
              actorEmployeeId,
            ],
          );
  
          const insertedProfile = insertResult.rows[0];
  
          await recordAuditEvent(client, {
            tenantId,
            actorId: actorEmployeeId,
            action: 'employee.salary.updated',
            targetType: 'employee',
            targetId: targetEmployeeId,
            metadata: {
              payType,
              currency: profileCurrency,
              effectiveFrom: normalizedEffectiveFrom,
            },
          });
  
          return insertedProfile;
        });
  
        if (!profile) {
          return res.status(404).json({ success: false, error: 'Employee not found for this tenant.' });
        }
  
        res.json({ success: true, profile });
      } catch (error) {
        if ((error as { code?: string }).code === '23505') {
          return res.status(409).json({ success: false, error: 'An active compensation profile already exists for this employee.' });
        }
  
        console.error('[Compensation] Failed to save profile:', error);
        res.status(500).json({ success: false, error: 'Unable to save compensation profile' });
      }
    },
  );
}
