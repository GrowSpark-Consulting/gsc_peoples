// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Page from '@/app/(dashboard)/reports/page';
import { resetSessionCache } from '@/hooks/use-session';
import { apiError, meBody, mockApi, uuid } from '@/test/api-mock';

beforeEach(() => resetSessionCache());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const row = {
  employeeId: uuid(), employeeNumber: 'EMP-0001', name: 'Ravi Reddy', departmentName: 'Engineering',
  present: 18, absent: 1, onLeave: 2, holidays: 1, missingCheckout: 0, hoursWorked: 144.5,
};
const base = (extra: Record<string, unknown> = {}) => ({
  'GET /me': { body: meBody('HR_ADMIN') },
  'GET /organization/departments': { body: { data: [] } },
  'GET /attendance/report': { body: { data: [row], page: { page: 1, pageSize: 25, total: 1 }, meta: { year: 2026, month: 11 } } },
  ...extra,
});

describe('Reports page (ATT-008)', () => {
  it('shows the monthly totals returned by the API and asks for the chosen month', async () => {
    const api = mockApi(base() as never);
    render(<Page />);
    const tr = (await screen.findByText('Ravi Reddy')).closest('tr') as HTMLElement;
    expect(within(tr).getByText('144.5')).toBeTruthy();
    expect(within(tr).getByText('18')).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText('Month'), '3');
    await waitFor(() => expect(api.last('GET /attendance/report')?.query.get('month')).toBe('3'));
  });

  it('shows an error, never figures, when the report fails', async () => {
    mockApi(base({ 'GET /attendance/report': apiError(500, 'INTERNAL', 'x') }) as never);
    render(<Page />);
    expect(await screen.findByText(/Something went wrong on our side/)).toBeTruthy();
    expect(screen.queryByText('Ravi Reddy')).toBeNull();
  });

  it('is closed to roles without the report permission and asks the API for nothing', async () => {
    const api = mockApi({ 'GET /me': { body: meBody('MANAGER') } });
    render(<Page />);
    expect(await screen.findByText('No access')).toBeTruthy();
    expect(api.keys().filter((k) => k.includes('/attendance/report'))).toHaveLength(0);
  });
});
