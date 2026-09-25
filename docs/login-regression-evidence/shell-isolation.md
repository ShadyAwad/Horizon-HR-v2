# Login shell/background isolation — 2026-09-25

No production fix selected. Main-card and Demo Accounts effects were not changed.
Measurements below are computed DOM styles in the embedded Chromium browser on
the running localhost:3000 development server, not a real-Chrome flicker verdict.
User's real Chrome remains the authority for whether an isolation removes the flash.

## Baseline computed background chain

Emerald preset, light intensity 50, `?demoMotion=none`, main-card effect baseline.
Initial viewport height 918px. All listed elements have `background-image: none`
in both themes. Transparent means exactly `rgba(0, 0, 0, 0)`.

| Element | Light background-color | Dark background-color | Position | Min-height | Overflow x / y | z-index / isolation |
| --- | --- | --- | --- | --- | --- | --- |
| html | rgb(244, 250, 246) | rgb(2, 6, 4) | static | 100% | hidden / auto | auto / auto |
| body | rgb(244, 250, 246) | rgb(2, 6, 4) | static | 100% | hidden / auto | auto / auto |
| #root | rgb(244, 250, 246) | rgb(2, 6, 4) | static | 100% | hidden / auto | auto / auto |
| App wrapper | **rgb(2, 6, 4)** | rgb(2, 6, 4) | static | 918px | visible / visible | auto / auto |
| AuthShell | rgb(244, 250, 246) | rgb(2, 6, 4) | relative | 918px | hidden / auto | auto / isolate |
| AuthShell foreground wrapper | transparent | transparent | relative | 918px | visible / visible | 10 / auto |
| Login root | transparent | transparent | relative | 918px | hidden / auto | auto / auto |
| Auth background wrapper | transparent | transparent | fixed | 0px | visible / visible | 0 / auto |
| Canvas wrapper | transparent | transparent | absolute | 0px | hidden / hidden | 0 / auto |
| Canvas element | transparent | transparent | static | 0px | clip / clip | auto / auto |

All listed elements computed opacity 1; transform, filter, backdrop-filter and
contain were none. These values exclude the main card and toolbar. Baseline
Login root computed `justify-content: center` at the desktop breakpoint.
Every inspected ancestor/background-layer ::before/::after computed content none,
transparent background and background-image none: no generated background box was
present in those snapshots. No SVG was present in the decorative auth layer.

Stacking-context interpretation: html establishes the root context; AuthShell
establishes one through isolation; the positioned foreground at z-index 10 and
fixed background at z-index 0 establish contexts, as does the absolute canvas
wrapper at z-index 0. A computed z-index alone is not a GPU layer inspection.

The App wrapper in src/App.tsx uses bg-[#020604] regardless of theme. This is the
one opaque dark ancestor found during light mode. AuthShell normally covers it
with #f4faf6. This establishes a potential exposure color, not proof of a flash.
index.html supplies unlayered root background/min-height rules, including light
intensity variants; src/index.css supplies theme-token background rules. The
reported values are actual computed results, not inferred solely from classes.

FingerprintCanvas uses an opaque (`alpha: false`) Canvas2D context and fills with
the resolved auth background token before drawing its treatment. Its transparent
CSS background does not mean its bitmap is transparent. No canvas code changed.
Tokens measured: light --stanza-auth-background #f4faf6; dark #020604.

## Height/centering experiment

At 1440x1200, with Demo motion disabled and the entrance animation settled:

| Mode | Collapsed card top / height | Expanded card top / height | Collapsed again |
| --- | --- | --- | --- |
| Baseline | 164 / 872px | 32 / 1179.5px | 164 / 872px |
| no-center | 64 / 872px | 64 / 1179.5px | 64 / 872px |

Confirmed no-center in light and dark. In baseline, AuthShell and its foreground
and Login wrappers grow from 1200 to 1243.5px; the fixed background and canvas stay
1200px high at y=0. This confirms layout reaches ancestors and centering repositions
the card. It does not measure raster invalidation or demonstrate a one-frame root
exposure. No Chrome paint-flashing or compositor trace was captured in this pass.
Temporary browser viewport override was reset after inspection.

## DEV controls

Reload URLs; keep other isolation parameters absent. All use demoMotion=none.

- Baseline: http://localhost:3000/?demoMotion=none
- Roots: http://localhost:3000/?demoMotion=none&loginShellTest=root-match
- Centering: http://localhost:3000/?demoMotion=none&loginShellTest=no-center
- Plain shell: http://localhost:3000/?demoMotion=none&loginShellTest=plain-shell
- Background layers: http://localhost:3000/?demoMotion=none&loginShellTest=no-bg-layers

root-match sets only html/body/#root background-color to the auth token and removes
their background images. It deliberately leaves the App wrapper unchanged. Since
the roots already match in this measured preset, a failure of root-match does not
rule out exposure of the dark App wrapper.

no-center changes only desktop Login-root justification to flex-start and top
padding to safe-area inset + 4rem, leaving room for the desktop toolbar.

no-bg-layers hides AuthShell's decorative direct child, removes shell generated
pseudo-content/background images, and retains the opaque auth token background.
The canvas remains mounted but is not displayed, preserving callback ownership.

plain-shell applies the same background removal plus flattens AuthShell's
isolation/clipping and foreground-wrapper stacking. AuthShell becomes the single
opaque auth surface. Login centering, the App wrapper, card and controls remain
unchanged. This is a combined shell control, not an individual-effect attribution.

Rules are scoped by a data attribute present only on Login; the style element is
removed with Login. AuthShell/App source files were not edited. No root attributes
or persistent style mutations are installed. Missing/unknown values are baseline.

## Validation

- All four modes: embedded-browser expand/collapse in light and dark, correct
  shell token, expected decoration visibility and layout; demo transition none.
- Typecheck, production build, theme tests, PWA tests: passed.
- Extended scripts/demo-motion-test.ts: mode parsing, scope, baseline fallback,
  production exclusion passed.
- Actual production JS/CSS scan: no loginShellTest or shell-mode implementation
  strings. Production CSS output hash remained index-a_Z9EmF9.css.
- Existing Lexical annotation and large-chunk build warnings remain.

Real-Chrome flash removal for each mode: **pending user testing**. No production
background, animation, card, Dashboard, Geo or performance changes were made.
