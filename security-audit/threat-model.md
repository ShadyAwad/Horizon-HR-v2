# Stanza Repository Threat Model

## Overview

Stanza is a multi-tenant workforce operations SaaS/PWA. Its React/Vite client talks to an Express API that stores employee, applicant, attendance, geofence, leave, roster, payroll, compensation, loan, grievance, resignation, notification, role, audit, and outbox data in PostgreSQL. Redis and BullMQ support attendance rollups and asynchronous audit work. Resend handles account and recovery email, WebAuthn supports passkeys, MapTiler supplies map data, and local storage currently persists the signed bearer-token user object in the browser.

Primary runtime surfaces are `server.ts`, the Hiring router under `src/server/hiring/`, database helpers and schema under `src/lib/` and `src/db/`, the BullMQ worker under `src/workers/`, the React application under `src/`, and the PWA service worker under `public/`. Scripts and documentation are operational or test surfaces unless they handle production credentials or mutate production-like data.

The most important assets are authentication secrets and bearer tokens; password and passkey credentials; reset/setup tokens; tenant and employee identities; role and permission assignments; payroll, compensation, loan, grievance, resignation, applicant, and HR-only note data; precise attendance and location data; uploaded profile images; audit/outbox integrity; database, Redis, Resend, MapTiler, and WebAuthn configuration; and the ability to perform privileged workflow transitions.

## Threat Model, Trust Boundaries, and Assumptions

### Actors

- Unauthenticated visitors and abusive bots can reach public authentication, workspace registration, password recovery, passkey-login, map-tile, static/PWA, and public profile-image surfaces.
- Employees, managers, HR administrators, and tenant-defined role holders are authenticated but have different ownership and permission boundaries.
- A malicious tenant user may submit arbitrary URL parameters, JSON, multipart data, UUIDs, stage/status values, employee/reviewer IDs, geolocation, and repeated concurrent requests.
- A stolen browser token grants the bearer’s effective account access until expiry because possession is the authentication proof.
- A compromised or malformed BullMQ job may control serialized tenant, employee, date, action, entity, and metadata fields consumed by the worker.
- Operators control deployment environment, PostgreSQL, Redis, Resend, WebAuthn RP/origin, proxy, TLS, and filesystem settings. Developers control source, migrations, test scripts, and build dependencies.

### Trust boundaries

1. Browser to Express API: all headers, bearer tokens, JSON, form-data, query strings, URL parameters, and geolocation values are attacker-controlled until authenticated and validated.
2. Express to PostgreSQL: tenant identity must come from the verified authentication context, and every tenant-owned operation must preserve tenant predicates and transaction-local `app.current_tenant` for RLS.
3. Role/permission resolution: frontend visibility is not authoritative. Every privileged API transition requires server-side permission and object-level checks.
4. Express to Redis/BullMQ and worker to PostgreSQL: job payloads cross an asynchronous trust boundary and must be schema-validated, tenant-scoped, retry-safe, and idempotent.
5. Express/outbox to Resend: email addresses, links, and template fields cross an external provider boundary; tokens and private HR content must be minimized.
6. Upload request to Sharp/filesystem/public media: MIME declarations are untrusted, decoded image resource use must be bounded, filenames must remain server-generated, and served bytes must not execute as active content.
7. Service worker and browser persistence: Cache Storage, localStorage, installed-PWA state, and old service-worker versions survive page transitions and potentially user logout or account changes.
8. Map/geospatial services: tile/provider inputs and device coordinates are untrusted. PostGIS coordinate order and tenant location ownership are security and integrity invariants.
9. Deployment proxy to Express: `trust proxy`, forwarded client IPs, CORS, HTTPS, HSTS, rate-limit identity, and secure-context assumptions depend on correct operator configuration.

### Security invariants

- An authenticated identity must be cryptographically verified, unexpired, mapped to an existing employee in the claimed tenant, and never derived from client-supplied tenant/employee headers in production.
- Tenant-owned rows must be inaccessible across tenants even when an attacker knows valid UUIDs. Tenant predicates, composite foreign keys, and RLS should provide independent layers.
- Employees cannot gain permissions, alter compensation/payroll, access HR-only notes, review their own restricted requests, acknowledge another reviewer’s handoff, or act on objects outside their authorized scope.
- Authentication, reset, setup, and passkey challenges must be unpredictable, short-lived where appropriate, single-use, origin/RP-bound, replay-resistant, and non-enumerating.
- Workflow state changes must use allowed transitions and concurrency controls so duplicate or stale requests cannot produce double clock-ins, overlapping shifts, duplicate payments, contradictory decisions, or repeated notifications.
- SQL syntax, identifiers, sort fields, and geospatial expressions must never be controlled by raw request strings; dynamic fragments require strict allowlists.
- Sensitive API JSON and profile media must not leak through shared caches, logs, error messages, audit/outbox payloads, or another browser user’s persisted state.
- Queue retries must not duplicate durable effects, and tenant context must not leak between pooled PostgreSQL connections.
- Production must fail closed when signing, database, WebAuthn, Redis/TLS, or email configuration required for a security-sensitive feature is absent or unsafe.

### Assumptions and scope

PostgreSQL, Redis, Resend, MapTiler, and the deployment host are assumed not already compromised. Database superuser compromise, malicious source maintainers, physical device compromise, and denial of service requiring infrastructure-scale volumetric protection are outside the application’s direct control, though safe configuration and least privilege remain relevant. Demo credentials are intentionally public only when demo mode is explicitly enabled and isolated from real tenants. Developer scripts become security-relevant if operators run them against production credentials.

## Attack Surface, Mitigations, and Attacker Stories

### Authentication and sessions

The API issues a signed HMAC bearer token containing employee and tenant IDs with a 12-hour expiry. Middleware verifies the signature, expiry, UUID shape, and current database membership before setting `req.authUser`. Passwords support scrypt and bcrypt seed hashes; comparisons use bcrypt or constant-time byte comparison. Password reset hashes tokens and WebAuthn challenges are database-backed, expiring, and consumed. Authentication endpoints have route-specific rate limiters plus an in-memory failed-login lockout.

Relevant attacker stories include credential stuffing, token theft through XSS or local browser access, replay before token expiry, forged development headers when deployment mode is wrong, account enumeration, reset-email flooding, passkey challenge replay, RP/origin misconfiguration, and multi-instance bypass of in-memory rate limits.

### Authorization and tenant isolation

`demoAuth`, `requirePermission`, route-specific ownership checks, tenant predicates, composite tenant foreign keys, `withTenant()` transactions, and RLS are intended to enforce isolation. HR administrators currently receive an explicit server-side permission bypass. High-impact stories include cross-tenant UUID substitution, missing permission middleware, broad legacy role fallbacks, client-controlled actor/owner fields, direct object access to another employee’s private record, and database calls made outside tenant context where RLS is expected to protect them.

### Business workflows and concurrency

Attendance, breaks, leave, roster, payroll, loans, grievances, resignations, notifications, roles, feed, and Hiring each expose stateful workflows. Existing controls include enum/range validation, parameterized queries, transactions, row locks in selected transitions, uniqueness constraints, a roster exclusion constraint, and deterministic attendance-rollup job IDs. Relevant stories include simultaneous clock-ins or payroll runs, stale stage changes, self-approval, duplicate handoffs or outbox events, compensation changes without authority, action on archived/final records, and manager actions outside intended staff scope.

### Input, rendering, SQL, and email

React’s normal text rendering and Lexical JSON reduce direct HTML exposure, while server routes predominantly use parameterized SQL and allowlisted enums. Helmet and production CSP reduce browser injection impact. Risks remain around any dynamic SQL fragments, rich-text JSON interpretation, URLs, translated/user-controlled strings, email HTML templates, notification/audit metadata, and `dangerouslySetInnerHTML` or DOM sinks found during discovery. Profanity masking is not an HTML sanitizer.

### Uploads and public media

Avatar uploads are memory-buffered, limited to 5 MB, MIME-filtered, decoded and converted to fixed WebP output, and written under random UUID filenames. Deletion accepts only owned URL shapes. Public profile images are not tenant-authenticated and are deliberately excluded from PWA caches. Discovery must still assess magic-byte handling, Sharp decode limits/image bombs, metadata stripping, public-link privacy, cache lifetime, replacement races, and orphan cleanup.

### PWA and browser state

The service worker caches only static assets and navigation shell responses. `/api/` and `/profile-images/` are network-only with `no-store`; offline mutations return an explicit error and are not queued. Remaining stories include bearer tokens in localStorage, stale app shells after logout, browser profile sharing, cache poisoning of same-origin static paths, and service-worker update races.

### Background jobs and operations

BullMQ jobs retry with exponential backoff; attendance rollups are upserts with deterministic job IDs, while audit jobs are not inherently deduplicated. The worker applies `withTenant()` before database writes. Relevant stories include forged/stale job payloads, duplicate audit entries, tenant IDs copied from untrusted producer data, sensitive metadata logging, failed-job retention, Redis outages, and missing graceful shutdown/readiness.

### HTTP and production configuration

Express disables its banner, uses Helmet, a production CSP, a CORS allowlist, a 1 MB JSON limit, and route-specific rate limiting. Deployment-sensitive stories include an overly broad `trust proxy` setting, spoofable forwarded IPs, localhost origins retained in production, missing HSTS/TLS assumptions, permissive database TLS certificate validation, source-map publication, absent request timeouts, and critical-secret fallback or startup behavior.

## Severity Calibration (Critical, High, Medium, Low)

### Critical

- Unauthenticated or ordinary-user compromise of arbitrary tenants, production authentication signing secrets, database credentials, or unrestricted payroll/role administration.
- SQL injection or remote code execution reachable from an external request with broad database/host impact.
- A systemic RLS/tenant-context failure that exposes or mutates payroll, credentials, grievances, precise location history, or applicant HR-only notes across tenants.

### High

- Reliable cross-tenant object access limited to a sensitive feature.
- Account takeover through reset/passkey replay, forged production auth headers, weak token signing, or a practical stored-XSS path that steals bearer tokens.
- Unauthorized salary/payroll changes, role escalation, final Hiring decisions, or self-approval of consequential HR workflows.
- Public execution or active-content delivery through profile uploads.

### Medium

- Same-tenant privilege bypass affecting non-public HR records without account takeover.
- Repeatable workflow races causing duplicate shifts, requests, handoffs, emails, audit gaps, or inconsistent state with bounded financial/privacy impact.
- Missing distributed rate limits on expensive or abuse-prone routes, public opaque profile-image privacy exposure, or sensitive operational data in logs.
- Production security-header, proxy, TLS-validation, request-timeout, or cache weaknesses requiring additional deployment or user-interaction conditions.

### Low

- Limited metadata disclosure, non-sensitive account enumeration, stale UI/cache behavior without private data exposure, or abuse that is noisy and readily reversible.
- Defense-in-depth gaps already blocked by independent authentication, tenant predicates, RLS, and database constraints.
- Developer/demo-only weaknesses that cannot reach a correctly configured production deployment.

Repository: target_sha256_f06aa450b0387e8a3a35e364ced8642018d7a4466c05ab3b1ca5d7260148771f
Version: codex-security-snapshot/v1:sha256:4af12dfdc91922e86791b4cad7419ff5deaf19e65892ed36b2547ada2b6cef71
