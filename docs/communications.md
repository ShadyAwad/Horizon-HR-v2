# Communications foundation

## Runtime and setup

Communications uses the existing cookie-session Express application, PostgreSQL tenant context, Redis/BullMQ connection, Resend adapter and audit/outbox infrastructure. It does not introduce a second authentication or notification system.

Apply `src/db/migrations/20260929_communications.sql` through the existing database migration workflow. The migration is additive and rerunnable; it is also reflected in `src/db/schema.sql`. It has been applied to the local development database only.

```powershell
npm run build
npm start
# Separate terminal, existing configured Redis running:
npm run dev:worker
```

Use the Express origin (normally http://localhost:3000, or the configured PORT), not Vite's frontend-only preview. The verification instance used http://localhost:3006. Configure the existing DATABASE_URL, Redis variables, RESEND_API_KEY and EMAIL_FROM normally; never put provider credentials in Vite variables. No production fake-provider switch exists.

## Schema and isolation

Five tables: communication_templates, communication_messages, communication_message_events, communication_meetings, communication_meeting_attendees. Every table enables and forces tenant RLS using the existing tenant context. Composite tenant foreign keys protect employee, template, related candidate/employee/meeting and attendee relationships. A recipient-array trigger checks every employee belongs to the message tenant. Indexes cover tenant/list timestamps, status, sender and invitation identity.

Draft and delivery records share one table. Version checks prevent silent draft/meeting overwrite. Sent content and recipients are immutable snapshots. Events provide the status timeline. Audit metadata contains status/error codes, not message bodies.

## Permissions

- communications.view: own messages/templates.
- communications.send: own drafts and sending.
- communications.templates.manage: tenant template administration.
- communications.history.view: company non-private message history and provider IDs.
- communications.meetings.view: meetings where the employee organizes or attends.
- communications.meetings.manage: company meeting administration.

The migration grants existing system HR-admin roles; other roles require explicit assignment through existing role management. Sensitive categories additionally require existing payroll, grievance, hiring or leave permissions. Server checks are independent of navigation visibility. Cookie authentication, mutation same-origin checks and rate limits remain intact.

## Drafts, templates and related records

Drafts remain sender-private, including discarded drafts: company history requires a queued_at timestamp. Drafts can be saved/reopened; queuing freezes the expanded content and resolved recipient addresses. Templates support create, edit, archive, duplicate and preview. Only the seven variables in communications-contract.ts are accepted; unresolved or unknown variables fail before dispatch. No expression evaluation or raw HTML execution occurs.

The editor lazily reuses Lexical without image uploads. Structured content is validated and persisted, but delivery currently uses safe plain text plus escaped HTML line breaks; formatting/images are not sent. Related entities currently support employee, candidate and meeting. Linking a candidate includes the candidate's email on send and requires hiring permission. Other domain links are intentionally deferred.

## Lists and details

Email and History queries return summaries without bodies, twenty rows per page, at most 1,000 pages, with a default ninety-day date range and maximum one-year range. Date-only boundaries are UTC; the through-date includes the entire day. Filters cover subject/address search, status, category, sender, employee/recipient and related record. Details are fetched on demand and safely render text, recipients, sender, timestamps, timeline, failures and authorized provider ID.

Meetings use twenty-row pages with a one-year lookback. The Upcoming Meetings widget requests only scheduled future entries. Meeting status/date UI filtering beyond this is not implemented. Lists refresh on navigation/filter/save or explicit Refresh; there is no polling or permanent animation loop.

## Queue and delivery lifecycle

`draft -> queued -> sending -> sent | failed`, with transient failure returning to queued before retry. Draft/queued messages can be cancelled; sending messages cannot. Database persistence precedes dispatch. A Redis dispatch failure leaves the queued record and offers Retry dispatch for that same ID.

Queue: stanza-communications. Stable BullMQ ID: message-{message UUID}. Worker concurrency is one with one job per second; four attempts use exponential backoff starting at five seconds. The existing HR worker starts both queues and closes both on SIGINT/SIGTERM. Logs show ready/processing/completed/failed without message content or credentials.

Provider key: stanza-message-{message UUID}, stable across retries. The same frozen payload is retried after transient network, rate-limit or provider failures. Permanent errors do not retry. Already sent/cancelled/failed records skip provider calls on replay. Sending authorization and active employment are rechecked before the first attempt.

Uncertain attempts older than twenty hours stop with RECONCILIATION_REQUIRED, before the provider idempotency retention window expires. Terminal/stalled BullMQ failures reconcile queued/sending records to failed instead of leaving a false sending state. Operators must inspect the provider outcome before creating any replacement message; this is not an exactly-once distributed transaction guarantee.

Redis data loss or a process failure between database commit and queue insertion requires explicit redispatch/reconciliation. There is no periodic database-to-queue recovery scanner. Preserve Redis durability and monitor failed jobs. A database outage during reconciliation itself requires operator follow-up. `sent` means provider accepted, not delivered/read. No delivery webhooks, bounce/open tracking, BCC or attachments beyond calendar invitations are provided.

## Meetings and calendar invitations

Create/edit/cancel/complete meetings with tenant-validated attendees, version conflicts, notes, location or HTTPS link, UTC times and an IANA display timezone. Form dates are entered in the device timezone. Maximum duration is seven days.

ICS uses stable UID, revision SEQUENCE, UTC DTSTART/DTEND, escaped text, UTF-8 line folding, and REQUEST/CANCEL. Downloads contain no access tokens. Preparing an invitation creates an immutable private draft; explicit resend creates a distinct draft using a request UUID, while replaying that request is idempotent. Sending an obsolete meeting revision is rejected. Cancelling a meeting does not automatically email recipients; prepare and explicitly send its cancellation invitation.

Meeting and delivery-failure notifications are persisted into the existing outbox. This foundation does not add a notification dispatcher or claim those events were delivered. No Google/Outlook/Zoom integration or RSVP synchronization is included.

## Optional Composer widgets

Recent Communications and Upcoming Meetings use the existing widget catalog/data source path. Composer storage, placement and permission architecture are unchanged.

## Validation

```powershell
npm run lint
npm run build
$env:ALLOW_TEST_DATA_MUTATION='true'
$env:TEST_DATABASE_ALLOWLIST='horizon_hr'
npm run test:communications
$env:COMMUNICATIONS_TEST_BASE_URL='http://localhost:3006'
npm run test:communications:sessions
npm run test:architecture
npm run test:hr-background
npm run test:workspace
git diff --check
```

Communications tests use disposable PostgreSQL tenants, non-superuser RLS checks and a uniquely named BullMQ queue on the normal configured Redis. Fake provider functions and mocked adapter responses prevent external email. Coverage includes duplicate enqueue, actual retry/completion/permanent failure, worker lifecycle events, uncertain-outcome reconciliation, cancellation, confirmed-message replay, grants, tenant relationships, private discarded drafts, templates, bounded filters, meetings, resend snapshots, ICS and audits. Test fixtures/isolated queue are removed afterward.

Cookie-session tests exercise real login, private drafts, denied managers and foreign-origin mutation rejection, then invoke existing security and authorization suites with ephemeral credentials. A fresh preview process avoids cumulative login rate limiting; the limiter is not bypassed.

Authorization test maintenance: committed HEAD already returns `system_key` from legacy `/api/roles`; the test incorrectly expected `systemKey`. Only the test lookup was corrected to the established snake_case response. No route, permission, session or escalation protection changed.

## File ownership

New Communications files: this document; scripts/communications-test.ts; scripts/communications-session-test.ts; src/components/communications/CommunicationsPanel.tsx and communications.css; src/lib/communications-contract.ts; src/server/communications/communications-rules.ts, communications-routes.ts, communications-queue.ts; src/db/migrations/20260929_communications.sql.

Integration changes: package.json; server.ts; src/db/schema.sql; src/lib/email.ts; src/workers/hr-worker.ts; src/server/audit/audit-events.ts; src/server/organisation/permission-registry.ts; src/components/RichTextEditor.tsx; Dashboard/navigation/help/tutorial/language registries; Composer widget-catalog/SummaryWidget and workspace count test. Existing unrelated Composer files were already uncommitted and have been preserved.

## Continuation verification record (2026-09-30)

Recovered without restarting or reverting: all four tabs, private drafts, templates, message/meeting details, bounded filters and pagination, invitation snapshots, worker/queue/RLS/audit integration, and both Composer summaries were already implemented. The test-only legacy role-field correction and this document were already present too. Remaining work was browser verification, recovery guidance, responsive refinement, documentation, and final validation.

| Item | Final classification | Evidence / boundary |
| --- | --- | --- |
| Email tab | complete | Browser list, template selection, create/reopen/edit/save/discard private draft |
| Templates tab | complete | Browser details and variable expansion; API create/edit/archive/duplicate validation |
| Meetings tab | complete | Browser create with demo attendee, edit location, reopen, cancel |
| History tab | complete | Browser company list/search; discarded private drafts excluded; API permission coverage |
| Message details | complete | Browser recipients, sender name, timestamps, status timeline and safe body |
| Meeting details | complete | Browser attendee, organizer, timezone, location, notes, ICS action and locked invitation |
| Filters/search | complete | Browser status/type/text/employee/related controls; API date range/full-through-day tests. Browser date-fill automation was not a reliable persisted-state check, so date correctness is claimed from integration coverage |
| Pagination | complete | Browser 20-row first page, second page, disabled terminal Next; bounded API queries |
| Invitation resend | complete | Browser two distinct invitation records for same revision; API confirms distinct request IDs and immutable previous sent snapshot. Neither browser invitation was sent |
| Queue recovery UX | complete | Browser fixtures for queued, transient queued, sending, sent, failed, cancelled and RECONCILIATION_REQUIRED; missing configuration covered by integration and persistent UI banner |
| Workspace widgets | complete | Browser Recent Communications bounded rows and Upcoming Meetings empty state; workspace registry and real hook tests |
| Documentation | complete | Schema/RLS, permissions, lifecycle, adapter/idempotency/retries, recovery, ICS/resend, limits and evidence |
| Dark/light | complete | English dark desktop and narrow; Arabic light narrow filters/forms/preview; original English dark preference restored |
| Arabic RTL | complete | Tabs, filters, compose editor, meeting form and template preview align RTL; category/status values remain canonical technical identifiers |
| Narrow/mobile | complete | 390px viewport: page scrollWidth 390; table 325px; dialogs 352px with 335px content. Forms scroll vertically; controls wrap |
| Final automated validation | complete | See commands/results below; optional cross-tenant authorization fixture skip disclosed |

Continuation changes: added bilingual delivery-state instructions in message details, clarified the Arabic resend label, constrained narrow tables/filter controls/dialog forms, and translated the two Communications widget titles. Server authorization and queue behavior were preserved.

Browser fixtures were explicitly fictional records in the isolated demo tenant. State/pagination fixtures had no BullMQ jobs and never called a provider. The temporary draft, meeting, invitation and state/pagination records were removed afterward; the disposable Composer layout was deleted while preserving the original layout. Provider buttons were not used to send email. API tests used separate disposable tenants and fake providers.

Validation passed: npm run lint; npm run build; npm run test:communications; npm run test:communications:sessions (invokes the exact security and authorization scripts with ephemeral HR-admin/manager/employee credentials); npm run test:architecture (11); npm run test:hr-background; npm run test:workspace; npm run test:editor (17); npm run test:navigation; npm run test:performance (110); git diff --check. The final Communications command includes Redis/worker checks as part of its existing script, so those ran once for final validation; no separate Redis/container rerun was performed.

The first session run failed with ECONNREFUSED because no preview server was running; after starting a fresh production preview on port 3006 it passed. An already-open browser held obsolete hashed assets after rebuilding; reload resolved the dynamic import failure. Build retains existing large-chunk and Lexical annotation warnings.

Credential-dependent skip: the standalone authorization script's optional cross-tenant assignment test did not run because AUTHZ_OTHER_TENANT_EMPLOYEE_ID was not supplied. Authenticated manager escalation prevention did run. Communications cross-tenant relationship/access and non-superuser RLS checks passed independently. Real Resend delivery and provider-side reconciliation were intentionally not exercised.

Operational limitations remain: manual refresh, manual redispatch/reconciliation after lost dispatch, no recovery scanner, provider acceptance rather than confirmed delivery, safe text delivery rather than rich formatting, no delivery webhooks/RSVP integration, and meetings without additional UI date/status filtering. Advanced related-record and employee filters use UUIDs. Browser verification sampled the stated combinations; it is not an exhaustive browser-engine/device matrix or provider-delivery test. No commit was created.
