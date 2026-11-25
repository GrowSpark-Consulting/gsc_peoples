import { describe, expect, it } from 'vitest';
import { parseDateOnly as d } from '../attendance/attendance.rules';
import { availableDays, countLeaveDays, hasStarted, startsTooFarInThePast } from './leave.rules';

const MON_FRI = [1, 2, 3, 4, 5];
const none = new Set<string>();
const count = (start: string, end: string, extra: Partial<Parameters<typeof countLeaveDays>[0]> = {}) =>
  countLeaveDays({ start: d(start), end: d(end), dayType: 'FULL_DAY', workingDays: MON_FRI, holidays: none, ...extra });

// 2026-11-20 is a Friday.
describe('countLeaveDays (LEAVE-003, A5)', () => {
  it('excludes weekends', () => {
    expect(count('2026-11-20', '2026-11-23')).toBe(2); // Fri, Mon
  });
  it('excludes holidays', () => {
    expect(count('2026-11-23', '2026-11-27', { holidays: new Set(['2026-11-25']) })).toBe(4);
  });
  it('is zero for a weekend-only or holiday-only range', () => {
    expect(count('2026-11-21', '2026-11-22')).toBe(0);
    expect(count('2026-11-23', '2026-11-23', { holidays: new Set(['2026-11-23']) })).toBe(0);
  });
  it('follows the company calendar', () => {
    expect(count('2026-11-20', '2026-11-23', { workingDays: [1, 2, 3, 4, 5, 6] })).toBe(3);
  });
  it('counts a half day as 0.5, and 0 on a non-working day', () => {
    expect(count('2026-11-20', '2026-11-20', { dayType: 'HALF_DAY' })).toBe(0.5);
    expect(count('2026-11-21', '2026-11-21', { dayType: 'HALF_DAY' })).toBe(0);
  });
});

describe('date boundaries (LEAVE-004, LEAVE-007)', () => {
  const today = d('2026-11-25');
  it('allows a start exactly 7 days back and refuses 8', () => {
    expect(startsTooFarInThePast(d('2026-11-18'), today)).toBe(false);
    expect(startsTooFarInThePast(d('2026-11-17'), today)).toBe(true);
    expect(startsTooFarInThePast(d('2026-12-25'), today)).toBe(false);
  });
  it('treats leave as started on its first date', () => {
    expect(hasStarted(d('2026-11-26'), today)).toBe(false);
    expect(hasStarted(d('2026-11-25'), today)).toBe(true);
    expect(hasStarted(d('2026-11-24'), today)).toBe(true);
  });
});

describe('availableDays', () => {
  it('is allocated + adjusted - approved - pending', () => {
    expect(availableDays({ allocated: 12, adjusted: 2, used: 3, pendingReserved: 1.5 })).toBe(9.5);
  });
});
