# Northstar Systems demo seed

The seed populates only the positively identified `stanza-demo` tenant. All people, company stories and monetary amounts are fictional. No email is sent. Existing demo passwords are preserved; no credentials are stored in this document.

## Accounts and company

| Account | Fictional person | Experience |
| --- | --- | --- |
| admin@stanza-demo.com | Nadia Farouk | HR Admin, HR Morning workspace |
| manager@stanza-demo.com | Omar Mansour | Engineering manager, four direct reports, Team Overview |
| employee@stanza-demo.com | Sarah Hassan | Engineering employee, My Day |

There are 24 employees (23 active and one terminated), eight departments, eight teams and 23 titles. Departments are Executive, Human Resources, Engineering, Product, Finance, Operations, Sales & Success, and IT. Cairo HQ and Alexandria Office have valid 300 m PostGIS boundaries. The older Headquarters location remains for existing records.

Sarah reports to Omar, has nine recent completed shifts, a laptop and access card, approved historical and pending future leave, a completed accessibility goal/task, two expenses, two fictional grievances and a completed loan. Other employees provide contrasting manager, HR, payroll, operations and new-hire examples.

## Guarded commands

Apply current migrations first. Configure DATABASE_URL and DEMO_PASSWORD privately in the local environment. DEMO_PASSWORD must be at least 12 characters and applies only to newly created accounts. Existing hashes are never replaced.

Example PowerShell configuration for the inspected local database:

```powershell
$env:NODE_ENV='demo'
$env:STANZA_DEMO_ENV='true'
$env:ALLOW_DEMO_DATA_MUTATION='true'
$env:ALLOW_TEST_DATA_MUTATION='true'
$env:DEMO_DATABASE_NAME='horizon_hr'
$env:DEMO_DATABASE_ALLOWLIST='localhost:5432/horizon_hr'
# Required only for the inspected legacy tenant lacking an is_demo_tenant column:
$env:DEMO_TENANT_ID='f1d48ba8-7ef6-4cff-b9f6-abc38efaa7dd'
# Configure DEMO_PASSWORD privately; do not commit it.
npm run db:seed:demo
npm run db:seed:demo
npm run test:demo-seed
```

Use a separate terminal for these seed overrides. Production NODE_ENV is refused. The database must match DEMO_DATABASE_NAME and an explicit database allowlist. Tenant identification additionally requires reserved slug stanza-demo and a positive demo marker, or the exact explicitly configured legacy UUID when that marker column is absent. A false marker always refuses. A mismatching UUID refuses. New tenants require the current marker migration and default to EGP; the existing tenant's currency and attendance/loan policies are preserved.

For reset, additionally set `DEMO_RESET_CONFIRM=stanza-demo`, then run `npm run db:reset:demo`. The same environment and tenant guards apply. Reset does not reset passwords.

## Architecture and reconciliation

`scripts/seed-demo.ts` orchestrates domain helpers under `scripts/demo/`: core, organisation, attendance-leave, finance-assets, hiring-goals, cases-communications and reset. Dependency order is tenant/catalogue, roles, employees, organisation, attendance, leave, finance/assets, hiring/goals/reviews, cases, communications/feed and manifest.

One transaction and a shared advisory lock cover the entire seed/reset. Failure names the phase and rolls back all changes. The tenant RLS context is set explicitly; constraints, triggers and RLS are not disabled. The shared permission catalogue is read-only and missing registry permissions require migrations. Custom roles use only known, delegatable, unprotected permissions. Built-in assignments for known fixtures are reconciled, including stale Manager access on the regular Employee account. Custom/manual assignments are preserved.

Stable SHA-256-derived UUIDs identify owned fixtures. Natural keys reuse existing identities, titles, teams, locations, geofences, active compensation and payroll periods. A tenant audit manifest records owned IDs. Same-day reruns preserve counts and relationships. Rolling attendance sources and their derived summaries are refreshed without deleting manual attendance. Existing manual shift overlaps are retained and prevent contradictory fixture shifts. Lunch requests linked to removed fixture breaks are also removed before bounded regeneration; pending fixture requests retain stable IDs.

Dates use a UTC midnight seed anchor: previous 14 days for attendance, Friday/Saturday weekends, relative past/future leave and meetings, and the last complete calendar month for payroll. Payroll payment timestamps start at the current month boundary. Immutable grievance history keeps its original timeline until fixture reset. No randomness is used.

## Seeded modules

| Domain | Current fixture counts / coverage |
| --- | --- |
| Roles | Three built-ins plus Recruitment Coordinator, Payroll Specialist, Operations Supervisor |
| Attendance | 222 completed source shifts on this seed date; on-time, late, early departures and a scheduled absence |
| Breaks | 446 paid/unpaid/exception records; 224 requests including two pending; production rollup SQL |
| Leave | Seven requests: three pending, three approved, one rejected; eleven history entries |
| Assets | 26 assets, 23 assignment records; available, assigned, maintenance and returned assignment |
| Expenses | Six claims; pending, approved, rejected, reimbursed; eleven lifecycle history entries |
| Compensation / payroll | 24 active profiles, 22 paid prior-month records; salary + bonus - deduction = net |
| Loans | One active and one paid loan with five reconciled repayments, only when company loans are enabled |
| Hiring | Twelve current candidates using canonical stages; two each in New, HR Review and Final Review; 49 stage events, 14 notes |
| Performance / tasks | Eleven performance goals and updates, eleven roster tasks; one cycle/template/question, three draft reviews, six assignments, three responses |
| Grievances | Six cases across submitted, assigned, in progress, waiting, resolved and confidential; twenty events, twelve messages |
| Communications | One template, three draft/simulated sent/failed messages, three scheduled/completed/cancelled meetings |
| Feed | Six published posts with explicit all-employee visibility relations |
| Outbox / audit | Three already-processed, suppressed in-app examples; six clearly tagged audit events plus one ownership manifest |

The existing USD tenant uses a fixed fictional USD price cohort; fresh EGP fixtures use the documented EGP amounts. This is fixture pricing, not exchange-rate conversion or new accounting logic. Stored finance values and current tenant default currency agree. Loans are skipped when disabled. Required geolocation uses valid locations; optional mode can include unavailable/outside examples; disabled mode omits coordinates. No active attendance shift is fabricated.

Known legacy welcome/hiring seed rows and recognizable hiring integration examples are archived, not deleted. Legacy/manual demo records outside the ownership manifest remain and may appear alongside the new fixtures.

## Queue safety and privacy

The seeder imports no delivery queue and invokes no provider. Simulated sent/failed records state in their subject, body, provider ID and event code that no delivery occurred; no delivered state is invented. No queued/sending message or unprocessed seed outbox is created. Meeting fixtures have no invitation jobs. Internal grievance notes and confidential cases retain existing server visibility and role checks; the employee UI exposes only their public conversation.

## Workspace Composer

The existing browser-local preference store bootstraps HR Morning, Team Overview or My Day only for authenticated users of stanza-demo without saved preferences. Each widget passes the existing permission check. Existing saved layouts always win; non-demo users retain existing defaults. No server workspace schema, observer, polling loop or recurring worker is introduced.

## Reset contract

Reset deletes only allowlisted manifest IDs in FK order, including transactional/derived fixture data and newly created fictional staff. The tenant and three primary login identities/passwords remain. Built-in roles, shared catalogues, schema, tenant settings, legacy data and unowned manual rows remain. Append-only grievance children are deleted only by their legitimate parent cascade. FK references from manual data that prohibit fixture deletion abort and roll back reset rather than discarding that manual data. Reset is therefore intentionally narrower than the previous whole-tenant wipe. Browser-local Composer layouts remain.

The seed test executes the real reset service inside a transaction and rolls it back, preserving the demo for browsing. This verifies ordering/scope without leaving the demo empty.
