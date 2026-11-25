# Production Readiness Gaps (Prioritized)

**Audit Date:** 2026-11-25 (Re-audited after final remediation & verification)  
**Production Readiness Verdict:** **READY FOR STAGING** — All P0 functional, security, lint, unit, integration, and E2E code gaps are resolved; only design-system owner confirmation, minor non-blocking cleanup, and external hosting/SMTP/Supabase/Cron verification remain.

---

## Remaining Code & UX Gaps

| # | Priority | Severity | Req ID | Exact Gap | Affected Files / Modules | Required Fix | Dependencies | Verification Steps | Complexity |
|---|---|---|---|---|---|---|---|---|---|
| 1 | P0 | **Low** | Sec 6, Nav | **TopBar `Company switcher` placeholder button** remains in the header (`top-bar.tsx`) for single-company MVP. | `apps/web/src/components/layout/top-bar.tsx` | Remove or hide `Company switcher` for single-company MVP if not needed. | — | Visual check. | Small |
| 2 | P0 | **Medium** | Sec 8 (Design) | **Design system palette mismatch.** `globals.css` uses Grow Spark Workspace warm/colored tokens (`#f5f2ec`, `#4a5a36`, `#9a5034`) rather than PRD monochrome (`#090909`, `#FFFFFF`, `#F5F5F5`, `#737373`, `#E5E5E5`). | `apps/web/src/app/globals.css` | Confirm with owner whether Grow Spark Workspace theme is an approved deviation, or switch tokens to monochrome. | Owner decision | Visual check. | Medium |
| 3 | P0 | **Low** | EMP-007 | **No DB `CHECK` constraint requiring `exitDate` when `status = 'INACTIVE'`** (enforced in app/Zod, whereas `TERMINATED` has a DB `CHECK`). | `apps/api/src/database/prisma/schema.prisma`, migrations | Add additive `CHECK ("status" <> 'INACTIVE' OR "exitDate" IS NOT NULL)` in a future migration if strict DB-level parity is desired. | — | Schema test. | Small |
| 4 | P0 | **Low** | Ops / Cleanup | **Obsolete `candidate-migration*` folders** in `apps/api/src/database/`. | `apps/api/src/database/candidate-migration*` | Remove unused draft folders. | — | `git status`. | Small |

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
