import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/*
 * Page-shaped loading placeholders. Each variant mirrors the real page's structure (same grids, card surfaces, 40px
 * table header and 44px rows) so swapping in the content does not move anything. Used by the route `loading.tsx`
 * files AND by the in-page session gate, so a navigation shows one continuous skeleton instead of two different ones.
 *
 * Server-compatible (no hooks). Colours come from theme tokens via `Skeleton` (bg-sunken); the pulse stops under
 * prefers-reduced-motion.
 */

export type PageSkeletonVariant = 'dashboard' | 'directory' | 'sections' | 'tabs' | 'profile' | 'form' | 'reports';

const card = 'rounded-lg border border-line bg-surface shadow-sm';

/** One-line page description that sits under the top-bar title (PageHeader). */
function DescriptionSkeleton({ action = false }: { action?: boolean }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <Skeleton className="h-5 w-full max-w-[min(28rem,100%)]" />
      {action ? <Skeleton className="h-9 w-32 rounded-md" /> : null}
    </div>
  );
}

export function StatCardSkeleton({ plain = false }: { plain?: boolean }) {
  return (
    <div className={cn('min-w-0 rounded-lg', plain ? 'bg-sunken/60 p-4' : cn(card, 'p-5'))}>
      <Skeleton className="h-5 w-24" />
      <Skeleton className="mt-2 h-9 w-20" />
    </div>
  );
}

/** Row of KPI cards at the dashboard grid (1 / 2 / 4 columns). */
export function StatGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <StatCardSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * Table-shaped placeholder: header band plus rows at the real row height. Columns after the first two are hidden on
 * narrow screens so the placeholder never scrolls sideways at 320px.
 */
export function TableBlockSkeleton({ rows = 6, columns = 5, className }: { rows?: number; columns?: number; className?: string }) {
  const cols = Array.from({ length: columns }, (_, i) => i);
  const colClass = (i: number) => cn('min-w-0 flex-1', i >= 2 && 'max-sm:hidden', i >= 4 && 'max-lg:hidden');
  return (
    <div className={cn('overflow-hidden', card, className)}>
      <div className="flex h-10 items-center gap-4 bg-sunken px-4">
        {cols.map((i) => (
          <div key={i} className={colClass(i)}>
            <Skeleton className="h-3 w-16 bg-line" />
          </div>
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex h-11 items-center gap-4 border-b border-line px-4 last:border-b-0">
          {cols.map((i) => (
            <div key={i} className={colClass(i)}>
              {i === 0 ? (
                <div className="flex items-center gap-2.5">
                  <Skeleton className="size-7 shrink-0 rounded-full" />
                  <Skeleton className="h-4 w-full max-w-36" />
                </div>
              ) : (
                <Skeleton className={cn('h-4', i % 2 ? 'w-3/4' : 'w-1/2')} />
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Titled surface card (shared `Section`) with a table inside. */
function SectionSkeleton({ rows = 4, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className={card}>
      <div className="flex items-center justify-between gap-3 px-5 pt-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-[30px] w-24 rounded-md" />
      </div>
      <div className="p-5 pt-3">
        <TableBlockSkeleton rows={rows} columns={columns} className="border-0 shadow-none" />
      </div>
    </div>
  );
}

function ToolbarSkeleton({ action = true }: { action?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Skeleton className="h-9 w-full rounded-md sm:w-72" />
      <Skeleton className="h-9 w-24 rounded-md max-sm:hidden" />
      <Skeleton className="h-9 w-24 rounded-md max-sm:hidden" />
      {action ? <Skeleton className="ml-auto h-9 w-32 rounded-md max-sm:hidden" /> : null}
    </div>
  );
}

function TabsSkeleton() {
  return (
    <div className="mb-5 flex gap-6 border-b border-line">
      {['w-24', 'w-28', 'w-20', 'w-32'].map((w, i) => (
        <Skeleton key={i} className={cn('mb-2.5 h-5', w, i >= 2 && 'max-sm:hidden')} />
      ))}
    </div>
  );
}

function FormCardSkeleton({ fields = 6 }: { fields?: number }) {
  return (
    <div className={card}>
      <div className="border-b border-line px-4 py-4 sm:px-6">
        <Skeleton className="h-6 w-44" />
        <Skeleton className="mt-1.5 h-4 w-full max-w-72" />
      </div>
      <div className="grid gap-4 px-4 py-5 sm:px-6 md:grid-cols-2">
        {Array.from({ length: fields }, (_, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-9 w-full rounded-md" />
          </div>
        ))}
        <Skeleton className="h-9 w-32 rounded-md md:col-span-2" />
      </div>
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className={cn(card, 'flex flex-wrap items-center gap-4 p-5')}>
        <Skeleton className="size-14 shrink-0 rounded-full" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton className="h-6 w-48 max-w-full" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
        <Skeleton className="h-9 w-28 rounded-md" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={cn(card, 'flex flex-col gap-3 p-5')}>
            <Skeleton className="h-6 w-36" />
            {[0, 1, 2, 3].map((j) => (
              <div key={j} className="flex items-center justify-between gap-4">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-36" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Dashboard body (KPI group, today panel, two sections), for the data wait after the page header is shown. */
export function DashboardSkeleton({ label }: { label?: string }) {
  return (
    <div className="flex flex-col gap-6" {...(label ? { role: 'status', 'aria-busy': true } : {})}>
      {label ? <span className="sr-only">{label}</span> : null}
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3.5 w-24" />
        <StatGridSkeleton />
      </div>
      <div className={cn(card, 'p-4 sm:p-5')}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-4 w-36" />
        </div>
        <Skeleton className="mt-4 h-2.5 w-full rounded-full" />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <StatCardSkeleton key={i} plain />
          ))}
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <SectionSkeleton rows={4} columns={3} />
        <SectionSkeleton rows={4} columns={3} />
      </div>
    </div>
  );
}

const BODIES: Record<PageSkeletonVariant, () => React.ReactNode> = {
  dashboard: () => (
    <>
      <DescriptionSkeleton />
      <DashboardSkeleton />
    </>
  ),
  directory: () => (
    <>
      <DescriptionSkeleton />
      <div className="flex flex-col gap-4">
        <ToolbarSkeleton />
        <TableBlockSkeleton rows={8} columns={6} />
      </div>
    </>
  ),
  sections: () => (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-5 w-full max-w-[min(28rem,100%)]" />
      <StatGridSkeleton />
      <SectionSkeleton rows={5} columns={5} />
    </div>
  ),
  tabs: () => (
    <>
      <DescriptionSkeleton />
      <TabsSkeleton />
      <div className="flex flex-col gap-4">
        <ToolbarSkeleton />
        <TableBlockSkeleton rows={6} columns={4} />
      </div>
    </>
  ),
  profile: () => (
    <>
      <DescriptionSkeleton />
      <ProfileSkeleton />
    </>
  ),
  form: () => (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-5 w-full max-w-[min(28rem,100%)]" />
      <FormCardSkeleton />
      <FormCardSkeleton fields={4} />
    </div>
  ),
  reports: () => (
    <>
      <DescriptionSkeleton />
      <div className="flex flex-col gap-6">
        <ToolbarSkeleton action={false} />
        <StatGridSkeleton />
        <TableBlockSkeleton rows={6} columns={6} />
      </div>
    </>
  ),
};

export function PageSkeleton({ variant, label = 'Loading' }: { variant: PageSkeletonVariant; label?: string }) {
  const Body = BODIES[variant];
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <Body />
    </div>
  );
}
