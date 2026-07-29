import type express from 'express';
import type { PoolClient } from 'pg';
import { withTenant } from '../../lib/hr-background';
import { recordAuditEvent } from '../audit/audit-events';
import { resolveApprovalChain } from '../organisation/approval-chain';
import { resolveScopedPermission, type PermissionAuthority } from '../organisation/scoped-permissions';
import {
  ExpenseError,
  isExpenseCategory,
  isExpenseStatus,
  isSupportedCurrency,
  normalizeAmount,
  normalizeCategory,
  normalizeCurrency,
  normalizeDate,
  normalizeExpectedVersion,
  normalizeIdempotencyKey,
  normalizeText,
  parsePage,
  requestFingerprint,
  strictObject,
} from './expense-contract';

type Middleware = express.RequestHandler;
type Dependencies = { standardAuth: Middleware; mutationGuard: Middleware; rateLimiter: Middleware };
type Identity = { tenantId: string; employeeId: string };
type ClaimRow = Record<string, any>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
const SELF_PERMISSIONS = {
  submit: 'expenses.submit.self',
  view: 'expenses.view.self',
  cancel: 'expenses.cancel.self',
} as const;
const FINANCE_VIEW_PERMISSIONS = ['expenses.view.scoped', 'expenses.approve', 'expenses.reimburse', 'expenses.manage'] as const;

function sendError(res: express.Response, error: unknown, fallback: string) {
  if (error instanceof ExpenseError) {
    return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
  }
  const databaseError = error as { code?: string; constraint?: string };
  if (databaseError.code === '23505') {
    if (databaseError.constraint === 'expense_claims_extraction_unique') {
      return res.status(409).json({ success: false, code: 'EXPENSE_EXTRACTION_ALREADY_USED', message: 'This receipt extraction is already associated with an expense claim.' });
    }
    return res.status(409).json({ success: false, code: 'EXPENSE_CONFLICT', message: 'The expense claim already exists.' });
  }
  if (process.env.NODE_ENV !== 'production') console.error('[expenses] request failed', error);
  return res.status(500).json({ success: false, code: 'EXPENSE_REQUEST_FAILED', message: fallback });
}

async function requireActiveEmployee(client: PoolClient, identity: Identity) {
  const active = (await client.query(
    `SELECT 1 FROM employees
     WHERE tenant_id=$1 AND id=$2 AND is_active=true AND employment_status='active'`,
    [identity.tenantId, identity.employeeId],
  )).rows[0];
  if (!active) throw new ExpenseError(403, 'EXPENSE_EMPLOYEE_INACTIVE', 'An active employee account is required.');
}

async function requireScopedPermission(client: PoolClient, identity: Identity, permissionKey: string, targetEmployeeId: string) {
  const authority = await resolveScopedPermission(client, {
    tenantId: identity.tenantId,
    actorEmployeeId: identity.employeeId,
    permissionKey,
    targetEmployeeId,
  });
  if (!authority.allowed) throw new ExpenseError(403, 'EXPENSE_PERMISSION_DENIED', 'You do not have permission to perform this expense action.');
  return authority;
}

async function firstAuthority(
  client: PoolClient,
  identity: Identity,
  targetEmployeeId: string,
  permissionKeys: readonly string[],
): Promise<PermissionAuthority | null> {
  for (const permissionKey of permissionKeys) {
    const authority = await resolveScopedPermission(client, {
      tenantId: identity.tenantId,
      actorEmployeeId: identity.employeeId,
      permissionKey,
      targetEmployeeId,
    });
    if (authority.allowed) return authority;
  }
  return null;
}

async function hasAnyAssignedPermission(client: PoolClient, identity: Identity, permissionKeys: readonly string[]) {
  return Boolean((await client.query(
    `SELECT 1
     FROM (
       SELECT assignment.employee_id
       FROM employee_role_assignments assignment
       JOIN tenant_role_permissions permission
         ON permission.tenant_id=assignment.tenant_id AND permission.role_id=assignment.role_id
       WHERE assignment.tenant_id=$1 AND assignment.employee_id=$2
         AND permission.permission_key=ANY($3::varchar[])
         AND assignment.revoked_at IS NULL AND assignment.assigned_at<=NOW()
         AND (assignment.expires_at IS NULL OR assignment.expires_at>NOW())
       UNION ALL
       SELECT delegation.granted_to_employee_id
       FROM permission_delegations delegation
       WHERE delegation.tenant_id=$1 AND delegation.granted_to_employee_id=$2
         AND delegation.permission_key=ANY($3::varchar[])
         AND delegation.status='active' AND delegation.revoked_at IS NULL
         AND delegation.starts_at<=NOW() AND delegation.expires_at>NOW()
     ) authority
     LIMIT 1`,
    [identity.tenantId, identity.employeeId, permissionKeys],
  )).rows[0]);
}

function safeClaim(row: ClaimRow, own: boolean) {
  return {
    claimId: row.id,
    ...(own ? { extractionId: row.extraction_id || null } : {}),
    extractionAssociated: Boolean(row.extraction_id),
    merchantName: row.merchant_name,
    expenseDate: row.expense_date,
    amount: String(row.amount),
    currency: row.currency,
    category: row.category,
    businessReason: row.business_reason,
    status: row.status,
    submittedAt: row.submitted_at,
    approvedAt: row.approved_at || null,
    rejectedAt: row.rejected_at || null,
    cancelledAt: row.cancelled_at || null,
    reimbursedAt: row.reimbursed_at || null,
    decisionNote: row.decision_note || null,
    reimbursementExternalReference: row.reimbursement_external_reference || null,
    reimbursementNote: row.reimbursement_note || null,
    approvalConfigured: Boolean(row.approver_employee_id),
    version: row.version,
  };
}

function safeFinanceClaim(row: ClaimRow, capabilities: { canApprove: boolean; canReimburse: boolean }) {
  return {
    ...safeClaim(row, false),
    employee: {
      employeeId: row.employee_id,
      displayName: row.employee_name,
      departmentName: row.department_name || null,
      teamName: row.team_name || null,
    },
    approvalSource: row.approval_source || null,
    approvalScopeType: row.approval_scope_type || null,
    canApprove: row.status === 'pending' && capabilities.canApprove,
    canReimburse: row.status === 'approved' && capabilities.canReimburse,
  };
}

async function history(client: PoolClient, input: {
  tenantId: string;
  claimId: string;
  actorId: string;
  action: string;
  previousStatus: string | null;
  newStatus: string;
  metadata?: Record<string, unknown>;
}) {
  await client.query(
    `INSERT INTO expense_claim_history(
       tenant_id,expense_claim_id,actor_employee_id,action,previous_status,new_status,metadata
     ) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [input.tenantId, input.claimId, input.actorId, input.action, input.previousStatus, input.newStatus, JSON.stringify(input.metadata || {})],
  );
}

async function notify(client: PoolClient, input: {
  tenantId: string;
  eventType: string;
  claimId: string;
  employeeId: string;
  idempotencyKey: string;
  category: string;
  currency: string;
}) {
  const payload = {
    idempotencyKey: input.idempotencyKey,
    notificationKey: 'system_alerts',
    employeeId: input.employeeId,
    claimId: input.claimId,
    category: input.category,
    currency: input.currency,
    workspace: 'expenses',
    deepLink: {
      section: 'expenses',
      view: input.eventType === 'notification.expense_approval_required'
        || input.eventType === 'notification.expense_approver_unconfigured'
        ? 'approvals'
        : input.eventType === 'notification.expense_awaiting_reimbursement'
          ? 'reimbursements'
          : 'claims',
      claimId: input.claimId,
      eventType: input.eventType,
    },
  };
  await client.query(
    `INSERT INTO outbox_events(tenant_id,event_type,payload)
     SELECT $1,$2,$3::jsonb
     WHERE NOT EXISTS (
       SELECT 1 FROM outbox_events
       WHERE tenant_id=$1 AND event_type=$2 AND payload->>'idempotencyKey'=$4
     )`,
    [input.tenantId, input.eventType, JSON.stringify(payload), input.idempotencyKey],
  );
}

async function notifyUnconfiguredFinance(client: PoolClient, row: ClaimRow) {
  const recipients = (await client.query(
    `SELECT DISTINCT assignment.employee_id
     FROM employee_role_assignments assignment
     JOIN tenant_role_permissions permission
       ON permission.tenant_id=assignment.tenant_id AND permission.role_id=assignment.role_id
     JOIN employees employee
       ON employee.tenant_id=assignment.tenant_id AND employee.id=assignment.employee_id
     WHERE assignment.tenant_id=$1 AND permission.permission_key='expenses.manage'
       AND assignment.scope_type='company' AND assignment.revoked_at IS NULL
       AND assignment.assigned_at<=NOW() AND (assignment.expires_at IS NULL OR assignment.expires_at>NOW())
       AND employee.is_active=true AND employee.employment_status='active' AND employee.id<>$2`,
    [row.tenant_id, row.employee_id],
  )).rows;
  for (const recipient of recipients) {
    await notify(client, {
      tenantId: row.tenant_id,
      eventType: 'notification.expense_approver_unconfigured',
      claimId: row.id,
      employeeId: recipient.employee_id,
      idempotencyKey: `expense-approver-unconfigured:${row.id}:${recipient.employee_id}`,
      category: row.category,
      currency: row.currency,
    });
  }
}

const claimSelect = `claim.*,employee.full_name AS employee_name,
  department.name AS department_name,team.name AS team_name`;
const claimJoins = `FROM expense_claims claim
  JOIN employees employee ON employee.tenant_id=claim.tenant_id AND employee.id=claim.employee_id
  LEFT JOIN organisation_departments department ON department.tenant_id=employee.tenant_id AND department.id=employee.department_id
  LEFT JOIN organisation_teams team ON team.tenant_id=employee.tenant_id AND team.id=employee.team_id`;

function parseCreate(body: Record<string, unknown>, idempotencyHeader: unknown) {
  strictObject(body, ['extractionId', 'merchantName', 'expenseDate', 'amount', 'currency', 'category', 'businessReason']);
  const extractionValue = body.extractionId === undefined || body.extractionId === null ? null : body.extractionId;
  if (extractionValue !== null && !uuid(extractionValue)) {
    throw new ExpenseError(400, 'EXPENSE_VALIDATION_ERROR', 'extractionId is invalid.');
  }
  const extractionId = extractionValue as string | null;
  const value = {
    extractionId,
    merchantName: normalizeText(body.merchantName, 'merchantName', 200)!,
    expenseDate: normalizeDate(body.expenseDate),
    amount: normalizeAmount(body.amount),
    currency: normalizeCurrency(body.currency),
    category: normalizeCategory(body.category),
    businessReason: normalizeText(body.businessReason, 'businessReason', 2000)!,
  };
  return {
    ...value,
    idempotencyKey: normalizeIdempotencyKey(idempotencyHeader),
    fingerprint: requestFingerprint(value),
  };
}

function parseDecision(body: unknown) {
  strictObject(body, ['expectedVersion', 'note']);
  const source = body as Record<string, unknown>;
  return {
    expectedVersion: normalizeExpectedVersion(source.expectedVersion),
    note: normalizeText(source.note, 'note', 1000, false),
  };
}

function parseReimbursement(body: unknown) {
  strictObject(body, ['expectedVersion', 'externalReference', 'note']);
  const source = body as Record<string, unknown>;
  return {
    expectedVersion: normalizeExpectedVersion(source.expectedVersion),
    externalReference: normalizeText(source.externalReference, 'externalReference', 120, false),
    note: normalizeText(source.note, 'note', 1000, false),
  };
}

export function registerExpenseRoutes(
  app: express.Express,
  { standardAuth, mutationGuard, rateLimiter }: Dependencies,
) {
  app.post('/api/me/expense-claims', rateLimiter, standardAuth, mutationGuard, async (req, res) => {
    try {
      const identity = req.authUser!;
      const value = parseCreate(req.body || {}, req.header('Idempotency-Key'));
      const result = await withTenant(identity.tenantId, async (client) => {
        await requireActiveEmployee(client, identity);
        await requireScopedPermission(client, identity, SELF_PERMISSIONS.submit, identity.employeeId);
        if (value.idempotencyKey) {
          await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [`expense-create:${identity.tenantId}:${identity.employeeId}:${value.idempotencyKey}`]);
          const existing = (await client.query(
            `SELECT * FROM expense_claims WHERE tenant_id=$1 AND employee_id=$2 AND idempotency_key=$3`,
            [identity.tenantId, identity.employeeId, value.idempotencyKey],
          )).rows[0];
          if (existing) {
            if (existing.request_fingerprint !== value.fingerprint) {
              throw new ExpenseError(409, 'EXPENSE_IDEMPOTENCY_CONFLICT', 'This idempotency key was already used for a different request.');
            }
            return { claim: safeClaim(existing, true), duplicateWarning: false, idempotentReplay: true };
          }
        }
        if (value.extractionId) {
          const extraction = (await client.query(
            `SELECT id FROM document_extraction_jobs
             WHERE tenant_id=$1 AND id=$2 AND requested_by_employee_id=$3
               AND mode='expense_receipt' AND status='completed' AND expires_at>NOW()`,
            [identity.tenantId, value.extractionId, identity.employeeId],
          )).rows[0];
          if (!extraction) throw new ExpenseError(404, 'EXPENSE_EXTRACTION_NOT_FOUND', 'Receipt extraction not found.');
        }
        const duplicateWarning = Boolean((await client.query(
          `SELECT 1 FROM expense_claims
           WHERE tenant_id=$1 AND employee_id=$2 AND lower(merchant_name)=lower($3)
             AND expense_date=$4 AND amount=$5::numeric AND currency=$6
             AND status IN ('pending','approved','reimbursed') LIMIT 1`,
          [identity.tenantId, identity.employeeId, value.merchantName, value.expenseDate, value.amount, value.currency],
        )).rows[0]);
        let row = (await client.query(
          `INSERT INTO expense_claims(
             tenant_id,employee_id,extraction_id,merchant_name,expense_date,amount,currency,
             category,business_reason,status,idempotency_key,request_fingerprint
           ) VALUES($1,$2,$3,$4,$5,$6::numeric,$7,$8,$9,'pending',$10,$11)
           RETURNING *`,
          [
            identity.tenantId, identity.employeeId, value.extractionId, value.merchantName,
            value.expenseDate, value.amount, value.currency, value.category, value.businessReason,
            value.idempotencyKey, value.fingerprint,
          ],
        )).rows[0];
        const resolution = await resolveApprovalChain(client, {
          tenantId: identity.tenantId,
          requestingEmployeeId: identity.employeeId,
          requiredPermissionKey: 'expenses.approve',
          excludedEmployeeIds: [identity.employeeId],
        });
        row = (await client.query(
          `UPDATE expense_claims
           SET approver_employee_id=$3,approval_source=$4,approval_scope_type=$5,
               approval_scope_id=$6,updated_at=NOW()
           WHERE tenant_id=$1 AND id=$2 RETURNING *`,
          [
            identity.tenantId, row.id, resolution.approverEmployeeId, resolution.source,
            resolution.resolvedScopeType, resolution.resolvedScopeId,
          ],
        )).rows[0];
        const auditMetadata = {
          claimId: row.id,
          employeeId: identity.employeeId,
          category: row.category,
          currency: row.currency,
          status: 'pending',
          extractionAssociated: Boolean(row.extraction_id),
        };
        await history(client, {
          tenantId: identity.tenantId,
          claimId: row.id,
          actorId: identity.employeeId,
          action: 'submitted',
          previousStatus: null,
          newStatus: 'pending',
          metadata: { category: row.category, currency: row.currency, extractionAssociated: Boolean(row.extraction_id) },
        });
        await recordAuditEvent(client, {
          tenantId: identity.tenantId,
          actorId: identity.employeeId,
          action: 'expense.claim_submitted',
          targetType: 'expense_claim',
          targetId: row.id,
          metadata: auditMetadata,
        });
        if (resolution.approverEmployeeId) {
          await recordAuditEvent(client, {
            tenantId: identity.tenantId,
            actorId: identity.employeeId,
            action: 'expense.approver_resolved',
            targetType: 'expense_claim',
            targetId: row.id,
            metadata: { ...auditMetadata, approverEmployeeId: resolution.approverEmployeeId },
          });
          await notify(client, {
            tenantId: identity.tenantId,
            eventType: 'notification.expense_approval_required',
            claimId: row.id,
            employeeId: resolution.approverEmployeeId,
            idempotencyKey: `expense-approval-required:${row.id}`,
            category: row.category,
            currency: row.currency,
          });
        } else {
          await recordAuditEvent(client, {
            tenantId: identity.tenantId,
            actorId: identity.employeeId,
            action: 'expense.approver_unconfigured',
            targetType: 'expense_claim',
            targetId: row.id,
            metadata: auditMetadata,
          });
          await notifyUnconfiguredFinance(client, row);
        }
        return { claim: safeClaim(row, true), duplicateWarning, idempotentReplay: false };
      });
      return res.status(result.idempotentReplay ? 200 : 201).json({ success: true, ...result });
    } catch (error) {
      return sendError(res, error, 'Unable to submit expense claim.');
    }
  });

  app.get('/api/me/expense-claims', standardAuth, async (req, res) => {
    try {
      const identity = req.authUser!;
      const status = req.query.status === undefined ? null : String(req.query.status);
      const category = req.query.category === undefined ? null : String(req.query.category);
      if (status && !isExpenseStatus(status)) throw new ExpenseError(400, 'EXPENSE_FILTER_INVALID', 'status is invalid.');
      if (category && !isExpenseCategory(category)) throw new ExpenseError(400, 'EXPENSE_FILTER_INVALID', 'category is invalid.');
      const fromDate = req.query.fromDate === undefined ? null : normalizeDate(req.query.fromDate, 'fromDate');
      const toDate = req.query.toDate === undefined ? null : normalizeDate(req.query.toDate, 'toDate');
      if (fromDate && toDate && fromDate > toDate) throw new ExpenseError(400, 'EXPENSE_FILTER_INVALID', 'fromDate must not be after toDate.');
      const page = parsePage(req.query.page, 1, 100_000);
      const pageSize = parsePage(req.query.pageSize, 25, 100);
      const result = await withTenant(identity.tenantId, async (client) => {
        await requireActiveEmployee(client, identity);
        await requireScopedPermission(client, identity, SELF_PERMISSIONS.view, identity.employeeId);
        const values = [identity.tenantId, identity.employeeId, status, category, fromDate, toDate];
        const where = `tenant_id=$1 AND employee_id=$2
          AND ($3::text IS NULL OR status=$3) AND ($4::text IS NULL OR category=$4)
          AND ($5::date IS NULL OR expense_date >= $5) AND ($6::date IS NULL OR expense_date <= $6)`;
        const total = Number((await client.query(`SELECT count(*)::int AS count FROM expense_claims WHERE ${where}`, values)).rows[0].count);
        const rows = (await client.query(
          `SELECT * FROM expense_claims WHERE ${where}
           ORDER BY submitted_at DESC,id DESC LIMIT $7 OFFSET $8`,
          [...values, pageSize, (page - 1) * pageSize],
        )).rows;
        return { claims: rows.map((row) => safeClaim(row, true)), total, page, pageSize };
      });
      return res.json({ success: true, ...result });
    } catch (error) {
      return sendError(res, error, 'Unable to load expense claims.');
    }
  });

  app.get('/api/me/expense-claims/:claimId', standardAuth, async (req, res) => {
    try {
      if (!uuid(req.params.claimId)) throw new ExpenseError(404, 'EXPENSE_CLAIM_NOT_FOUND', 'Expense claim not found.');
      const identity = req.authUser!;
      const result = await withTenant(identity.tenantId, async (client) => {
        await requireActiveEmployee(client, identity);
        await requireScopedPermission(client, identity, SELF_PERMISSIONS.view, identity.employeeId);
        const row = (await client.query(
          `SELECT * FROM expense_claims WHERE tenant_id=$1 AND employee_id=$2 AND id=$3`,
          [identity.tenantId, identity.employeeId, req.params.claimId],
        )).rows[0];
        if (!row) throw new ExpenseError(404, 'EXPENSE_CLAIM_NOT_FOUND', 'Expense claim not found.');
        const historyRows = (await client.query(
          `SELECT action,previous_status AS "previousStatus",new_status AS "newStatus",created_at AS "createdAt"
           FROM expense_claim_history WHERE tenant_id=$1 AND expense_claim_id=$2
           ORDER BY created_at ASC,id ASC`,
          [identity.tenantId, row.id],
        )).rows;
        return { claim: safeClaim(row, true), history: historyRows };
      });
      return res.json({ success: true, ...result });
    } catch (error) {
      return sendError(res, error, 'Unable to load expense claim.');
    }
  });

  app.post('/api/me/expense-claims/:claimId/cancel', rateLimiter, standardAuth, mutationGuard, async (req, res) => {
    try {
      if (!uuid(req.params.claimId)) throw new ExpenseError(404, 'EXPENSE_CLAIM_NOT_FOUND', 'Expense claim not found.');
      strictObject(req.body, ['expectedVersion']);
      const expectedVersion = normalizeExpectedVersion(req.body?.expectedVersion);
      const identity = req.authUser!;
      const claim = await withTenant(identity.tenantId, async (client) => {
        await requireActiveEmployee(client, identity);
        await requireScopedPermission(client, identity, SELF_PERMISSIONS.cancel, identity.employeeId);
        const current = (await client.query(
          `SELECT * FROM expense_claims WHERE tenant_id=$1 AND employee_id=$2 AND id=$3 FOR UPDATE`,
          [identity.tenantId, identity.employeeId, req.params.claimId],
        )).rows[0];
        if (!current) throw new ExpenseError(404, 'EXPENSE_CLAIM_NOT_FOUND', 'Expense claim not found.');
        if (current.status !== 'pending' || current.version !== expectedVersion) {
          throw new ExpenseError(409, 'EXPENSE_STATE_CONFLICT', 'Expense claim changed or can no longer be cancelled.');
        }
        const row = (await client.query(
          `UPDATE expense_claims SET status='cancelled',cancelled_at=NOW(),updated_at=NOW(),version=version+1
           WHERE tenant_id=$1 AND employee_id=$2 AND id=$3 AND status='pending' AND version=$4
           RETURNING *`,
          [identity.tenantId, identity.employeeId, current.id, expectedVersion],
        )).rows[0];
        if (!row) throw new ExpenseError(409, 'EXPENSE_STATE_CONFLICT', 'Expense claim changed or can no longer be cancelled.');
        await history(client, {
          tenantId: identity.tenantId, claimId: row.id, actorId: identity.employeeId,
          action: 'cancelled', previousStatus: 'pending', newStatus: 'cancelled',
          metadata: { category: row.category, currency: row.currency },
        });
        await recordAuditEvent(client, {
          tenantId: identity.tenantId, actorId: identity.employeeId, action: 'expense.claim_cancelled',
          targetType: 'expense_claim', targetId: row.id,
          metadata: {
            claimId: row.id, employeeId: row.employee_id, approverEmployeeId: row.approver_employee_id,
            category: row.category, currency: row.currency, status: 'cancelled', extractionAssociated: Boolean(row.extraction_id),
          },
        });
        if (row.approver_employee_id) {
          await notify(client, {
            tenantId: identity.tenantId, eventType: 'notification.expense_cancelled',
            claimId: row.id, employeeId: row.approver_employee_id,
            idempotencyKey: `expense-cancelled:${row.id}`, category: row.category, currency: row.currency,
          });
        }
        return safeClaim(row, true);
      });
      return res.json({ success: true, claim });
    } catch (error) {
      return sendError(res, error, 'Unable to cancel expense claim.');
    }
  });

  app.get('/api/finance/expense-claims', standardAuth, async (req, res) => {
    try {
      const identity = req.authUser!;
      const status = req.query.status === undefined ? null : String(req.query.status);
      const category = req.query.category === undefined ? null : String(req.query.category);
      const currency = req.query.currency === undefined ? null : String(req.query.currency).toUpperCase();
      if (status && !isExpenseStatus(status)) throw new ExpenseError(400, 'EXPENSE_FILTER_INVALID', 'status is invalid.');
      if (category && !isExpenseCategory(category)) throw new ExpenseError(400, 'EXPENSE_FILTER_INVALID', 'category is invalid.');
      if (currency && !isSupportedCurrency(currency)) throw new ExpenseError(400, 'EXPENSE_FILTER_INVALID', 'currency is invalid.');
      for (const key of ['employee', 'department', 'team'] as const) {
        if (req.query[key] !== undefined && !uuid(req.query[key])) throw new ExpenseError(400, 'EXPENSE_FILTER_INVALID', `${key} is invalid.`);
      }
      const fromDate = req.query.fromDate === undefined ? null : normalizeDate(req.query.fromDate, 'fromDate');
      const toDate = req.query.toDate === undefined ? null : normalizeDate(req.query.toDate, 'toDate');
      if (fromDate && toDate && fromDate > toDate) throw new ExpenseError(400, 'EXPENSE_FILTER_INVALID', 'fromDate must not be after toDate.');
      if (req.query.actionableOnly !== undefined && !['true', 'false'].includes(String(req.query.actionableOnly))) {
        throw new ExpenseError(400, 'EXPENSE_FILTER_INVALID', 'actionableOnly is invalid.');
      }
      const actionableOnly = String(req.query.actionableOnly) === 'true';
      const search = normalizeText(req.query.search, 'search', 120, false);
      const page = parsePage(req.query.page, 1, 100_000);
      const pageSize = parsePage(req.query.pageSize, 25, 100);
      const result = await withTenant(identity.tenantId, async (client) => {
        await requireActiveEmployee(client, identity);
        if (!(await hasAnyAssignedPermission(client, identity, FINANCE_VIEW_PERMISSIONS))) {
          throw new ExpenseError(403, 'EXPENSE_PERMISSION_DENIED', 'You do not have permission to view Finance expense claims.');
        }
        const rows = (await client.query(
          `SELECT ${claimSelect} ${claimJoins}
           WHERE claim.tenant_id=$1
             AND ($2::text IS NULL OR claim.status=$2)
             AND ($3::uuid IS NULL OR claim.employee_id=$3)
             AND ($4::uuid IS NULL OR employee.department_id=$4)
             AND ($5::uuid IS NULL OR employee.team_id=$5)
             AND ($6::text IS NULL OR claim.category=$6)
             AND ($7::text IS NULL OR claim.currency=$7)
             AND ($8::date IS NULL OR claim.expense_date >= $8)
             AND ($9::date IS NULL OR claim.expense_date <= $9)
             AND ($10::text IS NULL OR employee.full_name ILIKE '%'||$10||'%' OR claim.merchant_name ILIKE '%'||$10||'%')
           ORDER BY claim.submitted_at DESC,claim.id DESC LIMIT 5000`,
          [
            identity.tenantId, status, req.query.employee || null, req.query.department || null,
            req.query.team || null, category, currency, fromDate, toDate, search,
          ],
        )).rows;
        const visible: Array<{ row: ClaimRow; canApprove: boolean; canReimburse: boolean }> = [];
        for (const row of rows) {
          const view = await firstAuthority(client, identity, row.employee_id, FINANCE_VIEW_PERMISSIONS);
          if (!view) continue;
          const canApprove = Boolean(await firstAuthority(client, identity, row.employee_id, ['expenses.approve', 'expenses.manage']));
          const canReimburse = Boolean(await firstAuthority(client, identity, row.employee_id, ['expenses.reimburse', 'expenses.manage']));
          if (!actionableOnly || (row.status === 'pending' && canApprove) || (row.status === 'approved' && canReimburse)) {
            visible.push({ row, canApprove, canReimburse });
          }
        }
        const offset = (page - 1) * pageSize;
        return {
          claims: visible.slice(offset, offset + pageSize).map((item) => safeFinanceClaim(item.row, item)),
          total: visible.length,
          page,
          pageSize,
        };
      });
      return res.json({ success: true, ...result });
    } catch (error) {
      return sendError(res, error, 'Unable to load Finance expense claims.');
    }
  });

  app.get('/api/finance/expense-claims/:claimId', standardAuth, async (req, res) => {
    try {
      if (!uuid(req.params.claimId)) throw new ExpenseError(404, 'EXPENSE_CLAIM_NOT_FOUND', 'Expense claim not found.');
      const identity = req.authUser!;
      const result = await withTenant(identity.tenantId, async (client) => {
        await requireActiveEmployee(client, identity);
        const row = (await client.query(
          `SELECT ${claimSelect} ${claimJoins} WHERE claim.tenant_id=$1 AND claim.id=$2`,
          [identity.tenantId, req.params.claimId],
        )).rows[0];
        if (!row) throw new ExpenseError(404, 'EXPENSE_CLAIM_NOT_FOUND', 'Expense claim not found.');
        const view = await firstAuthority(client, identity, row.employee_id, FINANCE_VIEW_PERMISSIONS);
        if (!view || row.employee_id === identity.employeeId) throw new ExpenseError(404, 'EXPENSE_CLAIM_NOT_FOUND', 'Expense claim not found.');
        const canApprove = Boolean(await firstAuthority(client, identity, row.employee_id, ['expenses.approve', 'expenses.manage']));
        const canReimburse = Boolean(await firstAuthority(client, identity, row.employee_id, ['expenses.reimburse', 'expenses.manage']));
        const historyRows = (await client.query(
          `SELECT action,previous_status AS "previousStatus",new_status AS "newStatus",created_at AS "createdAt"
           FROM expense_claim_history WHERE tenant_id=$1 AND expense_claim_id=$2
           ORDER BY created_at ASC,id ASC`,
          [identity.tenantId, row.id],
        )).rows;
        return { claim: safeFinanceClaim(row, { canApprove, canReimburse }), history: historyRows };
      });
      return res.json({ success: true, ...result });
    } catch (error) {
      return sendError(res, error, 'Unable to load Finance expense claim.');
    }
  });

  const decide = (decision: 'approved' | 'rejected') => async (req: express.Request, res: express.Response) => {
    try {
      if (!uuid(req.params.claimId)) throw new ExpenseError(404, 'EXPENSE_CLAIM_NOT_FOUND', 'Expense claim not found.');
      const value = parseDecision(req.body);
      const identity = req.authUser!;
      const claim = await withTenant(identity.tenantId, async (client) => {
        await requireActiveEmployee(client, identity);
        const current = (await client.query(
          `SELECT * FROM expense_claims WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
          [identity.tenantId, req.params.claimId],
        )).rows[0];
        if (!current) throw new ExpenseError(404, 'EXPENSE_CLAIM_NOT_FOUND', 'Expense claim not found.');
        if (current.employee_id === identity.employeeId) throw new ExpenseError(404, 'EXPENSE_CLAIM_NOT_FOUND', 'Expense claim not found.');
        const authority = await firstAuthority(client, identity, current.employee_id, ['expenses.approve', 'expenses.manage']);
        if (!authority) throw new ExpenseError(404, 'EXPENSE_CLAIM_NOT_FOUND', 'Expense claim not found.');
        if (current.status !== 'pending' || current.version !== value.expectedVersion) {
          throw new ExpenseError(409, 'EXPENSE_STATE_CONFLICT', 'Expense claim has already changed or been decided.');
        }
        const source = authority.source === 'delegation'
          ? 'delegation'
          : current.approver_employee_id === identity.employeeId && current.approval_source
            ? current.approval_source
            : 'scoped_role';
        const row = (await client.query(
          `UPDATE expense_claims
           SET status=$5,approver_employee_id=$3,approval_source=$6,
               approval_scope_type=$7,approval_scope_id=$8,decision_note=$9,
               approval_decided_at=NOW(),
               approved_at=CASE WHEN $5='approved' THEN NOW() ELSE NULL END,
               rejected_at=CASE WHEN $5='rejected' THEN NOW() ELSE NULL END,
               updated_at=NOW(),version=version+1
           WHERE tenant_id=$1 AND id=$2 AND status='pending' AND version=$4
           RETURNING *`,
          [
            identity.tenantId, current.id, identity.employeeId, value.expectedVersion, decision,
            source, authority.resolvedScope?.type || current.approval_scope_type,
            authority.resolvedScope?.id || current.approval_scope_id, value.note,
          ],
        )).rows[0];
        if (!row) throw new ExpenseError(409, 'EXPENSE_STATE_CONFLICT', 'Expense claim has already changed or been decided.');
        await history(client, {
          tenantId: identity.tenantId, claimId: row.id, actorId: identity.employeeId,
          action: decision, previousStatus: 'pending', newStatus: decision,
          metadata: { category: row.category, currency: row.currency, approvalSource: source },
        });
        await recordAuditEvent(client, {
          tenantId: identity.tenantId, actorId: identity.employeeId,
          action: decision === 'approved' ? 'expense.claim_approved' : 'expense.claim_rejected',
          targetType: 'expense_claim', targetId: row.id,
          metadata: {
            claimId: row.id, employeeId: row.employee_id, approverEmployeeId: identity.employeeId,
            category: row.category, currency: row.currency, status: decision,
            extractionAssociated: Boolean(row.extraction_id),
          },
        });
        const notificationKey = decision === 'approved'
          ? `expense-approved:${row.id}`
          : `expense-rejected:${row.id}`;
        await notify(client, {
          tenantId: identity.tenantId,
          eventType: decision === 'approved' ? 'notification.expense_approved' : 'notification.expense_rejected',
          claimId: row.id,
          employeeId: row.employee_id,
          idempotencyKey: notificationKey,
          category: row.category,
          currency: row.currency,
        });
        return safeFinanceClaim(row, {
          canApprove: false,
          canReimburse: Boolean(await firstAuthority(client, identity, row.employee_id, ['expenses.reimburse', 'expenses.manage'])),
        });
      });
      return res.json({ success: true, claim });
    } catch (error) {
      return sendError(res, error, `Unable to ${decision === 'approved' ? 'approve' : 'reject'} expense claim.`);
    }
  };

  app.post('/api/finance/expense-claims/:claimId/approve', rateLimiter, standardAuth, mutationGuard, decide('approved'));
  app.post('/api/finance/expense-claims/:claimId/reject', rateLimiter, standardAuth, mutationGuard, decide('rejected'));

  app.post('/api/finance/expense-claims/:claimId/reimburse', rateLimiter, standardAuth, mutationGuard, async (req, res) => {
    try {
      if (!uuid(req.params.claimId)) throw new ExpenseError(404, 'EXPENSE_CLAIM_NOT_FOUND', 'Expense claim not found.');
      const value = parseReimbursement(req.body);
      const identity = req.authUser!;
      const claim = await withTenant(identity.tenantId, async (client) => {
        await requireActiveEmployee(client, identity);
        const current = (await client.query(
          `SELECT * FROM expense_claims WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
          [identity.tenantId, req.params.claimId],
        )).rows[0];
        if (!current) throw new ExpenseError(404, 'EXPENSE_CLAIM_NOT_FOUND', 'Expense claim not found.');
        if (current.employee_id === identity.employeeId) throw new ExpenseError(404, 'EXPENSE_CLAIM_NOT_FOUND', 'Expense claim not found.');
        const authority = await firstAuthority(client, identity, current.employee_id, ['expenses.reimburse', 'expenses.manage']);
        if (!authority) throw new ExpenseError(403, 'EXPENSE_REIMBURSE_PERMISSION_REQUIRED', 'Separate reimbursement permission is required.');
        if (current.status !== 'approved' || current.version !== value.expectedVersion) {
          throw new ExpenseError(409, 'EXPENSE_STATE_CONFLICT', 'Only the current approved claim can be reimbursed.');
        }
        const row = (await client.query(
          `UPDATE expense_claims
           SET status='reimbursed',reimbursed_at=NOW(),reimbursed_by_employee_id=$3,
               reimbursement_external_reference=$5,reimbursement_note=$6,
               updated_at=NOW(),version=version+1
           WHERE tenant_id=$1 AND id=$2 AND status='approved' AND version=$4
           RETURNING *`,
          [identity.tenantId, current.id, identity.employeeId, value.expectedVersion, value.externalReference, value.note],
        )).rows[0];
        if (!row) throw new ExpenseError(409, 'EXPENSE_STATE_CONFLICT', 'Only the current approved claim can be reimbursed.');
        await history(client, {
          tenantId: identity.tenantId, claimId: row.id, actorId: identity.employeeId,
          action: 'reimbursed', previousStatus: 'approved', newStatus: 'reimbursed',
          metadata: { category: row.category, currency: row.currency },
        });
        await recordAuditEvent(client, {
          tenantId: identity.tenantId, actorId: identity.employeeId, action: 'expense.claim_reimbursed',
          targetType: 'expense_claim', targetId: row.id,
          metadata: {
            claimId: row.id, employeeId: row.employee_id, approverEmployeeId: row.approver_employee_id,
            category: row.category, currency: row.currency, status: 'reimbursed',
            extractionAssociated: Boolean(row.extraction_id),
          },
        });
        await notify(client, {
          tenantId: identity.tenantId, eventType: 'notification.expense_reimbursed',
          claimId: row.id, employeeId: row.employee_id,
          idempotencyKey: `expense-reimbursed:${row.id}`, category: row.category, currency: row.currency,
        });
        return safeFinanceClaim(row, { canApprove: false, canReimburse: false });
      });
      return res.json({ success: true, claim });
    } catch (error) {
      return sendError(res, error, 'Unable to reimburse expense claim.');
    }
  });
}
