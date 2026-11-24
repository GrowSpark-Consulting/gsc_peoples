import type { Metadata } from 'next';
import { AttendancePage } from '@/modules/attendance/attendance-page';

export const metadata: Metadata = { title: 'Attendance - GSC Peoples' };

export default function Page() {
  return <AttendancePage />;
}
