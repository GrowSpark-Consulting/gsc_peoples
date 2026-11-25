import type { TenantDb } from '../../database/tenant';
import { daysBetween, deriveOverviewStatus, toDateOnly, type OverviewStatus } from './attendance.rules';

/**
 * ATT-003 monthly history and summary. The summary is computed FROM the daily rows returned here, so the totals
 * equal the rows by construction. The same `deriveOverviewStatus` policy drives the HR overview (ATT-004), the
 * dashboards and the report (ATT-008).
 */
export interface CompanyCalendar {
  workingDays: number[];
  workEndTime: string;
  today: Date;
  localMinutes: number;
}

export interface AttendanceDay {
  date: string;
  status: OverviewStatus;
  checkInAt: string | null;
  checkOutAt: string | null;
  workedMinutes: number | null;
  halfDayLeave: boolean;
  holidayName: string | null;
  corrected: boolean;
}

export interface AttendanceSummary {
  /** Days with a check-in, including days still missing a check-out. */
  present: number;
  absent: number;
  /** Days covered by approved full-day leave without a check-in. */
  onLeave: number;
  holidays: number;
  /** Recorded hours, two decimals. A missing check-out counts 0 until corrected (PRD W5). */
  hoursWorked: number;
  missingCheckout: number;
}

export interface MonthEmployee {
  id: string;
  joiningDate: Date | null;
  exitDate: Date | null;
}

const DAY_MS = 86_400_000;

export function summarize(days: readonly AttendanceDay[]): AttendanceSummary {
  const count = (...s: OverviewStatus[]) => days.filter((d) => s.includes(d.status)).length;
  const minutes = days.reduce((n, d) => n + (d.workedMinutes ?? 0), 0);
  return {
    present: count('PRESENT', 'MISSING_CHECKOUT'),
    absent: count('ABSENT'),
    onLeave: count('ON_LEAVE'),
    holidays: count('HOLIDAY'),
    hoursWorked: Math.round((minutes / 60) * 100) / 100,
    missingCheckout: count('MISSING_CHECKOUT'),
  };
}

/**
 * Daily rows for one month for several employees (one query per table, whatever the headcount). Days after
 * today, before joining or after exit are not reported, except where a record actually exists.
 */
export async function monthDays(
  db: TenantDb,
  calendar: CompanyCalendar,
  employees: readonly MonthEmployee[],
  year: number,
  month: number,
): Promise<Map<string, AttendanceDay[]>> {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  const range = { gte: start, lte: end };
  const ids = employees.map((e) => e.id);
  const [records, leaves, holidays] = await Promise.all([
    db.attendanceRecord.findMany({ where: { employeeId: { in: ids }, date: range } }),
    db.leaveRequest.findMany({
      where: { employeeId: { in: ids }, status: 'APPROVED', startDate: { lte: end }, endDate: { gte: start } },
      select: { employeeId: true, startDate: true, endDate: true, dayType: true },
    }),
    db.holiday.findMany({ where: { date: range, isActive: true }, select: { date: true, name: true } }),
  ]);
  const key = (employeeId: string, date: Date) => `${employeeId}:${toDateOnly(date)}`;
  type Rec = { employeeId: string; date: Date; checkInAt: Date | null; checkOutAt: Date | null; workedMinutes: number | null; lastCorrectedAt: Date | null };
  const recordBy = new Map<string, Rec>((records as Rec[]).map((r) => [key(r.employeeId, r.date), r]));
  const holidayBy = new Map<string, string>((holidays as { date: Date; name: string }[]).map((h) => [toDateOnly(h.date), h.name]));
  type Leave = { employeeId: string; startDate: Date; endDate: Date; dayType: string };
  const leaveDays = (leaves as Leave[]);

  const out = new Map<string, AttendanceDay[]>();
  for (const e of employees) {
    const rows: AttendanceDay[] = [];
    const mine = leaveDays.filter((l) => l.employeeId === e.id);
    for (let t = start.getTime(); t <= end.getTime(); t += DAY_MS) {
      const date = new Date(t);
      if (daysBetween(date, calendar.today) < 0) break; // future dates have no attendance
      const rec = recordBy.get(key(e.id, date));
      const employed = (!e.joiningDate || e.joiningDate <= date) && (!e.exitDate || date <= e.exitDate);
      if (!employed && !rec) continue;
      const covering = mine.filter((l) => l.startDate <= date && l.endDate >= date);
      const holidayName = holidayBy.get(toDateOnly(date)) ?? null;
      const isWorkingDay = calendar.workingDays.includes(date.getUTCDay() === 0 ? 7 : date.getUTCDay());
      rows.push({
        date: toDateOnly(date),
        status: deriveOverviewStatus({
          date,
          today: calendar.today,
          localMinutes: calendar.localMinutes,
          workingDays: calendar.workingDays,
          workEndTime: calendar.workEndTime,
          isHoliday: holidayName !== null,
          // Leave never counts on a weekend or holiday (A5), even when a range spans it.
          onFullDayLeave: isWorkingDay && holidayName === null && covering.some((l) => l.dayType === 'FULL_DAY'),
          checkInAt: rec?.checkInAt ?? null,
          checkOutAt: rec?.checkOutAt ?? null,
        }),
        checkInAt: rec?.checkInAt ? rec.checkInAt.toISOString() : null,
        checkOutAt: rec?.checkOutAt ? rec.checkOutAt.toISOString() : null,
        workedMinutes: rec?.workedMinutes ?? null,
        halfDayLeave: covering.some((l) => l.dayType === 'HALF_DAY'),
        holidayName,
        corrected: Boolean(rec?.lastCorrectedAt),
      });
    }
    out.set(e.id, rows);
  }
  return out;
}
