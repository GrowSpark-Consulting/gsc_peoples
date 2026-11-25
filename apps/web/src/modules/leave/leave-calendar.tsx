'use client';

import { useState } from 'react';
import type { leaveCalendarDaySchema, LeaveCalendarScope } from '@gsc/contracts';
import type { z } from 'zod';
import { ErrorState } from '@/components/shared/data-states';
import { SelectField } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { hasPermission, PERMISSIONS, useCompany } from '@/hooks/use-session';
import { describeApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { formatDay } from '@/modules/employees/format';
import { useAsyncData } from '@/modules/employees/hooks/use-async-data';
import type { Session } from '@/modules/employees/permissions';
import { MONTHS, todayIn } from '@/modules/shared/datetime';
import { Section } from '@/modules/shared/page-state';
import { getCalendar } from './api';

type Day = z.infer<typeof leaveCalendarDaySchema>;

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** Monday-first column (0..6) of a `YYYY-MM-DD` date. */
const column = (date: string) => (new Date(`${date}T00:00:00.000Z`).getUTCDay() + 6) % 7;

function describe(item: Day['items'][number]): string {
  const half = item.dayType === 'HALF_DAY' ? (item.halfDaySession === 'SECOND_HALF' ? ' · ½ second half' : ' · ½ first half') : '';
  return `${item.leaveTypeName}${half}${item.status === 'PENDING' ? ' · pending' : ''}`;
}

function DayContent({ day }: { day: Day }) {
  return (
    <>
      {day.holidayName ? <p className="text-small font-medium text-ink">Holiday: {day.holidayName}</p> : null}
      {day.items.length > 0 ? (
        <ul className="mt-1 flex flex-col gap-1">
          {day.items.map((i) => (
            <li key={i.requestId} className="rounded-md border border-line bg-sunken px-1.5 py-1 text-small">
              <span className="block break-words text-ink">{i.employeeName}</span>
              <span className="block text-muted">{describe(i)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/** LEAVE-008: month calendar of own, team or company leave, by role. Half days are marked and holidays named. */
export function LeaveCalendarSection({ session }: { session: Session }) {
  const company = useCompany();
  const [currentYear, currentMonth] = todayIn(company?.timezone).split('-').map(Number) as [number, number];
  const readAll = hasPermission(session, PERMISSIONS.LEAVE_READ_ALL);
  const readTeam = hasPermission(session, PERMISSIONS.LEAVE_READ_TEAM);
  const scopes: { value: LeaveCalendarScope; label: string }[] = [
    ...(session.employeeId ? [{ value: 'own' as const, label: 'My leave' }] : []),
    ...(readTeam && session.employeeId ? [{ value: 'team' as const, label: 'My team' }] : []),
    ...(readAll ? [{ value: 'all' as const, label: 'Everyone' }] : []),
  ];
  const [scope, setScope] = useState<LeaveCalendarScope>(scopes.at(-1)?.value ?? 'own');
  const [month, setMonth] = useState(currentMonth);
  const [year, setYear] = useState(currentYear);
  const q = useAsyncData(`leave:calendar:${scope}:${year}-${month}`, () => getCalendar({ year, month, scope }));
  const days = q.data?.data ?? [];
  const eventful = days.filter((d) => d.items.length > 0 || d.holidayName);

  return (
    <Section title="Leave calendar">
      <div role="search" aria-label="Calendar filters" className="mb-4 flex flex-wrap items-end gap-3">
        {scopes.length > 1 ? (
          <SelectField label="Calendar of" value={scope} onChange={(e) => setScope(e.target.value as LeaveCalendarScope)}>
            {scopes.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </SelectField>
        ) : null}
        <SelectField label="Calendar month" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>{m}</option>
          ))}
        </SelectField>
        <SelectField label="Calendar year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </SelectField>
      </div>

      {q.status === 'error' ? (
        <ErrorState title="Could not load the leave calendar." message={describeApiError(q.error)} onRetry={q.reload} />
      ) : q.status !== 'success' ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          {/* Narrow screens: a list of the days that have something on them. */}
          <ul aria-label="Days with leave or holidays" className="divide-y divide-line md:hidden">
            {eventful.length === 0 ? <li className="py-2 text-body text-muted">No leave or holidays this month.</li> : null}
            {eventful.map((d) => (
              <li key={d.date} className="py-2.5">
                <p className="text-body font-medium text-ink">{formatDay(d.date)}</p>
                <DayContent day={d} />
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
            <div aria-hidden className="grid grid-cols-7 gap-px text-label text-muted">
              {WEEKDAYS.map((w) => (
                <div key={w} className="px-2 py-1">{w}</div>
              ))}
            </div>
            <ol aria-label="Leave calendar days" className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-line bg-line">
              {days.map((d, i) => (
                <li
                  key={d.date}
                  // The first day starts in its weekday column.
                  style={i === 0 ? { gridColumnStart: column(d.date) + 1 } : undefined}
                  className={cn('min-h-24 min-w-0 p-1.5', d.isWorkingDay && !d.holidayName ? 'bg-surface' : 'bg-sunken')}
                >
                  <p className="text-small text-muted">
                    <span aria-hidden>{Number(d.date.slice(8))}</span>
                    <span className="sr-only">
                      {formatDay(d.date)}
                      {d.isWorkingDay ? '' : ', non-working day'}
                    </span>
                  </p>
                  <DayContent day={d} />
                </li>
              ))}
            </ol>
          </div>
        </>
      )}
    </Section>
  );
}
