# Payroll QA checklist

Run the application with a local database and use a dedicated HR-admin account.
The Payroll tab supports active compensation profiles, employee loans, payroll
generation, approval, payment confirmation, and PDF statements.

## Expected workflow

1. Save one active compensation profile for the target employee.
2. Optionally create an active employee loan with a positive principal and a
   repayment amount.
3. Run payroll with an end date after the start date. Employees without an
   active profile are skipped unless a fallback base salary is supplied.
4. A draft payroll record may be re-run for the same employee and period;
   it updates the draft without applying loan deductions twice.
5. Approve the draft, then mark it paid. Finalized records cannot be re-run,
   which prevents an approval or payment from being reset to draft.
6. Export the PDF from the record's action button.

Expected validation and authorization responses are `400`, `401`, `403`,
`404`, or `409`. Invalid IDs, invalid periods, and malformed amounts must not
produce `500` responses.

## Useful database checks

Run these against the local database with a known tenant ID.

```sql
-- Recent payroll and approval state
SELECT employee_id, pay_period_start, pay_period_end, base_salary, deductions,
       net_pay, currency, status, approved_at, paid_at
FROM payroll_records
WHERE tenant_id = '<tenant-uuid>'
ORDER BY generated_at DESC;

-- Only one active compensation profile per employee
SELECT employee_id, COUNT(*) AS active_profiles
FROM employee_compensation_profiles
WHERE tenant_id = '<tenant-uuid>' AND is_active = true
GROUP BY employee_id
HAVING COUNT(*) > 1;

-- Loan balances and payroll-linked repayments
SELECT loans.employee_id, loans.loan_name, loans.outstanding_balance,
       loans.status, payments.payroll_record_id, payments.amount
FROM employee_loans AS loans
LEFT JOIN employee_loan_payments AS payments ON payments.loan_id = loans.id
WHERE loans.tenant_id = '<tenant-uuid>'
ORDER BY loans.created_at DESC, payments.created_at DESC;

-- Cross-tenant records should never appear for an authenticated tenant scope
SELECT tenant_id, COUNT(*)
FROM payroll_records
GROUP BY tenant_id
ORDER BY tenant_id;
```

For automated validation, run `npm run test:smoke` with a dedicated local
HR-admin fixture and `npm run test:security` with optional employee credentials.
