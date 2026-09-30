# Prompt 6 validation report

## RECOVERED STATE

Started from the existing committed Communications/Workspace/appearance foundation and the legacy Dashboard grievance submission/review UI. No duplicate theme, auth, scope, editor or notification system was introduced. No commit was made.

## SCHEMA / MIGRATION

Additive migration preserves case UUID/content, maps old statuses, adds unique case numbers, tenant counters, departments, confidentiality, version, resolution/closure metadata, append-only messages/events and private attachment metadata. Rerun and historical backfill tests passed. Applied locally; other deployments must apply it after organisation and Communications migrations.

## CASE MODEL

Subject, description, category, priority, original destination, current department, reporter, assignee, confidentiality, lifecycle and version are explicit. Legacy low priorities remain supported.

## DEPARTMENT ROUTING

Enabled tenant departments are selectable; no enabled destination permits general/unrouted submission. Original destination is retained. Reassignment requires source and target scope, an enabled department and eligible active handler.

## CONFIDENTIALITY

Standard cases require scoped handling authority; confidential adds an explicit grant. Reporter projections exclude internal notes, routing/assignee metadata and private events, even when the reporter is HR. Counts/search/audit/history follow the same restriction.

## LIFECYCLE

Submitted, triaged, assigned, in_progress, waiting, resolved and closed use a server state machine. Invalid/stale changes return safe 400/409 responses. Closed cases remain preserved.

## INBOX

Permission-gated handler inbox offers bounded filters, mine/unassigned views, summaries and server pagination. Employees have a separate own-case list.

## CASE DETAIL

On-demand detail separates original complaint, public conversation, internal notes, attachments, chronological history and handler actions. Current routing and original destination remain distinct.

## ASSIGNMENT

Active eligibility, scope, tenant and confidentiality are rechecked. Assignment/routing history and content-free assignee notification are recorded. Race tests allow one successful stale-version mutation.

## INTERNAL NOTES / EMPLOYEE RESPONSES

Kinds are explicit and server-authorized. Reporter APIs exclude internal notes and their events. Internal composition remains selected after refresh. Stored public responses support optional private email drafts.

## TIMELINE

Append-only actor/action/time events; employee and internal visibility are separate. Historical unknown transitions are not fabricated. Generic audit metadata excludes bodies.

## ATTACHMENTS

Protected private storage, sanitized metadata, authenticated downloads, image decoding/re-encoding, PDF structural validation, 10 MB/20-file limits and cleanup compensation. No public storage URL. Browser upload and unrelated-user download denial passed.

## EMPLOYEE EXPERIENCE

Submit, My Grievances, safe detail, public responses, follow-ups and evidence until closure. Unrelated employees see neither others' cases nor Case Inbox.

## RESOLUTION / REOPEN / CLOSE

Required summaries persist as resolution messages. Browser verified resolve/reopen/resolve with both summaries retained, then close with reply/upload controls removed.

## PERMISSIONS / SCOPE

Granular create/view_own/view/triage/assign/respond/internal_notes/resolve/close/confidential/configure use existing grants/delegations. Company, department, reporter direct-report/team/location scopes are enforced. Legacy role-name-only submission now needs explicit self-service grants.

## RLS / TENANT ISOLATION

Composite tenant foreign keys plus RLS on all new tenant tables. Non-superuser tests verify hidden foreign records and rejected writes. Cross-tenant case, assignee, attachment and generic role-assignment checks passed.

## CONCURRENCY

Row locks and expected versions protect assignment/status/messages/uploads. Atomic tenant counters passed concurrent numbering tests. History is append-only; closure races produce one winner and one conflict.

## NOTIFICATIONS

Existing grievance_updates preference/outbox reused with IDs/deep-links and idempotency, no private text or internal-note notification. Actual push delivery is not claimed; no new dispatcher was built.

## COMMUNICATIONS INTEGRATION

Explicit prepare-draft action creates/reuses a private reporter-only linked draft from public response/resolution. No automatic send. Reads/history/updates/cancel/send/worker retry recheck case access. Fake-provider tests verify revocation blocks dispatch. Browser verified draft appears in existing Communications.

## WORKSPACE INTEGRATION

Existing widget and Dashboard attention use the shared scoped case predicate, explicit permissions, bilingual status and authorized operational summaries.

## RESPONSIVE / RTL

Desktop dark/English case workflow and Arabic light/390px with 120% font were verified. Mobile page width equals viewport width (390px), columns stack and controls wrap. Arabic native submission controls and actual submission passed. Browser preferences restored to English/dark/default font/interface100%, viewport override reset.

## PERFORMANCE

Lazy module and bounded paged queries; detail fetched only on open. Aborted stale requests and local refresh; no new polling, observers, RAF or animated blur. Architecture and performance suites passed.

## DOCUMENTATION

Implementation/operations: grievance-case-management.md. In-app English/Arabic help and tutorials updated. README links both documents.

## FILES CHANGED

New: src/db/migrations/20260930_grievance_cases.sql; src/lib/grievance-contract.ts; src/lib/grievance-copy.ts; src/server/grievances/grievance-policy.ts; src/components/grievances/GrievancesPanel.tsx; src/components/grievances/grievances.css; scripts/grievances-migration-test.ts; scripts/grievances-test.ts; these two documentation files.

Updated: .gitignore, README.md, package.json, server.ts, src/db/schema.sql, src/pages/Dashboard.tsx, src/server/grievances/grievance-routes.ts, src/server/organisation/permission-registry.ts, src/server/audit/audit-events.ts, src/server/audit/audit-routes.ts, src/server/dashboard/attention-routes.ts, src/server/communications/communications-routes.ts, src/server/communications/communications-queue.ts, src/lib/communications-contract.ts, src/components/communications/CommunicationsPanel.tsx, src/components/workspace-composer/widget-catalog.ts, src/components/workspace-composer/SummaryWidget.tsx, src/components/tutorials/help-registry.ts, src/lib/LanguageContext.tsx.

## TESTS

Passed: npm run lint; npm run build; test:grievances (legacy migration + database/API integration); test:architecture (11); test:organisation (197); test:communications (real Redis/BullMQ, fake provider); test:communications:sessions (real authenticated cookies and same-origin); test:security and test:authorization invoked by that session suite, including cross-tenant role assignment; test:workspace; test:theme and custom cursor; test:navigation; test:performance (110); test:expenses (23); test:audit (13); test:tutorials; test:api-routing; test:hr-background. Notification contracts are covered in grievance integration; no separate test:notifications script exists.

No failing checks remain. Initial credential-dependent security/authorization skips were eliminated with disposable cookie-session fixtures. The final cross-tenant role check also ran successfully. Build retains existing Lexical annotation and large-chunk warnings. Test providers sent no external email. git diff --check passed after removing an extra trailing blank line.

## BROWSER VERIFICATION

Disposable tenant/account fixtures only: employee submission; handler triage/assignment; internal note and public response; reporter note invisibility and follow-up; image upload; department/handler reassignment; private Communications draft; in_progress/waiting/resolution/reopen/second resolution/close; desktop case detail; Arabic light mobile with XL text; Arabic submission; unrelated employee empty own inbox and absent Case Inbox; direct protected attachment denied. Production build was also rebuilt and restarted for final authenticated regression checks.

Screenshots are retained outside the repository in the task visualization folder: grievance-desktop.png and grievance-rtl-mobile.png. Fixtures, private upload bytes and temporary editing scripts are removed after verification. No real case was deleted or modified for browser testing.

## REMAINING LIMITATIONS

Private bytes require a durable volume and coordinated backups; no object-store or malware scanner is added. Historical unknown transitions cannot be reconstructed. Assignee filter choices derive from the current page; candidate/destination pickers cap at 200. Legacy grievance email templates retain existing category permission checks. Outbox events are queued, not a newly delivered push service. Real provider email delivery was deliberately not exercised. No grievance category administration, retention tooling, Hiring UX, demo-seed overhaul or finance semantics changes are included.
