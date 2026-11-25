// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ROLE_PERMISSIONS } from '@gsc/contracts';
import { titleFor, visibleNavSections } from '@/config/navigation';
import { TopBar } from './top-bar';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));

const props = {
  title: 'Dashboard',
  showMenuButton: false,
  menuOpen: false,
  menuControlsId: 'menu',
  onMenuClick: () => undefined,
  menuButtonRef: { current: null },
};

const meBody = (data: Record<string, unknown>) => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve({ data }),
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TopBar user avatar', () => {
  it('shows the signed-in user initials, with name and role in the tooltip, linking to /profile', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          meBody({
            userId: 'u1',
            companyId: 'c1',
            employeeId: 'e1',
            name: 'Hana Admin',
            email: 'hana.admin@dev.local',
            roles: ['HR_ADMIN'],
            permissions: [],
          }),
        ),
      ),
    );
    render(<TopBar {...props} />);
    const link = await screen.findByRole('link', { name: 'Your profile: Hana Admin · HR Admin' });
    expect(link).toHaveAttribute('href', '/profile');
    expect(link).toHaveAttribute('title', 'Hana Admin · HR Admin');
    expect(link).toHaveTextContent('HA');
  });

  it('falls back to the email, then stays neutral if the session cannot be loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          meBody({ userId: 'u1', companyId: 'c1', employeeId: null, email: 'ravi@dev.local', roles: ['EMPLOYEE'], permissions: [] }),
        ),
      ),
    );
    const { unmount } = render(<TopBar {...props} />);
    await waitFor(() => expect(screen.getByRole('link', { name: /Your profile: ravi@dev.local · Employee/ })).toBeInTheDocument());
    unmount();

    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    render(<TopBar {...props} />);
    const link = await screen.findByRole('link', { name: 'Your profile' });
    expect(link).toHaveAttribute('href', '/profile');
    expect(link).toHaveTextContent('A'); // neutral "Account" until a session is available
  });
});

describe('titleFor', () => {
  it('uses the sidebar label, names /profile, and falls back to the product name', () => {
    expect(titleFor('/employees')).toBe('Employees');
    expect(titleFor('/employees/abc')).toBe('Employees');
    expect(titleFor('/profile')).toBe('My profile');
    expect(titleFor('/nowhere')).toBe('GSC Peoples');
  });
});

describe('visibleNavSections', () => {
  const ids = (perms: readonly string[]) =>
    visibleNavSections(perms).flatMap((s) => s.items.map((i) => i.id));

  it('hides admin/HR routes from Employees and hides Onboarding from Managers', () => {
    expect(ids(ROLE_PERMISSIONS.EMPLOYEE)).not.toContain('reports');
    expect(ids(ROLE_PERMISSIONS.EMPLOYEE)).not.toContain('settings');
    expect(ids(ROLE_PERMISSIONS.EMPLOYEE)).toContain('onboarding');
    expect(ids(ROLE_PERMISSIONS.MANAGER)).not.toContain('onboarding');
    expect(ids(ROLE_PERMISSIONS.MANAGER)).not.toContain('reports');
    expect(ids(ROLE_PERMISSIONS.MANAGER)).not.toContain('settings');
    expect(ids(ROLE_PERMISSIONS.HR_ADMIN)).toEqual(
      expect.arrayContaining(['dashboard', 'employees', 'departments', 'attendance', 'leave', 'onboarding', 'documents', 'reports', 'settings']),
    );
  });
});
