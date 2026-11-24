// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSessionCache } from '@/hooks/use-session';
import { apiError, meBody, mockApi, uuid } from '@/test/api-mock';
import { OrganizationPage } from './organization-page';

beforeEach(() => resetSessionCache());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const now = '2026-01-01T00:00:00.000Z';
const dept = (name: string, o: Record<string, unknown> = {}) => ({ id: uuid(), name, description: null, isActive: true, createdAt: now, updatedAt: now, ...o });

describe('Departments and designations (ORG-002)', () => {
  it('an Employee can look but not change anything', async () => {
    mockApi({ 'GET /me': { body: meBody('EMPLOYEE') }, 'GET /organization/departments': { body: { data: [dept('Engineering')] } } });
    render(<OrganizationPage />);
    expect(await screen.findByText('Engineering')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add department' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByText('Actions')).toBeNull();
  });

  it('HR can add (with validation), archive and see employees of a department', async () => {
    const eng = dept('Engineering', { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    const api = mockApi({
      'GET /me': { body: meBody('HR_ADMIN') },
      'GET /organization/departments': { body: { data: [eng, dept('Old Dept', { isActive: false })] } },
      'POST /organization/departments': { status: 201, body: { data: eng } },
      'PATCH /organization/departments/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa': { body: { data: eng } },
    });
    render(<OrganizationPage />);
    expect((await screen.findAllByRole('link', { name: 'View employees' }))[0]!.getAttribute('href')).toBe('/employees?dept=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

    await userEvent.click(screen.getByRole('button', { name: 'Add department' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add department' }));
    expect(await within(dialog).findByText(/./, { selector: 'p[id$="-error"]' })).toBeTruthy();
    expect(api.keys()).not.toContain('POST /organization/departments');
    await userEvent.type(within(dialog).getByLabelText(/Name/), 'Finance');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add department' }));
    await waitFor(() => expect(api.keys()).toContain('POST /organization/departments'));
    expect(api.last('POST /organization/departments')?.body).toEqual({ name: 'Finance', description: null });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await userEvent.click(screen.getAllByRole('button', { name: 'Archive' })[0]!);
    await waitFor(() => expect(api.keys()).toContain('PATCH /organization/departments/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));
    expect(api.last('PATCH /organization/departments/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')?.body).toEqual({ isActive: false });
  });

  it('filters by search and status, with a no-results state', async () => {
    mockApi({
      'GET /me': { body: meBody('HR_ADMIN') },
      'GET /organization/departments': { body: { data: [dept('Engineering'), dept('Sales'), dept('Legacy', { isActive: false })] } },
    });
    render(<OrganizationPage />);
    await screen.findByText('Engineering');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search departments' }), 'sal');
    expect(screen.queryByText('Engineering')).toBeNull();
    expect(screen.getByText('Sales')).toBeTruthy();
    await userEvent.clear(screen.getByRole('searchbox', { name: 'Search departments' }));
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'archived');
    expect(screen.getByText('Legacy')).toBeTruthy();
    expect(screen.queryByText('Sales')).toBeNull();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search departments' }), 'zzz');
    expect(await screen.findByText('No departments match')).toBeTruthy();
  });

  it('shows the API message when a name is a duplicate (ORG-002 unique names)', async () => {
    mockApi({
      'GET /me': { body: meBody('HR_ADMIN') },
      'GET /organization/departments': { body: { data: [] } },
      'POST /organization/departments': apiError(400, 'VALIDATION_ERROR', 'Department name must be unique'),
    });
    render(<OrganizationPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add department' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Name/), 'Engineering');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add department' }));
    expect(await within(dialog).findByText('Department name must be unique')).toBeTruthy();
  });

  it('shows an error with retry when the list fails', async () => {
    mockApi({ 'GET /me': { body: meBody('HR_ADMIN') }, 'GET /organization/departments': apiError(500, 'INTERNAL', 'x') });
    render(<OrganizationPage />);
    expect(await screen.findByText('Could not load departments.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });
});

describe('Holidays (ORG-004) and reporting structure', () => {
  it('Manager sees holidays read-only; HR can add one', async () => {
    const hol = { id: uuid(), date: '2026-01-26', name: 'Republic Day', isActive: true, createdAt: now, updatedAt: now };
    mockApi({ 'GET /me': { body: meBody('MANAGER') }, 'GET /organization/holidays': { body: { data: [hol] } } });
    const a = render(<OrganizationPage />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Holidays' }));
    expect(await screen.findByText('Republic Day')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add holiday' })).toBeNull();
    a.unmount();
    resetSessionCache();
    mockApi({ 'GET /me': { body: meBody('HR_ADMIN') }, 'GET /organization/holidays': { body: { data: [hol] } } });
    render(<OrganizationPage />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Holidays' }));
    expect(await screen.findByRole('button', { name: 'Add holiday' })).toBeTruthy();
  });

  it('renders the reporting structure as an indented list', async () => {
    const child = { id: uuid(), employeeNumber: 'EMP-0002', name: 'Casey Report', jobTitle: 'Engineer', department: null, reports: [] };
    const root = { id: uuid(), employeeNumber: 'EMP-0001', name: 'Hana Lead', jobTitle: 'Head', department: { id: uuid(), name: 'People' }, reports: [child] };
    mockApi({ 'GET /me': { body: meBody('HR_ADMIN') }, 'GET /organization/hierarchy': { body: { data: [root] } } });
    render(<OrganizationPage />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Reporting structure' }));
    const list = await screen.findByRole('list', { name: 'Reporting structure' });
    expect(within(list).getByText('Hana Lead')).toBeTruthy();
    expect(within(list).getByText('Casey Report')).toBeTruthy();
    expect(within(list).getAllByRole('list')).toHaveLength(1);
  });
});
