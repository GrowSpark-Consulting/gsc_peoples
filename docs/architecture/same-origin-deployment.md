# Same-origin deployment architecture

Date: 2026-11-25. Status: **implemented, not yet deployed**.

## 1. Problem

`gsc_session` and `gsc_csrf` are `SameSite=Lax` cookies. The browser sends them only when the cookie's
_host_ matches the request _host_. If the frontend lives on `app.vercel.app` and the API lives on
`gsc-peoples-api.onrender.com` those are unrelated public-suffix hosts; the browser will not share
cookies between them without a custom domain and an explicit `Domain` cookie attribute.

Purchasing a domain is an optional future step. This architecture makes the application fully functional
using the default Vercel and Render hostnames.

---

## 2. Solution: Next.js rewrite proxy

Vercel becomes the **single browser-facing origin**. All browser requests — pages and API calls — go to
`https://gsc-peoples.vercel.app` (or whatever the Vercel project URL is). Next.js rewrites
`/api/v1/*` server-side to the Render API. From the browser's perspective there is only one host.

```
Browser ──/api/v1/*──► Vercel edge (Next.js rewrite)
                              │
                              │  server-to-server (no browser CORS)
                              ▼
                        Render API (gsc-peoples-api.onrender.com)
                              │
                              ▼
                        Supabase PostgreSQL (hr schema)
```

### Cookie flow

```
1. Browser POST /api/v1/auth/login → Vercel rewrite → Render API
2. Render: authenticates, calls res.cookie('gsc_session', ...) and res.cookie('gsc_csrf', ...)
3. Render response: Set-Cookie: gsc_session=...; HttpOnly; SameSite=Lax; Secure; Path=/
                    Set-Cookie: gsc_csrf=...;    SameSite=Lax; Secure; Path=/
4. Next.js rewrite forwards the response (including Set-Cookie headers) to the browser
5. Browser stores both cookies on gsc-peoples.vercel.app (host-only, no Domain attribute)
6. Subsequent requests: browser sends both cookies (same-origin)
7. proxy.ts (middleware) reads gsc_session, calls RENDER_API_URL/me server-to-server to validate
8. API data requests: browser sends gsc_csrf cookie, reads it via JS, adds X-CSRF-Token header
```

### Why COOKIE_DOMAIN must be UNSET

A `Domain` cookie attribute on `gsc-peoples.vercel.app` or `onrender.com` would not work:
browsers reject `Domain` for public suffixes (eTLD+1 rule). Leaving `COOKIE_DOMAIN` unset (empty)
makes cookies _host-only_: they bind to `gsc-peoples.vercel.app` and are automatically sent to
the Vercel rewrite, which proxies them to Render.

---

## 3. Configuration

### Vercel environment variables

| Variable | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `/api/v1` | Relative. Browser requests go to Vercel, which rewrites them. Build fails if unset. |
| `RENDER_API_URL` | `https://gsc-peoples-api.onrender.com` | Server-side only (not `NEXT_PUBLIC_*`). Used by: (1) `next.config.ts` `rewrites()` destination, (2) `proxy.ts` server-side `/me` check. |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` | Use the pinned pnpm version. |

### Render environment variables (changes)

| Variable | Same-origin value | Notes |
|---|---|---|
| `COOKIE_DOMAIN` | **(empty / unset)** | Host-only cookies. Do NOT set this. |
| `CORS_ORIGINS` | `https://gsc-peoples.vercel.app` | The Vercel frontend origin. Browser requests never reach Render directly but set this for operator tooling. |
| `WEB_APP_URL` | `https://gsc-peoples.vercel.app` | Email link base. |
| `TRUST_PROXY_HOPS` | `1` (default in production) | Render's load balancer + Vercel rewrite both add `X-Forwarded-For`. The `app.ts` default of `1` is sufficient; raise to `2` if Render adds an extra hop. |

---

## 4. Code changes

### `apps/web/next.config.ts`
Added `async rewrites()`. When `RENDER_API_URL` is set, every `/api/v1/:path*` request is forwarded
server-side to `${RENDER_API_URL}/api/v1/:path*`. When unset (local dev, E2E scratch tests) no rewrite
is registered.

Updated the production build guard error message to document both deployment modes.

### `apps/web/src/proxy.ts` (Next.js middleware)
Two changes:

1. **`apiUrl` resolution**: reads `RENDER_API_URL` first (absolute, server-side-only). Falls back to
   `NEXT_PUBLIC_API_URL` only when it is an absolute `http(s)://` URL (the relative `/api/v1` value
   must not be used here — middleware runs in Edge Runtime with no localhost). Final fallback: local
   dev default.

2. **`config.matcher`**: changed `api/health$` to `api/` so the middleware excludes ALL `/api/*`
   paths. Without this, the rewritten `/api/v1/*` requests would be intercepted by the middleware,
   which would try to validate them as page navigations and redirect them to `/login`.

### `apps/web/src/config/env.ts`
Added a documentation comment explaining the three valid values of `NEXT_PUBLIC_API_URL`.
Fallback value unchanged (`http://localhost:4000/api/v1`).

### `render.yaml`
Updated `COOKIE_DOMAIN` and `CORS_ORIGINS` comments to document the same-origin constraints.

---

## 5. Security analysis

### Open proxy risk
None. The rewrite destination is `${RENDER_API_URL}/api/v1/:path*` where `RENDER_API_URL` is a fixed
server env var, not user input. A user cannot redirect the rewrite to an arbitrary target.

### CSRF
Unchanged. The browser is on `gsc-peoples.vercel.app`; it sends the `gsc_csrf` cookie (same-origin,
automatic) and reads it via JS to put it in `X-CSRF-Token`. Vercel forwards both the cookie and the
header to Render. The CSRF middleware on Render sees both; it validates them. No change needed.

### HttpOnly session cookie
`gsc_session` has `HttpOnly=true`. It is sent by the browser automatically on same-origin requests and
forwarded by the rewrite. JS cannot read it. No change needed.

### SameSite=Lax
Correct for same-origin. No cross-site POST can carry the cookies. No change needed.

### Rate limiting
`TRUST_PROXY_HOPS=1` is the production default (`app.ts` line 64). Render's load balancer adds
`X-Forwarded-For`; Express trusts 1 hop so `req.ip` is the real client IP. If Vercel's rewrite adds
an additional forwarding hop, raise `TRUST_PROXY_HOPS` to `2`.

### Headers forwarding
Next.js rewrites transparently forward: request method, path, query string, request body, request
headers (including Cookie), and all response headers (including multiple `Set-Cookie`). No special
configuration is needed.

### Preview deployments
Vercel preview URLs are `*.vercel.app` subdomains, not `gsc-peoples.vercel.app`. Cookies from one
Vercel subdomain are not sent to another. Previews will show only the sign-in page (which is correct
behaviour — do not widen CORS or cookies for previews).

---

## 6. Local development

No change. The rewrite only registers when `RENDER_API_URL` is set. In `.env` (local dev):
- `NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1` (absolute URL — browser talks directly to local API)
- `RENDER_API_URL` is **not set** → no rewrite registered → `proxy.ts` falls back to `NEXT_PUBLIC_API_URL`

### E2E scratch tests (`playwright.scratch.config.ts`)
Also unchanged. The scratch test runner starts the API and web on separate local ports. The web server
uses `NEXT_PUBLIC_API_URL=http://localhost:4400/api/v1` (absolute). No rewrite topology. This is
documented as an intentional limitation: the scratch suite tests application logic, not Vercel edge
rewrite behaviour. Rewrite topology is verified by the staging smoke checks.

---

## 7. Staging deployment sequence

1. Push `main` to GitHub (the changes in this working tree).
2. **Render:** in the service's Environment tab:
   - Set `COOKIE_DOMAIN` to **empty** (or delete the variable).
   - Set `CORS_ORIGINS` to `https://<vercel-project>.vercel.app`.
   - Set `WEB_APP_URL` to `https://<vercel-project>.vercel.app`.
   - Deploy the new revision.
3. **Vercel:** in Environment Variables:
   - Set `NEXT_PUBLIC_API_URL` to `/api/v1`.
   - Set `RENDER_API_URL` to `https://gsc-peoples-api.onrender.com` (the Render service URL).
   - Set `ENABLE_EXPERIMENTAL_COREPACK` to `1`.
   - Trigger a new deploy (env vars are baked at build time).
4. **Smoke checks** (see vercel-deployment-guide.md §8):
   - `https://<vercel-project>.vercel.app/api/v1/health` → `{"status":"ok"}`
   - Login sets two cookies on `<vercel-project>.vercel.app`, not on `onrender.com`.
   - `gsc_session` is HttpOnly (not visible in JS); `gsc_csrf` is JS-readable.
   - Reload a protected page — the page loads (middleware validates via RENDER_API_URL).
   - POST a mutation — CSRF header is sent and accepted.
   - Logout clears both cookies.

---

## 8. Rollback

To revert to cross-origin mode (requires a custom domain):
1. On Vercel: set `NEXT_PUBLIC_API_URL=https://api.<domain>/api/v1`, unset `RENDER_API_URL`, redeploy.
2. On Render: set `COOKIE_DOMAIN=.<domain>`, `CORS_ORIGINS=https://app.<domain>`, redeploy.

To revert same-origin to a prior Next.js build on Vercel: Deployments → previous → Promote to
Production. `NEXT_PUBLIC_API_URL` is baked in that build; it will re-use the value it was built with.
