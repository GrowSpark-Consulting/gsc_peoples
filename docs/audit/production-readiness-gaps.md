# Production Readiness Gaps (Prioritized)

**Audit Date:** 2026-11-25 (Re-audited after P0 remediation changes)  
**Production Readiness Verdict:** **CONDITIONAL / NEAR READY** — All Critical P0 functional blockers have been resolved in code; only minor defects, a test timeout, design-system alignment, and deployment/operational steps remain.

---

## Remaining Code & UX Gaps

| # | Priority | Severity | Req ID | Exact Gap | Affected Files / Modules | Required Fix | Dependencies | Verification Steps | Complexity |
|---|---|---|---|---|---|---|---|---|---|
| 1 | P0 | **Medium** | Testing / CI | **`employee-form.test.tsx` timed out under full-suite run** (`5000ms` timeout in `create > submits normalised data...`). Also `apps/web/e2e-scratch/` Playwright suite has not yet been executed in this audit. | `apps/web/src/modules/employees/components/employee-form.test.tsx`, `apps/web/e2e-scratch/` | Investigate/increase timeout or reduce render overhead in `employee-form.test.tsx`; run `pnpm test:e2e:scratch` against local scratch DB + mail sink. | — | `pnpm test` and `pnpm test:e2e:scratch` pass 100%. | Small |
| 2 | P0 | **Medium** | DOC-004 | **`GET /documents` omits flagged team docs when `?employeeId=` is not passed.** `where.OR` only includes `ownerEmployeeId: req.user!.employeeId` and `isCompanyDocument: true`. | `apps/api/src/modules/documents/documents.routes.ts:64` | For `DOCUMENT_READ_TEAM`, include `ownerEmployeeId: { in: await resolveTeamEmployeeIds(db, req.user!.employeeId) }` in `where.OR` (still filtered by `canReadEmployeeDoc`). | — | Integration test: Manager calls `GET /documents` with no query params and receives flagged team doc. | Small |
| 3 | P0 | **Medium** | W7, ATT-005 | **`POST /attendance/corrections` does not block dates with approved full-day leave.** PRD W7 states: *"date with approved leave blocked"*. | `apps/api/src/modules/attendance/attendance.routes.ts` | Check `leaveRequest` (`status: 'APPROVED'`, `dayType: 'FULL_DAY'`) for the requested date and return 400/409. | — | Integration test: correction request on approved full-day leave date is rejected. | Small |
| 4 | P0 | **Medium** | Sec 6, Nav | **Sidebar shows all 9 nav items to all roles; TopBar has a `Company switcher` placeholder menu.** | `apps/web/src/config/navigation.ts`, `sidebar.tsx`, `top-bar.tsx` | Filter sidebar nav items by `session.permissions`; remove/hide `Company switcher` placeholder for single-company MVP. | — | E2E test per role confirms only permitted nav links appear. | Small |
| 5 | P0 | **Medium** | Sec 8 (Design) | **Design system palette mismatch.** `globals.css` uses Grow Spark Workspace warm/colored tokens (`#f5f2ec`, `#4a5a36`, `#9a5034`) rather than PRD monochrome (`#090909`, `#FFFFFF`, `#F5F5F5`, `#737373`, `#E5E5E5`). | `apps/web/src/app/globals.css` | Confirm with owner whether Grow Spark Workspace theme is an approved deviation, or switch tokens to monochrome. | Owner decision | Visual check. | Medium |
| 6 | P0 | **Low** | EMP-007 | **No DB `CHECK` constraint requiring `exitDate` when `status = 'INACTIVE'`** (enforced in app/Zod, whereas `TERMINATED` has a DB `CHECK`). | `apps/api/src/database/prisma/schema.prisma`, migrations | Add additive `CHECK ("status" <> 'INACTIVE' OR "exitDate" IS NOT NULL)` in a future migration if strict DB-level parity is desired. | — | Schema test. | Small |
| 7 | P0 | **Low** | Ops / Cleanup | **Obsolete `candidate-migration*` folders** in `apps/api/src/database/`. | `apps/api/src/database/candidate-migration*` | Remove unused draft folders. | — | `git status`. | Small |

---

## Deployment & Operational Prerequisites (Render + Vercel + Supabase)

| # | Priority | Severity | Req ID | Exact Gap | Required Action |
|---|---|---|---|---|---|
| 8 | P0 | **High** | Ops / Build | **Web production build requires `NEXT_PUBLIC_API_URL`.** `next build` intentionally fails closed when `NEXT_PUBLIC_API_URL` is unset. | Set `NEXT_PUBLIC_API_URL` to the Render HTTPS API URL in Vercel environment variables before deploying. |
| 9 | P0 | **High** | W1, DB | **Hosted Supabase migrations & company bootstrap.** | Run `prisma migrate deploy` as `hr_migrator`, create private `hr-documents` bucket, and run `bootstrap-production.ts --execute` to create the company and first Super Admin link. |
| 10 | P0 | **Medium** | DOC-005 | **30-day document purge job not scheduled.** `dist/purge-documents.js` is built, not scheduled. | Configure a daily Render Cron Job running `node dist/purge-documents.js --execute` with `PURGE_COMPANY_IDS`. |
| 11 | P0 | **Medium** | AUTH-002, AUTH-004 | **Production SMTP credentials.** | Configure `MAIL_DRIVER=smtp`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` on Render. |

---

## P1 Enhancements (Post-MVP, Not Blockers)

| # | Priority | Severity | Req ID | Exact Gap | Complexity |
|---|---|---|---|---|---|
| 12 | P1 | Low | LEAVE-009 | Advanced leave policies (accrual, carry-forward, tenure). | Large |
| 13 | P1 | Low | NOTIF-003 | Email notification preferences & non-invite/reset email notifications. | Medium |
