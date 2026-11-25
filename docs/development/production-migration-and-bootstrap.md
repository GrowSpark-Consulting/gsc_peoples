# Production migration and first-time setup

Date: 2026-11-25. **Nothing here has been run against the hosted database.** Every step marked [WRITE] changes hosted
state and needs your explicit approval at the time. Passwords and connection strings are typed by the operator into
their own shell; never paste them into chat, tickets or files in the repository.

Supersedes `docs/deployment/supabase-production-migration.md`, `docs/deployment/production-bootstrap.md` and
`docs/development/production-bootstrap-plan.md`.

## 0. Roles

| Role | Used by | Rights |
|---|---|---|
| `hr_migrator` | operator machine only (`SUPABASE_DIRECT_URL`) | owns schema `hr` and its objects; runs migrations and the bootstrap |
| `hr_app` | the API on Render (`SUPABASE_DATABASE_URL`) | `USAGE` on `hr`, row access only; no DDL, no `TRUNCATE`, not the owner, `NOBYPASSRLS` |

Only schema `hr` is touched. Do not enable the Supabase Data API for it. Both roles need `search_path = hr` (the
2026-11-24 read-only audit reported this in place).

## 1. Preflight (read only)

From `apps\api`, PowerShell, on the release commit:

```powershell
git status --porcelain                      # empty: you are migrating from a committed release
corepack pnpm install --frozen-lockfile
corepack pnpm db:generate ; git status --porcelain   # still empty: generated metadata is current
corepack pnpm typecheck
Test-Path ..\..\supabase-ca.crt             # True; SUPABASE_CA_CERT_PATH must point at this file
npx prisma validate
$env:DB_TARGET='supabase'
npx tsx scripts/supabase-audit.ts           # read-only transaction
npx prisma migrate status                   # lists what is applied and pending
Remove-Item Env:DB_TARGET
```

Stop unless all of these hold:

- The project reference in the pooler user name is the GSC Peoples project, not any other site's project.
- Schema `hr` is owned by `hr_migrator`; `hr_app` has `USAGE` and **not** `CREATE` on it; neither role can read other
  application schemas.
- `hr` holds no tables, **or** the applied migrations are a clean prefix of the list below with no unfinished or
  rolled-back row.
- PostgreSQL major version is 17 (verified locally on 17.12).
- `show timezone;` returns `UTC` for both `hr_app` and `hr_migrator` (the Supabase default). Timestamps are stored
  without a zone and read as UTC; column defaults use the session time zone, so another setting would shift audit and
  creation times. If it differs: `ALTER ROLE <role> SET timezone = 'UTC';` [WRITE].
- If migration 8 is pending and `hr` already holds departments, this returns no rows:
  `SELECT "companyId", lower(name) FROM hr.departments GROUP BY 1, 2 HAVING count(*) > 1;`
- You know what backups the Supabase plan provides (daily / point-in-time) before real data exists.

## 2. Backup [needed once real data exists]

```powershell
pg_dump --schema=hr --format=custom --file "hr-before-<release>.dump" "<hr_migrator connection typed by you>"
pg_restore --list "hr-before-<release>.dump" | Measure-Object -Line     # the file is readable
```

Store it encrypted and off the repository. Rehearse one restore into a scratch PostgreSQL 17 before go-live
(`pg_restore --clean --if-exists --no-owner` into a database that has the two roles and an empty `hr`).

## 3. Migrate [WRITE]

Eight migrations, applied in name order:

1. `20261119075410_init_hr_schema`
2. `20261119151000_hr_core_schema`
3. `20261119151100_employee_audit_log`
4. `20261119160000_phase1_auth_company`
5. `20261120090000_foundation_holidays_work_hours`
6. `20261120100000_row_level_security`
7. `20261121130000_prd_p0_backend_modules`
8. `20261125090000_department_name_case_insensitive`

Migration 8 (added 2026-11-25) creates one unique index, `departments_companyId_lower_name_key`, and changes no table
or data. It builds under a lock that blocks writes to `departments` for the moment it takes; the table is tiny.

```powershell
$env:DB_TARGET='supabase'
npx prisma migrate deploy
```

Then, once, in a `hr_migrator` session (psql or the SQL editor connected as that role) [WRITE]:

```sql
REVOKE ALL ON "hr"."_prisma_migrations" FROM hr_app;
```

Default privileges give `hr_app` row access to every new table in `hr`, including the migration history; this removes
it. (A test, `runtime-privileges.integration.test.ts`, demonstrates both the exposure and the fix.)

Never run `migrate dev`, `migrate reset`, `db push`, `db execute` or any seed against the hosted database.

## 4. Verify (read only)

```powershell
npx prisma migrate status                   # "Database schema is up to date"
npx tsx scripts/supabase-audit.ts
Remove-Item Env:DB_TARGET
```

Expected: 8 finished rows in `hr._prisma_migrations`; 25 tables including it; every tenant table with row-level
security (the identity tables `users`, `roles`, `company_memberships`, `user_sessions`, `password_reset_tokens`,
`invitation_tokens` are intentionally without); the triggers `employees_no_manager_cycle` and
`leave_requests_no_overlap`; the index `attendance_corrections_one_pending_key`; `hr_app` owns nothing, has only
`SELECT`/`INSERT` on `audit_logs` and `employee_audit_logs`, and nothing on `_prisma_migrations`. As `hr_app`
without `app.company_id`, tenant tables return no rows.

## 5. Company setup (PRD W1) [WRITE]

The tool creates, in one transaction: the company, the four roles, the first Super Admin (employee `EMP-0001`, login,
membership), departments, designations, Casual / Sick / Earned leave types with your allowances, that employee's
balances for the year, the default onboarding checklist and one audit entry. It only inserts what is missing, never
updates or deletes, and refuses a second company.

### 5.1 Inputs (product owner)

Copy `docs/development/bootstrap.config.example.json` to a file **outside the repository** and fill in: company name,
IANA time zone, working days and hours; the first Super Admin's name, work email, department and designation;
department and designation lists; yearly allowance, paid and half-day settings for each leave type; onboarding tasks.
The tool refuses a file that still contains the example placeholders. No password goes in the file.

### 5.2 Rehearse, dry run, run

```powershell
# optional rehearsal against a local scratch database: leave DB_TARGET unset and point DIRECT_URL at it
$env:DB_TARGET='supabase'
npx tsx scripts/bootstrap-production.ts --config C:\secure\bootstrap.json --confirm-company "<exact name>"
#   dry run: checks that all 8 migrations are applied, reports what would be created, changes nothing
npx tsx scripts/bootstrap-production.ts --config C:\secure\bootstrap.json --confirm-company "<exact name>" --web-url https://app.<domain> --execute
Remove-Item Env:DB_TARGET
```

### 5.3 Initial password

No password is chosen by, shown to or handled by the operator. The tool prints a **one-time activation link** to the
interactive terminal only (it refuses to run `--execute` when output is redirected). Give it to the Super Admin over
a separate trusted channel. They open it, choose their own password (10+ characters) and are signed in. The link
works once and expires after 7 days; only its hash is stored. If it expires or is lost before use, run the same
command with `--execute` again: the earlier link is voided and a new one printed. After activation, password recovery
is the "Forgot password" email.

Note the **company id** it prints: the retention job needs it. Delete the configuration file afterwards.

### 5.4 First HR Admin and role assignment

The Super Admin signs in, then:

1. Employees → Add employee (the HR person): department, designation, joining date.
2. On that employee: set a manager, or make them Active with "This person has no manager".
3. On that employee, "Login access": role **HR Admin** → Send invitation. Only a Super Admin can invite an HR Admin
   or Super Admin. The link is emailed (requires email to be configured).
4. Later role changes: Settings → User accounts. The last Super Admin cannot be demoted or disabled.

Recommended: create a second Super Admin so that recovery never depends on one person.

### 5.5 Initial configuration

Settings: company profile, time zone, working days and hours. Departments page: holidays. Leave page: check leave
types. Onboarding → Default checklist.

### 5.6 Verification

1. Run the command again without `--execute`: every "created" count is 0.
2. The Super Admin signs in; `/me` shows `SUPER_ADMIN` with the company settings.
3. Settings → Audit log shows `COMPANY_BOOTSTRAPPED`.
4. Create one employee: the number is `EMP-0002` and the checklist is copied.
5. Invite the HR Admin: email arrives and activates.
6. The runtime role sees rows only with the company context (section 4).

## 6. Recovery

| Situation | Action |
|---|---|
| Bootstrap fails | The transaction rolled back: nothing was created. Fix the cause and run again |
| Wrong values entered | Edit them in the application (names, hours, leave types, lists). The tool never overwrites |
| Wrong company created and **no real data yet** | Only by a separately approved reset of schema `hr` (below) |
| Activation link expired or lost | Run `--execute` again |
| Super Admin locked out | "Forgot password". If email is broken, fix email; there is deliberately no back door |
| Compromised `hr_app` password | Rotate in Supabase, update `SUPABASE_DATABASE_URL` on Render, restart; revoke sessions: `update hr.user_sessions set "revokedAt" = now() where "revokedAt" is null` [WRITE] |

## 7. Rollback: what is and is not possible

- Migrations are **forward only**. There are no down migrations.
- Migration 7 adds enum values; PostgreSQL cannot remove an enum value. It cannot be reversed in place.
- Migration 8 can be reversed by `DROP INDEX hr."departments_companyId_lower_name_key";` (no data is involved)
  followed by `prisma migrate resolve` bookkeeping, both approved separately. This reversal has not been rehearsed.
- Each migration file is applied by Prisma as written; **do not assume a failed migration rolled itself back**. Stop,
  read `hr._prisma_migrations` (an unfinished row) and run the audit script. Then, each needing its own approval:
  (a) clean up by hand and `prisma migrate resolve --rolled-back <name>`; or (b) while `hr` holds no real data,
  `DROP SCHEMA hr CASCADE`, recreate the schema with the owner and grants of
  `docs/development/supabase-migration-plan.md`, and migrate again.
- With real data: restore the backup into a scratch PostgreSQL 17 first, verify it, then decide. Restoring loses
  everything written after the backup. Prefer a forward fix.
- Application rollback (Render / Vercel) changes no data. The schema change of this release is only an added index, so
  an older build keeps working against it. The previous build has the defects this release fixes, though.
- Backups and restore have **not** been rehearsed against the hosted project.

## 8. Verification status of this procedure

| Item | State |
|---|---|
| 8 migrations on an empty PostgreSQL 17.12 scratch database (SQL files and `prisma migrate deploy`) | see the readiness report |
| Upgrade from the previous schema state with data present | migration 7: `p0-migration.integration.test.ts`; migration 8: CLI rehearsal in the readiness report |
| Bootstrap: dry run, create, repeat, refusal, first login | covered by `bootstrap.integration.test.ts` |
| Anything on hosted Supabase | **not done** |
