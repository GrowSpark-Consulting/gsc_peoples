# Local database: migration state, backup, rollback, tests

Scope: the **local** PostgreSQL 18 server on `localhost:5432` (databases `hr_db` and `hr_test`, roles
`hr_app` and `hr_migrator`). Nothing here touches staging or production, and nothing here may.

## Current migration state (`hr_db`, schema `hr`)

| Order | Migration                           | Content                                                                                                                                 | Applied      |
| ----- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 1     | `20261119075410_init_hr_schema`     | `companies`                                                                                                                             | earlier      |
| 2     | `20261119151000_hr_core_schema`     | users, roles, role_permissions, departments, company_memberships, employees; enums; composite company FKs; CHECKs; manager-cycle trigger | 2026-11-19   |
| 3     | `20261119151100_employee_audit_log` | `employee_audit_logs` (+ enum); UPDATE/DELETE/TRUNCATE revoked from `hr_app` (append-only)                                              | 2026-11-19   |

- Migrations 2 and 3 are byte-identical copies of `candidate-migration/migration.sql` and
  `candidate-migration-audit-log/migration.sql` (SHA-256 verified). The candidate folders are now
  **superseded duplicates** and can be deleted once you have reviewed the real migrations.
- Applied with `prisma migrate deploy` as `hr_migrator` (never `migrate dev`, which can reset).
  `prisma migrate status`: up to date. `prisma migrate diff` live DB vs `schema.prisma`: no difference.
- `hr_db` holds **no data**: 0 companies, users, employees or audit rows. Test users and memberships
  exist only in `hr_test` (created by the integration suite).

## Order and dependencies

2 needs 1 (`companies`). 3 needs 2 (`employees`, `users`). Always apply in name order. The trigger
function is schema-qualified (`"hr"."employees_prevent_manager_cycle"`), so the target schema must be `hr`
(the `?schema=hr` in the connection URLs).

## Backup taken before applying

`C:\Users\PC\gsc-db-backups\hr_db_schema-hr_before-employee-migrations_<timestamp>.dump`
(custom-format `pg_dump` of schema `hr`, outside the repository). It contained only `companies` (empty)
and `_prisma_migrations` (1 row).

Take a new one before any future migration:

```
pg_dump --host localhost --port 5432 --username hr_migrator --dbname hr_db --schema hr ^
        --format custom --file <path>.dump        # password via PGPASSWORD, never on the command line
```

## Rollback

Both new migrations are additive, so the safest rollback is restoring the pre-migration dump:

1. Stop the API (nothing may be writing).
2. If `hr_db` has data you want to keep, take a fresh dump first.
3. `pg_restore --clean --if-exists --dbname hr_db --schema hr <backup>.dump` as `hr_migrator`
   (restores `companies` and `_prisma_migrations` to the 1-migration state).
4. `prisma migrate status` should again list the two migrations as pending.

Manual reverse (only while the new tables are still empty), as `hr_migrator`, in this order:

```sql
DROP TABLE hr.employee_audit_logs;  DROP TYPE "EmployeeAuditAction";
DROP TRIGGER employees_no_manager_cycle ON hr.employees;  DROP FUNCTION hr.employees_prevent_manager_cycle();
DROP TABLE hr.company_memberships, hr.role_permissions, hr.employees, hr.departments, hr.roles, hr.users;
DROP TYPE "UserStatus", "MembershipStatus", "EmploymentType", "EmploymentStatus";
DELETE FROM hr._prisma_migrations WHERE migration_name IN
  ('20261119151000_hr_core_schema', '20261119151100_employee_audit_log');
```

## Integration tests (real PostgreSQL)

`pnpm --filter @gsc/api test:integration` (from `apps/api`: `vitest run --config vitest.integration.config.ts`).

- Runs only against **`hr_test`**. `src/test/integration/helpers.ts` refuses any other database name and any
  URL equal to `DATABASE_URL`/`DIRECT_URL`. `global-setup.ts` drops and rebuilds schema `hr` in `hr_test`
  from the real folders in `src/database/migrations/` (the same files `migrate deploy` applies) before each run.
- Fixtures are inserted as `hr_migrator`; the application under test connects as `hr_app`
  (least privilege), exactly like production will.
- Provisioned per test file in `hr_test`: two companies, users, roles with the registry's recommended
  permissions, ACTIVE / INVITED / SUSPENDED memberships, a disabled user, departments and employees.
- Because it reads `migrations/`, deleting the superseded `candidate-migration*` folders cannot affect it.

## Local provisioning (users, roles, memberships)

`pnpm db:provision:local` (script `apps/api/scripts/provision-local.ts`, logic in
`apps/api/src/database/provisioning/local-provisioning.ts`).

- Runs as `hr_migrator` (`DIRECT_URL`) from the CLI only; never from the API or the browser.
- Refuses any host other than localhost, any database other than `hr_db`/`hr_test`, and `NODE_ENV=production`.
- Company id = `DEV_AUTH_COMPANY_ID` (default `dev-company`), so the dev auth adapter and the data agree.
- Creates the 4 system roles with the registry default permissions, 2 departments, and 4 people
  (`dev-super-admin` SUPER_ADMIN `sam.superadmin@dev.local`, `dev-hr-admin` HR_ADMIN, `dev-manager` MANAGER, `dev-employee` EMPLOYEE reporting to the manager), each with an
  employee record and an ACTIVE membership.
- Insert-only and idempotent (`ON CONFLICT DO NOTHING` on natural keys, one transaction): re-running creates
  nothing and never overwrites later edits. Grants outside the registry defaults are reported, not removed.
- Seeded employees are written directly, so they have no audit rows.
- Login passwords: `pnpm db:provision:local --set-password <email> [--set-password <email>]` sets the password of an
  existing provisioned persona (hidden prompt + confirmation, never an argument). It provisions nothing, updates only
  `users."passwordHash"` (same `hashPassword` as login), and applies the same localhost / `hr_db`|`hr_test` /
  non-production guards. Never prints a password or hash. Passwords are 10-128 characters.
- Dev tokens (only with `AUTH_MODE=development`): `Authorization: Bearer dev:dev-hr-admin` etc.
  This is not Central Authentication; the SSO provider still fails closed.

`GET /api/v1/me` returns the caller's user id, employee id, company, roles and permissions from the validated
membership (contract: `packages/contracts/src/me.ts`).
