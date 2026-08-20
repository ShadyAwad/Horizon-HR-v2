# Stanza Architecture

Stanza is a modular monolith: one React application, one Express process, one
worker process, and one PostgreSQL database. Domain boundaries are code
boundaries, not network boundaries. Raw parameterized SQL and PostgreSQL RLS are
intentional choices.

## Non-negotiable invariants

- The server is authoritative for authentication, tenant isolation, permissions,
  scope, delegation, and workflow transitions. Client checks only shape UX.
- Authenticated browser requests use the HttpOnly session cookie through
  `apiFetch`; frontend code does not persist bearer tokens.
- Tenant database work runs through `withTenant`, which opens a transaction and
  sets `app.current_tenant` locally before domain SQL runs.
- Domain writes keep their state change, audit row, and outbox row in one
  transaction where the workflow requires all three.
- Feature registries contain static metadata only. They must not import feature
  components or defeat dynamic imports.
- Three/Rapier, MapLibre, rich editor code, and other heavy modules stay behind
  feature-level lazy boundaries.
- Server domains may depend on server infrastructure and domain contracts, never
  browser components. Browser modules may not import server implementations.

## Runtime composition

### Browser

`src/main.tsx` initializes persisted Stanza preferences, mounts
`StanzaPreferencesProvider`, and registers the production service worker.
`src/App.tsx` owns the authentication route state and composes `ThemeProvider`
and `LanguageProvider`. Authenticated users cross the lazy Dashboard boundary;
signup, password reset, and public QR verification each have separate lazy
boundaries.

`src/pages/Dashboard.tsx` is the shell and the remaining compatibility host for
historical inline modules. It owns active workspace selection, global overlays,
navigation composition, PWA state, and shell-wide coordination. Extracted
features own their request and form state under `src/components/<domain>`.

The static `src/navigation/workspace-registry.ts` is the canonical identity map
for Dashboard workspaces. It owns stable IDs, translation keys, groups, aliases,
visibility capability names, attention-count keys, Help IDs, tutorial IDs, and
icon identifiers. It intentionally owns no React state, permission evaluation,
or loader. `useDashboardWorkspaceNavigation` combines that metadata with the
current user capabilities and active state.

### Server

`server.ts` remains the Express composition root and compatibility host for
routes that have not yet been extracted. It establishes middleware in this
order:

1. environment and production safety assertions;
2. proxy trust, compression, Helmet/CSP, and JSON limits;
3. bounded CORS/origin handling and static evidence/avatar mounts;
4. extracted domain route registration and legacy embedded routes in their
   existing Express order;
5. API error handling;
6. Vite development middleware or production static hosting and SPA fallback;
7. listener startup.

The middleware still named `demoAuth` in `server.ts` is the legacy name for the
normal HttpOnly session-cookie authenticator. It is not a demo bypass. New
registrars receive it through a `standardAuth` dependency name.

Extracted route groups live under `src/server/<domain>` and expose a
`register...Routes(app, dependencies)` boundary. Dependencies make security
middleware ordering visible without introducing a DI container. Resignations is
one example: `server.ts` mounts `registerResignationRoutes` at the exact location
formerly occupied by the six embedded routes.

`src/server/auth/permission-claims.ts` owns the simple permission claims already
materialized into an authenticated session. Scope and delegation evaluation is
separate and remains in `src/server/organisation/scoped-permissions.ts`.

### Database and workers

`src/db/schema.sql` is the consolidated baseline. Timestamped files under
`src/db/migrations` are the additive deployment history and own newer domain
tables, constraints, indexes, permissions, and RLS policies. Do not replace raw
SQL with an ORM or infer tenant filtering in the client.

`src/lib/hr-background.ts` owns the PostgreSQL pool, tenant transaction wrapper,
Redis/BullMQ connection, and queue producers. `src/workers/hr-worker.ts` consumes
attendance rollups, queued audit writes, and QR expiry cleanup. Worker payloads
carry tenant IDs and worker SQL re-enters `withTenant`.

## Import direction

The practical dependency direction is:

```text
main/App/Dashboard composition
  -> navigation and feature UI
    -> feature hooks/contracts and shared browser lib

server composition
  -> domain route registrar
    -> domain operation + shared server authorization/audit infrastructure
      -> withTenant + parameterized PostgreSQL SQL
```

Allowed cross-domain dependencies must express a real shared policy. Examples
include Expenses using organisation scope evaluation and QR labels reusing Asset
authority. A route module must never import another domain's route handlers.
Shared types live with their owning domain; only genuinely cross-app contracts,
such as `src/auth/auth-contract.ts`, sit outside a feature.

## Domain map

| Domain | Frontend entry | Server owner | Primary tables | Permission examples | Main tests |
| --- | --- | --- | --- | --- | --- |
| Authentication / sessions | `App`, Login, Profile session panels | `server.ts` auth compatibility routes | `employees`, `auth_sessions`, WebAuthn/reset tables | authenticated self, `sessions.manage` | `security-test`, `sessions-test` |
| Attendance / breaks | Dashboard Geo Operations | embedded attendance routes, worker rollup | `time_logs`, `break_requests`, `attendance_daily_summaries`, geofences | `attendance.clock`, `attendance.view_live`, `break_requests.review` | `security-test`, `smoke-test`, `live-employees-test` |
| Roster / swaps / goals | Dashboard schedule, `components/roster` | embedded roster routes, `server/roster` | `roster_shifts`, shift swap/history tables, `roster_goals` | `roster.manage_scoped`, `roster.swap.approve`, `roster.goals.manage` | `shift-swaps-test`, `roster-goals-test` |
| Leave | `LeaveWorkspace` | `server/leave` | `leave_requests`, history/conflicts | `leave.request.self`, `leave.view.scoped`, `leave.approve` | `leave-test` |
| Locations | `LocationsPanel` | `server/locations` | `company_locations`, `geofences` | `locations.read`, `locations.manage`, `geofences.manage` | `locations-test` |
| Organisation | `OrganisationPanel` and subpanels | `server/organisation` | departments, teams, memberships, titles, roles, assignments, delegations | `organisation.view`, `hierarchy.manage`, `roles.manage` | `organisation-test`, concurrency test |
| Hiring | `HiringPanel` | `server/hiring` | applicants, notes, handoffs, stage history | `hiring.view`, `hiring.assign`, `hiring.make_final_decision` | `hiring-rules-test`, integration test |
| Expenses | `ExpensesPanel` | `server/expenses` | `expense_claims`, claim history, extraction jobs | `expenses.submit.self`, `expenses.approve`, `expenses.reimburse` | `expenses-test`, document extraction test |
| Performance | `PerformancePanel` | `server/performance` | review cycles/templates/reviews, goals, recognitions | `performance.view`, `performance.review`, cycle/goal permissions | `performance-test` where present; security contracts |
| Assets | `AssetsPanel`, `MyEquipmentPanel` | `server/assets`, QR label registrar | assets, assignments, condition reports, software licenses | `assets.view`, `assets.assign`, `assets.return` | `assets-test`, `qr-test` |
| Company Feed | Dashboard feed and lazy editor/renderer | embedded feed routes | posts, visibility, drafts, images | `feed.read`, `feed.publish` | editor, feed submission, company-feed draft tests |
| Employee relations | Dashboard grievances, lazy `ResignationsPanel` | embedded grievance routes, `server/resignations` | `grievances`, `resignation_requests` | create/review/process permissions | security, smoke, architecture contracts |
| Payroll | Dashboard payroll/profile views | embedded payroll routes | payroll, compensation, loans/payments | view/run/approve/mark-paid permissions | security and smoke tests |
| Audit | `AuditTrailPanel` | `server/audit` | `audit_logs`, `outbox_events` | `audit.view` | `audit-test` |
| QR / public verification | badge and asset label panels, public pages | `server/qr` | `qr_access_tokens` plus referenced domain records | QR issue/revoke permissions plus domain authority | `qr-test`, PWA/security tests |
| PWA / Help / tutorials | `main`, prompt, `components/tutorials` | static hosting and service worker | none | workspace visibility only; server still authorizes APIs | PWA, navigation, tutorial, theme tests |

## State and effect ownership

- Contexts are reserved for language, theme, and persisted user preferences.
- A feature panel owns its loading, form, mutation, and retry state once it is
  extracted. Resignations no longer contributes those states or its fetch effect
  to Dashboard.
- Dashboard effects synchronize external shell concerns: visibility, network,
  PWA installation, navigation/deep links, and lazy subsystem capability.
- Effects must not copy derivable values into a second state variable. Derived
  labels, permissions for visibility, and navigation items are computed.
- Request effects own their AbortController/listener cleanup. Expensive inactive
  panels remain conditionally mounted.

## Error and security boundaries

Feature requests show safe API errors. SQL errors are logged server-side and
responses use bounded messages. The Company Feed and lanyard retain local error
boundaries so failures cannot blank the Dashboard. Express route modules catch
expected validation/business failures and leave secrets, SQL text, filesystem
paths, cookies, and token material out of responses.

RLS is a second boundary, not a replacement for authorization. Route middleware
establishes identity, domain permission/scope checks establish authority, and
`withTenant` establishes database tenant context. Public verification routes are
explicit exceptions: they resolve revocable opaque QR tokens and return minimized
public projections.

## Known residual hotspots

This pass is deliberately incremental. `Dashboard.tsx`, `server.ts`,
`LanguageContext.tsx`, and `index.css` remain large. Dashboard still owns legacy
attendance, roster schedule, payroll, grievances, Company Feed, and profile
workflows; server still embeds their route groups. Those should move one complete
vertical slice at a time, with domain tests, rather than through a bulk rewrite.
The translation catalog is large but cohesive and was not split merely to reduce
line count. Theme CSS and lanyard physics were left unchanged.

## Architecture guardrails

Run `npm run test:architecture` after changing module ownership. It verifies the
workspace/Help/tutorial contract, absence of relative import cycles, browser and
server direction rules, heavy lazy boundaries, auth type ownership, resignation
route ownership/order, and shared permission claims. This complements behavioral
tests; it does not replace them.
