import type { Metadata } from 'next';
import { LeavePage } from '@/modules/leave/leave-page';

export const metadata: Metadata = { title: 'Leave - GSC Peoples' };

export default function Page() {
  return <LeavePage />;
}
