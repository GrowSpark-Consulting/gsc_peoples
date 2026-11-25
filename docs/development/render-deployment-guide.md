# Render deployment guide: API

Date: 2026-11-25. **Nothing has been created or deployed.** Every step that creates, changes or bills a hosted
resource needs your approval. Values are listed in [production-environment-variables.md](production-environment-variables.md).
Supersedes `docs/deployment/render-backend-setup.md`.

## 1. Order of work

1. Database migrated ([production-migration-and-bootstrap.md](production-migration-and-bootstrap.md), sections 1-4).
2. Private storage bucket and SMTP sender ready (sections 4 and 5 below).
3. Create the Render service, enter variables, deploy.
4. Attach the custom domain, then deploy the web app ([vercel-deployment-guide.md](vercel-deployment-guide.md)).
5. Bootstrap the company, then run the smoke checks (section 7).

The changes in this working tree must be **committed and pushed to `main` first**: Render and Vercel build what is in
the GitHub repository, which still holds only the initial commit.

## 2. Service

`render.yaml` at the repository root declares the service. Dashboard: New → Blueprint → the repository
`GrowSpark-Consulting/gsc_peoples`. Render asks for every `sync: false` value. Check on the first sync that no key is
reported as unknown (the Blueprint has not been synced against Render yet).

| Setting | Value |
|---|---|
| Name / type | `gsc-peoples-api`, Web Service, Node |
| Branch / root directory | `main`, repository root (the lockfile and `packages/*` are needed) |
| Region | Singapore (Render has no India region; the database is in Mumbai) |
| Plan / instances | paid (no spin-down), **exactly one instance**: rate limits and the login counter live in memory |
| Build command | `corepack enable && pnpm install --frozen-lockfile --prod=false && pnpm --filter @gsc/api db:generate && pnpm --filter @gsc/api build` |
| Start command | `pnpm --filter @gsc/api start` (`node dist/server.js` in `apps/api`) |
| Pre-deploy command | empty. Migrations are never run by Render |
| Health check path | `/api/v1/health` |
| Node | `NODE_VERSION=22`; pnpm 10.34.9 from `packageManager` through corepack |
| Auto-deploy | off until release approval |

`--prod=false` is required: with `NODE_ENV=production` pnpm would skip `tsup` and `prisma`. `db:generate` needs no
database connection.

## 3. Health, logs, shutdown

- `GET /api/v1/health`: liveness, 200 even when the database is down (`status: degraded`), so a database outage does
  not cause a restart loop. `GET /api/v1/health/ready`: 503 while the database is unreachable. Point an external
  uptime monitor at `/health/ready` and alert on it.
- Logs are JSON on stdout (pino) with a request id (also returned as `x-request-id` and in error bodies).
  Authorization, cookies, CSRF headers, `Set-Cookie`, development token headers, query strings and file tokens are
  removed. Alert on `level >= 50` and on the messages `invitation email failed`, `password reset email failed` and
  `document purge failed`.
- `SIGTERM`/`SIGINT`: stop accepting connections, finish in-flight requests, close jobs and the database, force exit
  after 10 s. An uncaught exception exits with code 1.

## 4. Private storage bucket (Supabase) [needs approval]

1. Storage → New bucket `hr-documents`: **Public off**, file size limit 10 MB, allowed types
   `application/pdf`, `image/png`, `image/jpeg`,
   `application/vnd.openxmlformats-officedocument.wordprocessingml.document`.
2. Add **no** storage policies for `anon` or `authenticated`. Only the server key reaches the bucket.
3. Put the service key only in `SUPABASE_STORAGE_SERVICE_KEY` on Render.
4. Verify against the real service from an operator machine (uploads and deletes only `__verification__/<uuid>`):

   ```powershell
   cd apps\api
   # set SUPABASE_STORAGE_URL, SUPABASE_STORAGE_SERVICE_KEY, SUPABASE_STORAGE_BUCKET in this shell only
   npx tsx scripts/verify-document-storage.ts --i-understand-this-uses-the-real-service
   ```

   All checks must pass, including refusal of the public URL and expiry after 60 seconds.

## 5. Email

Any SMTP provider. Verify the sending domain (SPF, DKIM, DMARC) before inviting anyone. Test after deploy with
"Forgot password" for the Super Admin: the email must arrive, the link must open `WEB_APP_URL`, work once, and
expire after 60 minutes. If sending fails, invitations answer 503 with "saved but not sent"; resend after fixing.

## 6. Retention cron job (PRD DOC-005) [needs approval]

Not in `render.yaml`. Without it, soft-deleted files stay in the bucket (hidden and not downloadable) forever.

| Setting | Value |
|---|---|
| Type | Cron Job, same repository, branch and region |
| Build command | same as the web service |
| Command | `node apps/api/dist/purge-documents.js` (add `--execute` only after a dry run looks right) |
| Schedule | daily, for example `0 20 * * *` (UTC) |
| Environment | the API's variables plus `PURGE_COMPANY_IDS=<company uuid>` |

The job is idempotent, handles one company at a time with the runtime database role, deletes the object before the
row, re-checks eligibility inside the transaction, logs ids and counts only, and exits 1 if any document failed.

## 7. Smoke checks after the first deploy

1. `/api/v1/health` is 200 and `dependencies.database` is `up`; `/api/v1/health/ready` is 200.
2. From a browser on the web domain: sign in; the cookies `gsc_session` (HttpOnly, Secure, Lax, parent domain) and
   `gsc_csrf` exist.
3. `curl -i -H "Origin: https://evil.example" https://api.<domain>/api/v1/health` shows no
   `Access-Control-Allow-Origin`.
4. Upload, preview and delete one test document; confirm the signed link dies after 60 seconds.
5. Forgot password and one invitation arrive by email.
6. Logs show no cookie, token, password or search text.

## 8. Rollback

Dashboard → Deploys → Rollback to the previous successful deploy (no data change). Disable auto-deploy first. A
rollback does not undo migrations; see the migration document, section 7.

## 9. What has been verified, and what has not

Verified locally (see the readiness report for commands and results): the exact build and start commands from a clean
copy of the repository, a production-mode start against a scratch database, cookies, CORS, CSRF, headers, rate
limits, health and refusal of unsafe configurations. **Not verified:** anything on Render itself, the Blueprint sync,
TLS to Supabase from Render, the real bucket, real email.
