'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { z } from 'zod';
import { PageHeader } from '@/components/layout/page-header';
import { AccessDeniedState, ErrorState } from '@/components/shared/data-states';
import { Skeleton } from '@/components/ui/skeleton';
import { EmployeeDirectory } from './components/employee-directory';
import { EmployeeForm } from './components/employee-form';
import { EmployeeProfile } from './components/employee-profile';
import { describeError, isApiError } from './errors';
import { filtersFromSearchParams, filtersToSearchParams, type DirectoryFilters } from './filters';
import { useEmployee } from './hooks/use-employees';
import { useEmployeesContext } from './state/employees-context';

/** How long after a link click a pending (debounced) filter update is dropped. */
const LINK_CLICK_GRACE_MS = 2000;

/** `?view=<id>` selects the employee shown in the profile drawer. Anything but a UUID is ignored. */
const parseView = (raw: string | null): string | null =>
  raw && z.uuid().safeParse(raw).success ? raw : null;

/**
 * /employees: filters (q, status, type, dept, manager, managerName) and the open profile drawer
 * (view) live in the URL, so a filtered view or an open profile can be reloaded, shared and returned to.
 */
export function EmployeesDirectoryPage() {
  const pathname = usePathname();
  const search = useSearchParams();
  const filters = useMemo(
    () => filtersFromSearchParams(new URLSearchParams(search.toString())),
    [search],
  );
  const viewId = useMemo(() => parseView(search.get('view')), [search]);

  // A debounced search can fire after the user has already clicked a profile link but before that
  // navigation has committed. Writing the URL then would supersede the navigation and leave them on
  // the list, so remember real navigations and drop any filter update that arrives right after one.
  // Clicks that were handled in-page (opening the drawer) are default-prevented and do not count.
  const lastLinkClick = useRef(0);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      if ((e.target as Element | null)?.closest?.('a[href]')) lastLinkClick.current = Date.now();
    };
    document.addEventListener('click', onClick); // bubble phase: runs after React's handlers
    return () => document.removeEventListener('click', onClick);
  }, []);

  // history.replaceState (integrated with useSearchParams by Next) updates the URL without starting
  // a competing navigation and without a server round-trip per keystroke.
  const writeUrl = useCallback(
    (next: DirectoryFilters, view: string | null) => {
      if (window.location.pathname !== pathname) return; // a navigation already committed
      const sp = filtersToSearchParams(next);
      if (view) sp.set('view', view);
      const qs = sp.toString();
      window.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname],
  );

  const onFiltersChange = useCallback(
    (next: DirectoryFilters) => {
      if (Date.now() - lastLinkClick.current < LINK_CLICK_GRACE_MS) return;
      // keep the drawer as it is (read from the live URL: this can run from a debounce timer)
      writeUrl(next, parseView(new URLSearchParams(window.location.search).get('view')));
    },
    [writeUrl],
  );
  const onViewChange = useCallback((id: string | null) => writeUrl(filters, id), [writeUrl, filters]);

  return (
    <EmployeeDirectory
      filters={filters}
      onFiltersChange={onFiltersChange}
      viewId={viewId}
      onViewChange={onViewChange}
    />
  );
}

function FormCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-5 shadow-sm sm:p-6">{children}</div>
  );
}

/** /employees/new (HR Admin only; the server enforces this independently). */
export function NewEmployeePage() {
  const router = useRouter();
  const { caps } = useEmployeesContext();
  if (!caps.canCreate) return <AccessDeniedState message="Only HR Admins can add employees." />;
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Employees', href: '/employees' }, { label: 'Add employee' }]}
      />
      <FormCard>
        <EmployeeForm
          mode="create"
          onSaved={(e) => router.push(`/employees/${e.id}`)}
          onCancel={() => router.push('/employees')}
        />
      </FormCard>
    </>
  );
}

/** /employees/[id]/edit (HR Admin only). */
export function EditEmployeePage({ id }: { id: string }) {
  const { caps } = useEmployeesContext();
  // Guard first: callers who cannot edit never trigger a fetch of the record.
  if (!caps.canEdit) return <AccessDeniedState message="Only HR Admins can edit employees." />;
  return <EditEmployeeLoader id={id} />;
}

function EditEmployeeLoader({ id }: { id: string }) {
  const router = useRouter();
  const query = useEmployee(id);
  if (query.status === 'loading' || query.status === 'idle')
    return <Skeleton className="h-96 w-full" />;
  if (query.status === 'error') {
    return isApiError(query.error) && query.error.status === 403 ? (
      <AccessDeniedState />
    ) : (
      <ErrorState
        title="Could not load this employee."
        message={describeError(query.error)}
        onRetry={query.reload}
      />
    );
  }
  const employee = query.data!;
  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: 'Employees', href: '/employees' },
          { label: `${employee.firstName} ${employee.lastName}`, href: `/employees/${id}` },
          { label: 'Edit' },
        ]}
      />
      <FormCard>
        <EmployeeForm
          mode="edit"
          employee={employee}
          onSaved={() => router.push(`/employees/${id}`)}
          onCancel={() => router.push(`/employees/${id}`)}
        />
      </FormCard>
    </>
  );
}

export function EmployeeProfilePage({ id }: { id: string }) {
  return <EmployeeProfile id={id} />;
}
