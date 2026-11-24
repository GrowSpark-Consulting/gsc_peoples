# Supabase migration readiness: final report (2026-11-24)

Nothing was deployed to Supabase. Hosted use was limited to read-only catalog queries (`READ ONLY`
transactions, rolled back). No migration, role change, seed, commit or push was performed. `.env` was not edited.

## A. Supabase permission audit (hosted, read-only)

| Check | Expected | Actual | Result |
|---|---|---|---|
| Strict TLS, both roles | verified | verified with the Supabase CA | PASS |
| Server version | PostgreSQL 17 | 17.12 | info |
| `hr` owner | hr_migrator | hr_migrator | PASS |
| hr_app USAGE / CREATE on hr | true / false | true / false | PASS |
| hr_migrator USAGE / CREATE on hr | true / true | true / true | PASS |
| rolsuper, rolbypassrls (both roles) | false | false | PASS |
| search_path (both roles) | hr | hr (role setting; confirmed by `current_schema()`) | PASS |
| Default table ACL (hr_migrator, schema hr) | hr_app SELECT, INSERT, UPDATE, DELETE | `hr_app=arwd` | PASS |
| Default sequence ACL | hr_app USAGE, SELECT | `hr_app=rU` (r = SELECT, U = USAGE) | PASS (both present, nothing missing) |
| Objects in `hr` owned by hr_app | 0 | 0 | PASS |
| Tables in `hr`, `_prisma_migrations` | none | none (`to_regclass` is null) | PASS |
| hr_app USAGE on sales / project | false | false / false | PASS |
| `public` | no exposure | USAGE via default, 0 tables, 0 executable functions | PASS |
| `sales` and `project` untouched | n/a | 19 and 49 base tables, no access from either role | PASS |

## B. PostgreSQL 17 isolated dry-run

- Scratch server: PostgreSQL **17.12** (the `@embedded-postgres` Windows build, installed in the session scratchpad),
  127.0.0.1:54317, separate data directory. Not connected to Supabase, `hr_db` or `hr_test`.
  Database `hr_pg17_scratch_20261124`. The server is stopped now.
- Roles reproduced from the Stage B SQL: hr_migrator owns `hr`, hr_app has USAGE only, default privileges as on Supabase.
- `prisma migrate deploy` ran against that scratch database only (DB_TARGET=local, URLs set explicitly).

| # | Migration | Result |
|---|---|---|
| 1 | 20261119075410_init_hr_schema | applied |
| 2 | 20261119151000_hr_core_schema | applied |
| 3 | 20261119151100_employee_audit_log | applied |
| 4 | 20261119160000_phase1_auth_company | applied |
| 5 | 20261120090000_foundation_holidays_work_hours | applied |
| 6 | 20261120100000_row_level_security | applied |
| 7 | 20261121130000_prd_p0_backend_modules | applied |

Final `_prisma_migrations`: 7 rows, all finished, none rolled back. The migrations directory holds exactly these
seven folders, matching the expected order.

Catalog result: 25 tables (24 application tables plus `_prisma_migrations`), 0 sequences, 96 indexes,
89 constraints (47 foreign keys), 11 enums, 2 triggers (`employees_no_manager_cycle`, `leave_requests_no_overlap`),
**18 RLS tables, 21 policies**, 0 forced-RLS tables. All tables and indexes are owned by hr_migrator.
The 7 tables without RLS are the authentication plane, documented in migration 6: `company_memberships`, `roles`,
`user_sessions`, `password_reset_tokens`, `invitation_tokens`, `users`, plus `_prisma_migrations`.
Holidays have one FK (`holidays_companyId_fkey`), and the `isActive` column exists. Attendance unique
(company, employee, date), one-pending-correction index, leave overlap trigger, half-day and 10 MB checks all exist.
The "employee number sequence" is a table (`employee_number_sequences`), so there are no SQL sequences.

Direct security checks as hr_app on the scratch database: **28 of 28 passed**.
- No tenant context returns 0 rows on all tenant tables.
- Tenant A sees only its own rows. It cannot insert, update or delete tenant B's rows, and cannot create companies.
- Context does not leak after the transaction.
- `audit_logs` and `employee_audit_logs` allow INSERT and SELECT only.
- hr_app cannot CREATE TABLE in `hr` or `public`, cannot disable RLS, cannot `SET ROLE hr_migrator`.
- hr_app owns 0 tables.
- A new table and serial sequence created by hr_migrator are immediately usable by hr_app (no TRUNCATE).
- Duplicate holiday date and an FK violation are rejected.

## C. Application checks

| Command | Result |
|---|---|
| `prisma validate` | pass |
| `prisma generate` (Prisma 7.10.1; output is gitignored) | pass |
| Typecheck: api, web, contracts, shared | all pass |
| Unit tests: api | 139 of 139 pass (14 files) |
| Unit tests: web | 170 of 170 pass (18 files) |
| Unit tests: contracts | 46 of 46 pass |
| Unit tests: shared | 2 of 2 pass |
| New `DB_TARGET` tests | 3 of 3 pass (part of the api total) |
| Integration, scratch PG17 (10 files) | 203 pass, 4 fail, 1 todo (see issue 2); the 4 pass after the setup difference is removed (39 of 39 in the two affected files) |
| ESLint, web | 0 errors, 1 warning |
| ESLint, api | **166 errors** (158 `no-explicit-any`, 8 unused vars) |
| Playwright e2e | **not run** (needs a running app and seeded data; not part of this task) |

The api unit tests fail 2 of 139 if `DATABASE_URL` is set to an unreachable database (health returns degraded,
`/me` returns 500). They pass with it unset, so the suite depends on the environment but not on the code.

## D. Issues found

| # | Where | Failure | Root cause | Recommendation | Approval |
|---|---|---|---|---|---|
| 1 | `.env` | `DB_TARGET=supabase` is uncommented and `SUPABASE_CA_CERT_PATH` points at `C:/gsc-peoples/supabase-ca.crt` (missing) | Left from setup | Comment out `DB_TARGET`, fix the CA path to `C:/Users/PC/gsc_peoples/supabase-ca.crt`. Today any `pnpm dev` or Prisma command fails at the missing certificate; once the path is fixed it would silently use the hosted database | Yes (your file) |
| 2 | `schema-objects` and `foundation` integration tests (4 tests) | `regclass::text` returns `employees`, not `hr.employees`; one test asserts the role search_path excludes `hr` | The test setup assumes the roles have no `search_path`. Supabase roles have `search_path=hr`, so the tests will fail when run in a Supabase-like role setup. Not a migration defect: they pass after `RESET search_path` | Make the tests schema-agnostic (cast with `format('%I.%I')` or set the role search_path inside the test). Not changed; I do not edit tests to make a run pass | Yes |
| 3 | `apps/api` lint | 166 errors in `employees.repository.ts` (46), `organization.routes.ts` (33), `leave.routes.ts` (21), documents, onboarding, attendance, dashboard routes | Typed-`any` usage in the backend written in the last commit | Type the Prisma delegates and request objects; do before the CI lint gate | Yes (code change) |
| 4 | `apps/api/src/database/candidate-migration/` and `candidate-migration-audit-log/` | Duplicate copies of migrations 2 and 3 outside the canonical path | Leftover drafts | Delete after you confirm; nothing reads them | Yes (deletion) |
| 5 | Migration 6 | `company_memberships`, `roles`, `users`, sessions and tokens have no RLS | Deliberate (authentication plane is read before a tenant is known), tested by `rls.integration.test.ts` | Accept, but note it: isolation for those tables relies on application queries | Decision |
| 6 | No production bootstrap | No way to create the first company and Super Admin on Supabase | Not implemented | Build as the next phase | Yes |
| 7 | `supabase-ca.crt` | Untracked in the repo root | Not gitignored | Decide: commit it (it is public) or ignore it | Yes |
| 8 | Earlier report wording | I said passwords with reserved characters need percent-encoding. Your two URLs contain no reserved URL characters, so none is needed | The audit script re-serialised the URL; it now passes decoded fields | None | No |

## E. Production migration readiness: **GO** (conditional on issue 1)

All security, compatibility and verification checks pass: the Supabase role setup is correct and `hr` is empty,
all seven migrations apply cleanly on PostgreSQL 17.12 with the Stage B roles, RLS and grants behave as intended,
and the application builds and its unit tests pass. The hosted migration can be considered for a separate
explicit approval. Fix issue 1 before running anything, so the Prisma CLI really targets hr_migrator with strict TLS.
Issues 2 to 4 do not block the migration but should be resolved before CI is relied on.

## F. Next actions

1. **Completed safely:** read-only hosted audit; PG17 isolated dry-run; scratch security checks; application checks;
   reports (this file, `supabase-audit-report.md`, `supabase-migration-checklist.md`, `prd-integration-matrix.md`);
   `DB_TARGET` and strict-TLS code; PG17 scratch server stopped.
2. **Manual Supabase action still required:** none for permissions. Optionally confirm the project's backup/PITR
   plan (the schema is empty, so nothing is at risk yet).
3. **Needs your separate approval:** fix `.env` (issue 1); the hosted `prisma migrate deploy`; production bootstrap;
   test and lint fixes (issues 2 and 3); deleting duplicate migration folders (issue 4).
4. **NOT performed on the hosted database:** migrations, seeds, role or privilege changes, `_prisma_migrations` creation,
   any write of any kind.
