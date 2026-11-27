import { PageSkeleton } from '@/components/shared/page-skeletons';

/** Instant route fallback (shell stays mounted); matches the employee directory page layout. */
export default function Loading() {
  return <PageSkeleton variant="directory" label="Loading employee directory" />;
}
