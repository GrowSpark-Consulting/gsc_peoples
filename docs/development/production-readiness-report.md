# GSC Peoples: production readiness report

Date: 2026-11-25. Scope: the working tree on `main`, on top of the single commit `8264597`.
**Nothing was committed, pushed or deployed. No hosted service was contacted or changed.**

## Verdict

**Not production-ready.** The code is ready for deployment *preparation*: external services have not been verified,
product decisions are open, and some PRD requirements are partial (sections B to E).

## 0. Source of truth

- `origin` (fetch and push) is `https://github.com/GrowSpark-Consulting/gsc_peoples.git`, the only remote; the
  address was already correct. Branch `main` tracks `origin/main`. `git ls-remote` showed one remote branch, `main`,
  at `8264597`, equal to the local commit.
- The authoritative PRD ("HR & People CRM — Product Requirements Document", 18 November 2026) is **not in the
  repository**. A copy was found in the operator's Downloads folder and used. Add it to the repository.
- `docs/audit/` (six files) was written by another tool or session while this work was in progress. Those files were
  read for cross-checking and left untouched; they describe the code **before** these changes.

## A. Completed and verified

Verified means an automated test ran here, against local PostgreSQL 17.12 and/or a real browser.

### A.1 Defects found and fixed

| # | Severity | Defect in the starting code | Fix | Evidence |
|---|---|---|---|---|
| 1 | Critical | A deactivated or terminated employee **could still sign in** | offboarding suspends the login, revokes sessions and tokens | acceptance suite, browser |
| 2 | Critical | "Invite" on an employee record failed at runtime (used a database object that does not exist) | one invitation service for both screens | acceptance suite, browser |
| 3 | Critical | No email was ever sent; password reset and invitations could not work in production | SMTP delivery; tokens never returned in production | mail tests (local SMTP), browser, smoke |
| 4 | Critical | Leave counted weekends and holidays; no 7-day limit | working-day calculation and limits | rules and acceptance tests |
| 5 | High | Managers received reports' address and emergency contact (read, list, timeline) | removed for everyone but HR, Super Admin, owner | unit, browser |
| 6 | High | Any document uploader could mark it "visible to manager" | only HR/SA can | integration |
| 7 | High | Managers could read and complete onboarding tasks; employees could complete HR tasks | PRD matrix enforced | acceptance |
| 8 | High | Dashboard returned raw audit values to HR (audit log is Super Admin only) | only actor, action, record, time | acceptance |
| 9 | High | Leave approval, correction review and balance changes had race conditions; balance adjustment could erase the annual allocation | locks, conditional updates, one transaction | concurrency tests |
| 10 | High | Own-contact edit erased the fields not sent | only sent fields change | unit, browser |
| 11 | High | HR could cancel no leave after its start; check-in was blocked on holidays and allowed during approved leave | PRD W5 and LEAVE-007 | integration |
| 12 | Medium | Dashboard errors showed as zero; "absent" ignored working day, holiday and work end | same policy as the attendance view | acceptance |
| 13 | Medium | No in-app notification was ever created | all NOTIF-002 events | acceptance, browser |
| 14 | Medium | Many changes had no audit row; no audit viewer | audited in the same transaction; viewer with filters | acceptance, browser |
| 15 | Medium | Manager scope in leave, documents, dashboard ignored indirect reports | team resolver everywhere | acceptance |
| 16 | Medium | HR saw an error instead of Settings; departments in use could be neither archived nor deleted; department names differing only by case allowed | fixed; migration 8 | acceptance |
| 17 | Medium | Search text and file tokens written to logs; body-limit errors returned 500; uncaught exception exited with code 0 | fixed | unit, smoke |
| 18 | Medium | Unit tests read the developer database named in `.env` | isolated | unit |
| 19 | Low | Web app sent no security headers; a malformed cookie caused a 500; non-Word zip accepted as DOCX | fixed | unit, smoke |
| 20 | Low | Retention job connected with the migration credential and without the TLS settings | runs with runtime configuration only | unit |

### A.2 Missing requirements implemented

Monthly attendance summary (ATT-003), attendance report with CSV (ATT-008, P1), leave month calendar (LEAVE-008),
company-wide onboarding list (ONB-004), audit log viewer (SET-004), colleague directory (EMP-003), own contact editing
and activity timeline on the profile (EMP-008/009), invitation from the profile, designation field and filter,
stale-edit detection and Super-Admin-only fields (W9), production bootstrap (W1), migration 8, the built retention job.

### A.3 Test results

<!-- RESULTS -->

### A.4 Tests that were changed, and why

Existing tests that asserted behaviour contradicting the PRD were updated, none removed: weekend/holiday check-in
(was refused, W5 allows it); manager-visible flag set by an employee (DOC-004 forbids); creating an employee without
a designation (EMP-001 requires it); HR reading company settings (matrix allows view); unknown account id returning
409 (section 5 says 404); employee cancelling own pending leave with a past date (LEAVE-007 allows); correction times
in the future (an attendance time must have happened; same rule the manual correction already had). The health test
and the provisioning test now use only their own database.

### A.5 Security review

| Area | Result |
|---|---|
| Sessions | random 256-bit token, hash stored, 8 h lifetime, revoked on logout, reset, role change, deactivation, offboarding |
| Cookies / CSRF | HttpOnly, Secure and parent domain in production, SameSite=Lax; CSRF double-submit bound to the session |
| CORS | exact https origins; wildcard refused at startup |
| Passwords | scrypt; 10+ on set; generic sign-in error; unknown accounts cost the same time |
| Rate limits | 5 failures per account and IP per 15 minutes, plus per-IP limits (in memory, one instance) |
| Authorisation and tenants | permission checks on every route, row scope on the server, RLS on tenant tables; cross-company tests |
| Uploads | multipart, 10 MB, type allow-list plus content signature, server-chosen keys, 60-second links |
| Errors and logs | no stack traces; credentials, tokens and query strings removed |
| Secrets | scan of tracked and new files found no committed credential (one match is a PowerShell template) |
| Dependencies | `pnpm audit`: 7 findings (2 critical, 1 high, 3 moderate, 1 low) before; **none after** (Vitest 4, patched `effect` and `esbuild` overrides) |
| CSV | formula cells neutralised |

No known critical or high application security defect remains. Known lower-severity items are in section E.

## B. Implemented but not verified against a real external service

| Item | Verified locally by | Action to close |
|---|---|---|
| Supabase Storage driver | mocked REST calls; local driver end to end | create the private bucket, run `verify-document-storage.ts` (Render guide §4) |
| SMTP email | a local SMTP server | configure a provider and domain, send one reset and one invitation |
| Render service and Blueprint | exact build and start commands locally | first Blueprint sync and deploy; check for unknown keys |
| Vercel project | production build locally | create the project; check the build log uses pnpm 10.34.9 |
| TLS to Supabase from the API | configuration tests; an earlier read-only audit | `/api/v1/health/ready` after deploy |
| Cross-subdomain cookies over real TLS | production-mode cookie attributes | sign in on the real domains |
| Migrations on hosted Supabase | PostgreSQL 17.12 scratch rehearsal | follow the migration guide |
| Bootstrap on hosted Supabase | scratch tests | dry run, then execute |

## C. Blocked by missing credentials or infrastructure

| Blocker | Needed from you |
|---|---|
| Custom domain (sign-in cannot work on `vercel.app` + `onrender.com`) | a domain and DNS access |
| Email | SMTP provider account, verified sending domain, credentials entered on Render |
| Storage | permission to create the bucket; service key entered on Render |
| Database | approval to run the migrations and the `REVOKE`; backup plan confirmed |
| Render and Vercel | accounts, a paid single instance, approval to create services |
| Company setup | company name, time zone, hours, first Super Admin, departments, designations, leave allowances, onboarding items |
| Release | review, commit and push of this working tree (Render and Vercel build from GitHub) |

## D. Decisions required from the product owner

| # | Question | Current behaviour |
|---|---|---|
| D1 | AUTH-003 says "8-hour idle timeout". Keep the stricter 8 h from sign-in, or slide with activity (and cap it)? | 8 h from sign-in |
| D2 | Custom sessions instead of Supabase Auth (PRD AUTH-001, §5, §6): accept the deviation formally? | custom sessions, as instructed |
| D3 | May HR deactivate another **HR Admin's** employee record (which disables that login)? Settings forbids HR from disabling HR Admin logins | allowed through the employee status; Super Admin accounts are protected both ways |
| D4 | Leave spanning two calendar years: reject (current) or split across both balances? | rejected with a message |
| D5 | LEAVE-009, NOTIF-003, other report types, feedback and recognition (P1) need business rules | not built |
| D6 | Employee ID: "immutable" (EMP-002) or changeable by Super Admin (W9)? | Super Admin may change it |
| D7 | PRD monochrome design system versus the shipped theme | theme preserved |
| D8 | W1 self-service sign-up versus operator bootstrap with activation link | operator bootstrap |
| D9 | "Date with approved leave blocked" for corrections: also for half-day leave? | any approved leave blocks the request; HR can correct directly |
| D10 | Statuses allowed to check in and apply for leave: is On Notice included? | Active and On Notice |
| D11 | Retention of personal data and legal review before real employee data (A13) | no automatic deletion |

## E. Remaining production blockers and open issues

| # | Severity | Issue | Exact action |
|---|---|---|---|
| E1 | Blocker | Changes are uncommitted; GitHub still has the old code | review the diff, commit, push |
| E2 | Blocker | Hosted database, bucket, email, domain, services do not exist or are unverified | sections B and C |
| E3 | Blocker | No backup and restore rehearsal | confirm the Supabase plan; rehearse one restore |
| E4 | High (data retention) | Retention job not scheduled: deleted files stay in the bucket | create the cron job (Render guide §6) |
| E5 | Medium | Pagination missing on documents (200), correction requests (100), user accounts, templates, holidays; name pickers load 100 employees | add server pagination and a searchable picker before exceeding those numbers |
| E6 | Medium | Rate limits and the login counter are per process | keep one instance, or move them to a shared store before scaling |
| E7 | Medium | Performance targets not measured (p95 < 500 ms, 100 employees) | load test on staging |
| E8 | Medium | No accessibility audit (WCAG 2.1 AA) | run an audit on staging |
| E9 | Medium | No separate staging environment | create one and run the acceptance checklist there |
| E10 | Low | A correct password on a deactivated login answers 400 "Select an active company" instead of the generic error (existing, tested contract) | change to the generic 401 if approved |
| E11 | Low | Unexpected database errors may include values in server logs | add an error serializer that strips query parameters |
| E12 | Low | No script Content-Security-Policy on the web app | add a nonce-based policy |
| E13 | Low | `no-explicit-any` is suppressed, with a note, in modules built on the untyped tenant database layer | type the facade |
| E14 | Low | Parallel queries inside one transaction trigger a `pg` deprecation warning (present before this work); `pg` 9 would break them | run them in sequence before upgrading `pg` |
| E15 | Low | One web lint warning (`top-bar.tsx`, sign-out navigation) | optional |
| E16 | Low | Company switcher in the top bar is a placeholder; the sidebar shows every item to every role (pages themselves refuse access) | hide by permission if wanted |
| E17 | Low | W9 "HR reassigns the approver" has no action; company logo upload and display missing (ORG-001) | build if required |
| E18 | Low | `apps/api/err.txt` and `out.txt` (old run output) are tracked in git | delete in a cleanup commit |
| E19 | Low | Local `.env` had a wrong `SUPABASE_CA_CERT_PATH` in the 2026-11-24 audit | correct it before hosted commands |
