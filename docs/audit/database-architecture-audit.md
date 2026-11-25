# Database & Architecture Audit

**Audit Date:** 2026-11-25 (Re-audited after P0 remediation changes)  
**Scope:** Prisma schema ([`schema.prisma`](file:///c:/Users/PC/gsc_peoples/apps/api/src/database/prisma/schema.prisma)), SQL migrations (`apps/api/src/database/migrations/`), tenant isolation (`apps/api/src/database/tenant/`), storage, mail, bootstrap, and deployment architecture ([`render.yaml`](file:///c:/Users/PC/gsc_peoples/render.yaml), [`env.ts`](file:///c:/Users/PC/gsc_peoples/apps/api/src/config/env.ts)).

---

## 1. Architecture Overview & Deliberate Deviations

- **Backend:** Modular Express 5 + TypeScript + Prisma 7 (`@prisma/adapter-pg`) API (`apps/api`), bundled with `tsup` for Render (`node dist/server.js`, plus `dist/purge-documents.js` and `dist/bootstrap-production.js`).
- **Frontend:** Next.js 16 App Router + Tailwind CSS 4 (`apps/web`), intended for Vercel.
- **Shared Packages:** `@gsc/contracts` (Zod schemas, `PERMISSIONS`, `can()`), `@gsc/shared` (normalization/utilities), `@gsc/config` (TS/ESLint).
- **Architectural Deviation — Custom Session Auth vs. Supabase Auth:**
  - Documented in [`docs/architecture/auth-deviation.md`](file:///c:/Users/PC/gsc_peoples/docs/architecture/auth-deviation.md).
  - Uses first-party email/password authentication with `scrypt` password hashes, PostgreSQL-backed `user_sessions`, `HttpOnly` `gsc_session` cookies, and double-submit `gsc_csrf` tokens.
  - **Email Delivery:** Now implemented via `apps/api/src/integrations/mail/` (`smtp-mailer.ts` using `nodemailer` with mandatory TLS in production, `memory` driver for tests, and `disabled` failing closed in production).

---

## 2. Prisma Schema & Data Model Audit

### Verified Strengths
1. **Multi-tenant composite foreign keys:** Every company-owned table carries `companyId` and uses composite unique keys `@@unique([companyId, id])` and composite FKs `(companyId, targetId) -> target(companyId, id)`. Cross-company references are blocked at the database level.
2. **Generated Tenant Metadata Guard:** `meta.generated.ts` and `assertTenantMeta()` fail closed if tenant metadata is missing or out of sync with `schema.prisma`, and `scopeOperation()` enforces `companyId` scoping on every `tenantRunner` query.
3. **Sequential Employee IDs (`EMP-0001`):** `EmployeeNumberSequence` + atomic `INSERT ... ON CONFLICT DO UPDATE` inside the creation transaction (`employees.repository.ts`). Concurrency-safe.
4. **Attendance & Leave Constraints:**
   - `@@unique([companyId, employeeId, date])` and `CHECK ("checkOutAt" IS NULL OR "checkInAt" IS NULL OR "checkOutAt" > "checkInAt")` on `attendance_records`.
   - Partial unique index `attendance_corrections_one_pending_key` on `("companyId", "employeeId", "date") WHERE "status" = 'PENDING'`.
   - Trigger `leave_requests_prevent_overlap` using `pg_advisory_xact_lock` per `(companyId, employeeId)` and raising SQLSTATE `23P01`.
5. **Document Constraints:** `CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 10485760)` and `employee_documents_owner_matches_flag`.
6. **Production Bootstrap (`W1`):** `apps/api/src/database/bootstrap/bootstrap.ts` + `apps/api/scripts/bootstrap-production.ts` provide an idempotent dry-run/execute CLI bootstrap creating the company, 4 roles, initial Super Admin invitation, default leave types (Casual, Sick, Earned), and default onboarding template tasks.

### Remaining Schema / Architecture Notes
1. **Legacy / Duplicate Employee Columns (`schema.prisma:301-308`):** `Employee` retains `jobTitle` alongside `designationId`, `hireDate` alongside `joiningDate`, and `terminationDate` alongside `exitDate`. Database `CHECK` requires `terminationDate` for `TERMINATED`, while `exitDate` for `INACTIVE` is enforced in the API/Zod layer rather than a DB `CHECK` constraint.
2. **`LeaveBalance` stores `used` and `pendingReserved`:** Updated transactionally with `pg_advisory_xact_lock` (`lockEmployeeLeave`) on apply, review, cancel, adjust, and offboarding, rather than computed on read.
3. **30-Day Document Purge Scheduling (`DOC-005`):** `apps/api/src/jobs/purge-documents.ts` is built (`dist/purge-documents.js`), but requires a Render Cron Job / external scheduler to run daily in production.
4. **In-Memory Rate Limiter:** `rate-limit.ts` and `auth.routes.ts` use in-memory `Map`s; `render.yaml` restricts the API to one instance to match.

---

## 3. Migrations & Row-Level Security (RLS) Audit

### Migration History (`apps/api/src/database/migrations/`)
1. `20261119075410_init_hr_schema` — `companies`
2. `20261119151000_hr_core_schema` — `users`, `roles`, `role_permissions`, `departments`, `company_memberships`, `employees`, email normalization CHECKs, `employees_no_self_manager` CHECK, `employees_prevent_manager_cycle` trigger.
3. `20261119151100_employee_audit_log` — `employee_audit_logs` + `REVOKE UPDATE, DELETE, TRUNCATE ... FROM hr_app`.
4. `20261119160000_phase1_auth_company` — company calendar columns & CHECKs, `user_sessions`, `password_reset_tokens`, `invitation_tokens`, `audit_logs` + `REVOKE UPDATE, DELETE, TRUNCATE`.
5. `20261120090000_foundation_holidays_work_hours` — `workEndTime` default `'18:00'`, `holidays` table.
6. `20261120100000_row_level_security` — `current_company_id()` + RLS on `companies`, `employees`, `departments`, `holidays`, `role_permissions`, `employee_audit_logs`, `audit_logs`.
7. `20261121130000_prd_p0_backend_modules` — `designations`, `employee_number_sequences`, `onboarding_*`, `attendance_*`, `leave_*`, `employee_documents`, `notifications`, leave overlap trigger, RLS policies, and `GRANT`s to `hr_app`.
8. `20261125090000_department_name_case_insensitive` — **NEW:** `CREATE UNIQUE INDEX "departments_companyId_lower_name_key" ON "departments"("companyId", lower("name"))` (aligning departments with designations & leave types per PRD `ORG-002`).

### Findings
- **Candidate Migrations:** `apps/api/src/database/candidate-migration/` and `candidate-migration-audit-log/` remain as obsolete unapplied folders and should be removed.
- **Auth-Plane Tables without RLS:** `users` (global), `roles`, `company_memberships`, `user_sessions`, `password_reset_tokens`, `invitation_tokens` remain outside RLS by design for pre-tenant auth lookup.
- **Append-Only Audit Logs:** `audit_logs` and `employee_audit_logs` have `REVOKE UPDATE, DELETE, TRUNCATE` for `hr_app` and `SELECT`/`INSERT`-only RLS policies.
- **Hosted Supabase:** Not connected or modified during this audit; `supabase-production-migration.md` documents manual `hr_migrator` deployment.
