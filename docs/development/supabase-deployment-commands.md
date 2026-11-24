# Hosted migration commands: PREPARED, NOT EXECUTED

Requires a separate explicit approval. Run from `C:\Users\PC\gsc_peoples\apps\api` in PowerShell.
`DB_TARGET` is set for the one command only (a process-level variable); `.env` keeps it commented out, so every
other command stays on the local database.

Verified configuration (read-only, 2026-11-24): with `DB_TARGET=supabase` the Prisma CLI resolves to
host `aws-1-ap-south-1.pooler.supabase.com:5432`, database `postgres`, user `hr_migrator.<ref>`,
`schema=hr`, `sslaccept=strict`, `sslcert=C:\Users\PC\gsc_peoples\supabase-ca.crt`. A read-only
`prisma migrate status` against the hosted database connected with strict TLS and reported the seven migrations as
not yet applied. The runtime URL resolves to `hr_app.<ref>`, `schema=hr`, verified TLS through the same CA.

Migration order (the only seven folders in `src/database/migrations`):
1 `20261119075410_init_hr_schema`, 2 `20261119151000_hr_core_schema`, 3 `20261119151100_employee_audit_log`,
4 `20261119160000_phase1_auth_company`, 5 `20261120090000_foundation_holidays_work_hours`,
6 `20261120100000_row_level_security`, 7 `20261121130000_prd_p0_backend_modules`.

```powershell
# 0. Pre-flight, read-only
Test-Path C:/Users/PC/gsc_peoples/supabase-ca.crt                     # must print True
npx prisma validate
npx tsc -p tsconfig.json --noEmit
$env:DB_TARGET='supabase'; npx tsx scripts/supabase-audit.ts          # expect: hr empty, owner hr_migrator, no hr_app CREATE
$env:DB_TARGET='supabase'; npx prisma migrate status                  # expect: 7 not yet applied

# 1. Schema-only safety export (optional; the schema is empty today). Needs pg_dump 17 and the CA file.
#    pg_dump -n hr --schema-only  (connection string for hr_migrator typed by you; do not paste it into logs)

# 2. THE MIGRATION (writes to the hosted database). Do not run without approval.
$env:DB_TARGET='supabase'; npx prisma migrate deploy

# 3. Post-migration, read-only
$env:DB_TARGET='supabase'; npx prisma migrate status                  # expect: Database schema is up to date
$env:DB_TARGET='supabase'; npx tsx scripts/supabase-audit.ts          # expect: 25 tables, 18 RLS, 21 policies, 7 migrations
Remove-Item Env:DB_TARGET
```

Expected after step 2: 25 tables (24 plus `_prisma_migrations`), 11 enums, 96 indexes, 89 constraints,
18 tables with RLS, 21 policies, 2 triggers, all owned by `hr_migrator`; `hr_app` owns nothing and holds only
SELECT/INSERT/UPDATE/DELETE (INSERT and SELECT on the two audit tables).

Never run against the hosted database: `prisma migrate dev`, `migrate reset`, `db push`, `db execute`, `db seed`.
Rollback: forward-only. Recovery is a restore from the export, or `DROP SCHEMA hr CASCADE` followed by re-creating
the schema and Stage B grants (explicit approval each time). Enum additions in migration 7 cannot be removed.
