# Hiring filters and custom roles

## Hiring pipeline

`src/lib/hiring-stages.ts` supplies canonical stage IDs to the API, server and UI. New, HR Review and Final Review counters are native toggle buttons with count labels, visible selection and aria-pressed. Selecting a stage preserves search/status/department/position/reviewer filters and resets pagination; selecting it again clears only stage. Clear filters restores active records.

The server's `stageCounts` aggregates all authorized matching records independently of pagination and the current stage selection. List request generations reject stale responses. Candidate names/jobs wrap; empty filtered results offer Clear filters. Filter state is local to the module.

## Permission metadata and selection

`src/server/organisation/permission-registry.ts` owns key, label, description, category, risk, scope and delegation metadata. Browser controls consume API metadata; they do not import server authorization code.

PermissionPicker is shared by creation, editing and inspection. Search is trimmed and case-insensitive across labels, descriptions, categories and raw keys; it combines with category and selected-only filters. Select/Clear visible affect only displayed grantable permissions. Selected capability summaries are derived from actual keys and metadata, never appended to a stored prose description.

System and archived roles have read-only permission controls. Unknown stored keys are displayed as legacy permissions and may be explicitly removed. The server accepts an unknown key only if already stored on that exact role under lock. New unknown grants and re-adding removed keys are rejected. Compatibility does not broaden assignment or delegation authority.

## Saving and authorization

Role fields and permissions use separate existing transactions. After successful creation, the form retains the new role ID so a permission-save retry cannot create a duplicate. Failed/in-flight preloads cannot become an empty submission; superseded requests cannot populate another dialog.

Mutation checks require company roles.manage and permissions.manage, tenant ownership, active custom roles, grant authority and protected/nondelegatable restrictions. UI metadata is presentation only. Audit records store safe IDs and states rather than confidential note bodies.

## Accessibility and verification

Native controls provide keyboard operation, labeled checkboxes, focus indicators and selected-state text. Dialogs trap focus, close with Escape and restore focus. Logical layout and localized interaction strings support Arabic; permission metadata remains English where no translated metadata exists.

Run `npm run test:hiring`, `npm run test:hiring:integration`, `npm run test:hiring-role-ux`, and `npm run test:organisation` against the documented guarded fixture environments. Integration tests must use disposable tenants and retain server authority checks.
