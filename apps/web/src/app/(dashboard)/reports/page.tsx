import { ChartColumn } from 'lucide-react';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata: Metadata = { title: 'Reports - GSC Peoples' };

/**
 * Attendance, leave and employee reports with CSV export are P1 (PRD ATT-008, section 7) and the API has no
 * report endpoints yet (docs/development/frontend-integration-matrix.md, G7). Nothing is estimated or faked here.
 */
export default function Page() {
  return (
    <>
      <PageHeader description="Attendance, leave and employee reports for HR and Super Admin." />
      <section aria-label="Reports" className="rounded-lg border border-line bg-surface shadow-sm">
        <EmptyState
          icon={ChartColumn}
          title="Reports are not available yet"
          description="Reports and CSV export are planned after the first release and need report endpoints in the API. Live counts are on the dashboard; attendance and leave history are on their own pages."
        />
      </section>
    </>
  );
}
