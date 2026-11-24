import type { Metadata } from 'next';
import { EmployeeProfilePage } from '@/modules/employees/pages';

export const metadata: Metadata = { title: 'Employee profile - GSC Peoples' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EmployeeProfilePage id={id} />;
}
