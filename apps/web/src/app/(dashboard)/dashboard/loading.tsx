import { PageSkeleton } from '@/components/shared/page-skeletons';

/** Instant route fallback (shell stays mounted); matches the dashboard page layout. */
export default function Loading() {
  return <PageSkeleton variant="dashboard" label="Loading dashboard" />;
}
