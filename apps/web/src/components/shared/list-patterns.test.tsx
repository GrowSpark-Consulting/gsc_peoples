// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageHeader } from '@/components/layout/page-header';
import { CursorPagination } from '@/components/ui/pagination';
import { SelectField } from '@/components/ui/select';
import { ErrorState, NoResultsState } from './data-states';
import { FilterSelect, ListToolbar } from './list-toolbar';

afterEach(cleanup);

describe('ListToolbar', () => {
  it('is a labelled search landmark with an accessible search box', () => {
    render(<ListToolbar label="Employee filters" search={{ value: '', onChange: () => {}, label: 'Search employees' }} />);
    expect(screen.getByRole('search', { name: 'Employee filters' })).toBeTruthy();
    expect(screen.getByLabelText('Search employees')).toBeTruthy();
  });

  it('reports typing, shows a clear button only when there is text, and clears', () => {
    const onChange = vi.fn();
    const { rerender } = render(<ListToolbar label="f" search={{ value: '', onChange, label: 'Search' }} />);
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'ana' } });
    expect(onChange).toHaveBeenLastCalledWith('ana');
    rerender(<ListToolbar label="f" search={{ value: 'ana', onChange, label: 'Search' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('keeps the fixed order: search, filters, secondary actions, primary action', () => {
    render(
      <ListToolbar
        label="f"
        search={{ value: '', onChange: () => {}, label: 'Search' }}
        filters={<button>filter</button>}
        actions={<button>export</button>}
        primary={<button>add</button>}
      />,
    );
    const order = screen.getAllByRole('button').map((b) => b.textContent);
    expect(order).toEqual(['filter', 'export', 'add']);
  });
});

describe('FilterSelect', () => {
  it('offers an "all" option and reports the chosen value', () => {
    const onChange = vi.fn();
    render(<FilterSelect label="Status" value="" onChange={onChange} allLabel="All statuses" options={[{ value: 'ACTIVE', label: 'Active' }]} />);
    const select = screen.getByLabelText('Status') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.text)).toEqual(['All statuses', 'Active']);
    fireEvent.change(select, { target: { value: 'ACTIVE' } });
    expect(onChange).toHaveBeenCalledWith('ACTIVE');
  });
});

describe('SelectField', () => {
  it('wires label, helper and error to the control', () => {
    render(
      <SelectField label="Department" helper="Where they work" error="Pick one">
        <option value="">None</option>
      </SelectField>,
    );
    const el = screen.getByLabelText('Department');
    expect(el.getAttribute('aria-invalid')).toBe('true');
    const described = el.getAttribute('aria-describedby') ?? '';
    expect(described.split(' ')).toHaveLength(2);
    expect(screen.getByRole('alert').textContent).toContain('Pick one');
  });
});

describe('CursorPagination', () => {
  it('disables Previous on the first page and Next on the last', () => {
    const { rerender } = render(<CursorPagination page={1} count={25} hasPrevious={false} hasNext onPrevious={() => {}} onNext={() => {}} />);
    expect((screen.getByRole('button', { name: /Previous/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /Next/ }) as HTMLButtonElement).disabled).toBe(false);
    rerender(<CursorPagination page={3} count={4} hasPrevious hasNext={false} onPrevious={() => {}} onNext={() => {}} />);
    expect((screen.getByRole('button', { name: /Next/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('navigation', { name: 'Pagination' }).textContent).toContain('Page 3');
  });

  it('fires callbacks and locks both buttons while loading', () => {
    const onNext = vi.fn();
    const onPrevious = vi.fn();
    const { rerender } = render(<CursorPagination page={2} count={25} hasPrevious hasNext onPrevious={onPrevious} onNext={onNext} />);
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    fireEvent.click(screen.getByRole('button', { name: /Previous/ }));
    expect(onNext).toHaveBeenCalledOnce();
    expect(onPrevious).toHaveBeenCalledOnce();
    rerender(<CursorPagination page={2} count={25} hasPrevious hasNext onPrevious={onPrevious} onNext={onNext} loading />);
    expect((screen.getByRole('button', { name: /Next/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /Previous/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('PageHeader', () => {
  it('renders nothing when empty', () => {
    const { container } = render(<PageHeader />);
    expect(container.firstChild).toBeNull();
  });

  it('shows description, breadcrumbs (last is the current page) and actions', () => {
    render(<PageHeader description="All people" breadcrumbs={[{ label: 'Employees', href: '/employees' }, { label: 'Ana' }]} actions={<button>do</button>} />);
    expect(screen.getByText('All people')).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(nav.querySelector('a')?.getAttribute('href')).toBe('/employees');
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe('Ana');
    expect(screen.getByRole('button', { name: 'do' })).toBeTruthy();
  });
});

describe('data states', () => {
  it('ErrorState announces the failure and retries', () => {
    const onRetry = vi.fn();
    render(<ErrorState message="Server down" onRetry={onRetry} />);
    expect(screen.getByRole('alert').textContent).toContain('Server down');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('NoResultsState offers to clear filters', () => {
    const onClear = vi.fn();
    render(<NoResultsState noun="employees" onClear={onClear} />);
    expect(screen.getByText('No employees match')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClear).toHaveBeenCalledOnce();
  });
});
