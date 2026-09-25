# DEV Demo Accounts motion isolation — 2026-09-25

Production animation has not been replaced. Every existing Login className expression is unchanged from the start of this pass. Colors, borders, typography, auth/theme fixes, and handlers remain intact; only build-gated diagnostic refs, CSS, and a pre-toggle capture call were added. Hash checks confirm index.css, FingerprintCanvas, Dashboard, Lanyard, and dev-performance are unchanged.

## Modes

Append these query parameters to the existing **development** Login URL and reload. They do nothing in production.

| Query | Behavior |
|---|---|
| `?demoMotion=grid` or no query | Existing 0fr/1fr grid animation, unchanged. |
| `?demoMotion=none` | All transitions/animations inside Demo Accounts disabled, including trigger/chevron. Expanded/collapsed grid state changes immediately; subtree remains mounted. |
| `?demoMotion=max-height` | Panel uses block layout, no grid track, overflow hidden, and only a max-height transition. Open height is measured from the natural content scrollHeight; closed height is zero. Existing duration/easing retained; no opacity transition. |

Unknown modes fall back to grid. Max-height is measured again on content resize/wrapping/localization through a ResizeObserver, without extra React state. Reduced-motion preference is respected. No alternate implementation is conditionally mounted; these modes modify the same DOM panel. No arbitrary large height constant or timing guess is used.

## Optional render/mount diagnostics

Add `&demoTrace=1` to one of the URLs. Omit it for the first visual trials, because bounding-box/style reads can affect rendering timing. This diagnostic is separate from the existing performance code and is silent/unarmed by default.

The console prints JSON under `[demo-motion-trace]`. Up to 100 records are retained in `window.__stanzaDemoMotion`; inspect or copy them in Chrome DevTools:

```js
copy(JSON.stringify(window.__stanzaDemoMotion, null, 2))
```

Each toggle captures 350 ms, including pre-toggle geometry. At most 40 captures run concurrently. Records contain:

- `renderCalls` and `committedRenders`: Login counts, since the demo parent is inline JSX, not a separate React component. Initial StrictMode render/effect replay must not be mistaken for an actual DOM remount.
- Stable node identities for the card, demo parent, panel, and content; retained descendant checks. Different IDs or detached/replaced descendants provide DOM-remount evidence. Effect cleanup/setup events identify lifecycle boundaries but alone are not remount proof in StrictMode.
- `overlappingToggles`: rapid-toggle captures overlap, so their render counts include later toggles in the capture window. Use isolated single toggles for per-toggle attribution.
- Per-frame card height/top, panel height, opacity, and `cardGeometryChanged`. This detects geometry propagation to the Login card. It does **not** measure the scope of style invalidation, paint, rasterization, or compositor activity; the report explicitly says paint invalidation is unmeasured.

## Required real-Chrome matrix — pending

The available browser inventory exposed only the in-app browser, no native apps or connected Google Chrome. Therefore the requested real-Chrome matrix was not executed, and no mode is declared flicker-free. The latest supplied recording (`Login — Stanza - Google Chrome 2026-09-25 00-14-56.mp4`, 41.241 seconds, 1920 × 1040) predates the new modes; its overview confirms the restored light surfaces and repeated demo interactions, not comparative mode results.

For each mode, use the same Chrome window, viewport, zoom, theme, and reduced-motion setting. Keep the tab visible, close the existing Login benchmark, and remove other isolation flags. Use the actual existing development server, not the production build or old cached assets.

1. Set **light** mode. Reload with the selected `demoMotion` query, initially without `demoTrace`.
2. Expand once, let it settle, collapse once, let it settle, then rapidly toggle **10 times**. Record the screen with the URL/mode identifiable.
3. Repeat in **dark** mode. Repeat steps 1–3 for none, max-height, and grid.
4. Separately repeat isolated toggles with `demoTrace=1`; save the console JSON. Wait at least 350 ms between the isolated toggles. Then capture a 10-toggle burst if investigating overlap.
5. For parent repaint attribution use Chrome DevTools Rendering → Paint flashing and a Performance capture during an isolated toggle. Keep DevTools docking/viewport consistent. Compare Recalculate Style, Layout, Paint/raster, and compositor activity for the same card region. Changing geometry is not equivalent to a full-card repaint.

| Mode | Light expand / collapse / 10 toggles | Dark expand / collapse / 10 toggles |
|---|---|---|
| none | Pending real Chrome | Pending real Chrome |
| max-height | Pending real Chrome | Pending real Chrome |
| grid | Pending controlled baseline | Pending controlled baseline |

If only the animated modes flash, that supports the transition/rendering path; it does not independently prove a particular Chrome interpolation bug. If max-height is consistently clean while grid flashes, propose the measured max-height implementation for production. If none flashes too, compare retained node IDs and parent paint evidence before changing animation again. None also disables hover/chevron transitions, so its success alone would not uniquely implicate the grid track.

## Implementation validation (not flicker results)

- Typecheck, production build, theme tests, PWA tests, and the new demo-motion tests passed. Existing Lexical annotation and bundle-size warnings remain.
- Production-exclusion tests and a search of built JavaScript found no trace implementation markers/query handling. A module-level query read initially survived tree shaking; it was build-gated and the exclusion test then passed.
- Embedded-browser **functional smoke checks only** verified max-height computes block/no-grid/opacity-1 with a measured 308 px target for 307.5 px content, closes to zero, and none computes transition-property none throughout the demo descendants.
- Isolated light toggles in smoke checks (max-height open/close, none open/close, grid open) reported two render calls / one committed render, stable card/parent/panel/content identities, and retained descendants. Card height changed from 872 to 1179.5 px on opening. This validates the instrumentation; it is not a finding from the affected Chrome instance.

Files: `src/components/dev/demo-motion.ts` (mode parser/scoped CSS), `src/components/dev/use-demo-motion.ts` (measured max-height and opt-in diagnostics), `src/pages/Login.tsx` (build-gated integration), `scripts/demo-motion-test.ts` (mode and production-exclusion checks).
