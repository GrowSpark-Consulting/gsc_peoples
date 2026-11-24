# Render backend setup: `gsc-peoples-api`

**Not created.** Everything below is prepared after approval [APPROVAL]. A Blueprint (`render.yaml` at the repository root) declares the same service: Render dashboard → New → Blueprint → select the repository; secrets are prompted for (`sync: false`). The manual table below is the reference the Blueprint was derived from.
See `production-environment-variables.md` for variable values.

## 1. Service settings (dashboard: New → Web Service)

| Setting | Value | Label |
|---|---|---|
| Project / Environment | `gsc_peoples` / Production | [CONFIRMED] (given) |
| Name | `gsc-peoples-api` | [CONFIRMED] |
| Source | the GSC Peoples GitHub repository | [MANUAL] |
| Branch | `main` (deploy only after release approval) | [CONFIRMED] |
| Language / Runtime | Node | [CONFIRMED] |
| Region | **Singapore** (closest Render region to Supabase Mumbai `ap-south-1`; Render has no India region) | [MANUAL] confirm in dashboard |
| Root Directory | *(leave empty = repository root)*. Required: the root lockfile and `packages/*` must be present | [CONFIRMED] |
| Build Command | `corepack enable && pnpm install --frozen-lockfile --prod=false && pnpm --filter @gsc/api db:generate && pnpm --filter @gsc/api build` | [PREPARED] |
| Start Command | `pnpm --filter @gsc/api start` (runs `node dist/server.js` with cwd `apps/api`) | [CONFIRMED] script, [PREPARED] |
| Pre-Deploy Command | **empty**. Never run migrations from Render | [CONFIRMED] policy |
| Health Check Path | `/api/v1/health` (liveness). `/api/v1/health/ready` returns 503 while the database is unreachable, for operators and smoke tests | [CONFIRMED] |
| Instance type | paid instance (not Free: spin-down; a disk requires paid). One instance, no autoscaling | [MANUAL] |
| Auto-Deploy | **Off** until release approval, then "On commit" for `main` if wanted | [MANUAL] |
| CA certificate | the public `supabase-ca.crt` is committed at the repo root; `SUPABASE_CA_CERT_PATH=/opt/render/project/src/supabase-ca.crt`. (Alternative: Secret File at `/etc/secrets/supabase-ca.crt`) | [CONFIRMED] |

Why `--prod=false`: Render sets `NODE_ENV=production` for the build too, and pnpm would then skip `tsup`, `prisma`, `tsx` (devDependencies). Why `db:generate`: the Prisma client directory is git-ignored; the step needs no database (`prisma.config.ts` returns an empty URL when `DB_TARGET` is unset). `db:generate` also rewrites `meta.generated.ts` deterministically. First staging build is the proof of this; if it fails on `prisma generate`, check this step first.

Node version: set env `NODE_VERSION=22` (see variables doc). pnpm: `corepack enable` honours `packageManager` (10.34.9).

## 2. Verified runtime behaviour [CONFIRMED by local production-mode run, 2026-11-24]

Command used: `NODE_ENV=production PORT=10555 AUTH_MODE=session CORS_ORIGINS=https://app.example.com ... node dist/server.js` (dummy DB URL).

| Check | Result |
|---|---|
| Honours `PORT`, binds `0.0.0.0` | log `host=0.0.0.0 port=10555`; **was broken before this change** |
| `GET /api/v1/health` | `200` even with the database unreachable (`status: degraded`, `dependencies.database: down`) → Render will not restart-loop on a DB outage |
| Health content | `status, service, version, uptimeSeconds, timestamp, dependencies{database,redis}`; no URLs/credentials; DB probe is `SELECT 1` with 2 s timeout |
| CORS | allowed origin gets `Access-Control-Allow-Origin` + `Allow-Credentials: true`; other origins get no ACAO |
| Unauthenticated API call | `401` |
| Malformed JSON | `400` JSON error; 5xx responses return `Internal server error` in production (no stack/message) |
| Logs | pino JSON to stdout, request id per request; redacts `authorization`, `cookie`, `x-csrf-token`, `set-cookie`, reset token header |
| Shutdown | `SIGTERM`/`SIGINT` → `server.close`, stop jobs, `$disconnect`, 10 s force-exit (Render allows 30 s). Handler read in `server.ts`; the signal path was not exercised on this Windows host |
| Filesystem | stateless with `DOCUMENT_STORAGE_DRIVER=supabase` |

## 3. Blockers specific to Render

- **B3 Documents (resolved in code, needs the hosted bucket).** Documents go to a private Supabase Storage bucket through the server (`DOCUMENT_STORAGE_DRIVER=supabase`); uploads are multipart (10 MB, validated on the server); downloads are 60-second signed links. The API refuses to boot in production with the local driver. Still required before acceptance: create the private bucket and set the three storage variables (see `docs/development/production-readiness-report.md`).
- **Single instance.** The rate limiter and the per-account login counter live in process memory; keep one instance (no autoscaling) or move them to Redis before scaling out.
- **Custom domain** on the API (`api.<domain>`): Render dashboard → Settings → Custom Domains, then DNS CNAME at your DNS host [MANUAL]. Required (see architecture §4).
- Do not add `SUPABASE_DIRECT_URL`, `DIRECT_URL`, the `hr_migrator` password, `DATABASE_URL`, `REDIS_URL`, `DEV_AUTH_*` to this service.

## 4. Approval gates [APPROVAL]

1. Create the service. 2. First deploy. 3. Custom-domain DNS. 4. Enabling Auto-Deploy. Each is separate; none done.
