// @vitest-environment jsdom
import { ROLE_DEFAULT_PERMISSIONS } from '@gsc/contracts';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSessionCache } from '@/hooks/use-session';
import { apiError, meBody, mockApi } from '@/test/api-mock';
import { DashboardPage, dashboardVariant } from './dashboard-page';

beforeEach(() => resetSessionCache());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const session = (role: keyof typeof ROLE_DEFAULT_PERMISSIONS) => ({
  displayName: 'x',
  roleKey: role,
  employeeId: 'e1',
  permissions: ROLE_DEFAULT_PERMISSIONS[role],
});

describe('dashboardVariant (role to dashboard)', () => {
  it('picks the widest dashboard each role may read', () => {
    expect(dashboardVariant(session('SUPER_ADMIN'))).toBe('hr');
    expect(dashboardVariant(session('HR_ADMIN'))).toBe('hr');
    expect(dashboardVariant(session('MANAGER'))).toBe('manager');
    expect(dashboardVariant(session('EMPLOYEE'))).toBe('employee');
    expect(dashboardVariant({ ...session('EMPLOYEE'), permissions: [] })).toBeNull();
  });
});

const hrData = {
  totalEmployees: 12,
  activeEmployees: 10,
  presentToday: 7,
  absentToday: 2,
  onLeaveToday: 1,
  pendingApprovals: 3,
  joinersLast30Days: 4,
  recentActivities: [],
};

describe('HR / Super Admin dashboard (DASH-001)', () => {
  it('shows the counts from the API, an empty activity state, and no other role content', async () => {
    mockApi({ 'GET /me': { body: meBody('HR_ADMIN') }, 'GET /dashboard/hr': { body: { data: hrData } } });
    render(<DashboardPage />);
    expect(await screen.findByText('Total employees')).toBeTruthy();
    const card = (label: string) => screen.getByText(label).parentElement as HTMLElement;
    expect(card('Total employees').textContent).toContain('12');
    expect(card('Pending approvals').textContent).toContain('3');
    expect(card('Joined in last 30 days').textContent).toContain('4');
    expect(screen.getByText('No activity yet')).toBeTruthy();
    expect(screen.queryByText('Team members')).toBeNull();
    expect(screen.queryByRole('button', { name: /check in/i })).toBeNull();
  });

  it('shows an error with retry (never zeros) when the API fails, and recovers', async () => {
    let fail = true;
    const api = mockApi({
      'GET /me': { body: meBody('HR_ADMIN') },
      'GET /dashboard/hr': () => (fail ? apiError(500, 'INTERNAL', 'db down') : { body: { data: hrData } }),
    });
    render(<DashboardPage />);
    expect(await screen.findByText(/Something went wrong on our side/)).toBeTruthy();
    expect(screen.queryByText('Total employees')).toBeNull();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('Total employees')).toBeTruthy();
    expect(api.keys().filter((k) => k === 'GET /dashboard/hr')).toHaveLength(2);
  });

  it('shows "No access" on a 403 from the API', async () => {
    mockApi({ 'GET /me': { body: meBody('HR_ADMIN') }, 'GET /dashboard/hr': apiError(403, 'FORBIDDEN', 'no') });
    render(<DashboardPage />);
    expect(await screen.findByText('No access')).toBeTruthy();
  });
});

describe('Manager dashboard (DASH-002)', () => {
  it('shows team numbers and team leave only', async () => {
    mockApi({
      'GET /me': { body: meBody('MANAGER') },
      'GET /dashboard/manager': {
        body: {
          data: {
            teamMembers: 5,
            teamAttendance: { present: 3, absent: 1, onLeave: 1 },
            pendingApprovals: 2,
            teamLeaveCalendar: [],
          },
        },
      },
      'GET /employees': { body: { data: [], page: { limit: 100, nextCursor: null } } },
    });
    render(<DashboardPage />);
    expect(await screen.findByText('Team members')).toBeTruthy();
    expect((screen.getByText('Present today').parentElement as HTMLElement).textContent).toContain('3');
    expect(screen.getByText('No approved leave')).toBeTruthy();
    expect(screen.queryByText('Total employees')).toBeNull();
  });
});

describe('Employee dashboard (DASH-003)', () => {
  const routes = (action: 'CHECK_IN' | 'CHECK_OUT' | 'DONE') => ({
    'GET /me': { body: meBody('EMPLOYEE') },
    'GET /dashboard/employee': {
      body: {
        data: {
          profileSummary: { firstName: 'Ravi', lastName: 'Reddy', employeeNumber: 'EMP-0003', jobTitle: 'Engineer', workEmail: 'r@x.io' },
          attendanceState: { action, today: null },
          leaveBalances: [],
          leaveRequests: [],
          notifications: [],
        },
      },
    },
    'GET /leave/balances': { body: { data: [] } },
  });

  it('button reflects the server state: Check in, Check out, Done', async () => {
    mockApi(routes('CHECK_IN'));
    const { unmount } = render(<DashboardPage />);
    expect(await screen.findByRole('button', { name: 'Check in' })).toBeTruthy();
    unmount();
    resetSessionCache();
    mockApi(routes('CHECK_OUT'));
    const second = render(<DashboardPage />);
    expect(await screen.findByRole('button', { name: 'Check out' })).toBeTruthy();
    second.unmount();
    resetSessionCache();
    mockApi(routes('DONE'));
    render(<DashboardPage />);
    const done = await screen.findByRole('button', { name: 'Done for today' });
    expect((done as HTMLButtonElement).disabled).toBe(true);
  });

  it('checks in once (no duplicate submit), then reloads state; a server rejection is shown', async () => {
    let state: 'CHECK_IN' | 'CHECK_OUT' = 'CHECK_IN';
    const api = mockApi({
      ...routes('CHECK_IN'),
      'GET /dashboard/employee': () => ({
        body: { data: { profileSummary: null, attendanceState: { action: state, today: null }, leaveBalances: [], leaveRequests: [], notifications: [] } },
      }),
      'POST /attendance/check-in': () => {
        state = 'CHECK_OUT';
        return { status: 201, body: { data: {} } };
      },
    });
    render(<DashboardPage />);
    const btn = await screen.findByRole('button', { name: 'Check in' });
    await userEvent.dblClick(btn);
    expect(await screen.findByRole('button', { name: 'Check out' })).toBeTruthy();
    expect(api.keys().filter((k) => k === 'POST /attendance/check-in')).toHaveLength(1);
  });

  it('shows the server message when check-in is rejected', async () => {
    mockApi({ ...routes('CHECK_IN'), 'POST /attendance/check-in': apiError(409, 'CONFLICT', 'Already checked in today') });
    render(<DashboardPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Check in' }));
    expect(await screen.findByText('Already checked in today')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check in' })).toBeTruthy());
  });
});
