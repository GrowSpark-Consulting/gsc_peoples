'use client';

import { Download } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { AccessDeniedState, ErrorState } from '@/components/shared/data-states';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { CursorPagination } from '@/components/ui/pagination';
import { SelectField } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow, TableSkeleton } from '@/components/ui/table';
import { useAction } from '@/hooks/use-action';
import { hasPermission, PERMISSIONS, useCompany } from '@/hooks/use-session';
import { describeApiError } from '@/lib/api-client';
import { listDepartments } from '@/modules/departments/api';
import { useAsyncData } from '@/modules/employees/hooks/use-async-data';
import type { Session } from '@/modules/employees/permissions';
import { MONTHS, todayIn } from '@/modules/shared/datetime';
import { Section, SessionGate } from '@/modules/shared/page-state';
import { downloadAttendanceCsv, getAttendanceReport, REPORT_PAGE_SIZE } from './api';

export function ReportsPage() {
  return (
    <SessionGate skeleton="reports">
      {(session) =>
        hasPermission(session, PERMISSIONS.ATTENDANCE_REPORT) ? <ReportsBody session={session} /> : <AccessDeniedState />
      }
    </SessionGate>
  );
}

function ReportsBody({ session }: { session: Session }) {
  const company = useCompany();
  const [currentYear, currentMonth] = todayIn(company?.timezone).split('-').map(Number) as [number, number];
  const [month, setMonth] = useState(currentMonth);
  const [year, setYear] = useState(currentYear);
  const [departmentId, setDepartmentId] = useState('');
  const [page, setPage] = useState(1);
  const filters = { year, month, departmentId: departmentId || undefined };
  const departments = useAsyncData(`reports:departments:${session.employeeId}`, listDepartments);
  const q = useAsyncData(`reports:attendance:${year}-${month}:${departmentId}:${page}`, () => getAttendanceReport(filters, page));
  const csv = useAction(downloadAttendanceCsv);
  const total = q.data?.page.total ?? 0;
  const years = [currentYear - 2, currentYear - 1, currentYear];

  async function download() {
    const r = await csv.run(filters);
    if (!r.ok) return;
    const url = URL.createObjectURL(r.value.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = r.value.fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageHeader description="Monthly attendance by employee. Totals are counted from the same daily records shown on the attendance page." />
      <Section
        title="Attendance report"
        action={
          <Button size="sm" variant="secondary" icon={<Download aria-hidden />} loading={csv.pending} onClick={download}>
            Export CSV
          </Button>
        }
      >
        <div role="search" aria-label="Report filters" className="mb-4 flex flex-wrap items-end gap-3">
          <SelectField label="Month" value={month} onChange={(e) => { setMonth(Number(e.target.value)); setPage(1); }}>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>{m}</option>
            ))}
          </SelectField>
          <SelectField label="Year" value={year} onChange={(e) => { setYear(Number(e.target.value)); setPage(1); }}>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </SelectField>
          <SelectField label="Department" value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setPage(1); }} containerClassName="min-w-[180px]">
            <option value="">All departments</option>
            {(departments.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </SelectField>
        </div>
        {csv.error ? <div className="mb-3"><Alert variant="danger">{csv.error.message}</Alert></div> : null}
        {q.status === 'error' ? (
          <ErrorState title="Could not load the report." message={describeApiError(q.error)} onRetry={q.reload} />
        ) : (
          <>
            <Table label="Attendance report">
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead align="right">Present</TableHead>
                  <TableHead align="right">Absent</TableHead>
                  <TableHead align="right">On leave</TableHead>
                  <TableHead align="right">Holidays</TableHead>
                  <TableHead align="right">Missing check-out</TableHead>
                  <TableHead align="right">Hours</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.status !== 'success' ? (
                  <TableSkeleton columns={8} />
                ) : q.data && q.data.data.length === 0 ? (
                  <TableEmpty colSpan={8}>
                    <EmptyState title="Nothing to report" description="No employee matches this month and department." />
                  </TableEmpty>
                ) : (
                  q.data?.data.map((r) => (
                    <TableRow key={r.employeeId}>
                      <TableCell>
                        {r.name}
                        <span className="block text-small text-muted">{r.employeeNumber}</span>
                      </TableCell>
                      <TableCell>{r.departmentName ?? '—'}</TableCell>
                      <TableCell numeric align="right">{r.present}</TableCell>
                      <TableCell numeric align="right">{r.absent}</TableCell>
                      <TableCell numeric align="right">{r.onLeave}</TableCell>
                      <TableCell numeric align="right">{r.holidays}</TableCell>
                      <TableCell numeric align="right">{r.missingCheckout}</TableCell>
                      <TableCell numeric align="right">{r.hoursWorked}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            {q.status === 'success' && total > 0 ? (
              <div className="mt-4">
                <CursorPagination
                  page={page}
                  count={q.data?.data.length ?? 0}
                  hasPrevious={page > 1}
                  hasNext={page * REPORT_PAGE_SIZE < total}
                  onPrevious={() => setPage((p) => Math.max(1, p - 1))}
                  onNext={() => setPage((p) => p + 1)}
                  noun="employees"
                />
              </div>
            ) : null}
          </>
        )}
      </Section>
    </>
  );
}
