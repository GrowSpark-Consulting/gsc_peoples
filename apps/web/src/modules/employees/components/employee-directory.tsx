'use client';

import { Plus, UserX, Users } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { ErrorState, NoResultsState } from '@/components/shared/data-states';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { CursorPagination } from '@/components/ui/pagination';
import { describeError } from '../errors';
import { EMPTY_FILTERS, hasActiveFilters, toListQuery, type DirectoryFilters } from '../filters';
import { useEmployeeList } from '../hooks/use-employees';
import { scopeLabel } from '../permissions';
import { useEmployeesContext } from '../state/employees-context';
import { DirectoryFiltersBar } from './directory-filters';
import { EmployeeProfileDrawer } from './employee-profile-drawer';
import { CompanyDirectory } from './record-sections';
import { EmployeeCards, EmployeeTable } from './employee-table';

export interface EmployeeDirectoryProps {
  filters: DirectoryFilters;
  onFiltersChange: (next: DirectoryFilters) => void;
  /** Page size. */
  limit?: number;
  searchDebounceMs?: number;
  /**
   * Employee shown in the profile drawer (null = closed). Controlled so the page can keep it in the
   * URL (`?view=<id>`); when omitted the directory manages the drawer itself.
   */
  viewId?: string | null;
  onViewChange?: (id: string | null) => void;
}

/**
 * Employee directory: search, filters, and cursor pagination over a stable order
 * (last name, first name, id). Filters are controlled so the page can keep them in the URL.
 * A plain click on a name opens the profile in the shared right-side drawer.
 */
export function EmployeeDirectory({
  filters,
  onFiltersChange,
  limit = 25,
  searchDebounceMs,
  viewId,
  onViewChange,
}: EmployeeDirectoryProps) {
  const { caps, service } = useEmployeesContext();
  const [localView, setLocalView] = useState<string | null>(null);
  const view = viewId !== undefined ? viewId : localView;
  const setView = onViewChange ?? setLocalView;
  // Bumped after a status change in the drawer so the list behind it shows the new status.
  const [refresh, setRefresh] = useState(0);
  return (
    <section aria-label="Employee directory" className="flex flex-col">
      <PageHeader description={scopeLabel(caps)} />

      <DirectoryFiltersBar
        value={filters}
        onChange={onFiltersChange}
        searchDebounceMs={searchDebounceMs}
        primary={
          caps.canCreate ? (
            <Link href="/employees/new" className={buttonVariants({ variant: 'primary' })}>
              <Plus aria-hidden />
              Add employee
            </Link>
          ) : undefined
        }
      />

      {/* Remounting on any filter or page-size change resets pagination to the first page. */}
      <DirectoryResults
        key={JSON.stringify([filters, limit, refresh])}
        filters={filters}
        limit={limit}
        onClear={() => onFiltersChange(EMPTY_FILTERS)}
        onOpen={setView}
      />

      {/* EMP-003: people who see only their team or themselves can still look colleagues up. */}
      {service.kind === 'http' && !caps.readAll ? <CompanyDirectory /> : null}

      <EmployeeProfileDrawer
        id={view}
        onClose={() => setView(null)}
        onOpen={setView}
        onChanged={() => setRefresh((n) => n + 1)}
      />
    </section>
  );
}

function DirectoryResults({
  filters,
  limit,
  onClear,
  onOpen,
}: {
  filters: DirectoryFilters;
  limit: number;
  onClear: () => void;
  onOpen: (id: string) => void;
}) {
  const { caps } = useEmployeesContext();
  // cursors[i] is the cursor that fetches page i (page 0 has none). Going back reuses stored cursors.
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const list = useEmployeeList(toListQuery(filters, { limit, cursor: cursors[pageIndex] }));

  // Move focus to the results after paging so keyboard and screen-reader users land on the new page.
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Compare with the previously shown page instead of using a "first render" flag: React StrictMode
  // runs effects twice on mount in development, which would otherwise steal focus from the control
  // the user just used (e.g. a filter select).
  const shownPage = useRef(pageIndex);
  useEffect(() => {
    if (shownPage.current === pageIndex) return;
    shownPage.current = pageIndex;
    headingRef.current?.focus();
  }, [pageIndex]);

  const rows = list.data?.data ?? [];
  const nextCursor = list.data?.page.nextCursor ?? null;
  const loading = list.status === 'loading';

  const goNext = () => {
    if (!nextCursor) return;
    setCursors((c) => [...c.slice(0, pageIndex + 1), nextCursor]);
    setPageIndex((i) => i + 1);
  };

  return (
    <div className="flex flex-col gap-4" aria-busy={loading || undefined}>
      <h2 ref={headingRef} tabIndex={-1} className="sr-only">
        Employee results, page {pageIndex + 1}
      </h2>
      {/* Announced politely to screen readers whenever the result set changes. */}
      <p className="sr-only" role="status" aria-live="polite">
        {loading
          ? 'Loading employees'
          : list.status === 'success'
            ? `${rows.length} employee${rows.length === 1 ? '' : 's'} on this page`
            : ''}
      </p>

      {list.status === 'error' ? (
        <ErrorState
          title="Could not load employees."
          message={describeError(list.error)}
          onRetry={list.reload}
        />
      ) : list.status === 'success' && rows.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface shadow-sm">
          {hasActiveFilters(filters) ? (
            <NoResultsState noun="employees" onClear={onClear} />
          ) : caps.readAll ? (
            <EmptyState
              icon={Users}
              title="No employees yet"
              description="Employees you add will appear here."
              action={
                caps.canCreate ? (
                  <Link href="/employees/new" className={buttonVariants({ variant: 'primary' })}>
                    Add the first employee
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <EmptyState
              icon={UserX}
              title="No employee records to show"
              description="Your account is not linked to an employee profile, or you have no direct reports yet."
            />
          )}
        </div>
      ) : (
        <>
          <EmployeeTable rows={rows} loading={loading} pageSize={limit} onOpen={onOpen} />
          <EmployeeCards rows={rows} loading={loading} pageSize={limit} onOpen={onOpen} />
        </>
      )}

      {list.status === 'success' && rows.length > 0 ? (
        <CursorPagination
          page={pageIndex + 1}
          count={rows.length}
          noun="employees"
          hasPrevious={pageIndex > 0}
          hasNext={Boolean(nextCursor)}
          onPrevious={() => setPageIndex((i) => i - 1)}
          onNext={goNext}
        />
      ) : null}
    </div>
  );
}
