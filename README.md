## Local backend smoke test

Start the local Stanza server, then set `SMOKE_TEST_EMAIL` and
`SMOKE_TEST_PASSWORD` in your uncommitted `.env` to a local `hr_admin` account.

```powershell
npm run test:smoke
```

The script checks health, login, notification settings, break requests,
clock-in validation/auth errors, payroll, company feed, grievances, and signup
validation. It uses a signed login token, never prints credentials or tokens,
and labels generated records `Smoke Test`. It cancels its temporary break
request; feed drafts and low-priority grievances remain as harmless fixtures
because those routes do not provide deletion endpoints.
