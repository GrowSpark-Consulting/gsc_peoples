'use client';

import type { Employee } from '@gsc/contracts';
import { ExternalLink, Pencil, UserX } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/layout/page-header';
import { AccessDeniedState, ErrorState } from '@/components/shared/data-states';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { describeError, isApiError } from '../errors';
import { formatDay, formatTimestamp, fullName, TYPE_LABEL } from '../format';
import { useEmployee } from '../hooks/use-employees';
import { useEmployeesContext } from '../state/employees-context';
import { ActivityTimeline, InvitePanel, MyContactForm } from './record-sections';
import { StatusBadge } from './status-badge';
import { StatusChangePanel } from './status-change-panel';

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-label text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-body text-ink">{children}</dd>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-lg border border-line bg-surface p-5 shadow-sm">
      <h3 className="mb-4 text-h3 font-semibold text-ink">{title}</h3>
      {children}
    </section>
  );
}

const dash = '—';

export interface EmployeeProfileProps {
  id: string;
  /**
   * Drawer presentation: no breadcrumb header, a single column, and an "Open full page" link.
   * The full page (`/employees/[id]`) stays available for deep links.
   */
  embedded?: boolean;
  /** Embedded only: open another employee (e.g. the manager) in the same drawer. */
  onOpenEmployee?: (id: string) => void;
  /** Called after a successful status change so the list behind the drawer can refresh. */
  onChanged?: () => void;
}

export function EmployeeProfile({ id, embedded = false, onOpenEmployee, onChanged }: EmployeeProfileProps) {
  const { caps, session, service } = useEmployeesContext();
  const query = useEmployee(id);

  if ((query.status === 'loading' && !query.data) || query.status === 'idle') {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading employee profile">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (query.status === 'error') {
    const err = query.error;
    if (isApiError(err) && err.status === 404) {
      return (
        <EmptyState
          icon={UserX}
          title="Employee not found"
          description="This employee does not exist, or you do not have access to their profile."
          action={
            <Link href="/employees" className={buttonVariants({ variant: 'secondary' })}>
              Back to employees
            </Link>
          }
        />
      );
    }
    if (isApiError(err) && err.status === 403) return <AccessDeniedState />;
    return (
      <ErrorState
        title="Could not load this profile."
        message={describeError(err)}
        onRetry={query.reload}
      />
    );
  }

  const e = query.data as Employee;
  const name = fullName(e);
  const isSelf = session.employeeId === e.id;
  // Timeline, own contact details and invitations exist only on the real API, not in the demo adapter.
  const live = service.kind === 'http';
  const may = (p: Parameters<typeof session.permissions.includes>[0]) => session.permissions.includes(p);
  // The API returns these private fields only to HR, Super Admin and the owner.
  const seesPrivate = caps.readAll || isSelf;
  const changed = () => {
    query.reload();
    onChanged?.();
  };
  const wide = embedded ? undefined : 'lg:col-span-2';

  return (
    <article aria-label={`Profile of ${name}`} className="flex flex-col">
      {embedded ? (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          {caps.canEdit ? (
            <Link
              href={`/employees/${e.id}/edit`}
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
              <Pencil aria-hidden />
              Edit
            </Link>
          ) : null}
          <Link href={`/employees/${e.id}`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            <ExternalLink aria-hidden />
            Open full page
          </Link>
        </div>
      ) : (
        <PageHeader
          breadcrumbs={[{ label: 'Employees', href: '/employees' }, { label: name }]}
          actions={
            caps.canEdit ? (
              <Link
                href={`/employees/${e.id}/edit`}
                className={buttonVariants({ variant: 'secondary' })}
              >
                <Pencil aria-hidden />
                Edit
              </Link>
            ) : undefined
          }
        />
      )}

      <div className="mb-5 flex flex-wrap items-center gap-4 rounded-lg border border-line bg-surface p-5 shadow-sm">
        <Avatar name={name} size="lg" className="size-14 text-h2" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-h2 font-semibold text-ink">{name}</h2>
          <p className="text-small text-muted">
            {e.employeeNumber}
            {e.jobTitle ? ` · ${e.jobTitle}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isSelf ? <Badge variant="accent">You</Badge> : null}
          <StatusBadge status={e.status} />
        </div>
      </div>

      <div className={cn('grid gap-5', !embedded && 'lg:grid-cols-2')}>
        <Card title="Employment">
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            <Item label="Job title">{e.jobTitle ?? dash}</Item>
            <Item label="Employment type">{TYPE_LABEL[e.employmentType]}</Item>
            <Item label="Department">{e.department?.name ?? dash}</Item>
            <Item label="Manager">
              {e.manager ? (
                caps.readAll ? (
                  <Link
                    href={`/employees/${e.manager.id}`}
                    className="underline-offset-2 hover:underline"
                    onClick={(ev) => {
                      // inside the drawer, stay in the drawer (modified clicks still open the full page)
                      if (!embedded || !onOpenEmployee || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
                      ev.preventDefault();
                      onOpenEmployee(e.manager!.id);
                    }}
                  >
                    {fullName(e.manager)}
                  </Link>
                ) : (
                  fullName(e.manager)
                )
              ) : (
                dash
              )}
            </Item>
            {e.designation ? <Item label="Designation">{e.designation.name}</Item> : null}
            <Item label="Hire date">{formatDay(e.hireDate)}</Item>
            <Item label="Termination date">{formatDay(e.terminationDate)}</Item>
          </dl>
        </Card>

        <Card title="Contact and record">
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            <Item label="Work email">
              {e.workEmail ? (
                <a href={`mailto:${e.workEmail}`} className="underline-offset-2 hover:underline">
                  {e.workEmail}
                </a>
              ) : (
                dash
              )}
            </Item>
            {!live ? null : seesPrivate ? (
              <>
                <Item label="Phone">{e.phone || dash}</Item>
                <Item label="Address">{e.address || dash}</Item>
                <Item label="Emergency contact">{e.emergencyContact || dash}</Item>
              </>
            ) : e.phone ? (
              <Item label="Phone">{e.phone}</Item>
            ) : null}
            <Item label="Employee number">{e.employeeNumber}</Item>
            <Item label="Created">{formatTimestamp(e.createdAt)}</Item>
            <Item label="Last updated">{formatTimestamp(e.updatedAt)}</Item>
          </dl>
        </Card>

        {caps.canChangeStatus ? (
          <div className={wide}>
            <Card title="Employment status">
              <StatusChangePanel key={`${e.status}:${e.terminationDate}`} employee={e} onChanged={changed} />
            </Card>
          </div>
        ) : null}
        {live && isSelf && may('employee:self:edit') ? (
          <div className={wide}>
            <Card title="My contact details">
              <MyContactForm employee={e} onSaved={changed} />
            </Card>
          </div>
        ) : null}
        {live && may('employee:invite') && e.status !== 'INACTIVE' && e.status !== 'TERMINATED' ? (
          <div className={wide}>
            <Card title="Login access">
              <InvitePanel employee={e} session={session} onInvited={changed} />
            </Card>
          </div>
        ) : null}
        {live && !embedded ? (
          <div className={wide}>
            <Card title="Activity">
              <ActivityTimeline id={e.id} version={e.updatedAt} />
            </Card>
          </div>
        ) : null}
      </div>
    </article>
  );
}
