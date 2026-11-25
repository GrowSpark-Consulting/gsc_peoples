'use client';

import { employeeSelfUpdateSchema, PERMISSIONS, type Employee } from '@gsc/contracts';
import { Send } from 'lucide-react';
import { useState } from 'react';
import { ErrorState } from '@/components/shared/data-states';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { CursorPagination } from '@/components/ui/pagination';
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow, TableSkeleton } from '@/components/ui/table';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { SelectField } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useAction } from '@/hooks/use-action';
import { describeApiError } from '@/lib/api-client';
import { formatTimestamp } from '../format';
import { useAsyncData } from '../hooks/use-async-data';
import type { Session } from '../permissions';
import { getDirectory, getTimeline, inviteFromRecord, updateMyContact } from '../record-api';

/* ---------------- Own contact details (EMP-009) ---------------- */

export function MyContactForm({ employee, onSaved }: { employee: Employee; onSaved: () => void }) {
  const [phone, setPhone] = useState(employee.phone ?? '');
  const [address, setAddress] = useState(employee.address ?? '');
  const [emergencyContact, setEmergencyContact] = useState(employee.emergencyContact ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const act = useAction(updateMyContact);
  const orNull = (s: string) => (s.trim() === '' ? null : s.trim());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    const parsed = employeeSelfUpdateSchema.safeParse({ phone: orNull(phone), address: orNull(address), emergencyContact: orNull(emergencyContact) });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    const r = await act.run(parsed.data);
    if (r.ok) {
      setSaved(true);
      onSaved();
    }
  }

  return (
    <form onSubmit={submit} noValidate aria-label="Edit my contact details" className="flex flex-col gap-4">
      <p className="text-small text-muted">You can change these three fields. Everything else is managed by HR.</p>
      <Field label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} error={errors.phone} autoComplete="tel" />
      <Field label="Address" multiline value={address} onChange={(e) => setAddress((e.target as unknown as HTMLTextAreaElement).value)} error={errors.address} />
      <Field label="Emergency contact" multiline value={emergencyContact} onChange={(e) => setEmergencyContact((e.target as unknown as HTMLTextAreaElement).value)} error={errors.emergencyContact} />
      {act.error ? <Alert variant="danger">{act.error.message}</Alert> : null}
      {saved ? <Alert variant="success">Contact details saved.</Alert> : null}
      <div>
        <Button type="submit" loading={act.pending}>Save contact details</Button>
      </div>
    </form>
  );
}

/* ---------------- Invitation (AUTH-004) ---------------- */

export function InvitePanel({ employee, session, onInvited }: { employee: Employee; session: Session; onInvited: () => void }) {
  const canAssignHigh = session.permissions.includes(PERMISSIONS.USER_ROLE_MANAGE);
  const [roleKey, setRoleKey] = useState<'EMPLOYEE' | 'MANAGER' | 'HR_ADMIN' | 'SUPER_ADMIN'>('EMPLOYEE');
  const [sent, setSent] = useState(false);
  const act = useAction(inviteFromRecord);
  const invited = employee.invitationStatus === 'INVITED';

  if (employee.invitationStatus === 'ACTIVATED') {
    return <p className="text-body text-ink">This employee has an activated login.</p>;
  }
  async function send() {
    setSent(false);
    const r = await act.run(employee.id, roleKey);
    if (r.ok) {
      setSent(true);
      onInvited();
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-small text-muted">
        {invited ? 'An invitation has been sent. Sending again replaces the earlier link.' : 'Not invited yet.'} The link is emailed to the work address and works once for 7 days.
      </p>
      {!invited ? (
        <div className="max-w-xs">
          <SelectField label="Login role" value={roleKey} onChange={(e) => setRoleKey(e.target.value as typeof roleKey)}>
            <option value="EMPLOYEE">Employee</option>
            <option value="MANAGER">Manager</option>
            {canAssignHigh ? (
              <>
                <option value="HR_ADMIN">HR Admin</option>
                <option value="SUPER_ADMIN">Super Admin</option>
              </>
            ) : null}
          </SelectField>
        </div>
      ) : null}
      {act.error ? <Alert variant="danger">{act.error.message}</Alert> : null}
      {sent ? <Alert variant="success">Invitation sent.</Alert> : null}
      <div>
        <Button variant="secondary" icon={<Send aria-hidden />} loading={act.pending} onClick={send}>
          {invited ? 'Resend invitation' : 'Send invitation'}
        </Button>
      </div>
    </div>
  );
}

/* ---------------- Activity timeline (EMP-008) ---------------- */

const ACTION_LABEL: Record<string, string> = {
  CREATED: 'Employee created',
  UPDATED: 'Details updated',
  DEPARTMENT_CHANGED: 'Department changed',
  MANAGER_CHANGED: 'Manager changed',
  STATUS_CHANGED: 'Status changed',
  INVITATION_SENT: 'Invitation sent',
  INVITATION_RESENT: 'Invitation resent',
  INVITATION_ACTIVATED: 'Account activated',
};

const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** "workEmail" -> "Work email". */
const fieldLabel = (f: string) => {
  const spaced = f.replace(/Id$/, '').replace(/([A-Z])/g, ' $1').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

export function ActivityTimeline({ id, version }: { id: string; version: string }) {
  const q = useAsyncData(`emp:timeline:${id}:${version}`, () => getTimeline(id));
  if (q.status === 'error') return <ErrorState title="Could not load the activity." message={describeApiError(q.error)} onRetry={q.reload} />;
  if (q.status !== 'success') return <Skeleton className="h-24 w-full" />;
  const rows = q.data ?? [];
  if (rows.length === 0) return <EmptyState title="No activity yet" description="Changes to this record appear here." />;
  return (
    <ol className="divide-y divide-line">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-col gap-1 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-body text-ink">{ACTION_LABEL[r.action] ?? r.action}</span>
            <span className="text-small text-muted">
              {r.actor?.name ?? 'System'} · {formatTimestamp(r.timestamp)}
            </span>
          </div>
          {Object.entries((r.changes ?? {}) as Record<string, { from?: unknown; to?: unknown }>).map(([field, c]) => (
            <p key={field} className="break-words text-small text-muted">
              {fieldLabel(field)}: {show(c?.from)} → {show(c?.to)}
            </p>
          ))}
        </li>
      ))}
    </ol>
  );
}

/* ---------------- Company directory (EMP-003) ---------------- */

const DIRECTORY_PAGE_SIZE = 25;

/** For people who cannot browse employee records: name, title, department and work email of colleagues. */
export function CompanyDirectory() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const term = useDebouncedValue(search.trim(), 300);
  const q = useAsyncData(`directory:${term}:${page}`, () => getDirectory({ q: term || undefined, page, pageSize: DIRECTORY_PAGE_SIZE }));
  const total = q.data?.page.total ?? 0;
  return (
    <section aria-label="Company directory" className="mt-8 flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-h3 font-semibold text-ink">Company directory</h2>
        <Field
          label="Search the directory"
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>
      {q.status === 'error' ? (
        <ErrorState title="Could not load the directory." message={describeApiError(q.error)} onRetry={q.reload} />
      ) : (
        <Table label="Colleagues">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Work email</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.status !== 'success' ? (
              <TableSkeleton columns={4} />
            ) : q.data && q.data.data.length === 0 ? (
              <TableEmpty colSpan={4}>
                <EmptyState title="No colleagues found" description="Try a different name." />
              </TableEmpty>
            ) : (
              q.data?.data.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    {p.firstName} {p.lastName}
                  </TableCell>
                  <TableCell>{p.title ?? '—'}</TableCell>
                  <TableCell>{p.departmentName ?? '—'}</TableCell>
                  <TableCell>
                    {p.workEmail ? (
                      <a href={`mailto:${p.workEmail}`} className="underline-offset-2 hover:underline">
                        {p.workEmail}
                      </a>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      )}
      {q.status === 'success' && total > DIRECTORY_PAGE_SIZE ? (
        <CursorPagination
          page={page}
          count={q.data?.data.length ?? 0}
          hasPrevious={page > 1}
          hasNext={page * DIRECTORY_PAGE_SIZE < total}
          onPrevious={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => p + 1)}
          noun="colleagues"
        />
      ) : null}
    </section>
  );
}
