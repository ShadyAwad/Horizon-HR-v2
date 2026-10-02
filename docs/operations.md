# Production operations

## Runtime and deployment

Run one long-lived Node web/API instance and a separate BullMQ worker. PostgreSQL/PostGIS is the business-data authority; Redis is queue infrastructure. Place both services on a private network with managed PostgreSQL and Redis, or operate equivalent backed-up services. Cloudflare can provide DNS, HTTPS and a front door/tunnel to the web runtime. Cloudflare Workers are not the execution target for this persistent Express/BullMQ application.

Authentication rate limits remain process-local and reset on restart. Expired entries are pruned and the failed-login map has a fail-closed capacity bound. Keep WEB_REPLICAS=1, including during rolling deployment; use a stop/start or traffic-drained deployment. Multiple replicas require shared security limiters before rollout. Redis must support BullMQ commands, persistent connections, noeviction and appropriate persistence; do not use a REST-only Redis endpoint.

## Configuration and rollout

Supply configuration through the platform secret manager, never the image. Production startup validates database/Redis configuration, canonical origin, passkey origin/RP ID, QR encryption key, proxy hops and absolute durable upload paths. Email is optional: either omit both RESEND_API_KEY and EMAIL_FROM or configure both. Without email, delivery operations remain unavailable; do not treat them as successful. Sessions use random opaque tokens whose hashes are stored in PostgreSQL; there is no JWT signing secret.

Use DATABASE_SSL=true with validated certificates for hosted PostgreSQL; DATABASE_SSL_CA may contain a private CA. Use DATABASE_SSL=false and DATABASE_ALLOW_PLAINTEXT=true only inside an isolated private network. Pool defaults are 10 connections per process, 3-second acquisition, 30-second idle expiry and 15-second statement timeout. Include web, worker and migration pools in the database connection budget. Legacy auth/catalog foundation code still performs runtime DDL. Verify a restricted runtime database role before handling real records; move remaining bootstrap DDL into the migration job rather than granting the application superuser privileges.

Build once with npm ci and npm run build. The same image contains web, worker and migration entrypoints. A new database first needs src/db/schema.sql applied with psql ON_ERROR_STOP; then run node dist/migrate.cjs as one separately authorized migration job. Existing databases need only the migration job. It holds a PostgreSQL advisory lock; no web replica automatically migrates. Remove SSL URL query overrides when using DATABASE_SSL so the explicit certificate-validation policy remains authoritative. Roll out services only after the migration job succeeds. Migration history remains dated and replayable; back up before changing schema. Roll back an application image only while its schema contracts remain compatible.

Start web with npm start (or node dist/server.cjs under NODE_ENV=production); start worker with npm run start:worker (or node dist/worker.cjs). The runtime image runs as a non-root user. Override its web healthcheck for a worker-only container; monitor worker startup and job completion/failure logs instead of probing a nonexistent HTTP port. Set the supervisor termination grace period above 15 seconds. Each process drains once on SIGTERM/SIGINT; workers pause acquisition, allow active jobs up to eight seconds and force-close Redis sockets before the 15-second process deadline; fatal exceptions/rejections drain and exit nonzero. The supervisor must restart failures.

## HTTPS and proxy boundary

APP_BASE_URL and WEBAUTHN_ORIGIN must identify the public HTTPS origin; WEBAUTHN_RP_ID must match its host or parent domain. Plain HTTP is accepted only for localhost smoke/preview work. Set TRUST_PROXY_HOPS to the exact path length (0 for direct access). Prevent direct public access to the origin whenever hops are trusted, and ensure the ingress overwrites forwarding headers. Variable-length proxy paths need an address-based trust policy before deployment. Never accept client-supplied forwarding headers as an alternative topology.

Cookies are HttpOnly, SameSite=Lax and Secure for public hosts. Localhost remains usable without HTTPS. Same-origin mutation checks and revocation remain required. The worker removes expired/revoked sessions older than 30 days in bounded tenant batches every hour; retain audit history separately.

## Health and logs

/api/system/live checks process liveness. /api/system/ready checks PostgreSQL, critical table presence and Redis; it returns 503 during dependency failure or drain without infrastructure details. This table check is a minimal schema guard, not proof that every migration column is current. The legacy /api/system/health remains compatible; it is not a production readiness probe. Development health may include queue diagnostics; production does not expose them.

Every request receives a generated X-Request-ID; upstream values are ignored. JSON request logs include method, matched route template, status and duration, never URL query/body or identity data. Error logs include operation, bounded error code and request correlation ID. Keep logs access-controlled and use bounded retention. Alert on sustained readiness failure, pending background.hr outbox rows, failed BullMQ jobs, communications failed/reconciliation-required states and absent worker completion activity.

## Queue failure and recovery

HR dispatch persists background.hr outbox rows before Redis enqueue. Redis failure leaves durable pending work; the worker periodically re-enqueues pending rows. Attendance rollups are source-derived/idempotent, QR expiry is also enforced at token validation, and audit dispatch records are locked/marked transactionally to avoid duplicate audit inserts on retry. Terminal failures require operator review/retry; successful work marks its outbox record processed. Keep Redis persistence enabled, and investigate queue loss rather than treating Redis as authoritative.

Communications uses persisted message states and deterministic job IDs. Required enqueue failures return a failed/deferred outcome instead of claiming delivery. A sending message whose provider outcome is uncertain requires reconciliation before resending; do not replay such messages automatically. Notifications in other outbox event types are not consumed by the HR recovery dispatcher. No external email is needed for operations tests.

## Private files and R2

Mount durable writable storage at all four configured upload directories. Back up profile images, feed images, asset evidence and grievance attachments. Private APIs authorize tenant/domain access before reading and use private/no-store responses. Grievance keys are randomized, traversal-checked, and MIME/size validation remains server-side. Public avatar behavior is intentional and unchanged.

The grievance storage contract accepts private local storage or an injected object transport. R2 is a suitable future transport through its authenticated S3-compatible API (region auto). Keep r2.dev and public custom-domain access disabled, scope server-only credentials to the bucket, and use a separate prefix/bucket per environment. R2 credentials and an S3 transport are not configured or remotely verified here; the shipped backend remains durable filesystem storage. Existing keys must be migrated deliberately before swapping a backend. Do not expose signed/object URLs without repeating authorization. Object deletion must follow database lifecycle policy; do not expire grievance attachments merely because they are old.

## Backups and restoration

Adopt a declared RPO/RTO before handling real records. A starting policy is daily encrypted PostgreSQL backups retained 30 days, weekly backups retained 12 weeks, and provider PITR/WAL archiving where available. Back up durable file volumes on the same schedule with versioning or immutable retention. Keep copies in a separate account/location with restricted access. Redis AOF/persistence improves queue recovery but does not replace database backups.

Quarterly, restore PostgreSQL and matching file snapshots into an isolated environment, verify migration compatibility, login, tenant boundaries, private attachment retrieval and finance/attendance integrity. Disable email and outbound delivery during restore exercises. Record operator restore evidence outside this source repository. Reconcile pending jobs and uncertain communications outcomes before enabling the worker on a restored production environment. Do not invent successful backup/restore evidence.

## CI and verification

CI runs clean installation, types, production builds and deterministic tests. Operations unit tests run without external services. For local full deployment checks, configure the existing database mutation allowlist plus a dedicated localhost WORKER_SMOKE_REDIS_URL and run npm run test:deployment. It creates/drops only a generated temporary database, checks migration replay, built processes, readiness failure, cookie/proxy behavior and private artifact protection. npm run test:integration verifies domain controls separately. Build the Docker image, then run npm run test:containers for non-root production startup, Redis stop/restart and real Linux SIGTERM draining. Its generated containers are removed afterward. A Windows process kill alone is not evidence of graceful signal handling.

Hashed /assets files cache immutably; HTML revalidates. API responses default to private/no-store. Backend .cjs bundles, SQL and source maps are not served. Upload/body/page limits remain bounded; heavy rendering bundles still need optimization. No deployment secrets or automatic CD are configured.
