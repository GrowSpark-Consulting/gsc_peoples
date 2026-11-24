import type { Metadata } from 'next';
import { EditEmployeePage } from '@/modules/employees/pages';

export const metadata: Metadata = { title: 'Edit employee - GSC Peoples' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditEmployeePage id={id} />;
}
