# PRD-to-code matrix

Updated 2026-11-25 against the authoritative document **"HR & People CRM — Product Requirements Document", dated
18 November 2026** (it is not stored in this repository; add it so later audits do not depend on a local copy).
Replaces the 2026-11-24 matrix, which was written without that text.

**Status key**
- **Verified**: implemented and exercised by an automated test against real PostgreSQL and/or a real browser.
- **Verified (external pending)**: verified locally; depends on a hosted service that has not been contacted.
- **Partial**: part of the acceptance criteria is missing; the gap is stated.
- **Deferred**: P1/P2 or out of scope.

Test file shorthand: `acc` = `apps/api/src/test/integration/prd-acceptance.integration.test.ts`; `int:<name>` = that
module's `*.integration.test.ts`; `e2e:<name>` = `apps/web/e2e-scratch/<name>.spec.ts`; `web` = component tests.
API prefix `/api/v1`. Pass/fail counts are in the readiness report.

## 1. Authentication and accounts

| ID | Requirement | Page | API | Data | Roles | Tests | Status |
|---|---|---|---|---|---|---|---|
| AUTH-001 | Login, logout, role dashboard, generic error | `/login`, top bar | POST `auth/login`, `auth/logout` | users, user_sessions | all | int:session-login, e2e:auth | Verified. Deviation: custom sessions instead of Supabase Auth (mandated); the form also asks for the role |
| AUTH-002 | Reset: 60 min, single use, ≥10 chars, same answer | `/forgot-password`, `/reset-password` | POST `auth/forgot-password`, `reset-password` | password_reset_tokens | all | acc, e2e:people-workflows, mail.test | Verified (external pending: real SMTP) |
| AUTH-003 | httpOnly cookies, 8-hour timeout, 401 redirect | `proxy.ts` | session middleware, CSRF | user_sessions | all | int:session-login, authenticate.test, e2e:auth | Partial: expiry is **8 h from sign-in** (stricter than the stated idle timeout). Decision D1 |
| AUTH-004 | Invite from employee record, 7 days, single use, resend, link account | `/employees/[id]`, `/onboarding`, `/settings` | POST `employees/:id/invite`, `settings/users/invite`, `…/invitations/resend`, `auth/accept-invitation` | invitation_tokens, memberships | SA, HR | acc, int:settings, e2e:people-workflows | Verified (external pending: real SMTP) |
| AUTH-005 | One role; last SA protected; audited | `/settings` | PATCH `settings/users/:id/role` | memberships | SA | int:settings | Verified |
| AUTH-006 | Activate/deactivate; effective next request; HR cannot touch SA | `/settings` | PATCH `settings/users/:id/status` | users, memberships | SA, HR | int:settings, int:session-login, acc | Verified |

## 2. Company and organisation

| ID | Requirement | Page | API | Data | Tests | Status |
|---|---|---|---|---|---|---|
| ORG-001 | Name, logo, timezone, working days, hours | `/settings` | GET/PATCH `settings/company` | companies | int:settings, acc | Partial: logo is a web address only; no upload, and the logo is not displayed |
| ORG-002 | Departments, designations; unique ignoring case; archive when in use | `/departments` | `organization/departments`, `designations` | departments, designations | acc, web, e2e:people-workflows | Verified |
| ORG-003 | One manager; no self/cycles; active only | employee form | employee create/update; trigger | employees.managerId | int:manager-cycles, int:employees | Verified |
| ORG-004 | Holidays: one per date; excluded from leave and absence | `/departments` (Holidays) | `organization/holidays`, `holidays` | holidays | acc, int:foundation | Verified |
| ORG-005 (P1) | Indented reporting list | `/departments` (Reporting structure) | GET `organization/hierarchy` | employees | web | Implemented (P1) |

## 3. Employees

| ID | Requirement | Page | API | Tests | Status |
|---|---|---|---|---|---|
| EMP-001 | Required fields incl. designation; field errors; unique email | `/employees/new` | POST `employees` | employees.api.test, int:employees, e2e:people-workflows | Verified |
| EMP-002 | `EMP-0001`, sequential, immutable, concurrency-safe | n/a | sequence table | int:employees, bootstrap test | Partial: a Super Admin may change it (W9 conflicts with "immutable"); decision D6 |
| EMP-003 | Search name/email/ID; filters; team scope; limited fields for all | `/employees` | GET `employees`, `employees/directory` | int:employees, acc, e2e:responsive | Verified. "Under 1 s for 100 employees" not measured |
| EMP-004 | Profile; HR all, own; manager team without address/emergency | `/employees/[id]`, `/profile` | GET `employees/:id` | employees.api.test, e2e:people-workflows | Verified |
| EMP-005 | Edit; timeline old/new | `/employees/[id]/edit` | PATCH `employees/:id` | int:employees | Verified |
| EMP-006 | Statuses; Inactive excluded | profile status panel | PUT `employees/:id/status` | acc, int:employees | Verified (legacy `ON_LEAVE`, `TERMINATED` values still exist) |
| EMP-007 | Deactivate: exit date, login disabled, reports flagged | status panel | same | acc, e2e:people-workflows | Verified |
| EMP-008 | Timeline newest first, actor and time, read-only | profile "Activity" | GET `employees/:id/timeline` | acc, e2e:people-workflows | Verified |
| EMP-009 | Self-edit phone, address, emergency contact; logged | `/profile` | PATCH `employees/me` | employees.api.test, e2e:people-workflows | Verified |
| W9 | SA-only ID/joining date; stale edit caught; pending approvals stay with original approver | edit form, leave | `expectedUpdatedAt` | employees.api.test, acc | Partial: no HR "reassign approver" action (HR and SA can decide any request) |
| W10 | Offboarding cancels pending/future leave and corrections | status panel | same | acc | Verified |

## 4. Onboarding

| ID | Requirement | Page | API | Tests | Status |
|---|---|---|---|---|---|
| ONB-001 | Checklist copied from template | `/onboarding` | templates; copy on create | bootstrap test, e2e:people-workflows | Verified |
| ONB-002 | Edit title, due date, assignee | `/onboarding` | POST/PATCH tasks | acc, web | Verified |
| ONB-003 | HR any, employee own; who and when | `/onboarding` | PATCH `tasks/:id/complete` | acc, e2e:people-workflows | Verified |
| ONB-004 | Derived status, filterable list | `/onboarding` | GET `onboarding/progress` | acc, web | Verified |
| ONB-005 | Invite from onboarding; invite state | `/onboarding` | employee invite | acc, e2e:people-workflows | Verified (external pending: real SMTP) |

## 5. Attendance

| ID | Requirement | Page | API | Tests | Status |
|---|---|---|---|---|---|
| ATT-001 | Server timestamps, company date, check-out rules | `/attendance`, dashboard | `today`, `check-in`, `check-out` | int:attendance, e2e:attendance | Verified |
| ATT-002 | One per day; 409 | | unique index | int:attendance | Verified |
| W5 | Weekend/holiday recorded; blocked on full-day leave; Active only | | | acc, int:attendance | Verified |
| ATT-003 | Daily history and monthly summary equal rows | `/attendance` | GET `history?month&year` | acc | Verified |
| ATT-004 | HR view for any date | `/attendance` | GET `overview` | int:attendance, e2e:attendance | Verified |
| ATT-005 | Request within 7 days; one pending (database) | `/attendance` | POST `corrections` | int:attendance, acc | Verified. Also blocked: approved-leave dates, future or other-day times |
| ATT-006 | Approve/reject with comment; originals audited; once | `/attendance` | PATCH `…/review` | int:attendance, acc, e2e:attendance | Verified |
| ATT-007 | Manual correction; reason; audit; notify | `/attendance` | POST `manual-corrections` | int:attendance, acc, e2e:attendance | Verified |
| ATT-008 (P1) | Reports and CSV | `/reports` | GET `report` | acc, web, e2e:people-workflows | Implemented: monthly per-employee report with the ATT-003 totals. Other report types are unspecified |

## 6. Leave

| ID | Requirement | Page | API | Tests | Status |
|---|---|---|---|---|---|
| LEAVE-001 | Types; unique; archived | `/leave` | `leave/types` | web, bootstrap test | Verified |
| LEAVE-002 | Balances; HR adjust with reason; audited | `/leave` | `balances`, `balances/adjust` | acc | Verified |
| LEAVE-003 | Working days only; half day | `/leave` | POST `requests` | leave.rules.test, acc | Verified |
| LEAVE-004 | Overlap, balance with reserved days, ≤7 days back | | same + trigger | acc, int:p0-migration | Verified. A request may not span two calendar years (decision D4) |
| LEAVE-005 | Routing; no self-approval | | | acc, int:leave-authorization, e2e:leave | Verified |
| LEAVE-006 | Approve/reject once; notify | `/leave` | PATCH `…/review` | acc, e2e:leave | Verified |
| LEAVE-007 | Cancel rules; restore balance | `/leave` | PATCH `…/cancel` | acc, web, e2e:leave | Verified |
| LEAVE-008 | History, queue, month calendar by role | `/leave` | `requests`, `calendar` | acc, e2e:people-workflows | Verified |
| LEAVE-009 (P1) | Accrual, carry-forward, tenure | none | none | none | **Not built**: no business rules specified (D5) |

## 7. Documents

| ID | Requirement | API | Tests | Status |
|---|---|---|---|---|
| DOC-001 | Categories; PDF/PNG/JPG/DOCX; 10 MB | POST `documents/employee` | int:documents, rules tests, e2e:documents | Verified |
| DOC-002 | Company documents readable by all | POST `documents/company` | int:documents | Verified |
| DOC-003 | Private bucket; path; 60 s signed URL; 403 | GET `documents/:id/download` | storage.test, int:documents, e2e:documents | Verified (external pending: real bucket) |
| DOC-004 | HR, SA, owner; managers only if flagged | visibility PATCH | int:documents, acc | Verified |
| DOC-005 | Soft delete; 30 days; audited | DELETE; `dist/purge-documents.js` | int:retention, purge-args.test | Partial: the purge job exists but **is not scheduled** anywhere yet |

## 8. Dashboards, notifications, settings

| ID | Requirement | Page | API | Tests | Status |
|---|---|---|---|---|---|
| DASH-001 | HR cards and lists; absent vs not yet in | `/dashboard` | `dashboard/hr` | acc, web, e2e:auth | Verified |
| DASH-002 | Manager: direct and indirect | `/dashboard` | `dashboard/manager` | acc | Verified |
| DASH-003 | Employee; true button state | `/dashboard` | `dashboard/employee` | acc, web | Verified |
| NOTIF-001 | List, unread badge, mark read, own only | top bar | `notifications` | acc, web, e2e:notifications | Verified |
| NOTIF-002 | All listed events, once per recipient, with link | | `notify()` | acc | Verified |
| NOTIF-003 (P1) | Email notifications/preferences | none | none | none | Deferred (MVP sends invite and reset only) |
| SET-001 | Company, hours/days, leave types, holidays screens | `/settings`, `/leave`, `/departments` | | web, e2e | Verified; leave types and holidays live on their module pages |
| SET-002 | Accounts: role, status, last login, resend, deactivate; HR cannot change roles | `/settings` | `settings/users…` | int:settings, e2e:people-workflows | Verified |
| SET-003 | Four fixed roles in code | | `permissions.ts` | contracts tests | Verified |
| SET-004 | Audit viewer: user, entity, date; read-only; SA | `/settings` "Audit log" | GET `settings/audit-logs` | acc, e2e:people-workflows | Verified |

## 9. Role matrix (PRD section 5), enforced on the server

| Capability | SA | HR | Manager | Employee | Evidence |
|---|---|---|---|---|---|
| Company settings | edit | view | none | none | int:settings, acc |
| Departments, designations, holidays | write | write | view | view | contracts tests, int:foundation |
| Roles / activation | both | activate MGR and EMP only | none | none | int:settings |
| Employee create, edit, deactivate | yes | yes (not SA accounts) | none | none | employees tests, acc |
| Profile | all | all | team, no private fields | own | employees.api.test |
| Onboarding | all | all | none | own tasks | acc |
| Attendance view / decide | all | all | team (direct and indirect) | own | int:attendance |
| Manual correction | yes | yes | none | none | int:attendance |
| Leave types, balances | manage | manage | view team | own | acc |
| Leave decide | any, not own | any, not own | routed team requests | none | acc |
| Employee documents | all | all | flagged team only | own | int:documents, acc |
| Company documents | upload | upload | view | view | int:documents |
| Audit log | yes | none | none | none | acc, int:settings |
| Another company's data | none | none | none | none | int:rls, int:tenant-db, acc, e2e |

## 10. Cross-cutting requirements

| Requirement | Status |
|---|---|
| RLS on `company_id` | Verified on tenant tables; identity tables (`users`, `roles`, `company_memberships`, session and token tables) are protected by the application only, by design |
| One shared `can()` helper | Partial: used for leave cancel, onboarding completion, holidays; other routes use permission checks plus row-level conditions |
| 5 failed logins per 15 minutes | Verified (in memory, single instance) |
| Every state change audit-logged | Verified for business mutations; sign-in, sign-out, check-in/out and notification reads are not logged |
| Consistent errors, request id, no stack traces | Verified |
| No personal data in logs | Partial: query strings and credentials removed; unexpected database errors can still contain values |
| Lists paginate at 25 | Partial: documents (200), correction requests (100), user accounts, templates, holidays are not paginated; name pickers load at most 100 employees |
| Responsive from 360 px | see the readiness report (browser run) |
| WCAG 2.1 AA | Not audited |
| Pages under 2 s, API p95 under 500 ms at 100 employees | Not measured |
| Backups and restore rehearsal | Not done (hosted) |
| Separate staging and production | Not set up |
| Design system (monochrome) | The shipped theme differs; preserved as instructed. Decision D7 |
| W1 "SA signs up, verifies email" | Replaced by an operator-run bootstrap with a one-time activation link (D8) |
