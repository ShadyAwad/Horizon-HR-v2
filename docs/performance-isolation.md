# Dashboard performance isolation

This development-only tooling collects evidence on real hardware. It is not a
replacement for Chrome DevTools, and it is removed from production builds.

## Confirmed Chrome root cause

A controlled signed-in Chrome 151 run at 1280 x 720 found one continuously
running animation after the earlier compositor reductions: the Geo Operations
ready-status dot used Tailwind's `animate-pulse` forever. Although the dot was
small, it was composited over the retained full-page dashboard layers and WebGL
canvas.

Measured over otherwise idle windows using Chrome DevTools Protocol process
CPU time:

| Condition | Window | GPU process | Active renderer |
| --- | ---: | ---: | ---: |
| Baseline pulse | 10 s | 12.32% of one core | 2.60% of one core |
| Pulse disabled through diagnostic CSS | 8 s | 0.02% | 0.02% |
| Pulse restored | 8 s | 11.92% | 2.34% |
| Static readiness ring in source | 10 s | 0.12% | 0.12% |

The post-fix page reported no running Web Animations and no layout/style-recalc
events during the measured idle window. This establishes the animation as the
Chrome-specific sustained idle cost. Firefox's different compositing behavior
explains why the same page appeared healthy there. These numbers describe the
controlled local profile; retest the visible user profile after extensions and
DevTools are removed from the comparison.

## React render measurements

Development uses React Strict Mode, so one logical commit commonly appears as
two render-counter increments.

| Action after counter reset | Dashboard | Settings | Navigation | Active module | Tutorial provider |
| --- | ---: | ---: | ---: | ---: | ---: |
| 20 seconds true idle | 0 | 0 | 0 | 0 | 0 |
| Close Settings | 2 | 2 | 2 | 2 | 2 |
| Open then close launcher | 4 | 0 | 8 | 4 | 4 |
| Launcher to Roster, including load | 8 | 0 | 10 | 8 | 8 |
| Theme toggle | 2 | 2 | 2 | 2 | 2 |

The idle result disproves a React root-render loop. Interaction fan-out was
still real: Dashboard mirrored Navigation's local launcher `open` state solely
for diagnostics, so opening the launcher invalidated the whole active module.
That mirror is removed. Settings accordion expansion was also root-owned; each
toggle invalidated the active module. Accordion expansion is now locally owned,
while passkeys and notification accordions invoke their required loaders only
when opened.

## Dashboard state dependency map

The inventory below covers every Dashboard-level `useState` value. Related
fields are grouped because they share cadence, consumers, and ownership.

### Ranked by frequency x breadth x cost

1. **Navigation shell:** `activeTab`, `rosterSubview`, `showPayrollPanel`,
   `showGrievancesPanel`, `showResignationsPanel`. User/event driven, but broad:
   they select the mounted module and therefore intentionally rerender the shell.
   Inactive heavy modules remain conditionally mounted behind lazy boundaries.
2. **Attention counts:** hook-owned counts refresh on mount, online/visibility
   recovery, and every 45 seconds while visible. Equality comparison preserves
   state identity when values do not change. Consumers are navigation badges,
   tutorial context, and a few module summaries.
3. **Settings shell:** `showControlCenter` legitimately changes the shell and
   pauses the lanyard scheduler. Accordion `isOpen` state now lives in each
   `ControlCenterAccordion`; it no longer invalidates Dashboard.
4. **Lanyard capability and anchoring:** `isLanyardCapable`,
   `isDashboardVisible`, `isLanyardIdleReady`, `lanyardAnchorNdc`. Updated only
   by media/connection/visibility events, delayed mount readiness, ResizeObserver,
   and layout events. The demand-rendered canvas sleeps when settled.
5. **Responsive/PWA environment:** `isMobileNavigationLayout`, `isOffline`,
   `installPrompt`, `installDismissed`, `isStandalone`,
   `notificationPermission`, `pwaMessage`, `pwaMessageType`. Event- or
   user-driven; no polling loop.
6. **Feature request state:** large breadth today because it remains in
   Dashboard, but changes only on module entry, request lifecycle, or user input.
   These are future extraction candidates, not idle CPU sources.

### Complete grouped inventory

- **Navigation and deep links:** `activeTab`, `rosterSubview`,
  `expandedRosterDate`, `leaveRequestSignal`, `leaveDeepLink`,
  `expenseDeepLink`, `hiringCreateSignal`, `assetCreateSignal`,
  `organisationCommandView`, `organisationCommandSignal`. Consumers are the
  shell/navigation and the currently selected lazy module. Updates follow user
  navigation, commands, or notification deep links.
- **Attendance and geolocation:** `clockInState`, `clockMessage`,
  `clockWarning`, `lastClockAccuracy`, `isClockedIn`, `activeTimeLogId`,
  `lastClockEvent`; hook-local `coords`, `error`, `loading`. Consumers are Geo
  Operations. Updates happen on initial status load and attendance actions.
- **Break requests:** `breakRequests`, `pendingBreakRequests`,
  `breakRequestsLoading`, `breakRequestSubmitting`,
  `breakRequestReviewingId`, `breakRequestMessage`,
  `breakRequestMessageType`, `breakRequestForm`, `breakReviewNotes`. Geo-only,
  request/form driven.
- **Roster:** `schedule`, `rosterStartDate`, `rosterRangeWeeks`,
  `rosterCustomEndDate`, `rosterEmployees`, `selectedRosterEmployeeId`,
  `rosterLoading`, `rosterLoaded`, `rosterMessage`, `pendingRosterSave`.
  Roster-only, request/form driven. Legacy draft persistence writes only when
  schedule changes before authoritative server load.
- **Notification preferences:** `notificationSettings`, `notificationLoading`,
  `notificationSaving`, `notificationMessage`, `notificationMessageType`,
  `quietHoursStart`, `quietHoursEnd`. Profile/Settings only. Settings loading is
  deferred to accordion open.
- **Passkeys:** `passkeys`, `passkeysLoading`, `passkeySaving`,
  `passkeyMessage`, `passkeyMessageType`. Settings only and deferred to open.
- **Payroll, compensation, and loans:** `payrollRecords`, `payrollLoading`,
  `payrollSubmitting`, `payrollExportingId`, `payrollMessage`,
  `payrollMessageType`, `payrollForm`, `compensationProfiles`,
  `compensationLoading`, `compensationSaving`, `compensationForm`,
  `skippedPayrollEmployees`, `employeeLoans`, `loanLoading`, `loanSaving`,
  `loanUpdatingId`, `loanForm`, `loanDeductionsApplied`,
  `payrollStatusUpdatingId`. Payroll-only request/form state.
- **Resignations:** `myResignations`, `tenantResignations`,
  `resignationsLoading`, `resignationSubmitting`, `resignationUpdatingId`,
  `resignationMessage`, `resignationMessageType`, `resignationForm`.
  Resignation-only request/form state.
- **Grievances:** `myGrievances`, `tenantGrievances`, `grievanceLoading`,
  `tenantGrievanceLoading`, `grievanceSubmitting`, `grievanceUpdatingId`,
  `grievanceMessage`, `grievanceMessageType`, `grievanceForm`. Grievance-only
  request/form state.
- **Company Feed:** `feedPosts`, `adminFeedPosts`, `feedLoading`,
  `adminFeedLoading`, `feedSubmitting`, `feedImageUploadPending`,
  `feedUpdatingId`, `feedMessage`, `feedMessageType`, `feedForm`,
  `feedEditorKey`. Feed-only request/editor state. Submission ownership is
  already centralized in its controller.
- **Locations:** `companyLocations`, `locationsMessage`. Loaded on tenant/user
  change and consumed by Settings/attendance/location selectors.
- **Legacy profile role management:** `tenantRoles`, `tenantPermissions`,
  `roleEmployees`, `rolesLoading`, `roleSaving`, `roleUpdatingEmployeeId`,
  `roleMessage`, `roleMessageType`, `roleForm`, `titleDrafts`. Profile-only
  request/form state.
- **Settings and diagnostics:** `showControlCenter`, `performanceIsolation`.
  Development isolation state changes only through the diagnostics panel and is
  session-scoped. Accordion state is no longer in this root group.
- **Command and mobile navigation:** `showCommandPalette`,
  `commandPaletteFocusRequest`, `isMobileNavigationLayout`,
  `showMobileShortcutEditor`. Launcher `open`, search, and drag state remain
  local to `DashboardNavigation`; the removed root mirror had no product use.
- **Profile photo:** `profilePhotoFile`, `profilePhotoSaving`,
  `profilePhotoMessage`, `profilePhotoMessageType`. Profile-only interaction.
- **Lanyard:** `isLanyardCapable`, `isDashboardVisible`,
  `isLanyardIdleReady`, `lanyardAnchorNdc`. Event/observer driven as described
  above; mutable generation/element handles remain refs.
- **Privacy/tutorial/workspace UI:** `showPrivacyPolicy`,
  `tutorialController`, `showTenantId`, `tenantIdCopied`. User- or provider-event
  driven. The copied flag has a one-shot 1.8 second reset.
- **PWA/environment:** `isOffline`, `installPrompt`, `installDismissed`,
  `isStandalone`, `notificationPermission`, `pwaMessage`, `pwaMessageType`.
  Browser event/user driven.
- **Recognition:** `recognition`. Prop/login-delivery driven and dismissed by the
  user; no cadence.

No Dashboard state changes from a wall-clock display. Break reminders install
one-shot timers for configured schedule events; they are not animation or render
loops.

## Effects and external event sources

- **45 seconds:** attention refresh while online and visible; identical data
  returns the existing state object.
- **Media queries:** mobile layout, desktop lanyard eligibility, reduced motion,
  and installed display mode update only on query changes.
- **Document visibility:** pauses attention work and the lanyard scheduler.
- **Network/PWA events:** online, offline, beforeinstallprompt, appinstalled.
- **Resize/layout:** lanyard anchor ResizeObserver and bounded animation-frame
  measurement after actual layout changes. No per-frame DOM read.
- **Module entry:** roster, payroll, roles, notifications, breaks,
  resignations, feed, grievances, and company-location requests.
- **One-shot lifecycle:** initial clock status, lanyard delayed mount, recognition
  delivery, copy confirmation, tutorials, and scheduled break reminders.

## Context fan-out

- **Language:** approximately 43 consumers. `t` and the provider value are now
  memoized; unrelated parent renders no longer broadcast a fresh object. A
  language change correctly updates every translated consumer.
- **Theme:** provider value was already memoized; three direct consumers. A
  theme change intentionally updates theme consumers once.
- **Stanza preferences:** provider value was already memoized; two broad shell
  consumers. Preference changes intentionally update Dashboard and navigation.
- **Tutorial:** controller/context input identity is memoized and eligibility is
  keyed by stable module/permission values. Disabled tutorials unmount the
  provider. Its short start delays are one-shot, not recurring.
- **Auth/permissions:** authenticated user and permissions arrive as stable App
  props rather than a frequently updating Dashboard context.
- **Notifications:** attention polling is a hook with identity-preserving state,
  not a global context broadcast.

## CSS and interaction findings

The theme migration still contained broad descendant selectors that remapped
any class containing `bg-emerald`, `border-emerald`, or `text-emerald` with
`!important`. Navigation, Settings choices, roster controls, and command-palette
options were still supplying those local utilities for selected state, so the
migration rule flattened selected and selected-hover feedback. Stateful controls
now expose ARIA/data state to one semantic interaction layer instead of owning a
second local fill. The physical lanyard switch track has a separate token-owned
rule so it does not inherit selected-card styling.

Generic hover styling excludes `aria-current`, `aria-selected`, `aria-pressed`,
and `aria-checked`; an explicit selected-hover rule keeps the selected token
family. Buttons retain finite 100-140 ms color, shadow, opacity, and
press-transform feedback with visible focus and reduced-motion handling. No new
`!important` rule was added to the interaction layer.

### Interaction settlement probes

The production build was exercised after opening Settings, expanding Help,
changing theme and language, starting a Roster tutorial, and entering the Roster
workspace. Each action had settled by its 500-700 ms observation point, and the
page reported zero running infinite Web Animations after each probe. These are
bounded settlement observations, not input-latency or process-CPU measurements;
they support only the conclusion that interaction work did not remain active.
A short Chrome CPU spike during rendering remains acceptable and was not assigned
a performance gain without a new process-CPU trace.

Topography, atmosphere, and masks remain visually substantial, but without an
active animation they did not cause sustained CPU in the controlled idle trace.
No broad theme selector rewrite was justified by the measurement.

### Infinite-animation audit

The signed-in frontend was searched for `animate-pulse`, `animate-spin`,
`animate-bounce`, explicit infinite CSS animation declarations, recurring
timers, and animation-frame loops. The remaining visual animations are bounded
by real state:

| Surface | Animation | Classification | Lifetime |
| --- | --- | --- | --- |
| Authentication fingerprint | CSS surface/groove loop | Necessary continuous state indicator | Only while authentication is loading; success is finite |
| Dashboard lazy-module fallbacks | Pulse | Interaction-only loading indicator | Suspense boundary lifetime |
| Attendance locating/verifying/success | Pulse and slow spin | Interaction-only workflow feedback | Explicit transient attendance state |
| Hiring, Locations, Live Employees, Digital Badge, and public verification | Pulse | Interaction-only loading skeleton | Request lifetime |
| Audit, Assets, Expenses, Hiring, Organisation, Performance, Leave, Goals, and Sessions | Spin | Necessary request progress | Loading, refresh, extraction, or mutation lifetime |
| Dashboard idle shell | None | No decorative infinite animation | N/A |

No `animate-bounce` use remains. The only literal `animation: ... infinite`
declarations are the two authentication fingerprint loading selectors. The
performance contract now holds an allowlist of state-bound pulse/spinner source
files, verifies the Dashboard pulse sites are Suspense or attendance-transition
states, and rejects new bounce animation. This is intentionally stricter than a
count-only assertion: a new module must classify a continuous animation before
adding it.

The lanyard is not a CSS infinite animation. Its single Three/Rapier canvas uses
the existing demand scheduler: active interaction may request 60 FPS, settling
uses the reduced tier, stable sleep requests zero frames, and Settings or a
hidden document pauses the scheduler. It performs no per-frame React state
updates.

### Theme-aware interaction surfaces

Five preset accent rules previously assigned dark values directly to
`--stanza-surface-hover` and `--stanza-surface-selected`. Those declarations
had preset specificity and overrode the light-mode surface values, which made
hover and selected controls either too dark or visually inconsistent. Presets
now define mode-specific `--stanza-hover-surface` and
`--stanza-selected-surface`; the semantic aliases resolve those values in both
modes. Hover rules are gated behind fine-pointer hover capability, while touch
keeps finite press feedback without sticky hover.

Selected theme-card text and background contrast was measured from live computed
styles after cycling every preset in both modes:

| Preset | Light | Dark |
| --- | ---: | ---: |
| Emerald | 4.83:1 | 5.32:1 |
| Slate | 5.31:1 | 4.89:1 |
| Midnight | 5.19:1 | 5.54:1 |
| Graphite | 4.95:1 | 4.60:1 |
| Warm Sand | 4.74:1 | 4.82:1 |
| Amethyst | 4.98:1 | 5.38:1 |
| Ember | 4.82:1 | 4.55:1 |

The shared selected foreground uses a 40/60 accent-to-primary-text mix. Theme
card titles inherit that foreground rather than bypassing it with a local dark
emerald utility.

## Using the development panel

Use **Baseline**, then tests 1-9 shown in the panel. Render counters increment
only when React renders and never use a timer. Select **Reset counters**, wait or
perform exactly one action, then select **Refresh metrics**. The optional frame
sample runs for ten seconds only.

Useful manual sequence:

1. Reset, wait 20 seconds, refresh: all five render counts should remain zero.
2. Open and close Settings: expect only the necessary shell commits.
3. Toggle a non-loading Settings accordion: Dashboard and Active module should
   remain unchanged.
4. Open and close the launcher: Navigation should update locally; Dashboard and
   Active module should remain unchanged.
5. Switch module: the shell and selected lazy boundary update; inactive modules
   remain unmounted.
6. Change theme or language: expect one logical context update, with no follow-up
   loop.

Switches persist only for the current browser session.

## Remaining architecture work

`activeTab` still has broad shell reach, but a module switch inherently changes
the active boundary and its data-loading effects. A router/external store rewrite
would add risk without addressing measured idle CPU. Payroll, Feed, roster, and
legacy profile administration remain strong future component-extraction
candidates because their request/form state is feature-local. Extract them only
with profiler evidence for interaction latency; do not blanket-memoize or move
all Dashboard state at once.
