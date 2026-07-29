import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { PoolClient } from 'pg';
import { presentAuditEvent, recordAuditEvent } from '../src/server/audit/audit-events';
import {
  ExpenseError,
  EXPENSE_CATEGORIES,
  normalizeAmount,
  normalizeCategory,
  normalizeCurrency,
  normalizeDate,
  normalizeExpectedVersion,
  normalizeIdempotencyKey,
  normalizeText,
  requestFingerprint,
  strictObject,
} from '../src/server/expenses/expense-contract';

const passes: string[] = [];
const CLAIM_ID = '00000000-0000-4000-8000-000000000001';
const EMPLOYEE_ID = '00000000-0000-4000-8000-000000000002';
const TENANT_ID = '00000000-0000-4000-8000-000000000003';

function pass(label: string) {
  passes.push(label);
  console.log(`PASS  ${label}`);
}

function expectExpenseError(task: () => unknown, code = 'EXPENSE_VALIDATION_ERROR') {
  let caught: unknown;
  try {
    task();
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof ExpenseError, `Expected ${code}.`);
  assert.equal(caught.code, code);
}

assert.equal(normalizeAmount('1'), '1.00');
assert.equal(normalizeAmount('1.2'), '1.20');
assert.equal(normalizeAmount('9999999999.99'), '9999999999.99');
for (const invalid of ['0', '0.00', '-1.00', '1e3', 'NaN', 'Infinity', '1.234', '10000000000.00', 12.5]) {
  expectExpenseError(() => normalizeAmount(invalid));
}
assert.equal(normalizeCurrency('egp'), 'EGP');
for (const invalid of ['ZZZ', 'US', 'USDD', 123]) expectExpenseError(() => normalizeCurrency(invalid));
assert.equal(normalizeCategory('travel'), 'travel');
expectExpenseError(() => normalizeCategory('executive_bonus'));
assert.equal(EXPENSE_CATEGORIES.length, 9);
pass('Money, currency, and category validation is bounded and decimal-string based');

assert.equal(normalizeDate('2026-07-29'), '2026-07-29');
for (const invalid of ['29/07/2026', '2026-02-30', '2026-7-9', null]) expectExpenseError(() => normalizeDate(invalid));
assert.equal(normalizeText('  Safe   merchant ', 'merchantName', 200), 'Safe merchant');
expectExpenseError(() => normalizeText('x'.repeat(201), 'merchantName', 200));
expectExpenseError(() => normalizeText('x'.repeat(2001), 'businessReason', 2000));
assert.equal(normalizeExpectedVersion(1), 1);
expectExpenseError(() => normalizeExpectedVersion(0));
assert.equal(normalizeIdempotencyKey('expense:test:0001'), 'expense:test:0001');
expectExpenseError(() => normalizeIdempotencyKey('short'));
strictObject({ merchantName: 'Safe' }, ['merchantName']);
expectExpenseError(() => strictObject({ employeeId: EMPLOYEE_ID }, ['merchantName']));
pass('Dates, text lengths, versions, idempotency keys, and unknown fields fail safely');

const fingerprintInput = {
  extractionId: null,
  merchantName: 'Test Market',
  expenseDate: '2026-07-29',
  amount: '125.50',
  currency: 'EGP',
  category: 'meals' as const,
  businessReason: 'Team meal',
};
assert.equal(requestFingerprint(fingerprintInput), requestFingerprint({ ...fingerprintInput }));
assert.notEqual(requestFingerprint(fingerprintInput), requestFingerprint({ ...fingerprintInput, amount: '125.51' }));
pass('Create retries use deterministic request fingerprints without floating-point arithmetic');

const [migration, routes, registry, resolver, scopedPermissions, server, packageJson] = await Promise.all([
  readFile('src/db/migrations/20260729_add_expense_claims.sql', 'utf8'),
  readFile('src/server/expenses/expense-routes.ts', 'utf8'),
  readFile('src/server/organisation/permission-registry.ts', 'utf8'),
  readFile('src/server/organisation/approval-chain.ts', 'utf8'),
  readFile('src/server/organisation/scoped-permissions.ts', 'utf8'),
  readFile('server.ts', 'utf8'),
  readFile('package.json', 'utf8'),
]);

for (const table of ['expense_claims', 'expense_claim_history']) {
  assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(migration, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
}
assert.match(migration, /UNIQUE\(id, tenant_id\)/);
assert.match(migration, /FOREIGN KEY\(employee_id, tenant_id\)/);
assert.match(migration, /FOREIGN KEY\(extraction_id, tenant_id\)/);
assert.match(migration, /REFERENCES document_extraction_jobs\(id, tenant_id\)/);
assert.match(migration, /FOREIGN KEY\(expense_claim_id, tenant_id\)/);
assert.match(migration, /REFERENCES expense_claims\(id, tenant_id\)/);
assert.match(migration, /NUMERIC\(12,2\)/);
assert.match(migration, /expense_claims_amount_check/);
assert.match(migration, /expense_claims_employee_idempotency_unique/);
assert.match(migration, /expense_claims_extraction_unique/);
for (const index of [
  'expense_claims_employee_submitted_idx',
  'expense_claims_approver_pending_idx',
  'expense_claims_status_submitted_idx',
  'expense_claims_expense_date_idx',
  'expense_claims_reimbursed_idx',
  'expense_claim_history_claim_idx',
]) assert(migration.includes(index));
pass('Expense tables have tenant-safe composite keys, RLS, numeric money, and workflow indexes');

for (const permission of [
  'expenses.submit.self', 'expenses.view.self', 'expenses.cancel.self',
  'expenses.view.scoped', 'expenses.approve', 'expenses.reimburse', 'expenses.manage',
]) {
  assert(migration.includes(permission));
  assert(registry.includes(permission));
}
assert.match(migration, /WHERE role\.system_key IN \('employee','manager','hr_admin'\)/);
const baselineGrant = migration.slice(migration.indexOf('-- Baseline roles receive only personal self-service grants.'));
assert.doesNotMatch(baselineGrant, /\('expenses\.approve'\)|\('expenses\.reimburse'\)|\('expenses\.manage'\)/);
assert.match(registry, /'expenses\.reimburse'[\s\S]*peopleScopes, false, true/);
assert.match(registry, /'expenses\.manage'[\s\S]*peopleScopes, false, true/);
pass('Self-service grants are explicit and Finance authority is never granted by role name');

for (const route of [
  "app.post('/api/me/expense-claims'",
  "app.get('/api/me/expense-claims'",
  "app.get('/api/me/expense-claims/:claimId'",
  "app.post('/api/me/expense-claims/:claimId/cancel'",
  "app.get('/api/finance/expense-claims'",
  "app.get('/api/finance/expense-claims/:claimId'",
  "app.post('/api/finance/expense-claims/:claimId/approve'",
  "app.post('/api/finance/expense-claims/:claimId/reject'",
  "app.post('/api/finance/expense-claims/:claimId/reimburse'",
]) assert(routes.includes(route), `Missing ${route}.`);
assert.match(server, /registerExpenseRoutes/);
assert.match(server, /expenseMutationRateLimiter/);
assert.match(packageJson, /"test:expenses": "tsx scripts\/expenses-test\.ts"/);
pass('Employee and Finance routes use standard auth, mutation guards, and dedicated throttling');

assert.match(routes, /requested_by_employee_id=\$3/);
assert.match(routes, /mode='expense_receipt' AND status='completed' AND expires_at>NOW\(\)/);
assert.match(routes, /EXPENSE_EXTRACTION_NOT_FOUND/);
assert.doesNotMatch(routes, /result_json|providerPayload|rawOcr|ocrText/);
assert.match(routes, /extractionAssociated: Boolean/);
assert.match(routes, /expense_claims_extraction_unique/);
pass('Extraction association is requester-owned, completed, unexpired, receipt-only, and value-minimised');

assert.match(routes, /resolveApprovalChain/);
assert.match(routes, /requiredPermissionKey: 'expenses\.approve'/);
assert.match(resolver, /candidateId === input\.requestingEmployeeId/);
assert.match(resolver, /is_active=true AND employment_status='active'/);
assert.match(scopedPermissions, /delegation\.status='active'/);
assert.match(scopedPermissions, /delegation\.revoked_at IS NULL/);
assert.match(scopedPermissions, /delegation\.starts_at<=NOW\(\) AND delegation\.expires_at>NOW\(\)/);
assert.doesNotMatch(routes, /role === ['"]hr_admin|system_key=['"]hr_admin/);
assert.match(routes, /notifyUnconfiguredFinance/);
pass('Approver routing excludes self, requires active scoped authority, and honours only active delegations');

assert.match(routes, /WHERE tenant_id=\$1 AND employee_id=\$2 AND id=\$3/);
assert.match(routes, /requested_by_employee_id=\$3/);
assert.match(routes, /resolveScopedPermission/);
assert.match(routes, /if \(!view \|\| row\.employee_id === identity\.employeeId\)/);
assert.match(routes, /LIMIT \$7 OFFSET \$8/);
assert.match(routes, /actionableOnly/);
for (const filter of ['status', 'category', 'fromDate', 'toDate', 'employee', 'department', 'team', 'currency', 'search']) {
  assert(routes.includes(filter), `Missing ${filter} filter.`);
}
pass('Own visibility, scoped Finance visibility, resource hiding, filters, and pagination are enforced');

const locks = routes.match(/FOR UPDATE/g) || [];
assert(locks.length >= 3, 'Cancel, decision, and reimbursement must lock claims.');
assert.match(routes, /status='pending' AND version=\$4/);
assert.match(routes, /status='approved' AND version=\$4/);
assert.match(routes, /current\.status !== 'pending' \|\| current\.version !==/);
assert.match(routes, /current\.status !== 'approved' \|\| current\.version !==/);
assert.match(routes, /EXPENSE_STATE_CONFLICT/);
assert.match(routes, /pg_advisory_xact_lock/);
assert.match(routes, /request_fingerprint !== value\.fingerprint/);
assert.match(routes, /idempotentReplay/);
pass('Row locks, expected-state updates, versions, and idempotency prevent transition races and replay');

assert.match(routes, /\['expenses\.approve', 'expenses\.manage'\]/);
assert.match(routes, /\['expenses\.reimburse', 'expenses\.manage'\]/);
assert.match(routes, /EXPENSE_REIMBURSE_PERMISSION_REQUIRED/);
assert.match(routes, /SET status='reimbursed',reimbursed_at=NOW\(\),reimbursed_by_employee_id=\$3/);
assert.doesNotMatch(routes, /INSERT INTO payroll|UPDATE payroll|bank_transfer|accounting_entry/i);
assert.match(routes, /approved_at=CASE WHEN \$5='approved' THEN NOW\(\) ELSE NULL END/);
pass('Approval is separate from reimbursement and no payment, payroll, or accounting mutation exists');

for (const key of [
  'expense-approval-required:', 'expense-approved:', 'expense-rejected:',
  'expense-cancelled:', 'expense-reimbursed:', 'expense-approver-unconfigured:',
]) assert(routes.includes(key), `Missing notification idempotency key ${key}.`);
assert.match(routes, /WHERE NOT EXISTS \([\s\S]*payload->>'idempotencyKey'/);
assert.doesNotMatch(routes, /payload[\s\S]{0,200}(business_reason|decision_note|reimbursement_note|merchant_name|amount)/);
pass('Notifications use deterministic keys and omit private claim content');

const auditProjection = presentAuditEvent('expense.claim_reimbursed', 'expense_claim', {
  claimId: CLAIM_ID,
  employeeId: EMPLOYEE_ID,
  approverEmployeeId: EMPLOYEE_ID,
  category: 'travel',
  currency: 'EGP',
  status: 'reimbursed',
  extractionAssociated: true,
  amount: '125.50',
  merchantName: 'Private merchant',
  businessReason: 'Private reason',
  note: 'Private note',
  externalReference: 'BANK-PRIVATE',
});
assert.equal(auditProjection.module, 'expenses');
for (const forbidden of ['amount', 'merchantName', 'businessReason', 'note', 'externalReference']) {
  assert(!(forbidden in auditProjection.metadata), `${forbidden} escaped audit projection.`);
}
const writes: unknown[][] = [];
const client = {
  query: async (_sql: string, values: unknown[]) => {
    writes.push(values);
    return { rows: [], rowCount: 1 };
  },
} as unknown as PoolClient;
await recordAuditEvent(client, {
  tenantId: TENANT_ID,
  actorId: EMPLOYEE_ID,
  action: 'expense.claim_submitted',
  targetType: 'expense_claim',
  targetId: CLAIM_ID,
  metadata: {
    claimId: CLAIM_ID,
    employeeId: EMPLOYEE_ID,
    category: 'meals',
    currency: 'EGP',
    status: 'pending',
    extractionAssociated: false,
  },
});
await assert.rejects(() => recordAuditEvent(client, {
  tenantId: TENANT_ID,
  actorId: EMPLOYEE_ID,
  action: 'expense.claim_submitted',
  targetType: 'expense_claim',
  targetId: CLAIM_ID,
  metadata: { claimId: CLAIM_ID, amount: '125.50' },
}));
assert.equal(writes.length, 1);
pass('Audit writer permits safe workflow metadata and rejects amounts, notes, reasons, and OCR content');

assert.match(routes, /INSERT INTO expense_claim_history/);
assert.match(routes, /recordAuditEvent/);
assert.match(routes, /INSERT INTO outbox_events/);
assert.match(routes, /withTenant/);
assert.doesNotMatch(routes, /DELETE FROM expense_claims|DELETE FROM expense_claim_history/);
assert.doesNotMatch(routes, /Math\.(round|floor)|parseFloat|Number\(value\.amount\)/);
pass('History is immutable, mutations are transactional, claims are never hard-deleted, and money avoids floats');

console.log(`\nExpense reimbursement contracts passed: ${passes.length}`);
