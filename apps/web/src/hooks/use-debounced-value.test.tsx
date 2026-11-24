// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDebouncedValue } from './use-debounced-value';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Probe({ value }: { value: string }) {
  return <p data-testid="out">{useDebouncedValue(value, 300)}</p>;
}

describe('useDebouncedValue', () => {
  it('emits only after the value has been stable for the delay', () => {
    vi.useFakeTimers();
    const { rerender } = render(<Probe value="a" />);
    rerender(<Probe value="ab" />);
    rerender(<Probe value="abc" />);
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(screen.getByTestId('out').textContent).toBe('a');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId('out').textContent).toBe('abc');
  });
});
