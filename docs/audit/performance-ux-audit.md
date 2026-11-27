# GSC Peoples — Performance & UX Audit

**Audit Date:** 2026-11-27
**Scope:** Performance audit of the web app (Next.js 16) and API (Express 5 + Prisma + Supabase PostgreSQL), a shared loading system, Settings-page action feedback, and verification by tests, a production build and local measurements.
**Status:** Implemented and verified **locally only**. Not deployed, not verified in production, and **not a production-readiness sign-off**. No migrations were run and no production data, configuration or environment variables were changed.

---

## 1. Executive Summary

- **The biggest bottleneck was in the API, not the browser.** Every signed-in request hashed the session cookie with scrypt (a deliberately slow password hash, ~100 ms of CPU per call). Writes did it three times. Node.js runs at most four of these at once, so a page's parallel requests queued behind each other.
- **Fixed without changing security behaviour.** Token hashes are now cached briefly. The per-request session write is throttled to once a minute. Two identity lookups became one query. The CSRF check reuses the session row it already has. Revocation, expiry and CSRF are still enforced on every request, and this was checked.
- **Frontend:** one shared `/me` request per tab (was 2–3 per page). Fonts are self-hosted (no render-blocking Google Fonts stylesheet). Page-shaped skeletons are used on 13 routes. The Settings page now has proper busy, error and double-submit handling.
- **Local results:** signed-in API requests went from about 56 ms to about 16 ms, and writes from 112 ms to 17 ms, before any network delay. First Contentful Paint (FCP) fell from about 350–560 ms to about 125–210 ms on a local production build. **These are local numbers, not production numbers** (see §5 and §8).
- **All suites pass:** typecheck, lint, API and web unit tests, API integration tests, Playwright, and the production build.

---

## 2. What the Audit Found

| # | Finding | Evidence |
|---|---|---|
| 1 | **scrypt on every authenticated request.** Session and CSRF cookies were re-hashed with scrypt on each call: once for reads, three times for writes. | scrypt measured at ~100 ms per call on the audit machine. Node's libuv pool runs 4 at a time. |
| 2 | **A database write on every request** to update the session's last-activity time. | `SessionAuthProvider.verifyToken` updated the row unconditionally. |
| 3 | **Two sequential identity queries per request** (the user, then the membership). | `resolveActiveMembership`. |
| 4 | **The CSRF check re-read the session row** that authentication had just loaded. | `requireCsrf`. |
| 5 | **Cross-region database round trips.** Vercel serves from Mumbai, the API runs in Render Singapore, and the database is in Supabase Mumbai. Every query from the API crosses Singapore↔Mumbai, so the **number of sequential queries per request** dominates latency. | Response headers; `render.yaml` region comment. |
| 6 | **API cold start: 38.8 s** on one request (the API reported 20 s of uptime). Warm health check: about 0.4–0.55 s from the audit location. | `curl` timing against the public health endpoint. |
| 7 | **Duplicate `/me` requests:** 2–3 per page load from four independent callers (shell, top bar, company settings, employees provider). | Local measurement: 2 on Dashboard, Departments and Settings. Attendance, Leave and Employees add one more by code. |
| 8 | **Render-blocking web fonts** from `fonts.googleapis.com`. | Root layout. |
| 9 | **Settings page:** raw `fetch` calls, no busy state, no double-submit protection, and a failed user-list request showed "No user accounts." instead of an error. | Code review. |
| 10 | **Database indexes are adequate.** The existing composite indexes cover the tenant-scoped access patterns. | Prisma schema review. No new indexes and no migration were needed. |
| 11 | **Bundle:** initial JavaScript is about 222–268 KB gzip per route, mostly React DOM (~70 KB), the Next.js runtime (~80 KB) and zod (~38 KB). There are no chart or editor libraries. | Analysis of the production chunks. Lazy-loading would not remove anything significant. |

---

## 3. Backend Authentication Optimizations

All changes are in the per-request authentication path. API contracts, permissions and tenant isolation are unchanged.

| Change | Location | Security notes |
|---|---|---|
| **Token-hash cache.** `cachedTokenHashAsync` memoises the scrypt result for session and CSRF cookies: 15-minute lifetime, at most 5,000 entries, failed hashes not cached. | `apps/api/src/modules/auth/password.ts` | Keyed by a SHA-256 of the token, never the raw token. The stored hash format is unchanged, so no session was invalidated. **The session row is still read on every request**, so revocation, expiry and idle timeout take effect immediately. |
| **Throttled activity write.** The session's last-activity time is written at most once per 60 s per session. | `apps/api/src/integrations/local-auth/session-provider.ts` | With the 8-hour idle timeout, an idle session can now end up to one minute **earlier**, never later. |
| **One identity query instead of two.** User and membership are resolved in a single joined query with the same ACTIVE-user and ACTIVE-membership conditions. | `apps/api/src/database/identity.ts` | Same fail-closed behaviour: no match returns `null`, which returns 403. |
| **CSRF reuses the validated session row.** Authentication passes the row's CSRF hash to the CSRF middleware through a server-only request field. It is never added to `req.identity` and never serialised. | `middleware/auth/authenticate.ts`, `middleware/auth/csrf.ts`, `shared/types/express.d.ts` | The header/cookie match and the hash comparison are unchanged. If the row isn't available, the middleware falls back to the original database check. |

**Security checks against the local API:**
- An active session returned 200. After it was revoked in the local database, the next GET and PATCH returned **401** straight away.
- A valid session with a wrong CSRF token returned **403**.

**New unit tests:** `apps/api/src/middleware/auth/auth-performance.test.ts` (7 tests). They cover cache correctness and expiry, the write throttle, rejection of revoked sessions, and CSRF accept/reject without a second database read.

---

## 4. Frontend Loading, Navigation and Settings Improvements

### 4.1 Data fetching
- **One shared `/me` per browser tab** (`apps/web/src/hooks/use-session.ts`), used by the shell, the top bar, page gates, company settings and the employees provider. The cache lives only in that tab's memory: it is reset on sign-in, invitation acceptance and sign-out, a full reload starts empty, and failures are not cached.
- **No loading flash after the first page:** later pages render immediately from the session the tab already has.
- **Unchanged API failure handling:** a 401 from `/me` sends the user to sign-in.

### 4.2 Fonts
- Same families and weights (Inter 400/500/600, JetBrains Mono 400/500), now self-hosted with `next/font`: latin subset, metric-matched fallback, and mono not preloaded.
- The design tokens are pointed at the self-hosted faces in `app/layout.tsx`, and `globals.css` is unchanged.

### 4.3 Loading system
| Piece | Location | Notes |
|---|---|---|
| Page skeletons (`dashboard`, `directory`, `sections`, `tabs`, `profile`, `form`, `reports`) | `apps/web/src/components/shared/page-skeletons.tsx` | Same grids, card surfaces, 40 px table header and 44 px rows as the real pages. Colours come from theme tokens. The pulse stops under prefers-reduced-motion. |
| Route `loading.tsx` on 13 routes | `apps/web/src/app/(dashboard)/…/loading.tsx` | dashboard, employees, employees/[id], employees/new, employees/[id]/edit, attendance, leave, departments, documents, reports, settings, profile, onboarding. The shell and navigation stay mounted. |
| Session-wait skeleton = route skeleton | `modules/shared/page-state.tsx` (`SessionGate skeleton=…`), `modules/employees/state/session-providers.tsx` | The user sees one continuous placeholder, not two different ones. |
| Component skeletons | Dashboard KPI groups and leave balances (`QueryBoundary fallback`), Settings user table (skeleton rows) | One component loading does not block the rest of the page. |
| Initial app loader | `apps/web/src/app/loading.tsx`, `components/shared/app-loader.tsx` | "GSC Peoples" brand mark. Shown only when entering the app (e.g. after sign-in). It **did not appear** during in-app navigation in testing. |
| Fixed-size loading buttons | `components/ui/button.tsx` (`loadingText`) | Idle and busy labels share one grid cell, so the button keeps the same size. Measured 121.9 × 36 px in both states. The inactive label is hidden from screen readers. |

### 4.4 Settings page (`apps/web/src/app/(dashboard)/settings/page.tsx`)
- **Requests:** all go through the shared `apiRequest`, which handles CSRF, 401 redirects and readable error messages.
- **Busy labels:** "Saving...", "Sending invitation...", "Activating..." / "Deactivating...", "Sending...".
- **Double submits:** blocked. In a browser test, three rapid clicks sent **one** request.
- **Success:** shown only after the API confirms. On failure the error is shown and the controls are restored.
- **Role dropdown:** a rejected role change puts the dropdown back to the previous role.
- **Load states:** company settings and the user list now show a skeleton, an error with a retry button, or access denied. The list no longer silently shows "No user accounts." when the request fails.
- **Copy:** marketing copy and success messages are unchanged.

### 4.5 Other
- **Sign out:** shows a spinner and ignores repeat clicks.
- **Auth pages:** login, forgot password, reset password and accept invitation already had busy states.

**New unit tests:** `apps/web/src/hooks/use-session.test.tsx` (4 tests): one `/me` for many consumers, instant render on later pages, no caching of failures, and the `loadingText` button's accessibility and click blocking.

---

## 5. Before/After Measurements — LOCAL ONLY

> **These are local measurements, not production performance.** The API and database ran on the audit machine (no network delay). The web app ran as a local production build (`next build` + `next start`) in desktop Chrome at 1440×900. The "before" build is the session-start commit `b267b4e`, built in a separate worktree. Absolute numbers will be higher in production because of the Vercel → Render → Supabase network path. The relative improvements are the useful signal.

### 5.1 API (local, median of 10 warm requests)

| Request | Before | After |
|---|---|---|
| Authenticated GET (e.g. departments, settings users) | 56–57 ms | 15–16 ms |
| `GET /me` | 60 ms | 35 ms |
| Write through the CSRF path | 112 ms | 17 ms |
| Burst of 6 parallel requests (as the old dashboard issued) | 142 ms | 57 ms |

In production, each removed query **also** saves one Singapore↔Mumbai round trip. That saving is **not measured** here.

### 5.2 Web (local production build, warm, 2 runs each)

| Page | FCP | LCP | Time until loaders cleared | `/me` per page load |
|---|---|---|---|---|
| Dashboard | 372–392 → 136–172 ms | 592–640 → 352–404 ms | 1279–1353 → 1001–1051 ms | 2 → 1 |
| Departments | 360–400 → 124–136 ms | 528–700 → 288–316 ms | 1267–1506 → 967–1022 ms | 2 → 1 |
| Settings | 352–560 → 144–208 ms | 584–960 → 376–560 ms | 1332–1987 → 1033–1423 ms | 2 → 1 |

- **CLS** (layout shift) was at most 0.009 before and at most 0.002 after (target < 0.1).
- **In-app navigation** took about 100–200 ms after the change, with no extra `/me` call and no full-screen loader. One first-visit navigation to Settings took about 2.0 s (likely a cold first request); the repeat run took 122 ms.
- **Not measured:** INP, and any authenticated production endpoint.
- **Caveat:** the local database is behind on migrations (§9), so some dashboard API calls returned errors locally. The web figures reflect page rendering and request patterns, not complete dashboard data.

---

## 6. Test and Build Results

All runs were local, on 2026-11-27, against the working tree **before** commit `d829584` (see §9).

| Check | Result |
|---|---|
| TypeScript (API and web) | **PASS** |
| ESLint (API and web) | **PASS** (0 errors) |
| API unit tests | **PASS**: 27 files, 261 tests (254 existing + 7 new) |
| API integration tests (disposable local test database) | **PASS**: 20 files, 381 passed, 1 todo |
| Web unit tests | **PASS**: 33 files, 306 tests (302 existing + 4 new) |
| Playwright e2e (demo-mode suite, system Chrome) | **PASS**: 83 passed, 1 skipped, 0 failed |
| Web production build (`next build`) | **PASS**: all app pages prerendered as static |
| Responsive and theme check of skeletons | **PASS**: 7 viewports (320×568 to 1920×1080) × light/dark × 7 routes. Skeleton present, theme applied, pulse stopped under reduced motion. No horizontal scroll on 12 routes at 320/375/430 px (after a 320 px fix, see §9). |
| Settings save flow (browser test, request intercepted, no data changed) | **PASS**: 1 request for 3 clicks, button disabled with the busy label, same size, error shown on failure, button restored, no false success |

**One existing test changed:** `apps/web/src/components/layout/top-bar.test.tsx` assumed each component made its own `/me` request, which is exactly the duplication that was removed. It now resets the shared cache between scenarios, as sign-in and sign-out do in the app. No assertion was weakened.

---

## 7. Remaining Bottlenecks and Recommended Next Steps

| Priority | Item | Recommendation |
|---|---|---|
| High | **API cold start (~39 s observed).** `render.yaml` describes a paid "starter" plan that never sleeps, yet the service had just started when measured. | Check the actual plan and instance behaviour in the Render dashboard. Consider an external uptime ping if the plan can sleep. |
| High | **Verify in production after a deploy** that someone approves. | Measure warm latency for `/me`, `/dashboard/hr`, `/employees` and one write, and Core Web Vitals on the main pages, keeping cold and warm requests separate (§8). |
| Medium | **Transaction overhead per tenant query.** Each tenant-scoped call opens a transaction to set the tenant for row-level security (BEGIN + set_config + COMMIT), about 3 extra round trips across regions. | Needs a design review (e.g. batching per request, or a different RLS context strategy). Do not change it without a security review. |
| Medium | **The proxy calls `/me` on Render for every page request, including link prefetches.** | It's a navigation-only gate, and prefetched pages contain no private data. Options such as skipping the API check for prefetch requests need a security sign-off. Left unchanged. |
| Medium | **Hosting regions.** API in Singapore, database in Mumbai. | If Render or another host offers a Mumbai region, co-locating with the database would cut the per-query delay. |
| Low | **zod in every route's initial JS (~38 KB gzip).** | Possible later: lighter validation on the auth pages. Low priority. |
| Low | **Local `hr_db` is behind on migrations.** | Bring it up to date via the documented local setup (`docs/development/database-local.md`) so local dashboard measurements are complete. **This was not done here.** |

---

## 8. Production Verification Limitations

- **No production deployment was made or verified.** Nothing in this document confirms production behaviour or readiness.
- **No signed-in production measurements were taken.** No production login was used. The only production checks were unauthenticated: the public health endpoint, the login page, an unauthenticated `/me` (401), and the redirect from a protected page.
- **The production numbers in §2 are single unauthenticated samples** from one location. They include network distance from the audit location and are context only, not benchmarks.
- **Production effects are inferred, not measured.** The expected production gain from fewer queries per request follows from the architecture: fewer cross-region round trips and no scrypt queueing.
- **No production migrations, data changes, environment-variable changes or Render/Vercel configuration changes were made.**

---

## 9. Git / Working-Tree Coordination Notes

The audit ran while other work was being committed to `main` in the same working tree. Reviewers should know:

- **`1bc7050` and `f02b376` ("ui fix") contain overlapping work.** They were committed while this audit was in progress and include most of the audit's backend and frontend changes, mixed with concurrent UI changes from other work (e.g. auth pages, stat card, list toolbar, sidebar, `globals.css`). The audit's changes are not isolated in their own commit.
- **`f02b376` also picked up a temporary measurement script,** `apps/web/vitals-tmp.mjs`, which was never meant to be committed.
- **These two items were pending at the end of the audit and are now committed in `d829584`:**
  - the 320 px overflow fix in `apps/web/src/components/shared/page-skeletons.tsx` (`min-w-0` on grid items), and
  - the **deletion** of `apps/web/vitals-tmp.mjs`.
- **Keep the employee identity-document work separate.** `d829584` also contains an **unrelated** feature: the identity-document schema, a new migration (`…_employee_identity_documents`), API routes, storage, retention, and contracts and permissions changes. **That work is not part of this audit.** It was not authored, reviewed or tested here. The test results in §6 were collected **before** it was committed and do not cover it. It needs its own review, test run and migration approval.
- **The audit made no commits, pushes, deployments or migrations.** The local `hr_db` was **not** migrated.
- **Local cleanup:** two short-lived measurement sessions were created in the local development database and both were revoked. No production sessions or data were involved.

### Suggested reviewer actions
1. Review the audit's changes in `1bc7050`, `f02b376` and `d829584` using the file lists in §3 and §4.
2. Re-run the full suite on current `main`, since `d829584` came after §6.
3. Review the identity-document feature and its migration separately before any deploy.
