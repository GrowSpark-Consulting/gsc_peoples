import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('merges conflicting tailwind classes', () => {
    expect(cn('p-2', 'p-4', false && 'hidden')).toBe('p-4');
  });

  it('keeps a text colour next to a design-system type size (they do not conflict)', () => {
    expect(cn('bg-primary text-on-primary', 'h-9 px-4 text-body')).toBe('bg-primary text-on-primary h-9 px-4 text-body');
    expect(cn('text-label text-muted')).toBe('text-label text-muted');
  });

  it('still lets a later type size or colour override an earlier one', () => {
    expect(cn('text-body', 'text-label')).toBe('text-label');
    expect(cn('text-ink', 'text-danger')).toBe('text-danger');
  });
});
