'use client';

import {
  adjustLeaveBalanceSchema,
  createLeaveRequestSchema,
  createLeaveTypeSchema,
  type leaveRequestSchema,
  type leaveTypeSchema,
} from '@gsc/contracts';
import { Plus, SlidersHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { z } from 'zod';
import { PageHeader } from '@/components/layout/page-header';
import { ErrorState } from '@/components/shared/data-states';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { CursorPagination } from '@/components/ui/pagination';
import { SelectField } from '@/components/ui/select';
import { StatCard } from '@/components/ui/stat-card';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeleton,
} from '@/components/ui/table';
import { useAction } from '@/hooks/use-action';
import { hasPermission, PERMISSIONS, useCompany } from '@/hooks/use-session';
import { describeApiError } from '@/lib/api-client';
import { formatDay } from '@/modules/employees/format';
import { useAsyncData } from '@/modules/employees/hooks/use-async-data';
import type { Session } from '@/modules/employees/permissions';
import { getEmployeeNames } from '@/modules/attendance/api';
import { todayIn } from '@/modules/shared/datetime';
import { StatGridSkeleton } from '@/components/shared/page-skeletons';
import { QueryBoundary, Section, SessionGate } from '@/modules/shared/page-state';
import {
  adjustBalance,
  applyForLeave,
  cancelRequest,
  createLeaveType,
  decideRequest,
  listBalances,
  listLeaveTypes,
  listRequests,
  PAGE_SIZE,
  updateLeaveType,
} from './api';
import { LeaveCalendarSection } from './leave-calendar';

type LeaveRequest = z.infer<typeof leaveRequestSchema>;
type LeaveType = z.infer<typeof leaveTypeSchema>;

const STATUS_LABEL = { PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled' } as const;
const STATUS_VARIANT = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger', CANCELLED: 'neutral' } as const;
const dayLabel = (r: Pick<LeaveRequest, 'dayType' | 'halfDaySession'>) =>
  r.dayType === 'HALF_DAY' ? (r.halfDaySession === 'SECOND_HALF' ? 'Half day (second half)' : 'Half day (first half)') : 'Full day';

/** Validation issues -> field messages. */
function fieldErrors(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const k = String(i.path[0] ?? 'form');
    if (!(k in out)) out[k] = i.message;
  }
  return out;
}

export function LeavePage() {
  return <SessionGate skeleton="sections">{(session) => <LeaveBody session={session} />}</SessionGate>;
}

function LeaveBody({ session }: { session: Session }) {
  const can = (p: Parameters<typeof hasPermission>[1]) => hasPermission(session, p);
  const canApprove = can(PERMISSIONS.LEAVE_APPROVE);
  const canManageTypes = can(PERMISSIONS.LEAVE_TYPE_WRITE);
  const canRead = can(PERMISSIONS.LEAVE_READ_SELF) || can(PERMISSIONS.LEAVE_READ_TEAM) || can(PERMISSIONS.LEAVE_READ_ALL);
  if (!canRead) return <EmptyState title="No access" description="Your role cannot view leave." />;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader description="Apply for leave, track requests and approve your team's leave." />
      {session.employeeId ? <BalancesSection session={session} /> : null}
      {canApprove ? <ApprovalsSection session={session} /> : null}
      <HistorySection session={session} />
      <LeaveCalendarSection session={session} />
      {canManageTypes ? <TypesSection /> : null}
    </div>
  );
}

/* ---------------- Balances (LEAVE-002) ---------------- */

function BalancesSection({ session }: { session: Session }) {
  const canAdjust = hasPermission(session, PERMISSIONS.LEAVE_BALANCE_ADJUST);
  const canSeeOthers =
    hasPermission(session, PERMISSIONS.LEAVE_READ_ALL) || hasPermission(session, PERMISSIONS.LEAVE_READ_TEAM);
  const [employeeId, setEmployeeId] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const names = useAsyncData('leave:names', getEmployeeNames, canSeeOthers || canAdjust);
  const target = employeeId || undefined;
  const q = useAsyncData(`leave:balances:${target ?? 'me'}`, () => listBalances(target));
  return (
    <Section
      title="Leave balances"
      action={
        canAdjust ? (
          <Button size="sm" variant="secondary" icon={<SlidersHorizontal aria-hidden />} onClick={() => setAdjusting(true)}>
            Adjust balance
          </Button>
        ) : undefined
      }
    >
      {canSeeOthers ? (
        <div className="mb-4 max-w-xs">
          <SelectField label="Employee" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">Me</option>
            {(names.data ?? [])
              .filter((n) => n.id !== session.employeeId)
              .map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
          </SelectField>
        </div>
      ) : null}
      <QueryBoundary query={q} title="Could not load leave balances." fallback={<StatGridSkeleton />}>
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState title="No balances yet" description="Balances are created when leave is first applied or adjusted." />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {rows.map((b) => (
                <StatCard
                  key={b.leaveTypeId}
                  label={`${b.leaveTypeName ?? 'Leave'} available`}
                  value={b.available}
                  comparison={{ direction: 'flat', value: `${b.used} used`, label: `· ${b.pending} pending · ${b.allocated + b.adjusted} total` }}
                />
              ))}
            </div>
          )
        }
      </QueryBoundary>
      {adjusting ? (
        <AdjustDialog
          employees={names.data ?? []}
          onClose={() => setAdjusting(false)}
          onDone={() => {
            setAdjusting(false);
            q.reload();
          }}
        />
      ) : null}
    </Section>
  );
}

function AdjustDialog({
  employees,
  onClose,
  onDone,
}: {
  employees: { id: string; name: string }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const types = useAsyncData('leave:types', listLeaveTypes);
  const [employeeId, setEmployeeId] = useState('');
  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const act = useAction(adjustBalance);
  async function submit() {
    const parsed = adjustLeaveBalanceSchema.safeParse({
      employeeId,
      leaveTypeId,
      year: Number(year),
      amount: amount === '' ? NaN : Number(amount),
      reason,
    });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error.issues));
    setErrors({});
    const r = await act.run(parsed.data);
    if (r.ok) onDone();
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title="Adjust leave balance"
      description="Use a negative number to reduce the balance. The change and your reason are audit-logged."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={act.pending} onClick={submit}>Save adjustment</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <SelectField label="Employee" required value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} error={errors.employeeId}>
          <option value="">Select an employee</option>
          {employees.map((n) => (<option key={n.id} value={n.id}>{n.name}</option>))}
        </SelectField>
        <SelectField label="Leave type" required value={leaveTypeId} onChange={(e) => setLeaveTypeId(e.target.value)} error={errors.leaveTypeId}>
          <option value="">Select a leave type</option>
          {(types.data ?? []).map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
        </SelectField>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Year" type="number" required value={year} onChange={(e) => setYear(e.target.value)} error={errors.year} />
          <Field label="Days (+/-)" type="number" step="0.5" required value={amount} onChange={(e) => setAmount(e.target.value)} error={errors.amount} />
        </div>
        <Field label="Reason" multiline required value={reason} onChange={(e) => setReason((e.target as unknown as HTMLTextAreaElement).value)} error={errors.reason} />
        {act.error ? <Alert variant="danger">{act.error.message}</Alert> : null}
      </div>
    </Dialog>
  );
}

/* ---------------- Approvals (LEAVE-005, LEAVE-006) ---------------- */

function ApprovalsSection({ session }: { session: Session }) {
  const [page, setPage] = useState(1);
  const names = useAsyncData('leave:appr-names', getEmployeeNames);
  const nameOf = useMemo(() => new Map((names.data ?? []).map((n) => [n.id, n.name])), [names.data]);
  const q = useAsyncData(`leave:pending:${page}`, () => listRequests({ pendingForMe: true, page }));
  const [deciding, setDeciding] = useState<{ req: LeaveRequest; status: 'APPROVED' | 'REJECTED' } | null>(null);
  // Own requests are never decided by their owner (PRD LEAVE-005); the API enforces this as well.
  const rows = (q.data?.data ?? []).filter((r) => r.employeeId !== session.employeeId);
  const total = q.data?.page?.total ?? 0;
  return (
    <Section title="Pending approvals">
      {q.status === 'error' ? (
        <ErrorState title="Could not load pending requests." message={describeApiError(q.error)} onRetry={q.reload} />
      ) : (
        <>
          <Table label="Pending leave requests">
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead align="right">Days</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead align="right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.status !== 'success' ? (
                <TableSkeleton columns={6} />
              ) : rows.length === 0 ? (
                <TableEmpty colSpan={6}>
                  <EmptyState title="Nothing to approve" description="Requests waiting for your decision appear here." />
                </TableEmpty>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{nameOf.get(r.employeeId) ?? 'Employee'}</TableCell>
                    <TableCell>{r.leaveTypeName ?? 'Leave'}<span className="block text-small text-muted">{dayLabel(r)}</span></TableCell>
                    <TableCell>{formatDay(r.startDate.slice(0, 10))}{r.endDate !== r.startDate ? ` – ${formatDay(r.endDate.slice(0, 10))}` : ''}</TableCell>
                    <TableCell numeric align="right">{r.days}</TableCell>
                    <TableCell>{r.reason}</TableCell>
                    <TableCell align="right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="secondary" onClick={() => setDeciding({ req: r, status: 'APPROVED' })}>Approve</Button>
                        <Button size="sm" variant="destructive" onClick={() => setDeciding({ req: r, status: 'REJECTED' })}>Reject</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {q.status === 'success' && total > PAGE_SIZE ? (
            <div className="mt-4">
              <CursorPagination page={page} count={q.data?.data.length ?? 0} hasPrevious={page > 1} hasNext={page * PAGE_SIZE < total} onPrevious={() => setPage((p) => Math.max(1, p - 1))} onNext={() => setPage((p) => p + 1)} noun="requests" />
            </div>
          ) : null}
        </>
      )}
      {deciding ? (
        <DecisionDialog
          target={deciding}
          onClose={() => setDeciding(null)}
          onDone={() => {
            setDeciding(null);
            q.reload();
          }}
        />
      ) : null}
    </Section>
  );
}

function DecisionDialog({
  target,
  onClose,
  onDone,
}: {
  target: { req: LeaveRequest; status: 'APPROVED' | 'REJECTED' };
  onClose: () => void;
  onDone: () => void;
}) {
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string>();
  const act = useAction(decideRequest);
  const reject = target.status === 'REJECTED';
  async function submit() {
    if (reject && !comment.trim()) return setError('A comment is required when rejecting.');
    setError(undefined);
    const r = await act.run(target.req.id, { status: target.status, comment: comment.trim() || undefined });
    if (r.ok) onDone();
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={reject ? 'Reject leave request' : 'Approve leave request'}
      description={reject ? 'The reserved days are released. Tell the employee why.' : 'The days are deducted from the balance.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant={reject ? 'destructive' : 'primary'} loading={act.pending} onClick={submit}>{reject ? 'Reject' : 'Approve'}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={reject ? 'Comment' : 'Comment (optional)'} multiline required={reject} value={comment} onChange={(e) => setComment((e.target as unknown as HTMLTextAreaElement).value)} error={error} />
        {act.error ? <Alert variant="danger">{act.error.message}</Alert> : null}
      </div>
    </Dialog>
  );
}

/* ---------------- History, apply, cancel (LEAVE-003, LEAVE-007, LEAVE-008) ---------------- */

function HistorySection({ session }: { session: Session }) {
  const company = useCompany();
  const today = todayIn(company?.timezone);
  const canApply = hasPermission(session, PERMISSIONS.LEAVE_APPLY);
  const readAll = hasPermission(session, PERMISSIONS.LEAVE_READ_ALL);
  const readTeam = hasPermission(session, PERMISSIONS.LEAVE_READ_TEAM);
  const canCancelAny = hasPermission(session, PERMISSIONS.LEAVE_CANCEL_ANY);
  const canCancelOwn = hasPermission(session, PERMISSIONS.LEAVE_CANCEL_OWN);
  const wide = (readAll || readTeam) && true;
  const [scope, setScope] = useState<'mine' | 'all'>(session.employeeId ? 'mine' : 'all');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [applying, setApplying] = useState(false);
  const names = useAsyncData('leave:hist-names', getEmployeeNames, wide);
  const nameOf = useMemo(() => new Map((names.data ?? []).map((n) => [n.id, n.name])), [names.data]);
  const employeeId = scope === 'mine' ? (session.employeeId ?? undefined) : undefined;
  const q = useAsyncData(`leave:hist:${scope}:${status}:${page}`, () =>
    listRequests({ employeeId, status: status ? [status] : undefined, page }),
  );
  const cancel = useAction(cancelRequest);
  const total = q.data?.page?.total ?? 0;

  async function doCancel(id: string) {
    const r = await cancel.run(id);
    if (r.ok) q.reload();
  }
  const canCancel = (r: LeaveRequest) => {
    if (r.status !== 'PENDING' && r.status !== 'APPROVED') return false;
    if (canCancelAny) return true;
    const own = r.employeeId === session.employeeId && canCancelOwn;
    return own && (r.status === 'PENDING' || r.startDate.slice(0, 10) > today);
  };

  return (
    <Section
      title="Leave requests"
      action={
        canApply && session.employeeId ? (
          <Button size="sm" icon={<Plus aria-hidden />} onClick={() => setApplying(true)}>
            Apply for leave
          </Button>
        ) : undefined
      }
    >
      <div role="search" aria-label="Leave filters" className="mb-4 flex flex-wrap items-end gap-3">
        {wide && session.employeeId ? (
          <SelectField label="Show" value={scope} onChange={(e) => { setScope(e.target.value as 'mine' | 'all'); setPage(1); }}>
            <option value="mine">My requests</option>
            <option value="all">{readAll ? 'All requests' : 'My team'}</option>
          </SelectField>
        ) : null}
        <SelectField label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
        </SelectField>
      </div>
      {cancel.error ? <div className="mb-3"><Alert variant="danger">{cancel.error.message}</Alert></div> : null}
      {q.status === 'error' ? (
        <ErrorState title="Could not load leave requests." message={describeApiError(q.error)} onRetry={q.reload} />
      ) : (
        <>
          <Table label="Leave requests">
            <TableHeader>
              <TableRow>
                {scope === 'all' ? <TableHead>Employee</TableHead> : null}
                <TableHead>Type</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead align="right">Days</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead align="right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.status !== 'success' ? (
                <TableSkeleton columns={scope === 'all' ? 7 : 6} />
              ) : q.data && q.data.data.length === 0 ? (
                <TableEmpty colSpan={scope === 'all' ? 7 : 6}>
                  <EmptyState title="No leave requests" description={status ? 'No request has this status.' : 'Requests appear here once leave is applied for.'} />
                </TableEmpty>
              ) : (
                q.data?.data.map((r) => (
                  <TableRow key={r.id}>
                    {scope === 'all' ? <TableCell>{nameOf.get(r.employeeId) ?? 'Employee'}</TableCell> : null}
                    <TableCell>{r.leaveTypeName ?? 'Leave'}<span className="block text-small text-muted">{dayLabel(r)}</span></TableCell>
                    <TableCell>{formatDay(r.startDate.slice(0, 10))}{r.endDate !== r.startDate ? ` – ${formatDay(r.endDate.slice(0, 10))}` : ''}</TableCell>
                    <TableCell numeric align="right">{r.days}</TableCell>
                    <TableCell><Badge variant={STATUS_VARIANT[r.status]}>{STATUS_LABEL[r.status]}</Badge></TableCell>
                    <TableCell>
                      {r.reason}
                      {r.decisionComment ? <span className="block text-small text-muted">Decision: {r.decisionComment}</span> : null}
                    </TableCell>
                    <TableCell align="right">
                      {canCancel(r) ? (
                        <Button size="sm" variant="secondary" loading={cancel.pending} onClick={() => doCancel(r.id)}>Cancel</Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {q.status === 'success' && total > PAGE_SIZE ? (
            <div className="mt-4">
              <CursorPagination page={page} count={q.data?.data.length ?? 0} hasPrevious={page > 1} hasNext={page * PAGE_SIZE < total} onPrevious={() => setPage((p) => Math.max(1, p - 1))} onNext={() => setPage((p) => p + 1)} noun="requests" />
            </div>
          ) : null}
        </>
      )}
      {applying ? (
        <ApplyDialog
          today={today}
          onClose={() => setApplying(false)}
          onDone={() => {
            setApplying(false);
            q.reload();
          }}
        />
      ) : null}
    </Section>
  );
}

function ApplyDialog({ today, onClose, onDone }: { today: string; onClose: () => void; onDone: () => void }) {
  const types = useAsyncData('leave:types', listLeaveTypes);
  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [dayType, setDayType] = useState<'FULL_DAY' | 'HALF_DAY'>('FULL_DAY');
  const [session, setSession] = useState<'FIRST_HALF' | 'SECOND_HALF'>('FIRST_HALF');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const act = useAction(applyForLeave);
  const active = (types.data ?? []).filter((t: LeaveType) => t.isActive);
  const chosen = active.find((t) => t.id === leaveTypeId);
  const half = dayType === 'HALF_DAY';

  async function submit() {
    const body = {
      leaveTypeId,
      startDate,
      endDate: half ? startDate : endDate,
      dayType,
      halfDaySession: half ? session : null,
      reason,
    };
    const parsed = createLeaveRequestSchema.safeParse(body);
    const next = parsed.success ? {} : fieldErrors(parsed.error.issues);
    if (!next.endDate && body.endDate < body.startDate) next.endDate = 'End date must be on or after the start date.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const r = await act.run(body);
    if (r.ok) onDone();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Apply for leave"
      description="Weekends and holidays are not counted. The server checks your balance and any overlap."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={act.pending} onClick={submit}>Submit request</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {types.status === 'error' ? <Alert variant="danger">{describeApiError(types.error)}</Alert> : null}
        <SelectField label="Leave type" required value={leaveTypeId} onChange={(e) => { setLeaveTypeId(e.target.value); if (!active.find((t) => t.id === e.target.value)?.allowHalfDay) setDayType('FULL_DAY'); }} error={errors.leaveTypeId}>
          <option value="">Select a leave type</option>
          {active.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
        </SelectField>
        <SelectField label="Duration" value={dayType} onChange={(e) => setDayType(e.target.value as 'FULL_DAY' | 'HALF_DAY')} disabled={chosen ? !chosen.allowHalfDay : false} helper={chosen && !chosen.allowHalfDay ? 'This leave type does not allow half days.' : undefined}>
          <option value="FULL_DAY">Full day(s)</option>
          <option value="HALF_DAY">Half day</option>
        </SelectField>
        {half ? (
          <SelectField label="Half" value={session} onChange={(e) => setSession(e.target.value as 'FIRST_HALF' | 'SECOND_HALF')} error={errors.halfDaySession}>
            <option value="FIRST_HALF">First half</option>
            <option value="SECOND_HALF">Second half</option>
          </SelectField>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <Field label={half ? 'Date' : 'Start date'} type="date" required value={startDate} onChange={(e) => { setStartDate(e.target.value); if (endDate < e.target.value) setEndDate(e.target.value); }} error={errors.startDate} />
          {half ? null : <Field label="End date" type="date" required value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} error={errors.endDate} />}
        </div>
        <Field label="Reason" multiline required value={reason} onChange={(e) => setReason((e.target as unknown as HTMLTextAreaElement).value)} error={errors.reason} />
        {act.error ? <Alert variant="danger">{act.error.message}</Alert> : null}
      </div>
    </Dialog>
  );
}

/* ---------------- Leave types (LEAVE-001) ---------------- */

function TypesSection() {
  const q = useAsyncData('leave:types-admin', listLeaveTypes);
  const [editing, setEditing] = useState<LeaveType | 'new' | null>(null);
  return (
    <Section
      title="Leave types"
      action={<Button size="sm" variant="secondary" icon={<Plus aria-hidden />} onClick={() => setEditing('new')}>Add leave type</Button>}
    >
      <QueryBoundary query={q} title="Could not load leave types.">
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState title="No leave types" description="Add the leave types your company offers." />
          ) : (
            <Table label="Leave types">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead align="right">Days per year</TableHead>
                  <TableHead>Paid</TableHead>
                  <TableHead>Half day</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead align="right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>{t.name}</TableCell>
                    <TableCell numeric align="right">{t.annualAllocation}</TableCell>
                    <TableCell>{t.isPaid ? 'Paid' : 'Unpaid'}</TableCell>
                    <TableCell>{t.allowHalfDay ? 'Allowed' : 'Not allowed'}</TableCell>
                    <TableCell><Badge variant={t.isActive ? 'success' : 'neutral'}>{t.isActive ? 'Active' : 'Archived'}</Badge></TableCell>
                    <TableCell align="right"><Button size="sm" variant="secondary" onClick={() => setEditing(t)}>Edit</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )
        }
      </QueryBoundary>
      {editing ? (
        <TypeDialog
          type={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            q.reload();
          }}
        />
      ) : null}
    </Section>
  );
}

function TypeDialog({ type, onClose, onDone }: { type: LeaveType | null; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(type?.name ?? '');
  const [days, setDays] = useState(String(type?.annualAllocation ?? 0));
  const [isPaid, setIsPaid] = useState(type?.isPaid ?? true);
  const [allowHalfDay, setAllowHalfDay] = useState(type?.allowHalfDay ?? true);
  const [isActive, setIsActive] = useState(type?.isActive ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const act = useAction(async (body: Parameters<typeof createLeaveType>[0] & { isActive?: boolean }) =>
    type ? updateLeaveType(type.id, body) : createLeaveType(body),
  );
  async function submit() {
    const body = { name, annualAllocation: days === '' ? NaN : Number(days), isPaid, allowHalfDay };
    const parsed = createLeaveTypeSchema.safeParse(body);
    if (!parsed.success) return setErrors(fieldErrors(parsed.error.issues));
    setErrors({});
    const r = await act.run(type ? { ...parsed.data, isActive } : parsed.data);
    if (r.ok) onDone();
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={type ? 'Edit leave type' : 'Add leave type'}
      description="Names are unique. Types in use are archived rather than deleted."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={act.pending} onClick={submit}>{type ? 'Save changes' : 'Add leave type'}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" required value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />
        <Field label="Days per year" type="number" step="0.5" required value={days} onChange={(e) => setDays(e.target.value)} error={errors.annualAllocation} />
        <label className="flex items-center gap-2 text-body text-ink"><input type="checkbox" checked={isPaid} onChange={(e) => setIsPaid(e.target.checked)} /> Paid leave</label>
        <label className="flex items-center gap-2 text-body text-ink"><input type="checkbox" checked={allowHalfDay} onChange={(e) => setAllowHalfDay(e.target.checked)} /> Allow half days</label>
        {type ? <label className="flex items-center gap-2 text-body text-ink"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Active (uncheck to archive)</label> : null}
        {act.error ? <Alert variant="danger">{act.error.message}</Alert> : null}
      </div>
    </Dialog>
  );
}
