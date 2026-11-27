import { PageSkeleton } from '@/components/shared/page-skeletons';

/** Instant route fallback (shell stays mounted); matches the reports page layout. */
export default function Loading() {
  return <PageSkeleton variant="reports" label="Loading reports" />;
}
