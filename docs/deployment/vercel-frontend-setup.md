# Vercel frontend setup: `gsc-peoples-web`

**Not created.** Prepared for manual dashboard setup after approval [APPROVAL].

## 1. Project settings

| Setting | Value | Label |
|---|---|---|
| Project name | `gsc-peoples-web` | [CONFIRMED] |
| Repository / Production branch | the GSC Peoples repository / `main` | [MANUAL] / [CONFIRMED] |
| Framework Preset | Next.js | [CONFIRMED] (Next 16.4.6) |
| Root Directory | `apps/web`, with "Include files outside the Root Directory in the Build Step" **enabled** (default). Needed so the root `pnpm-lock.yaml` and `packages/*` are present | [CONFIRMED] |
| Install Command | default (Vercel runs `pnpm install` at the workspace root; detects pnpm from the lockfile / `packageManager`) | [PREPARED] |
| Build Command | default `next build` (script `build`) | [CONFIRMED] |
| Output Directory | default (`.next`) | [CONFIRMED] |
| Node.js version | 22.x | [MANUAL] (Project Settings → General) |
| Function region | closest to the API and database: Mumbai `bom1` or Singapore `sin1` | [MANUAL] |
| Domain | `app.<domain>` (same parent domain as the API; see architecture §4) | [MANUAL] |
| Deploy on push to `main` | enable only after release approval | [APPROVAL] |

A root-level `vercel.json` / Vercel config is **not needed**; none was created. Static export is not possible (server `proxy.ts`, `/api/health`, dynamic routes).

## 2. Verified [CONFIRMED, local 2026-11-24]

| Check | Result |
|---|---|
| `pnpm --filter @gsc/web typecheck` | passes |
| `pnpm --filter @gsc/web test` | 170/170 tests pass (18 files) |
| `next build` with `NEXT_PUBLIC_API_URL=https://api.example.com/api/v1` | succeeds; 21 routes; `ƒ Proxy (Middleware)` |
| Build without `NEXT_PUBLIC_API_URL` | **refuses to build** (`next.config.ts`), so a localhost URL can't ship |
| Client bundles | 0 occurrences of `localhost:4000`; the configured API URL is inlined; no `SUPABASE`, `DATABASE_URL`, `service_role`, `hr_app`, `hr_migrator` or `postgresql://` strings |
| Auth requests | `credentials: 'include'` on login and `/me`; CSRF token from readable `gsc_csrf` cookie sent as `x-csrf-token` on mutating calls; 401 → redirect to login (`proxy.ts` also clears cookies) |
| Demo mode | `NEXT_PUBLIC_EMPLOYEES_ADAPTER=demo` is ignored when `NODE_ENV=production` |
| Fail-closed | API unreachable → proxy answers 503; invalid session → `/login?next=…` |
| Refresh/navigation | every non-auth route passes `proxy.ts`; verified by code and e2e specs, not yet in a hosted browser (acceptance checklist) |

The frontend API variable is **`NEXT_PUBLIC_API_URL`** (verified in `src/config/env.ts`, `proxy.ts`, login/forgot/reset/accept pages, `top-bar.tsx`, `settings/page.tsx`). It is **inlined at build time**: changing it requires a redeploy. The value must include the `/api/v1` suffix.

## 3. Preview deployments

Preview URLs are `*.vercel.app`, a different site from `api.<domain>`; sessions cannot work there and the API's exact-origin CORS rejects them. Set Preview `NEXT_PUBLIC_API_URL` to the same API only if you accept that previews render the login page / 503 only; otherwise disable previews for this project. Never point previews at a separate database role or add wildcard CORS.

## 4. Existing UI preserved

No component, style, route or copy changed. Frontend code is untouched by this task.

## 5. Approval gates [APPROVAL]

Create project · attach domain/DNS · set env vars · first production deploy · enable git-triggered deploys.
