## Demo workspace

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
