// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../errors';
import { EMPTY_FILTERS, type DirectoryFilters } from '../filters';
import { renderEmployees, type RenderOptions } from '../testing/render';
import { EmployeeDirectory } from './employee-directory';

function Harness({
  limit = 10,
  initial = EMPTY_FILTERS,
}: {
  limit?: number;
  initial?: DirectoryFilters;
}) {
  const [filters, setFilters] = useState(initial);
  return (
    <EmployeeDirectory
      filters={filters}
      onFiltersChange={setFilters}
      limit={limit}
      searchDebounceMs={0}
    />
  );
}

const show = (options?: RenderOptions, props?: Parameters<typeof Harness>[0]) =>
  renderEmployees(<Harness {...props} />, options);

const tableRows = () => within(screen.getByTestId('employee-table')).getAllByRole('row').slice(1);
const names = () => tableRows().map((r) => within(r).getAllByRole('link')[0]!.textContent);
const loaded = async () => {
  await waitFor(() =>
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument(),
  );
};

describe('states', () => {
  it('shows a loading state, then the first page of results', async () => {
    const { container } = show();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Loading employees');
    await loaded();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(tableRows()).toHaveLength(10);
    expect(screen.getByRole('status')).toHaveTextContent('10 employees on this page');
  });

  it('shows an error with a retry that recovers', async () => {
    let fail = true;
    const { user } = show({
      wrap: (s) => ({
        ...s,
        list: (q) =>
          fail ? Promise.reject(new ApiError(500, 'INTERNAL_ERROR', 'boom')) : s.list(q),
      }),
    });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load employees.');
    expect(alert).toHaveTextContent('Something went wrong on our side');
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await loaded();
    expect(tableRows().length).toBeGreaterThan(0);
  });

  it('shows an empty state when there are no employees (HR can add the first one)', async () => {
    show({ prepare: (store) => void (store.rows.length = 0) });
    expect(await screen.findByText('No employees yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add the first employee' })).toHaveAttribute(
      'href',
      '/employees/new',
    );
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
  });

  it('shows a no-results state for a search that matches nobody, and clears it', async () => {
    const { user } = show();
    await loaded();
    await user.type(screen.getByRole('searchbox', { name: 'Search employees' }), 'zzzz-nobody');
    await waitFor(() => expect(screen.getByText('No employees match')).toBeInTheDocument());
    expect(screen.getByRole('searchbox', { name: 'Search employees' })).toHaveValue('zzzz-nobody');
    await user.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]!);
    await loaded();
    expect(screen.getByRole('searchbox', { name: 'Search employees' })).toHaveValue('');
    expect(tableRows()).toHaveLength(10);
  });

  it('a manager with no direct reports and no linked profile sees an explanatory empty state', async () => {
    show({ persona: 'manager', prepare: (store) => void (store.rows.length = 0) });
    expect(await screen.findByText('No employee records to show')).toBeInTheDocument();
  });
});

describe('search', () => {
  it.each([
    ['name', 'kavya', 'Kavya Menon'],
    ['last name', 'MENON', 'Kavya Menon'],
    ['employee number', 'gs-0014', 'Sanjay Kumar'],
    ['work email', 'sanjay.kumar@growspark', 'Sanjay Kumar'],
  ])('finds people by %s', async (_label, term, expected) => {
    const { user } = show();
    await loaded();
    await user.type(screen.getByRole('searchbox', { name: 'Search employees' }), term);
    await waitFor(() => expect(names()).toEqual([expected]));
  });

  it('requests the server with the typed term (debounced into one filter change)', async () => {
    const list = vi.fn();
    const { user } = show({ wrap: (s) => ({ ...s, list: (q) => (list(q), s.list(q)) }) });
    await loaded();
    list.mockClear();
    await user.type(screen.getByRole('searchbox', { name: 'Search employees' }), 'rahul verma');
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'rahul verma' })),
    );
    await waitFor(() => expect(names()).toHaveLength(2));
  });
});

/** Opens a multi-select filter and ticks the given options (the panel stays open between ticks). */
async function pick(user: ReturnType<typeof show>['user'], filter: string, ...labels: string[]) {
  await user.click(screen.getByRole('button', { name: filter }));
  for (const label of labels) await user.click(screen.getByRole('checkbox', { name: label }));
}

describe('filters', () => {
  it('filters by status', async () => {
    const { user } = show();
    await loaded();
    await pick(user, 'Status', 'Terminated');
    await waitFor(() => expect(names()).toEqual(['Amit Shah']));
  });

  it('filters by several statuses at once (the API accepts a list)', async () => {
    const list = vi.fn();
    const { user } = show({ wrap: (s) => ({ ...s, list: (q) => (list(q), s.list(q)) }) });
    await loaded();
    await pick(user, 'Status', 'On leave', 'Onboarding');
    await waitFor(() =>
      expect(names().sort()).toEqual(['Harsh Vora', 'Ishita Patel', 'Jaya Rangan', 'Nikhil Bose', 'Sneha Kulkarni']),
    );
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ status: ['ONBOARDING', 'ON_LEAVE'] }));
    expect(screen.getByRole('button', { name: 'Status' })).toHaveTextContent('Status: 2 selected');
    // untick one: the list narrows again
    await user.click(screen.getByRole('checkbox', { name: 'Onboarding' }));
    await waitFor(() => expect(names().sort()).toEqual(['Ishita Patel', 'Nikhil Bose']));
  });

  it('filters by employment type', async () => {
    const { user } = show();
    await loaded();
    await pick(user, 'Employment type', 'Intern');
    await waitFor(() => expect(names().sort()).toEqual(['Jaya Rangan', 'Sneha Kulkarni']));
  });

  it('filters by several employment types at once', async () => {
    const { user } = show();
    await loaded();
    await pick(user, 'Employment type', 'Intern', 'Contract');
    await waitFor(() =>
      expect(names().sort()).toEqual(['Esha Kapoor', 'Jaya Rangan', 'Karthik Reddy', 'Sneha Kulkarni', 'Suresh Babu']),
    );
  });

  it('filters by department (HR) using the department list from the API', async () => {
    const { user } = show();
    await loaded();
    const dept = screen.getByRole('combobox', { name: 'Department' });
    await waitFor(() =>
      expect(within(dept).getByRole('option', { name: 'Finance' })).toBeInTheDocument(),
    );
    await user.selectOptions(dept, 'Finance');
    await waitFor(() => expect(names()).toHaveLength(5));
    expect(tableRows().every((r) => within(r).queryByText('Finance'))).toBe(true);
  });

  it('filters by manager chosen from a searchable combobox', async () => {
    const { user } = show();
    await loaded();
    await user.type(screen.getByRole('combobox', { name: 'Manager' }), 'neha');
    await user.click(await screen.findByRole('option', { name: /Neha Gupta/ }));
    await waitFor(() => expect(names()).toHaveLength(6));
    expect(tableRows().every((r) => within(r).queryByText('Neha Gupta'))).toBe(true);
  });

  it('combines filters with search (AND) and clears them all at once', async () => {
    const { user } = show();
    await loaded();
    await pick(user, 'Status', 'Active');
    await user.type(screen.getByRole('searchbox', { name: 'Search employees' }), 'sharma');
    await waitFor(() => expect(names().sort()).toEqual(['Aditya Sharma', 'Ananya Sharma']));
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(tableRows()).toHaveLength(10));
    expect(screen.getByRole('button', { name: 'Status' })).toHaveTextContent('All statuses');
  });
});

describe('cursor pagination with stable sorting', () => {
  it('walks every page forward and back with no duplicates and a stable order', async () => {
    const { user } = show();
    await loaded();
    const seen: string[][] = [names() as string[]];
    expect(screen.getByText(/Page 1 · 10 employees/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    for (let page = 2; page <= 4; page++) {
      await user.click(screen.getByRole('button', { name: /Next/ }));
      await waitFor(() =>
        expect(screen.getByText(new RegExp(`Page ${page} ·`))).toBeInTheDocument(),
      );
      seen.push(names() as string[]);
    }
    expect(seen.map((p) => p.length)).toEqual([10, 10, 10, 6]); // 36 demo people
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled(); // last page
    const flat = seen.flat();
    expect(new Set(flat).size).toBe(flat.length - 1); // the one duplicate NAME is "Rahul Verma" (two people)

    await user.click(screen.getByRole('button', { name: 'Previous' }));
    await waitFor(() => expect(screen.getByText(/Page 3 ·/)).toBeInTheDocument());
    expect(names()).toEqual(seen[2]); // going back shows the identical page
  });

  it('keeps the two same-named employees in a deterministic order across a page boundary', async () => {
    // GS-0010 and GS-0025 are both "Rahul Verma"; page size 1 puts them on different pages.
    const list = vi.fn();
    const { user } = show(
      { wrap: (s) => ({ ...s, list: (q) => (list(q), s.list(q)) }) },
      { limit: 1 },
    );
    await loaded();
    await user.type(screen.getByRole('searchbox', { name: 'Search employees' }), 'rahul verma');
    // the intermediate term "rahul" also matches both people, so wait for the request with the full term
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: 'rahul verma', limit: 1 }),
      ),
    );
    // wait for the SETTLED first page of the final query (pagination only renders on success)
    await waitFor(() => {
      expect(screen.getByText(/Page 1 · 1 employees/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Next/ })).toBeEnabled();
      expect(tableRows()).toHaveLength(1);
      expect(within(tableRows()[0]!).getByRole('link')).toHaveTextContent('Rahul Verma'); // not the unfiltered page
    });
    const first = within(tableRows()[0]!).getByText(/GS-00\d\d/).textContent;
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => {
      expect(screen.getByText(/Page 2 · 1 employees/)).toBeInTheDocument();
      expect(tableRows()).toHaveLength(1);
    });
    const second = within(tableRows()[0]!).getByText(/GS-00\d\d/).textContent;
    expect([first, second].map((t) => t!.slice(0, 7))).toEqual(['GS-0010', 'GS-0025']);
  });

  it('returns to page 1 when a filter changes', async () => {
    const { user } = show();
    await loaded();
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByText(/Page 2 ·/)).toBeInTheDocument());
    await pick(user, 'Status', 'Active');
    await waitFor(() => expect(screen.getByText(/Page 1 ·/)).toBeInTheDocument());
  });

  it('moves focus to the results heading after paging', async () => {
    const { user } = show();
    await loaded();
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByRole('heading', { name: /page 2/i })).toHaveFocus());
  });
});

describe('permissions', () => {
  it('HR Admin: sees everyone, Add employee, and department/manager filters', async () => {
    show();
    await loaded();
    expect(screen.getByRole('link', { name: /Add employee/ })).toHaveAttribute(
      'href',
      '/employees/new',
    );
    expect(screen.getByRole('combobox', { name: 'Department' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Manager' })).toBeInTheDocument();
    expect(screen.getByText('All employees')).toBeInTheDocument();
  });

  it('Manager: only direct reports and self; no Add button; no org-wide filters', async () => {
    show({ persona: 'manager' }, { limit: 50 });
    await loaded();
    const list = names();
    expect(list).toContain('Kavya Menon'); // self
    expect(list).toContain('Rohan Iyer'); // direct report
    expect(list).not.toContain('Sanjay Kumar'); // someone else's team
    expect(screen.queryByRole('link', { name: /Add employee/ })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Department' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Manager' })).toBeNull();
    expect(screen.getByText(/direct reports and your own profile/i)).toBeInTheDocument();
  });

  it('Employee: only their own record, read-only', async () => {
    show({ persona: 'employee' });
    await loaded();
    expect(names()).toEqual(['Rohan Iyer']);
    expect(screen.queryByRole('link', { name: /Add employee/ })).toBeNull();
    expect(screen.getByText('Your own profile')).toBeInTheDocument();
  });
});

describe('responsive structure', () => {
  it('renders a table from md up and a card list below it, with the same people', async () => {
    show();
    await loaded();
    const table = screen.getByTestId('employee-table');
    const cards = screen.getByTestId('employee-cards');
    expect(table).toHaveClass('hidden', 'md:block');
    expect(cards).toHaveClass('md:hidden');
    expect(within(cards).getAllByRole('listitem')).toHaveLength(10);
    const fromCards = within(cards)
      .getAllByRole('listitem')
      .map((li) => within(li).getAllByRole('link')[0]!.textContent);
    expect(fromCards).toEqual(names());
  });

  it('the table scroll region is keyboard focusable and labelled (narrow tablets scroll sideways)', async () => {
    show();
    await loaded();
    const region = screen.getByRole('region', { name: 'Employees' });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(region).toHaveClass('overflow-x-auto');
  });

  it('the toolbar wraps instead of overflowing on small screens', async () => {
    show();
    await loaded();
    expect(screen.getByRole('search', { name: 'Employee filters' })).toHaveClass('flex-wrap');
  });
});

describe('keyboard accessibility', () => {
  it('toolbar controls are reached by Tab in reading order, each with an accessible name', async () => {
    const { user } = show();
    await loaded();
    const expected = [
      screen.getByRole('searchbox', { name: 'Search employees' }),
      screen.getByRole('button', { name: 'Status' }),
      screen.getByRole('button', { name: 'Employment type' }),
      screen.getByRole('combobox', { name: 'Department' }),
      screen.getByRole('combobox', { name: 'Manager' }),
      screen.getByRole('link', { name: /Add employee/ }),
    ];
    for (const el of expected) {
      await user.tab();
      expect(el).toHaveFocus();
    }
  });

  it('choose a manager filter using only the keyboard (type, ArrowDown, Enter)', async () => {
    const { user } = show();
    await loaded();
    const picker = screen.getByRole('combobox', { name: 'Manager' });
    await user.click(picker);
    await user.keyboard('neha');
    // wait until the suggestions have narrowed to the typed term (not the initial unfiltered list)
    // "neha" also matches Sneha Kulkarni; sorted by last name, Neha Gupta comes first.
    await waitFor(() => {
      const options = within(screen.getByRole('listbox')).getAllByRole('option');
      expect(options.map((o) => o.textContent)).toEqual([
        'Neha Gupta · GS-0013',
        'Sneha Kulkarni · GS-0009',
      ]);
    });
    await user.keyboard('{ArrowDown}{Enter}');
    expect(picker).toHaveValue('Neha Gupta · GS-0013');
    await waitFor(() => expect(names()).toHaveLength(6));
  });

  it('Escape closes the manager suggestions and Tab leaves without choosing', async () => {
    const { user } = show();
    await loaded();
    const picker = screen.getByRole('combobox', { name: 'Manager' });
    await user.click(picker);
    await user.keyboard('ne');
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    expect(picker).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.tab();
    expect(picker).toHaveValue(''); // half-typed text is discarded, nothing was selected
  });

  it('paging works with the keyboard (Enter on Next, Space on Previous)', async () => {
    const { user } = show();
    await loaded();
    screen.getByRole('button', { name: /Next/ }).focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByText(/Page 2 ·/)).toBeInTheDocument());
    screen.getByRole('button', { name: 'Previous' }).focus();
    await user.keyboard(' ');
    await waitFor(() => expect(screen.getByText(/Page 1 ·/)).toBeInTheDocument());
  });

  it('a profile link is reachable and activated with the keyboard (real anchor)', async () => {
    show();
    await loaded();
    const link = within(tableRows()[0]!).getAllByRole('link')[0]!;
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', expect.stringMatching(/^\/employees\/[0-9a-f-]{36}$/));
  });
});
