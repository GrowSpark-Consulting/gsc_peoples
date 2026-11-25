'use client';

import { useState } from 'react';
import { ErrorState } from '@/components/shared/data-states';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { CursorPagination } from '@/components/ui/pagination';
import { SelectField } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow, TableSkeleton } from '@/components/ui/table';
import { describeApiError } from '@/lib/api-client';
import { formatTimestamp } from '@/modules/employees/format';
import { useAsyncData } from '@/modules/employees/hooks/use-async-data';
import { Section } from '@/modules/shared/page-state';
import { AUDIT_PAGE_SIZE, listAuditLogs } from './api';

/** Record types the API writes. Used only as filter options. */
const ENTITIES = [
  'company', 'user', 'Employee', 'Department', 'Designation', 'holiday', 'AttendanceRecord', 'AttendanceCorrection',
  'LeaveType', 'LeaveBalance', 'LeaveRequest', 'OnboardingTask', 'OnboardingTemplateTask', 'EmployeeDocument',
] as const;

const details = (v: unknown) => (v === null || v === undefined ? '' : JSON.stringify(v, null, 2));

/** SET-004: audit log viewer with filters by user, record type and date. Read-only by design. */
export function AuditLogSection({ users }: { users: { id: string; label: string }[] }) {
  const [actorId, setActorId] = useState('');
  const [entity, setEntity] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const q = useAsyncData(`audit:${actorId}:${entity}:${from}:${to}:${page}`, () =>
    listAuditLogs({ actorId: actorId || undefined, entity: entity || undefined, from: from || undefined, to: to || undefined, page }),
  );
  const total = q.data?.page.total ?? 0;
  const change = (set: (v: string) => void) => (v: string) => {
    set(v);
    setPage(1);
  };

  return (
    <Section title="Audit log">
      <div role="search" aria-label="Audit log filters" className="mb-4 flex flex-wrap items-end gap-3">
        <SelectField label="User" value={actorId} onChange={(e) => change(setActorId)(e.target.value)} containerClassName="min-w-[180px]">
          <option value="">All users</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.label}</option>
          ))}
        </SelectField>
        <SelectField label="Record type" value={entity} onChange={(e) => change(setEntity)(e.target.value)}>
          <option value="">All records</option>
          {ENTITIES.map((e) => (
            <option key={e} value={e}>{e}</option>
          ))}
        </SelectField>
        <Field label="From" type="date" value={from} max={to || undefined} onChange={(e) => change(setFrom)(e.target.value)} />
        <Field label="To" type="date" value={to} min={from || undefined} onChange={(e) => change(setTo)(e.target.value)} />
      </div>

      {q.status === 'error' ? (
        <ErrorState title="Could not load the audit log." message={describeApiError(q.error)} onRetry={q.reload} />
      ) : (
        <>
          <Table label="Audit log entries">
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Record</TableHead>
                <TableHead>Changes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.status !== 'success' ? (
                <TableSkeleton columns={5} />
              ) : q.data && q.data.data.length === 0 ? (
                <TableEmpty colSpan={5}>
                  <EmptyState title="No entries" description="Nothing matches these filters." />
                </TableEmpty>
              ) : (
                q.data?.data.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{formatTimestamp(r.createdAt)}</TableCell>
                    <TableCell>{r.actorName ?? (r.actorId ? 'Unknown user' : 'System')}</TableCell>
                    <TableCell>{r.action}</TableCell>
                    <TableCell>{r.entity}</TableCell>
                    <TableCell>
                      {r.oldValue || r.newValue ? (
                        <details>
                          <summary className="cursor-pointer text-small underline">View</summary>
                          <pre className="mt-2 max-w-[48ch] overflow-x-auto whitespace-pre-wrap break-words text-small text-muted">
                            {r.oldValue ? `Before: ${details(r.oldValue)}\n` : ''}
                            {r.newValue ? `After: ${details(r.newValue)}` : ''}
                          </pre>
                        </details>
                      ) : (
                        '—'
                      )}
                    </TableCell>
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
                hasNext={page * AUDIT_PAGE_SIZE < total}
                onPrevious={() => setPage((p) => Math.max(1, p - 1))}
                onNext={() => setPage((p) => p + 1)}
                noun="entries"
              />
            </div>
          ) : null}
        </>
      )}
    </Section>
  );
}
