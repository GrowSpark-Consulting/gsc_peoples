// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEMO_IDS } from './adapters/demo/demo-data';
import { EditEmployeePage, NewEmployeePage } from './pages';
import { renderEmployees } from './testing/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/employees',
  useSearchParams: () => new URLSearchParams(),
}));

describe('route guards (the UI hides; the API still enforces independently)', () => {
  it('HR Admin sees the create form and breadcrumbs', async () => {
    renderEmployees(<NewEmployeePage />);
    expect(await screen.findByRole('form', { name: 'Add employee' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Employees');
  });

  it.each(['manager', 'employee'] as const)('%s cannot reach the create form', (persona) => {
    renderEmployees(<NewEmployeePage />, { persona });
    expect(screen.getByText('No access')).toBeInTheDocument();
    expect(screen.getByText('Only HR Admins can add employees.')).toBeInTheDocument();
    expect(screen.queryByRole('form')).toBeNull();
  });

  it('HR Admin sees the edit form for an existing employee', async () => {
    renderEmployees(<EditEmployeePage id={DEMO_IDS.employee} />);
    expect(await screen.findByRole('form', { name: 'Edit employee' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /First name/ })).toHaveValue('Rohan');
  });

  it.each(['manager', 'employee'] as const)(
    '%s cannot reach the edit form, and no record is even requested',
    (persona) => {
      const get = vi.fn();
      renderEmployees(<EditEmployeePage id={DEMO_IDS.employee} />, {
        persona,
        wrap: (s) => ({ ...s, get: (id) => (get(id), s.get(id)) }),
      });
      expect(screen.getByText('Only HR Admins can edit employees.')).toBeInTheDocument();
      expect(get).not.toHaveBeenCalled();
    },
  );

  it('edit page for an unknown id shows an error with retry, not a blank form', async () => {
    renderEmployees(<EditEmployeePage id="00000000-0000-4000-8000-00000000ffff" />);
    expect(await screen.findByText('Could not load this employee.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
