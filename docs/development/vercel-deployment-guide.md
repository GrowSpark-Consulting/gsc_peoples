# Vercel deployment guide: web app

Date: 2026-11-25. **Nothing has been created or deployed.** Supersedes `docs/deployment/vercel-frontend-setup.md`.

## 1. The one architectural requirement: a shared parent domain

The API sets `gsc_session` and `gsc_csrf` as `SameSite=Lax` cookies. The web app's server gate (`proxy.ts`) reads the
session cookie on the web host, and browser code reads the CSRF cookie there. So both apps must be subdomains of one
domain you control:

- web `https://app.<domain>` (Vercel), API `https://api.<domain>` (Render custom domain),
- Render: `COOKIE_DOMAIN=.<domain>`, `CORS_ORIGINS=https://app.<domain>`, `WEB_APP_URL=https://app.<domain>`.

**Sign-in does not work on `*.vercel.app` plus `*.onrender.com`.** Those are unrelated sites and the browser will not
share the cookies. Choosing the domain is a required decision before go-live.

## 2. Project settings

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
| Domain | `app.<domain>` |
| Production deploys from git | enable only after release approval |

No `vercel.json` is needed and none was added: framework, commands and workspace packages
(`transpilePackages`) are already defined by the repository. Static export is not possible (server `proxy.ts`).

## 3. Environment variables

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://api.<domain>/api/v1` (build time; redeploy to change) |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` (use the pinned pnpm version) |

No secrets. Do not set `NEXT_PUBLIC_EMPLOYEES_ADAPTER`.

## 4. Preview deployments

Preview hosts are `*.vercel.app`: sessions cannot work there and the API's exact-origin CORS rejects them. Disable
previews, or accept that they only show the sign-in page. Never add wildcard CORS or a second database role for them.

## 5. Behaviour to know

- Every non-public page first calls `GET /me` from Vercel's servers. These calls come from a few shared IP
  addresses and count against the API's per-IP limit (600 a minute by default). For up to about 100 people this has
  headroom; raise `RATE_LIMIT_PER_MINUTE` on Render if you see 429 responses.
- API unreachable → pages answer 503. Invalid session → redirect to `/login?next=...`.
- Security headers are set by `next.config.ts` (framing denied, nosniff, HSTS, no referrer on the token pages).
  A full script `Content-Security-Policy` is not configured.

## 6. Checks after the first deploy

1. The build log shows pnpm 10.34.9 and no missing-variable error.
2. `https://app.<domain>/api/health` returns `{"status":"ok",...}`.
3. Sign in, reload, navigate, sign out; a protected URL afterwards redirects to sign-in.
4. Response headers include `X-Frame-Options: DENY`; `/reset-password` has `Referrer-Policy: no-referrer`.
5. Browser bundles contain the production API URL and no other secret.

## 7. Rollback

Deployments → previous good deployment → Promote to Production. `NEXT_PUBLIC_API_URL` is baked into each build, so a
rollback restores the URL that build used.

## 8. Verification status

Verified locally: typecheck, tests, lint, a production `next build` from a clean copy with only
`NEXT_PUBLIC_API_URL` set, refusal to build without it, and browser tests against `next start`. **Not verified:**
anything on Vercel itself, the custom domain and cross-subdomain cookies over real TLS.
