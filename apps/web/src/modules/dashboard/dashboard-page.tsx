'use client';

import { CalendarCheck, CalendarDays, Clock, LogIn, LogOut, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { StatCard } from '@/components/ui/stat-card';
import { PageHeader } from '@/components/layout/page-header';
import { hasPermission, PERMISSIONS } from '@/hooks/use-session';
import { useAction } from '@/hooks/use-action';
import { cn } from '@/lib/utils';
import { useAsyncData } from '@/modules/employees/hooks/use-async-data';
import { formatDay, formatTimestamp } from '@/modules/employees/format';
import type { Session } from '@/modules/employees/permissions';
import { QueryBoundary, Section, SessionGate } from '@/modules/shared/page-state';
import { num, obj, str, type Loose } from '@/modules/shared/loose';
import {
  checkIn,
  checkOut,
  getEmployeeDashboard,
  getHrDashboard,
  getManagerDashboard,
  getMyLeaveBalances,
  getTeamNames,
} from './api';

export type DashboardVariant = 'hr' | 'manager' | 'employee';

/** Highest dashboard the caller's permissions allow. The API enforces each endpoint again. */
export function dashboardVariant(session: Session): DashboardVariant | null {
  if (hasPermission(session, PERMISSIONS.DASHBOARD_READ_ALL)) return 'hr';
  if (hasPermission(session, PERMISSIONS.DASHBOARD_READ_TEAM)) return 'manager';
  if (hasPermission(session, PERMISSIONS.DASHBOARD_READ_SELF)) return 'employee';
  return null;
}

export function DashboardPage() {
  return (
    <SessionGate>
      {(session) => {
        const v = dashboardVariant(session);
        if (!v)
          return <EmptyState title="No dashboard" description="Your role does not have a dashboard." />;
        return (
          <>
            <PageHeader description="A live summary of your workspace." />
            {v === 'hr' ? <HrDashboard /> : v === 'manager' ? <ManagerDashboard /> : <EmployeeDashboard />}
          </>
        );
      }}
    </SessionGate>
  );
}

const grid = 'grid gap-4 sm:grid-cols-2 xl:grid-cols-4';

function QuickLinks({ links }: { links: { href: string; label: string; icon: React.ReactNode }[] }) {
  return (
    <div className="flex flex-wrap gap-3">
      {links.map((l) => (
        <Link key={l.href} href={l.href} className={cn(buttonVariants({ variant: 'secondary' }))}>
          {l.icon}
          {l.label}
        </Link>
      ))}
    </div>
  );
}

/* ---------------- HR / Super Admin (DASH-001) ---------------- */

function HrDashboard() {
  const q = useAsyncData('dash:hr', getHrDashboard);
  return (
    <QueryBoundary query={q} title="Could not load the dashboard.">
      {(d) => (
        <div className="flex flex-col gap-6">
          <div className={grid}>
            <StatCard label="Total employees" value={d.totalEmployees} />
            <StatCard label="Active employees" value={d.activeEmployees} />
            <StatCard label="Present today" value={d.presentToday} />
            {/* PRD DASH-001: "Absent" only after the work day has ended; before that "Not yet in". */}
            <StatCard label="Absent" value={d.absentToday} />
            <StatCard label="Not yet in" value={d.notYetInToday} />
            <StatCard label="On leave" value={d.onLeaveToday} />
            <StatCard label="Pending approvals" value={d.pendingApprovals} />
            <StatCard label="Joined in last 30 days" value={d.joinersLast30Days} />
          </div>
          <QuickLinks
            links={[
              { href: '/employees/new', label: 'Add employee', icon: <UserPlus aria-hidden /> },
              { href: '/leave', label: 'Review leave', icon: <CalendarDays aria-hidden /> },
              { href: '/attendance', label: 'Attendance', icon: <CalendarCheck aria-hidden /> },
            ]}
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Joiners in the last 30 days">
              <JoinerList rows={d.joiners} />
            </Section>
            <Section title="Recent activity">
              <ActivityList rows={d.recentActivities} />
            </Section>
          </div>
        </div>
      )}
    </QueryBoundary>
  );
}

function JoinerList({ rows }: { rows: { id: string; name: string; employeeNumber: string; joiningDate: string }[] }) {
  if (rows.length === 0) return <EmptyState title="No new joiners" description="People who joined recently appear here." />;
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
          <Link href={`/employees/${r.id}`} className="text-body text-ink underline">
            {r.name}
            <span className="text-muted"> · {r.employeeNumber}</span>
          </Link>
          <span className="text-small text-muted">{formatDay(r.joiningDate)}</span>
        </li>
      ))}
    </ul>
  );
}

export function ActivityList({ rows }: { rows: Loose[] }) {
  if (rows.length === 0)
    return <EmptyState title="No activity yet" description="Changes made in the workspace show up here." />;
  return (
    <ul className="divide-y divide-line">
      {rows.map((r, i) => (
        <li key={str(r, 'id') ?? i} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
          <span className="text-body text-ink">
            {str(r, 'action') ?? 'Activity'}
            {str(r, 'entity') ? <span className="text-muted"> · {str(r, 'entity')}</span> : null}
            {str(r, 'actorName') ? <span className="text-muted"> · {str(r, 'actorName')}</span> : null}
          </span>
          <span className="text-small text-muted">
            {str(r, 'createdAt') ? formatTimestamp(str(r, 'createdAt') as string) : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ---------------- Manager (DASH-002) ---------------- */

function ManagerDashboard() {
  const q = useAsyncData('dash:manager', getManagerDashboard);
  const names = useAsyncData('dash:team-names', getTeamNames);
  return (
    <QueryBoundary query={q} title="Could not load the dashboard.">
      {(d) => {
        const a = d.teamAttendance;
        return (
          <div className="flex flex-col gap-6">
            <div className={grid}>
              <StatCard label="Team members" value={d.teamMembers} />
              <StatCard label="Present today" value={num(a, 'present') ?? 0} />
              <StatCard label="Absent" value={num(a, 'absent') ?? 0} />
              <StatCard label="Not yet in" value={num(a, 'notYetIn') ?? 0} />
              <StatCard label="On leave" value={num(a, 'onLeave') ?? 0} />
              <StatCard label="Pending approvals" value={d.pendingApprovals} />
            </div>
            <QuickLinks
              links={[
                { href: '/leave', label: 'Approve leave', icon: <CalendarDays aria-hidden /> },
                { href: '/attendance', label: 'Team attendance', icon: <CalendarCheck aria-hidden /> },
              ]}
            />
            <Section title="Team leave">
              <TeamLeave rows={d.teamLeaveCalendar} names={names.data} />
            </Section>
          </div>
        );
      }}
    </QueryBoundary>
  );
}

function TeamLeave({ rows, names }: { rows: Loose[]; names: Map<string, string> | undefined }) {
  if (rows.length === 0)
    return <EmptyState title="No upcoming leave" description="Current and upcoming team leave appears here." />;
  return (
    <ul className="divide-y divide-line">
      {rows.map((r, i) => (
        <li key={str(r, 'id') ?? i} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
          <span className="text-body text-ink">{str(r, 'employeeName') ?? names?.get(str(r, 'employeeId') ?? '') ?? 'Team member'}</span>
          <span className="text-small text-muted">
            {formatDay(str(r, 'startDate')?.slice(0, 10))} – {formatDay(str(r, 'endDate')?.slice(0, 10))}
            {num(r, 'days') !== undefined ? ` · ${num(r, 'days')} day(s)` : ''}
            {str(r, 'status') === 'PENDING' ? ' · pending' : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ---------------- Employee (DASH-003) ---------------- */

function EmployeeDashboard() {
  const q = useAsyncData('dash:employee', getEmployeeDashboard);
  const balances = useAsyncData('dash:balances', getMyLeaveBalances);
  return (
    <QueryBoundary query={q} title="Could not load the dashboard.">
      {(d) => (
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Profile">
              <ProfileSummary p={d.profileSummary} />
            </Section>
            <Section title="Today">
              <AttendanceButton action={d.attendanceState.action} onDone={q.reload} />
            </Section>
          </div>
          <Section title="Leave balances">
            <QueryBoundary query={balances} title="Could not load leave balances.">
              {(rows) =>
                rows.length === 0 ? (
                  <EmptyState title="No balances" description="Leave balances are set up by HR." />
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    {rows.map((b) => (
                      <StatCard
                        key={b.leaveTypeId}
                        label={b.leaveTypeName ?? 'Leave'}
                        value={b.available}
                        comparison={{ direction: 'flat', value: `${b.pending} pending`, label: `· ${b.used} used` }}
                      />
                    ))}
                  </div>
                )
              }
            </QueryBoundary>
          </Section>
          <div className="grid gap-4 lg:grid-cols-2">
            <Section
              title="My leave requests"
              action={<Link className="text-small text-ink underline" href="/leave">View all</Link>}
            >
              <RequestList rows={d.leaveRequests} />
            </Section>
            <Section title="Recent notifications">
              <NotificationList rows={d.notifications} />
            </Section>
          </div>
        </div>
      )}
    </QueryBoundary>
  );
}

function ProfileSummary({ p }: { p: Loose | null }) {
  if (!p)
    return <EmptyState title="No employee profile" description="Your login is not linked to an employee record yet." />;
  const name = `${str(p, 'firstName') ?? ''} ${str(p, 'lastName') ?? ''}`.trim();
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-body">
      <dt className="text-muted">Name</dt>
      <dd className="text-ink">{name || '—'}</dd>
      <dt className="text-muted">Employee ID</dt>
      <dd className="text-ink">{str(p, 'employeeNumber') ?? '—'}</dd>
      <dt className="text-muted">Title</dt>
      <dd className="text-ink">{str(p, 'jobTitle') ?? '—'}</dd>
      <dt className="text-muted">Work email</dt>
      <dd className="break-all text-ink">{str(p, 'workEmail') ?? '—'}</dd>
    </dl>
  );
}

const ACTION_LABEL = { CHECK_IN: 'Check in', CHECK_OUT: 'Check out', DONE: 'Done for today' } as const;

/** The button reflects the server's state (PRD DASH-003); the client never decides it. */
export function AttendanceButton({
  action,
  onDone,
}: {
  action: 'CHECK_IN' | 'CHECK_OUT' | 'DONE';
  onDone: () => void;
}) {
  const act = useAction(async () => {
    if (action === 'CHECK_IN') await checkIn();
    else if (action === 'CHECK_OUT') await checkOut();
  });
  async function click() {
    const r = await act.run();
    if (r.ok) onDone();
  }
  return (
    <div className="flex flex-col items-start gap-3">
      <Button
        onClick={click}
        loading={act.pending}
        disabled={action === 'DONE'}
        icon={
          action === 'CHECK_OUT' ? <LogOut aria-hidden /> : action === 'CHECK_IN' ? <LogIn aria-hidden /> : <Clock aria-hidden />
        }
      >
        {ACTION_LABEL[action]}
      </Button>
      {act.error ? <Alert variant="danger">{act.error.message}</Alert> : null}
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};
const STATUS_VARIANT: Record<string, 'warning' | 'success' | 'danger' | 'neutral'> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
};

function RequestList({ rows }: { rows: Loose[] }) {
  if (rows.length === 0)
    return <EmptyState title="No leave requests" description="Requests you make appear here." />;
  return (
    <ul className="divide-y divide-line">
      {rows.map((r, i) => {
        const status = str(r, 'status') ?? '';
        return (
          <li key={str(r, 'id') ?? i} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <span className="text-body text-ink">
              {str(r, 'leaveTypeName') ?? str(obj(r, 'leaveType') ?? {}, 'name') ?? 'Leave'}
              <span className="text-muted"> · {formatDay(str(r, 'startDate')?.slice(0, 10))}</span>
            </span>
            <Badge variant={STATUS_VARIANT[status] ?? 'neutral'}>{STATUS_LABEL[status] ?? status}</Badge>
          </li>
        );
      })}
    </ul>
  );
}

function NotificationList({ rows }: { rows: Loose[] }) {
  if (rows.length === 0)
    return <EmptyState title="You are all caught up" description="New notifications show up here." />;
  return (
    <ul className="divide-y divide-line">
      {rows.map((r, i) => {
        const link = str(r, 'link');
        const title = str(r, 'title') ?? 'Notification';
        return (
          <li key={str(r, 'id') ?? i} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            {link && link.startsWith('/') ? (
              <Link href={link} className="text-body text-ink underline">
                {title}
              </Link>
            ) : (
              <span className="text-body text-ink">{title}</span>
            )}
            <span className="text-small text-muted">
              {str(r, 'createdAt') ? formatTimestamp(str(r, 'createdAt') as string) : ''}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
