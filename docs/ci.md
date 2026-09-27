# Continuous integration

`.github/workflows/ci.yml` runs on pushes and pull requests: npm ci, lint (TypeScript), production build, and the suites below. Any failure fails the job. It does not deploy, use production credentials, or start PostgreSQL/Redis. setup-node caches npm downloads using the lockfile.

Node 22 is selected from installed dependency requirements: @vitejs/plugin-react requires ^20.19 or >=22.12; sharp requires >=20.9; @simplewebauthn/server requires >=20. setup-node resolves the current Node 22 patch.

## Test inventory

| Classification | Scripts | Notes |
| --- | --- | --- |
| Infrastructure-free; included | hiring, hr-background, assets, lanyard, editor, feed-submission, company-feed, organisation, shift-swaps, roster-goals, leave, theme, locations, pwa, expenses, navigation, tutorials, command-palette, architecture | Pure logic, fixtures, DOM/clock mocks, or static source contracts. hr-background checks job IDs, not Redis delivery. theme also runs custom-cursor. |
| Infrastructure-free default; included | live-employees, performance | Live HTTP checks are opt-in through LIVE_EMPLOYEES_INTEGRATION / PERFORMANCE_TEST_BASE_URL; CI sets neither. |
| Self-contained HTTP fixtures; included | document-extraction | Creates ephemeral local Express listener and mock provider/database; no external extraction API or credentials. |
| Infrastructure-free default; included | qr | Mock-backed local HTTP tests; deterministic test encryption key is generated in code. PostgreSQL concurrency probe only runs with DATABASE_URL, absent in CI. |
| Included through theme | custom-cursor | Avoids running the same suite twice. |
| Integration-only; excluded | smoke, security, authorization, sessions | Need a running configured application and authenticated seeded test users. smoke mutates attendance/break and other test records; security exercises real HTTP/session protections. |
| Requires PostgreSQL and configured app; excluded | audit, hiring:integration | Read/mutate database-backed fixtures, authenticate against the application. |
| Requires PostgreSQL; excluded | organisation:concurrency | Explicitly opted-in destructive concurrency fixture with database safety guard. |

No current test script independently exercises live Redis queue delivery. The application worker and end-to-end job processing require Redis; the included hr-background suite does not.

No included test calls a third-party API or needs external secrets. Live integration suites need local test credentials/configuration, not production credentials.

## Optional follow-up

A separate integration job could use PostgreSQL and Redis service containers, an isolated database, migrations and demo fixtures, throwaway session/QR secrets, and a health-checked application server. That job should explicitly configure each suite's mutation safety guards and clean up fixtures. It is intentionally not added to this minimal workflow.
