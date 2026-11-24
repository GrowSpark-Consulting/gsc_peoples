# Supabase production migration (PREPARED, NOT EXECUTED)

Every command here writes to or reads the hosted database and needs explicit approval [APPROVAL]. Run from the operator's machine (never from Render/Vercel), from `apps/api`, in PowerShell. Source of the verified connection behaviour: `apps/api/prisma.config.ts`, `docs/development/supabase-deployment-commands.md`.

## 1. Connection configuration [CONFIRMED]

With `DB_TARGET=supabase`, `prisma.config.ts` builds the CLI URL from `SUPABASE_DIRECT_URL` (role `hr_migrator`, Session Pooler :5432) and forces `schema=hr`, `sslaccept=strict`, `sslcert=<path to SUPABASE_CA_CERT_PATH>`. If either variable is missing the URL is empty and the CLI fails; it **never falls back to the runtime role**. The runtime API uses `hr_app` through `SUPABASE_DATABASE_URL` with `rejectUnauthorized: true` and the same CA. `DB_TARGET` is set for one command only; `.env` keeps it commented out.

Prerequisites on the operator machine: `SUPABASE_DIRECT_URL` and `SUPABASE_CA_CERT_PATH` available as process env vars (typed by you; never pasted into logs/chat), `supabase-ca.crt` present, pnpm 10.34.9, `pg_dump` 17 for the optional export.

## 2. Migration order (the seven folders in `src/database/migrations`)

1 `20261119075410_init_hr_schema` · 2 `20261119151000_hr_core_schema` · 3 `20261119151100_employee_audit_log` · 4 `20261119160000_phase1_auth_company` · 5 `20261120090000_foundation_holidays_work_hours` · 6 `20261120100000_row_level_security` · 7 `20261121130000_prd_p0_backend_modules`.

## 3. Commands

```powershell
cd C:\Users\PC\gsc_peoples\apps\api

# 0. Pre-flight (read-only on the hosted DB)
Test-Path C:\Users\PC\gsc_peoples\supabase-ca.crt                    # True
npx prisma validate
npx tsc -p tsconfig.json --noEmit
$env:DB_TARGET='supabase'; npx tsx scripts/supabase-audit.ts         # hr empty, owner hr_migrator, hr_app has no CREATE
$env:DB_TARGET='supabase'; npx prisma migrate status                 # 7 migrations not yet applied

# 1. Safety export, optional because hr is empty: pg_dump -n hr --schema-only (connection typed by you)

# 2. THE MIGRATION: writes to the hosted database [APPROVAL]
$env:DB_TARGET='supabase'; npx prisma migrate deploy

# 2b. Lock the migration history away from the runtime role [APPROVAL] (run as hr_migrator, same connection as step 2).
#     Default privileges give hr_app DML on every new table in hr, including hr._prisma_migrations. Proven on a scratch
#     database by runtime-privileges.integration.test.ts. Re-run after every future `migrate deploy` is not needed:
#     the table already exists and the REVOKE persists.
#     REVOKE ALL ON "hr"."_prisma_migrations" FROM hr_app;

# 3. Post-migration verification (read-only)
$env:DB_TARGET='supabase'; npx prisma migrate status                 # "Database schema is up to date"
$env:DB_TARGET='supabase'; npx tsx scripts/supabase-audit.ts
Remove-Item Env:DB_TARGET
```

`migrate deploy` is the only supported hosted command. **Never** run `migrate dev`, `migrate reset`, `db push`, `db execute` or `db seed` against Supabase (`db:migrate` and `db:seed` root scripts point at dev/seed behaviour).

## 4. Schema-targeting verification

- Audit output must show only schema `hr`; `public` untouched; `_prisma_migrations` exists **inside `hr`** (schema forced by config).
- The existing website's Supabase project must never be used: confirm the project ref in the pooler username matches the GSC Peoples project, and the host/ref differ from the website's.

## 5. Expected state after step 2 (from the isolated PG 17.12 dry-run)

25 tables including `_prisma_migrations` · 11 enums · 18 RLS-protected application tables · 21 policies · 47 foreign keys · 2 triggers · everything owned by `hr_migrator` · `hr_app` owns nothing, holds SELECT/INSERT/UPDATE/DELETE only (INSERT+SELECT on the two audit tables) and, after step 2b, nothing on `_prisma_migrations`. Runtime security checks 28/28 on the dry-run. After migrating, run the same runtime checks as `hr_app` against the hosted DB (RLS returns 0 rows with no `app.company_id`).

## 6. Migration history verification

`prisma migrate status` reports 7/7 applied; `select migration_name, finished_at, rolled_back_at from hr._prisma_migrations order by started_at` shows 7 rows, all `finished_at` set, no `rolled_back_at` (run via the audit script or SQL editor as `hr_migrator`).

## 7. Backup / recovery checklist

- [ ] Confirm in the Supabase dashboard what the project plan provides (daily backups / PITR) before any production data exists [MANUAL].
- [ ] Take the schema export (step 1) and record the timestamp.
- [ ] After bootstrap and before inviting real users: take a full `pg_dump -n hr` (data+schema), store it encrypted off-machine.
- [ ] Practise a restore into a scratch Postgres 17 once.
- [ ] Record the hr_migrator/hr_app credential rotation owner and date.

## 8. Not allowed

No automatic migration at app start or in Render's pre-deploy; no changes to Supabase roles/grants; no `hr_migrator` secret on Render. A failed migration: stop, do not retry blindly; `prisma migrate resolve` and `DROP SCHEMA hr CASCADE` + regrant each need separate approval (see `rollback-and-recovery.md`).
