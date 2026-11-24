import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export interface Breadcrumb {
  label: string;
  href?: string;
}

export interface PageHeaderProps {
  /**
   * The page title is the top bar's h1 (design system section 5), so it is not repeated here.
   * Use this block for the one-line description, breadcrumbs (nested pages only) and page-level actions.
   */
  description?: string;
  breadcrumbs?: Breadcrumb[];
  /** Page-level actions (right-aligned). List pages put their primary action in the ListToolbar instead. */
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({ description, breadcrumbs, actions, className }: PageHeaderProps) {
  if (!description && !breadcrumbs?.length && !actions) return null;
  return (
    <div className={cn('mb-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-3', className)}>
      <div className="min-w-0 flex-1">
        {breadcrumbs?.length ? (
          <nav aria-label="Breadcrumb" className="mb-1">
            <ol className="flex flex-wrap items-center gap-1 text-small text-muted">
              {breadcrumbs.map((b, i) => {
                const last = i === breadcrumbs.length - 1;
                return (
                  <li key={`${b.label}-${i}`} className="flex items-center gap-1">
                    {b.href && !last ? (
                      <Link href={b.href} className="rounded-sm hover:text-ink hover:underline">
                        {b.label}
                      </Link>
                    ) : (
                      <span aria-current={last ? 'page' : undefined} className={last ? 'text-ink' : undefined}>
                        {b.label}
                      </span>
                    )}
                    {!last ? <ChevronRight className="size-3.5" strokeWidth={1.75} aria-hidden /> : null}
                  </li>
                );
              })}
            </ol>
          </nav>
        ) : null}
        {description ? <p className="max-w-[72ch] text-body text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </div>
  );
}
