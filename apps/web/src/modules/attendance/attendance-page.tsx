'use client';

import {
  createAttendanceCorrectionSchema,
  manualAttendanceCorrectionSchema,
  type attendanceOverviewStatusSchema,
} from '@gsc/contracts';
import type { z } from 'zod';
import { Clock, LogIn, LogOut, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { CursorPagination } from '@/components/ui/pagination';
import { SelectField } from '@/components/ui/select';
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
import { ErrorState } from '@/components/shared/data-states';
import { useAction } from '@/hooks/use-action';
import { hasPermission, PERMISSIONS, useCompany } from '@/hooks/use-session';
import { describeApiError } from '@/lib/api-client';
import { formatDay } from '@/modules/employees/format';
import { useAsyncData } from '@/modules/employees/hooks/use-async-data';
import type { Session } from '@/modules/employees/permissions';
import { addDays, formatHours, formatTime, MONTHS, todayIn } from '@/modules/shared/datetime';
import { QueryBoundary, Section, SessionGate } from '@/modules/shared/page-state';
import {
  checkIn,
  checkOut,
  getEmployeeNames,
  getHistory,
  getOverview,
  getToday,
  listCorrections,
  OVERVIEW_PAGE_SIZE,
  PAGE_SIZE,
  requestCorrection,
  reviewCorrection,
  submitManualCorrection,
} from './api';

export function AttendancePage() {
  return <SessionGate>{(session) => <AttendanceBody session={session} />}</SessionGate>;
}

function AttendanceBody({ session }: { session: Session }) {
  const can = (p: Parameters<typeof hasPermission>[1]) => hasPermission(session, p);
  const canCheck = can(PERMISSIONS.ATTENDANCE_CHECK);
  const canSeeOthers = can(PERMISSIONS.ATTENDANCE_READ_ALL) || can(PERMISSIONS.ATTENDANCE_READ_TEAM);
  const canRead = canSeeOthers || can(PERMISSIONS.ATTENDANCE_READ_SELF);
  const company = useCompany();
  if (!canRead && !canCheck) {
    return <EmptyState title="No access" description="Your role cannot view attendance." />;
  }
  return (
    <div className="flex flex-col gap-6">
      <PageHeader description="Check in and out, review attendance history and handle correction requests." />
      {canCheck ? <TodayCard tz={company?.timezone} /> : null}
      {can(PERMISSIONS.ATTENDANCE_READ_ALL) ? (
        <OverviewSection canCorrect={can(PERMISSIONS.ATTENDANCE_CORRECT_MANUAL)} tz={company?.timezone} />
      ) : null}
      <HistorySection session={session} canSeeOthers={canSeeOthers} tz={company?.timezone} />
      <CorrectionsSection session={session} tz={company?.timezone} />
    </div>
  );
}

/* ---------------- Today (ATT-001, ATT-002) ---------------- */

const STATE_LABEL = { NOT_CHECKED_IN: 'Not checked in', CHECKED_IN: 'Checked in', DONE: 'Done for today' } as const;

export function TodayCard({ tz }: { tz?: string }) {
  const q = useAsyncData('att:today', getToday);
  const act = useAction(async (kind: 'in' | 'out') => (kind === 'in' ? checkIn() : checkOut()));
  async function click(kind: 'in' | 'out') {
    const r = await act.run(kind);
    if (r.ok) q.reload();
  }
  return (
    <Section title="Today">
      <QueryBoundary query={q} title="Could not load today's attendance.">
        {(t) => (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant={t.state === 'DONE' ? 'success' : t.state === 'CHECKED_IN' ? 'info' : 'neutral'}>
                {STATE_LABEL[t.state]}
              </Badge>
              <span className="text-body text-muted">
                {formatDay(t.date)} · In {formatTime(t.record?.checkInAt, tz)} · Out {formatTime(t.record?.checkOutAt, tz)}
              </span>
            </div>
            <div className="flex flex-wrap gap-3">
              {t.state === 'NOT_CHECKED_IN' ? (
                <Button icon={<LogIn aria-hidden />} loading={act.pending} onClick={() => click('in')}>
                  Check in
                </Button>
              ) : null}
              {t.state === 'CHECKED_IN' ? (
                <Button icon={<LogOut aria-hidden />} loading={act.pending} onClick={() => click('out')}>
                  Check out
                </Button>
              ) : null}
              {t.state === 'DONE' ? (
                <Button icon={<Clock aria-hidden />} disabled>
                  Done for today
                </Button>
              ) : null}
            </div>
            {act.error ? <Alert variant="danger">{act.error.message}</Alert> : null}
          </div>
        )}
      </QueryBoundary>
    </Section>
  );
}

/* ---------------- HR overview by date (ATT-004) and manual correction (ATT-007) ---------------- */

type OverviewStatus = z.infer<typeof attendanceOverviewStatusSchema>;
const OVERVIEW_LABEL: Record<OverviewStatus, string> = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  ON_LEAVE: 'On leave',
  HOLIDAY: 'Holiday',
  WEEKEND: 'Non-working day',
  NOT_YET_IN: 'Not yet in',
  MISSING_CHECKOUT: 'Missing check-out',
};
const OVERVIEW_VARIANT: Record<OverviewStatus, 'success' | 'danger' | 'info' | 'neutral' | 'warning'> = {
  PRESENT: 'success',
  ABSENT: 'danger',
  ON_LEAVE: 'info',
  HOLIDAY: 'neutral',
  WEEKEND: 'neutral',
  NOT_YET_IN: 'neutral',
  MISSING_CHECKOUT: 'warning',
};

function OverviewSection({ canCorrect, tz }: { canCorrect: boolean; tz?: string }) {
  const today = todayIn(tz);
  const [date, setDate] = useState(today);
  const [status, setStatus] = useState<OverviewStatus | ''>('');
  const [page, setPage] = useState(1);
  const [correcting, setCorrecting] = useState<{ employeeId?: string; date: string } | null>(null);
  const q = useAsyncData(`att:overview:${date}:${status}:${page}`, () => getOverview({ date, status: status || undefined, page }));
  const total = q.data?.page.total ?? 0;
  const summary = q.data?.summary;
  const columns = canCorrect ? 6 : 5;

  return (
    <Section
      title="Attendance by date"
      action={
        canCorrect ? (
          <Button size="sm" variant="secondary" icon={<Plus aria-hidden />} onClick={() => setCorrecting({ date })}>
            Correct attendance
          </Button>
        ) : undefined
      }
    >
      <div role="search" aria-label="Overview filters" className="mb-4 flex flex-wrap items-end gap-3">
        <Field
          label="Date"
          type="date"
          value={date}
          max={today}
          onChange={(e) => {
            if (e.target.value) {
              setDate(e.target.value);
              setPage(1);
            }
          }}
        />
        <SelectField
          label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as OverviewStatus | '');
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          {(Object.keys(OVERVIEW_LABEL) as OverviewStatus[]).map((s) => (
            <option key={s} value={s}>
              {OVERVIEW_LABEL[s]}
            </option>
          ))}
        </SelectField>
      </div>

      {q.status === 'error' ? (
        <ErrorState title="Could not load the attendance overview." message={describeApiError(q.error)} onRetry={q.reload} />
      ) : (
        <>
          {summary ? (
            <p className="mb-3 text-small text-muted">
              {q.data?.meta.isHoliday ? `Holiday: ${q.data.meta.holidayName ?? ''} · ` : q.data && !q.data.meta.isWorkingDay ? 'Non-working day · ' : ''}
              Present {summary.PRESENT ?? 0} · Absent {summary.ABSENT ?? 0} · On leave {summary.ON_LEAVE ?? 0} · Not yet in{' '}
              {summary.NOT_YET_IN ?? 0} · Missing check-out {summary.MISSING_CHECKOUT ?? 0}
            </p>
          ) : null}
          <Table label="Attendance overview">
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Check in</TableHead>
                <TableHead>Check out</TableHead>
                {canCorrect ? <TableHead align="right">Action</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.status !== 'success' ? (
                <TableSkeleton columns={columns} />
              ) : q.data && q.data.data.length === 0 ? (
                <TableEmpty colSpan={columns}>
                  <EmptyState title="No employees to show" description="No employee matches this date and status." />
                </TableEmpty>
              ) : (
                q.data?.data.map((r) => (
                  <TableRow key={r.employeeId}>
                    <TableCell>
                      {r.name}
                      <span className="block text-small text-muted">{r.employeeNumber}</span>
                    </TableCell>
                    <TableCell>{r.departmentName ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={OVERVIEW_VARIANT[r.status]}>{OVERVIEW_LABEL[r.status]}</Badge>
                      {r.halfDayLeave ? <span className="block text-small text-muted">Half-day leave</span> : null}
                      {r.corrected ? <span className="block text-small text-muted">Corrected</span> : null}
                    </TableCell>
                    <TableCell>{formatTime(r.checkInAt, tz)}</TableCell>
                    <TableCell>{formatTime(r.checkOutAt, tz)}</TableCell>
                    {canCorrect ? (
                      <TableCell align="right">
                        <Button size="sm" variant="secondary" onClick={() => setCorrecting({ employeeId: r.employeeId, date })}>
                          Correct
                        </Button>
                      </TableCell>
                    ) : null}
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
                hasNext={page * OVERVIEW_PAGE_SIZE < total}
                onPrevious={() => setPage((p) => Math.max(1, p - 1))}
                onNext={() => setPage((p) => p + 1)}
                noun="employees"
              />
            </div>
          ) : null}
        </>
      )}

      {correcting ? (
        <ManualCorrectionDialog
          tz={tz}
          initial={correcting}
          onClose={() => setCorrecting(null)}
          onDone={() => {
            setCorrecting(null);
            q.reload();
          }}
        />
      ) : null}
    </Section>
  );
}

function ManualCorrectionDialog({
  tz,
  initial,
  onClose,
  onDone,
}: {
  tz?: string;
  initial: { employeeId?: string; date: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const names = useAsyncData('att:manual-names', getEmployeeNames);
  const [employeeId, setEmployeeId] = useState(initial.employeeId ?? '');
  const [date, setDate] = useState(initial.date);
  const [inTime, setInTime] = useState('');
  const [outTime, setOutTime] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const act = useAction(submitManualCorrection);

  async function submit() {
    const next: Record<string, string> = {};
    if (!employeeId) next.employeeId = 'Choose an employee.';
    if (!inTime && !outTime) next.checkInAt = 'Enter a check-in time, a check-out time or both.';
    if (inTime && outTime && outTime <= inTime) next.checkOutAt = 'Check-out must be after check-in.';
    const body = {
      employeeId,
      date,
      ...(inTime ? { checkInAt: zonedToIso(date, inTime, tz) } : {}),
      ...(outTime ? { checkOutAt: zonedToIso(date, outTime, tz) } : {}),
      reason,
    };
    const parsed = manualAttendanceCorrectionSchema.safeParse(body);
    if (!parsed.success) for (const i of parsed.error.issues) next[String(i.path[0])] ??= i.message;
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const r = await act.run(body);
    if (r.ok) onDone();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Correct attendance"
      description="Set the check-in and check-out for an employee on a date. Leave a time empty to keep it as it is. The original values, your name and the reason are kept in the audit log."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={act.pending} onClick={submit}>
            Save correction
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <SelectField label="Employee" required value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} error={errors.employeeId}>
          <option value="">Select an employee</option>
          {(names.data ?? []).map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </SelectField>
        <Field label="Date" type="date" required value={date} max={todayIn(tz)} onChange={(e) => setDate(e.target.value)} error={errors.date} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Check in" type="time" value={inTime} onChange={(e) => setInTime(e.target.value)} error={errors.checkInAt} />
          <Field label="Check out" type="time" value={outTime} onChange={(e) => setOutTime(e.target.value)} error={errors.checkOutAt} />
        </div>
        <Field label="Reason" multiline required value={reason} onChange={(e) => setReason((e.target as unknown as HTMLTextAreaElement).value)} error={errors.reason} />
        {act.error ? <Alert variant="danger">{act.error.message}</Alert> : null}
      </div>
    </Dialog>
  );
}

/* ---------------- History (ATT-003) ---------------- */

/** Every day of the month with its status; the totals above are counted from exactly these rows. */
function MonthDays({ days, tz }: { days: NonNullable<Awaited<ReturnType<typeof getHistory>>['days']>; tz?: string }) {
  return (
    <Table label="Attendance records">
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Check in</TableHead>
          <TableHead>Check out</TableHead>
          <TableHead align="right">Hours</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {days.length === 0 ? (
          <TableEmpty colSpan={5}>
            <EmptyState title="No attendance records" description="Nothing was recorded for this month." />
          </TableEmpty>
        ) : (
          [...days].reverse().map((d) => (
            <TableRow key={d.date}>
              <TableCell>{formatDay(d.date)}</TableCell>
              <TableCell>{formatTime(d.checkInAt, tz)}</TableCell>
              <TableCell>{formatTime(d.checkOutAt, tz)}</TableCell>
              <TableCell numeric align="right">{formatHours(d.workedMinutes === null ? null : d.workedMinutes / 60)}</TableCell>
              <TableCell>
                <Badge variant={OVERVIEW_VARIANT[d.status]}>{OVERVIEW_LABEL[d.status]}</Badge>
                {d.holidayName ? <span className="block text-small text-muted">{d.holidayName}</span> : null}
                {d.halfDayLeave ? <span className="block text-small text-muted">Half-day leave</span> : null}
                {d.corrected ? <span className="block text-small text-muted">Corrected</span> : null}
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

function HistorySection({ session, canSeeOthers, tz }: { session: Session; canSeeOthers: boolean; tz?: string }) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [employeeId, setEmployeeId] = useState('');
  const [page, setPage] = useState(1);
  const names = useAsyncData('att:names', getEmployeeNames, canSeeOthers);
  const target = employeeId || undefined;
  const q = useAsyncData(`att:hist:${target ?? 'me'}:${year}-${month}:${page}`, () =>
    getHistory({ employeeId: target, month, year, page }),
  );
  const total = q.data?.page?.total ?? 0;
  const years = [year - 1, year, year + 1].filter((y, i, a) => a.indexOf(y) === i);

  return (
    <Section title="Attendance history">
      <div role="search" aria-label="Attendance filters" className="mb-4 flex flex-wrap items-end gap-3">
        {canSeeOthers ? (
          <SelectField
            label="Employee"
            value={employeeId}
            onChange={(e) => {
              setEmployeeId(e.target.value);
              setPage(1);
            }}
            containerClassName="min-w-[200px]"
          >
            <option value="">{session.employeeId ? 'Me' : 'Select an employee'}</option>
            {(names.data ?? [])
              .filter((n) => n.id !== session.employeeId)
              .map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
          </SelectField>
        ) : null}
        <SelectField
          label="Month"
          value={month}
          onChange={(e) => {
            setMonth(Number(e.target.value));
            setPage(1);
          }}
        >
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Year"
          value={year}
          onChange={(e) => {
            setYear(Number(e.target.value));
            setPage(1);
          }}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </SelectField>
      </div>

      {q.status === 'error' ? (
        <ErrorState title="Could not load attendance." message={describeApiError(q.error)} onRetry={q.reload} />
      ) : (
        <>
          {q.data?.summary ? (
            <p className="mb-3 text-small text-muted">
              Present {q.data.summary.present} · Absent {q.data.summary.absent} · On leave {q.data.summary.onLeave} ·
              Holidays {q.data.summary.holidays} · Hours {formatHours(q.data.summary.hoursWorked)}
              {q.data.summary.missingCheckout ? ` · Missing check-out ${q.data.summary.missingCheckout}` : ''}
            </p>
          ) : null}
          {q.data?.days ? (
            <MonthDays days={q.data.days} tz={tz} />
          ) : (
          <Table label="Attendance records">
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Check in</TableHead>
                <TableHead>Check out</TableHead>
                <TableHead align="right">Hours</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.status !== 'success' ? (
                <TableSkeleton columns={5} />
              ) : q.data && q.data.data.length === 0 ? (
                <TableEmpty colSpan={5}>
                  <EmptyState title="No attendance records" description="Nothing was recorded for this month." />
                </TableEmpty>
              ) : (
                q.data?.data.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{formatDay(r.date.slice(0, 10))}</TableCell>
                    <TableCell>{formatTime(r.checkInAt, tz)}</TableCell>
                    <TableCell>{formatTime(r.checkOutAt, tz)}</TableCell>
                    <TableCell numeric align="right">{formatHours(r.workedHours)}</TableCell>
                    <TableCell>
                      {r.checkInAt && !r.checkOutAt ? 'Missing check-out' : r.checkInAt ? 'Present' : '—'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          )}
          {q.status === 'success' && !q.data?.days && total > 0 ? (
            <div className="mt-4">
              <CursorPagination
                page={page}
                count={q.data?.data.length ?? 0}
                hasPrevious={page > 1}
                hasNext={page * PAGE_SIZE < total}
                onPrevious={() => setPage((p) => Math.max(1, p - 1))}
                onNext={() => setPage((p) => p + 1)}
                noun="records"
              />
            </div>
          ) : null}
        </>
      )}
    </Section>
  );
}

/* ---------------- Corrections (ATT-005, ATT-006) ---------------- */

const CORRECTION_LABEL = { PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected' } as const;
const CORRECTION_VARIANT = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger' } as const;

function CorrectionsSection({ session, tz }: { session: Session; tz?: string }) {
  const canRequest = hasPermission(session, PERMISSIONS.ATTENDANCE_CORRECT_REQUEST);
  const canApprove = hasPermission(session, PERMISSIONS.ATTENDANCE_CORRECT_APPROVE);
  const q = useAsyncData('att:corrections', listCorrections);
  const names = useAsyncData('att:corr-names', getEmployeeNames, canApprove);
  const nameOf = useMemo(() => new Map((names.data ?? []).map((n) => [n.id, n.name])), [names.data]);
  const [requesting, setRequesting] = useState(false);
  const [reviewing, setReviewing] = useState<{ id: string; status: 'APPROVED' | 'REJECTED' } | null>(null);

  return (
    <Section
      title="Correction requests"
      action={
        canRequest ? (
          <Button size="sm" icon={<Plus aria-hidden />} onClick={() => setRequesting(true)}>
            Request correction
          </Button>
        ) : undefined
      }
    >
      <QueryBoundary query={q} title="Could not load correction requests.">
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState title="No correction requests" description="Requests to fix a missed or wrong check-in appear here." />
          ) : (
            <Table label="Correction requests">
              <TableHeader>
                <TableRow>
                  {canApprove ? <TableHead>Employee</TableHead> : null}
                  <TableHead>Date</TableHead>
                  <TableHead>Proposed in / out</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Status</TableHead>
                  {canApprove ? <TableHead align="right">Action</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => {
                  const own = c.employeeId === session.employeeId;
                  return (
                    <TableRow key={c.id}>
                      {canApprove ? <TableCell>{nameOf.get(c.employeeId) ?? 'Employee'}</TableCell> : null}
                      <TableCell>{formatDay(c.date.slice(0, 10))}</TableCell>
                      <TableCell>
                        {formatTime(c.proposedCheckInAt, tz)} – {formatTime(c.proposedCheckOutAt, tz)}
                      </TableCell>
                      <TableCell>
                        {c.reason}
                        {c.reviewerComment ? <span className="block text-small text-muted">Reviewer: {c.reviewerComment}</span> : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant={CORRECTION_VARIANT[c.status]}>{CORRECTION_LABEL[c.status]}</Badge>
                      </TableCell>
                      {canApprove ? (
                        <TableCell align="right">
                          {c.status === 'PENDING' && !own ? (
                            <div className="flex justify-end gap-2">
                              <Button size="sm" variant="secondary" onClick={() => setReviewing({ id: c.id, status: 'APPROVED' })}>
                                Approve
                              </Button>
                              <Button size="sm" variant="destructive" onClick={() => setReviewing({ id: c.id, status: 'REJECTED' })}>
                                Reject
                              </Button>
                            </div>
                          ) : null}
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )
        }
      </QueryBoundary>

      {requesting ? (
        <CorrectionDialog
          tz={tz}
          onClose={() => setRequesting(false)}
          onDone={() => {
            setRequesting(false);
            q.reload();
          }}
        />
      ) : null}
      {reviewing ? (
        <ReviewDialog
          target={reviewing}
          onClose={() => setReviewing(null)}
          onDone={() => {
            setReviewing(null);
            q.reload();
          }}
        />
      ) : null}
    </Section>
  );
}

/** Combines a calendar date and a clock time in the company timezone into an ISO instant. */
export function zonedToIso(date: string, time: string, tz: string | undefined): string {
  // Interpret as UTC first, then correct by the zone's offset at that moment.
  const naive = new Date(`${date}T${time}:00.000Z`);
  if (!tz) return new Date(`${date}T${time}:00`).toISOString();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(naive);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asLocal = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'));
  return new Date(naive.getTime() - (asLocal - naive.getTime())).toISOString();
}

function CorrectionDialog({ tz, onClose, onDone }: { tz?: string; onClose: () => void; onDone: () => void }) {
  const today = todayIn(tz);
  const [date, setDate] = useState(() => addDays(today, -1));
  const [inTime, setInTime] = useState('09:00');
  const [outTime, setOutTime] = useState('18:00');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const act = useAction(requestCorrection);

  async function submit() {
    const body = {
      date,
      proposedCheckInAt: zonedToIso(date, inTime, tz),
      proposedCheckOutAt: zonedToIso(date, outTime, tz),
      reason,
    };
    const parsed = createAttendanceCorrectionSchema.safeParse(body);
    const next: Record<string, string> = {};
    if (!parsed.success) for (const i of parsed.error.issues) next[String(i.path[0])] = i.message;
    if (!next.proposedCheckOutAt && new Date(body.proposedCheckOutAt) <= new Date(body.proposedCheckInAt))
      next.proposedCheckOutAt = 'Check-out must be after check-in.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const r = await act.run(body);
    if (r.ok) onDone();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Request an attendance correction"
      description="Corrections can be requested for the last 7 days. Times are in the company timezone."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={act.pending} onClick={submit}>
            Submit request
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label="Date"
          type="date"
          required
          value={date}
          min={addDays(today, -7)}
          max={today}
          onChange={(e) => setDate(e.target.value)}
          error={errors.date}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Check in" type="time" required value={inTime} onChange={(e) => setInTime(e.target.value)} error={errors.proposedCheckInAt} />
          <Field label="Check out" type="time" required value={outTime} onChange={(e) => setOutTime(e.target.value)} error={errors.proposedCheckOutAt} />
        </div>
        <Field label="Reason" multiline required value={reason} onChange={(e) => setReason((e.target as unknown as HTMLTextAreaElement).value)} error={errors.reason} />
        {act.error ? <Alert variant="danger">{act.error.message}</Alert> : null}
      </div>
    </Dialog>
  );
}

function ReviewDialog({
  target,
  onClose,
  onDone,
}: {
  target: { id: string; status: 'APPROVED' | 'REJECTED' };
  onClose: () => void;
  onDone: () => void;
}) {
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string>();
  const act = useAction(reviewCorrection);
  const reject = target.status === 'REJECTED';
  async function submit() {
    if (reject && !comment.trim()) {
      setError('A comment is required when rejecting.');
      return;
    }
    setError(undefined);
    const r = await act.run(target.id, { status: target.status, comment: comment.trim() || undefined });
    if (r.ok) onDone();
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={reject ? 'Reject correction request' : 'Approve correction request'}
      description={reject ? 'Tell the employee why this was rejected.' : 'The attendance record is updated; the original values are kept in the audit log.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={reject ? 'destructive' : 'primary'} loading={act.pending} onClick={submit}>
            {reject ? 'Reject' : 'Approve'}
          </Button>
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
