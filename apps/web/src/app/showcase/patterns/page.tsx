import type { Metadata } from 'next';
import { PatternsView } from './patterns-view';

export const metadata: Metadata = { title: 'Feature page patterns - GSC Peoples' };

export default function PatternsPage() {
  return <PatternsView />;
}
