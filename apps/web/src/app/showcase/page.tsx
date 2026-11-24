import type { Metadata } from 'next';
import { ShowcaseView } from './showcase-view';

export const metadata: Metadata = { title: 'Component showcase - GSC Peoples' };

export default function ShowcasePage() {
  return <ShowcaseView />;
}
