# Prompt 5 — Appearance and shared surface polish

## RECOVERED STATE
Preserved the current uncommitted Prompt 4 Communications and Workspace Composer foundation. Inspected Theme Studio, presets, typography/CSS variables, interface scaling, form controls, Expenses, grievance submission, localization, and preference normalization before editing. Reused the existing preference key, theme derivation/contrast guard, draft/Apply workflow, native controls, and Composer surface preferences. No commit or database migration.

## TYPOGRAPHY ARCHITECTURE
`--stanza-font-scale` scales shared Tailwind `--text-xs` through `--text-9xl`, body text, shared presentation CSS, and the three legacy compact pixel label utilities. The rem hierarchy remains proportional. Interface Size still owns root rem geometry. Mobile editable controls retain a 16px minimum to avoid input-focus zoom. Shared navigation, command, and preference labels wrap instead of truncating important content.

## FONT SIZE
Small 95%, Default 100%, Large 110%, Extra Large 120%. Available in Personalisation on mobile/desktop and in the existing Theme Studio. A heading/body/secondary/caption preview updates immediately. Help descriptions have unique IDs.

## INTERFACE SCALE INTERACTION
Browser checked 85% interface + Large font, 100% + Large, 120% + Default, and 120% + XL at 390px. No page overflow. Settings also checked all Default/Large/XL fonts at 390, 768, and 1440px.

## TEXT COLOR / CONTRAST
One optional `customTheme.textColor`; Auto preserves existing defaults. Primary text is corrected to at least 4.6:1 across page, card, raised/dialog, input, selected/hover and conservative Glass surfaces. Secondary and muted are derived and independently corrected; disabled inherits the readable muted token. Action foregrounds retain their separate existing guard. The existing visible contrast-adjustment warning explains that the requested color is saved. Black-on-dark and white-on-light were corrected in-browser.

## PRESETS
All seven original preset backgrounds and accents are preserved. Mode-aware shared primary/secondary/muted values protect preset text. Tests check every preset against its light/dark surfaces; browser switching checked all seven modes. Switching back to Custom restores its saved text color.

## SHARED SURFACE PRIMITIVE
`Surface` exposes Auto/Solid/Glass through `.stanza-surface` and `data-surface`; WidgetFrame consumes that same CSS contract while retaining its article/ref/drag geometry. Auto and Solid are opaque. Explicit Glass uses static 4px blur and 92% surface color on supported desktop browsers. Mobile, reduced-motion, and reduced-transparency fall back to opaque/no blur. No global conversion or animated blur.

## EXPENSE UI
Native shared Select/Input/Textarea support ordinary native attributes, labels, descriptions, errors, disabled states, keyboard operation, focus-visible, and RTL. Expense filters, currency/category/date/details and dialog controls use semantic tokens. The existing authenticated, tenant-scoped own-claims response supplies tenant default currency. New claims use that value rather than hard-coded EGP; reset uses the current default. Record currency, decimal-string amount formatting, OCR edit protection, validation, approval, and reimbursement logic remain intact. Empty category and error guidance remain localized; category administration is unchanged.

## GRIEVANCE WIDTH POLISH
Submission is centered with a 48rem maximum and full available mobile width. CTA is content-sized and wrapping-safe. Description has six rows and a 10rem editing minimum; priority has an accessible label. Existing grievance logic is unchanged.

## RESPONSIVE / RTL
Arabic module layouts measured at 390/768/1440px with Default/Large/XL fonts; no document overflow. Expenses, grievance submission, Composer, Communications, Settings, and navigation checked. Arabic expense selects retain RTL direction; the native date control remains usable. The command palette fits at desktop and 390px and arrow keys update the active command.

## ACCESSIBILITY
Native labeled keyboard controls, selected options, unique descriptions, visible focus outlines, error text plus dashed invalid borders, wrapping buttons, and readable semantic disabled text. No status is conveyed solely through color.

## PERFORMANCE
Root variable updates and finite React preference updates follow the existing provider. No new observer, RAF loop, timer, per-element sizing, or animated backdrop-filter. Existing performance and cursor idle/cleanup suites pass.

## PERSISTENCE / MIGRATION
Same `stanza.preferences.v1` key. Missing/unsupported font values become 1; missing/invalid text color becomes Auto. Existing accent, pointer/cursor, lanyard, navigation, and separate Composer surface preferences are preserved. Pre-render bootstrap restores bounded font/interface variables. Storage-event synchronization includes font scale. Browser reload verified font 120% independently of interface 105%; custom #AABBCC reload retained primary #AABBCC with derived secondary/muted values. Verification restored English/dark/Emerald, font/interface defaults, Auto custom text, and the initially empty workspace.

## FILES CHANGED
Prompt 5 changes only (the working tree also contains the earlier Prompt 4 files):
- package.json
- public/stanza-bootstrap.js
- src/lib/typography.ts
- src/lib/StanzaPreferencesContext.tsx
- src/lib/custom-theme.ts
- src/lib/LanguageContext.tsx
- src/index.css
- src/components/ui/FormControls.tsx
- src/components/ui/FontSizeControl.tsx
- src/components/ui/Surface.tsx
- src/components/CustomThemeEditor.tsx
- src/components/expenses/ExpensesPanel.tsx
- src/server/expenses/expense-routes.ts
- src/components/workspace-composer/WidgetFrame.tsx
- src/components/workspace-composer/composer.css
- src/components/communications/communications.css
- src/pages/Dashboard.tsx
- scripts/appearance-test.ts
- scripts/theme-test.ts
- scripts/workspace-test.ts
- docs/appearance-polish.md
- docs/appearance-theme-studio.png

## TESTS
Passed: npm run lint; npm run build; test:appearance (2,880 custom contrast assertions plus all light/dark preset text surfaces); test:theme (includes custom cursor); test:workspace; test:expenses (23); test:navigation; test:command-palette; test:architecture (11); test:performance (110); test:communications (real PostgreSQL/Redis/BullMQ with fake email provider); test:communications:sessions; git diff --check.
The session suite first failed against its default inactive port 3005 and passed when pointed at running port 3007. Existing legacy token-parity test excludes only the newly introduced disabled token; its original hash remains unchanged. Composer fallback check now reads the shared stylesheet. Build retains existing Lexical annotation and large-chunk warnings. The session suite's optional authorization cross-tenant assignment check skips without its optional fixture ID; Communications integration tenant-isolation checks pass. No external email sent.

## BROWSER VERIFICATION
Production app on localhost:3007, current in-app browser. Default/Large/XL matrix, interface/font interactions, reload persistence, all preset modes, custom color correction and retention, light/dark, Arabic RTL, expense currency/category selections and receipt/details dialogs, grievance width, Composer and Communications layouts, and command palette keyboard behavior checked. A temporary attendance widget verified Glass: mobile no blur/opaque; desktop 4px blur/92% surface. Solid had no blur. Temporary widget removed. Screenshot captures the existing Theme Studio with the added font control and preview.

## REMAINING LIMITATIONS
Native select popup rendering follows the browser/OS. The signed-in account had no expense records, so populated expense tables/currency display were covered by existing contracts rather than new browser records. Reduced-transparency/motion fallback is covered by CSS contract tests; OS preference toggles were not emulated. Browser checks used one browser engine. Existing build warnings remain. No Prompt 6/7/8 work, accounting redesign, Communications expansion, or commit.

