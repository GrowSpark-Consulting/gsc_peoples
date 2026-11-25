// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSessionCache } from '@/hooks/use-session';
import { apiError, employeeFixture, employeeList, meBody, mockApi, page, uuid } from '@/test/api-mock';
import { LeavePage } from './leave-page';

beforeEach(() => resetSessionCache());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const SELF = uuid();
const OTHER = uuid();
const TYPE = uuid();
const now = '2026-01-01T00:00:00.000Z';

const leaveType = { id: TYPE, name: 'Casual', annualAllocation: 12, isPaid: true, allowHalfDay: true, isActive: true, createdAt: now, updatedAt: now };
const request = (o: Partial<Record<string, unknown>> = {}) => ({
  id: uuid(),
  employeeId: OTHER,
  leaveTypeId: TYPE,
  leaveTypeName: 'Casual',
  startDate: '2099-03-10T00:00:00.000Z',
  endDate: '2099-03-11T00:00:00.000Z',
  dayType: 'FULL_DAY',
  halfDaySession: null,
  reason: 'Family event',
  days: 2,
  status: 'PENDING',
  createdAt: now,
  updatedAt: now,
  ...o,
});
const employees = employeeList(employeeFixture(SELF, 'Self', 'Person'), employeeFixture(OTHER, 'Olivia', 'Other'));
const balances = {
  body: { data: [{ employeeId: SELF, leaveTypeId: TYPE, leaveTypeName: 'Casual', year: 2026, allocated: 12, adjusted: 0, used: 2, pending: 1, available: 9 }] },
};

describe('Employee: balances, history, apply (LEAVE-002, 003, 004)', () => {
  const base = (extra: Record<string, never> = {}) => ({
    'GET /me': { body: meBody('EMPLOYEE', SELF) },
    'GET /leave/balances': balances,
    'GET /leave/types': { body: { data: [leaveType] } },
    'GET /leave/requests': { body: { data: [], page: page(0) } },
    ...extra,
  });

  it('shows balances, own history only, and no approval or type-management sections', async () => {
    const api = mockApi(base());
    render(<LeavePage />);
    expect(await screen.findByText('Casual available')).toBeTruthy();
    expect((screen.getByText('Casual available').parentElement as HTMLElement).textContent).toContain('9');
    expect(await screen.findByText('No leave requests')).toBeTruthy();
    expect(screen.queryByText('Pending approvals')).toBeNull();
    expect(screen.queryByText('Leave types')).toBeNull();
    expect(screen.queryByText('Adjust balance')).toBeNull();
    // history is requested for the employee's own record
    expect(api.last('GET /leave/requests')?.query.get('employeeId')).toBe(SELF);
  });

  it('validates the form on the client and sends nothing when invalid', async () => {
    const api = mockApi(base());
    render(<LeavePage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Apply for leave' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit request' }));
    expect(await within(dialog).findAllByText(/./, { selector: 'p[id$="-error"]' })).not.toHaveLength(0);
    expect(api.keys()).not.toContain('POST /leave/requests');
  });

  it('submits a half-day request as one date with its session, then refreshes the list', async () => {
    const api = mockApi(base({ 'POST /leave/requests': { status: 201, body: { data: {} } } } as never));
    render(<LeavePage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Apply for leave' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText(/Leave type/), TYPE);
    await userEvent.selectOptions(within(dialog).getByLabelText('Duration'), 'HALF_DAY');
    await userEvent.selectOptions(within(dialog).getByLabelText('Half'), 'SECOND_HALF');
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Appointment');
    const before = api.keys().filter((k) => k === 'GET /leave/requests').length;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit request' }));
    await waitFor(() => expect(api.keys()).toContain('POST /leave/requests'));
    const body = api.last('POST /leave/requests')?.body as Record<string, unknown>;
    expect(body).toMatchObject({ leaveTypeId: TYPE, dayType: 'HALF_DAY', halfDaySession: 'SECOND_HALF', reason: 'Appointment' });
    expect(body.startDate).toBe(body.endDate);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(api.keys().filter((k) => k === 'GET /leave/requests').length).toBeGreaterThan(before));
  });

  it('shows the server reason when the request is rejected (insufficient balance, overlap)', async () => {
    mockApi(base({ 'POST /leave/requests': apiError(400, 'VALIDATION_ERROR', 'Insufficient leave balance') } as never));
    render(<LeavePage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Apply for leave' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText(/Leave type/), TYPE);
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Trip');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit request' }));
    expect(await within(dialog).findByText('Insufficient leave balance')).toBeTruthy();
  });

  it('offers Cancel only for own pending or approved leave that has not started', async () => {
    mockApi(
      base({
        'GET /leave/requests': {
          body: {
            data: [
              request({ id: uuid(), employeeId: SELF, reason: 'future pending' }),
              request({ id: uuid(), employeeId: SELF, status: 'REJECTED', reason: 'future rejected' }),
              request({ id: uuid(), employeeId: SELF, startDate: '2020-01-01T00:00:00.000Z', endDate: '2020-01-02T00:00:00.000Z', reason: 'past pending' }),
              request({ id: uuid(), employeeId: SELF, status: 'APPROVED', startDate: '2020-01-03T00:00:00.000Z', endDate: '2020-01-04T00:00:00.000Z', reason: 'started approved' }),
              request({ id: uuid(), employeeId: SELF, status: 'APPROVED', startDate: '2099-01-03T00:00:00.000Z', endDate: '2099-01-04T00:00:00.000Z', reason: 'future approved' }),
            ],
            page: page(5),
          },
        },
      } as never),
    );
    render(<LeavePage />);
    const row = async (t: string) => (await screen.findByText(t)).closest('tr') as HTMLElement;
    expect(within(await row('future pending')).queryByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(within(await row('future rejected')).queryByRole('button', { name: 'Cancel' })).toBeNull();
    // PRD LEAVE-007: pending may always be cancelled by its owner; approved only before it starts.
    expect(within(await row('past pending')).queryByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(within(await row('started approved')).queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(within(await row('future approved')).queryByRole('button', { name: 'Cancel' })).toBeTruthy();
  });
});

describe('Approvals (LEAVE-005, LEAVE-006): no self-approval', () => {
  const hr = (extra: Record<string, unknown> = {}) => ({
    'GET /me': { body: meBody('HR_ADMIN', SELF) },
    'GET /leave/balances': balances,
    'GET /leave/types': { body: { data: [leaveType] } },
    'GET /employees': employees,
    'GET /leave/requests': ({ query }: { query: URLSearchParams }) =>
      query.get('pendingForMe') === 'true'
        ? { body: { data: [request({ id: uuid(), employeeId: SELF, reason: 'my own leave' }), request({ id: uuid(), reason: 'their leave' })], page: page(2) } }
        : { body: { data: [], page: page(0) } },
    ...extra,
  });

  it('never offers Approve or Reject on the approver\'s own request', async () => {
    mockApi(hr() as never);
    render(<LeavePage />);
    const region = await screen.findByRole('region', { name: 'Pending leave requests' });
    expect(await within(region).findByText('their leave')).toBeTruthy();
    expect(within(region).getByText('Olivia Other')).toBeTruthy();
    expect(within(region).queryByText('my own leave')).toBeNull();
    expect(within(region).getAllByRole('button', { name: 'Approve' })).toHaveLength(1);
    expect(within(region).getAllByRole('button', { name: 'Reject' })).toHaveLength(1);
  });

  it('rejecting requires a comment and sends nothing without one', async () => {
    const api = mockApi(hr({ 'PATCH /leave/requests/x/review': { body: {} } }) as never);
    render(<LeavePage />);
    const region = await screen.findByRole('region', { name: 'Pending leave requests' });
    await userEvent.click(await within(region).findByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(await within(dialog).findByText('A comment is required when rejecting.')).toBeTruthy();
    expect(api.keys().some((k) => k.startsWith('PATCH /leave/requests/'))).toBe(false);
  });

  it('approves with the decision the user chose and reloads the queue', async () => {
    let approved = false;
    const api = mockApi(
      hr({
        'GET /leave/requests': ({ query }: { query: URLSearchParams }) =>
          query.get('pendingForMe') === 'true'
            ? { body: { data: approved ? [] : [request({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', reason: 'their leave' })], page: page(1) } }
            : { body: { data: [], page: page(0) } },
        'PATCH /leave/requests/dddddddd-dddd-4ddd-8ddd-dddddddddddd/review': () => {
          approved = true;
          return { body: { data: {} } };
        },
      }) as never,
    );
    render(<LeavePage />);
    const region = await screen.findByRole('region', { name: 'Pending leave requests' });
    await userEvent.click(await within(region).findByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(api.keys()).toContain('PATCH /leave/requests/dddddddd-dddd-4ddd-8ddd-dddddddddddd/review'));
    expect(api.last('PATCH /leave/requests/dddddddd-dddd-4ddd-8ddd-dddddddddddd/review')?.body).toEqual({ status: 'APPROVED' });
    expect(await within(region).findByText('Nothing to approve')).toBeTruthy();
  });

  it('a Manager asks only for requests waiting on them (direct reports)', async () => {
    const api = mockApi({
      'GET /me': { body: meBody('MANAGER', SELF) },
      'GET /leave/balances': balances,
      'GET /leave/types': { body: { data: [leaveType] } },
      'GET /employees': employees,
      'GET /leave/requests': { body: { data: [], page: page(0) } },
    });
    render(<LeavePage />);
    expect(await screen.findByText('Pending approvals')).toBeTruthy();
    await waitFor(() => expect(api.calls.some((c) => c.key === 'GET /leave/requests' && c.query.get('pendingForMe') === 'true')).toBe(true));
    expect(api.calls.some((c) => c.query.get('status') === 'PENDING')).toBe(false);
    expect(screen.queryByText('Leave types')).toBeNull();
  });
});

describe('Leave types (LEAVE-001) and balance adjustment (LEAVE-002): HR only', () => {
  it('HR sees leave types and Adjust balance; a 403 is shown, not hidden', async () => {
    mockApi({
      'GET /me': { body: meBody('HR_ADMIN', SELF) },
      'GET /leave/balances': balances,
      'GET /leave/types': { body: { data: [leaveType] } },
      'GET /employees': employees,
      'GET /leave/requests': apiError(403, 'FORBIDDEN', 'no'),
    });
    render(<LeavePage />);
    expect(await screen.findByText('Leave types')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Adjust balance' })).toBeTruthy();
    expect(await screen.findAllByText('You do not have permission to do that.')).not.toHaveLength(0);
  });
});
