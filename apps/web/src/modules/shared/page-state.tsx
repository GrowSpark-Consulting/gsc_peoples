'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { PageSkeleton, type PageSkeletonVariant } from '@/components/shared/page-skeletons';
import { AccessDeniedState, ErrorState } from '@/components/shared/data-states';
import { describeApiError, isForbidden } from '@/lib/api-client';
import { useSession } from '@/hooks/use-session';
import type { Session } from '@/modules/employees/permissions';

/** Loading placeholder for a page body. */
export function PageLoading({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-3">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-48 w-full" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

/**
 * Shows loading / error (with retry) / 403 instead of the page until the session is known. Pass the page's
 * `PageSkeleton` variant so the session wait looks exactly like the route's `loading.tsx` (no visual jump).
 */
export function SessionGate({
  children,
  skeleton,
}: {
  children: (session: Session) => React.ReactNode;
  skeleton?: PageSkeletonVariant;
}) {
  const state = useSession();
  if (state.status === 'loading') {
    return skeleton ? <PageSkeleton variant={skeleton} label="Loading your session" /> : <PageLoading label="Loading your session" />;
  }
  if (state.status === 'error') {
    return isForbidden(state.error) ? (
      <AccessDeniedState />
    ) : (
      <ErrorState
        title="Could not load your session."
        message={describeApiError(state.error)}
        onRetry={() => window.location.reload()}
      />
    );
  }
  return <>{children(state.session)}</>;
}

/** Standard loading / error / 403 handling for one `useAsyncData` result. */
export function QueryBoundary<T>({
  query,
  title,
  fallback,
  children,
}: {
  query: { status: string; data: T | undefined; error: unknown; reload: () => void };
  title?: string;
  /** Content-shaped placeholder (e.g. KPI cards); defaults to a generic block. */
  fallback?: React.ReactNode;
  children: (data: T) => React.ReactNode;
}) {
  if (query.status === 'loading' || query.status === 'idle') return <>{fallback ?? <PageLoading />}</>;
  if (query.status === 'error') {
    return isForbidden(query.error) ? (
      <AccessDeniedState />
    ) : (
      <ErrorState title={title} message={describeApiError(query.error)} onRetry={query.reload} />
    );
  }
  return <>{children(query.data as T)}</>;
}

/** White card used for page sections (same surface as the existing tables and stat cards). */
export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="rounded-lg border border-line bg-surface shadow-sm">
      <div className="flex items-center justify-between gap-3 px-5 pt-4">
        <h2 className="text-h3 font-semibold text-ink">{title}</h2>
        {action}
      </div>
      <div className="p-5 pt-3">{children}</div>
    </section>
  );
}
