# Local Cloudflare Quick Tunnel

To preview local development through a changing HTTPS Quick Tunnel origin, set `ALLOW_TRYCLOUDFLARE_DEV_ORIGINS=true` in the ignored local environment and start `npm run dev`. This origin allowance is explicitly rejected by production server/build startup. No demo-session authentication endpoint or unsigned production identity headers are enabled.

Keep `VITE_API_BASE_URL` empty for same-origin APIs. Set `WEBAUTHN_ORIGIN` to the exact tunnel HTTPS origin and `WEBAUTHN_RP_ID` to its hostname before testing passkeys. Use an isolated database and fictional accounts. Set `TRUST_PROXY_HOPS` only for the actual trusted proxy topology; do not trust arbitrary forwarded headers.

A temporary tunnel is for local development, not a stable production origin. Production requires a configured HTTPS application origin and the ordinary cookie-session login flow.
