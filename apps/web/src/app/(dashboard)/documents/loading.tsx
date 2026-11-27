import { PageSkeleton } from '@/components/shared/page-skeletons';

/** Instant route fallback (shell stays mounted); matches the documents page layout. */
export default function Loading() {
  return <PageSkeleton variant="tabs" label="Loading documents" />;
}
