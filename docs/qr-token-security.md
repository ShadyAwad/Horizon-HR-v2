# QR token security

Stanza QR codes contain only a canonical application URL and a 256-bit,
URL-safe random token. PostgreSQL stores the SHA-256 token hash, never the
plaintext token or a rendered QR image. Tokens are purpose-bound, revocable,
rotatable, tenant-scoped, and resolved against current server data.

`APP_BASE_URL` is the sole source for encoded URLs. Production requires an HTTPS
origin. Request `Host` and forwarded-host headers are never used to construct
QR URLs.

Bearer QR URLs can still appear in browser history, screenshots, printed labels,
and camera previews. Public resolution responses use `Referrer-Policy:
no-referrer` and `Cache-Control: no-store`; future verification pages must avoid
third-party resources, analytics containing URL paths, token-bearing page
titles, and unnecessary display of the token itself. Employee and asset tokens
must remain revocable. Onboarding tokens are short-lived and single-use.
