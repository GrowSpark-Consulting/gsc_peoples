# Vercel deployment guide: web app

Date: 2026-11-25. **Nothing has been created or deployed.** Supersedes `docs/deployment/vercel-frontend-setup.md`.

Two deployment topologies are supported. **Same-origin** (recommended, no domain purchase needed) and
**cross-origin** (requires a custom domain). See
[docs/architecture/same-origin-deployment.md](../architecture/same-origin-deployment.md) for the full
architecture, security analysis and rollback procedure.

---

## 1. Topology A — Same-origin (recommended, default)

Vercel is the single browser-facing origin. The browser never talks directly to Render; Next.js rewrites
`/api/v1/*` server-side to the Render API. Cookies are host-only on the Vercel domain. No custom domain
or `COOKIE_DOMAIN` is needed.

```
Browser → https://gsc-peoples.vercel.app/api/v1/* → [Next.js rewrite] → Render API
```

### Project settings

| Setting | Value |
|---|---|
| Repository / production branch | `GrowSpark-Consulting/gsc_peoples` / `main` |
| Framework preset | Next.js (16.4.6) |
| Root directory | `apps/web`, with "Include files outside the Root Directory in the Build Step" **on** |
| Install command | default (pnpm workspace, from the root lockfile) |
| Build command | default (`next build`, the package `build` script) |
| Output directory | default |
| Node.js version | 22.x |
| Function region | Mumbai `bom1` (or Singapore `sin1`) |
| Production deploys from git | enable only after release approval |

No `vercel.json` is needed.

### Environment variables (Topology A)

| Variable | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `/api/v1` | **Relative path.** Browser requests go to Vercel's own domain and are rewritten. Build fails if unset. Baked at build time — redeploy to change. |
| `RENDER_API_URL` | `https://gsc-peoples-api.onrender.com` | **Server-side only** (not `NEXT_PUBLIC_*`). Used by: (1) `next.config.ts` rewrite destination, (2) `proxy.ts` server-side `/me` check. |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` | Use the pinned pnpm version. |

No secrets. Do not set `NEXT_PUBLIC_EMPLOYEES_ADAPTER`.

### Render changes required (Topology A)

| Variable | Value |
|---|---|
| `COOKIE_DOMAIN` | **(empty / unset)** — host-only cookies; do NOT set a value |
| `CORS_ORIGINS` | `https://gsc-peoples.vercel.app` (the Vercel app URL) |
| `WEB_APP_URL` | `https://gsc-peoples.vercel.app` |

---

## 2. Topology B — Cross-origin (requires a custom domain)

Both apps run on subdomains of a domain you control. Cookies use `COOKIE_DOMAIN=.<domain>` to span
both subdomains. This was the original design; it requires purchasing and configuring a domain.

```
Browser → https://app.<domain>/api/v1/* → (direct cross-origin request) → https://api.<domain>/api/v1/*
```

### Environment variables (Topology B)

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://api.<domain>/api/v1` |
| `RENDER_API_URL` | (unset — no rewrite needed) |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` |

### Render changes required (Topology B)

| Variable | Value |
|---|---|
| `COOKIE_DOMAIN` | `.<domain>` |
| `CORS_ORIGINS` | `https://app.<domain>` |
| `WEB_APP_URL` | `https://app.<domain>` |

---

## 3. Preview deployments

Preview hosts are `*.vercel.app` subdomains distinct from the production Vercel URL. Cookies from the
production host are not sent to preview hosts. Previews will show only the sign-in page. Disable
previews or accept this limitation. Never add wildcard CORS or a second database role for them.

---

## 4. Behaviour to know

- Every non-public page first calls `GET /me` via `proxy.ts` (the Next.js middleware). In Topology A
  this is a server-to-server call from Vercel's edge to Render, using `RENDER_API_URL`. These calls
  come from Vercel's shared IP addresses and count against the API's per-IP rate limit (600/min by
  default). For up to ~100 people this has headroom; raise `RATE_LIMIT_PER_MINUTE` on Render if you
  see 429 responses.
- API unreachable → pages answer 503. Invalid/expired session → redirect to `/login?next=...`.
- Security headers are set by `next.config.ts` (framing denied, nosniff, HSTS, no referrer on the
  token pages). A full script Content-Security-Policy is not configured.

---

## 5. Checks after the first deploy (Topology A)

1. Build log shows pnpm 10.34.9, `NEXT_PUBLIC_API_URL=/api/v1`, `RENDER_API_URL=https://...`, no
   missing-variable error.
2. `https://gsc-peoples.vercel.app/api/v1/health` returns `{"status":"ok",...}` (goes through the
   rewrite to Render).
3. Sign in → two cookies set on `gsc-peoples.vercel.app`:
   - `gsc_session`: **HttpOnly** (not visible in JS).
   - `gsc_csrf`: JS-readable (`document.cookie` shows it).
4. Reload a protected page — page loads (middleware validated via `RENDER_API_URL`).
5. POST a mutation — CSRF header is sent and accepted by Render.
6. Sign out → both cookies cleared.
7. Navigate to a protected URL after logout → redirected to `/login`.
8. Response headers include `X-Frame-Options: DENY`; `/reset-password` has `Referrer-Policy: no-referrer`.
9. Browser bundles contain `/api/v1` and no absolute Render URL, no secrets.

---

## 6. Rollback

Vercel: Deployments → previous good deployment → Promote to Production. `NEXT_PUBLIC_API_URL` is baked
into each build; a rollback restores the value from that build.

To switch between Topology A and B: change `NEXT_PUBLIC_API_URL` (and add/remove `RENDER_API_URL`) and
trigger a new deploy. Update Render env vars to match.

---

## 7. Verification status

Verified locally: typecheck, lint, unit tests, integration tests, E2E scratch tests, production
`next build` with `NEXT_PUBLIC_API_URL=/api/v1`, rewrite logic (no rewrite when `RENDER_API_URL` is
unset), middleware matcher excludes `/api/*` paths.

**Not verified on hosted infrastructure:** Vercel edge rewrite behaviour, actual cookie forwarding
through Vercel's CDN, Render's `X-Forwarded-For` count with Vercel as an upstream, real TLS cookies.
