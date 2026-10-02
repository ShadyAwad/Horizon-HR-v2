# Continuous integration

`.github/workflows/ci.yml` runs npm ci, TypeScript checking, production build and infrastructure-free suites on pushes and pull requests. It uses Node 22, npm's lockfile cache and read-only repository permissions. Failures fail the job; CI does not deploy or use production credentials.

## Test boundaries

Logic/source-contract, DOM/clock mock and lifecycle suites need no external services. Rendering regressions compile current source into an in-memory harness; they do not need historical Git commits or represent Chrome GPU benchmarks. The document-extraction and QR tests use local HTTP mocks and fake providers. Theme includes custom-cursor, so the cursor suite is not duplicated. Live Employees and Performance add HTTP checks only when their integration configuration is supplied.

Attendance integration, Communications, grievances, sessions, hiring integration, authorization and security need PostgreSQL and/or a configured application; queue-processing tests also require Redis. They are excluded from the infrastructure-free CI job. Fixture mutation requires explicit safety guards and a named local database. Communications/session helpers create temporary users and use fake providers; they do not send real email.

Demo integrity intentionally reconciles the known demo tenant. It must be explicitly invoked in a positively identified demo environment and is not part of ordinary CI. Migration checks require authority to create and remove their own temporary database. Production data is never a test fixture.

The infrastructure-free job validates contracts, not deployment readiness, live queue delivery or hardware performance. Integration jobs must separately start services, apply schema/migrations, health-check a server, supply disposable credentials and guarantee fixture cleanup.
