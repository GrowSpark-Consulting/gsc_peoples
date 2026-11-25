# PRD Traceability Matrix

**Audit Date:** 2026-11-25 (Re-audited after P0 remediation changes)  
**Source PRD:** HR & People CRM — Product Requirements Document (Nov 18, 2026)  
**Statuses:** `COMPLETE` | `PARTIAL` | `MISSING` | `BROKEN` | `UNVERIFIED` | `DEVIATION`

---

## Authentication (AUTH-001 – AUTH-006)

| ID | Priority | Requirement | Status | Implementation Evidence | Test Evidence | Gaps & Recommended Action |
|---|---|---|---|---|---|---|
| **AUTH-001** | P0 | Email/password login & logout via Supabase Auth | **DEVIATION** | `auth.routes.ts`, `session-provider.ts`, `login/page.tsx`, `docs/architecture/auth-deviation.md` | `session-login.integration.test.ts` | Deliberate owner-approved deviation: custom PostgreSQL session + scrypt auth instead of Supabase Auth. Login/logout works. |
| **AUTH-002** | P0 | Forgot/reset password (60m, single-use, 10+ chars, same msg) | **COMPLETE** | `auth.routes.ts`, `integrations/mail/`, `forgot-password/page.tsx`, `reset-password/page.tsx` | `mail.test.ts`, `session-login.integration.test.ts` | Sends reset link via SMTP `Mailer`; 60m single-use token; `minLength={10}` in UI & API; generic response for unknown emails. |
| **AUTH-003** | P0 | Secure sessions: httpOnly cookies, 8h idle timeout, 401 redirect | **COMPLETE** | `auth.routes.ts`, `session-provider.ts`, `api-client.ts`, `proxy.ts` | `authenticate.test.ts`, `session-login.integration.test.ts` | Verified `httpOnly`, `sameSite=lax`, `secure` in prod, 8h idle + absolute expiry, 401 redirects to `/login`. |
| **AUTH-004** | P0 | Invite from employee record; 7-day single-use link, resend, link to employee | **COMPLETE** | `invitations.ts`, `employees.routes.ts`, `settings.routes.ts`, `record-sections.tsx`, `accept-invitation/page.tsx` | `settings-authorization.integration.test.ts`, `e2e-scratch/people-workflows.spec.ts` | Emails 7-day single-use link via `Mailer`; role selector in `InvitePanel`; resend voids prior tokens; notifies HR on activation. |
| **AUTH-005** | P0 | Assign role: one per user, last SA protected, audit-logged | **COMPLETE** | `settings.routes.ts`, `authorization.ts` | `settings-authorization.integration.test.ts` | SA-only, advisory-locked last SA protection, revokes sessions, writes `AuditLog`. |
| **AUTH-006** | P0 | Activate/deactivate login; HR cannot touch SA; data kept | **COMPLETE** | `settings.routes.ts`, `authorization.ts`, `settings/page.tsx` | `settings-authorization.integration.test.ts` | HR limited to MGR/EMP; last SA protected; revokes sessions; writes `AuditLog`; `/settings` UI accessible to HR. |

## Company & Organization (ORG-001 – ORG-005)

| ID | Priority | Requirement | Status | Implementation Evidence | Test Evidence | Gaps & Recommended Action |
|---|---|---|---|---|---|---|
| **ORG-001** | P0 | Company profile & settings (name, logo, timezone, working days/hours) | **COMPLETE** | `settings.routes.ts`, `settings/page.tsx`, `bootstrap.ts` | `settings-authorization.integration.test.ts`, `bootstrap.integration.test.ts` | SA edits, HR views; IANA timezone & working-day validation; CLI production bootstrap (`bootstrap-production.ts`). |
| **ORG-002** | P0 | Department & designation CRUD; unique (case-insensitive); archive when in use | **COMPLETE** | `organization.routes.ts`, `organization-page.tsx`, `20261125090000` | `organization-page.test.tsx`, `foundation.integration.test.ts` | Case-insensitive unique indexes on both departments and designations; archive/restore; delete blocked when in use. |
| **ORG-003** | P0 | Reporting hierarchy; one optional manager; no self/cycles; active only | **COMPLETE** | `employees.repository.ts`, `20261119151000` trigger | `employees.api.test.ts`, `manager-cycles.integration.test.ts` | App check + DB `CHECK` + DB recursive CTE trigger with advisory lock. |
| **ORG-004** | P0 | Holiday calendar; one per date; excluded from leave counts & absence | **COMPLETE** | `holidays.routes.ts`, `organization.routes.ts`, `leave.rules.ts`, `dashboard.routes.ts` | `foundation.integration.test.ts`, `leave.rules.test.ts` | Holiday CRUD, leave day exclusion, and dashboard/attendance absence exclusion all aligned. |
| **ORG-005** | P1 | Org structure as indented reporting list | **COMPLETE** | `organization.routes.ts`, `organization-page.tsx` (`StructureTab`) | `organization-page.test.tsx` | Implemented and wired to UI. |

## Employee CRM (EMP-001 – EMP-009)

| ID | Priority | Requirement | Status | Implementation Evidence | Test Evidence | Gaps & Recommended Action |
|---|---|---|---|---|---|---|
| **EMP-001** | P0 | Create employee; field errors; unique work email per company | **COMPLETE** | `employees.repository.ts`, `employee-form.tsx` | `employees.api.test.ts`, `e2e-scratch/people-workflows.spec.ts` | Auto-generated ID, required department, designation selector, joining date, contact fields, field-level errors. |
| **EMP-002** | P0 | Sequential `EMP-0001` per company; unique, immutable, concurrency-safe | **COMPLETE** | `employees.repository.ts`, `EmployeeNumberSequence` | `employees.integration.test.ts` | Atomic `ON CONFLICT DO UPDATE` in transaction; only SA can modify after creation (W9). |
| **EMP-003** | P0 | Directory with search, filters, manager scope; all users limited fields | **COMPLETE** | `employees.repository.ts` (`list`, `directory`), `employees.service.ts`, `record-sections.tsx` | `employees.api.test.ts`, `employees.integration.test.ts` | Manager sees team; `GET /employees/directory` gives all active users limited fields (name, title, dept, work email). |
| **EMP-004** | P0 | Profile visibility by role (HR all, EMP own, MGR team work+contact, no address/emergency) | **COMPLETE** | `employees.service.ts` (`forViewer`, `maySeePrivate`), `employee-profile.tsx` | `employees.api.test.ts`, `employee-profile.test.tsx` | `forViewer()` strips `address` & `emergencyContact` for Managers; UI renders role-permitted fields. |
| **EMP-005** | P0 | Edit employee; dept/designation/manager/status/type changes add timeline entry | **COMPLETE** | `employees.repository.ts`, `employee-form.tsx` | `employees.api.test.ts` | `expectedUpdatedAt` optimistic lock (`STALE_RECORD` 409), SA-only `employeeNumber`/`joiningDate`, `EmployeeAuditLog` diffs. |
| **EMP-006** | P0 | Status: Onboarding, Active, On Notice, Inactive; Inactive excluded from counts/pickers | **COMPLETE** | `schema.prisma`, `dashboard.routes.ts`, `employees.repository.ts` | `employees.api.test.ts`, `prd-acceptance.integration.test.ts` | Inactive excluded from dashboard counts and directory pickers. |
| **EMP-007** | P0 | Deactivate; never hard-delete; exit date required; login disabled; direct reports flagged | **COMPLETE** | `employees.repository.ts` (`changeStatus`, `offboard`), `status-change-panel.tsx` | `employees.api.test.ts`, `prd-acceptance.integration.test.ts` | Disables `User` & `CompanyMembership`, revokes sessions, cancels leave/corrections, flags direct reports & notifies HR. |
| **EMP-008** | P0 | Activity timeline (newest first, read-only, actor & time) | **COMPLETE** | `employees.repository.ts` (`timeline`), `record-sections.tsx` (`TimelineSection`) | `employees.api.test.ts` | Newest-first read-only timeline rendered on employee profile. |
| **EMP-009** | P0 | Self-edit phone, address, emergency contact; other fields read-only; edits logged | **COMPLETE** | `employees.routes.ts`, `employees.repository.ts` (`selfUpdate`), `record-sections.tsx` (`MyContactForm`) | `employees.api.test.ts` | `/profile` renders `MyContactForm`; `selfUpdate` logs old/new field diffs in `EmployeeAuditLog`. |

## Onboarding (ONB-001 – ONB-005)

| ID | Priority | Requirement | Status | Implementation Evidence | Test Evidence | Gaps & Recommended Action |
|---|---|---|---|---|---|---|
| **ONB-001** | P0 | Default checklist copied from company template; later edits don't affect existing | **COMPLETE** | `employees.repository.ts`, `onboarding.routes.ts` | `onboarding-page.test.tsx` | Copied on employee creation into `onboarding_tasks`. |
| **ONB-002** | P0 | Edit tasks: title, due date, assignee (HR or employee) | **COMPLETE** | `onboarding.routes.ts`, `onboarding-page.tsx` | `onboarding-page.test.tsx` | Add/edit tasks works in API & UI with audit logging. |
| **ONB-003** | P0 | Mark tasks done; progress completed/total; who and when recorded | **COMPLETE** | `onboarding.routes.ts`, `onboarding-page.tsx` | `onboarding-page.test.tsx`, `e2e-scratch/people-workflows.spec.ts` | Enforces `can('onboarding.completeTask')`, blocks Managers, records actor/time, notifies HR on completion. |
| **ONB-004** | P0 | Status Not Started, In Progress, Completed, derived from tasks; filterable list | **COMPLETE** | `onboarding.routes.ts` (`GET /progress`), `onboarding-page.tsx` | `onboarding-page.test.tsx` | Dedicated `/onboarding/progress` endpoint with search & status filter. |
| **ONB-005** | P0 | Invite from onboarding screen; invite state Not Invited, Invited, Activated | **COMPLETE** | `onboarding.routes.ts`, `onboarding-page.tsx`, `invitations.ts` | `onboarding-page.test.tsx`, `e2e-scratch/people-workflows.spec.ts` | Emails 7-day link via `Mailer`; invite state tracked and updated. |

## Attendance (ATT-001 – ATT-008)

| ID | Priority | Requirement | Status | Implementation Evidence | Test Evidence | Gaps & Recommended Action |
|---|---|---|---|---|---|---|
| **ATT-001** | P0 | Check-in/out with server timestamps; company timezone; weekend/holiday allowed, leave blocked | **COMPLETE** | `attendance.routes.ts`, `attendance.rules.ts`, `attendance-page.tsx` | `attendance.integration.test.ts`, `e2e-scratch/attendance.spec.ts` | Weekend/holiday check-in allowed; full-day approved leave blocked; conditional check-out. |
| **ATT-002** | P0 | Duplicate check-in prevention via unique (employee, date) -> 409 | **COMPLETE** | `attendance.routes.ts`, `20261121130000` unique index | `attendance.integration.test.ts` | Returns 409, no duplicate row created. |
| **ATT-003** | P0 | Daily history & monthly summary (present, absent, on leave, holidays, hours); totals = rows | **COMPLETE** | `attendance.routes.ts`, `month.ts`, `attendance-page.tsx` | `attendance.integration.test.ts`, `attendance-page.test.tsx` | `GET /attendance/history` computes summary directly from daily rows via `summarize()`. |
| **ATT-004** | P0 | HR dashboard for any date: present, absent, on leave, not yet in; counts = list | **COMPLETE** | `attendance.routes.ts`, `attendance.rules.ts`, `attendance-page.tsx` | `attendance.integration.test.ts`, `attendance-hr.test.tsx` | Working-day, holiday, leave, `workEndTime`, and pagination/summary counts verified. |
| **ATT-005** | P0 | Correction request: date, proposed in/out, reason; within 7 days; 1 pending/date | **PARTIAL** | `attendance.routes.ts`, `20261121130000` partial unique index | `attendance.integration.test.ts` | 7-day window, 1 pending/date, and `CORRECTION_REQUESTED` notification work. **Minor gap:** Does not explicitly block dates with approved full-day leave (PRD W7). |
| **ATT-006** | P0 | Approve/reject correction with comment; originals in audit log; rejection needs comment | **COMPLETE** | `attendance.routes.ts` | `attendance.integration.test.ts` | Team scope (direct + indirect), self-approval block, originals in `AuditLog`, `CORRECTION_APPROVED`/`REJECTED` notifications. |
| **ATT-007** | P0 | Manual correction without request; reason mandatory; audit-logged; employee notified | **COMPLETE** | `attendance.routes.ts`, `attendance-page.tsx` | `attendance.integration.test.ts`, `attendance-hr.test.tsx` | Mandatory reason, self-correction block, `AuditLog`, and `ATTENDANCE_CORRECTED` notification. |
| **ATT-008** | P1 | Attendance reports and CSV export | **COMPLETE** | `attendance.routes.ts`, `month.ts`, `csv.ts`, `reports-page.tsx` | `csv.test.ts`, `reports-page.test.tsx` | Monthly report table + CSV export implemented and tested. |

## Leave (LEAVE-001 – LEAVE-009)

| ID | Priority | Requirement | Status | Implementation Evidence | Test Evidence | Gaps & Recommended Action |
|---|---|---|---|---|---|---|
| **LEAVE-001** | P0 | Leave types: name, annual days, paid, half-day; seeded Casual, Sick, Earned; unique; archive | **COMPLETE** | `leave.routes.ts`, `bootstrap.ts`, `leave-page.tsx` | `leave-page.test.tsx`, `bootstrap.integration.test.ts` | CRUD, archiving, and Casual/Sick/Earned seeding in `bootstrap.ts`. |
| **LEAVE-002** | P0 | Balance per employee, type, year; HR adjusts with reason; audit-logged | **COMPLETE** | `leave.routes.ts`, `leave-page.tsx` | `leave-page.test.tsx`, `leave-authorization.integration.test.ts` | `readableIds()` uses `resolveTeamEmployeeIds()`; advisory-locked adjustment + `AuditLog`. |
| **LEAVE-003** | P0 | Apply: type, dates, full/half day, reason; exclude weekends & holidays | **COMPLETE** | `leave.routes.ts`, `leave.rules.ts`, `leave-page.tsx` | `leave.rules.test.ts`, `prd-acceptance.integration.test.ts` | `countLeaveDays()` excludes `company.workingDays` and `Holiday`s; half-day = 0.5. |
| **LEAVE-004** | P0 | Validation: no overlap, enough balance (pending reserved), start <= 7 days in past | **COMPLETE** | `leave.routes.ts`, `leave.rules.ts`, `20261121130000` overlap trigger | `leave.rules.test.ts`, `prd-acceptance.integration.test.ts` | Enforces overlap trigger, balance check, 0-working-day rejection, and 7-day retroactive limit. |
| **LEAVE-005** | P0 | Routing: manager, else HR; HR/SA can approve any; no self-approval | **COMPLETE** | `leave.routes.ts` | `leave-authorization.integration.test.ts` | Routes to manager (direct + indirect team scope) or HR; blocks self-approval. |
| **LEAVE-006** | P0 | Approve/reject with comment (mandatory on reject); decided once; balance updated; notified | **COMPLETE** | `leave.routes.ts`, `leave-page.tsx` | `leave-authorization.integration.test.ts`, `leave-page.test.tsx` | Conditional `updateMany`, balance update, `AuditLog`, and `LEAVE_APPROVED`/`REJECTED` notifications. |
| **LEAVE-007** | P0 | Cancel: employee Pending or Approved-not-started; after start only HR; balance restored | **COMPLETE** | `leave.routes.ts`, `leave.rules.ts`, `leave-page.tsx` | `leave-page.test.tsx`, `prd-acceptance.integration.test.ts` | Uses `can('leave.cancel')`; allows HR post-start cancellation; restores balance; notifies & audits. |
| **LEAVE-008** | P0 | History, pending queue, and month calendar (own, team, all); half-days & holidays | **COMPLETE** | `leave.routes.ts` (`GET /calendar`), `leave-calendar.tsx`, `leave-page.tsx` | `leave-page.test.tsx` | History, pending queue, and month calendar with half-day markers and holiday names. |
| **LEAVE-009** | P1 | Advanced policies: accrual, carry-forward, tenure | **MISSING** | — | — | Explicitly P1; not implemented. |

## Documents (DOC-001 – DOC-005)

| ID | Priority | Requirement | Status | Implementation Evidence | Test Evidence | Gaps & Recommended Action |
|---|---|---|---|---|---|---|
| **DOC-001** | P0 | Upload with category; PDF, PNG, JPG, DOCX, max 10 MB | **COMPLETE** | `documents.routes.ts`, `documents.rules.ts`, `documents-page.tsx` | `documents.rules.test.ts`, `documents.integration.test.ts` | Magic-byte + MIME + 10 MB cap enforced server-side & client-side. |
| **DOC-002** | P0 | Company documents (policies) readable by all active users | **COMPLETE** | `documents.routes.ts`, `documents-page.tsx` | `documents.integration.test.ts` | Readable by all roles; upload restricted to HR/SA. |
| **DOC-003** | P0 | Private bucket, `company_id/employee_id/` UUID path, 60s signed URL after authz; 403 | **COMPLETE** | `documents.routes.ts`, `supabase-storage.ts` | `documents.integration.test.ts`, `storage.test.ts` | 60s signed URLs, 403 on unauthorized, `storedPath` hidden. |
| **DOC-004** | P0 | Access: HR, SA, owner; managers only if "Visible to manager" (default off) | **PARTIAL** | `documents.routes.ts` | `documents.integration.test.ts` | `canReadEmployeeDoc` uses `resolveTeamEmployeeIds()`. **Minor gap:** `GET /documents` without `?employeeId=` omits flagged team docs for Managers. |
| **DOC-005** | P0 | Soft delete; file kept 30 days; audit-logged | **PARTIAL** | `documents.routes.ts`, `retention.ts`, `jobs/purge-documents.ts` | `retention.integration.test.ts`, `purge-args.test.ts` | Soft delete, 30-day `purgeAfterAt`, `AuditLog`, and compiled purge job exist. **Ops gap:** Needs Render Cron / scheduler configured on deployment. |

## Dashboards (DASH-001 – DASH-003)

| ID | Priority | Requirement | Status | Implementation Evidence | Test Evidence | Gaps & Recommended Action |
|---|---|---|---|---|---|---|
| **DASH-001** | P0 | SA/HR dashboard cards & lists (joiners 30d, last 10 activities); absent/not-yet-in logic | **COMPLETE** | `dashboard.routes.ts`, `dashboard-page.tsx` | `dashboard-page.test.tsx`, `prd-acceptance.integration.test.ts` | Uses `deriveOverviewStatus`, excludes `INACTIVE`/`ONBOARDING` from absent, returns `joiners` list + `recentActivities`. |
| **DASH-002** | P0 | Manager dashboard: team members, attendance, pending approvals, leave calendar (direct + indirect) | **COMPLETE** | `dashboard.routes.ts`, `dashboard-page.tsx` | `dashboard-page.test.tsx`, `prd-acceptance.integration.test.ts` | Uses `resolveTeamEmployeeIds()` (direct + indirect) and `todayCounts()`. |
| **DASH-003** | P0 | Employee dashboard: profile, check-in/out button (true state), balances, requests, notifications | **COMPLETE** | `dashboard.routes.ts`, `dashboard-page.tsx` | `dashboard-page.test.tsx` | True server state, balances, requests, notifications all wired. |

## Notifications & Settings (NOTIF-001 – NOTIF-003, SET-001 – SET-004)

| ID | Priority | Requirement | Status | Implementation Evidence | Test Evidence | Gaps & Recommended Action |
|---|---|---|---|---|---|---|
| **NOTIF-001** | P0 | In-app list, unread badge, mark one/all read; own notifications only | **COMPLETE** | `notifications.routes.ts`, `notifications-menu.tsx` | `notifications-menu.test.tsx` | Scoped to `req.user.userId` + `companyId`; mark one/all read works. |
| **NOTIF-002** | P0 | Events: leave req/app/rej/cancel; correction req/decided; onboarding task assigned/completed | **COMPLETE** | `notify.ts`, `leave.routes.ts`, `attendance.routes.ts`, `onboarding.routes.ts` | `prd-acceptance.integration.test.ts`, `e2e-scratch/people-workflows.spec.ts` | Deduplicated notifications created in-transaction with links for all required events. |
| **NOTIF-003** | P1 | Email notifications and preferences; MVP sends only invite & reset emails | **MISSING** | — | — | P1 preferences not implemented (MVP invite/reset emails are implemented). |
| **SET-001** | P0 | Settings screens: company, hours & days, leave types, holidays | **COMPLETE** | `settings/page.tsx`, `leave-page.tsx`, `organization-page.tsx` | `settings-authorization.integration.test.ts` | Company settings accessible to SA (edit) and HR (view); leave types & holidays in their modules. |
| **SET-002** | P0 | User accounts list: role, status, last login, resend invite, deactivate; HR cannot change roles | **COMPLETE** | `settings.routes.ts`, `settings/page.tsx` | `settings-authorization.integration.test.ts` | HR can manage MGR/EMP accounts without 403 blocking the page; employee picker for invites. |
| **SET-003** | P0 | Four fixed roles; permissions defined in code; no custom roles | **COMPLETE** | `permissions.ts`, `identity.ts` | `permissions.test.ts`, `authorization.test.ts` | `ROLE_PERMISSIONS` in code is the sole runtime source of truth. |
| **SET-004** | P0 | Audit log viewer, filter by user, entity, date; read-only | **COMPLETE** | `settings.routes.ts`, `audit-log-section.tsx` | `settings-authorization.integration.test.ts` | Backend filters (`actorId`, `entity`, `from`, `to`) + pagination; read-only SA UI in `/settings`. |
