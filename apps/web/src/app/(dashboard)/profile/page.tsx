import type { Metadata } from 'next';
import { MyProfilePage } from '@/modules/employees/my-profile-page';

export const metadata: Metadata = { title: 'My profile - GSC Peoples' };

export default function Page() {
  return <MyProfilePage />;
}
