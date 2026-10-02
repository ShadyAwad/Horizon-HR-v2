# Stanza

Stanza is a multi-tenant workforce operations application built as a React/Express modular monolith. It supports attendance and breaks, leave/rosters, employee organisation and roles, hiring, expenses/payroll, equipment, performance goals, grievance cases, a company feed and private Communications workflows. Workspace Composer presents authorized summaries of those modules.

The project is a portfolio application with fictional demo data. Its security boundaries and deployment requirements are explicit; it is not a claim of certification or operational readiness for real employee records.

## Architecture and stack

- React 19, TypeScript, Vite and Tailwind CSS; lazy-loaded feature modules, bilingual English/Arabic UI and RTL support.
- Express with cookie sessions, same-origin mutation protection and centralized permission/scope checks.
- PostgreSQL/PostGIS, parameterized SQL, composite tenant foreign keys and tenant-context RLS.
- Redis/BullMQ and a separate worker for attendance rollups, audits and Communications dispatch; Resend is optional for email.
- Lexical for validated feed documents, WebAuthn for passkeys, private filesystem upload storage, and a demand-rendered Three/Rapier identity badge.

[Architecture](docs/architecture.md) maps domain ownership. The [request walkthrough](docs/architecture-walkthrough.md) follows frontend, API, tenant context and database execution.

## Local setup

Use Node.js 22.12 or newer, npm, PostgreSQL 15 or newer with PostGIS available, and Redis. Create an isolated local database, then:

```powershell
npm ci
Copy-Item .env.example .env
```

Configure DATABASE_URL privately. Set APP_BASE_URL and WebAuthn origin/RP ID for the browser origin; leave VITE_API_BASE_URL empty for same-origin requests. Redis defaults to 127.0.0.1:6379; REDIS_URL overrides host/port. Email and extraction adapters are optional. Secrets belong only in the ignored environment, never in VITE_ variables.

For a fresh database, apply the bootstrap schema, then the migrations. Existing databases need only the migration command. Stop the application and back up existing databases first:

```powershell
psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -f src/db/schema.sql
if ($LASTEXITCODE -ne 0) { throw "Bootstrap failed" }
npm run db:migrate
```

The runner sorts dated filenames and resolves the same-day shift-swap dependency explicitly; plain alphabetical order is insufficient. Migration history remains separate and additive. It stops on the first error and rolls back that file's transaction.

Back up existing databases before deployment migrations. The application does not run migrations automatically. Restart server and worker together after schema changes. The bootstrap currently omits some domain tables, so fresh installs also require `npm run db:migrate`. Test migrations only on disposable databases; do not reset a development database merely to simulate installation.

## Running the application

| Command | Behavior |
| --- | --- |
| npm run dev | Express APIs + Vite middleware/HMR and the BullMQ worker; default localhost:3000 |
| npm run dev:server | Express/Vite only, using Node watch with the tsx loader; asynchronous processing needs a worker |
| npm run dev:worker | Worker only, using the same watcher/loader; configured PostgreSQL and Redis required |
| npm run build | Bundles browser assets and dist/server.cjs |
| npm start | Runs the built full-stack server with production configuration |
| npm run preview:full | Builds, then starts the full-stack production preview |
| npm run preview:frontend | Vite static preview, default localhost:4173; no backend or worker |
| npm run preview | Compatibility alias for preview:frontend |
| npm run clean | Removes only generated dist and legacy server.js |

Production preview serves frontend and APIs on one origin. Run the worker separately. For an alternate local port, set PORT, APP_BASE_URL and WEBAUTHN_ORIGIN to the same port; keep localhost as RP ID. Do not mix a frontend-only preview with API/session verification.

## Tests

`npm run lint` checks TypeScript and `npm run build` verifies production bundles. CI runs infrastructure-free logic, source-contract and lifecycle tests; [CI documentation](docs/ci.md) explains the boundary. Domain scripts are listed in package.json. `npm run test:migrations` creates and removes a uniquely named temporary database and verifies bootstrap, replay and demo integrity; it requires CREATE DATABASE permission. `npm run test:integration` adds isolated database/Redis/HTTP suites and fresh production servers, requires a completed build, and uses no existing demo accounts. `npm run test:smoke:isolated` runs the same temporary-database setup with backend smoke and reliability checks only. Both require the test mutation guard and an explicit allowlist for the administrative connection.

Database/HTTP/Redis integration suites require disposable fixtures, a running configured server when specified, NODE_ENV=test, ALLOW_TEST_DATA_MUTATION=true and an explicit TEST_DATABASE_ALLOWLIST. HTTP targets must also pass the local/allowlist guard. Never use production credentials or run mutation suites on production. [Security testing](docs/security-testing.md) covers session and tenant checks.

Attendance, Communications and grievance suites create disposable tenants and use real database/queue behavior with fake email providers. Fixture cleanup runs on failure. The demo integrity suite intentionally reconciles the known demo tenant and probes reset in a rolled-back transaction; use its separate demo guard configuration.

## Demo company

[Demo seed operations](docs/demo-seed.md) documents Northstar Systems, the three role accounts, safety flags, stable fixtures, relative dates and reset behavior. Run `npm run db:seed:demo` explicitly after migrations. `seed:demo:organisation` is a compatibility alias for the full guarded seed; it does not restrict fixture scope. Existing account passwords are preserved; new accounts use a privately configured DEMO_PASSWORD. Reset removes owned fixtures while retaining the tenant and primary login credentials. Demo data never grants runtime authority or queues external delivery.

## Security and deployment

Server-side sessions, permissions, scopes and tenant ownership determine access; browser roles/layouts are presentation only. Set the tenant context for RLS inside each transaction, and deploy with a restricted database runtime role. Confidential case notes, private drafts and uploaded files use authorized reads rather than public static paths.

Deploy server, worker, PostgreSQL/PostGIS and Redis together. Use HTTPS and exact origin/passkey configuration; TRUST_PROXY_HOPS must match the trusted proxy topology. Development identity headers and temporary tunnel allowances are refused in production. Mount durable private upload storage and back it up alongside the database. The production health endpoint intentionally returns minimal status rather than internal queue details.

See [Communications](docs/communications.md), [attendance policy](docs/attendance-policy.md), [grievance cases](docs/grievance-case-management.md), [appearance controls](docs/appearance-polish.md), [Workspace Composer](docs/workspace-composer.md), and the [threat model](security-audit/threat-model.md) for domain-specific constraints. Outstanding debt includes the large Dashboard controller and server bootstrap, filesystem/object-storage deployment choices, provider reconciliation, and broader browser/hardware coverage. Legacy auth/catalog foundation code still performs runtime DDL; deployment under a restricted runtime role needs separate privilege verification.
