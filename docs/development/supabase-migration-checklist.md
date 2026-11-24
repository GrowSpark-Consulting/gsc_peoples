# Supabase migration checklist (nothing here has been executed)

Target: `growspark-workspace` / `postgres` / schema `hr`. Hosted `hr` is currently EMPTY (see the audit report).
Because it is empty, the backup is a schema-only safeguard, and rollback is "drop and recreate `hr`" (explicit
approval each time). Never touch `public`, `sales` or `project`.

## A. Prerequisites (owner or Supabase admin; none are done)

- [ ] Fix `.env`: `SUPABASE_CA_CERT_PATH=C:/Users/PC/gsc_peoples/supabase-ca.crt`.
- [ ] Percent-encode special characters in both passwords inside the URLs.
- [ ] Stage B SQL, run in the Supabase SQL editor as `postgres` (needs your approval; I do not run it):

```sql
ALTER SCHEMA hr OWNER TO hr_migrator;                 -- schema is empty, so no object ownership transfer
ALTER ROLE hr_migrator SET search_path = hr;
GRANT USAGE ON SCHEMA hr TO hr_app;
REVOKE CREATE ON SCHEMA hr FROM hr_app;               -- the runtime role must never create or own objects
REVOKE ALL ON SCHEMA hr FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE hr_migrator IN SCHEMA hr
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hr_app;
ALTER DEFAULT PRIVILEGES FOR ROLE hr_migrator IN SCHEMA hr
  GRANT USAGE, SELECT ON SEQUENCES TO hr_app;
```

- [ ] Re-run the audit. Expect: `hr` owned by `hr_migrator`; hr_app USAGE only; hr_migrator USAGE and CREATE;
      default ACLs present.
- [ ] Optional: dry-run the migrations on a scratch PostgreSQL 17 (audit W2, W3).
- [ ] Confirm the Supabase backup/PITR plan (matters once data exists).

## B. Pre-flight (read-only)

- [ ] `prisma validate`, `prisma generate`, API typecheck.
- [ ] Confirm `DB_TARGET=supabase` makes the Prisma CLI use hr_migrator with `sslaccept=strict`.
- [ ] Schema-only export (`pg_dump -n hr --schema-only`) as hr_migrator.
- [ ] Local `hr_db` and `hr_test` untouched (they use `DB_TARGET=local`).

## C. Apply (only after explicit approval)

Run `prisma migrate deploy` as hr_migrator. Never `migrate dev`, `reset` or `db push`. Order:

1. 20261119075410_init_hr_schema
2. 20261119151000_hr_core_schema
3. 20261119151100_employee_audit_log
4. 20261119160000_phase1_auth_company
5. 20261120090000_foundation_holidays_work_hours
6. 20261120100000_row_level_security
7. 20261121130000_prd_p0_backend_modules

After the run: `prisma migrate status`; every `_prisma_migrations` row finished and not rolled back.

## D. Post-migration verification

- [ ] 18 RLS-enabled tables and 21 policies; hr_app owns 0 tables; `rolbypassrls = false`.
- [ ] Constraints: attendance unique, leave overlap trigger, holiday FK (single), manager cycle trigger.
- [ ] Employee-number sequence exists and starts at 1.
- [ ] Append-only audit: hr_app has no UPDATE or DELETE on `audit_logs` and `employee_audit_logs`.
- [ ] As hr_app with no `app.company_id`: every tenant table returns 0 rows; with a foreign company id: 0 rows.
- [ ] `prisma migrate diff` (database to schema) shows only the known `updatedAt` default drift on the 11 new tables.
- [ ] `sales` and `project` unchanged (19 and 50 tables before the run).

## E. Afterwards (separate approvals)

Production bootstrap command, then backend verification against Supabase. Rollback: restore from the export, or
drop and recreate `hr`. Enum additions in migration 7 cannot be removed.
