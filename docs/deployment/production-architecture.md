# Production architecture: GSC Peoples (Render + Vercel + Supabase)

Status: PREPARED 2026-11-24. Nothing has been deployed, migrated or seeded.

Legend used in every deployment document:
**[CONFIRMED]** verified against the repository · **[MANUAL]** value you must supply · **[SECRET]** enter only in a dashboard ·
**[PREPARED]** command written, not executed · **[APPROVAL]** needs separate explicit approval.

## 1. Topology

```
Browser ── https://app.<domain> ──▶ Vercel (Next.js 16, Node runtime, apps/web)
   │                                   └─ proxy.ts (server) ── GET https://api.<domain>/api/v1/me ──┐
   └──── https://api.<domain>/api/v1 (credentials: include) ──▶ Render Web Service gsc-peoples-api ◀┘
                                                                  │  Express 5, Prisma 7 + pg adapter
                                                                  ▼  verified TLS (Supabase CA), role hr_app
                                                         Supabase Postgres, schema `hr` (Mumbai)
```

| Piece | Choice | Status |
|---|---|---|
| Frontend | Vercel project `gsc-peoples-web`, root dir `apps/web` | [PREPARED] |
| Backend | Render Web Service `gsc-peoples-api`, repo root, Node 22 | [PREPARED] |
| Database | Existing Supabase project, schema `hr`, runtime `hr_app`, migrations `hr_migrator` | schema empty, migrations not applied [APPROVAL] |
| Redis / queues | Not provisioned. `REDIS_URL` unset → BullMQ disabled; no workers are registered anyway | [CONFIRMED] `apps/api/src/queues/index.ts` |
| File storage | Local disk today (see blocker B3) | [CONFIRMED] |

## 2. Repository facts [CONFIRMED]

- Package manager: **pnpm 10.34.9** (`packageManager` in root `package.json`, `engines.pnpm >=10`). Workspaces: `apps/*`, `packages/*`. No `turbo.json`. No Dockerfile/render.yaml/vercel.json exists.
- Node: `engines.node >=22`; the API bundle targets `node22` (`tsup.config.ts`). **Use Node 22 LTS.** (Local machine runs Node 24; builds and tests passed there.)
- Workspace packages (`@gsc/contracts`, `@gsc/shared`, `@gsc/config`) ship as TypeScript source. The API bundles them (`tsup noExternal`); the web app compiles them (`transpilePackages`). Therefore **both builds need the repository root** (root lockfile + `packages/*`).
- API: `tsup` → `apps/api/dist/server.js` (ESM). Start: `node dist/server.js`. Prisma client is generated into `apps/api/src/database/generated/` (git-ignored) so **`db:generate` must run in the build**.
- Web: Next.js 16.4.6, App Router, has server code (`src/proxy.ts` session gate, `/api/health` route, dynamic `/employees/[id]`) → **Node deployment, not static export**.
- Sessions: custom, DB-backed (`user_sessions`), tokens stored hashed. **There is no session signing secret**; nothing like `SESSION_SECRET`/`JWT_SECRET` exists or is needed.

## 3. Code changes made for deployment (minimal, no UI/feature change)

| File | Change | Why |
|---|---|---|
| `apps/api/src/config/env.ts` | `PORT` is used when `API_PORT` is unset; new optional `HOST` (default `0.0.0.0`), `TRUST_PROXY_HOPS`, `COOKIE_DOMAIN`, `DOCUMENTS_STORAGE_DIR` | Render injects `PORT`; the API previously ignored it (would have bound 4000 and failed the port scan) |
| `apps/api/src/server.ts` | `listen(port, HOST)` | explicit `0.0.0.0` |
| `apps/api/src/app.ts` | `trust proxy` = 1 in production | behind Render's proxy `req.ip` was the proxy for every user, so the login limiter (`ip:email`) keyed on the wrong address |
| `apps/api/src/modules/auth/auth.routes.ts` | `Domain=<COOKIE_DOMAIN>` on set/clear when configured | the Next proxy and browser JS must see `gsc_session`/`gsc_csrf` that the API sets (see §4) |
| `apps/api/src/modules/documents/documents.routes.ts` | storage root from `DOCUMENTS_STORAGE_DIR` (default unchanged) | allows a mounted persistent disk |
| `apps/api/src/config/env.render.test.ts` | new unit test | covers PORT/HOST/COOKIE_DOMAIN |

Local defaults are unchanged (`API_PORT=4000`, host-only cookies, no proxy trust outside production, local DB target).

## 4. Why a custom domain on one registrable parent is mandatory [CONFIRMED]

The web app reads `gsc_csrf` with `document.cookie` (`http-service.ts`, `top-bar.tsx`, `settings/page.tsx`) and `src/proxy.ts` reads `gsc_session` from the **web** host's request, while the API sets both cookies. Consequences:

- `*.vercel.app` + `*.onrender.com` are different registrable domains (both on the Public Suffix List): `SameSite=Lax` cookies are not sent on cross-site `fetch`, the proxy would never see a session and every page would redirect to `/login`. **This cannot work and must not be "fixed" by `SameSite=None`.**
- `app.<domain>` + `api.<domain>` are **same-site**. With `COOKIE_DOMAIN=.<domain>` both subdomains receive the cookies; `SameSite=Lax; Secure; HttpOnly` (session) is correct as is. CORS is still required (different origins) and is configured exact-origin with credentials.
- Alternative (not implemented, needs code): proxy `/api/v1/*` through Vercel rewrites so everything is same-origin; `proxy.ts` matcher would also need to exclude that path.

Security note: `gsc_csrf` is intentionally readable by JS (double-submit). With `Domain=.<domain>`, any sibling subdomain you control can read/set it. Do not host untrusted apps on other subdomains of this domain.

## 5. Environments

| Env | Web | API | DB |
|---|---|---|---|
| Local | `localhost:3000` | `localhost:4000` | local PostgreSQL (`DB_TARGET` unset) |
| Production/staging | `app.<domain>` (Vercel Production) | `api.<domain>` (Render) | Supabase `hr` |
| Vercel Preview | `*.vercel.app` | none usable (cookie/CORS rules above) | none |

Production-first single hosted environment: there is only one Supabase project and a single `hr` schema; "staging" = the first deployment of this stack with test data you later remove. Decide explicitly whether you want a second Supabase project before real HR data enters.

## 6. Other findings

- **No `SUPABASE_DIRECT_URL`/`hr_migrator` secret ever enters Render.** `prisma.config.ts` is used only by the Prisma CLI, which never runs on Render (build command omits `migrate`).
- Login limiter and `Map`-based state are per process → run **one instance** (also required if using a Render disk).
- Session lifetime: absolute 8 h (`expiresAt`), cookie `maxAge` 8 h; there is no sliding refresh endpoint. "Refresh" = `/me` re-validation on each navigation (proxy) and request.
- Pre-existing, not changed: `pnpm lint` reports 166 `no-explicit-any` errors in API modules (typecheck and tests pass); CI must not gate on lint until addressed.
