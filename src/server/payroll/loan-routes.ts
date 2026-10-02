import { logServerError } from '../../lib/server-logging';
import type express from 'express';
import { hasDatabaseConfig, withTenant } from '../../lib/hr-background';

type LoanStatus = 'active' | 'paid' | 'cancelled';
type LoanRepaymentFrequency = 'monthly' | 'weekly' | 'one_time';

type CreateEmployeeLoanBody = {
  employeeId?: string;
  loanName?: string;
  principalAmount?: number | string;
  repaymentAmount?: number | string;
  currency?: string;
  repaymentFrequency?: LoanRepaymentFrequency;
  issuedAt?: string;
  dueDate?: string | null;
};

type UpdateEmployeeLoanStatusBody = {
  status?: LoanStatus;
};

type LoanRouteDependencies = {
  standardAuth: express.RequestHandler;
  requirePermission: (permission: string) => express.RequestHandler;
};

const loanStatuses: LoanStatus[] = ['active', 'paid', 'cancelled'];
const loanRepaymentFrequencies: LoanRepaymentFrequency[] = ['monthly', 'weekly', 'one_time'];

function isLoanStatus(value: unknown): value is LoanStatus {
  return typeof value === 'string' && loanStatuses.includes(value as LoanStatus);
}

function isLoanRepaymentFrequency(value: unknown): value is LoanRepaymentFrequency {
  return typeof value === 'string' && loanRepaymentFrequencies.includes(value as LoanRepaymentFrequency);
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

export function registerLoanRoutes(
  app: express.Express,
  { standardAuth: demoAuth, requirePermission }: LoanRouteDependencies,
) {
  app.get(
    '/api/employee-loans',
    demoAuth,
    requirePermission('loans.manage'),
    async (req, res) => {
      const tenantId = req.authUser!.tenantId;
  
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ success: false, error: 'DATABASE_URL is required for employee loans' });
      }
  
      try {
        const loans = await withTenant(tenantId, async (client) => {
          const result = await client.query(
            `
              SELECT
                employee_loans.id,
                employee_loans.employee_id,
                employees.full_name,
                employees.email,
                employee_loans.loan_name,
                employee_loans.principal_amount,
                employee_loans.outstanding_balance,
                employee_loans.currency,
                employee_loans.repayment_amount,
                employee_loans.repayment_frequency,
                employee_loans.status,
                employee_loans.issued_at,
                employee_loans.due_date,
                employee_loans.created_at,
                employee_loans.updated_at
              FROM employee_loans
              INNER JOIN employees
                ON employees.id = employee_loans.employee_id
               AND employees.tenant_id = employee_loans.tenant_id
              WHERE employee_loans.tenant_id = $1
              ORDER BY employee_loans.created_at DESC
              LIMIT 200
            `,
            [tenantId],
          );
  
          return result.rows;
        });
  
        res.json({ success: true, loans });
      } catch (error) {
        logServerError('[Loans] Failed to load tenant loans:', error);
        res.status(500).json({ success: false, error: 'Unable to load employee loans' });
      }
    },
  );
  
  app.get(
    '/api/employee-loans/me',
    demoAuth,
    requirePermission('loans.view_self'),
    async (req, res) => {
      const tenantId = req.authUser!.tenantId;
      const employeeId = req.authUser!.employeeId;
  
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ success: false, error: 'DATABASE_URL is required for employee loans' });
      }
  
      try {
        const loans = await withTenant(tenantId, async (client) => {
          const result = await client.query(
            `
              SELECT
                id,
                employee_id,
                loan_name,
                principal_amount,
                outstanding_balance,
                currency,
                repayment_amount,
                repayment_frequency,
                status,
                issued_at,
                due_date,
                created_at,
                updated_at
              FROM employee_loans
              WHERE tenant_id = $1
                AND employee_id = $2
              ORDER BY created_at DESC
              LIMIT 100
            `,
            [tenantId, employeeId],
          );
  
          return result.rows;
        });
  
        res.json({ success: true, loans });
      } catch (error) {
        logServerError('[Loans] Failed to load employee loans:', error);
        res.status(500).json({ success: false, error: 'Unable to load employee loans' });
      }
    },
  );
  
  app.post(
    '/api/employee-loans',
    demoAuth,
    requirePermission('loans.manage'),
    async (req, res) => {
      const tenantId = req.authUser!.tenantId;
      const actorEmployeeId = req.authUser!.employeeId;
      const {
        employeeId,
        loanName,
        principalAmount,
        repaymentAmount,
        currency,
        repaymentFrequency = 'monthly',
        issuedAt,
        dueDate,
      } = req.body as CreateEmployeeLoanBody;
  
      const normalizedPrincipalAmount = Number(principalAmount);
      const normalizedRepaymentAmount = Number(repaymentAmount);
      const normalizedCurrency = currency?.trim().toUpperCase();
      const normalizedIssuedAt = issuedAt || toWorkDate(new Date());
      const normalizedDueDate = dueDate || null;
      const normalizedLoanName = loanName?.trim() || 'Employee Loan';
  
      if (!isUuid(employeeId)) {
        return res.status(400).json({ success: false, error: 'employeeId must be a valid UUID.' });
      }
  
      if (!Number.isFinite(normalizedPrincipalAmount) || normalizedPrincipalAmount <= 0) {
        return res.status(400).json({ success: false, error: 'principalAmount must be greater than zero.' });
      }
  
      if (!Number.isFinite(normalizedRepaymentAmount) || normalizedRepaymentAmount < 0) {
        return res.status(400).json({ success: false, error: 'repaymentAmount must be a non-negative number.' });
      }
  
      if (!normalizedLoanName || normalizedLoanName.length > 160) {
        return res.status(400).json({ success: false, error: 'loanName must be between 1 and 160 characters.' });
      }
  
      if (normalizedCurrency && !/^[A-Z]{3}$/.test(normalizedCurrency)) {
        return res.status(400).json({ success: false, error: 'currency must be a 3-letter code.' });
      }
  
      if (!isLoanRepaymentFrequency(repaymentFrequency)) {
        return res.status(400).json({ success: false, error: 'repaymentFrequency must be monthly, weekly, or one_time.' });
      }
  
      if (!isValidDateInput(normalizedIssuedAt) || (normalizedDueDate !== null && !isValidDateInput(normalizedDueDate))) {
        return res.status(400).json({ success: false, error: 'issuedAt and dueDate must be valid YYYY-MM-DD dates.' });
      }
  
      if (normalizedDueDate !== null && normalizedDueDate < normalizedIssuedAt) {
        return res.status(400).json({ success: false, error: 'dueDate must not be before issuedAt.' });
      }
  
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ success: false, error: 'DATABASE_URL is required for employee loans' });
      }
  
      try {
        const loan = await withTenant(tenantId, async (client) => {
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
            [tenantId, employeeId],
          );
  
          const employee = employeeResult.rows[0];
          if (!employee) {
            return null;
          }
  
          const loanCurrency = normalizedCurrency || employee.default_currency || 'USD';
          const loanResult = await client.query(
            `
              INSERT INTO employee_loans (
                tenant_id,
                employee_id,
                loan_name,
                principal_amount,
                outstanding_balance,
                currency,
                repayment_amount,
                repayment_frequency,
                status,
                issued_at,
                due_date,
                created_by,
                updated_by
              )
              VALUES (
                $1,
                $2,
                $3::varchar,
                $4::numeric,
                $4::numeric,
                $5::varchar,
                $6::numeric,
                $7::varchar,
                'active',
                $8::date,
                $9::date,
                $10,
                $10
              )
              RETURNING
                id,
                employee_id,
                loan_name,
                principal_amount,
                outstanding_balance,
                currency,
                repayment_amount,
                repayment_frequency,
                status,
                issued_at,
                due_date,
                created_at,
                updated_at
            `,
            [
              tenantId,
              employeeId,
              normalizedLoanName,
              normalizedPrincipalAmount,
              loanCurrency,
              normalizedRepaymentAmount,
              repaymentFrequency,
              normalizedIssuedAt,
              normalizedDueDate,
              actorEmployeeId,
            ],
          );
  
          const createdLoan = loanResult.rows[0];
  
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
              'employee_loan_created',
              'employee_loan',
              createdLoan.id,
              JSON.stringify({
                employeeId,
                principalAmount: normalizedPrincipalAmount,
                repaymentAmount: normalizedRepaymentAmount,
                currency: loanCurrency,
              }),
            ],
          );
  
          return createdLoan;
        });
  
        if (!loan) {
          return res.status(404).json({ success: false, error: 'Employee not found for this tenant.' });
        }
  
        res.status(201).json({ success: true, loan });
      } catch (error) {
        logServerError('[Loans] Failed to create employee loan:', error);
        res.status(500).json({ success: false, error: 'Unable to create employee loan' });
      }
    },
  );
  
  app.patch(
    '/api/employee-loans/:id/status',
    demoAuth,
    requirePermission('loans.manage'),
    async (req, res) => {
      const tenantId = req.authUser!.tenantId;
      const actorEmployeeId = req.authUser!.employeeId;
      const { id } = req.params;
      const { status } = req.body as UpdateEmployeeLoanStatusBody;
  
      if (!isUuid(id)) {
        return res.status(400).json({ success: false, error: 'Employee loan id must be a valid UUID.' });
      }
  
      if (!isLoanStatus(status)) {
        return res.status(400).json({ success: false, error: 'status must be active, paid, or cancelled.' });
      }
  
      if (!hasDatabaseConfig()) {
        return res.status(503).json({ success: false, error: 'DATABASE_URL is required for employee loans' });
      }
  
      try {
        const loan = await withTenant(tenantId, async (client) => {
          const existingResult = await client.query<{
            id: string;
            employee_id: string;
            status: LoanStatus;
          }>(
            `
              SELECT id, employee_id, status
              FROM employee_loans
              WHERE tenant_id = $1
                AND id = $2
              LIMIT 1
            `,
            [tenantId, id],
          );
  
          const existingLoan = existingResult.rows[0];
          if (!existingLoan) {
            return null;
          }
  
          const updateResult = await client.query(
            `
              UPDATE employee_loans
              SET
                status = $3::varchar,
                outstanding_balance = CASE WHEN $3::varchar = 'paid' THEN 0 ELSE outstanding_balance END,
                updated_by = $4,
                updated_at = NOW()
              WHERE tenant_id = $1
                AND id = $2
              RETURNING
                id,
                employee_id,
                loan_name,
                principal_amount,
                outstanding_balance,
                currency,
                repayment_amount,
                repayment_frequency,
                status,
                issued_at,
                due_date,
                created_at,
                updated_at
            `,
            [tenantId, id, status, actorEmployeeId],
          );
  
          const updatedLoan = updateResult.rows[0];
  
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
              'employee_loan_status_updated',
              'employee_loan',
              id,
              JSON.stringify({
                employeeId: existingLoan.employee_id,
                previousStatus: existingLoan.status,
                newStatus: status,
              }),
            ],
          );
  
          return updatedLoan;
        });
  
        if (!loan) {
          return res.status(404).json({ success: false, error: 'Employee loan not found.' });
        }
  
        res.json({ success: true, loan });
      } catch (error) {
        logServerError('[Loans] Failed to update employee loan status:', error);
        res.status(500).json({ success: false, error: 'Unable to update employee loan status' });
      }
    },
  );
}
