## Local development and production preview

Configure PostgreSQL/Redis and the other required server settings in your local
`.env` before starting. Keep `VITE_API_BASE_URL` empty for same-origin API requests.

| Command | URL by default | What runs |
|---|---|---|
| `npm run dev` | `http://localhost:3000/` | Express APIs, Vite middleware/HMR and the background worker |
| `npm run build`, then `npm start` | `http://localhost:3000/` | Built frontend and Express APIs from one production-mode server |
| `npm run preview:full` | `http://localhost:3000/` | Builds, then runs `npm start` |
| `npm run preview:frontend` (or existing `npm run preview`) | `http://localhost:4173/` | Vite's frontend-only preview; no Express API |

For full-stack production testing, stop the dev server using port 3000, then run:

```powershell
npm run preview:full
```

Use **http://localhost:3000/** for Login, sessions and passkeys. The shorter
`npm start` command reuses an existing build. Rebuild after frontend/server edits
or changes to build-time `VITE_*` variables. Production reads `.env`; the local
`.env.development.local` overrides apply only in development. Full production
preview does not automatically launch the background worker.

Express reads `PORT` (default `3000`) and serves `dist/assets`, other static assets
and the SPA fallback after its API routes. Client routes such as `/reset-password`
therefore still load on a direct visit or refresh. API checks include
`/api/system/health` and `/api/auth/session`; production health is a minimal
liveness response, so successful Login is the database-backed check.

Vite preview remains useful for frontend-only rendering diagnostics. It cannot
authenticate or restore sessions by itself. Do not set a cross-origin production
API URL, broaden CORS, or relax cookie/CSRF settings to work around this; use the
Express preview instead. There is deliberately no preview proxy.

### Local origins and passkeys

The default settings are `APP_BASE_URL=http://localhost:3000`,
`WEBAUTHN_RP_ID=localhost`, and `WEBAUTHN_ORIGIN=http://localhost:3000`.
WebAuthn verification uses the exact configured origin, including the port;
the RP ID is a hostname, without a port. Using `localhost:4173` is a different
origin and does not match the default passkey configuration.

If you deliberately run Express on another local port, set `PORT`,
`APP_BASE_URL` and `WEBAUTHN_ORIGIN` consistently for that server process and
open that exact URL. Keep the RP ID `localhost` when using the localhost host.
For example, while leaving development on 3000:

```powershell
$env:PORT='3001'
$env:APP_BASE_URL='http://localhost:3001'
$env:WEBAUTHN_ORIGIN='http://localhost:3001'
npm run preview:full
```

Use a separate terminal for these overrides, or remove them afterwards before
returning to port 3000. Public deployments still use their configured HTTPS origin.
No authentication, same-origin, CORS, cookie or WebAuthn validation is changed by
these preview scripts.

## Demo workspace

Architecture references:

- [`docs/architecture.md`](docs/architecture.md) maps runtime and domain ownership.
- [`docs/architecture-walkthrough.md`](docs/architecture-walkthrough.md) follows real Stanza requests from React through RLS-backed SQL.

Create or refresh the safe local demo workspace:

```powershell
npm run db:seed:demo
```

Remove only the `stanza-demo` tenant and its dependent demo data:

```powershell
npm run db:reset:demo
```

Demo accounts use the emails seeded by the script. Set `DEMO_PASSWORD` only in
your local demo environment; it is intentionally never printed or documented.
Demo accounts are public portfolio fixtures. Do not use real sensitive data in demo mode.

## Local backend smoke test

Start the local Stanza server, then set `SMOKE_TEST_EMAIL` and
`SMOKE_TEST_PASSWORD` in your uncommitted `.env` to a local `hr_admin` account.

```powershell
npm run test:smoke
```

The script checks health, login, notification settings, break requests,
clock-in validation/auth errors, payroll, company feed, grievances, and signup
validation. It uses an HttpOnly session cookie, never prints credentials or tokens,
and labels generated records `Smoke Test`. It cancels its temporary break
request; feed drafts and low-priority grievances remain as harmless fixtures
because those routes do not provide deletion endpoints.
