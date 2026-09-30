# Stanza grievance case management

Prompt 6 extends the existing grievances table, scoped permissions, audit, notification outbox, Communications and Workspace Composer. It reuses native form controls, theme typography and Surface. No new theme, hiring, demo seed, payroll or attendance workflow is introduced.

## Migration and deployment

Apply `src/db/migrations/20260930_grievance_cases.sql` after the organisation and Communications foundation migrations and before starting this application version. Back up the database using the normal deployment process. Historical schema.sql remains the foundation and points to this additive migration.

UUIDs, reporter links, subjects and descriptions survive. New fields include tenant-unique case number, original destination, current routing department, confidentiality, version and resolution/closure metadata. Legacy open becomes submitted; under_review becomes triaged; rejected becomes closed, retaining its value in legacy_status. Resolved/closed retain status. Legacy cases receive one submitted event at their original creation time; unavailable history is not invented.

Tenant counters allocate numbers atomically. Their RLS-protected permissions_migrated flag prevents reruns restoring revoked grants. Existing create roles gain view_own; review roles gain granular handling grants in their existing scopes. System HR Admin receives grievance grants. Other roles require explicit confidential/configure grants. New tenant defaults are seeded by the existing server setup. Role-name-only access is replaced by explicit grants; administrators should provide self-service create/view_own grants to users previously relying solely on a manager role name.

Departments default to disabled for submission. Company configurators enable destinations in the workspace. If no destination is enabled, an unrouted general case is permitted. Original destination remains visible to the reporter; internal assignment/current routing remain handler-only.

## Lifecycle and concurrency

| Current | Allowed next |
| --- | --- |
| submitted | triaged |
| triaged | assigned, in_progress |
| assigned | in_progress, waiting |
| in_progress | waiting, resolved |
| waiting | in_progress, resolved |
| resolved | in_progress, closed |
| closed | none |

Assignment requires an active authorized employee and enabled tenant department. Routing checks both source and target scopes. Resolution requires a summary permanently retained as an employee-visible resolution message. Reopening preserves earlier resolutions. Closure retains history and prevents replies, uploads and settings mutations. There is no case deletion API.

Mutations use transactions, row locks and expected versions. Stale operations return CASE_CONFLICT (409). Atomic counter upserts prevent duplicate numbers. Events/messages reject updates and direct deletes; tenant cascades still permit disposable fixture cleanup.

## Permissions and confidentiality

Create permits self submission. View_own (or legacy create) permits the safe employee projection. Handling requires scoped grievances.view or legacy review, and each action independently requires triage, assign, respond, internal_notes, resolve or close. Confidential cases additionally require grievances.confidential. Department configuration requires company grievances.configure.

Active assignments/delegations use the existing resolver. Company covers the tenant; department follows current routing; direct_reports/team/location follow the reporter. A reporter receives only the employee projection even with HR grants. Assignment candidates must satisfy current case visibility, including confidentiality. Confidentiality escalation rejects an assignee who would lose access until reassignment occurs.

One SQL policy protects inbox/search/counts, detail, assignment candidates, audit list/summary/facets, Workspace and linked Communications. Missing/foreign/unauthorized cases are unavailable without existence disclosure. Current grants and active account are rechecked on requests; failed authorization clears opened client detail. There is no background case polling.

RLS protects counters/events/messages/attachments using app.current_tenant; existing grievance RLS remains. Composite foreign keys enforce tenant membership for cases, departments, employees and Communications links. Integration tests use a non-superuser role. Application predicates also protect scoped access when the runtime role owns tables.

## Inbox, conversations and timeline

My Grievances contains only the reporter's cases. Handler Case Inbox supports status, priority, department, assignee, category, date, bounded search and mine/unassigned filters. Counts follow authorization before aggregation; resolved/closed cases do not inflate operational unassigned/high/mine counts.

Detail loads only when opened. Internal notes never enter employee conversation or timeline. Public responses, follow-ups and resolution summaries remain chronological and immutable. Events identify actor/action/time; generic audit stores safe IDs/states without private bodies. Employees can follow up and provide evidence until closure.

## Attachments and deployment storage

JPEG/PNG/WebP/PDF: 10 MB each, 20 per case. Images require matching signatures, actual decoding and re-encoding; PDFs require structural parsing. Filenames are cleaned/bounded. Random storage keys never leave the API. Protected authenticated downloads use attachment disposition, no-store, nosniff and sandbox headers.

The existing private storage class is reused with durable `uploads/private-grievances`, or GRIEVANCE_ATTACHMENT_DIRECTORY. It is git-ignored and not statically served. Deploy a persistent private volume, restrict filesystem access, and back up bytes alongside database metadata. Failed DB insertion removes newly written bytes. Object storage, malware scanning and administrative retention tooling remain future work.

## Notifications and Communications

Meaningful changes enqueue content-free idempotent grievance_updates events in the existing outbox. Payloads contain recipient/case IDs and deep-links, never complaint or internal-note bodies. Internal notes do not notify reporters. This adds no new dispatcher and does not claim push delivery.

A handler can prepare a private existing Communications draft from a stored public response/resolution, addressed only to the reporter. Duplicate actions reuse that draft; internal notes cannot be exported. Nothing sends automatically. Existing Communications send/provider workflow remains responsible for delivery.

Linked reads, company history, edits, cancellation, queueing and worker retries recheck case authority. Sending additionally requires respond and reporter-only recipient. Revocation prevents provider dispatch. Other messages/meetings retain existing behavior. Legacy grievance templates retain their current category permission gate.

## Workspace, accessibility and performance

Existing grievance widgets use explicit grants and the scoped API, bilingual statuses and authorized unassigned/high/waiting/mine counts. Dashboard attention shares the visibility policy.

Lazy-loaded UI reuses theme variables, semantic labels, native keyboard controls, focus-visible, textual statuses/errors and busy regions. Detail remains mounted while refreshing; composing an internal note remains internal after refresh. Detail stacks below 900px, tables scroll within their container, logical properties support RTL, and submission retains its responsive maximum width.

Pages contain 20 cases; history contains 40 events/messages; destination/candidate lists cap at 200. Search and text inputs are bounded. Requests abort on account/navigation changes. No permanent observers, polling, RAF loops or animated blur are added. Assignee filter options come from the current page; candidate pickers are independently authorized.

## Validation

`npm run test:grievances` runs guarded disposable migration/integration fixtures. Set ALLOW_TEST_DATA_MUTATION=true and TEST_DATABASE_ALLOWLIST to the intended local database. Coverage includes migration/rerun, lifecycle, scope/privacy, uploads, concurrency, audit/outbox, private linked drafts, worker revocation, immutability and non-superuser RLS. Fixture rows and private bytes are removed. Email provider tests use fakes; no external email is sent.

See grievance-case-management-validation.md for actual checks and browser evidence.
