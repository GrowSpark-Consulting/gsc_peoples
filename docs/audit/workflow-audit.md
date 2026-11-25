# Workflow Audit (W1 – W10)

**Audit Date:** 2026-11-25 (Re-audited after P0 remediation changes)  
**Scope:** End-to-end verification of all 10 PRD workflows (pp. 5–8) across UI -> API -> Service/Repository -> Database -> Audit Log -> Notifications -> Failure Handling.

---

## W1. Company Setup
- **PRD:** SA signs up / configures company -> name, timezone, working days (Mon–Fri), hours (09:00–18:00) -> system creates company, SA membership, default leave types, onboarding template -> SA adds departments, designations, holidays.
- **Status:** **COMPLETE (via CLI bootstrap + Settings/Org UI)**
- **Verification:** `apps/api/scripts/bootstrap-production.ts` (`bootstrap.ts`) creates the company, 4 roles, initial Super Admin invitation, default leave types (Casual, Sick, Earned), and default onboarding template tasks idempotently. SA can then edit settings in `/settings` and add departments, designations, and holidays in `/departments`.

## W2. Employee Creation
- **PRD:** HR/SA fills required fields -> system checks email uniqueness & manager (no cycle) -> generates `EMP-0001`, saves status `ONBOARDING`, creates checklist, adds timeline entry.
- **Status:** **COMPLETE**
- **Verification:** `employee-form.tsx` auto-generates `EMP-0001` (optional/omitted on create), includes `designationId`, `departmentId` (required), `joiningDate`, `phone`, `address`, `emergencyContact`. `employees.repository.ts` validates uniqueness and manager cycles, creates `ONBOARDING` record, copies `OnboardingTemplateTask`s, writes `EmployeeAuditLog`, and notifies HR if HR tasks exist.

## W3. Employee Onboarding
- **PRD:** HR adjusts checklist -> uploads docs -> sets dept & manager -> HR & employee complete tasks -> all done: `Completed`, HR notified -> HR sets `Active` (needs joining date & manager or explicit "no manager"). Incomplete tasks do not block Active; HR override logged.
- **Status:** **COMPLETE**
- **Verification:** `onboarding.routes.ts` enforces `can('onboarding.completeTask')`, blocks Managers, emits `ONBOARDING_TASK_ASSIGNED`, `ONBOARDING_TASK_COMPLETED`, and `ONBOARDING_COMPLETED` notifications, and exposes `GET /onboarding/progress`. `changeStatus` in `employees.repository.ts` enforces `joiningDate` and `manager` (or `noManager: true`) before `ACTIVE` and logs `openOnboardingTasksAtActivation` if tasks remain open. Verified end-to-end in `e2e-scratch/people-workflows.spec.ts`.

## W4. Account Invitation
- **PRD:** Click Invite, choose role (default Employee) -> System emails one-time link (7 days) -> Employee sets password; account Active & linked -> HR notified.
- **Status:** **COMPLETE**
- **Verification:** Both `POST /employees/:id/invite` (with `InvitePanel` role selector) and `POST /settings/users/invite` (with employee dropdown) delegate to `invitations.ts`, which sends an email via `Mailer`, enforces SA-only for `HR_ADMIN`/`SUPER_ADMIN`, voids old tokens on resend, and fails closed if mail is unconfigured in production. `POST /auth/accept-invitation` activates the account, writes `EmployeeAuditLog` (`INVITATION_ACTIVATED`), and notifies HR (`INVITATION_ACCEPTED`).

## W5. Daily Attendance
- **PRD:** Dashboard shows Check in -> click stores server time, creates today's record -> Check out stores server time, computes hours. Weekend/holiday check-in allowed; blocked on full-day approved leave; duplicate check-in 409.
- **Status:** **COMPLETE**
- **Verification:** `attendance.routes.ts` allows weekend/holiday check-in, blocks check-in on `APPROVED` `FULL_DAY` leave (`ON_APPROVED_LEAVE`), returns 409 on duplicate check-in, and validates `now > checkInAt` on check-out with conditional `updateMany`. Verified in `attendance.integration.test.ts` and `e2e-scratch/attendance.spec.ts`.

## W6. Leave Application & Approval
- **PRD:** Choose type, dates, full/half day, reason -> System counts working days (excluding weekends & holidays), checks overlap & balance (max 7 days past), creates Pending, reserves days -> Approver notified, approves/rejects with comment -> Approved deducts, Rejected releases, Employee notified.
- **Status:** **COMPLETE**
- **Verification:** `leave.routes.ts` + `leave.rules.ts` exclude `company.workingDays` and `Holiday`s, reject `days === 0`, enforce `MAX_RETROACTIVE_DAYS = 7`, enforce overlap trigger + `pg_advisory_xact_lock`, route to reporting manager (direct + indirect team scope) or HR, enforce no self-approval, allow HR post-start cancellation, write `AuditLog`, and emit `LEAVE_REQUESTED`, `LEAVE_APPROVED`, `LEAVE_REJECTED`, `LEAVE_CANCELLED` notifications.

## W7. Attendance Correction
- **PRD:** Employee requests correction within 7 days (not future, not on approved leave) -> one pending per date -> Approver (manager, else HR) notified, decides with comment -> Approval updates/creates record, keeps originals in audit log -> Employee notified. HR may correct any date with reason.
- **Status:** **COMPLETE**
- **Verification:** 7-day window, 1 pending per date, `CORRECTION_ON_LEAVE_DATE` guard (`attendance.routes.ts:370`), team scope (direct + indirect), no self-approval, original values in `AuditLog`, and notifications (`CORRECTION_REQUESTED`, `CORRECTION_APPROVED`, `CORRECTION_REJECTED`, `ATTENDANCE_CORRECTED`) all work.

## W8. Document Upload & Access
- **PRD:** Choose employee, category, file (PDF/PNG/JPG/DOCX, <= 10 MB) -> API checks permission, type, size; stores in private bucket (`company_id/employee_id/uuid`) -> Preview/Download returns 60-second signed URL after permission check -> Upload & delete logged.
- **Status:** **COMPLETE (Code) / Ops: Schedule Purge Cron**
- **Verification:** Upload validation, 60s signed URLs, `AuditLog`, soft delete + 30-day `purgeAfterAt`, `resolveTeamEmployeeIds()` in `canReadEmployeeDoc`, and `GET /documents` Manager team listing (`documents.routes.ts:64`) all work. Operational prerequisite: schedule `dist/purge-documents.js --execute` via Render Cron in production.

## W9. Profile Update
- **PRD:** HR/SA edits any field; Employee edits phone, address, emergency contact -> Server validates, stores, logs old/new values -> Timeline shows significant changes. Only SA changes employee ID & joining date; concurrent edit caught by `updated_at`.
- **Status:** **COMPLETE**
- **Verification:** `employees.repository.ts` enforces `expectedUpdatedAt` (`STALE_RECORD` 409) and SA-only `employeeNumber`/`joiningDate` edits. `selfUpdate` logs actual old/new field diffs. UI renders `MyContactForm` on `/profile` and `TimelineSection` on `/employees/[id]`.

## W10. Offboarding
- **PRD:** Optionally set On Notice -> Set Inactive with exit date & reason -> System disables login, cancels pending leave & corrections, cancels approved future leave -> HR reassigns direct reports -> Records stay read-only, hidden from pickers/counts.
- **Status:** **COMPLETE**
- **Verification:** `employees.repository.ts` `offboard()` sets `User.status = 'DISABLED'` & `CompanyMembership.status = 'SUSPENDED'`, revokes sessions, cancels pending/future leave (restoring balances), cancels pending attendance corrections, flags direct reports and notifies HR (`REPORTS_NEED_MANAGER`), and protects the last Super Admin. `INACTIVE` employees are excluded from dashboard counts and directory pickers.
