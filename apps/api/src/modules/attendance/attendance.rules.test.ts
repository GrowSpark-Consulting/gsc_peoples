import { describe, expect, it } from 'vitest';
import { CORRECTION_WINDOW_DAYS, checkCorrectionWindow, companyDay, companyMinutes, deriveOverviewStatus, parseDateOnly, toDateOnly } from './attendance.rules';

const d = parseDateOnly;
/** Policy input for an instant seen from a company time zone. */
const at = (iso: string, tz = 'UTC') => {
  const now = new Date(iso);
  return { today: companyDay(now, tz), localMinutes: companyMinutes(now, tz) };
};

describe('company calendar day (not the UTC date)', () => {
  it('Asia/Kolkata (+05:30): 20:00 UTC is already the next day, 18:29 UTC is still the same day', () => {
    expect(toDateOnly(companyDay(new Date('2026-11-18T18:29:00Z'), 'Asia/Kolkata'))).toBe('2026-11-18');
    expect(toDateOnly(companyDay(new Date('2026-11-18T18:30:00Z'), 'Asia/Kolkata'))).toBe('2026-11-19');
    expect(toDateOnly(companyDay(new Date('2026-11-18T20:00:00Z'), 'Asia/Kolkata'))).toBe('2026-11-19');
    expect(companyMinutes(new Date('2026-11-18T20:00:00Z'), 'Asia/Kolkata')).toBe(1 * 60 + 30);
  });
  it('America/New_York: 03:00 UTC is still the previous local day; DST changes the offset', () => {
    expect(toDateOnly(companyDay(new Date('2026-11-18T03:00:00Z'), 'America/New_York'))).toBe('2026-11-17'); // EST -05:00
    expect(toDateOnly(companyDay(new Date('2026-07-18T03:00:00Z'), 'America/New_York'))).toBe('2026-07-17'); // EDT -04:00
    expect(toDateOnly(companyDay(new Date('2026-07-18T04:00:00Z'), 'America/New_York'))).toBe('2026-07-18');
  });
  it('midnight is hour 0, not 24, and an unknown or empty zone falls back to UTC', () => {
    expect(companyMinutes(new Date('2026-11-18T00:00:00Z'), 'UTC')).toBe(0);
    expect(toDateOnly(companyDay(new Date('2026-11-18T23:59:00Z'), 'Not/AZone'))).toBe('2026-11-18');
    expect(toDateOnly(companyDay(new Date('2026-11-18T23:59:00Z'), null))).toBe('2026-11-18');
  });
});

describe('correction window (ATT-005)', () => {
  const today = d('2026-11-18');
  it('is seven days', () => expect(CORRECTION_WINDOW_DAYS).toBe(7));
  it('allows today, yesterday and exactly today-7', () => {
    for (const day of ['2026-11-18', '2026-11-17', '2026-11-11']) expect(checkCorrectionWindow(d(day), today)).toEqual({ ok: true });
  });
  it('rejects today-8 as too old and tomorrow as future', () => {
    expect(checkCorrectionWindow(d('2026-11-10'), today)).toEqual({ ok: false, reason: 'TOO_OLD' });
    expect(checkCorrectionWindow(d('2026-11-19'), today)).toEqual({ ok: false, reason: 'FUTURE' });
  });
  it('rolls over at the COMPANY midnight: for Asia/Kolkata the window moves at 18:30 UTC', () => {
    const before = at('2026-11-18T18:29:59Z', 'Asia/Kolkata').today; // 2026-11-18 local
    const after = at('2026-11-18T18:30:00Z', 'Asia/Kolkata').today; // 2026-11-19 local
    expect(checkCorrectionWindow(d('2026-11-11'), before).ok).toBe(true);
    expect(checkCorrectionWindow(d('2026-11-11'), after).ok).toBe(false); // now 8 days old
    expect(checkCorrectionWindow(d('2026-11-19'), before)).toEqual({ ok: false, reason: 'FUTURE' });
    expect(checkCorrectionWindow(d('2026-11-19'), after).ok).toBe(true);
  });
});

const base = { workingDays: [1, 2, 3, 4, 5], workEndTime: '18:00', isHoliday: false, onFullDayLeave: false, checkInAt: null, checkOutAt: null };
const NOW = '2026-11-18T10:00:00Z'; // Wednesday

describe('overview status policy (ATT-004)', () => {
  it('today before work end with no check-in is NOT_YET_IN, never ABSENT', () => {
    expect(deriveOverviewStatus({ ...base, ...at(NOW), date: d('2026-11-18') })).toBe('NOT_YET_IN');
  });
  it('today after work end with no check-in is ABSENT', () => {
    expect(deriveOverviewStatus({ ...base, ...at('2026-11-18T18:00:00Z'), date: d('2026-11-18') })).toBe('ABSENT');
  });
  it('work end is judged in the company zone: 18:00 IST is 12:30 UTC', () => {
    expect(deriveOverviewStatus({ ...base, ...at('2026-11-18T12:29:00Z', 'Asia/Kolkata'), date: d('2026-11-18') })).toBe('NOT_YET_IN');
    expect(deriveOverviewStatus({ ...base, ...at('2026-11-18T12:30:00Z', 'Asia/Kolkata'), date: d('2026-11-18') })).toBe('ABSENT');
  });
  it('a past working day with no check-in is ABSENT', () => {
    expect(deriveOverviewStatus({ ...base, ...at(NOW), date: d('2026-11-17') })).toBe('ABSENT');
  });
  it('a weekend is WEEKEND, not ABSENT', () => {
    expect(deriveOverviewStatus({ ...base, ...at(NOW), date: d('2026-11-14') })).toBe('WEEKEND');
    expect(deriveOverviewStatus({ ...base, ...at(NOW), date: d('2026-11-15') })).toBe('WEEKEND');
  });
  it('a holiday is HOLIDAY, approved full-day leave is ON_LEAVE, leave beats a holiday', () => {
    expect(deriveOverviewStatus({ ...base, ...at(NOW), date: d('2026-11-17'), isHoliday: true })).toBe('HOLIDAY');
    expect(deriveOverviewStatus({ ...base, ...at(NOW), date: d('2026-11-17'), onFullDayLeave: true })).toBe('ON_LEAVE');
    expect(deriveOverviewStatus({ ...base, ...at(NOW), date: d('2026-11-17'), isHoliday: true, onFullDayLeave: true })).toBe('ON_LEAVE');
  });
  it('a check-in wins over everything', () => {
    const checkInAt = new Date('2026-11-14T09:00:00Z');
    expect(deriveOverviewStatus({ ...base, ...at(NOW), date: d('2026-11-14'), checkInAt, checkOutAt: new Date('2026-11-14T17:00:00Z') })).toBe('PRESENT');
  });
  it('checked in without check-out: PRESENT while the day is open, MISSING_CHECKOUT afterwards', () => {
    const checkInAt = new Date('2026-11-18T09:00:00Z');
    expect(deriveOverviewStatus({ ...base, ...at(NOW), date: d('2026-11-18'), checkInAt })).toBe('PRESENT');
    expect(deriveOverviewStatus({ ...base, ...at(NOW), date: d('2026-11-17'), checkInAt: new Date('2026-11-17T09:00:00Z') })).toBe('MISSING_CHECKOUT');
    expect(deriveOverviewStatus({ ...base, ...at('2026-11-18T19:00:00Z'), date: d('2026-11-18'), checkInAt })).toBe('MISSING_CHECKOUT');
  });
});
