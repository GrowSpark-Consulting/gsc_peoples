# Feature page patterns

Every feature module (Employees, Departments, Attendance, Leave, Onboarding, Documents, Reports,
Settings) is built from the same pieces so screens stay consistent. All of them use the existing
Grow Spark tokens and components; there is no second design system. A live, sample-data demo of
every pattern is at **`/showcase/patterns`** (made-up rows, not company data).

## Page anatomy

```
Top bar            page title = the only <h1>            (components/layout/top-bar.tsx)
PageHeader         description · breadcrumbs · actions   (components/layout/page-header.tsx)
ListToolbar        search · filters · (spacer) · secondary actions · primary action
Table / list       loading | error | empty | no results | data
CursorPagination   Previous / Next
Drawer             record details and forms (480-640px)  Dialog: short decisions
```

- Content sits in `<main>`: 24px padding on desktop, 16px on phones, max 1440px (set by the shell).
- The page title is the top bar's `h1`. `PageHeader` never repeats it, so there is one `h1` per page.
- List pages put the **primary action in the toolbar** (design system section 5). Detail and form
  pages use `PageHeader actions`.
- Breadcrumbs are for nested pages only (`Employees › Ana Krishnan`).

## Building blocks

| Need | Use | File |
|---|---|---|
| Description, breadcrumbs, page actions | `PageHeader` | `components/layout/page-header.tsx` |
| Search + filters + actions row | `ListToolbar`, `FilterSelect` | `components/shared/list-toolbar.tsx` |
| Debounced search (300ms) | `useDebouncedValue` | `hooks/use-debounced-value.ts` |
| Data table, 44px rows, scroll region | `Table`, `TableRow`, ... , `TableSkeleton`, `TableEmpty` | `components/ui/table.tsx` |
| Loading | `TableSkeleton` / `Skeleton` | `components/ui/` |
| Request failed (+ retry) | `ErrorState` | `components/shared/data-states.tsx` |
| Filters matched nothing | `NoResultsState` | same |
| 403 from the API | `AccessDeniedState` | same |
| Nothing exists yet | `EmptyState` (one action) | `components/ui/empty-state.tsx` |
| Cursor paging | `CursorPagination` | `components/ui/pagination.tsx` |
| Record details / forms | `Drawer` | `components/ui/drawer.tsx` |
| Short decision / confirm | `Dialog` | `components/ui/dialog.tsx` |
| Form fields | `Field`, `SelectField` | `components/ui/field.tsx`, `select.tsx` |
| Field groups, form-level error | `FormSection`, `FormError` | `components/shared/form-layout.tsx` |
| Status | `Badge` (word + dot, never colour alone) | `components/ui/badge.tsx` |

## State rules

1. **Loading**: skeleton rows in the same table (no layout jump).
2. **Error**: `ErrorState` with a retry. Never show sample data when a request fails.
3. **Empty** (nothing exists): `EmptyState` that explains the page and offers one action.
4. **No results** (filters/search active): `NoResultsState` with *Clear filters*.
5. **403**: `AccessDeniedState`. **404** on a record: "not found or no access" (the API does not say which).
6. **Forms**: field errors under the field (`Field error=...`), a `FormError` for everything else
   (server, 403, network). Submit buttons show `loading` and are disabled while saving.
7. **Permissions** hide controls for clarity only. The API is the authority and re-checks every call.

## Cursor pagination

Cursors are opaque and the sort order is fixed by the API, so there are no page numbers and no
sort controls. Keep a stack of cursors in component state: *Next* pushes the response's
`nextCursor`, *Previous* pops. Reset the stack whenever search or filters change. Do not persist the
cursor in the URL (the stack would be lost); persist filters instead.

## Modals (Drawer, Dialog)

Both use `hooks/use-modal-behavior.ts`: Escape closes only the top-most surface, Tab is trapped,
body scroll is locked until the last one closes, focus moves in on open and returns to the opener.
A `Dialog` stacks above a `Drawer`. The mobile navigation overlay predates this hook and has its
own equivalent logic; migrate it when convenient.

## Testing notes

- Component tests opt in to jsdom with `// @vitest-environment jsdom` (see `vitest.setup.ts`).
- **Windows:** run Vitest from a shell whose working directory uses an **uppercase drive letter**
  (`C:\Users\...`). With a lowercase `c:/...` path the test file and `src` load different copies of
  React and any component using `useId` fails with "Invalid hook call". `resolve.dedupe` does not fix it.
- `e2e/ui-patterns.spec.ts` exercises the patterns in a real browser (layout at 1440/1280/1024/820/390,
  keyboard, focus trap, drawer width, dark theme).
