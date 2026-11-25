# Testing & Verification Evidence

**Audit Date:** 2026-11-25 (Final verification after remediation)  
**Scope:** Actual execution of typecheck, lint, unit tests, database integration tests (against disposable `hr_itest`), Playwright E2E scratch suite (against disposable `hr_itest_e2e` + local SMTP mail sink + production `next build`), and package production builds.

---

## 1. Commands Executed & Observed Results

| Check | Command | Exit Code | Observed Result |
|---|---|---|---|
| **Typecheck (all packages)** | `pnpm typecheck` (`pnpm -r typecheck`) | `0` | **PASS** — `@gsc/shared`, `@gsc/contracts`, `@gsc/api`, `@gsc/web` all passed `tsc`. |
| **Lint (all packages)** | `pnpm lint` (`pnpm -r lint`) | `0` | **PASS** — 0 errors, 0 warnings across `@gsc/shared`, `@gsc/contracts`, `@gsc/api`, `@gsc/web`. |
| **Unit Tests — Shared** | `pnpm --filter @gsc/shared test` | `0` | **PASS** — 1 file, 2 passed (`normalize.test.ts`). |
| **Unit Tests — Contracts** | `pnpm --filter @gsc/contracts test` | `0` | **PASS** — 2 files, 46 passed (`permissions.test.ts` 16, `authorization.test.ts` 30). |
| **Unit Tests — API** | `pnpm --filter @gsc/api test` | `0` | **PASS** — 24 files, 211 passed. |
| **Unit Tests — Web** | `pnpm --filter @gsc/web test` | `0` | **PASS** — 28 files, 248 passed (component/page tests with mocked API). |
| **DB Integration Tests — API** | `pnpm --filter @gsc/api test:integration` | `0` | **PASS (with 1 todo)** — 17 files, 347 passed, 1 todo (348 total) against disposable local scratch DB `hr_itest` (`560.23s`). Includes `schema-objects.integration.test.ts` (15/15), `runtime-privileges.integration.test.ts` (7/7), `bootstrap.integration.test.ts` (10/10), `prd-acceptance.integration.test.ts`, `documents.integration.test.ts` (19/19), `attendance.integration.test.ts` (41/41), `manager-cycles.integration.test.ts` (9/9). |
| **Playwright E2E — Scratch** | `pnpm --filter @gsc/web test:e2e:scratch` (with `PW_CHROMIUM_EXECUTABLE`) | `0` | **PASS** — 60 passed, 0 failed (`12.3m`) against disposable `hr_itest_e2e`, local SMTP mail sink (`mail-sink.mjs`), real API, and `next build` + `next start` (`.next-scratch`, `NEXT_PUBLIC_API_URL=http://localhost:4400/api/v1`). Covers `auth.spec.ts`, `attendance.spec.ts`, `documents.spec.ts`, `leave.spec.ts`, `notifications-and-isolation.spec.ts`, `people-workflows.spec.ts`, and `responsive.spec.ts` (360px–1440px). |
| **Production Builds** | `pnpm --filter @gsc/shared build; pnpm --filter @gsc/contracts build; pnpm --filter @gsc/api build` | `0` | **PASS** — `@gsc/shared`, `@gsc/contracts`, and `@gsc/api` (`tsup` -> `dist/server.js` 252.45 KB, `dist/purge-documents.js` 2.02 KB) built cleanly. `@gsc/web` (`next build`) succeeds with `NEXT_PUBLIC_API_URL` set (verified inside `test:e2e:scratch`) and fails closed when unset. |

---

## 2. Coverage by Feature Area

| Feature Area | Test Files | What They Prove | External / Remaining Verification |
|---|---|---|---|
| **Permissions & `can()`** | `permissions.test.ts`, `authorization.test.ts`, `settings-authorization.integration.test.ts`, `notifications-and-isolation.spec.ts` | `ROLE_PERMISSIONS`, `can()`, route-level enforcement, and 403/404 isolation across all 4 roles and 2 companies. | — |
| **Auth & Sessions** | `password.test.ts`, `authenticate.test.ts`, `session-login.integration.test.ts`, `auth.spec.ts`, `people-workflows.spec.ts` | scrypt hashing, httpOnly cookie + CSRF, 8h idle/absolute expiry, login rate limit, 60m single-use password reset & 7d single-use invitation activation via SMTP mail sink. | Live production SMTP credentials on Render. |
| **Settings & Accounts** | `settings-authorization.integration.test.ts`, `people-workflows.spec.ts` | SA vs HR vs MGR vs EMP on `/settings/*`, last SA protection, role changes, invite/resend, status toggle, audit log filtering/pagination. | — |
| **Organization & Holidays** | `foundation.integration.test.ts`, `organization-page.test.tsx`, `people-workflows.spec.ts` | Dept/designation CRUD, case-insensitive uniqueness, holiday CRUD, company calendar defaults, org structure UI. | — |
| **Employee CRM** | `employees.api.test.ts`, `employees.repository.test.ts`, `employees.integration.test.ts`, `manager-cycles.integration.test.ts`, `people-workflows.spec.ts` | Concurrent `EMP-0001`, cycle trigger, cursor pagination, directory filters, Manager privacy (`forViewer()`), `expectedUpdatedAt` lock, self-edit, timeline, offboarding. | — |
| **Onboarding** | `onboarding-page.test.tsx`, `people-workflows.spec.ts` | Template copy, employee/HR task completion, Manager block, derived progress, invitation + activation flow, HR completion notification. | — |
| **Attendance** | `attendance.rules.test.ts`, `attendance.integration.test.ts`, `attendance.spec.ts`, `reports-page.test.tsx`, `people-workflows.spec.ts` | Server timestamps, company timezone, weekend/holiday check-in allowed, approved full-day leave blocked, duplicate 409, 7-day corrections, `CORRECTION_ON_LEAVE_DATE`, manual corrections, monthly summary & CSV export. | — |
| **Leave** | `leave.rules.test.ts`, `leave-authorization.integration.test.ts`, `prd-acceptance.integration.test.ts`, `leave.spec.ts`, `people-workflows.spec.ts` | Working-day exclusion (weekends + holidays), 7-day retroactive limit, overlap trigger + advisory lock, direct/indirect manager routing, no self-approval, HR post-start cancellation, month calendar. | — |
| **Documents** | `documents.rules.test.ts`, `documents.integration.test.ts`, `retention.integration.test.ts`, `purge-args.test.ts`, `documents.spec.ts` | Magic-byte/MIME/10 MB checks, 60s signed URLs, 403/404 isolation, Manager `visibleToManager` listing (with and without `?employeeId=`), soft delete + 30-day purge logic. | Live Supabase Storage bucket (`hr-documents`) & Render Cron scheduling for `dist/purge-documents.js`. |
| **Dashboards & Notifications** | `dashboard-page.test.tsx`, `notifications-menu.test.tsx`, `prd-acceptance.integration.test.ts`, `notifications-and-isolation.spec.ts` | HR/Manager/Employee dashboards (`absentToday`, `joiners`, direct+indirect team), deduplicated notifications, unread badge, mark one/all read. | — |
| **Schema & Migrations** | `schema-objects.integration.test.ts`, `runtime-privileges.integration.test.ts`, `bootstrap.integration.test.ts` | All 8 migrations applied cleanly on scratch DB (`hr_itest` and `hr_itest_e2e`), CHECK constraints, triggers, indexes, RLS, `hr_app` grants, production bootstrap. | Hosted Supabase `prisma migrate deploy` as `hr_migrator` & `bootstrap-production.ts --execute`. |
