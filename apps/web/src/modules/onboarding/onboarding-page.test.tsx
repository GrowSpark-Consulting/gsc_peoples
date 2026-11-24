// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSessionCache } from '@/hooks/use-session';
import { apiError, employeeFixture, employeeList, meBody, mockApi, uuid } from '@/test/api-mock';
import { OnboardingPage } from './onboarding-page';

beforeEach(() => resetSessionCache());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const SELF = uuid();
const NEWBIE = uuid();
const now = '2026-02-01T00:00:00.000Z';
const task = (o: Record<string, unknown> = {}) => ({
  id: uuid(), employeeId: SELF, title: 'Sign contract', dueDate: '2026-03-01', assigneeType: 'EMPLOYEE', assigneeEmployeeId: null,
  completed: false, completedAt: null, completedBy: null, createdAt: now, updatedAt: now, ...o,
});
const progress = (completed: number, total: number) => ({
  total, completed, remaining: total - completed, percentage: total ? (completed / total) * 100 : 0,
  status: completed === 0 ? 'NOT_STARTED' : completed === total ? 'COMPLETED' : 'IN_PROGRESS',
});
const checklist = (tasks: ReturnType<typeof task>[]) => ({
  body: { data: tasks, progress: progress(tasks.filter((t) => t.completed).length, tasks.length) },
});

describe('Employee: own checklist (ONB-003)', () => {
  it('shows progress and lets the employee mark only their own tasks done', async () => {
    const mine = task({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'Upload ID' });
    const hrTask = task({ id: uuid(), title: 'Set up laptop', assigneeType: 'HR' });
    let done = false;
    const api = mockApi({
      'GET /me': { body: meBody('EMPLOYEE', SELF) },
      [`GET /onboarding/employees/${SELF}/tasks`]: () => checklist([{ ...mine, completed: done }, hrTask]),
      'PATCH /onboarding/tasks/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/complete': () => {
        done = true;
        return { body: { data: mine } };
      },
    });
    render(<OnboardingPage />);
    expect(await screen.findByText('0 of 2 tasks done')).toBeTruthy();
    const myRow = (await screen.findByText('Upload ID')).closest('tr') as HTMLElement;
    const hrRow = screen.getByText('Set up laptop').closest('tr') as HTMLElement;
    expect(within(hrRow).queryByRole('button', { name: 'Mark done' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add task' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    await userEvent.click(within(myRow).getByRole('button', { name: 'Mark done' }));
    await waitFor(() => expect(api.keys()).toContain('PATCH /onboarding/tasks/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/complete'));
    expect(await screen.findByText('1 of 2 tasks done')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Onboarding progress' }).getAttribute('aria-valuenow')).toBe('50');
  });

  it('shows the server refusal and an empty state', async () => {
    mockApi({
      'GET /me': { body: meBody('EMPLOYEE', SELF) },
      [`GET /onboarding/employees/${SELF}/tasks`]: checklist([]),
    });
    render(<OnboardingPage />);
    expect(await screen.findByText('No tasks')).toBeTruthy();
    cleanup();
    resetSessionCache();
    mockApi({ 'GET /me': { body: meBody('EMPLOYEE', SELF) }, [`GET /onboarding/employees/${SELF}/tasks`]: apiError(403, 'FORBIDDEN', 'no') });
    render(<OnboardingPage />);
    expect(await screen.findByText('No access')).toBeTruthy();
  });
});

describe('HR: employees in onboarding (ONB-004, ONB-005)', () => {
  const hr = (extra: Record<string, unknown> = {}) => ({
    'GET /me': { body: meBody('HR_ADMIN', SELF) },
    'GET /employees': employeeList(employeeFixture(NEWBIE, 'Nina', 'Newhire', { status: 'ONBOARDING', invitationStatus: 'NOT_INVITED' })),
    [`GET /onboarding/employees/${NEWBIE}/tasks`]: checklist([task({ employeeId: NEWBIE, completed: true }), task({ employeeId: NEWBIE, title: 'Meet team' })]),
    ...extra,
  });

  it('lists onboarding employees with derived status, progress and invite state, asking only for ONBOARDING', async () => {
    const api = mockApi(hr() as never);
    render(<OnboardingPage />);
    const row = (await screen.findByText('Nina Newhire')).closest('tr') as HTMLElement;
    expect(within(row).getByText('1 of 2 · 50%')).toBeTruthy();
    expect(within(row).getByText('In progress')).toBeTruthy();
    expect(within(row).getByText('Not invited')).toBeTruthy();
    expect(api.last('GET /employees')?.query.get('status')).toBe('ONBOARDING');
  });

  it('filters by derived status', async () => {
    mockApi(hr() as never);
    render(<OnboardingPage />);
    await screen.findByText('Nina Newhire');
    await userEvent.selectOptions(screen.getByLabelText('Onboarding status'), 'COMPLETED');
    expect(await screen.findByText('No employees match')).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText('Onboarding status'), 'IN_PROGRESS');
    expect(await screen.findByText('Nina Newhire')).toBeTruthy();
  });

  it('invites from the onboarding screen', async () => {
    const api = mockApi(hr({ [`POST /employees/${NEWBIE}/invite`]: { status: 202, body: { data: {} } } }) as never);
    render(<OnboardingPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Invite' }));
    await waitFor(() => expect(api.keys()).toContain(`POST /employees/${NEWBIE}/invite`));
  });

  it('only users who may manage onboarding see the default checklist tab', async () => {
    mockApi(hr({ 'GET /onboarding/templates': { body: { data: [] } } }) as never);
    render(<OnboardingPage />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Default checklist' }));
    expect(await screen.findByText('No default tasks')).toBeTruthy();
  });

  it('a Manager has no onboarding access', async () => {
    mockApi({ 'GET /me': { body: meBody('MANAGER', SELF) } });
    render(<OnboardingPage />);
    expect(await screen.findByText('No access')).toBeTruthy();
  });

  it('adding a task validates the title first', async () => {
    const api = mockApi(hr() as never);
    render(<OnboardingPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Checklist' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add task' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add task' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add task' }));
    expect(await within(dialog).findByText(/./, { selector: 'p[id$="-error"]' })).toBeTruthy();
    expect(api.keys().some((k) => k.startsWith('POST /onboarding'))).toBe(false);
  });
});
