import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './button';

export interface CursorPaginationProps {
  /** 1-based page number within the current result set. */
  page: number;
  /** Rows on the current page. */
  count: number;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  /** Disables both buttons while a page is loading. */
  loading?: boolean;
  /** Noun for the summary, e.g. "employees". */
  noun?: string;
}

/** Previous / Next for cursor-paginated lists. Cursors are opaque, so there are no page numbers to jump to. */
export function CursorPagination({
  page,
  count,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
  loading = false,
  noun = 'results',
}: CursorPaginationProps) {
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-small text-muted" aria-live="polite">
        Page {page} · {count} {noun}
      </p>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={onPrevious} disabled={!hasPrevious || loading} icon={<ChevronLeft />}>
          Previous
        </Button>
        <Button variant="secondary" size="sm" onClick={onNext} disabled={!hasNext || loading}>
          Next
          <ChevronRight />
        </Button>
      </div>
    </nav>
  );
}
