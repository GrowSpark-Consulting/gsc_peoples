import type { Metadata } from 'next';
import { NewEmployeePage } from '@/modules/employees/pages';

export const metadata: Metadata = { title: 'Add employee - GSC Peoples' };

export default function Page() {
  return <NewEmployeePage />;
}
