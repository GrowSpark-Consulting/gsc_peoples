import { daysBetween, isoWeekday, toDateOnly } from '../attendance/attendance.rules';

/**
 * Pure leave policy (PRD LEAVE-003, LEAVE-004, A5). No I/O, so every boundary is unit-testable.
 * Dates are calendar dates held as UTC-midnight Date objects; "today" is the company-local date.
 */

/** LEAVE-004 / A6: leave may start at most this many calendar days in the past. */
export const MAX_RETROACTIVE_DAYS = 7;

const DAY_MS = 86_400_000;

/** Every calendar date from `start` to `end`, inclusive. */
export function eachDate(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += DAY_MS) out.push(new Date(t));
  return out;
}

/** A date that counts against leave: a company working day that is not a holiday. */
export function isCountedDay(date: Date, workingDays: readonly number[], holidays: ReadonlySet<string>): boolean {
  return workingDays.includes(isoWeekday(date)) && !holidays.has(toDateOnly(date));
}

/**
 * Days a request consumes: weekends and holidays are excluded; a half day is 0.5 of one counted date.
 * Returns 0 when nothing in the range is a working day (the caller rejects that, PRD W6).
 */
export function countLeaveDays(input: {
  start: Date;
  end: Date;
  dayType: 'FULL_DAY' | 'HALF_DAY';
  workingDays: readonly number[];
  holidays: ReadonlySet<string>;
}): number {
  const counted = eachDate(input.start, input.end).filter((d) => isCountedDay(d, input.workingDays, input.holidays)).length;
  if (input.dayType === 'HALF_DAY') return counted > 0 ? 0.5 : 0;
  return counted;
}

export function startsTooFarInThePast(start: Date, today: Date): boolean {
  return daysBetween(start, today) > MAX_RETROACTIVE_DAYS;
}

/** LEAVE-007: leave has started once its first date is today or earlier. */
export function hasStarted(start: Date, today: Date): boolean {
  return daysBetween(start, today) >= 0;
}

/** `allocated + adjusted - approved - pending` (PRD data model). */
export function availableDays(b: { allocated: number; adjusted: number; used: number; pendingReserved: number }): number {
  return b.allocated + b.adjusted - b.used - b.pendingReserved;
}
