import type express from 'express';
import { hasDatabaseConfig, withTenant } from '../../lib/hr-background';
import { recordAuditEvent } from '../audit/audit-events';

type PayrollRunBody = {
  payPeriodStart?: string;
  payPeriodEnd?: string;
  defaultBaseSalary?: number;
  bonuses?: number;
  deductions?: number;
};

type PayrollStatus = 'draft' | 'approved' | 'paid' | 'cancelled';
type CompensationPayType = 'monthly' | 'hourly' | 'weekly' | 'annual';

type UpdatePayrollStatusBody = {
  status?: PayrollStatus;
};

type PayrollRouteDependencies = {
  standardAuth: express.RequestHandler;
  requirePermission: (permission: string) => express.RequestHandler;
};

const payrollStatuses: PayrollStatus[] = ['draft', 'approved', 'paid', 'cancelled'];

function isPayrollStatus(value: unknown): value is PayrollStatus {
  return typeof value === 'string' && payrollStatuses.includes(value as PayrollStatus);
}

function isNonNegativeAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
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

export function registerPayrollRoutes(
  app: express.Express,
  { standardAuth: demoAuth, requirePermission }: PayrollRouteDependencies,
) {
  app.get(
    '/api/payroll/me',
    demoAuth,
    requirePermission('payroll.view_self'),
    async (req, res) => {
      const tenantId = req.authUser!.tenantId;
      const employeeId = req.authUser!.employeeId;
  
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ error: 'DATABASE_URL is required for payroll records' });
      }
  
      try {
        const payroll = await withTenant(tenantId, async (client) => {
          const result = await client.query(
            `
              SELECT
                id,
                employee_id,
                pay_period_start,
                pay_period_end,
                base_salary,
                bonuses,
                deductions,
                net_pay,
                currency,
                status,
                generated_at,
                approved_by,
                approved_at,
                paid_at,
                cancelled_at
              FROM payroll_records
              WHERE tenant_id = $1
                AND employee_id = $2
              ORDER BY pay_period_end DESC, pay_period_start DESC, generated_at DESC
              LIMIT 12
            `,
            [tenantId, employeeId],
          );
  
          return result.rows;
        });
  
        res.json({ success: true, payroll });
      } catch (error) {
        console.error('[Payroll] Failed to load employee payroll:', error);
        res.status(500).json({ error: 'Unable to load payroll records' });
      }
    },
  );
  
  app.get(
    '/api/payroll',
    demoAuth,
    requirePermission('payroll.view_all'),
    async (req, res) => {
      const tenantId = req.authUser!.tenantId;
  
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ error: 'DATABASE_URL is required for payroll records' });
      }
  
      try {
        const payroll = await withTenant(tenantId, async (client) => {
          const result = await client.query(
            `
              SELECT
                payroll_records.id,
                payroll_records.employee_id,
                employees.full_name,
                employees.email,
                payroll_records.pay_period_start,
                payroll_records.pay_period_end,
                payroll_records.base_salary,
                payroll_records.bonuses,
                payroll_records.deductions,
                payroll_records.net_pay,
                payroll_records.currency,
                payroll_records.status,
                payroll_records.generated_at,
                payroll_records.approved_by,
                payroll_records.approved_at,
                payroll_records.paid_at,
                payroll_records.cancelled_at
              FROM payroll_records
              INNER JOIN employees
                ON employees.id = payroll_records.employee_id
               AND employees.tenant_id = payroll_records.tenant_id
              WHERE payroll_records.tenant_id = $1
              ORDER BY payroll_records.generated_at DESC, payroll_records.pay_period_end DESC
              LIMIT 100
            `,
            [tenantId],
          );
  
          return result.rows;
        });
  
        res.json({ success: true, payroll });
      } catch (error) {
        console.error('[Payroll] Failed to load tenant payroll:', error);
        res.status(500).json({ error: 'Unable to load payroll records' });
      }
    },
  );
  
  app.patch(
    '/api/payroll/:id/status',
    demoAuth,
    (req, res, next) => {
      const { status } = req.body as UpdatePayrollStatusBody;
      const hasPermission = (permissionKey: string) => (
        req.authUser?.role === 'hr_admin' ||
        Boolean(req.authUser?.permissions?.includes(permissionKey))
      );
  
      if (status === 'paid' && !hasPermission('payroll.mark_paid')) {
        return res.status(403).json({ success: false, error: 'Permission payroll.mark_paid is required.' });
      }
  
      if ((status === 'approved' || status === 'cancelled') && !hasPermission('payroll.approve')) {
        return res.status(403).json({ success: false, error: 'Permission payroll.approve is required.' });
      }
  
      next();
    },
    async (req, res) => {
      const tenantId = req.authUser!.tenantId;
      const actorEmployeeId = req.authUser!.employeeId;
      const { id } = req.params;
      const { status } = req.body as UpdatePayrollStatusBody;
  
      if (!isUuid(id)) {
        return res.status(400).json({ success: false, error: 'Payroll record id must be a valid UUID.' });
      }
  
      if (!isPayrollStatus(status)) {
        return res.status(400).json({ success: false, error: 'status must be draft, approved, paid, or cancelled.' });
      }
  
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ success: false, error: 'DATABASE_URL is required for payroll records' });
      }
  
      try {
        const payrollRecord = await withTenant(tenantId, async (client) => {
          const existingResult = await client.query<{
            id: string;
            employee_id: string;
            pay_period_start: string;
            pay_period_end: string;
            status: PayrollStatus;
          }>(
            `
              SELECT id, employee_id, pay_period_start, pay_period_end, status
              FROM payroll_records
              WHERE tenant_id = $1
                AND id = $2
              LIMIT 1
              FOR UPDATE
            `,
            [tenantId, id],
          );
  
          const existingRecord = existingResult.rows[0];
          if (!existingRecord) {
            return null;
          }
  
          const allowedTransitions: Record<PayrollStatus, PayrollStatus[]> = {
            draft: ['approved', 'cancelled'],
            approved: ['paid', 'cancelled'],
            paid: [],
            cancelled: [],
          };
  
          if (existingRecord.status !== status && !allowedTransitions[existingRecord.status].includes(status)) {
            const error = new Error(`Cannot change payroll status from ${existingRecord.status} to ${status}.`);
            (error as { statusCode?: number }).statusCode = 400;
            throw error;
          }
  
          const updateResult = await client.query(
            `
              UPDATE payroll_records
              SET
                status = $3::varchar,
                approved_by = CASE WHEN $3::varchar = 'approved' THEN $4 ELSE approved_by END,
                approved_at = CASE WHEN $3::varchar = 'approved' THEN NOW() ELSE approved_at END,
                paid_at = CASE WHEN $3::varchar = 'paid' THEN NOW() ELSE paid_at END,
                cancelled_at = CASE WHEN $3::varchar = 'cancelled' THEN NOW() ELSE cancelled_at END,
                updated_at = NOW()
              WHERE tenant_id = $1
                AND id = $2
                AND status = $5::varchar
              RETURNING
                id,
                employee_id,
                pay_period_start,
                pay_period_end,
                base_salary,
                bonuses,
                deductions,
                net_pay,
                currency,
                status,
                generated_at,
                approved_by,
                approved_at,
                paid_at,
                cancelled_at
            `,
            [tenantId, id, status, actorEmployeeId, existingRecord.status],
          );
  
          if (updateResult.rowCount !== 1) {
            const error = new Error('Payroll record changed before this update could be applied.');
            (error as { statusCode?: number }).statusCode = 409;
            throw error;
          }
  
          const updatedRecord = updateResult.rows[0];
  
          const payrollAuditAction = status === 'approved'
            ? 'payroll.approved'
            : status === 'paid'
              ? 'payroll.paid'
              : 'payroll.cancelled';
          await recordAuditEvent(client, {
            tenantId,
            actorId: actorEmployeeId,
            action: payrollAuditAction,
            targetType: 'payroll_record',
            targetId: id,
            metadata: {
              previousStatus: existingRecord.status,
              newStatus: status,
              payPeriodStart: existingRecord.pay_period_start,
              payPeriodEnd: existingRecord.pay_period_end,
            },
          });
  
          await client.query(
            `
              INSERT INTO outbox_events (tenant_id, event_type, payload)
              VALUES ($1, $2::varchar, $3::jsonb)
            `,
            [
              tenantId,
              'payroll.status.updated',
              JSON.stringify({ payrollId: id, employeeId: existingRecord.employee_id, previousStatus: existingRecord.status, newStatus: status }),
            ],
          );
  
          return updatedRecord;
        });
  
        if (!payrollRecord) {
          return res.status(404).json({ success: false, error: 'Payroll record not found.' });
        }
  
        res.json({ success: true, payrollRecord });
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 400 || statusCode === 409) {
          return res.status(statusCode).json({ success: false, error: (error as Error).message });
        }
  
        console.error('[Payroll] Failed to update payroll status:', error);
        res.status(500).json({ success: false, error: 'Unable to update payroll status' });
      }
    },
  );
  
  app.post(
    '/api/payroll/run',
    demoAuth,
    requirePermission('payroll.run'),
    async (req, res) => {
      const {
        payPeriodStart,
        payPeriodEnd,
        defaultBaseSalary,
        bonuses = 0,
        deductions = 0,
      } = req.body as PayrollRunBody;
  
      const tenantId = req.authUser!.tenantId;
      const actorEmployeeId = req.authUser!.employeeId;
      const hasFallbackBaseSalary = defaultBaseSalary !== undefined && defaultBaseSalary !== null;
      const fallbackBaseSalary = hasFallbackBaseSalary ? Number(defaultBaseSalary) : null;
  
      if (
        !isValidDateInput(payPeriodStart) ||
        !isValidDateInput(payPeriodEnd)
      ) {
        return res.status(400).json({
          error: 'payPeriodStart and payPeriodEnd are required.',
        });
      }
  
      if (
        (hasFallbackBaseSalary && !isNonNegativeAmount(fallbackBaseSalary)) ||
        !isNonNegativeAmount(bonuses) ||
        !isNonNegativeAmount(deductions)
      ) {
        return res.status(400).json({
          error: 'Payroll amounts cannot be negative.',
        });
      }
  
      if (payPeriodEnd! <= payPeriodStart!) {
        return res.status(400).json({
          error: 'payPeriodEnd must be after payPeriodStart.',
        });
      }
  
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ error: 'DATABASE_URL is required to run payroll' });
      }
  
      try {
        const payrollRunResult = await withTenant(tenantId, async (client) => {
          await client.query('BEGIN');
  
          try {
            const tenantResult = await client.query<{ default_currency: string | null }>(
              `
                SELECT default_currency
                FROM tenants
                WHERE id = $1
                LIMIT 1
              `,
              [tenantId],
            );
            const tenantCurrency = tenantResult.rows[0]?.default_currency || 'USD';
            const employeeResult = await client.query<{
              id: string;
              email: string;
              base_amount: string | null;
              currency: string | null;
              pay_type: CompensationPayType | null;
              compensation_profile_id: string | null;
            }>(
              `
                SELECT
                  employees.id,
                  employees.email,
                  active_profiles.base_amount,
                  active_profiles.currency,
                  active_profiles.pay_type,
                  active_profiles.id AS compensation_profile_id
                FROM employees
                LEFT JOIN LATERAL (
                  SELECT id, base_amount, currency, pay_type
                  FROM employee_compensation_profiles
                  WHERE tenant_id = employees.tenant_id
                    AND employee_id = employees.id
                    AND is_active = true
                    AND effective_from <= $2::date
                    AND (effective_to IS NULL OR effective_to >= $2::date)
                  ORDER BY effective_from DESC, created_at DESC
                  LIMIT 1
                ) active_profiles ON true
                WHERE employees.tenant_id = $1
              `,
              [
                tenantId,
                payPeriodStart,
              ],
            );
  
            const skippedEmployees: Array<{ employeeId: string; email: string; reason: string }> = [];
            let generatedCount = 0;
            let fallbackUsed = false;
            let loanDeductionsApplied = 0;
  
            for (const employee of employeeResult.rows) {
              const profileBaseAmount = employee.base_amount === null ? null : Number(employee.base_amount);
              const usesProfile = profileBaseAmount !== null && Number.isFinite(profileBaseAmount);
              const baseSalary = usesProfile ? profileBaseAmount : fallbackBaseSalary;
  
              if (baseSalary === null || !Number.isFinite(baseSalary)) {
                skippedEmployees.push({
                  employeeId: employee.id,
                  email: employee.email,
                  reason: 'Missing active compensation profile and no fallback base salary was provided.',
                });
                continue;
              }
  
              const existingPayrollResult = await client.query<{ id: string; status: PayrollStatus }>(
                `
                  SELECT id, status
                  FROM payroll_records
                  WHERE tenant_id = $1
                    AND employee_id = $2
                    AND pay_period_start = $3::date
                    AND pay_period_end = $4::date
                  FOR UPDATE
                `,
                [tenantId, employee.id, payPeriodStart, payPeriodEnd],
              );
  
              const existingPayrollRecord = existingPayrollResult.rows[0];
              if (existingPayrollRecord && existingPayrollRecord.status !== 'draft') {
                throw Object.assign(
                  new Error('Payroll for this employee and period is finalized and cannot be re-run.'),
                  { statusCode: 409 },
                );
              }
              let employeeLoanDeduction = 0;
              const loanPayments: Array<{ loanId: string; amount: number }> = [];
  
              // Loan repayments are applied only when creating a new payroll record
              // for this employee/period. Re-running the same period updates payroll
              // values without double-deducting loan balances.
              if (!existingPayrollRecord) {
                const loanResult = await client.query<{
                  id: string;
                  outstanding_balance: string;
                  repayment_amount: string;
                }>(
                  `
                    SELECT id, outstanding_balance, repayment_amount
                    FROM employee_loans
                    WHERE tenant_id = $1
                      AND employee_id = $2
                      AND status = 'active'
                      AND outstanding_balance > 0
                    ORDER BY created_at ASC
                    FOR UPDATE
                  `,
                  [tenantId, employee.id],
                );
  
                for (const loan of loanResult.rows) {
                  const outstandingBalance = Number(loan.outstanding_balance);
                  const repaymentAmount = Number(loan.repayment_amount);
                  const paymentAmount = Math.min(
                    Number.isFinite(repaymentAmount) ? repaymentAmount : 0,
                    Number.isFinite(outstandingBalance) ? outstandingBalance : 0,
                  );
  
                  if (paymentAmount > 0) {
                    employeeLoanDeduction += paymentAmount;
                    loanPayments.push({ loanId: loan.id, amount: paymentAmount });
                  }
                }
              }
  
              const payrollCurrency = usesProfile ? (employee.currency || tenantCurrency) : tenantCurrency;
              const totalDeductions = deductions + employeeLoanDeduction;
              const netPay = baseSalary + bonuses - totalDeductions;
  
              if (!usesProfile) {
                fallbackUsed = true;
              }
  
              const payrollResult = await client.query<{ id: string }>(
                `
                  INSERT INTO payroll_records (
                    tenant_id,
                    employee_id,
                    pay_period_start,
                    pay_period_end,
                    base_salary,
                    bonuses,
                    deductions,
                    net_pay,
                    currency,
                    status,
                    generated_by,
                    generated_at,
                    updated_at
                  )
                  VALUES (
                    $1,
                    $2,
                    $3::date,
                    $4::date,
                    $5::numeric,
                    $6::numeric,
                    $7::numeric,
                    $8::numeric,
                    $9::varchar,
                    'draft',
                    $10::uuid,
                    NOW(),
                    NOW()
                  )
                  ON CONFLICT (tenant_id, employee_id, pay_period_start, pay_period_end)
                  DO UPDATE SET
                    base_salary = EXCLUDED.base_salary,
                    bonuses = EXCLUDED.bonuses,
                    deductions = EXCLUDED.deductions,
                    net_pay = EXCLUDED.net_pay,
                    currency = EXCLUDED.currency,
                    status = 'draft',
                    generated_by = EXCLUDED.generated_by,
                    generated_at = NOW(),
                    approved_by = NULL,
                    approved_at = NULL,
                    paid_at = NULL,
                    cancelled_at = NULL,
                    updated_at = NOW()
                  RETURNING id
                `,
                [
                  tenantId,
                  employee.id,
                  payPeriodStart,
                  payPeriodEnd,
                  baseSalary,
                  bonuses,
                  totalDeductions,
                  netPay,
                  payrollCurrency,
                  actorEmployeeId,
                ],
              );
  
              generatedCount += payrollResult.rowCount || 0;
              const payrollRecordId = payrollResult.rows[0]?.id;
  
              if (!existingPayrollRecord && payrollRecordId) {
                for (const payment of loanPayments) {
                  await client.query(
                    `
                      UPDATE employee_loans
                      SET
                        outstanding_balance = GREATEST(outstanding_balance - $3::numeric, 0),
                        status = CASE
                          WHEN GREATEST(outstanding_balance - $3::numeric, 0) = 0 THEN 'paid'
                          ELSE status
                        END,
                        updated_by = $4,
                        updated_at = NOW()
                      WHERE tenant_id = $1
                        AND id = $2
                    `,
                    [tenantId, payment.loanId, payment.amount, actorEmployeeId],
                  );
  
                  await client.query(
                    `
                      INSERT INTO employee_loan_payments (
                        tenant_id,
                        loan_id,
                        payroll_record_id,
                        amount
                      )
                      VALUES ($1, $2, $3, $4::numeric)
                    `,
                    [tenantId, payment.loanId, payrollRecordId, payment.amount],
                  );
  
                  loanDeductionsApplied += payment.amount;
                }
              }
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
                'payroll_run_generated',
                'payroll',
                actorEmployeeId,
                JSON.stringify({
                  payPeriodStart,
                  payPeriodEnd,
                  fallbackDefaultBaseSalary: hasFallbackBaseSalary ? fallbackBaseSalary : null,
                  bonuses,
                  deductions,
                  loanDeductionsApplied,
                  recordsGenerated: generatedCount,
                  skippedEmployeesCount: skippedEmployees.length,
                  fallbackUsed,
                  loanRepaymentsAppliedOnlyToNewRecords: true,
                }),
              ],
            );
  
            await client.query('COMMIT');
            return { recordsGenerated: generatedCount, skippedEmployees, loanDeductionsApplied };
          } catch (error) {
            await client.query('ROLLBACK');
            throw error;
          }
        });
  
        res.json({
          success: true,
          message: 'Payroll run generated successfully.',
          recordsGenerated: payrollRunResult.recordsGenerated,
          skippedEmployees: payrollRunResult.skippedEmployees,
          loanDeductionsApplied: payrollRunResult.loanDeductionsApplied,
        });
      } catch (error) {
        if ((error as { statusCode?: number }).statusCode === 409) {
          return res.status(409).json({ success: false, error: (error as Error).message });
        }
  
        console.error('[Payroll] Failed to run payroll:', error);
        res.status(500).json({ error: 'Unable to run payroll' });
      }
    },
  );
}
