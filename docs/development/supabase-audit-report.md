# Supabase readiness audit report (read-only)

Date: 2026-11-24. Project `growspark-workspace`, database `postgres`, schema `hr`.
Method: `apps/api/scripts/supabase-audit.ts` plus two throwaway privilege probes (deleted). Every query ran inside
a `READ ONLY` transaction that was rolled back. Nothing was created, changed, seeded or migrated. No credential is
printed here.

## 1. Connections

| Check | hr_app (runtime) | hr_migrator (migrations) |
|---|---|---|
| Strict TLS (`rejectUnauthorized: true`, Supabase CA) | PASS | PASS |
| Endpoint | Session Pooler `aws-1-ap-south-1.pooler.supabase.com:5432` | same |
| `current_database()` | `postgres` | `postgres` |
| `current_user` / `session_user` | `hr_app` | `hr_migrator` |
| `current_schema()` | `hr` | **`public`** |
| `search_path` | `hr` (role setting) | **`"$user", public`** (no role setting) |
| Superuser / CREATEROLE / CREATEDB / BYPASSRLS | all false | all false |
| Role memberships | none | none |
| Objects owned | 0 | 0 |

Server: PostgreSQL **17.12** (aarch64). The repo migrations were verified locally on PostgreSQL 18; a PG17 dry run
has not been done. Extensions present: pgcrypto, uuid-ossp, pg_stat_statements, plpgsql, supabase_vault. The
migrations need none (`gen_random_uuid()` is built in).

Two environment issues found while connecting (no database effect):

- `.env` has `SUPABASE_CA_CERT_PATH="C:/gsc-peoples/supabase-ca.crt"`, which does not exist. The certificate is at
  `C:\Users\PC\gsc_peoples\supabase-ca.crt`. I overrode the variable for the audit run and did NOT edit `.env`.
  The file is untracked and not gitignored (a CA certificate is public, but decide whether to commit it).
- My audit script re-serialised the URL and corrupted a password containing special characters
  (`password authentication failed`). Fixed: it now passes decoded fields. Passwords with reserved characters must
  be percent-encoded inside the URLs.

## 2. Schema isolation

| Schema | Owner | hr_app USAGE | hr_app CREATE | hr_migrator USAGE |
|---|---|---|---|---|
| `hr` | postgres | yes | **yes (must be revoked)** | **no** |
| `public` | pg_database_owner | yes (via PUBLIC) | no | yes (via PUBLIC) |
| `sales` | postgres | no | no | no |
| `project` | postgres | no | no | no |
| auth / storage / extensions | n/a | no | no | no |

- `public` holds no tables or views in this database, and neither role can execute any function there, so USAGE
  on `public` (the PostgreSQL default) exposes nothing.
- Table level: both roles can read 0 of 50 `project` tables and 0 of 19 `sales` tables.
- Both roles have TEMP on the database (default PUBLIC grant); neither can CREATE in the database.

Result: `hr_app` cannot access `sales` or `project`.

## 3. hr_migrator privileges: NOT READY

`hr_migrator` has **no USAGE and no CREATE on schema `hr`**, which is owned by `postgres`. It cannot create a
table. Its privileges are too few, not too many. Stage B (to be run by a Supabase admin, see checklist) must give
it ownership of `hr`, set its search_path and set default privileges toward `hr_app`.

The inverse problem: `hr_app` currently holds **CREATE on `hr`**. It must be revoked. Otherwise the runtime role
could create and own tables, which would bypass RLS (RLS is enabled but not forced).

## 4. Hosted `hr` schema versus the seven migrations

| Item | Hosted state |
|---|---|
| Tables in `hr` | **0** |
| Enums, constraints, indexes, policies, triggers, functions | **0** each |
| `hr._prisma_migrations` | **does not exist** |
| hr_app table privileges | none (nothing exists) |
| Default privileges for `hr_migrator` | none (only `postgres`, `supabase_*`, `project_migrator` entries) |

The schema is empty, so all seven migrations are pending and no existing data can be lost. The duplicate-holiday
FK, `isActive` and sequence-backfill repairs in migration 7 matter only for local databases with data.

| # | Migration | Hosted | Expected effect |
|---|---|---|---|
| 1 | 20261119075410_init_hr_schema | missing | companies |
| 2 | 20261119151000_hr_core_schema | missing | users, roles, departments, memberships, employees, cycle trigger |
| 3 | 20261119151100_employee_audit_log | missing | employee_audit_logs; REVOKE UPDATE/DELETE from hr_app |
| 4 | 20261119160000_phase1_auth_company | missing | sessions, tokens; unguarded REVOKE on hr_app (role exists, fine) |
| 5 | 20261120090000_foundation_holidays_work_hours | missing | holidays, company work hours |
| 6 | 20261120100000_row_level_security | missing | RLS on 7 tables, `current_company_id()` |
| 7 | 20261121130000_prd_p0_backend_modules | missing | 11 new tables, enum additions, constraints, RLS, grants; 18 RLS tables in total |

Migrations 1 to 6 contain no explicit GRANT to `hr_app`; they rely on default privileges for `hr_migrator`
(migration 7 grants explicitly). Without the Stage B default privileges, `hr_app` gets "permission denied" on the
tables from migrations 1 to 6.

## 5. Findings

| # | Severity | Finding |
|---|---|---|
| B1 | Blocker | `hr_migrator` has no access to schema `hr` and does not own it. |
| B2 | Blocker | `hr_app` holds CREATE on `hr`; revoke before any table exists. |
| B3 | Blocker | No default privileges from `hr_migrator` to `hr_app`. |
| B4 | Blocker | `.env` CA path is wrong (`C:/gsc-peoples/...`). |
| W1 | Warning | `hr_migrator` search_path is `public`; set it to `hr` (and keep `?schema=hr` in the URL). |
| W2 | Warning | Server is PostgreSQL 17; migrations were verified on 18 only. |
| W3 | Warning | Migration 7 uses `ALTER TYPE ... ADD VALUE` in a transaction; passed on 18, unconfirmed on 17. |
| W4 | Warning | No production bootstrap exists (company, Super Admin, roles, leave types, template). |
| W5 | Warning | Migrations run through the Session Pooler: acceptable for Prisma (session mode); keep connections low. |
| W6 | Warning | The CA file sits untracked in the repo root. |
