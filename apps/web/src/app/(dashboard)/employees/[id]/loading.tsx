import { PageSkeleton } from '@/components/shared/page-skeletons';

/** Instant route fallback (shell stays mounted); matches the employee profile page layout. */
export default function Loading() {
  return <PageSkeleton variant="profile" label="Loading employee profile" />;
}
