# Walking Through Stanza's Architecture

This walkthrough follows real Stanza code from a user action to PostgreSQL and
back. It assumes familiarity with React, Express, and SQL.

## 1. The application starts in layers

`src/main.tsx` is deliberately small. It initializes persisted appearance and
navigation preferences before React paints, then mounts
`StanzaPreferencesProvider`. It also registers `service-worker.js` only in a
production build and unregisters a stale Stanza worker during local Vite work.

`src/App.tsx` is the application routing boundary. Stanza does not currently use
a route framework for its small set of top-level states. App recognizes public
QR URLs, checks `/api/auth/session`, and then chooses Login, Signup, Reset
Password, or the lazy Dashboard. `ThemeProvider` and `LanguageProvider` wrap all
of those branches. Shared identity shapes live in
`src/auth/auth-contract.ts`; pages do not import types from App itself.

Why this matters: importing `AuthUser` from App previously made Login point back
to the component that imports Login. The pure contract removes that cycle and
makes ownership explicit without adding runtime code.

## 2. Dashboard chooses a workspace without loading every feature

`src/navigation/workspace-registry.ts` defines stable workspace metadata. For
example, the Resignations entry connects:

- workspace ID `resignations`;
- translation key `dash.resignations`;
- administration navigation group;
- attention key `resignations`;
- Help article and tutorial IDs;
- search aliases.

It does **not** import `ResignationsPanel`. In `Dashboard.tsx`, that panel is
loaded with `React.lazy(() => import(...))`. The navigation-owned
`useDashboardWorkspaceNavigation` combines static descriptors with current
capabilities, badge counts, and active state. This keeps permission-sensitive
visibility dynamic while the registry remains deterministic and lightweight.

The same stable IDs feed Launcher Only navigation, Compact Rail, mobile
shortcuts, command search, usage history, Help, and tutorials. Backend permission
checks still run independently when an API request arrives.

## 3. A resignation request from click to response

The rendered UI is `src/components/resignations/ResignationsPanel.tsx`. It owns
its form, loading state, update state, and API errors. Clicking Submit calls:

```text
apiFetch(apiUrl('/api/resignations'), { method: 'POST', ... })
```

`apiFetch` in `src/lib/api.ts` always includes browser credentials, so the
HttpOnly session cookie travels without exposing the session token to React.

In `server.ts`, `registerResignationRoutes` is mounted at the same point where
the embedded routes used to be. The POST pipeline is:

```text
standard session authentication
  -> resignations.create middleware (with retained compatibility roles)
    -> payload/date validation
      -> withTenant(tenantId, transaction callback)
        -> pending-request conflict check
        -> INSERT resignation_requests
        -> INSERT audit_logs
        -> INSERT outbox_events
      -> 201 JSON response
```

The registrar is in
`src/server/resignations/resignation-routes.ts`. It keeps the route, SQL,
response, audit, and notification behavior together because they are one domain
operation. It does not add a controller class just to relay parameters.

## 4. What middleware and a handler each own

The session middleware still has the legacy local name `demoAuth` in
`server.ts`; despite the name, it validates the standard server-managed session.
Extracted registrars receive it as `standardAuth`. It establishes
`req.authUser` and `req.authSessionId`.

`requirePermission` checks a permission claim already loaded into the session.
The common predicate is `hasPermissionClaim` in
`src/server/auth/permission-claims.ts`. That helper intentionally does not decide
department/team/direct-report scope.

Scope-aware domains call
`src/server/organisation/scoped-permissions.ts`. Its result includes whether the
action is allowed plus the authority source and resolved scope. Leave approval,
roster goals, organisation operations, and similar workflows can therefore
explain and audit why an actor was authorized. Simple self-service routes do not
pay for a hierarchy abstraction they do not need.

## 5. Tenant context and RLS

`withTenant` in `src/lib/hr-background.ts` acquires a pool client and runs:

```sql
BEGIN;
SELECT set_config('app.current_tenant', $1, true);
-- domain SQL
COMMIT;
```

It rolls back on failure and always releases the client. The third argument to
`set_config` is transaction-local, so tenant context cannot leak into the next
pool borrower. Migrations under `src/db/migrations` enable RLS and define policies
against `app.current_tenant`. Explicit `tenant_id` predicates and composite
foreign keys remain in domain SQL as defense in depth.

Do not call `getDbPool().query(...)` for tenant records when the operation should
run through RLS. Do not accept a tenant ID from a browser payload as authority;
use the authenticated session's tenant.

## 6. Domain operation versus database query

Stanza keeps raw SQL visible. A domain operation is the transaction callback
that coordinates workflow rules and SQL, not a generic repository object.
Examples:

- shift swap application locks the request and shifts, revalidates conflicts,
  changes assignments, records history, and emits notifications atomically;
- leave review locks a pending request and writes the decision, audit, and
  notification in one transaction;
- resignation submission checks the one-pending-request rule before inserting.

Small read routes can query directly inside `withTenant`. A service is warranted
when logic is reused or coordinates several records, such as
`QrTokenService`; it is not required for a one-query projection.

## 7. React hooks and contexts

Contexts carry truly broad state:

- `LanguageContext` resolves English/Arabic strings and direction;
- `ThemeContext` controls light/dark behavior;
- `StanzaPreferencesContext` persists visual preset, navigation mode,
  shortcuts, interface scale, and tutorial preferences.

Feature request state stays local. `useDashboardAttentionCounts` is a hook
because several navigation surfaces consume one bounded polling lifecycle. It
keeps an AbortController, preserves count object identity when values are
unchanged, refreshes only when visible/online, and cleans up listeners and its
interval. It does not authorize access to the underlying records.

## 8. Lazy imports and heavy subsystems

Dashboard's source-level lazy boundaries keep MapLibre, Three/Rapier, the GLB,
the rich editor, and large feature panels out of the initial app path. The
lanyard is a self-contained lazy subsystem under `src/components/lanyard`; its
physics and render loop do not belong in Dashboard or the workspace registry.
Locations loads MapLibre only when its map is needed. Help mounts the selected
article and active tutorial rather than all hidden content.

When adding registry metadata, add only strings and small enums. Never put a
component loader in `WORKSPACE_REGISTRY`: doing so would turn navigation metadata
into a bundle dependency graph.

## 9. Audit and background work

Most sensitive synchronous workflows write `audit_logs` in their transaction.
`recordAuditEvent` centralizes safe metadata handling for extracted domains.
The `outbox_events` table records notifications that must follow committed
state.

BullMQ work is wired in `src/lib/hr-background.ts` and consumed by
`src/workers/hr-worker.ts`. Current jobs include attendance daily rollups, queued
audit writes, and QR token expiry. Each tenant job carries a tenant ID and the
worker re-enters `withTenant` before SQL. The web process can run without moving
ordinary request logic into an event bus.

## 10. Public routes and exceptions

`PublicEmployeeVerification` and `PublicAssetVerification` are intentionally
outside the authenticated Dashboard. Their server routes accept opaque,
revocable QR tokens and return minimized public projections. They are not an
exception to tenant isolation: the token service resolves the tenant-owned token
record and enforces purpose, expiry, and revocation.

Static avatar/evidence files are another explicit exception to ordinary JSON
routes. Their mounts use bounded directories and cache/header policies; upload
routes remain authenticated, validate decoded image dimensions and formats, and
never expose filesystem paths.

## 11. How to extend Stanza safely

For a new workflow:

1. define the permission in the fixed permission registry and migration;
2. add tenant-scoped tables, composite references, indexes, and RLS;
3. create a server domain registrar using standard auth, scope checks, and
   `withTenant`;
4. keep mutations, audit, and outbox work atomic;
5. create a feature-owned lazy panel and local request state;
6. add static workspace, Help, and tutorial metadata only if it is a top-level
   workspace;
7. add behavioral and cross-tenant tests;
8. run `test:architecture` to catch cycles, boundary reversal, or lost lazy
   loading.

The next maintainability work should continue extracting complete legacy
vertical slices from Dashboard and `server.ts`. Avoid splitting a workflow so
its state moves but its behavior still depends on private shell internals.
