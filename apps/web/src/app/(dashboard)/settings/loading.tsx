import { PageSkeleton } from '@/components/shared/page-skeletons';

/** Instant route fallback (shell stays mounted); matches the settings page layout. */
export default function Loading() {
  return <PageSkeleton variant="form" label="Loading settings" />;
}
