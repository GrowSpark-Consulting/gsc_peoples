// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Page from '@/app/(dashboard)/reports/page';

describe('Reports page', () => {
  it('states plainly that reports are not available and shows no figures', () => {
    render(<Page />);
    expect(screen.getByText('Reports are not available yet')).toBeTruthy();
    expect(screen.queryByText('Placeholder')).toBeNull();
    expect(document.body.textContent).not.toMatch(/\d+%|\b\d{2,}\b/);
  });
});
