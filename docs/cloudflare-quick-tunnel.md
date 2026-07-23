# Local Cloudflare Quick Tunnel

Stanza can accept a changing Cloudflare Quick Tunnel hostname only in an
explicit local demo environment. Add these non-secret values to the ignored
`.env.development.local` file:

```env
STANZA_DEMO_ENV=true
ENABLE_PORTFOLIO_DEMO_SESSION=true
ALLOW_TRYCLOUDFLARE_DEV_ORIGINS=true
VITE_ENABLE_DEMO_LOGIN=false
VITE_API_BASE_URL=
TRUST_PROXY_HOPS=0
```

Then start Stanza and the tunnel in separate terminals:

```powershell
npm run dev
cloudflared tunnel --url http://127.0.0.1:3000 --protocol http2
```

Open the generated `https://*.trycloudflare.com` URL. The frontend and API must
use that same hostname; do not configure a separate API origin.

The tunnel allowance is disabled by default, accepts only HTTPS Quick Tunnel
hostnames ending exactly in `.trycloudflare.com`, and is rejected when Stanza
starts or builds in production mode. Production deployments must use their
fixed configured origin and proxy topology instead.
