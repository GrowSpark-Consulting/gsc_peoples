# Supabase migration and environment wiring plan (DRAFT - awaiting approval)

Nothing in this plan has been executed. No Supabase object has been created, changed or read beyond a
successful `hr_app` login (identity check). Local `hr_db` and `hr_test` are untouched.

## 0. Status of the audit

| Step | Status |
|---|---|
| Connect as `hr_app` through the Session Pooler | Verified by the owner: `postgres` / `hr_app` / schema `hr` |
| Read-only catalog audit (roles, grants, tables, RLS, policies, migration history) | **BLOCKED**: verified TLS fails with `SELF_SIGNED_CERT_IN_CHAIN` (Supabase's own CA). TLS verification was not disabled. Needs the Supabase CA certificate (Dashboard -> Database -> SSL Configuration -> Download certificate). |
| Script ready to run once the CA is available | `supa_audit.cjs` (READ ONLY transaction, catalog queries only, prints no credentials) |

The audit script checks: `hr_app`/`hr_migrator` existence and attributes (`rolbypassrls`, `rolsuper`, ...),
`hr` schema owner and ACL, default privileges, extensions, every table (owner, RLS flag, ACL), enums,
functions, constraints, indexes, policies, triggers, `_prisma_migrations`, and per-table `hr_app` privileges.

## 1. Blockers

1. **Supabase CA certificate** for verified TLS (audit and for the app itself).
2. **App cannot connect with verified TLS today**: `src/database/client.ts` passes only a connection string and
   `schema`, with no `ssl` option. Needs a small change: `ssl: { ca }` from a configured file path.
3. **`hr_migrator` on Supabase is unconfirmed.** Migrations must NOT run as `hr_app`: RLS is enabled, not
   forced, so the table owner bypasses it. If `hr_app` owned the tables, row-level security would not apply to
   the runtime role.
4. **No production seed.** `pnpm db:seed` prints "No seeds defined yet". All data (company, roles, memberships)
   comes from `db:provision:local`, which refuses any non-local host and creates development personas. PRD W1
   (company setup: company, SA membership, default leave types, onboarding template) has no implementation.
5. **Employee-number backfill** is handled inside migration `20261121130000` (see 4), but local `hr_db` data is
   not part of Supabase; Supabase starts empty unless approved otherwise.
6. **TLS/trust decision** for how the CA is distributed (file path env var vs system trust store).

## 2. Connection configuration (proposal; nothing changed yet)

Existing local variables stay exactly as they are. Add, next to `SUPABASE_DATABASE_URL`:

| Variable | Role | Purpose |
|---|---|---|
| `SUPABASE_DATABASE_URL` | `hr_app.<ref>` | runtime (exists, verified) |
| `SUPABASE_DIRECT_URL` | `hr_migrator.<ref>` | Prisma CLI migrations only (to be created) |
| `SUPABASE_CA_CERT_PATH` | n/a | path to the Supabase CA file |
| `DB_TARGET` | n/a | `local` (default) or `supabase` |

Both Supabase URLs: Session Pooler `aws-1-ap-south-1.pooler.supabase.com:5432`, database `postgres`, with
`?schema=hr` so Prisma places `_prisma_migrations` and resolves tables in `hr`.

Wiring (code change, needs approval): `env.ts` and `prisma.config.ts` pick `SUPABASE_*` only when
`DB_TARGET=supabase`; otherwise today's behaviour is unchanged. The integration-test helper already refuses
non-local hosts, so tests stay on local PostgreSQL (scratch DB `hr_itest`, dropped after every run).

## 3. Staged plan

Stage A - read-only audit (needs the CA). Run the audit script; compare with the expectations below.

Stage B - roles and privileges (run by a Supabase admin in the SQL editor; needs your approval):

```sql
-- password supplied out of band; never committed
CREATE ROLE hr_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '<set-in-dashboard>';
ALTER ROLE hr_migrator SET search_path = hr;
ALTER SCHEMA hr OWNER TO hr_migrator;                 -- schema must be empty or already owned appropriately
GRANT USAGE ON SCHEMA hr TO hr_app;
REVOKE CREATE ON SCHEMA hr FROM hr_app;               -- the runtime role must never create or own objects
ALTER DEFAULT PRIVILEGES FOR ROLE hr_migrator IN SCHEMA hr
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hr_app;
ALTER DEFAULT PRIVILEGES FOR ROLE hr_migrator IN SCHEMA hr
  GRANT USAGE, SELECT ON SEQUENCES TO hr_app;
-- keep other roles out of hr (Data API is disabled; this is defence in depth)
REVOKE ALL ON SCHEMA hr FROM PUBLIC;
```

Adjust after Stage A (if `hr_app` already owns objects, ownership must be transferred first).

Stage C - backup/export before migrating: if `hr` is empty, a schema-only `pg_dump -n hr` is enough; otherwise a
full `pg_dump -n hr` through the Session Pooler as `hr_migrator`, plus confirm the project's Supabase backup/PITR
plan. `pg_dump` will need the same CA.

Stage D - migrations in order, as `hr_migrator`, with `prisma migrate deploy` (never `migrate dev`, `reset` or
`db push`). The seven migrations, applied in name order:

| # | Migration | Notes |
|---|---|---|
| 1 | `20261119075410_init_hr_schema` | company/department base |
| 2 | `20261119151000_hr_core_schema` | employees, trigger `employees_no_manager_cycle` (schema-qualified) |
| 3 | `20261119151100_employee_audit_log` | append-only audit; `REVOKE` guarded on `hr_app` existing |
| 4 | `20261119160000_phase1_auth_company` | users, roles, sessions, tokens; **`REVOKE ... FROM "hr_app"` is unguarded: `hr_app` must exist** (it does) |
| 5 | `20261120090000_foundation_holidays_work_hours` | holidays table, settings columns |
| 6 | `20261120100000_row_level_security` | RLS on 7 tables, `current_company_id()` |
| 7 | `20261121130000_prd_p0_backend_modules` | **repaired** (below) |

Folders `candidate-migration` and `candidate-migration-audit-log` are byte-identical to migrations 2 and 3 and
are not migrations (outside `migrations/`); they can be deleted after approval.

Migration 7 repairs (all verified on PostgreSQL 18 in a scratch database; Supabase's PostgreSQL version still
needs confirming in Stage A):
- 24 foreign keys wrapped in guards (the unconditional `holidays_companyId_fkey` failed on any database);
- `ALTER TABLE holidays ADD COLUMN IF NOT EXISTS "isActive"` (existing rows become active);
- integrity rules from the PRD: `attendance_records_out_after_in`, `attendance_corrections_out_after_in`,
  one-pending-correction partial unique index, leave overlap trigger (advisory-locked, 23P01),
  `leave_requests_half_day_valid`, 10 MB cap, document owner/flag rule;
- RLS + tenant-isolation policy on all 11 new tables (18 RLS tables in total, 21 policies);
- `GRANT SELECT, INSERT, UPDATE, DELETE` on the new tables to `hr_app` (guarded on the role existing);
- employee-number sequence seeded from existing `EMP-<n>` (a no-op on an empty schema);
- no extensions needed (`gen_random_uuid()` is built into PostgreSQL 13+).
Full diff: `git diff -- apps/api/src/database/migrations/20261121130000_prd_p0_backend_modules/migration.sql`
(original saved in the session scratchpad as `migration.130000.orig.sql`).

Stage E - seed (needs your approval and a new bootstrap command): a one-off, idempotent production bootstrap
that creates, for the single company (PRD A1): the company (name, timezone, working days/hours), the four
system roles, the first Super Admin user + membership + employee, default leave types (Casual, Sick, Earned)
with balances for that year, and the default onboarding template. It does not exist yet and must NOT be the
local provisioning script (that one creates development personas and refuses hosted databases).

Stage F - RLS verification on Supabase (read-only plus one rolled-back transaction): `relrowsecurity` on 18
tables; as `hr_app`, with no tenant context every table returns 0 rows; with `app.company_id` set to another
company, 0 rows; `rolbypassrls = false`; `hr_app` owns no table.

Stage G - post-migration validation: `prisma migrate status` clean; `prisma migrate diff` from the database to
`schema.prisma` shows only `ALTER COLUMN "updatedAt" DROP DEFAULT` on the 11 new tables (harmless: the database
default is a convenience, Prisma sets the value itself; verified locally in a scratch database, no other drift).
Catalog counts should equal the local scratch run.

Stage H - switching the backend: set `DB_TARGET=supabase` in `.env`, restart the API, check `/health`, log in
as the bootstrap Super Admin. Rollback of the switch = unset `DB_TARGET` (local database untouched).

## 4. Rollback and recovery limits

- Prisma migrations are forward-only. Recovery is: restore from the Stage C export, or, while `hr` holds no
  data worth keeping, `DROP SCHEMA hr CASCADE` and re-create it (explicit approval required each time).
- Migration 7 adds enum values (`ALTER TYPE ... ADD VALUE`): these cannot be removed from an enum in PostgreSQL.
- `REVOKE`s and grants are reversible; policy creation is re-runnable (`DROP POLICY IF EXISTS` first).
- Supabase backups/PITR depend on the project plan: confirm before any data is loaded.

## 5. Approval gates

Explicit approval is required before each of: creating `hr_migrator`; any privilege change; applying
migrations; seeding; changing `env.ts` / `prisma.config.ts` / `client.ts`; switching `DB_TARGET`.
