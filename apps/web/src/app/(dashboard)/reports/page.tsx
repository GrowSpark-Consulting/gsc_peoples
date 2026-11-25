import type { Metadata } from 'next';
import { ReportsPage } from '@/modules/reports/reports-page';

export const metadata: Metadata = { title: 'Reports - GSC Peoples' };

export default function Page() {
  return <ReportsPage />;
}
