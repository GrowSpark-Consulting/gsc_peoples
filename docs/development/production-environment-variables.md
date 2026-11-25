# Production environment variables

Date: 2026-11-25. Source of truth: every `process.env` read in the repository (`apps/api/src/config/env.ts`,
`apps/api/prisma.config.ts`, `apps/api/src/jobs/`, `apps/api/scripts/`, `apps/web/`). No value in this file is real;
`<...>` marks what an operator supplies. Supersedes `docs/deployment/production-environment-variables.md`.

**Legend.** Required: the process or the feature does not work without it. Secret: never in git, chat, logs or any
`NEXT_PUBLIC_*` variable.

## 1. Render: API web service `gsc-peoples-api`

| Variable | Value in production | Required | Secret | Notes |
|---|---|---|---|---|
| `NODE_ENV` | `production` | yes | no | Secure cookies, generic 500 messages, no development tokens in responses, extra startup checks |
| `NODE_VERSION` | `22.23.5` | yes | no | Render runtime selector (pinned Node 22 LTS) |
| `AUTH_MODE` | `session` | yes | no | `development` refuses to start; `sso` is not configured |
| `DB_TARGET` | `supabase` | yes | no | default is `local` |
| `SUPABASE_DATABASE_URL` | `postgresql://hr_app.<project-ref>:<password>@<session-pooler-host>:5432/postgres?schema=hr` | yes | **yes** | runtime role only. Percent-encode reserved characters in the password |
| `SUPABASE_CA_CERT_PATH` | `/opt/render/project/src/supabase-ca.crt` | yes | no | the public CA certificate committed at the repo root; TLS is always verified |
| `CORS_ORIGINS` | `https://app.<domain>` | yes | no | comma separated; each must be an exact `https://host[:port]` origin |
| `COOKIE_DOMAIN` | `.<domain>` | yes (for login) | no | lets `app.` and `api.` share the session and CSRF cookies |
| `DOCUMENT_STORAGE_DRIVER` | `supabase` | yes | no | `local` refuses to start in production |
| `SUPABASE_STORAGE_URL` | `https://<project-ref>.supabase.co` | yes | no | server side only |
| `SUPABASE_STORAGE_SERVICE_KEY` | `<service key>` | yes | **yes** | server side only; full storage access, rotate if ever exposed |
| `SUPABASE_STORAGE_BUCKET` | `hr-documents` | no (default) | no | must be a **private** bucket |
| `MAIL_DRIVER` | `smtp` | yes (must be set) | no | `disabled` boots without email: invitations answer 503, reset requests send nothing |
| `SMTP_HOST` | `<smtp host>` | with `smtp` | no | any SMTP provider |
| `SMTP_PORT` | `587` | no (default 587) | no | |
| `SMTP_SECURE` | `false` (STARTTLS) or `true` (port 465) | no (default `false`) | no | in production STARTTLS is mandatory when `false` |
| `SMTP_USER` | `<user>` | usually | **yes** | |
| `SMTP_PASSWORD` | `<password or API key>` | usually | **yes** | |
| `MAIL_FROM` | `GSC Peoples <no-reply@<domain>>` | with `smtp` | no | address on a domain verified with the provider (SPF/DKIM) |
| `WEB_APP_URL` | `https://app.<domain>` | with `smtp` | no | links inside emails; must be `https` in production |
| `LOG_LEVEL` | `info` | no | no | |
| `DATABASE_POOL_MAX` | unset (10) | no | no | keep below the Supabase pooler limit of the plan |
| `RATE_LIMIT_PER_MINUTE` | unset (600) | no | no | per client IP, `/health` exempt |
| `AUTH_RATE_LIMIT_PER_15_MIN` | unset (30) | no | no | per client IP on `/auth/*`; a per-account limit of 5 failures is built in |
| `TRUST_PROXY_HOPS` | unset (1 in production) | no | no | |
| `PORT` | set by Render | automatic | no | used when `API_PORT` is unset |
| `HOST` | unset (`0.0.0.0`) | no | no | |
| `REDIS_URL` | unset | no | yes if set | no background workers exist |

**Must not exist on this service:** `SUPABASE_DIRECT_URL`, `DIRECT_URL`, any `hr_migrator` credential, `DATABASE_URL`,
`TEST_*`, `DEV_AUTH_*`, `API_PORT`, `CENTRAL_AUTH_*`, `DOCUMENTS_STORAGE_DIR`, `DOCUMENTS_LOCAL_SIGNING_SECRET`,
`NEXT_PUBLIC_*`.

There is **no session secret** to generate: session, CSRF, invitation and reset tokens are random 256-bit values of
which only a hash is stored; passwords are scrypt hashes with a per-password salt.

### Retention cron job (only if you create it)

The same variables as the API (it loads the same configuration), plus:

| Variable | Value | Required |
|---|---|---|
| `PURGE_COMPANY_IDS` | the company UUID printed by the bootstrap | yes (or pass `--company`) |

## 2. Vercel: web app

Two deployment topologies are supported — see
[docs/architecture/same-origin-deployment.md](../architecture/same-origin-deployment.md).

### Topology A — same-origin (recommended, no custom domain)

| Variable | Production value | Required | Secret | Notes |
|---|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | `/api/v1` | **yes** | no | Relative path; browser requests go through the Next.js rewrite to Render. Build fails without it. Baked at build time — redeploy to change. |
| `RENDER_API_URL` | `https://gsc-peoples-api.onrender.com` | **yes** | no | Server-side only (NOT `NEXT_PUBLIC_*`). Rewrite destination and server-side `/me` check in `proxy.ts`. |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` | recommended | no | Pinned pnpm version. |

Render changes for Topology A: `COOKIE_DOMAIN` = **empty/unset**; `CORS_ORIGINS` = Vercel app URL;
`WEB_APP_URL` = Vercel app URL.

### Topology B — cross-origin (custom domain required)

| Variable | Production value | Required | Secret | Notes |
|---|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | `https://api.<domain>/api/v1` | **yes** | no (public by design) | Absolute URL. Inlined at **build** time; build fails without it. Redeploy to change. |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` | recommended | no | Pinned pnpm version. |

Render changes for Topology B: `COOKIE_DOMAIN=.<domain>`; `CORS_ORIGINS=https://app.<domain>`;
`WEB_APP_URL=https://app.<domain>`.

**All topologies:** never add a database URL, storage key, SMTP credential, or any other secret to
Vercel. Do not set `NEXT_PUBLIC_EMPLOYEES_ADAPTER`, `NEXT_DIST_DIR`, or any `NEXT_PUBLIC_*` secret.

## 3. Local development (repository-root `.env`)

| Variable | Typical value | Required |
|---|---|---|
| `NODE_ENV` | `development` | no (default) |
| `DATABASE_URL` | local `hr_app` URL (`pnpm db:setup` writes it) | yes |
| `DIRECT_URL` | local `hr_migrator` URL | for migrations |
| `AUTH_MODE` | `session` (browser login) or `development` (bearer tokens, needs `DEV_AUTH_ENABLED=true`) | no |
| `DEV_AUTH_ENABLED`, `DEV_AUTH_COMPANY_ID` | development adapter only | no |
| `API_PORT`, `CORS_ORIGINS`, `LOG_LEVEL` | `4000`, `http://localhost:3000`, `info` | no |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000/api/v1` | no (default) |
| `MAIL_DRIVER` | unset: no email, the API returns the invitation/reset token to the caller | no |
| `DOCUMENT_STORAGE_DRIVER`, `DOCUMENTS_STORAGE_DIR`, `DOCUMENTS_LOCAL_SIGNING_SECRET` | local disk by default | no |
| `REDIS_URL`, `REDIS_PORT` | optional | no |
| `DB_TARGET` | unset / `local`. Set `supabase` only for one deliberate command | no |

## 4. Test environment

| Variable | Used by | Rule |
|---|---|---|
| `TEST_DATABASE_URL`, `TEST_DIRECT_URL` | integration and browser suites | local host only; the database name in the URL must be `hr_test`; the suites replace it with a throwaway `hr_itest*` database and never connect to `hr_test` itself. Fallback: `DATABASE_URL`/`DIRECT_URL` (must name `hr_db`) |
| `INTEGRATION_DB`, `INTEGRATION_KEEP_DB` | integration suite | scratch database name (`hr_itest*`), keep it for inspection |
| `E2E_API_PORT`, `E2E_WEB_PORT`, `E2E_SMTP_PORT`, `E2E_MAIL_PORT` | scratch browser suite | defaults 4400, 3400, 4425, 4426 |
| `E2E_KEEP_DB`, `PW_CHROMIUM_EXECUTABLE`, `E2E_HTTP_BASE_URL`, `CI` | browser suites | optional |

Recommended: point `TEST_*` at a separate PostgreSQL 17 instance (Supabase runs 17), not at the server holding your
development data. Unit tests need no database and are configured never to read one.

## 5. Migration operator machine only (never a server)

| Variable | Value | Secret |
|---|---|---|
| `DB_TARGET` | `supabase`, set per command and removed after | no |
| `SUPABASE_DIRECT_URL` | `hr_migrator` via the Session Pooler | **yes** |
| `SUPABASE_CA_CERT_PATH` | local path of `supabase-ca.crt` | no |

Known local issue (from the 2026-11-24 audit, not edited by us): `.env` had `SUPABASE_CA_CERT_PATH` pointing to a
non-existent folder. Check the path before any hosted command.

## 6. Startup validation (the API exits with a named error when violated)

- `NODE_ENV=production`: `AUTH_MODE` not `development`; `DEV_AUTH_ENABLED` not `true`; `CORS_ORIGINS` set, each an
  exact https origin; `DOCUMENT_STORAGE_DRIVER=supabase`; `MAIL_DRIVER` set.
- `DOCUMENT_STORAGE_DRIVER=supabase`: `SUPABASE_STORAGE_URL`, `SUPABASE_STORAGE_SERVICE_KEY`.
- `MAIL_DRIVER=smtp`: `SMTP_HOST`, `MAIL_FROM`, `WEB_APP_URL` (https in production).
- `DB_TARGET=supabase`: `SUPABASE_DATABASE_URL`, `SUPABASE_CA_CERT_PATH` (the file must exist at the first query);
  `schema=hr` is forced.
- `DB_TARGET=local`: `DATABASE_URL`.
- `AUTH_MODE=sso`: the three `CENTRAL_AUTH_*` values.
- The web build fails without `NEXT_PUBLIC_API_URL`; at runtime a missing value makes protected pages answer 503.
