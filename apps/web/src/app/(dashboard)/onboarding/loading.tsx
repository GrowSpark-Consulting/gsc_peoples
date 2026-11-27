import { PageSkeleton } from '@/components/shared/page-skeletons';

/** Instant route fallback (shell stays mounted); matches the onboarding page layout. */
export default function Loading() {
  return <PageSkeleton variant="sections" label="Loading onboarding" />;
}
