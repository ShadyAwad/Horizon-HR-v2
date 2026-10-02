# Workspace Composer foundation

Composer is a separate Dashboard destination. Canonical modules retain their workflows; cards are small read-only summaries with Open module links. No server routes, schema, authorization model or domain mutations were added.

## Architecture and registry

`src/components/workspace-composer/widget-catalog.ts` owns stable IDs, bilingual titles, domain groups, permission claims, grid constraints and existing API paths. `widget-registry.ts` adds lazy summary rendering. `WorkspaceComposer.tsx` owns the editor and filters authorized cards before requesting data and again before rendering content. `WidgetFrame.tsx` owns presentation and gestures; `workspace-model.ts` owns pure normalization, collision resolution and actions.

| Widget | Existing endpoint | Access |
| --- | --- | --- |
| Attendance Status | `/api/clock-status` | attendance.clock |
| Break Queue | `/api/attendance/breaks?team=true` | break_requests.view_all or review |
| Leave Approvals | `/api/hr/leave-requests?status=pending&pageSize=5` | leave scoped/review/manage |
| Expense Approvals | `/api/finance/expense-claims?status=pending&pageSize=5` | expense scoped/review/manage/reimburse |
| Goals / Tasks | `/api/roster/goals?weekStart=YYYY-MM-DD` | roster goals self/scoped/manage; defaults to own goals |
| Grievance Inbox | `/api/grievances` | explicit grievance grants and scoped case visibility |
| Hiring Pipeline Summary | `/api/hiring/applicants?status=active&pageSize=5` | hiring.view |
| Company Feed | `/api/company-feed` | authenticated visibility rules |

Existing APIs independently enforce sessions, permissions, scopes and tenant isolation. Layout contents grant no access. A saved card whose permission was revoked remains a harmless unavailable placeholder without data or an Open module action. Changing claims/identity cancels requests and immediately hides the old snapshot. Session claim refresh follows the existing app lifecycle; Composer does not poll for role changes.

## Layout and persistence

Browser localStorage key: `stanza.composer.v1:<encoded tenant ID>:<encoded user ID>`.

```ts
{
  version: 1,
  activeId: string,
  surface: 'auto' | 'solid' | 'glass',
  workspaces: [{ id, name, widgets: [{
    instanceId, widgetId, x, y, width, height,
    config: { compact?: boolean, limit?: 2 | 5 | 10 },
    surfaceOverride: 'auto' | 'solid' | 'glass'
  }] }]
}
```

The default surface applies across this user's saved Composer layouts; a widget's Auto inherits it. Names are capped at 60 characters, with up to 10 layouts and 20 cards each. Normalization clamps geometry, whitelists configuration, removes duplicate IDs and unknown widget types, and rejects oversized/malformed JSON or unsupported versions safely. No raw HTML, endpoint URLs, auth claims or fetched domain data are persisted. Future schema versions need explicit migration. An invalid/deleted active ID selects the first remaining layout; deleting the last layout restores an empty default.

`ComposerPreferences` is separate from browser-wide display preferences so layouts cannot bleed across tenants/accounts. Writes occur on explicit edits only. Storage events synchronize tabs using last-writer-wins; storage failures show a warning. Browser/device synchronization and server sharing are not part of v1. Clearing site storage removes layouts.

Duplicate layouts create new instance IDs. Duplicate widget types are allowed and can have different display options, while sharing one request per endpoint within a refresh. Attendance offers compact mode; list cards offer a maximum visible item count (an API may return fewer).

## Editing and responsive behavior

Normal mode has no drag/resize/remove/configure controls. Customize enables title-handle pointer dragging, corner resizing and a keyboard-accessible Move / resize selector. Native modal dialogs provide focus containment, Escape/backdrop dismissal and focus restoration.

The desktop grid has 12 columns, 52-pixel rows and 12-pixel gaps. New cards fill the first available slot. A committed move wins its slot; overlapping cards move down deterministically without overlap. Pointer movement changes only temporary DOM styles; pointer release makes one layout update. Escape, pointer cancellation/lost capture, hidden document, mode change and unmount clean up the gesture. Only the primary pointer can start a gesture. No React update occurs per pointer pixel.

Maximize is transient UI state, not saved geometry. Restore returns to saved coordinates. Under 900px, cards stack by saved row/column/ID; desktop coordinates remain untouched. Pointer dragging is disabled there and keyboard controls remain available. Arabic changes text direction and control alignment, not the physical grid coordinate system.

Auto uses an opaque surface. Solid is explicit opaque. Glass uses restrained static translucency and at most 4px backdrop blur on capable desktop browsers; it falls back to solid on narrow screens or reduced motion/transparency. Dragging removes backdrop filtering. There are no CSS animations or transitions in Composer styling.

## Data and performance

`useWidgetData` deduplicates endpoints within a refresh and aborts requests on scope, layout or mount changes. A completed or late response cannot repopulate a newer identity's snapshot. Data refreshes on mount, endpoint-set/identity change or explicit Refresh data. There are no widget polling loops, permanent RAFs, observers, hidden full modules or idle layout calculations. Existing Dashboard-level behavior is outside this subsystem.

The two Add to Workspace buttons live on Geo Operations' attendance panel and Company Feed. They select a destination and add the registered summary; they do not copy DOM or domain logic.

## Adding a widget

1. Add a stable WidgetId and metadata in widget-catalog, matching the canonical API's authorization boundary.
2. Map it to an existing bounded read endpoint, or separately implement a secure domain-owned endpoint if necessary.
3. Add a small summary renderer; keep all business mutations in the canonical module.
4. Add model/permission/request tests, loading/error/empty states and bilingual labels.
5. Preserve no-polling, abort cleanup and responsive frame contracts.

## Validation and limitations

`npm run test:workspace` covers registry, CRUD, schema robustness, account-key isolation, randomized collisions, geometry persistence and lifecycle contracts. It also executes the real data hook with deferred transport to test deduplication, no idle refetch, permission revocation, identity changes, stale responses and cancellation. Use `npm run lint`, `npm run build`, and existing navigation/authorization/security/theme/architecture/performance/tutorial suites.

Full-stack preview uses `npm run preview:full` (or build followed by npm start), not frontend-only Vite preview. API responses remain same-origin.


Limits: browser-local layouts, manual data refresh, summaries rather than full module functionality, bounded card counts, and no cross-page HTML dragging. Server-scoped summary counts may differ from the limited visible row list. No automatic cross-device synchronization or layout sharing.

## Communications summaries

Recent Communications and Upcoming Meetings use the existing authorized Communications APIs and lazy summary renderer. They add no send action or background polling. Demo-only first-use layouts are documented in demo-seed.md.
