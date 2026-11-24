import type { Metadata } from 'next';
import { DocumentsPage } from '@/modules/documents/documents-page';

export const metadata: Metadata = { title: 'Documents - GSC Peoples' };

export default function Page() {
  return <DocumentsPage />;
}
