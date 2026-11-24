import type { Metadata } from 'next';
import { OrganizationPage } from '@/modules/departments/organization-page';

export const metadata: Metadata = { title: 'Departments - GSC Peoples' };

export default function Page() {
  return <OrganizationPage />;
}
