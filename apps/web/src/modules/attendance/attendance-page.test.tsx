// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSessionCache } from '@/hooks/use-session';
import { apiError, employeeFixture, employeeList, meBody, mockApi, page, uuid } from '@/test/api-mock';
import { AttendancePage, zonedToIso } from './attendance-page';

beforeEach(() => resetSessionCache());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const SELF = uuid();
const OTHER = uuid();
const now = '2026-01-01T00:00:00.000Z';
const today = (state: 'NOT_CHECKED_IN' | 'CHECKED_IN' | 'DONE', record: unknown = null) => ({
  body: { data: { date: '2026-03-02', record, state } },
});
const history = (rows: unknown[] = [], total = rows.length) => ({ body: { data: rows, page: page(total) } });
const record = (o: Record<string, unknown> = {}) => ({
  id: uuid(), employeeId: SELF, date: '2026-03-02', checkInAt: '2026-03-02T03:30:00.000Z', checkOutAt: '2026-03-02T12:30:00.000Z',
  workedMinutes: 540, workedHours: 9, createdAt: now, updatedAt: now, ...o,
});
const correction = (o: Record<string, unknown> = {}) => ({
  id: uuid(), employeeId: OTHER, date: '2026-03-01', proposedCheckInAt: '2026-03-01T03:30:00.000Z', proposedCheckOutAt: '2026-03-01T12:30:00.000Z',
  reason: 'Forgot to check in', status: 'PENDING', createdAt: now, updatedAt: now, ...o,
});
const people = employeeList(employeeFixture(SELF, 'Self', 'Person'), employeeFixture(OTHER, 'Olivia', 'Other'));

describe('zonedToIso', () => {
  it('converts a company-local wall time to the right instant', () => {
    expect(zonedToIso('2026-03-02', '09:00', 'Asia/Kolkata')).toBe('2026-03-02T03:30:00.000Z');
    expect(zonedToIso('2026-07-01', '09:00', 'America/New_York')).toBe('2026-07-01T13:00:00.000Z');
  });
});

describe('Check in / check out (ATT-001, ATT-002)', () => {
  const base = (state: 'NOT_CHECKED_IN' | 'CHECKED_IN' | 'DONE') => ({
    'GET /me': { body: meBody('EMPLOYEE', SELF) },
    'GET /attendance/today': today(state),
    'GET /attendance/history': history(),
    'GET /attendance/corrections': { body: { data: [] } },
  });

  it('shows only the action the server allows', async () => {
    mockApi(base('NOT_CHECKED_IN'));
    const a = render(<AttendancePage />);
    expect(await screen.findByRole('button', { name: 'Check in' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Check out' })).toBeNull();
    a.unmount();
    resetSessionCache();
    mockApi(base('CHECKED_IN'));
    const b = render(<AttendancePage />);
    expect(await screen.findByRole('button', { name: 'Check out' })).toBeTruthy();
    b.unmount();
    resetSessionCache();
    mockApi(base('DONE'));
    render(<AttendancePage />);
    expect(((await screen.findByRole('button', { name: 'Done for today' })) as HTMLButtonElement).disabled).toBe(true);
  });

  it('posts a check-in once and shows the 409 from a duplicate without changing state', async () => {
    const api = mockApi({ ...base('NOT_CHECKED_IN'), 'POST /attendance/check-in': apiError(409, 'CONFLICT', 'Already checked in today') });
    render(<AttendancePage />);
    const btn = await screen.findByRole('button', { name: 'Check in' });
    // Two clicks in the same tick (a double click): only one request may be in flight.
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(await screen.findByText('Already checked in today')).toBeTruthy();
    expect(api.keys().filter((k) => k === 'POST /attendance/check-in')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Check in' })).toBeTruthy();
  });
});

describe('History (ATT-003)', () => {
  it('lists records and shows an empty state, scoped to the signed-in employee by default', async () => {
    const api = mockApi({
      'GET /me': { body: meBody('EMPLOYEE', SELF) },
      'GET /attendance/today': today('DONE'),
      'GET /attendance/history': history([record(), record({ date: '2026-03-03', checkOutAt: null, workedMinutes: null, workedHours: null })]),
      'GET /attendance/corrections': { body: { data: [] } },
    });
    render(<AttendancePage />);
    const table = await screen.findByRole('region', { name: 'Attendance records' });
    expect(await within(table).findByText('Present')).toBeTruthy();
    expect(within(table).getByText('Missing check-out')).toBeTruthy();
    expect(api.last('GET /attendance/history')?.query.get('employeeId')).toBeNull();
    expect(screen.queryByLabelText('Employee')).toBeNull(); // an Employee cannot pick someone else
  });

  it('a Manager can choose a team member and the API is asked for that employee', async () => {
    const api = mockApi({
      'GET /me': { body: meBody('MANAGER', SELF) },
      'GET /attendance/today': today('DONE'),
      'GET /attendance/history': history(),
      'GET /attendance/corrections': { body: { data: [] } },
      'GET /employees': people,
    });
    render(<AttendancePage />);
    const picker = await screen.findByLabelText('Employee');
    await screen.findByRole('option', { name: 'Olivia Other' });
    await userEvent.selectOptions(picker, OTHER);
    await waitFor(() => expect(api.calls.some((c) => c.key === 'GET /attendance/history' && c.query.get('employeeId') === OTHER)).toBe(true));
  });

  it('shows an error with retry when history fails', async () => {
    mockApi({
      'GET /me': { body: meBody('EMPLOYEE', SELF) },
      'GET /attendance/today': today('DONE'),
      'GET /attendance/history': apiError(500, 'INTERNAL', 'x'),
      'GET /attendance/corrections': { body: { data: [] } },
    });
    render(<AttendancePage />);
    expect(await screen.findByText('Could not load attendance.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });
});

describe('Corrections (ATT-005, ATT-006)', () => {
  it('an Employee can request but never decide corrections', async () => {
    mockApi({
      'GET /me': { body: meBody('EMPLOYEE', SELF) },
      'GET /attendance/today': today('DONE'),
      'GET /attendance/history': history(),
      'GET /attendance/corrections': { body: { data: [correction({ employeeId: SELF })] } },
    });
    render(<AttendancePage />);
    expect(await screen.findByRole('button', { name: 'Request correction' })).toBeTruthy();
    expect(await screen.findByText('Forgot to check in')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('validates a request (reason required) before sending', async () => {
    const api = mockApi({
      'GET /me': { body: meBody('EMPLOYEE', SELF) },
      'GET /attendance/today': today('DONE'),
      'GET /attendance/history': history(),
      'GET /attendance/corrections': { body: { data: [] } },
    });
    render(<AttendancePage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Request correction' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit request' }));
    expect(await within(dialog).findByText(/./, { selector: 'p[id$="-error"]' })).toBeTruthy();
    expect(api.keys()).not.toContain('POST /attendance/corrections');
  });

  it('an approver cannot decide their own request, can approve others, and must comment to reject', async () => {
    const mine = correction({ employeeId: SELF, reason: 'my own' });
    const theirs = correction({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', reason: 'their request' });
    const api = mockApi({
      'GET /me': { body: meBody('HR_ADMIN', SELF) },
      'GET /attendance/today': today('DONE'),
      'GET /attendance/history': history(),
      'GET /attendance/corrections': { body: { data: [mine, theirs] } },
      'GET /employees': people,
      'GET /attendance/overview': { body: { data: [], page: page(0), summary: {}, meta: { date: '2026-03-02', isWorkingDay: true, isHoliday: false, holidayName: null } } },
      'PATCH /attendance/corrections/cccccccc-cccc-4ccc-8ccc-cccccccccccc/review': { body: { data: theirs } },
    });
    render(<AttendancePage />);
    const own = (await screen.findByText('my own')).closest('tr') as HTMLElement;
    const other = (await screen.findByText('their request')).closest('tr') as HTMLElement;
    expect(within(own).queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(within(own).queryByRole('button', { name: 'Reject' })).toBeNull();

    await userEvent.click(within(other).getByRole('button', { name: 'Reject' }));
    let dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(await within(dialog).findByText('A comment is required when rejecting.')).toBeTruthy();
    expect(api.keys().some((k) => k.startsWith('PATCH'))).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await userEvent.click(within(other).getByRole('button', { name: 'Approve' }));
    dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(api.keys().some((k) => k.startsWith('PATCH /attendance/corrections/'))).toBe(true));
    expect(api.last('PATCH /attendance/corrections/cccccccc-cccc-4ccc-8ccc-cccccccccccc/review')?.body).toEqual({ status: 'APPROVED' });
  });
});
