import type { Employee } from '@gsc/contracts';
import Link from 'next/link';
import { Avatar } from '@/components/ui/avatar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeleton,
} from '@/components/ui/table';
import { formatDay, fullName, TYPE_LABEL } from '../format';
import { StatusBadge } from './status-badge';

const COLUMNS = 7;
const dash = '—';

function NameLink({ e, onOpen }: { e: Employee; onOpen?: (id: string) => void }) {
  return (
    <Link
      href={`/employees/${e.id}`}
      onClick={(ev) => {
        // A plain click (or Enter) opens the profile drawer; modified clicks and "open in new tab"
        // keep the real href and reach the full profile page.
        if (!onOpen || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
        ev.preventDefault();
        onOpen(e.id);
      }}
      className="rounded-sm font-medium text-ink underline-offset-2 hover:underline focus-visible:underline"
    >
      {fullName(e)}
    </Link>
  );
}

/** Desktop and tablet: a table. Hidden below the `md` breakpoint, where cards are used instead. */
export function EmployeeTable({
  rows,
  loading,
  pageSize,
  onOpen,
}: {
  rows: Employee[];
  loading?: boolean;
  pageSize: number;
  /** Open the profile drawer. Without it the name is a plain link to the profile page. */
  onOpen?: (id: string) => void;
}) {
  return (
    <div className="hidden md:block" data-testid="employee-table">
      <Table label="Employees" aria-busy={loading || undefined}>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Employee</TableHead>
            <TableHead>Work email</TableHead>
            <TableHead>Department</TableHead>
            <TableHead>Manager</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Hired</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableSkeleton columns={COLUMNS} rows={Math.min(pageSize, 6)} />
          ) : (
            rows.map((e) => (
              <TableRow key={e.id}>
                <TableCell>
                  <div className="flex items-center gap-3 py-1.5">
                    <Avatar name={fullName(e)} />
                    <div className="min-w-0">
                      <NameLink e={e} onOpen={onOpen} />
                      <div className="text-caption text-muted">
                        {e.employeeNumber}
                        {e.jobTitle ? ` · ${e.jobTitle}` : ''}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell muted>{e.workEmail ?? dash}</TableCell>
                <TableCell>{e.department?.name ?? dash}</TableCell>
                <TableCell>{e.manager ? fullName(e.manager) : dash}</TableCell>
                <TableCell>{TYPE_LABEL[e.employmentType]}</TableCell>
                <TableCell>
                  <StatusBadge status={e.status} />
                </TableCell>
                <TableCell muted>{formatDay(e.hireDate)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

/** Phones: one card per employee, same data as the table. Hidden from `md` up. */
export function EmployeeCards({
  rows,
  loading,
  pageSize,
  onOpen,
}: {
  rows: Employee[];
  loading?: boolean;
  pageSize: number;
  /** Open the profile drawer. Without it the name is a plain link to the profile page. */
  onOpen?: (id: string) => void;
}) {
  if (loading) {
    return (
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 md:hidden" data-testid="employee-cards" aria-hidden>
        {Array.from({ length: Math.min(pageSize, 4) }, (_, i) => (
          <li
            key={i}
            className="h-24 animate-pulse rounded-lg border border-line bg-surface motion-reduce:animate-none"
          />
        ))}
      </ul>
    );
  }
  return (
    <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 md:hidden" data-testid="employee-cards" aria-label="Employees">
      {rows.map((e) => (
        <li key={e.id} className="min-w-0 rounded-lg border border-line bg-surface p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar name={fullName(e)} size="lg" />
              <div className="min-w-0">
                <NameLink e={e} onOpen={onOpen} />
                <div className="truncate text-caption text-muted">
                  {e.employeeNumber}
                  {e.jobTitle ? ` · ${e.jobTitle}` : ''}
                </div>
              </div>
            </div>
            <StatusBadge status={e.status} />
          </div>
          <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-small">
            <dt className="text-muted">Department</dt>
            <dd className="text-ink">{e.department?.name ?? dash}</dd>
            <dt className="text-muted">Manager</dt>
            <dd className="text-ink">{e.manager ? fullName(e.manager) : dash}</dd>
            <dt className="text-muted">Type</dt>
            <dd className="text-ink">{TYPE_LABEL[e.employmentType]}</dd>
            <dt className="text-muted">Email</dt>
            <dd className="truncate text-ink">{e.workEmail ?? dash}</dd>
          </dl>
        </li>
      ))}
    </ul>
  );
}
