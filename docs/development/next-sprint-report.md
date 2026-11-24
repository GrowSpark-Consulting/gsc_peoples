# Next sprint report (2026-11-24)

Scope: attendance backend correctness (P0), ATT-007 HR manual correction (P0), ATT-004 HR overview by date (P1),
document-storage preparation (P0). Everything is local and uncommitted. No hosted Supabase connection, bucket,
credential, policy, migration or seed was touched. The PRD file is not in the repository, so every rule below that the
tracking documents do not state is listed under "Assumptions and ambiguities" and was not silently invented.

## 1. Files changed

Existing files modified in this sprint (other uncommitted work from earlier sprints was left untouched):

| File | Change |
|---|---|
| `apps/api/src/modules/attendance/attendance.routes.ts` | rewritten: 409s, 7-day window, scope fixes, `GET /overview`, `POST /manual-corrections` |
| `apps/api/src/modules/documents/documents.routes.ts` | rewritten: multipart upload, signed-link download, audited visibility and delete |
| `apps/api/src/app.ts` | `clock` and `documentStorage` injection seams; storage built from env; local-driver link route |
| `apps/api/src/config/env.ts` | `DOCUMENT_STORAGE_DRIVER`, `SUPABASE_STORAGE_*`, `DOCUMENTS_LOCAL_SIGNING_SECRET` and their rules |
| `apps/api/src/integrations/central-auth/auth-config.test.ts` | production env fixture now includes the storage variables, plus 4 new assertions |
| `apps/api/package.json`, `pnpm-lock.yaml` | added `busboy@1.6.0`, dev `@types/busboy@1.5.4` (see section 6) |
| `packages/contracts/src/attendance.ts`, `documents.ts` | new schemas (section 3) |
| `.env.example` | commented storage variables |
| `apps/web/src/lib/api-client.ts` | a `FormData` body is passed through (no JSON Content-Type) |
| `apps/web/src/modules/attendance/api.ts`, `attendance-page.tsx` | overview section and manual-correction dialog |
| `apps/web/src/modules/documents/api.ts`, `documents-page.tsx` | multipart upload, signed-link download and preview |
| `apps/web/src/test/api-mock.ts` | records `FormData` bodies |
| `apps/web/src/modules/attendance/attendance-page.test.tsx`, `documents-page.test.tsx`, `lib/api-client.test.ts` | updated and extended |

New files:

- API: `modules/attendance/attendance.rules.ts` (+ `.test.ts`), `attendance.integration.test.ts`;
  `modules/documents/documents.rules.ts` (+ `.test.ts`), `multipart.ts`, `documents.integration.test.ts`;
  `integrations/storage/{types,supabase-storage,local-storage,index}.ts` and `storage.test.ts`;
  `test/integration/api-harness.ts` (shared two-company login scaffolding).
- Web: `modules/attendance/attendance-hr.test.tsx`.

The existing design, sidebar, theme, employees pages and settings were not touched. The attendance page reuses its own
components (Section, Table, Dialog, Field, SelectField, Badge, CursorPagination); no new component or token.

## 2. API endpoints (prefix `/api/v1`)

| Endpoint | Status | Rule |
|---|---|---|
| `POST /attendance/check-in` | modified | duplicate = **409** (also under a race, via the unique index); non-working day / holiday stay 400 |
| `POST /attendance/corrections` | modified | **7-day window enforced** (400, `details.code` `CORRECTION_WINDOW_EXPIRED` or `CORRECTION_DATE_IN_FUTURE`); duplicate pending = **409** |
| `GET /attendance/corrections` | modified | **fixed a scope leak**: a Manager received every correction in the company; now own + team (direct and indirect reports). HR/SA: all. Employee: own |
| `PATCH /attendance/corrections/:id/review` | modified | nobody reviews their own request (403, also HR/SA); Manager only for their team (direct + indirect); already-reviewed = 409; approval now writes an audit row |
| `GET /attendance/history` | modified | Manager scope now direct + indirect reports (was direct only) |
| `POST /attendance/manual-corrections` | **new** (ATT-007) | permission `attendance:correction:manual` (HR Admin, Super Admin) |
| `GET /attendance/overview?date&status&departmentId&search&page&pageSize` | **new** (ATT-004) | permission `attendance:read:all` (HR Admin, Super Admin) |
| `POST /documents/employee`, `POST /documents/company` | modified | `multipart/form-data` (field `file`), JSON/base64 body is now 415 |
| `GET /documents/:id/download[?inline=true]` | modified | returns `{ data: { url, expiresInSeconds: 60 } }` (was the raw bytes) |
| `GET /documents/local-file/:token` | new, **development driver only** | HMAC link, 60 s, mounted only when `DOCUMENT_STORAGE_DRIVER=local` |
| `PATCH /documents/:id/visibility`, `DELETE /documents/:id` | modified | audit rows written in the same transaction; response of PATCH no longer includes the storage key |
| `GET /documents` | modified | response never contains the storage key |

## 3. Contracts changed (`@gsc/contracts`)

Added, none removed or altered: `attendanceOverviewStatusSchema`, `attendanceOverviewQuerySchema`,
`attendanceOverviewRowSchema`, `attendanceOverviewResponseSchema`, `manualAttendanceRecordSchema`,
`manualAttendanceCorrectionResponseSchema`; `DOCUMENT_ALLOWED_MIME_TYPES`, `DOCUMENT_MAX_BYTES`,
`DOCUMENT_SIGNED_URL_TTL_SECONDS`, `uploadEmployeeDocumentFieldsSchema`, `uploadCompanyDocumentFieldsSchema`,
`documentUploadResponseSchema`, `documentDownloadQuerySchema`. The existing `manualAttendanceCorrectionSchema` is used as
it was. `uploadEmployeeDocumentSchema` / `uploadCompanyDocumentSchema` (base64) are now unused by the API and kept only
so nothing else breaks; they can be deleted in a cleanup. `documentDownloadResponseSchema` now matches the route (before,
it did not). The integration tests parse real responses with the new response schemas.

Overview status values: `PRESENT, ABSENT, ON_LEAVE, HOLIDAY, WEEKEND, NOT_YET_IN, MISSING_CHECKOUT`. The existing
`attendanceStatusSchema` has no WEEKEND, so the overview has its own enum rather than changing the one the dashboard uses.

## 4. Database or migration changes (proposed, NOT applied, none required to run this code)

1. Recommended: one pending correction per employee and date enforced by the database. Today this is an application
   check; two simultaneous requests can both pass it (the route maps a unique violation to 409 once the index exists):

```sql
CREATE UNIQUE INDEX "attendance_corrections_one_pending_per_day"
  ON "attendance_corrections" ("companyId", "employeeId", "date") WHERE "status" = 'PENDING';
```

2. Not a schema change, a data note: `employee_documents.storedPath` now holds the storage object key
   (`<companyId>/<ownerEmployeeId|company>/<uuid>`). Rows written by the earlier local-disk code hold absolute disk paths
   and will not download with the Supabase driver. The hosted database has no company or documents yet, so nothing needs
   migrating there; a local development database with old uploads would need them re-uploaded.
3. Retention (DOC-005): soft delete sets `deletedAt` and `purgeAfterAt = +30 days`; the job that deletes the object and
   the row after that date does **not exist yet** (needs a scheduler decision, see section 8).

No new Prisma model, column or migration was written.

## 5. Security decisions and permission coverage

Attendance
- Every query runs in the tenant runner (company-scoped, RLS). Another company's employee, correction or record id is
  404 for everyone; tests cover it for check-in, correction review, history, manual correction and overview.
- Manager scope uses the existing team-scope resolver (direct + indirect reports), the same one the employees module
  uses. A peer, the manager's own manager or another company is refused.
- The correction request is always filed for the caller (the schema is `strict`; an `employeeId` in the body is a 400).
- Self-review is refused for every role (403): an HR Admin or Super Admin cannot approve their own correction, mirroring
  LEAVE-005. Decision, see assumptions.
- Manual correction: HR Admin and Super Admin only; Manager and Employee get 403 and nothing is written. A person cannot
  manually correct their own attendance (403): they use the request flow, which someone else approves.
- Manual correction is blocked (409) while an employee request for that date is pending, and for identical values, so
  an approval cannot later overwrite an HR correction silently.
- Audit: manual correction and approved corrections write `audit_logs` rows (actor, time, entity id, old values, new
  values, reason) in the **same transaction** as the change, so a failed write leaves no audit row and a change cannot
  exist without one. The record also keeps the very first original check-in/out and the last corrector.

Documents
- Server-side only; the bucket is accessed with a service key that never reaches the browser or logs. Errors from the
  storage service are mapped to a generic 503 or 404 and never include a key, bucket or provider message.
- Files are validated on the server: allow-list (PDF, PNG, JPEG, DOCX), **content signature must match the declared type**
  (a script labelled `application/pdf` is rejected), 1 byte to 10 MB. Over the limit is cut off while streaming (413),
  a `Content-Length` above 10 MB + 64 KB is refused before reading, one file per request, at most 10 short fields.
- The object key never contains the user's file name; the display name is stripped of paths and control characters.
- Upload order: authorise and resolve the owner, validate, write the object, then insert row + audit in one transaction;
  if the insert fails the object is removed again (tested).
- Ownership: own record needs `document:upload` (all roles); another employee's record needs `document:upload:all`
  (HR, SA). Before, the check was `document:read:all` or `employee:write`, and an unknown employee id ended in a 500.
  Company documents: HR/SA only. Reads, manager visibility (direct reports only, flag required) and tenant isolation are
  unchanged and re-tested. Deleted documents are 404 for download and absent from lists.
- Download links: authorisation on every request, `Cache-Control: no-store`, link valid 60 seconds (fixed constant, not
  configurable). The local driver's link is an HMAC token with expiry and constant-time compare.
- Soft delete keeps the object so a delete can be undone inside the 30 days; it is hidden at once.
- `NODE_ENV=production` now **refuses to start** unless `DOCUMENT_STORAGE_DRIVER=supabase` with URL and key set
  (local disk would lose files on every redeploy). See the deployment note in section 9.

Permission matrix verified by integration tests (HR = HR Admin, SA = Super Admin, M = Manager, E = Employee):

| Action | E | M | HR | SA | other company |
|---|---|---|---|---|---|
| check in (once) | yes, 2nd = 409 | yes | yes | yes | independent |
| request correction (window) | own | own | own | own | n/a |
| list corrections | own | team + own | all | all | none |
| review correction | 403 | team only, never own | all except own | all except own | 404 |
| manual correction | 403 | 403 | yes (not self) | yes (not self) | 404 |
| overview by date | 403 | 403 | yes | yes | own company only |
| upload own document | yes | yes | yes | yes | n/a |
| upload for another employee | 403 | 403 | yes | yes | 404 |
| upload company document | 403 | 403 | yes | yes | n/a |
| signed link | own + company docs | + direct reports' visible docs | all | all | 404 |
| visibility flag, delete | 403 | 403 | yes | yes | 404 |

## 6. Commands executed and results

| Command | Result |
|---|---|
| `corepack pnpm --filter @gsc/api add busboy@1.6.0` and `... add -D @types/busboy@1.5.4` | done; `pnpm` is not on this machine's PATH, `corepack pnpm` works. Lockfile +27 lines (busboy, streamsearch, types) |
| `npx tsc -p tsconfig.json` in `apps/api` | **pass** (exit 0) |
| `npx tsc --noEmit -p tsconfig.json` in `apps/web` | **pass** (exit 0) |
| `npx tsc --noEmit` in `packages/contracts` | **pass** |
| `npx vitest run` in `apps/api` (unit) | **169 of 169 pass**, 18 files (141 before; +28 new unit tests: attendance rules, storage drivers, document rules) |
| `npx vitest run` in `apps/web` | **244 of 244 pass**, 28 files (234 before this sprint's start: +10) |
| `npx vitest run` in `packages/contracts`, `packages/shared` | **46 of 46** and **2 of 2** pass |
| `npx vitest run --config vitest.integration.config.ts` in `apps/api` (scratch PostgreSQL) | **265 pass, 1 todo, 0 fail**, 13 files (213 before; +33 attendance, +19 documents) |
| `npx eslint` on the new and changed API files, `npx eslint src` in `apps/web` | API: 0 problems in files touched here. Web: 0 errors, 1 existing warning (`top-bar.tsx`) |

Test environment: vitest only works here from a shell with an upper-case drive letter (`C:\...`), as noted in the
previous report. Integration tests ran on the throwaway database `hr_itest`, created and dropped by the suite's global
setup on the local server. `hr_db`, `hr_test` and every hosted database were not connected to for any purpose. The suite
refuses non-local hosts and protected database names by itself.

I did **not** run the new tests against the unfixed code, so I cannot show they failed before the change (same caveat as
the previous report). The check-in race (two simultaneous requests: exactly one 201, one 409) and the "failed insert removes
the object" paths are exercised for real.

## 7. Tests: passed, failed, skipped, not run

- Passed: everything in section 6. New coverage: 7-day boundary at today, today-1, today-7, today-8, tomorrow, and at
  23:59:59 / 00:00:01 of the boundary day; duplicate and concurrent check-in; duplicate correction; all four roles; manager
  direct vs indirect vs peer vs self; cross-tenant for every new or changed route; manual-correction validation (13 cases),
  conflicts and audit rows; overview statuses (present, missing check-out, on leave, pending leave not leave, absent, not
  yet in, after work end, weekend, worked weekend, holiday, half-day leave), pagination, filters, terminated employees,
  other company; multipart limits (5 MB ok, exactly 10 MB ok, 10 MB + 1 byte = 413), spoofed content, empty, no file, two
  files, JSON body, unknown field; storage outage = 503; link TTL = 60; signed-URL request to the Supabase REST API
  (mocked `fetch`: path, `expiresIn: 60`, `x-upsert: false`, key only in headers); local link expiry and tampering;
  traversal-proof keys; production env fail-closed.
- Skipped: 1 existing `todo` in the session suite (unchanged).
- Failed: none at the end. During development several tests failed for test-side reasons (timezone parsing of raw
  `timestamp` reads, a termination-date check constraint, wrong expected counts, two over-broad selectors) and one real
  defect I introduced and fixed (the local-link route sat behind the session middleware). None was weakened or removed.
- **Not run: Playwright.** Every existing live suite targets `hr_test` (`playwright.live-testdb.config.ts` refuses
  anything else), which this sprint forbids touching, and the repository has no end-to-end harness for a scratch database
  (seeded users, API and web servers pointed at it). Building that is a separate piece of work, so no spec was added
  for the new attendance workflows rather than adding specs that were never executed. **No browser verification is
  claimed**, including the 375/768/1024/1440 responsive check, which was also not run. The UI behaviour is covered by
  jsdom component tests only.
- Not run: API-wide lint (166 existing `no-explicit-any` errors from before still stand; the files touched here are
  clean); anything against the real Supabase Storage service.

## 8. Assumptions and ambiguities (the PRD text was not available; please confirm)

1. **7-day window**: read as "the attendance date is at most 7 days before today, and not in the future" (today-7 is
   allowed, today-8 is not). One constant, `CORRECTION_WINDOW_DAYS`, in `attendance.rules.ts`.
2. **"Today" is the UTC date**, the same basis as check-in, the dashboard and the stored date column. The company
   timezone (open item G16) is still not used, so for a company in Asia/Kolkata the window and "today" roll over at
   05:30 local. Fixing it needs one decision across attendance, dashboard and leave together.
3. **HR manual correction has no 7-day limit** and may be made on a weekend or holiday and for a day with leave: the
   documents do not say otherwise. It cannot be in the future and cannot touch a terminated or inactive employee.
4. Manual correction semantics: an omitted time keeps the stored value, `null` clears it; a check-out needs a check-in;
   check-out after check-in; neither in the future. The UI exposes "set" only (empty field = unchanged); clearing is API-only.
5. No self manual-correction and no self-review of a correction request (see section 5). If the PRD allows an HR Admin
   to approve their own attendance correction, remove the check at `attendance.routes.ts` (one line).
6. **Overview population**: employees whose status is not TERMINATED or INACTIVE, who had joined by the date
   (`joiningDate` empty or earlier) and had not exited before it. ONBOARDING employees are included.
7. **Overview status policy**: ABSENT only when the day is over for them (a past working day, or today at or after the
   company work end time) with no check-in, no approved full-day leave and no holiday. Before that: NOT_YET_IN. A
   check-in always wins (a worked weekend or holiday shows PRESENT); a check-in with no check-out is PRESENT while the day
   is open and MISSING_CHECKOUT afterwards. Non-working days are WEEKEND. **Half-day leave** does not turn the day into
   leave (the employee is still expected for half a day); the row is flagged `halfDayLeave`. Pending, rejected and
   cancelled leave never counts. A future date is a 400.
8. The overview is HR Admin and Super Admin only. A Manager-scoped overview (team only) was not asked for and not built.
9. The existing `DOCUMENT_READ_SELF` rule that lets every employee read all company documents was kept.
10. Manager visibility of employee documents (`visibleToManager`) still uses the **direct** manager only, as before. The
    PRD asks for direct and indirect in other places; attendance is now correct, leave, dashboard and documents are not
    (G3, G18 remain open for them).

## 9. Remaining blockers and hosted changes needing explicit approval

Nothing below was done.

Hosted Supabase (all need your approval, and the credentials, which I did not request):
1. Create a **private** Storage bucket named `hr-documents` (or choose another name and set `SUPABASE_STORAGE_BUCKET`):
   Public = off, file size limit 10 MB, allowed MIME types as the four above. Add **no** Storage policies for `anon` or
   `authenticated`; only the service key reaches it.
2. Create a service key for this server (or reuse the project's service role key) and store it only as a secret on
   the API host (Render). Rotate it if it was ever shown in chat or logs.
3. Set on the API host: `DOCUMENT_STORAGE_DRIVER=supabase`, `SUPABASE_STORAGE_URL=https://<project-ref>.supabase.co`,
   `SUPABASE_STORAGE_SERVICE_KEY=<secret>`, `SUPABASE_STORAGE_BUCKET=hr-documents`. **Until these are set, a
   production boot fails on purpose**; deploy this change together with them.
4. After the first deploy, verify against the real service (not possible locally): an upload lands in the bucket under
   `<companyId>/<employeeId>/<uuid>`; the link returned by `GET /documents/:id/download` works, then returns an error after
   60 seconds; the bucket URL without a token is refused; a preview link (`?inline=true`) renders in the browser tab and a
   normal link downloads with the original file name. These behaviours follow the documented REST API but were only
   tested against a mocked `fetch`.
5. Optional migration in section 4 (one-pending-correction index) after a backup, per `supabase-migration-checklist.md`.
6. Decide who runs the 30-day retention purge (a scheduled job or a Supabase cron calling the API) and approve it. Until
   then deleted documents stay in the bucket.

Other:
- Playwright harness on a scratch database and the responsive pass (section 7).
- The company-timezone decision (assumption 2) and the PRD answers for assumptions 1, 3, 5 and 7.
- Production bootstrap (company and Super Admin on Supabase) from `production-bootstrap-plan.md` is still open.
- The overview employee picker and the manual-correction dialog load at most 100 names (`getEmployeeNames`), the same
  limit the earlier attendance screen had; a company larger than that needs a searchable picker.
- Still open from the integration matrix: G1 (dashboard "absent"), G3, G4 (history monthly summary), G10, G11, G16, G17,
  G18 for leave and dashboard, G19, ATT-008 reports.

## 10. Confirmation

No `git commit`, `git push`, pull request, branch change, stash, reset or deployment was performed. No uncommitted change
from earlier sprints was reset or overwritten (the files edited here were modified in place). The only environment
changes outside source files are the two dependencies in section 1 and the throwaway scratch database `hr_itest`,
which the integration suite created and dropped itself. Hosted Supabase was not contacted.

Stopping here as instructed; the next sprint is not started.
