# Employee Directory (web)

Routes: `/employees` (directory + profile drawer), `/employees/new`, `/employees/[id]` (full profile page,
deep-linkable), `/employees/[id]/edit`.
Code: `apps/web/src/modules/employees/`. Built on the shared patterns in `ui-patterns.md`
(PageHeader, ListToolbar/FilterSelect/FilterMultiSelect, CursorPagination, Drawer, data-states, form-layout).

## What is real and what is demo

| Piece                                                | Status                                                                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| UI, validation, permission-aware controls            | Real code, covered by unit and browser tests                                                                        |
| Contracts (`@gsc/contracts`) and permission registry | Real, shared with the API                                                                                           |
| `apps/api` employee/department endpoints             | Real, covered by unit tests **and by integration tests against local PostgreSQL** (`hr_test`), see below            |
| `adapters/demo/*` (in-memory data, personas)         | **DEMO ONLY**: fictional people, resets on reload, no database                                                      |
| `adapters/http-service.ts`                           | Real adapter, **only verified with a fake `fetch`**; never run browser-to-API (no token source, see blockers)       |
| Authentication / "who am I"                          | **Does not exist yet**. The demo "View as" select stands in for it                                                  |

Demo mode is the default **for local development only** (`NODE_ENV` other than `production`). A **production build
shows the "Live API mode is not available yet" notice** unless `NEXT_PUBLIC_EMPLOYEES_ADAPTER` is set explicitly, so
fictional people are never shown to real users by accident. A banner marks demo mode on every employee page.
`NEXT_PUBLIC_EMPLOYEES_ADAPTER=http` shows the same notice instead of falling back to demo data:
a failed or unavailable live request never displays demo records.

## Interactions

- **Search** (name, employee number, work email; every word must match) is debounced and kept in the URL (`q`).
- **Filters**: Status and Employment type are **multi-select** (any of the ticked values; URL `status=ACTIVE,ON_LEAVE`,
  `type=CONTRACT,INTERN`), Department and Manager are HR-only (`dept`, `manager`+`managerName`). Malformed values in the
  URL (unknown enum values, non-UUID ids) are ignored, never sent to the API.
- **Pagination** is cursor-based (Previous/Next). Any filter change resets to page 1; the cursor itself is not in the URL.
- **Profile drawer**: a plain click (or Enter) on a name opens the shared right-side drawer and puts `?view=<id>` in the
  URL (reloadable and shareable). Ctrl/Cmd/Shift-click and "open in new tab" use the real link to the full profile page.
  A status change made in the drawer refreshes the list behind it.
- **Create / edit** are separate pages (HR Admin only). Status changes are a separate form, never part of the edit form.
- **Manager choice** only offers employees who are still employed (ONBOARDING, ACTIVE, ON_LEAVE). The API enforces the
  same rule (a TERMINATED employee cannot be assigned as manager: 400).

## Permission rules in the UI

| Role     | Sees                                          | Can                                                 |
| -------- | --------------------------------------------- | --------------------------------------------------- |
| HR Admin | all employees, department and manager filters | add, edit, assign department/manager, change status |
| Manager  | direct reports + own profile                  | read only                                           |
| Employee | own profile                                   | read only                                           |

The UI only hides controls. The API re-checks every request; out-of-scope records come back as 404 so their
existence is not revealed (the profile shows "Employee not found").

## Pagination totals (limitation, by design)

`GET /employees` returns `{ data, page: { limit, nextCursor } }` and **no total count**. A total would need a second
`COUNT(*)` per request (scoped and filtered the same way), which is the expensive part of offset pagination and
is not needed for Previous/Next. The UI therefore shows "Page N · M employees" for the current page only, and cannot offer
"jump to page" or "1-25 of 142". If a total becomes a requirement, add an explicit opt-in (for example
`?includeTotal=true`) to the contract rather than computing it on every request.

## Audit / history: review against the requirement

The API writes an append-only `employee_audit_logs` row, in the same transaction as the change, for: create, field
updates, department change, manager change and status change (actor, company, action, `{field: {from, to}}`).
The runtime database role cannot UPDATE, DELETE or TRUNCATE it (verified against PostgreSQL).

Gaps relative to "show an employee's history":

1. **No read endpoint**, so the UI shows no history. A `GET /employees/:id/history` (permissioned, tenant-scoped,
   cursor-paginated) is the missing piece; its permission name is not in the approved registry, so it needs a decision.
2. **Department and manager are stored as ids**, not names. A history view must resolve names at read time.
3. **No source repository for "who is allowed to read audit"** is defined (HR Admin only is the natural default).
4. **No PRD is in the repository**, so this review is against the approved task text only. Confirm retention and
   which events beyond the five above must be audited (for example reads of sensitive fields) before building the endpoint.

## Blockers before this can run against the real API

1. **Who-am-I endpoint.** The web app needs the caller's permissions and own `employeeId`
   (for example `GET /api/v1/me`). The API has no such endpoint; `req.user` exists only server-side.
2. **Token source.** The HTTP adapter needs a bearer token from Central Authentication (contract unknown).
3. **Manager picker.** There is no manager-options endpoint; the picker searches `GET /employees?q=`.
   That works for HR Admins (company-wide read); a dedicated endpoint would be cleaner.
4. **Provisioning.** Nothing creates users, memberships, roles or role permissions in `hr_db`; without them every
   feature route answers 403. Test data exists only in `hr_test` (see `database-local.md`).

## Known limitations

- No total count and no jump-to-page (above).
- No history view (above).
- The drawer replaces the URL (`replaceState`), so the browser Back button leaves the directory instead of closing it.
- The suggestion list of the manager combobox is empty while a new search is loading ("Searching…").

## Tests

- `apps/web`: `pnpm exec vitest run` (from a shell whose cwd uses an UPPERCASE drive letter, `C:\...`):
  adapters, permissions, filters/URL, directory, drawer, form, profile and route guards.
- `apps/web/e2e/employees.spec.ts` (Playwright, demo mode, no API or database): all five widths, three personas,
  search/filters/pagination/URL, drawer, create/edit/status, keyboard and accessibility. Run against `next dev`.
- `apps/api`: `vitest run` (unit, fake database) and `vitest run --config vitest.integration.config.ts`
  (real PostgreSQL `hr_test`, see `database-local.md`).
