import type { Metadata } from 'next';
import { Suspense } from 'react';
import { EmployeesDirectoryPage } from '@/modules/employees/pages';

export const metadata: Metadata = { title: 'Employees - GSC Peoples' };

export default function Page() {
  // useSearchParams (filters in the URL) needs a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <EmployeesDirectoryPage />
    </Suspense>
  );
}
