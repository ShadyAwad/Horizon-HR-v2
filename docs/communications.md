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

Use the Express origin (normally http://localhost:3000, or the configured PORT), not Vite's frontend-only preview. Configure the existing DATABASE_URL, Redis variables, RESEND_API_KEY and EMAIL_FROM normally; never put provider credentials in Vite variables. No production fake-provider switch exists.

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
$env:TEST_DATABASE_ALLOWLIST='<isolated database name>'
npm run test:communications
$env:COMMUNICATIONS_TEST_BASE_URL='http://localhost:3000'
npm run test:communications:sessions
npm run test:architecture
npm run test:hr-background
npm run test:workspace
git diff --check
```

Communications tests use disposable PostgreSQL tenants, non-superuser RLS checks and a uniquely named BullMQ queue on the normal configured Redis. Fake provider functions and mocked adapter responses prevent external email. Coverage includes duplicate enqueue, actual retry/completion/permanent failure, worker lifecycle events, uncertain-outcome reconciliation, cancellation, confirmed-message replay, grants, tenant relationships, private discarded drafts, templates, bounded filters, meetings, resend snapshots, ICS and audits. Test fixtures/isolated queue are removed afterward.

Cookie-session tests exercise real login, private drafts, denied managers and foreign-origin mutation rejection, then invoke existing security and authorization suites with ephemeral credentials. A fresh preview process avoids cumulative login rate limiting; the limiter is not bypassed.
