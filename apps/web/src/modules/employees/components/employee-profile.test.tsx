// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DEMO_IDS, demoUuid } from '../adapters/demo/demo-data';
import { ApiError } from '../errors';
import { renderEmployees, type RenderOptions } from '../testing/render';
import { EmployeeProfile } from './employee-profile';

const profile = (id: string, options?: RenderOptions) =>
  renderEmployees(<EmployeeProfile id={id} />, options);
const heading = (name: string) => screen.findByRole('heading', { level: 2, name });

describe('profile details (only fields from the approved schema)', () => {
  it('shows employment, contact and record fields', async () => {
    profile(DEMO_IDS.employee);
    await heading('Rohan Iyer');
    const employment = screen.getByRole('region', { name: 'Employment' });
    expect(within(employment).getByText('Software Engineer')).toBeInTheDocument();
    expect(within(employment).getByText('Full-time')).toBeInTheDocument();
    expect(within(employment).getByText('Engineering')).toBeInTheDocument();
    expect(within(employment).getByText('Kavya Menon')).toBeInTheDocument();
    expect(within(employment).getByText('2 Aug 2021')).toBeInTheDocument(); // hire date, calendar day not shifted by timezone
    const contact = screen.getByRole('region', { name: 'Contact and record' });
    expect(
      within(contact).getByRole('link', { name: 'rohan.iyer@growspark.example' }),
    ).toHaveAttribute('href', 'mailto:rohan.iyer@growspark.example');
    expect(within(contact).getAllByText('GS-0004').length).toBeGreaterThan(0);
    // the status badge (the HR status form also lists "Active" as an option, so exclude <option>)
    expect(screen.getAllByText('Active').some((el) => el.tagName !== 'OPTION')).toBe(true);
  });

  it('shows dashes for empty optional fields and no invented fields', async () => {
    profile(DEMO_IDS.hrAdmin);
    await heading('Meera Nair');
    const employment = screen.getByRole('region', { name: 'Employment' });
    expect(within(employment).getByText('Manager').nextElementSibling).toHaveTextContent('—');
    expect(within(employment).getByText('Termination date').nextElementSibling).toHaveTextContent(
      '—',
    );
    for (const forbidden of [/salary/i, /phone/i, /address/i, /date of birth/i, /national id/i]) {
      expect(screen.queryByText(forbidden)).toBeNull();
    }
  });

  it('shows the termination date for a terminated employee', async () => {
    profile(demoUuid(12));
    await heading('Amit Shah');
    expect(screen.getAllByText('Terminated').some((el) => el.tagName !== 'OPTION')).toBe(true);
    expect(screen.getAllByText('30 Jun 2026').length).toBeGreaterThan(0);
  });
});

describe('states', () => {
  it('shows a loading placeholder first', () => {
    const { container } = profile(DEMO_IDS.employee);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('shows "not found" for an unknown id', async () => {
    profile(demoUuid(9999));
    expect(await screen.findByText('Employee not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to employees' })).toHaveAttribute(
      'href',
      '/employees',
    );
  });

  it('shows an error with retry for server failures', async () => {
    let fail = true;
    const { user } = profile(DEMO_IDS.employee, {
      wrap: (s) => ({
        ...s,
        get: (id) => (fail ? Promise.reject(new ApiError(500, 'INTERNAL_ERROR', 'x')) : s.get(id)),
      }),
    });
    expect(await screen.findByText('Could not load this profile.')).toBeInTheDocument();
    fail = false;
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await heading('Rohan Iyer');
    void user;
  });

  it('shows an access message for 403', async () => {
    profile(DEMO_IDS.employee, {
      wrap: (s) => ({ ...s, get: () => Promise.reject(new ApiError(403, 'FORBIDDEN', 'no')) }),
    });
    expect(await screen.findByText('No access')).toBeInTheDocument();
  });
});

describe('permission rules', () => {
  it('HR Admin: can Edit and change status of anyone', async () => {
    profile(DEMO_IDS.otherTeamMember, { persona: 'hr' });
    await heading('Sanjay Kumar');
    expect(screen.getByRole('link', { name: 'Edit' })).toHaveAttribute(
      'href',
      `/employees/${DEMO_IDS.otherTeamMember}/edit`,
    );
    expect(screen.getByRole('form', { name: 'Change employment status' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Neha Gupta' })).toHaveAttribute(
      'href',
      `/employees/${demoUuid(13)}`,
    );
  });

  it('HR Admin can follow the manager link; others cannot', async () => {
    const hr = profile(DEMO_IDS.employee, { persona: 'hr' });
    await heading('Rohan Iyer');
    expect(screen.getByRole('link', { name: 'Kavya Menon' })).toHaveAttribute(
      'href',
      `/employees/${DEMO_IDS.manager}`,
    );
    hr.unmount();
    profile(DEMO_IDS.employee, { persona: 'manager' });
    await heading('Rohan Iyer');
    expect(screen.queryByRole('link', { name: 'Kavya Menon' })).toBeNull();
    expect(screen.getByText('Kavya Menon')).toBeInTheDocument();
  });

  it('Manager: can read a direct report and themself, read-only (no Edit, no status form)', async () => {
    const m = profile(DEMO_IDS.employee, { persona: 'manager' });
    await heading('Rohan Iyer');
    expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('form', { name: 'Change employment status' })).toBeNull();
    m.unmount();
    profile(DEMO_IDS.manager, { persona: 'manager' });
    await heading('Kavya Menon');
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull();
  });

  it("Manager: cannot open someone else's team member (shown as not found, existence not revealed)", async () => {
    profile(DEMO_IDS.otherTeamMember, { persona: 'manager' });
    expect(await screen.findByText('Employee not found')).toBeInTheDocument();
    expect(screen.queryByText('Sanjay Kumar')).toBeNull();
  });

  it('Employee: own profile only, read-only', async () => {
    const own = profile(DEMO_IDS.employee, { persona: 'employee' });
    await heading('Rohan Iyer');
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('form', { name: 'Change employment status' })).toBeNull();
    own.unmount();
    profile(DEMO_IDS.manager, { persona: 'employee' });
    expect(await screen.findByText('Employee not found')).toBeInTheDocument();
  });
});

describe('status change (HR Admin)', () => {
  const form = () => screen.getByRole('form', { name: 'Change employment status' });

  it('Update is disabled until the status actually changes', async () => {
    profile(DEMO_IDS.employee);
    await heading('Rohan Iyer');
    expect(within(form()).getByRole('button', { name: 'Update status' })).toBeDisabled();
  });

  it('Terminated requires a termination date; then the profile reflects the change', async () => {
    const { user } = profile(DEMO_IDS.employee);
    await heading('Rohan Iyer');
    await user.selectOptions(
      within(form()).getByRole('combobox', { name: 'Status' }),
      'Terminated',
    );
    await user.click(within(form()).getByRole('button', { name: 'Update status' }));
    expect(await within(form()).findByText('Enter the termination date')).toBeInTheDocument();

    await user.type(within(form()).getByLabelText(/Termination date/), '2026-12-31');
    await user.click(within(form()).getByRole('button', { name: 'Update status' }));
    await waitFor(() => expect(screen.getByText('31 Dec 2026')).toBeInTheDocument());
    expect(screen.getAllByText('Terminated').length).toBeGreaterThan(0);
  });

  it('shows a server rejection (date before hire) next to the date field', async () => {
    const { user } = profile(DEMO_IDS.employee);
    await heading('Rohan Iyer');
    await user.selectOptions(
      within(form()).getByRole('combobox', { name: 'Status' }),
      'Terminated',
    );
    await user.type(within(form()).getByLabelText(/Termination date/), '2000-01-01');
    await user.click(within(form()).getByRole('button', { name: 'Update status' }));
    expect(await within(form()).findByText(/before the hire date/)).toBeInTheDocument();
  });

  it('other statuses change without a date', async () => {
    const { user } = profile(DEMO_IDS.employee);
    await heading('Rohan Iyer');
    await user.selectOptions(within(form()).getByRole('combobox', { name: 'Status' }), 'On leave');
    await user.click(within(form()).getByRole('button', { name: 'Update status' }));
    await waitFor(() => expect(screen.getAllByText('On leave').length).toBeGreaterThan(0));
    expect(within(form()).queryByLabelText(/Termination date/)).toBeNull();
  });
});
