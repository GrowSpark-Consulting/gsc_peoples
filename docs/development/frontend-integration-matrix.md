# Frontend integration matrix (Phase 1 audit)

Date: 2026-11-24. Method: read of every web route, the web API client pattern, all `packages/contracts` schemas and all
API route files. Nothing was run against the hosted database. "Contract" means a Zod schema in `packages/contracts`.
No route below is invented: every endpoint listed exists in the API source; gaps are listed separately.

## 1. Frontend state today

| Route | State | Notes |
|---|---|---|
| `/login`, `/forgot-password`, `/reset-password`, `/accept-invitation` | implemented | not changed |
| `/employees`, `/employees/new`, `/employees/[id]`, `/employees/[id]/edit`, `/profile` | implemented | real HTTP adapter plus a dev-only demo adapter (opt-in `NEXT_PUBLIC_EMPLOYEES_ADAPTER=demo`, excluded from production) |
| `/settings` | implemented (185 lines) | company, users, audit; to be checked against SET-001..004 |
| `/dashboard`, `/attendance`, `/leave`, `/departments`, `/documents`, `/onboarding`, `/reports` | **PagePlaceholder** | to implement |
| Top-bar notifications | `PlaceholderMenu` "not connected yet" | to implement (NOTIF-001) |
| `/showcase` | dev-only UI reference, 404 in production | keep |

Mock data in production paths: none found. Demo data lives only in `modules/employees/adapters/demo` and
`state/demo-providers.tsx`, gated to non-production. `PagePlaceholder` and `PlaceholderMenu` are the stand-ins to remove.

Shared building blocks to reuse (no new design system): `components/ui/*` (alert, badge, button, dialog, drawer,
empty-state, field, pagination, select, skeleton, stat-card, table), `components/shared/*` (data-states, list-toolbar,
form-layout, filter-multi-select), `components/layout/page-header`, hooks `use-async-data`, `use-debounced-value`,
the `ApiError` class and CSRF cookie convention from `modules/employees/adapters/http-service.ts`, and `fetchSession`
(`GET /me`, returns role and permissions).

## 2. Requirement to endpoint map

Prefix `/api/v1`. Roles: SA, HR, MGR, EMP. "Perm" is the permission the route enforces.

| PRD | Page / component | Endpoint (existing) | Contract | Perm / scope | Status |
|---|---|---|---|---|---|
| DASH-001 | `/dashboard` (SA, HR) | GET `/dashboard/hr` | `hrDashboardResponseSchema` | DASHBOARD_READ_ALL | Build. Backend gaps G1, G2 |
| DASH-002 | `/dashboard` (MGR) | GET `/dashboard/manager` | `managerDashboardResponseSchema` | DASHBOARD_READ_TEAM | Build. Gap G3 (direct reports only) |
| DASH-003 | `/dashboard` (EMP) | GET `/dashboard/employee`, POST `/attendance/check-in`, `/check-out` | `employeeDashboardResponseSchema` | DASHBOARD_READ_SELF, ATTENDANCE_CHECK | Build |
| NOTIF-001 | top bar bell + list | GET `/notifications`, PATCH `/:id/read`, PATCH `/read-all` | `notificationListResponseSchema` | NOTIFICATION_READ_SELF / WRITE_SELF | Build |
| NOTIF-002 | (backend events) | emitted by services | n/a | n/a | Not verified: see G9 |
| ATT-001/002 | `/attendance` today card | GET `/attendance/today`, POST `/check-in`, `/check-out` (409 on duplicate) | `attendanceRecordSchema` | ATTENDANCE_CHECK | Build |
| ATT-003 | `/attendance` history + month summary | GET `/attendance/history?employeeId&month&year&from&to&page` | `attendanceListResponseSchema` (optional `summary`) | READ_SELF / TEAM / ALL | Build. Gap G4 (summary) |
| ATT-004 | `/attendance` HR overview by date | none for all employees | n/a | n/a | **Backend gap G5** |
| ATT-005 | correction request form | POST `/attendance/corrections` | `createAttendanceCorrectionSchema` | ATTENDANCE_CORRECT_REQUEST | Build |
| ATT-006 | corrections queue (approve/reject) | GET `/attendance/corrections`, PATCH `/corrections/:id/review` | `reviewAttendanceCorrectionSchema` (reject needs comment) | ATTENDANCE_CORRECT_APPROVE | Build |
| ATT-007 | HR manual correction | none (contract `manualAttendanceCorrectionSchema` exists, no route) | n/a | n/a | **Backend gap G6** |
| ATT-008 (P1) | `/reports` | none | n/a | n/a | **Backend gap G7**, deferred |
| LEAVE-001 | `/leave` types (SA, HR) | GET/POST `/leave/types`, PATCH `/leave/types/:id` | `leaveTypeSchema` | LEAVE_TYPE_READ / WRITE | Build |
| LEAVE-002 | balances, HR adjust | GET `/leave/balances`, POST `/leave/balances/adjust` | `leaveBalanceSchema`, `adjustLeaveBalanceSchema` | LEAVE_READ_*, LEAVE_BALANCE_ADJUST | Build |
| LEAVE-003/004 | apply form | POST `/leave/requests` | `createLeaveRequestSchema` (half-day rules) | LEAVE_APPLY | Build; server decides validity |
| LEAVE-005/006 | pending queue, approve/reject | GET `/leave/requests?pendingForMe=true`, PATCH `/requests/:id/review` | `leaveRequestDecisionSchema` | LEAVE_APPROVE | Build. Self-approval: UI hides the action for own requests; backend must reject (verify, G8) |
| LEAVE-007 | cancel | PATCH `/leave/requests/:id/cancel` | n/a | LEAVE_CANCEL_OWN / ANY | Build |
| LEAVE-008 | history, month calendar | GET `/leave/requests`; no calendar endpoint | `leaveCalendarResponseSchema` unused | READ_* | History: build. Calendar: **Backend gap G10** (build a month list from `/leave/requests?month&year` instead, no invented route) |
| ORG-002 | `/departments` (departments tab) | GET/POST `/organization/departments`, PATCH `/:id` (incl. `isActive`), DELETE `/:id` | `departmentSchema` | ORGANIZATION_WRITE; read for all | Build |
| ORG-002 | `/departments` (designations tab) | GET/POST `/organization/designations`, PATCH, DELETE | `designationSchema` | same | Build |
| ORG-003/005 | hierarchy list | GET `/organization/hierarchy` | `organizationHierarchyResponseSchema` | read | Build (P1, simple indented list) |
| ORG-004 | holidays | GET/POST `/organization/holidays`, PATCH, DELETE | `orgHolidaySchema` | HOLIDAY_WRITE | Build (holiday tab on `/departments`; check `/settings` first to avoid a duplicate screen) |
| ONB-001/002 | template + per-employee tasks | GET/POST `/onboarding/templates`, PATCH, DELETE; GET/POST `/onboarding/employees/:employeeId/tasks`, PATCH `/tasks/:id` | onboarding contracts | ONBOARDING_WRITE | Build |
| ONB-003 | complete task | PATCH `/onboarding/tasks/:id/complete` | `onboardingTaskResponseSchema` | ONBOARDING_TASK_COMPLETE | Build |
| ONB-004 | filterable list of all employees' onboarding status | none (per-employee only) | `onboardingProgressSchema` | n/a | **Backend gap G11**; interim: employees with status ONBOARDING from `/employees`, progress per row (N+1, flagged) |
| ONB-005 | invite from onboarding | POST `/employees/:id/invite` | n/a | EMPLOYEE_INVITE | Build; invite state not returned (G12) |
| DOC-001/002 | `/documents` upload | POST `/documents/employee`, `/documents/company` (JSON with base64) | upload schemas | DOCUMENT_UPLOAD / COMPANY_MANAGE | Build. **Blocker B1, B2** |
| DOC-003 | preview / download | GET `/documents/:id/download` streams the bytes | `documentDownloadResponseSchema` (url) **does not match** | read perms | **Blocker B1** |
| DOC-004 | manager visibility flag | PATCH `/documents/:id/visibility` | `updateDocumentVisibilitySchema` | DOCUMENT_VISIBILITY_MANAGE | Build |
| DOC-005 | soft delete | DELETE `/documents/:id` | n/a | DOCUMENT_DELETE | Build |
| SET-001..004 | `/settings` | `/settings/company`, `/users`, `/audit-logs` | n/a | SA / HR | Review existing page; extend only for gaps |

## 3. Backend gaps and blockers (not implemented by this frontend work)

| # | Gap | Impact | Needed change |
|---|---|---|---|
| B1 | **Document storage is the API server's local disk** (`storage/documents`), not a private Supabase Storage bucket; download streams bytes instead of a 60-second signed URL | Files do not survive redeploys on a hosted host; contract (`url`, `expiresInSeconds`) differs from the route; DOC-003 not met | Storage adapter (Supabase Storage, private bucket, `company_id/employee_id/uuid` path) and signed-URL route. Needs your approval and credentials |
| B2 | `express.json({ limit: '1mb' })` while uploads are base64 JSON up to 10 MB (about 13.4 MB encoded) | Files above roughly 750 KB are rejected with 413 | Multipart upload or a larger limit on the document routes only |
| G1 | `GET /dashboard/hr` computes "absent" as active minus present minus on leave, ignoring working day, holiday and work-end time, and uses a UTC date, not the company timezone | Wrong for weekends, holidays and before work end (PRD DASH-001) | Compute per PRD; return `notYetIn` separately |
| G2 | Dashboard queries use `.catch(() => 0)` | A database error shows as zeros, never as an error | Remove silent catches |
| G3 | `GET /dashboard/manager` uses direct reports only | PRD says direct and indirect | Use the team-scope resolver already used elsewhere |
| G4 | `/attendance/history` returns a page of rows, no monthly summary | ATT-003 totals must equal rows | Return `summary` (contract field exists) |
| G5 | No HR attendance overview for a date | ATT-004 | New route, e.g. list by date with status per employee |
| G6 | No manual correction route | ATT-007 | Implement using `manualAttendanceCorrectionSchema` |
| G7 | No report or CSV endpoints | ATT-008 (P1) | Deferred |
| G8 | Self-approval protection in `leave` review not checked here | PRD LEAVE-005 | Verify in code and add a test before relying on it |
| G9 | Notification events not verified for every PRD event | NOTIF-002 | Verify |
| G10 | No leave calendar endpoint (contract exists) | LEAVE-008 | Add route; interim month list from `/leave/requests` |
| G11 | No onboarding list across employees | ONB-004 | Add route |
| G12 | Invite state (Not Invited / Invited / Activated) not exposed | ONB-005 | Add field |

## 4. Implementation groups

1. Shared client (`lib/api-client.ts`, `useSession`), Dashboard (three roles), Notifications bell, Attendance.
2. Leave, Departments and Designations, Holidays and hierarchy.
3. Onboarding, Documents (UI only; storage is blocker B1), Reports (explicit empty state: no endpoint, nothing fabricated).

## 5. Additional backend findings during implementation (2026-11-24)

| # | Finding | Status |
|---|---|---|
| G8 | `PATCH /leave/requests/:id/review` allowed HR Admin and Super Admin to approve their own request | **Fixed** in `leave.routes.ts` (403 for any self-decision); covered by `leave-authorization.integration.test.ts` |
| G13 | `GET /leave/requests` returned the whole company's requests to a Manager when no `team`/`pendingForMe` flag was sent | **Fixed**: team-only readers are restricted to their own and direct reports' requests; covered by the same test |
| G14 | `POST /attendance/corrections` does not enforce the 7-day window (ATT-005); the UI limits the date picker only | Open |
| G15 | Duplicate check-in returns a validation error, not HTTP 409 (ATT-002) | Open |
| G16 | Attendance, dashboard and leave "today" use the UTC date, not the company timezone | Open |
| G17 | `GET /leave/requests` ignores `month` and `year` although the contract accepts them; `mine` is also ignored | Open (UI uses `employeeId` for own history) |
| G18 | Manager scope in leave, dashboard and attendance uses direct reports only (PRD: direct and indirect) | Open |
| G19 | `/settings` (existing page) has company and users only; the audit-log viewer (SET-004) has an API route but no screen | Open |
