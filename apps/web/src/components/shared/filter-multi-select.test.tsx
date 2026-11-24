// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilterMultiSelect } from './filter-multi-select';

afterEach(cleanup);

const OPTIONS = [
  { value: 'ONBOARDING', label: 'Onboarding' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'ON_LEAVE', label: 'On leave' },
] as const;

function Harness({ initial = [] as string[], onChange = () => {} }: { initial?: string[]; onChange?: (v: string[]) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <FilterMultiSelect
      label="Status"
      allLabel="All statuses"
      options={OPTIONS}
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange(v);
      }}
    />
  );
}

describe('FilterMultiSelect', () => {
  it('summarises: all, one label, or a count', () => {
    const { rerender } = render(<FilterMultiSelect label="Status" allLabel="All statuses" options={OPTIONS} value={[]} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Status' }).textContent).toContain('All statuses');
    rerender(<FilterMultiSelect label="Status" allLabel="All statuses" options={OPTIONS} value={['ACTIVE']} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Status' }).textContent).toContain('Active');
    rerender(<FilterMultiSelect label="Status" allLabel="All statuses" options={OPTIONS} value={['ACTIVE', 'ON_LEAVE']} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Status' }).textContent).toContain('Status: 2 selected');
  });

  it('opens a labelled group of checkboxes and reports selections in option order', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const button = screen.getByRole('button', { name: 'Status' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('group', { name: 'Status' })).toBeTruthy();
    fireEvent.click(screen.getByLabelText('On leave'));
    fireEvent.click(screen.getByLabelText('Onboarding'));
    expect(onChange).toHaveBeenLastCalledWith(['ONBOARDING', 'ON_LEAVE']); // option order, not click order
    fireEvent.click(screen.getByLabelText('On leave'));
    expect(onChange).toHaveBeenLastCalledWith(['ONBOARDING']);
  });

  it('offers a clear action only while something is selected', () => {
    const onChange = vi.fn();
    render(<Harness initial={['ACTIVE']} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Status' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear status' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(screen.queryByRole('button', { name: 'Clear status' })).toBeNull();
  });

  it('Escape closes the panel and returns focus to the button; outside click closes it too', () => {
    render(
      <div>
        <Harness />
        <p>outside</p>
      </div>,
    );
    const button = screen.getByRole('button', { name: 'Status' });
    fireEvent.click(button);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Status' })).toBeNull();
    expect(document.activeElement).toBe(button);

    fireEvent.click(button);
    fireEvent.pointerDown(screen.getByText('outside'));
    expect(screen.queryByRole('group', { name: 'Status' })).toBeNull();
  });
});
