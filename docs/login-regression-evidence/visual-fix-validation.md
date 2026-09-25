# Login visual restoration — 2026-09-24

This supersedes the investigation's earlier “not applied” status for the two visual fixes only. Login CPU performance remains unresolved and is not claimed improved.

## Exact changes

- `src/index.css:805–806`: Emerald auth background/text overrides now apply only outside light mode, following the existing theme selector convention. Ring/pulse tokens remain mode-independent. Light mode inherits the existing page/text tokens; no new palette was introduced.
- `src/pages/Login.tsx:559`: Demo Accounts uses constant `opacity-100` and transitions only `grid-template-rows`. The 180 ms duration, easing, reduced-motion handling, background, markup, content, handlers, and accessibility attributes remain unchanged.
- `scripts/theme-test.ts:126,253`: update the existing dark-override assertion and snapshot description.
- `scripts/fixtures/original-theme-rules.json:38–39`: replace only the old unconditional auth rule with the split rules. Dashboard/Geo preset rules are unchanged.

## Browser verification

Used the in-app Chromium browser at approximately 1254 × 918 with current Login code. A temporary, ignored page under `build/login-visual-check` imports the real application and adds a visual-check control. It changes transition duration to 2 seconds only when checked, and samples computed opacity/grid values during actual user-interface toggles. It is not imported by production code and is not a performance benchmark.

Light → dark → light verified visually and through computed styles:

| Layer | Light | Dark |
|---|---|---|
| Auth token | `#f4faf6` inherited from page token | `#020604` |
| Auth shell | `rgb(244, 250, 246)` | `rgb(2, 6, 4)` |
| Card | white at 85% opacity | existing dark green at 70% opacity |
| Toolbar | white at 80% opacity | black at 35% opacity |
| Canvas artwork | pale full viewport with green rings | dark full viewport with green rings |

Demo Accounts checks included slowed expansion and collapse in both modes, eight successive mouse toggles in light mode, and eight rapid keyboard toggles in each mode. The keyboard bursts completed in less than a second and exercised repeated state reversals. Slowed captures sampled 139–140 frames each; panel opacity was exactly `1` throughout and the only transition property was `grid-template-rows`. Both open and closed accessibility states were checked: open role buttons enabled/tabIndex 0; closed buttons disabled/tabIndex -1; `aria-expanded` and `aria-hidden` agree with state. Closed grid ends at `0px`.

No full-panel black flash was observed in the sampled visual checks. Unlike the original recording, role content remains fully opaque while it is clipped by the moving grid boundary. The existing dark fill can still be seen below partially clipped rows during deliberately slowed motion; the styling was intentionally preserved. Computed-style samples are not a frame-by-frame GPU recording, so this result should not be presented as a guarantee for every frame on the user's separate Chrome configuration.

## Automated validation and scope

Passed: TypeScript (`npm run lint`), production build, theme tests, PWA tests, auth-idle isolation tests, and Chrome regression tests. Existing Lexical annotation and large-chunk build warnings remain. The initial typecheck failure came from an investigator-created `.tsx` backup under `build`; renaming it to `.txt` removed the unintended source input and the rerun passed. The initial theme test failure correctly identified the intentional auth-rule change; its snapshot was updated narrowly and the rerun passed.

Before/after hashes confirm FingerprintCanvas, Dashboard, Lanyard, and dev-performance are unchanged by this pass. The CSS diff against the start-of-pass snapshot contains only the auth-token rule split. The Login diff contains only the accordion class change. Authentication handlers, passkeys, demo login actions, localization, and PWA logic were not edited; this pass did not perform credential submission or claim end-to-end authentication testing.
