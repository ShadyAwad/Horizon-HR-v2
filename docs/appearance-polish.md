# Appearance and shared UI controls

Theme Studio uses the existing `stanza.preferences.v1` store and a draft/Apply workflow. Appearance updates set root CSS variables; components inherit semantic tokens rather than individual inline font overrides.

## Typography and persistence

Interface Size controls root rem geometry. Font Size independently scales the shared Tailwind text hierarchy through `--stanza-font-scale`: Small 95%, Default 100%, Large 110%, Extra Large 120%. Body, captions and headings scale proportionally. Mobile editable controls retain a 16px minimum. The editor previews heading, body, secondary and caption text before Apply.

Missing or unsupported font values normalize to 100%; invalid custom text colors normalize to Auto. Migration preserves accents, pointer/cursor, navigation and lanyard preferences. Composer layouts and surface preferences have a separate account-scoped store. Pre-render bootstrap restores appearance before React paints; storage events synchronize tabs.

## Text and contrast

`customTheme.textColor` supplies optional primary text. Auto uses mode-aware defaults. Primary text is corrected to at least 4.6:1 against page, card, dialog, input, selection and conservative glass surfaces. Secondary and muted colors are derived and corrected independently; disabled text uses the readable muted token. Action foregrounds use a separate guard. The editor warns when contrast correction is needed while preserving the requested custom color.

Preset switching uses the preset's intended text colors. Returning to Custom restores the saved custom value. The original seven preset backgrounds and accents remain defined in the existing theme system.

## Forms and surfaces

`src/components/ui/FormControls.tsx` provides native Input, Select and Textarea controls with semantic background/border/focus tokens, labels, descriptions, disabled and invalid states. Native selection retains keyboard and assistive-technology behavior. Logical properties and wrapping labels support RTL.

`Surface` supports Auto, Solid and Glass. Auto/Solid are opaque; explicit Glass uses static 4px blur and a 92% surface color on supported desktop browsers. Narrow screens, reduced motion and reduced transparency use an opaque fallback. Backdrop filters are never animated. Composer's WidgetFrame consumes the same presentation contract.

Expenses use shared controls and the authenticated tenant default currency; existing record currency and accounting behavior remain authoritative. Grievance submission has a centered 48rem maximum with full available mobile width and a usable description area.

## Verification

Run `npm run test:appearance`, `npm run test:theme`, and `npm run test:workspace`. For manual regression, combine interface/font scales, check light/dark presets and Custom contrast correction, reload saved settings, and inspect forms/dialogs in English and Arabic at narrow/tablet/desktop widths. Native select popup appearance depends on the browser and operating system.
