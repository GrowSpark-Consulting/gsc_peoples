// @vitest-environment jsdom
import type { Employee } from '@gsc/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEMO_IDS, DEPT, demoUuid } from '../adapters/demo/demo-data';
import { ApiError } from '../errors';
import { renderEmployees, type RenderOptions } from '../testing/render';
import type { EmployeesService } from '../service';
import { EmployeeForm } from './employee-form';

const textbox = (name: RegExp | string) => screen.getByRole('textbox', { name });

function setup(mode: 'create' | 'edit', options: RenderOptions & { employee?: Employee } = {}) {
  const onSaved = vi.fn();
  const onCancel = vi.fn();
  const spies = { create: vi.fn(), update: vi.fn() };
  const { employee, wrap, ...rest } = options;
  const utils = renderEmployees(
    <EmployeeForm mode={mode} employee={employee} onSaved={onSaved} onCancel={onCancel} />,
    {
      ...rest,
      wrap: (s, store) => {
        const base: EmployeesService = {
          ...s,
          create: (i) => (spies.create(i), s.create(i)),
          update: (id, i) => (spies.update(id, i), s.update(id, i)),
        };
        return wrap ? wrap(base, store) : base;
      },
    },
  );
  return { ...utils, onSaved, onCancel, spies };
}

async function fillRequired(user: ReturnType<typeof setup>['user'], number = 'GS-0500') {
  await user.type(textbox(/Employee number/), number);
  await user.type(textbox(/First name/), 'Tara');
  await user.type(textbox(/Last name/), 'Banerjee');
}

/** Everything the create contract requires (PRD EMP-001): number, names, work email, joining date, department. */
async function fillAllRequired(user: ReturnType<typeof setup>['user'], number = 'GS-0500', email = 'tara.banerjee@growspark.example') {
  await fillRequired(user, number);
  await user.type(textbox(/Work email/), email);
  await user.type(screen.getByLabelText('Hire date'), '2026-01-05');
  await user.selectOptions(screen.getByRole('combobox', { name: 'Department' }), 'Engineering');
}

describe('validation (client side, same schema as the API)', () => {
  it('blocks an empty submit, explains each field, and focuses the first invalid one', async () => {
    const { user, spies } = setup('create');
    await user.click(screen.getByRole('button', { name: 'Create employee' }));
    expect(await screen.findByText('Enter an employee number')).toBeInTheDocument();
    expect(screen.getByText('Enter a first name')).toBeInTheDocument();
    expect(screen.getByText('Enter a last name')).toBeInTheDocument();
    expect(spies.create).not.toHaveBeenCalled();
    expect(textbox(/Employee number/)).toHaveFocus();
    expect(textbox(/Employee number/)).toHaveAttribute('aria-invalid', 'true');
    expect(textbox(/Employee number/)).toHaveAccessibleDescription(/Enter an employee number/);
  });

  it('rejects a malformed email and employee number characters', async () => {
    const { user, spies } = setup('create');
    await fillRequired(user, 'bad number!');
    await user.type(textbox(/Work email/), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Create employee' }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText(/Use letters, numbers and/)).toBeInTheDocument();
    expect(spies.create).not.toHaveBeenCalled();
  });

  it('marks required fields and gives helper text for the employee number', () => {
    setup('create');
    expect(screen.getByText(/Entered by HR/)).toBeInTheDocument();
    expect(textbox(/Employee number/)).toBeRequired();
    expect(textbox(/First name/)).toBeRequired();
  });
});

describe('create', () => {
  it('submits normalised data with department and manager assignment, then reports success', async () => {
    const { user, spies, onSaved } = setup('create');
    await fillRequired(user, 'gs-0500');
    await user.type(textbox(/Work email/), '  Tara.B@GrowSpark.example ');
    await user.type(textbox(/Job title/), 'Analyst');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Employment type' }), 'Contract');
    await user.type(screen.getByLabelText('Hire date'), '2026-12-01');

    const dept = screen.getByRole('combobox', { name: 'Department' });
    await waitFor(() =>
      expect(within(dept).getByRole('option', { name: 'Sales' })).toBeInTheDocument(),
    );
    await user.selectOptions(dept, 'Sales');

    await user.type(screen.getByRole('combobox', { name: 'Manager' }), 'neha g');
    await user.click(await screen.findByRole('option', { name: /Neha Gupta/ }));

    await user.click(screen.getByRole('button', { name: 'Create employee' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));

    expect(spies.create).toHaveBeenCalledWith({
      employeeNumber: 'gs-0500',
      firstName: 'Tara',
      lastName: 'Banerjee',
      workEmail: '  Tara.B@GrowSpark.example '.trim(),
      jobTitle: 'Analyst',
      employmentType: 'CONTRACT',
      hireDate: '2026-12-01',
      joiningDate: '2026-12-01', // the API stores the joining date and keeps hireDate in step
      departmentId: DEPT.sales,
      managerId: demoUuid(13),
    });
    const saved: Employee = onSaved.mock.calls[0]![0];
    expect(saved).toMatchObject({
      employeeNumber: 'GS-0500', // upper-cased by the contract
      workEmail: 'tara.b@growspark.example', // lower-cased
      status: 'ONBOARDING',
      department: { name: 'Sales' },
      manager: { firstName: 'Neha' },
    });
  });

  it('sends blanks as null for the optional fields and creates with only the required fields', async () => {
    const { user, spies, onSaved } = setup('create');
    await fillAllRequired(user);
    await user.click(screen.getByRole('button', { name: 'Create employee' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(spies.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workEmail: 'tara.banerjee@growspark.example', // required (PRD EMP-001)
        jobTitle: null,
        joiningDate: '2026-01-05', // required
        departmentId: DEPT.engineering, // required
        managerId: null,
        employmentType: 'FULL_TIME',
      }),
    );
  });

  it('Enter in a text field submits the form (keyboard)', async () => {
    const { user, onSaved } = setup('create');
    await fillAllRequired(user);
    await user.type(textbox(/Job title/), 'Analyst{Enter}');
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('Cancel calls onCancel and saves nothing', async () => {
    const { user, spies, onCancel } = setup('create');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
    expect(spies.create).not.toHaveBeenCalled();
  });

  it('cannot be double-submitted while a request is in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { user, spies, onSaved } = setup('create', {
      wrap: (s) => ({ ...s, create: async (i) => (await gate, s.create(i)) }),
    });
    await fillAllRequired(user);
    const submit = screen.getByRole('button', { name: 'Create employee' });
    await user.click(submit);
    await waitFor(() => expect(submit).toHaveAttribute('aria-busy', 'true'));
    expect(submit).toBeDisabled();
    await user.click(submit);
    release();
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(spies.create).toHaveBeenCalledTimes(1);
  });
});

describe('server errors are presented, not swallowed', () => {
  it('duplicate employee number (409) appears under that field and keeps the user input', async () => {
    const { user, onSaved } = setup('create');
    await fillAllRequired(user, 'GS-0003');
    await user.click(screen.getByRole('button', { name: 'Create employee' }));
    expect(
      await screen.findByText('An employee with this employee number already exists'),
    ).toBeInTheDocument();
    expect(textbox(/Employee number/)).toHaveAttribute('aria-invalid', 'true');
    expect(textbox(/First name/)).toHaveValue('Tara'); // input preserved
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Create employee' })).toBeEnabled();
  });

  it('duplicate work email (409) appears under the email field', async () => {
    const { user } = setup('create');
    await fillAllRequired(user, 'GS-0500', 'kavya.menon@growspark.example');
    await user.click(screen.getByRole('button', { name: 'Create employee' }));
    expect(
      await screen.findByText('An employee with this work email already exists'),
    ).toBeInTheDocument();
    expect(textbox(/Work email/)).toHaveAttribute('aria-invalid', 'true');
  });

  it('server-side field validation issues (400) are mapped onto fields', async () => {
    const { user } = setup('create', {
      wrap: (s) => ({
        ...s,
        create: () =>
          Promise.reject(
            new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed', [
              { path: ['jobTitle'], message: 'Job title is not allowed' },
            ]),
          ),
      }),
    });
    await fillAllRequired(user);
    await user.click(screen.getByRole('button', { name: 'Create employee' }));
    expect(await screen.findByText('Job title is not allowed')).toBeInTheDocument();
    expect(textbox(/Job title/)).toHaveAttribute('aria-invalid', 'true');
  });

  it('403 shows a form-level permission message', async () => {
    const { user } = setup('create', {
      wrap: (s) => ({ ...s, create: () => Promise.reject(new ApiError(403, 'FORBIDDEN', 'nope')) }),
    });
    await fillAllRequired(user);
    await user.click(screen.getByRole('button', { name: 'Create employee' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not save.');
    expect(alert).toHaveTextContent('You do not have permission to do that.');
  });

  it('500 and network failures show a friendly message and allow retry', async () => {
    let fail = true;
    const { user, onSaved } = setup('create', {
      wrap: (s) => ({
        ...s,
        create: (i) =>
          fail ? Promise.reject(new ApiError(500, 'INTERNAL_ERROR', 'stack trace')) : s.create(i),
      }),
    });
    await fillAllRequired(user);
    await user.click(screen.getByRole('button', { name: 'Create employee' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong on our side');
    expect(alert).not.toHaveTextContent('stack trace'); // internals are never shown
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Create employee' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });
});

describe('edit', () => {
  /** The exact DTO the API would return, fetched through a throwaway demo adapter. */
  async function load(id: string): Promise<Employee> {
    const probe = renderEmployees(<div />);
    const employee = await probe.service.get(id);
    probe.unmount();
    return employee;
  }

  it('is pre-filled from the employee, including department and manager', async () => {
    const employee = await load(DEMO_IDS.employee);
    setup('edit', { employee });
    expect(textbox(/Employee number/)).toHaveValue('GS-0004');
    expect(textbox(/First name/)).toHaveValue('Rohan');
    expect(textbox(/Work email/)).toHaveValue('rohan.iyer@growspark.example');
    expect(screen.getByRole('combobox', { name: 'Manager' })).toHaveValue('Kavya Menon · GS-0003');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Department' })).toHaveValue(DEPT.engineering),
    );
  });

  it('sends only the changed fields', async () => {
    const employee = await load(DEMO_IDS.employee);
    const { user, spies, onSaved } = setup('edit', { employee });
    const title = textbox(/Job title/);
    await user.clear(title);
    await user.type(title, 'Senior Software Engineer');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(spies.update).toHaveBeenCalledWith(DEMO_IDS.employee, {
      jobTitle: 'Senior Software Engineer',
    });
    expect(onSaved.mock.calls[0]![0]).toMatchObject({ jobTitle: 'Senior Software Engineer' });
  });

  it('says so, and sends nothing, when nothing changed', async () => {
    const employee = await load(DEMO_IDS.employee);
    const { user, spies, onSaved } = setup('edit', { employee });
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('There are no changes to save.')).toBeInTheDocument();
    expect(spies.update).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('clears the manager (sent as null); a department cannot be cleared because it is required', async () => {
    const employee = await load(DEMO_IDS.employee);
    const { user, spies, onSaved } = setup('edit', { employee });
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Department' })).toHaveValue(DEPT.engineering),
    );
    await user.click(screen.getByRole('button', { name: 'Clear manager' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Department' }), 'No department');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Choose a department')).toBeInTheDocument(); // PRD EMP-001: required
    expect(spies.update).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Department' }), 'Engineering');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(spies.update).toHaveBeenCalledWith(DEMO_IDS.employee, { managerId: null });
  });

  it('a reporting cycle is rejected and shown on the manager field', async () => {
    // Arjun (VP) is Kavya's manager, who manages Rohan. Making Rohan Arjun's manager closes a loop.
    const arjun = await load(demoUuid(2));
    const { user, onSaved } = setup('edit', { employee: arjun });
    await user.type(screen.getByRole('combobox', { name: 'Manager' }), 'rohan');
    await user.click(await screen.findByRole('option', { name: /Rohan Iyer/ }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText(/cannot report, directly or indirectly, to themselves/),
    ).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('never offers the employee as their own manager', async () => {
    const employee = await load(DEMO_IDS.employee);
    const { user } = setup('edit', { employee });
    const picker = screen.getByRole('combobox', { name: 'Manager' });
    await user.clear(picker);
    await user.type(picker, 'rohan');
    await waitFor(() =>
      expect(screen.getByRole('listbox')).toHaveTextContent('No matching employees'),
    );
  });
});

describe('keyboard accessibility', () => {
  it('fields are reached by Tab in visual order, each with a programmatic label', async () => {
    const { user } = setup('create');
    const order = [
      textbox(/Employee number/),
      textbox(/Work email/),
      textbox(/First name/),
      textbox(/Last name/),
      textbox(/Job title/),
      screen.getByRole('combobox', { name: 'Employment type' }),
      screen.getByLabelText('Hire date'),
      screen.getByRole('combobox', { name: 'Department' }),
      screen.getByRole('combobox', { name: 'Manager' }),
      screen.getByRole('button', { name: 'Create employee' }),
      screen.getByRole('button', { name: 'Cancel' }),
    ];
    // the department select is disabled while its options load; wait so it is focusable
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Department' })).toBeEnabled());
    for (const el of order) {
      await user.tab();
      expect(el).toHaveFocus();
    }
  });

  it('groups related fields in labelled fieldsets', () => {
    setup('create');
    for (const name of ['Identity', 'Employment', 'Reporting']) {
      expect(screen.getByRole('group', { name })).toBeInTheDocument();
    }
  });
});
