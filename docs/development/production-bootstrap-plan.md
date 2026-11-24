# Production bootstrap: implementation plan (PRD W1). PLAN ONLY, nothing implemented or executed

Goal: one idempotent command that sets up the single company (PRD A1) on a freshly migrated hosted `hr` schema.
It is NOT `provision-local.ts` and creates no development personas. It does not run until you approve it.

## 1. Command shape

- New file `apps/api/scripts/bootstrap-production.ts`, logic in `apps/api/src/database/bootstrap/bootstrap.ts`
  (unit-testable, takes a `pg.Client`). New npm script `db:bootstrap` that is **not** wired into `dev`, `test` or any hook.
- Connects as **hr_migrator** (`SUPABASE_DIRECT_URL`, strict TLS, schema `hr`), the same role as migrations.
  `hr_app` can neither insert companies (no INSERT policy) nor roles, so it cannot be used.
- Explicit target: refuses to run unless `DB_TARGET=supabase` is set AND `--confirm-company "<company name>"` matches the
  input. Refuses any other host (inverse of the local safeguard). `--dry-run` (default) prints what it would create.
- Refuses to start if the schema is not fully migrated (7 finished `_prisma_migrations` rows).
- Idempotent: every insert is `ON CONFLICT DO NOTHING` on a natural key, runs in one transaction, and never overwrites
  an edit made later. Re-running reports "0 created".
- Duplicate-setup guard (PRD W1: "duplicate setup blocked"): if a company already exists, it stops unless the same
  company id/name is passed (single company per deployment).

## 2. Inputs (no secrets on the command line)

| Input | Source |
|---|---|
| Company name, timezone (IANA), working days (default Mon-Fri), hours (default 09:00-18:00), logo (optional) | JSON file `--config bootstrap.config.json` (committed template without real data) |
| First Super Admin: first name, last name, work email | same file |
| Super Admin password | hidden prompt (reuses `scripts/prompt-hidden.ts`; hashed with the existing scrypt helper `modules/auth/password.ts`); never in argv, env or logs |
| Leave type allowances, onboarding checklist items, departments, designations | same file (PRD "business inputs before build"), with PRD defaults |

Validation reuses the shared Zod contracts: valid IANA timezone, at least one working day, start before end.

## 3. What it creates (all in `hr`, one transaction)

1. **Company**: `companies` row (name, timezone, workStartTime, workEndTime, working days).
2. **Four system roles** per company with the default permissions from `ROLE_DEFAULT_PERMISSIONS` (SUPER_ADMIN,
   HR_ADMIN, MANAGER, EMPLOYEE; `isSystem = true`), insert-only like the local provisioner.
3. **Employee number sequence**: `employee_number_sequences` row, `nextValue` set past the first employee.
   The PRD format is `EMP-0001` (A10); local personas use `EMP-001`, so confirm the formatter's width before this
   runs (it is a one-line check in the employees repository).
4. **First employee**: status ACTIVE, `EMP-0001`, joining date today, no manager (explicit "top-level" per W3),
   department and designation from the config.
5. **User**: `users` row (`externalId` generated, email = work email lowercased, `passwordHash`, status ACTIVE).
6. **Membership**: `company_memberships` row linking user, company, SUPER_ADMIN role and the employee, status ACTIVE.
   Satisfies "at least one SA" and the last-SA protection from the first minute.
7. **Departments and designations** from the config (unique case-insensitive names).
8. **Default leave types**: Casual, Sick, Earned (PRD LEAVE-001, A4), with `annualAllocation`, `isPaid`, `allowHalfDay`
   from the config; no carry-forward.
9. **Leave balances** for the current year for the Super Admin employee only
   (`allocated` = annual allocation, `adjusted` 0). Later employees get theirs through the existing create flow.
10. **Onboarding template**: `onboarding_template_tasks` rows (title, `dueOffsetDays`, assignee HR or EMPLOYEE) from
    the config; existing checklists are copies, so later edits never touch them (ONB-001).
11. **Audit entries**: one `audit_logs` row per created object group (actor = the new Super Admin user,
    action `COMPANY_BOOTSTRAPPED`), no personal data beyond ids.
12. Holidays: not created (the PRD lists them as a post-setup SA step).

## 4. Safety and verification

- Runs `BEGIN ... COMMIT`; any failure rolls back everything.
- Prints counts only (never emails, hashes, URLs). The password prompt is hidden and the hash is never printed.
- No Supabase role or privilege changes; no DDL.
- Tests (scratch PG17 only): integration test that bootstraps an empty scratch DB, asserts the row counts above,
  re-runs for "0 created", asserts the dry run writes nothing, asserts it refuses a non-hosted/local target without the
  explicit flag, then logs in as the Super Admin through the real API and loads `/me`.
- RLS: the command runs as the table owner (not forced), the same way migrations and test fixtures do. Post-run check as
  `hr_app` with the new company id returns exactly the new company's rows and nothing without context.

## 5. Open questions for you

1. Company name, timezone, working days/hours, and the first Super Admin's name and work email.
2. Leave allowances for Casual, Sick, Earned (PRD does not give numbers).
3. Onboarding checklist items, departments and designations lists.
4. Employee code format: `EMP-0001` (PRD) vs the local `EMP-001`.
5. Where the invite/reset email sender comes from (PRD A12), because the Super Admin invites everyone else by email.

## 6. Not included

Seeding demo data, holidays, additional employees, any Supabase Auth integration (custom sessions stay, see
`docs/architecture/auth-deviation.md`).
