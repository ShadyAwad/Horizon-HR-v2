# Transactional email

Stanza sends welcome and password-reset emails with Resend when these server-only
environment variables are configured:

```env
RESEND_API_KEY=re_...
EMAIL_FROM="Stanza <onboarding@example.com>"
APP_BASE_URL=https://app.example.com
```

For local testing, Resend's `onboarding@resend.dev` sender can be used where the
account permits it. A branded production sender requires a verified domain.

When Resend is not configured outside production, Stanza logs the password-reset
link to the server console and returns a development-only fallback flag. Production
never logs reset links or sends provider errors to the browser.

Do not use `VITE_RESEND_API_KEY`: every `VITE_` variable is exposed to the browser.
