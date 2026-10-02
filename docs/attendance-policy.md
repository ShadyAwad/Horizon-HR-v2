# Flexible attendance

Apply `src/db/migrations/20260928_flexible_attendance.sql` before deploying the server/worker/frontend together. Fresh schema installs include the same extension.

Existing tenants default to `required`: missing coordinates or an out-of-geofence point still fail. `optional` attempts location in the UI but permits missing/outside locations, recording their status. `disabled` neither requests coordinates in the UI nor stores submitted coordinates. Clock-in snapshots the mode and location status and writes a transactional audit. Existing `/api/clock-in`, `/api/clock-out` and `time_logs` remain authoritative.

Company-scoped `attendance.policy.manage` is granted to the HR Admin system role. Configure it in Geo Operations → Company attendance policy. Break entries are tenant-defined, with 5–180 minute planned durations, optional per-shift usage limits, approval, paid and active settings. Deactivation retains historical references. Custom breaks and unfiled pauses have separate tenant switches.

Requests are approvals; attendance_breaks are actual intervals. Policy entries without approval auto-approve their requests. Approval-required policy entries always need an approved request, even when unfiled custom pauses are permitted. Any permitted pause without a request persists an unfiled exception when allowed. Employees resolve completed exceptions with a reason; managers see them only within their permission scope. Approved requests can be consumed once. Clock-out closes an active break atomically. Actual elapsed break time is never capped to the planned duration. Unpaid breaks are deducted from attendance worked/credited minutes. Paid breaks retain attendance credit. Total break duration includes both. The paid flag is snapshotted at start, so editing a policy never rewrites historical calculations. Payroll/performance currently do not consume these totals.

History groups shifts by employee and UTC clock-in date. Overnight shifts belong to their start date, matching the existing rollup convention. Open-shift history is a live snapshot; daily rollup worked totals continue to include completed shifts only. History is date-bounded to one year and paginated in 100 complete employee/day rows, with employee, state, location and exception filters. Team/history visibility uses scoped permissions, not role labels. Poll-free refresh is explicit; the active-break elapsed display updates every 30 seconds only while visible.

The daily worker subtracts break intervals and records total_break_minutes. Every rollup request gets an independent job; the worker serializes each employee/day and performs an idempotent upsert. Restart the worker with the deployment. Run the rollup for any historical dates that require a refreshed summary.

Validation:

```powershell
npm run lint
npm run build
npm run test:attendance
# Against an isolated local PostgreSQL/Redis-backed production preview on port 3003:
$env:NODE_ENV='test'
$env:ALLOW_TEST_DATA_MUTATION='true'
$env:TEST_DATABASE_ALLOWLIST='<isolated database name>'
$env:ATTENDANCE_TEST_BASE_URL='http://localhost:3000'
npm run test:attendance:integration
```

The integration suite creates and removes two isolated fixture tenants. Its RLS probe creates a temporary NOLOGIN role inside a rolled-back transaction, so its database test account requires role-creation authority. Never run it against production. No real employee shifts or tenant policies are used as fixtures.
