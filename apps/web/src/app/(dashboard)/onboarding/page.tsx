import type { Metadata } from 'next';
import { OnboardingPage } from '@/modules/onboarding/onboarding-page';

export const metadata: Metadata = { title: 'Onboarding - GSC Peoples' };

export default function Page() {
  return <OnboardingPage />;
}
