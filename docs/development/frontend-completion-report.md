# Frontend completion report (2026-11-24)

All changes are local and uncommitted. Nothing was written to the hosted Supabase database, no seed or bootstrap was run,
and no role, permission or migration was touched. This is not a production-readiness claim: see "Not verified" and
"Blockers".

## 1. Pages completed

| Route | Result | PRD |
|---|---|---|
| `/dashboard` | Three role dashboards (HR/SA, Manager, Employee) from the real endpoints; check in/out button follows server state | DASH-001..003 |
| Top-bar bell | Live notification list, unread badge, mark one or all read, same-site links only | NOTIF-001 |
| `/attendance` | Today card (check in/out), monthly history with employee picker for HR/Manager, correction request, approve/reject with comment | ATT-001..003, 005, 006 |
| `/leave` | Balances, apply (full/half day with session), history with status filter, cancel, pending approvals, leave types, HR balance adjustment | LEAVE-001..008 (calendar: see gaps) |
| `/departments` | Tabs: Departments, Designations, Holidays, Reporting structure; search, status filter, create, edit, archive, delete | ORG-002..005 |
| `/onboarding` | HR: employees in onboarding with derived status, progress, invite, per-employee checklist, default checklist; Employee: own checklist | ONB-001..005 |
| `/documents` | Employee and company documents, upload with client validation, preview/download through the authenticated API, manager-visibility flag, soft delete | DOC-001..005 (see blocker B1, B2) |
| `/reports` | Explicit "not available yet" state, no figures (P1, needs API endpoints) | ATT-008 deferred |

Untouched: sidebar, top bar layout, theme, tokens, employees pages, login pages, `/settings`. Only existing components were
used; the one addition is a small tab list (`modules/shared/tabs.tsx`) built from the existing tokens.

## 2. Endpoints integrated

Dashboard: `/dashboard/hr|manager|employee`. Notifications: `/notifications`, `/:id/read`, `/read-all`.
Attendance: `/attendance/today|check-in|check-out|history|corrections`, `/corrections/:id/review`.
Leave: `/leave/types` (GET, POST, PATCH), `/leave/balances`, `/leave/balances/adjust`, `/leave/requests`
(GET, POST), `/:id/review`, `/:id/cancel`. Organization: departments, designations, holidays (full CRUD) and `/hierarchy`.
Onboarding: templates (CRUD), `/employees/:id/tasks`, `/tasks/:id`, `/tasks/:id/complete`, `POST /employees/:id/invite`.
Documents: `/documents`, `/employee`, `/company`, `/:id/download`, `/:id/visibility`, `DELETE /:id`.
Shared: `GET /me`, `GET /employees`. No endpoint or contract was invented; responses are parsed with the shared Zod
contracts (a mismatch shows an error, never fabricated data).

Shared code: `lib/api-client.ts` (cookie session, CSRF on writes, 401 redirect, error mapping), `hooks/use-session.ts`
(one `/me` call per page load), `hooks/use-action.ts` (one mutation at a time), `modules/shared/*`.

## 3. Mock data

None was present in production paths; the employees demo adapter stays dev-only. `PagePlaceholder` and the notification
`PlaceholderMenu` are no longer used by these pages. No hardcoded counts or sample rows were added.

## 4. PRD requirements: missing or partial

| Requirement | State |
|---|---|
| ATT-004 HR attendance overview by date | **Missing**: no API |
| ATT-007 HR manual correction | **Missing**: no API route |
| ATT-003 monthly summary totals | Shown only if the API returns `summary`; it does not yet |
| ATT-005 7-day window, ATT-002 HTTP 409 | UI limits the date; API does not enforce / returns a validation error (G14, G15) |
| LEAVE-008 month calendar | **Missing**: no endpoint, and `month`/`year` are ignored (G10, G17); list view only |
| ONB-004 company-wide onboarding list | Built from `/employees?status=ONBOARDING` plus one checklist call per employee (G11) |
| DASH-001 "Not yet in" vs Absent | The API computes absent without working-day, holiday or work-end rules (G1); the UI labels it "Not checked in" |
| DASH-002 indirect reports, DOC-003 signed URLs | API gaps (G3, B1) |
| ATT-008, ORG-005 polish, NOTIF-003, LEAVE-009 | P1, not built (org structure list is built) |
| SET-004 audit log viewer | API exists, **no screen** (`/settings` untouched) |
| Dashboard recent activity | Shows the action, entity and time from audit rows (no actor names; the API returns ids) |

Full list with IDs: `frontend-integration-matrix.md` sections 3 and 5.

## 5. Backend changes made (security, found while testing)

1. `leave.routes.ts`: HR Admin and Super Admin could approve their own leave. Now 403 for any self-decision (PRD LEAVE-005).
2. `leave.routes.ts`: a Manager calling `GET /leave/requests` without flags received the whole company's requests. Now limited to
   own and direct reports' requests.

Both are covered by the new `leave-authorization.integration.test.ts` (6 tests). I did not run those tests against the
unfixed code, so I cannot show they failed before.

## 6. Tests executed (actual results)

| Check | Result |
|---|---|
| Web typecheck | pass |
| Web unit and component tests | **234 of 234 pass** (27 files); 64 are new (api client 7, dashboard 8, attendance 9, leave 10, notifications 5, documents 9, organization 7, onboarding 8, reports 1) |
| Web lint | 0 errors, 1 existing warning (`top-bar.tsx` sign-out `location.assign`) |
| API typecheck | pass |
| API unit tests | 141 of 141 pass |
| API integration on scratch PostgreSQL 17.12 (roles with `search_path=hr`) | 213 pass, 1 todo, 0 fail (11 files) |
| Contracts and shared tests | not re-run this round (no change) |
| API lint | not re-run; 166 earlier errors (`no-explicit-any`) still stand |
| **Playwright end-to-end** | **Not run.** It needs the API and web servers plus seeded users on a test database; I did not start them. The existing specs cover the employees pages only. No new e2e specs were written |
| **Responsive check at 375, 768, 1024, 1440** | **Not run.** No browser pass was made; layouts reuse the existing responsive components, tables scroll horizontally, forms are single-column. Needs a manual or Playwright pass |

Test environment note: on this machine vitest only works when the shell's working directory has an upper-case drive letter
(`C:/...`); with `c:/...` React loads twice and every component test fails with "Invalid hook call", including the
existing ones. It is a path-casing quirk, not a code defect.

## 7. Role and permission verification

Unit level (mocked API): each page shows only what the role's permissions allow. Employee has no approvals, leave types,
adjustment, company upload, delete or visibility controls; Manager has team scope and no HR sections; HR/SA see management
sections; own requests never show Approve/Reject; rejection needs a comment; 403s render "No access" or a permission message.
Server level (real PostgreSQL): the existing suites for the four roles plus the new leave test confirm 403s on direct API
calls, team scope and company isolation. **Not done:** a click-through of every page as each of the four roles in a browser.

## 8. Blockers and decisions needing you

1. **Documents storage (B1)**: files are written to the API server's local disk and returned as raw bytes, not a Supabase
   Storage private bucket with 60-second signed URLs (DOC-003). Uploads will not survive a redeploy. Needs your approval,
   bucket and credentials.
2. **Upload size (B2)**: the API body limit is 1 MB but uploads are base64 JSON up to 10 MB, so files above roughly 750 KB
   fail with 413 (the UI shows "too large for the server"). Needs a multipart route or a larger limit on the document routes.
3. **Production bootstrap**: no company or Super Admin exists on Supabase yet, so none of these pages can be used there.
   Inputs listed in `production-bootstrap-plan.md`.
4. **Backend gaps** G1, G3, G5, G6, G10, G11, G14 to G19 in the matrix. ATT-007 and ATT-004 need new routes.
5. Playwright and responsive verification (above), and API lint cleanup.
6. Decide whether `/settings` (old plain page) should be restyled and extended with the audit log viewer.
