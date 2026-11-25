/**
 * Pure attendance policy. No I/O, so every boundary is unit-testable.
 *
 * Dates are `YYYY-MM-DD` strings or UTC-midnight Date objects (the representation of a calendar date in the
 * `date` column). "Today" is the calendar date in the COMPANY's time zone (`companies.timezone`), obtained with
 * `companyDay`; it is not the UTC date (PRD "dates use company timezone", ATT-001).
 */

const SAFE_ZONE_FALLBACK = 'UTC';

function validZone(tz: string | null | undefined): string {
  if (!tz) return SAFE_ZONE_FALLBACK;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return SAFE_ZONE_FALLBACK;
  }
}

/** The company-local calendar date of an instant, as a UTC-midnight Date. */
export function companyDay(now: Date, timeZone?: string | null): Date {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: validZone(timeZone), year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return new Date(Date.UTC(g('year'), g('month') - 1, g('day')));
}

/** The instant at which a calendar date begins in the company's time zone. */
export function zonedDayStart(date: Date, timeZone?: string | null): Date {
  const zone = validZone(timeZone);
  const offsetAt = (instant: Date) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(instant);
    const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second')) - instant.getTime();
  };
  // First guess with the offset at UTC midnight, then correct once in case a clock change falls in between.
  const guess = new Date(date.getTime() - offsetAt(date));
  return new Date(date.getTime() - offsetAt(guess));
}

/** Minutes since local midnight of an instant in the company's time zone. */
export function companyMinutes(now: Date, timeZone?: string | null): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: validZone(timeZone), hour12: false, hour: '2-digit', minute: '2-digit' }).formatToParts(now);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return (g('hour') % 24) * 60 + g('minute');
}

/**
 * ATT-005 / A6: an employee may request a correction for an attendance date at most this many calendar days
 * in the past ("up to 7 days back": today-7 is allowed, today-8 is not). A future date is never allowed.
 */
export const CORRECTION_WINDOW_DAYS = 7;

const DAY_MS = 86_400_000;

export function utcDayStart(d: Date = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function parseDateOnly(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

/** Whole calendar days from `date` to `today` (positive when `date` is in the past). */
export function daysBetween(date: Date, today: Date): number {
  return Math.round((utcDayStart(today).getTime() - utcDayStart(date).getTime()) / DAY_MS);
}

export type CorrectionWindowResult = { ok: true } | { ok: false; reason: 'FUTURE' | 'TOO_OLD' };

/** `today` is the company-local date (`companyDay`). */
export function checkCorrectionWindow(date: Date, today: Date): CorrectionWindowResult {
  const age = daysBetween(date, today);
  if (age < 0) return { ok: false, reason: 'FUTURE' };
  if (age > CORRECTION_WINDOW_DAYS) return { ok: false, reason: 'TOO_OLD' };
  return { ok: true };
}

export const OVERVIEW_STATUSES = [
  'PRESENT',
  'ABSENT',
  'ON_LEAVE',
  'HOLIDAY',
  'WEEKEND',
  'NOT_YET_IN',
  'MISSING_CHECKOUT',
] as const;
export type OverviewStatus = (typeof OVERVIEW_STATUSES)[number];

/** ISO weekday: Monday = 1 ... Sunday = 7 (the convention of `Company.workingDays`). */
export function isoWeekday(date: Date): number {
  const d = date.getUTCDay();
  return d === 0 ? 7 : d;
}

/** True when the company-local time of day (minutes since midnight) is at or after the `HH:mm` work end. */
export function isAfterWorkEnd(workEndTime: string, localMinutes: number): boolean {
  const m = /^(\d{1,2}):(\d{2})$/.exec(workEndTime);
  if (!m) return false;
  return localMinutes >= Number(m[1]) * 60 + Number(m[2]);
}

export interface StatusInput {
  /** The date being reported, UTC midnight. */
  date: Date;
  /** Company-local today (`companyDay`) and local minutes since midnight. */
  today: Date;
  localMinutes: number;
  workingDays: number[];
  workEndTime: string;
  isHoliday: boolean;
  /** An approved FULL_DAY leave covers the date. Half-day leave does not make the day a leave day. */
  onFullDayLeave: boolean;
  checkInAt: Date | null;
  checkOutAt: Date | null;
}

/**
 * Attendance policy for one employee on one date (ATT-004). An employee is ABSENT only when the day is over
 * for them: a past working day, or today after the company's work end, with no check-in, no approved
 * full-day leave and no holiday. Before that they are NOT_YET_IN.
 *
 * Precedence: an actual check-in always wins (work that happened is never hidden), then approved leave, then
 * holiday, then non-working day, then the not-yet-in / absent split.
 * Caller guarantees `date <= today`.
 */
export function deriveOverviewStatus(i: StatusInput): OverviewStatus {
  const dayIsOver = daysBetween(i.date, i.today) > 0 || isAfterWorkEnd(i.workEndTime, i.localMinutes);
  if (i.checkInAt) {
    if (i.checkOutAt) return 'PRESENT';
    return dayIsOver ? 'MISSING_CHECKOUT' : 'PRESENT';
  }
  if (i.onFullDayLeave) return 'ON_LEAVE';
  if (i.isHoliday) return 'HOLIDAY';
  if (i.workingDays.length > 0 && !i.workingDays.includes(isoWeekday(i.date))) return 'WEEKEND';
  return dayIsOver ? 'ABSENT' : 'NOT_YET_IN';
}

/**
 * Statuses in which a person is expected at work: they can check in and apply for leave (PRD W3, W5, W6 "Pre:
 * Active"), and they are counted for attendance. On Notice is still employed; On Leave is a legacy status.
 * Onboarding, Inactive and Terminated people are neither.
 */
export const WORKING_STATUSES = ['ACTIVE', 'ON_NOTICE', 'ON_LEAVE'] as const;
export const isWorkingStatus = (status: string): boolean => (WORKING_STATUSES as readonly string[]).includes(status);
