// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { demoUuid } from '../adapters/demo/demo-data';
import { EMPTY_FILTERS } from '../filters';
import { renderEmployees, type RenderOptions } from '../testing/render';
import { EmployeeDirectory } from './employee-directory';

const show = (options?: RenderOptions, props: Partial<Parameters<typeof EmployeeDirectory>[0]> = {}) =>
  renderEmployees(
    <EmployeeDirectory filters={EMPTY_FILTERS} onFiltersChange={() => {}} limit={50} searchDebounceMs={0} {...props} />,
    options,
  );

const table = () => screen.getByTestId('employee-table');
const loaded = () => waitFor(() => expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument());
const open = async (user: ReturnType<typeof show>['user'], name: string) => {
  await user.click(within(table()).getByRole('link', { name }));
  return screen.findByRole('dialog', { name: 'Employee profile' });
};

describe('profile drawer', () => {
  it('a click on a name opens the profile in a right-side dialog and the list stays visible', async () => {
    const { user } = show();
    await loaded();
    const drawer = await open(user, 'Kavya Menon');
    expect(drawer).toHaveAttribute('aria-modal', 'true');
    expect(await within(drawer).findByRole('article', { name: 'Profile of Kavya Menon' })).toBeInTheDocument();
    expect(within(table()).getAllByRole('row').length).toBeGreaterThan(5); // list still rendered behind it
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('shows only supported fields, with department and manager summaries', async () => {
    const { user } = show();
    await loaded();
    const drawer = await open(user, 'Rohan Iyer');
    const profile = await within(drawer).findByRole('article', { name: 'Profile of Rohan Iyer' });
    for (const label of ['Job title', 'Employment type', 'Department', 'Manager', 'Hire date', 'Termination date', 'Work email', 'Employee number', 'Created', 'Last updated']) {
      expect(within(profile).getByText(label)).toBeInTheDocument();
    }
    expect(within(profile).getByText('Engineering')).toBeInTheDocument();
    expect(within(profile).getByRole('link', { name: 'Kavya Menon' })).toBeInTheDocument();
    for (const forbidden of [/salary/i, /phone/i, /address/i, /date of birth/i]) {
      expect(within(profile).queryByText(forbidden)).toBeNull();
    }
  });

  it('HR Admin gets Edit, "Open full page" and the status form in the drawer', async () => {
    const { user } = show();
    await loaded();
    const drawer = await open(user, 'Rohan Iyer');
    expect(await within(drawer).findByRole('link', { name: /Edit/ })).toHaveAttribute('href', `/employees/${demoUuid(4)}/edit`);
    expect(within(drawer).getByRole('link', { name: /Open full page/ })).toHaveAttribute('href', `/employees/${demoUuid(4)}`);
    expect(within(drawer).getByRole('form', { name: 'Change employment status' })).toBeInTheDocument();
  });

  it('Manager sees a direct report read-only: no Edit, no status form', async () => {
    const { user } = show({ persona: 'manager' });
    await loaded();
    const drawer = await open(user, 'Rohan Iyer');
    await within(drawer).findByRole('article', { name: 'Profile of Rohan Iyer' });
    expect(within(drawer).queryByRole('link', { name: /Edit/ })).toBeNull();
    expect(within(drawer).queryByRole('form', { name: 'Change employment status' })).toBeNull();
    expect(within(drawer).getByRole('link', { name: /Open full page/ })).toBeInTheDocument();
  });

  it('Employee opens their own record read-only', async () => {
    const { user } = show({ persona: 'employee' });
    await loaded();
    const drawer = await open(user, 'Rohan Iyer');
    await within(drawer).findByRole('article', { name: 'Profile of Rohan Iyer' });
    expect(within(drawer).getByText('You')).toBeInTheDocument();
    expect(within(drawer).queryByRole('link', { name: /Edit/ })).toBeNull();
    expect(within(drawer).queryByRole('form', { name: 'Change employment status' })).toBeNull();
  });

  it('Escape closes it, scroll unlocks and focus returns to the name that opened it', async () => {
    const { user } = show();
    await loaded();
    const link = within(table()).getByRole('link', { name: 'Kavya Menon' });
    await user.click(link);
    await screen.findByRole('dialog', { name: 'Employee profile' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.body.style.overflow).toBe('');
    expect(link).toHaveFocus();
  });

  it('opens from the keyboard (Enter on the focused name)', async () => {
    const { user } = show();
    await loaded();
    within(table()).getByRole('link', { name: 'Kavya Menon' }).focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('dialog', { name: 'Employee profile' })).toBeInTheDocument();
  });

  it('the manager link switches the drawer to the manager without leaving the page', async () => {
    const { user } = show();
    await loaded();
    const drawer = await open(user, 'Rohan Iyer');
    await user.click(await within(drawer).findByRole('link', { name: 'Kavya Menon' }));
    expect(await within(drawer).findByRole('article', { name: 'Profile of Kavya Menon' })).toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('a status change made in the drawer shows up in the list behind it', async () => {
    const { user } = show();
    await loaded();
    const drawer = await open(user, 'Rohan Iyer');
    const form = await within(drawer).findByRole('form', { name: 'Change employment status' });
    await user.selectOptions(within(form).getByLabelText('Status'), 'On leave');
    await user.click(within(form).getByRole('button', { name: 'Update status' }));
    await waitFor(() => {
      const row = within(table()).getByRole('link', { name: 'Rohan Iyer' }).closest('tr')!;
      expect(within(row).getByText('On leave')).toBeInTheDocument();
    });
  });

  it('an unknown or out-of-scope id shows "Employee not found" inside the drawer', async () => {
    show({ persona: 'manager' }, { viewId: demoUuid(14), onViewChange: () => {} }); // another team's employee
    const drawer = await screen.findByRole('dialog', { name: 'Employee profile' });
    expect(await within(drawer).findByText('Employee not found')).toBeInTheDocument();
  });

  it('controlled mode reports open and close through onViewChange', async () => {
    const calls: (string | null)[] = [];
    const { user } = show(undefined, { viewId: null, onViewChange: (id) => calls.push(id) });
    await loaded();
    await user.click(within(table()).getByRole('link', { name: 'Kavya Menon' }));
    expect(calls).toEqual([demoUuid(3)]);
    expect(screen.queryByRole('dialog')).toBeNull(); // parent owns the state and has not opened it
  });
});
