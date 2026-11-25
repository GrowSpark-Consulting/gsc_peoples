# Testing & Verification Evidence

**Audit Date:** 2026-11-25  
**Scope:** Actual execution of typecheck, lint, unit tests, database integration tests, production build, and inspection of Playwright E2E coverage. No application code or tests were modified.

---

## 1. Commands Executed & Observed Results

| Check | Command | Exit Code | Observed Result |
|---|---|---|---|
| **Typecheck (all packages)** | `pnpm typecheck` (`pnpm -r typecheck`) | `0` | **PASS** — `packages/shared`, `packages/contracts`, `apps/api`, `apps/web` all passed `tsc`. |
| **Lint — Shared** | `pnpm --filter @gsc/shared lint` | `0` | **PASS** |
| **Lint — Contracts** | `pnpm --filter @gsc/contracts lint` | `1` | **FAIL** — `packages/contracts/src/organization.ts:70:57` (`@typescript-eslint/no-explicit-any`). |
| **Lint — API** | `pnpm --filter @gsc/api lint` | `1` | **FAIL** — 130 errors, 0 warnings (`@typescript-eslint/no-explicit-any` across routes/repos). |
| **Lint — Web** | `pnpm --filter @gsc/web lint` | `1` | **FAIL** — 1,020 errors, 12,110 warnings because `eslint .` scans generated `apps/web/.next-scratch/`. In `src/`, `top-bar.tsx:84` has 1 warning (`no-location-assign-relative-destination`). |
| **Unit Tests — Shared** | `pnpm --filter @gsc/shared test` | `0` | **PASS** — 1 file, 2 tests passed (`normalize.test.ts`). |
| **Unit Tests — Contracts** | `pnpm --filter @gsc/contracts test` | `0` | **PASS** — 2 files, 46 tests passed (`permissions.test.ts` 16, `authorization.test.ts` 30). |
| **Unit Tests — API** | `pnpm --filter @gsc/api test` | `1` | **FAIL** — 19 passed, 1 failed (20 files); 182 passed, 1 failed (183 tests). Failure: `src/modules/health/health.test.ts:20` expected `503` on `/api/v1/health/ready`, received `200` because `.env` has a reachable local `DATABASE_URL`. |
| **Unit Tests — Web** | `pnpm --filter @gsc/web test` | `0` | **PASS** — 28 files, 244 tests passed. (All component/page tests use `api-mock.ts` / fake fetch, not real API). |
| **DB Integration Tests — API** | `pnpm test:integration` | `0` | **PASS (with 1 todo)** — 15 files, 293 passed, 1 todo (294 total), run against disposable local scratch DB `hr_itest` (`543.67s`). |
| **Production Build** | `pnpm build` (`pnpm -r build`) | `1` | **PARTIAL** — `@gsc/shared`, `@gsc/contracts`, and `@gsc/api` (`tsup` -> `dist/server.js`) built cleanly. `@gsc/web` (`next build`) failed-closed as designed because `NEXT_PUBLIC_API_URL` is not set in local `.env`. |
| **Playwright E2E** | *Inspected only (`apps/web/e2e/`)* | N/A | **NOT RUN against live API.** Existing specs (`app-shell.spec.ts`, `employees.spec.ts`, `home.spec.ts`, `ui-patterns.spec.ts`) target demo mode (`next dev` with in-memory demo data). No real-API/DB Playwright specs exist for login, check-in/out, leave approval, document upload/download, or invitation acceptance. |

---

## 2. Coverage by Feature Area

| Feature Area | Test Files | What They Prove | What They Do NOT Prove / Missing Coverage |
|---|---|---|---|
| **Permissions & `can()`** | `packages/contracts/src/permissions.test.ts`, `authorization.test.ts` | `ROLE_PERMISSIONS` and `can()` match PRD Section 5 matrix for all 4 roles. | Does NOT prove routes actually call `can()` — e.g. `onboarding.routes.ts` and `leave.routes.ts` bypass it. |
| **Auth & Sessions** | `password.test.ts`, `authenticate.test.ts`, `session-login.integration.test.ts` | scrypt hashing, bearer/cookie auth, 8h idle/expiry, CSRF, login rate limit, membership revocation. | Does NOT test email delivery for reset/invite (not implemented), nor `/forgot-password` -> `/reset-password` -> login end-to-end in browser. |
| **Settings & Accounts** | `settings-authorization.integration.test.ts` | SA vs HR vs MGR vs EMP on `/settings/*`, last SA protection, role changes, invite/resend, status toggle, audit log creation. | Does NOT test HR viewing `/settings` UI (which currently breaks with 403), nor audit log filtering/pagination (missing). |
| **Organization & Holidays** | `foundation.integration.test.ts`, `organization-page.test.tsx` | Holiday CRUD, company calendar defaults, org UI tabs (mocked API). | Does NOT test `GET /organization/hierarchy` with multi-level cycles or large orgs; does NOT test holiday exclusion in leave requests. |
| **Employee CRM** | `employees.api.test.ts`, `employees.repository.test.ts`, `employees.integration.test.ts`, `manager-cycles.integration.test.ts`, `employee-*.test.tsx` | Sequential `EMP-0001` concurrency, cycle trigger, cursor pagination, directory filters, `EmployeeDrawer` keyboard a11y. | Does NOT catch Manager privacy leak (`address`/`emergencyContact` returned by API), missing timeline UI, missing `/profile` self-edit UI, or incomplete offboarding (W10). |
| **Onboarding** | `onboarding-page.test.tsx` | Mocked UI rendering of employee/template tabs and checklist drawer. | **Zero API integration tests** for `/onboarding/*`; misses Manager unauthorized access and Employee completing `HR` tasks. |
| **Attendance** | `attendance.rules.test.ts`, `attendance.integration.test.ts`, `attendance-page.test.tsx`, `attendance-hr.test.tsx` | Company timezone day rollover, duplicate 409, 7-day correction window, 1 pending/date, manual correction, HR overview. | `attendance.integration.test.ts` asserts the **wrong** PRD rule (blocks weekend/holiday check-in); no test for full-day leave blocking check-in; no test for monthly summary (ATT-003, missing) or notifications (NOTIF-002). |
| **Leave** | `leave-authorization.integration.test.ts`, `leave-page.test.tsx` | No self-approval, overlap trigger + advisory lock, company isolation. | **No test** for working-day calculation excluding weekends/holidays (currently broken), 7-day retroactive limit, indirect-report manager scope, HR post-start cancellation, notifications, or month calendar UI. |
| **Documents** | `documents.rules.test.ts`, `documents.integration.test.ts`, `retention.integration.test.ts`, `storage.test.ts`, `documents-page.test.tsx` | Magic-byte/10MB checks, 60s signed URLs, 403 on unauthorized, soft delete + 30-day purge logic (local driver / mocked Supabase). | Does NOT test live Supabase Storage bucket; does NOT test indirect-report manager visibility; does NOT test scheduled purge cron. |
| **Dashboards & Notifications** | `dashboard-page.test.tsx`, `notifications-menu.test.tsx` | UI rendering with mocked responses; bell unread badge & mark-read. | **Zero API integration tests** for `/dashboard/*` and `/notifications/*`; misses broken `absentToday` logic, missing `joinersLast30Days` list, and missing `NOTIF-002` event emission. |
