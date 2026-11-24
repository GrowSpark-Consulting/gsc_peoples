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
const people = employeeList(employeeFixture(SELF, 'Self', 'Person'), employeeFixture(OTHER, 'Olivia', 'Other'));
const today = { body: { data: { date: '2026-03-02', record: null, state: 'DONE' } } };
const history = { body: { data: [], page: page(0) } };
const row = (o: Record<string, unknown> = {}) => ({
  employeeId: OTHER, employeeNumber: 'E-001', name: 'Olivia Other', departmentId: null, departmentName: 'Engineering', status: 'PRESENT',
  checkInAt: '2026-03-02T03:30:00.000Z', checkOutAt: null, workedMinutes: null, halfDayLeave: false, holidayName: null, corrected: false, ...o,
});
const overview = (rows: unknown[] = [], summary: Record<string, number> = {}) => ({
  body: {
    data: rows,
    page: page(rows.length),
    summary: { PRESENT: 0, ABSENT: 0, ON_LEAVE: 0, HOLIDAY: 0, WEEKEND: 0, NOT_YET_IN: 0, MISSING_CHECKOUT: 0, ...summary },
    meta: { date: '2026-03-02', isWorkingDay: true, isHoliday: false, holidayName: null },
  },
});
const hr = (extra: Record<string, object> = {}) => ({
  'GET /me': { body: meBody('HR_ADMIN', SELF) },
  'GET /attendance/today': today,
  'GET /attendance/history': history,
  'GET /attendance/corrections': { body: { data: [] } },
  'GET /employees': people,
  ...extra,
});

describe('HR overview by date (ATT-004)', () => {
  it('shows each employee with an explicit status; "not yet in" is never shown as absent', async () => {
    const api = mockApi(
      hr({
        'GET /attendance/overview': overview(
          [row(), row({ employeeId: SELF, name: 'Self Person', employeeNumber: 'E-002', status: 'NOT_YET_IN', checkInAt: null, departmentName: null })],
          { PRESENT: 1, NOT_YET_IN: 1 },
        ),
      }),
    );
    render(<AttendancePage />);
    const table = await screen.findByRole('region', { name: 'Attendance overview' });
    expect(await within(table).findByText('Olivia Other')).toBeTruthy();
    expect(within(table).getByText('Not yet in')).toBeTruthy();
    expect(within(table).queryByText('Absent')).toBeNull();
    expect(screen.getByText(/Present 1 · Absent 0/)).toBeTruthy();
    expect(api.last('GET /attendance/overview')?.query.get('status')).toBeNull();
  });

  it('changing the date or status asks the API for that date and status and goes back to page 1', async () => {
    const api = mockApi(hr({ 'GET /attendance/overview': overview() }));
    render(<AttendancePage />);
    const filters = await screen.findByRole('search', { name: 'Overview filters' });
    fireEvent.change(within(filters).getByLabelText('Date'), { target: { value: '2026-02-27' } });
    await waitFor(() => expect(api.calls.some((c) => c.key === 'GET /attendance/overview' && c.query.get('date') === '2026-02-27')).toBe(true));
    await userEvent.selectOptions(within(filters).getByLabelText('Status'), 'ABSENT');
    await waitFor(() => expect(api.calls.some((c) => c.query.get('status') === 'ABSENT' && c.query.get('date') === '2026-02-27' && c.query.get('page') === '1')).toBe(true));
  });

  it('has an empty state and an error state with a retry', async () => {
    mockApi(hr({ 'GET /attendance/overview': overview() }));
    const a = render(<AttendancePage />);
    expect(await screen.findByText('No employees to show')).toBeTruthy();
    a.unmount();
    resetSessionCache();
    mockApi(hr({ 'GET /attendance/overview': apiError(500, 'INTERNAL', 'x') }));
    render(<AttendancePage />);
    expect(await screen.findByText('Could not load the attendance overview.')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /try again/i }).length).toBeGreaterThan(0);
  });

  it('a permission failure from the API is shown as such instead of an empty table', async () => {
    mockApi(hr({ 'GET /attendance/overview': apiError(403, 'FORBIDDEN', 'no') }));
    render(<AttendancePage />);
    expect(await screen.findByText('You do not have permission to do that.')).toBeTruthy();
  });

  it('Manager and Employee never see the overview or the correction button and never request the overview', async () => {
    for (const role of ['MANAGER', 'EMPLOYEE'] as const) {
      resetSessionCache();
      const api = mockApi({ ...hr(), 'GET /me': { body: meBody(role, SELF) } });
      const r = render(<AttendancePage />);
      await screen.findByRole('region', { name: 'Attendance records' });
      expect(screen.queryByRole('region', { name: 'Attendance overview' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Correct attendance' })).toBeNull();
      expect(api.keys()).not.toContain('GET /attendance/overview');
      r.unmount();
    }
  });
});

describe('HR manual correction (ATT-007)', () => {
  const setup = (extra: Record<string, object> = {}) => mockApi(hr({ 'GET /attendance/overview': overview([row()], { PRESENT: 1 }), ...extra }));

  it('validates before sending: employee and a time are required, and check-out must follow check-in', async () => {
    const api = setup();
    render(<AttendancePage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Correct attendance' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save correction' }));
    expect(await within(dialog).findByText('Choose an employee.')).toBeTruthy();
    expect(within(dialog).getByText('Enter a check-in time, a check-out time or both.')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Check in'), { target: { value: '17:00' } });
    fireEvent.change(within(dialog).getByLabelText('Check out'), { target: { value: '09:00' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save correction' }));
    expect(await within(dialog).findByText('Check-out must be after check-in.')).toBeTruthy();
    expect(api.keys().some((k) => k.startsWith('POST'))).toBe(false);
  });

  it('the row action pre-selects the employee and the date; saving posts the company-timezone instant and refreshes the overview', async () => {
    const saved = { data: { id: uuid(), employeeId: OTHER, date: '2026-03-02', checkInAt: '2026-03-02T03:30:00.000Z', checkOutAt: null, workedMinutes: null, workedHours: null, createdAt: now, updatedAt: now } };
    const api = setup({ 'POST /attendance/manual-corrections': { status: 200, body: saved } });
    render(<AttendancePage />);
    const tr = (await within(await screen.findByRole('region', { name: 'Attendance overview' })).findByText('Olivia Other')).closest('tr') as HTMLElement;
    await userEvent.click(within(tr).getByRole('button', { name: 'Correct' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('option', { name: 'Olivia Other' });
    expect((within(dialog).getByLabelText(/^Employee/) as HTMLSelectElement).value).toBe(OTHER);
    const date = (within(dialog).getByLabelText(/^Date/) as HTMLInputElement).value;
    fireEvent.change(within(dialog).getByLabelText('Check in'), { target: { value: '09:00' } });
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Kiosk was down');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save correction' }));
    await waitFor(() => expect(api.keys()).toContain('POST /attendance/manual-corrections'));
    expect(api.last('POST /attendance/manual-corrections')?.body).toEqual({ employeeId: OTHER, date, checkInAt: zonedToIso(date, '09:00', 'Asia/Kolkata'), reason: 'Kiosk was down' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.keys().filter((k) => k === 'GET /attendance/overview').length).toBeGreaterThanOrEqual(2);
  });

  it('shows the server rule when it refuses (409) and keeps the dialog open', async () => {
    setup({ 'POST /attendance/manual-corrections': apiError(409, 'CONFLICT', 'A pending correction request exists for this date; review it first') });
    render(<AttendancePage />);
    const tr = (await within(await screen.findByRole('region', { name: 'Attendance overview' })).findByText('Olivia Other')).closest('tr') as HTMLElement;
    await userEvent.click(within(tr).getByRole('button', { name: 'Correct' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Check in'), { target: { value: '09:00' } });
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'x');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save correction' }));
    expect(await within(dialog).findByText('A pending correction request exists for this date; review it first')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
