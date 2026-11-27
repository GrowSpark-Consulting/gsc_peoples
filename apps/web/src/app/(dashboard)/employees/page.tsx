import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/shared/page-skeletons';
import { EmployeesDirectoryPage } from '@/modules/employees/pages';

export const metadata: Metadata = { title: 'Employees - GSC Peoples' };

export default function Page() {
  // useSearchParams (filters in the URL) needs a Suspense boundary.
  return (
    <Suspense fallback={<PageSkeleton variant="directory" label="Loading employee directory" />}>
      <EmployeesDirectoryPage />
    </Suspense>
  );
}
