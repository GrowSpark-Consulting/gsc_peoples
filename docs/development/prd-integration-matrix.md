# PRD requirement-by-requirement integration matrix

Updated 2026-11-24. Evidence: source inspection of route files, plus API and web typecheck (both pass).
No unit, integration or Playwright suite was run for this matrix, and no route has been exercised against the
hosted database (it is empty). So "BE route" means "present in code", never "verified".

Status key: **FE-done** = page wired to the API; **FE-todo** = page is a `PagePlaceholder` or missing;
**BE-gap?** = I did not find a matching route and need to confirm before building the UI.
API prefix is `/api/v1`. Web folders `src/modules/{attendance,dashboard,departments,documents,leave,onboarding,settings}`
are empty.

| ID | Pri | BE route(s) | DB | Frontend | Status / remaining |
|---|---|---|---|---|---|
| AUTH-001 | P0 | POST auth/login, auth/logout | users, sessions | `(auth)/login` 86 lines | Page exists; verify against real API, generic error |
| AUTH-002 | P0 | POST auth/forgot-password, reset-password | tokens | forgot, reset pages (18 and 32 lines) | Verify 60 min and single use; email sender (A12) unconfirmed |
| AUTH-003 | P0 | session middleware, CSRF | user_sessions | proxy.ts | Verify 8 h idle timeout, 401 redirect |
| AUTH-004 | P0 | POST employees/:id/invite, settings/users/invite, auth/accept-invitation | tokens | accept-invitation page (31 lines) | Verify 7 days, resend voids old link |
| AUTH-005 | P0 | PATCH settings/users/:id/role | memberships | `/settings` (185 lines) | Verify last-SA guard, audit log |
| AUTH-006 | P0 | PATCH settings/users/:id/status | users | `/settings` | Verify HR cannot touch SA |
| ORG-001 | P0 | GET/PATCH settings/company | companies | `/settings` | Verify timezone and working-day validation |
| ORG-002 | P0 | organization/departments, designations CRUD | departments, designations | `/departments` FE-todo | Build UI (departments and designations) |
| ORG-003 | P0 | organization/hierarchy, employee manager field | employees.managerId | employee form manager picker | Verify cycle and active-only rules |
| ORG-004 | P0 | organization/holidays and legacy `/holidays` | holidays | `/settings`? | Two route sets exist; pick one; UI to confirm |
| ORG-005 | P1 | organization/hierarchy | n/a | none | Deferred (P1) |
| EMP-001 | P0 | POST employees | employees | employees/new | FE exists; confirm HTTP adapter (not demo) in production |
| EMP-002 | P0 | server sequence | employee-number sequence | n/a | Verify concurrency on hosted DB |
| EMP-003 | P0 | GET employees | employees | employees list | FE exists; verify filters, MGR team scope |
| EMP-004 | P0 | GET employees/:id, /me | employees | employees/[id], profile | FE exists; verify field-level visibility per role |
| EMP-005 | P0 | PATCH employees/:id | employee_audit_logs | employees/[id]/edit | FE exists; verify old/new timeline entries |
| EMP-006 | P0 | status change route | employees.status | status-change-panel | FE exists; verify Inactive excluded from counts and pickers |
| EMP-007 | P0 | status change with exit date | employees | status-change-panel | Verify login disabled, reports flagged |
| EMP-008 | P0 | GET employees/:id/timeline | employee_audit_logs | profile timeline | FE exists; verify |
| EMP-009 | P0 | PATCH employees/me | employees | my-profile-page | FE exists; verify read-only fields |
| ONB-001 | P0 | onboarding/templates, copy on create | onboarding_tasks | none | FE-todo; verify copy-not-link |
| ONB-002 | P0 | PATCH onboarding/tasks/:id, POST employees/:id/tasks | onboarding_tasks | `/onboarding` FE-todo | Build UI |
| ONB-003 | P0 | PATCH onboarding/tasks/:id/complete | onboarding_tasks | FE-todo | Build UI; who and when recorded |
| ONB-004 | P0 | derived status | n/a | FE-todo | Confirm list endpoint with derived status and filter (BE-gap?) |
| ONB-005 | P0 | employees/:id/invite | tokens | FE-todo | Confirm invite state (Not Invited / Invited / Activated) is returned (BE-gap?) |
| ATT-001 | P0 | GET attendance/today, POST check-in, check-out | attendance_records | `/attendance` FE-todo | Build UI; server timestamps |
| ATT-002 | P0 | 409 on duplicate | unique (employee, date) | FE-todo | Verify on hosted DB |
| ATT-003 | P0 | GET attendance/history | attendance_records | FE-todo | Confirm monthly summary endpoint (BE-gap?) |
| ATT-004 | P0 | GET dashboard/hr | n/a | `/dashboard` FE-todo | Confirm "for any date" parameter (BE-gap?) |
| ATT-005 | P0 | POST attendance/corrections | attendance_corrections | FE-todo | Build UI |
| ATT-006 | P0 | PATCH attendance/corrections/:id/review | attendance_corrections | FE-todo | Build UI; rejection needs comment |
| ATT-007 | P0 | none found | n/a | none | **BE-gap?** manual HR correction route missing |
| ATT-008 | P1 | none | n/a | `/reports` FE-todo | Deferred (P1) |
| LEAVE-001 | P0 | leave/types GET, POST, PATCH | leave_types | `/settings`? | Verify seed of Casual, Sick, Earned (needs bootstrap) |
| LEAVE-002 | P0 | leave/balances, balances/adjust | leave_balances | FE-todo | Build UI |
| LEAVE-003 | P0 | POST leave/requests | leave_requests | `/leave` FE-todo | Build UI; half-day |
| LEAVE-004 | P0 | validation in service plus overlap trigger | leave_requests | FE-todo | Verify on hosted DB |
| LEAVE-005 | P0 | routing in service | n/a | n/a | Verify self-approval rejected |
| LEAVE-006 | P0 | PATCH leave/requests/:id/review | leave_requests | FE-todo | Build UI |
| LEAVE-007 | P0 | PATCH leave/requests/:id/cancel | leave_requests | FE-todo | Build UI |
| LEAVE-008 | P0 | GET leave/requests | leave_requests | FE-todo | Confirm calendar and team scope (BE-gap?) |
| LEAVE-009 | P1 | none | n/a | none | Deferred (P1) |
| DOC-001 | P0 | POST documents/employee | employee_documents | `/documents` FE-todo | Build UI; Supabase Storage bucket needed |
| DOC-002 | P0 | POST documents/company, GET documents | employee_documents | FE-todo | Build UI |
| DOC-003 | P0 | GET documents/:id/download | n/a | FE-todo | Confirm storage adapter (`integrations/`) and 60 s signed URL |
| DOC-004 | P0 | PATCH documents/:id/visibility | visible_to_manager | FE-todo | Build UI |
| DOC-005 | P0 | DELETE documents/:id | deleted_at | FE-todo | Verify 30-day retention job (BE-gap?) |
| DASH-001 | P0 | GET dashboard/hr | n/a | `/dashboard` FE-todo | Build UI; verify absent / Not yet in |
| DASH-002 | P0 | GET dashboard/manager | n/a | FE-todo | Build UI |
| DASH-003 | P0 | GET dashboard/employee | n/a | FE-todo | Build UI |
| NOTIF-001 | P0 | GET notifications, PATCH :id/read, read-all | notifications | top bar only | Build bell and list UI |
| NOTIF-002 | P0 | emitted by services | notifications | n/a | Verify every PRD event emits one per recipient |
| NOTIF-003 | P1 | none | n/a | none | Deferred (P1) |
| SET-001 | P0 | settings/company, leave types, holidays | companies | `/settings` | Confirm leave types and holidays sections |
| SET-002 | P0 | GET settings/users, resend, status | users, memberships | `/settings` | Verify HR cannot change roles |
| SET-003 | P0 | permissions in code | n/a | n/a | Verified by design; unit tests exist, not run |
| SET-004 | P0 | GET settings/audit-logs | audit_logs | `/settings`? | Confirm filters by user, entity, date |

## Cross-cutting gaps

1. About 8 of 12 PRD UI areas are placeholders (dashboard, attendance, leave, departments and designations,
   documents, onboarding, notifications, reports).
2. Suspected backend gaps to confirm before building UI: ATT-007, ATT-003 monthly summary, ATT-004 by date,
   ONB-004 list with derived status, LEAVE-008 calendar, DOC-005 retention job.
3. Duplicate route sets for holidays (`/holidays` and `organization/holidays`).
4. No production bootstrap (PRD W1) and no Supabase Storage adapter confirmed.
5. Database is not migrated: see `supabase-audit-report.md`.
