# Production acceptance checklist

Run only after: migrations applied, bootstrap run, both services deployed, domains live [all APPROVAL, none done]. All data below is **test data created for this run and deleted afterwards** (use names like `ZZ Test …`). Roles: SA = Super Admin, HR = HR Admin, MGR = Manager, EMP = Employee. Create the HR/MGR/EMP test users through the SA's employee-invite flow.

## 0. Security configuration expectations (verify first)

| Item | Expected | Source |
|---|---|---|
| Session cookie `gsc_session` | `HttpOnly; Secure; SameSite=Lax; Path=/; Domain=.<domain>; Max-Age=28800` | `auth.routes.ts` |
| CSRF cookie `gsc_csrf` | `Secure; SameSite=Lax; Domain=.<domain>`, JS-readable (double-submit) | same |
| Mutating request without `x-csrf-token` or with a mismatching one | `403 CSRF validation failed` | `middleware/auth/csrf.ts` |
| CORS | only `https://app.<domain>`, credentials true; `OPTIONS` from another origin gets no ACAO | verified locally |
| Session lifetime | 8 h absolute; expired/revoked → 401 | `session-provider.ts` |
| Login throttling | 5 failures / 15 min per `ip:email`, in-process, 1 instance; `req.ip` is the real client (trust proxy = 1) | `auth.routes.ts`, `app.ts` |
| RLS / tenant | role and company come from the validated membership, never client input | `resolve-tenant`, RLS policies |

## 1. Matrix

| # | Area | Test data / steps | Expected |
|---|---|---|---|
| 1 | API health | `GET https://api.<domain>/api/v1/health` | 200, `status:"ok"`, `dependencies.database:"up"`, `redis:"not_configured"`; no URLs/secrets in body |
| 2 | Frontend health | `GET https://app.<domain>/api/health`; open `/` signed out | 200 `{status:ok}`; `/` redirects to `/login` |
| 3 | Login / logout | SA logs in; wrong password; logout | success sets 2 cookies; wrong password 401 `Invalid email or password`; 6th failure in 15 min 401 throttled; logout 204, cookies cleared, session row revoked, back button → login |
| 4 | Session refresh | Reload deep link `/employees` while signed in; wait or revoke session in DB; reload | signed in: page loads (proxy validates via `/me`); revoked/expired: redirect to `/login?next=/employees` and cookies cleared |
| 5 | SA permissions | SA opens all modules, settings, creates HR user | all allowed; cannot demote/disable the last SA |
| 6 | HR permissions | HR creates employee, views all, tries SA-only settings | employee ops allowed; SA-only actions 403 |
| 7 | MGR permissions | MGR lists employees; opens a non-report's record; approves report's leave | sees only own team per role rules; non-report 403/404; report's leave approvable |
| 8 | EMP permissions | EMP opens own profile, tries `/employees`, `PATCH` another employee | own data only; others 403 |
| 9 | Cross-tenant | Create scratch second company via SQL as `hr_migrator` with one user; sign in as each | each sees only its own rows; direct API ids from the other company 404; SQL as `hr_app` with no `app.company_id` returns 0 rows |
| 10 | Employees | Create `ZZ Test Employee` (valid email, joining date today, department), edit phone, change status | 201 with generated code; edit persists; status change audited; duplicate email 409/validation error |
| 11 | Attendance | EMP marks check-in/out; HR views report | record stored in company timezone; second check-in same day handled per rule; HR sees it |
| 12 | Leave | EMP applies 1 day Casual; MGR approves; balance checked; EMP applies > balance | approval changes balance and status; over-balance rejected; notification created |
| 13 | Documents | EMP uploads 200 KB PDF, then 5 MB PDF; download; restart the API; download again; MGR/HR access per visibility | **5 MB currently fails (1 MB JSON limit, B3)**; after fix: upload OK, download OK, **file still present after restart/redeploy** (requires disk or object storage), unauthorised users 403, disallowed MIME rejected |
| 14 | Onboarding | HR creates onboarding for the ZZ employee from template | tasks created with due dates and assignees; completing a task updates progress; template edits don't alter existing checklist |
| 15 | Reports | Open reports/dashboard as SA, HR, EMP | numbers match test data; EMP sees no company-wide data |
| 16 | Audit logs | After tests 10, 12, 13 | one audit row per action with actor, entity, time; no password/token values in `newValue` |
| 17 | Notifications | After test 12 | MGR notified of request, EMP of decision; mark-read works; users only see their own |
| 18 | Responsive | 1440×900, 820×1180, 390×844 on login, dashboard, employees, leave | no horizontal scroll, navigation usable, forms operable, no clipped controls |
| 19 | Error handling | Stop-gap cases: invalid JSON, unknown route, 401 on expired session, 403, 404, forced 500 | JSON error body with `code`, `message`, `requestId`; production 500 says only `Internal server error`; UI shows an error state, not a blank page |
| 20 | Database outage | In a maintenance window, temporarily make the DB unreachable (e.g. wrong `SUPABASE_DATABASE_URL` on a throwaway copy, not production data) | `/health` stays 200 with `database:"down"`; authenticated calls return 5xx JSON without leaking the DB error; web shows 503/unavailable page; service recovers without restart once the DB is back (pool reconnects) |

## 2. Exit criteria

All rows pass, test data removed (delete ZZ employees/users, revoke sessions), `_prisma_migrations` unchanged, no secrets visible in Render logs, bundle scan for `postgresql://`/`SUPABASE` still empty, Render/Vercel logs reviewed for errors.

## 3. Local results so far (2026-11-24, not a substitute for the hosted run)

API typecheck pass; API unit/API tests 139 + 5 new env tests pass; web typecheck pass; web tests 170 pass; production web build pass; API bundle build pass; production-mode API smoke test (health, CORS, 401, 400) pass. **Not run:** API integration tests against a database (need a local `hr_test`), Playwright e2e, any hosted check.
