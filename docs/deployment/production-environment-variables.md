# Production environment variables

Derived from `apps/api/src/config/env.ts`, `apps/api/prisma.config.ts`, `apps/web/src/config/env.ts`, `proxy.ts`. Nothing here contains a real secret; `<…>` marks values to supply.

## 1. Render: `gsc-peoples-api` (Environment tab)

| Variable | Value | Label | Notes |
|---|---|---|---|
| `NODE_VERSION` | `22` | [CONFIRMED] | Render build/runtime Node |
| `NODE_ENV` | `production` | [CONFIRMED] | enables Secure cookies, production error bodies, requires explicit CORS, forbids `AUTH_MODE=development` |
| `DB_TARGET` | `supabase` | [CONFIRMED] | default is `local` |
| `SUPABASE_DATABASE_URL` | `postgresql://hr_app.<project-ref>:<password>@<session-pooler-host>:5432/postgres?schema=hr` | [SECRET] [MANUAL] | role `hr_app` via Session Pooler (host `aws-1-ap-south-1.pooler.supabase.com` was confirmed by the earlier read-only audit). `schema=hr` is forced by code even if omitted |
| `SUPABASE_CA_CERT_PATH` | `/opt/render/project/src/supabase-ca.crt` | [CONFIRMED] path of the committed public CA certificate in the Render checkout (a Secret File at `/etc/secrets/supabase-ca.crt` works too) | strict TLS (`rejectUnauthorized: true`, `ca` from file); startup fails if the file is missing |
| `AUTH_MODE` | `session` | [CONFIRMED] | `development` is refused in production; `sso` is not configured |
| `CORS_ORIGINS` | `https://app.<domain>` | [MANUAL] | exact origin, no trailing slash, no wildcard, no localhost. Required: app refuses to start in production if unset |
| `COOKIE_DOMAIN` | `.<domain>` | [MANUAL] | **new**; shared by `app.` and `api.`; required for login to work (architecture §4) |
| `LOG_LEVEL` | `info` | [CONFIRMED] | |
| `PORT` | *(set by Render, do not set)* | [CONFIRMED] | used when `API_PORT` unset |
| `HOST` | *(unset; default `0.0.0.0`)* | [CONFIRMED] | **new** |
| `TRUST_PROXY_HOPS` | *(unset; defaults to 1 in production)* | [CONFIRMED] | **new** |
| `DOCUMENT_STORAGE_DRIVER` | `supabase` | [CONFIRMED] | **required in production**: the API refuses to start with `local` (disk is ephemeral on Render) |
| `SUPABASE_STORAGE_URL` | `https://<project-ref>.supabase.co` | [MANUAL] | storage REST base, server-side only |
| `SUPABASE_STORAGE_SERVICE_KEY` | `<service key>` | [SECRET] [MANUAL] | server-side only; never in Vercel, never logged, never sent to the browser |
| `SUPABASE_STORAGE_BUCKET` | `hr-documents` (default) | [MANUAL] | must be a PRIVATE bucket; 3-63 characters |
| `RATE_LIMIT_PER_MINUTE` | unset (default 600) | optional | per client IP, whole API except `/health*` |
| `AUTH_RATE_LIMIT_PER_15_MIN` | unset (default 30) | optional | per client IP on `/auth/*` (login, forgot/reset password, invitation); an additional per-account limit of 5 failures is built in |
| `DOCUMENTS_STORAGE_DIR`, `DOCUMENTS_LOCAL_SIGNING_SECRET` | unset | | local development driver only |
| `DEV_AUTH_ENABLED` / `DEV_AUTH_COMPANY_ID` | unset | | `DEV_AUTH_ENABLED=true` crashes startup in production |
| `REDIS_URL` | unset | | queues disabled, no workers exist |
| `CENTRAL_AUTH_*` | unset | | SSO not used |
| **Session / auth secrets** | **none exist** | [CONFIRMED] | session tokens are random 256-bit values stored hashed in `user_sessions`; password hashing is scrypt with per-password salt. Nothing to generate |

**Must NOT exist on Render:** `SUPABASE_DIRECT_URL`, `DIRECT_URL`, `DATABASE_URL`, `TEST_*`, any `hr_migrator` credential, any Supabase service-role/anon key, `NEXT_PUBLIC_*`.

The CA certificate `supabase-ca.crt` is a public certificate and is committed at the repository root; no Secret File is needed. `render.yaml` at the repository root declares all of the above (secrets as `sync: false`).

## 2. Vercel: `gsc-peoples-web`

| Variable | Production | Preview | Local development |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | `https://api.<domain>/api/v1` [MANUAL] (build-time, redeploy to change) | see vercel doc §3; do not use localhost | `http://localhost:4000/api/v1` (default; `.env`) |
| `NEXT_PUBLIC_EMPLOYEES_ADAPTER` | **unset** (ignored in production anyway) | unset | `demo` only for demo mode, otherwise unset |
| `NODE_VERSION` equivalent | project setting 22.x | same | local Node ≥ 22 |
| `NEXT_DIST_DIR` | unset | unset | test tooling only |

Nothing else is read by the web app. No database URL, Supabase key or service-role key may be placed in any Vercel variable; every `NEXT_PUBLIC_*` value is public by design.

## 3. Local development (repo-root `.env`, unchanged)

`NODE_ENV=development`, `API_PORT=4000`, `CORS_ORIGINS=http://localhost:3000`, `DATABASE_URL`/`DIRECT_URL` (local `hr_app`/`hr_migrator`), `AUTH_MODE=development|session`, `NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1`. `DB_TARGET` stays unset/`local` (the `SUPABASE_*` block is commented out in `.env.example`).

## 4. Migration operator machine only (never a server)

`DB_TARGET=supabase` (per command), `SUPABASE_DIRECT_URL` (`hr_migrator`, [SECRET]), `SUPABASE_CA_CERT_PATH` (local path to `supabase-ca.crt`). See `supabase-production-migration.md`.
