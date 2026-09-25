# Demo Accounts surface restoration — 2026-09-25

The user's second real-Chrome recording disproves sufficiency of the previous opacity-only fix. This pass changes only the Demo Accounts presentation in `src/pages/Login.tsx`, plus this report and ignored local inspection artifacts. No CSS theme architecture, canvas, performance, Dashboard, or Geo code was changed.

## New recording and historical comparison

Inspected `Login — Stanza - Google Chrome 2026-09-24 15-46-17.mp4` locally: 21.003 seconds, 1920 × 1040, approximately 30 recorded frames/second. Around 15.986–16.053 seconds the light-mode rows are clipped away while a dark block remains. At 16.086 seconds there is also a dark strip below the card and a change in the surrounding card appearance. The recording establishes the remaining visual problem; it does not prove every artifact is caused by panel fill rather than another painting/compositing path.

`0bd1c7d` used a transparent inner grid panel, one parent background, no parent isolation, and no trigger pressed scale. `overflow-hidden` on the min-height-zero child predates the regression. Grid height interpolation necessarily moves the clip boundary; removing opacity alone did not remove the solid dark area behind that boundary. Two identical opaque fills also cannot by themselves explain an extra-black pixel. The restoration therefore fixes background ownership and light-mode colors, without claiming a browser compositor diagnosis.

## Exact class changes

| Element / line | Previous unconditional treatment | Current treatment |
|---|---|---|
| Outer container, 533 | `bg-[#061f17]` | `bg-white/80 dark:bg-[#061f17]` |
| Outer border/shadow, 533 | `border-emerald-500/25`, pale inset shadow | `border-emerald-200`; previous border/shadow only under `dark:` |
| Inner grid, 559 | `bg-[#061f17]` | `bg-transparent` |
| Trigger, 542 | background/transform transition and `active:scale-[.99]` | explicit transparent base; background-color transition only; no pressed scale |
| Trigger hover/focus, 542 | light-on-dark Emerald treatment in both modes | light `hover:bg-emerald-50` / Emerald-600 focus; previous values under `dark:` |
| Trigger icon, 544 | Emerald-300 foreground / tinted dark-mode chip | Emerald-700 on Emerald-50 with Emerald-200 border; previous values under `dark:` |
| Title, 548 | `text-[#DDF8EE]` | `text-slate-900 dark:text-[#DDF8EE]` |
| Subtitle/chevron, 549/552 | Emerald-200 alpha foreground | Emerald-700 in light mode; previous values under `dark:` |
| Unselected rows, 576 | `bg-black/20 text-emerald-50/90` | `bg-white/80 text-slate-900`; previous values under `dark:` |
| Selected rows, 576 | `bg-emerald-500/15 text-emerald-50` | `bg-emerald-100 text-slate-900`; previous values under `dark:` |
| Row borders/hover/focus, 576 | dark-mode Emerald values | light Emerald-200 border, Emerald-400 hover border, Emerald-50 hover surface, Emerald-600 focus; previous dark values retained |
| Row icon chips, 578 | `bg-black/20` or `bg-emerald-400/15`, pale Emerald text | light Emerald-50/100 chips with Emerald-700/800 text; previous values under `dark:` |
| Descriptions/note, 583/591 | `text-emerald-100/55` or `/45` | `text-slate-600`; previous values under `dark:` |
| Action labels, 585 | `text-emerald-200` | `text-emerald-700 dark:text-emerald-200` |

Removed outer `isolate`, matching the historical stacking behavior. The inner panel remains opacity 1 and animates only grid rows at the existing 180 ms duration/easing. Existing overflow clipping, chevron indicator, content, localization, disabled/tab-order behavior, ARIA state, and auth handlers are retained. Hover transitions list explicit color properties; no `transition-all` was added. The outer `bg-white/80` also continues to match the existing non-Emerald auth-surface token selector; the transparent panel does not match that selector.

## Background ownership and verification

The outer `data-login-demo-benchmark` container is the sole background owner for the expanding area. The grid and its clipping wrapper are transparent. Thus blank space created during track interpolation shows the surrounding container surface, without a second differently themed panel fill. Individual role rows still have their intended themed surfaces.

Available browser inventory exposed only Codex's in-app Chromium browser, not a connected Google Chrome session. Tested light expansion, light collapse, dark expansion, dark collapse with a temporary two-second duration override on an ignored QA page importing the real application. Also tested eight rapid keyboard toggles in light mode and repeated normal-speed mouse toggles (eight in dark, six in light). No credentials were submitted.

| Trial | Sampled frames | Panel background throughout | Outer background throughout | Final state |
|---|---:|---|---|---|
| Light expansion | 139 | transparent | white / 80% | open |
| Light collapse | 139 | transparent | white / 80% | closed |
| Dark expansion | 140 | transparent | `rgb(6, 31, 23)` | open |
| Dark collapse | 139 | transparent | `rgb(6, 31, 23)` | closed |
| Dark repeated mouse toggles | 148 | transparent | `rgb(6, 31, 23)` | closed |
| Light repeated mouse toggles | 115 | transparent | white / 80% | closed |

All sampled panel opacities were 1 and transition properties were grid-template-rows only. The open role controls were enabled with tabIndex 0; closed controls were disabled with tabIndex -1, matching aria-expanded/aria-hidden. Light-mode screenshots show light rows, legible dark text, and Emerald icons/actions; dark mode retains the previous green surface and row colors. No mismatched dark panel was observed in these local light-mode checks.

**Real-Chrome black-flash status: not yet verified after this change.** The supplied video is before this restoration. Local computed-style samples and screenshots are not proof that the separate Chrome rendering issue is gone, especially the strip outside the demo component. Do not claim that the new fix has passed a post-change real-Chrome recording.

Passed TypeScript, production build, theme tests, PWA tests, and whitespace checks. Existing Lexical annotation and large-chunk build warnings remain. Before/after hashes confirm FingerprintCanvas, Dashboard, Lanyard, dev-performance, and index.css are unchanged by this pass. No Login CPU improvement is claimed.
