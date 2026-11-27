// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/button';
import { useCurrentUser } from './use-current-user';
import { resetSessionCache, useCompany, useSession } from './use-session';

const me = {
  userId: 'u1',
  companyId: 'c1',
  employeeId: 'e1',
  name: 'Hana Admin',
  roles: ['HR_ADMIN'],
  permissions: [],
  company: { name: 'Acme', timezone: 'Asia/Kolkata', workingDays: [1, 2, 3, 4, 5], workStartTime: '09:00', workEndTime: '18:00' },
};
const ok = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: me }) });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetSessionCache();
});

function Consumers() {
  const session = useSession();
  const company = useCompany();
  const user = useCurrentUser();
  return (
    <p>
      {session.status}|{company?.timezone ?? '-'}|{user?.displayName ?? '-'}
    </p>
  );
}

describe('shared GET /me', () => {
  it('issues one request for every consumer on the page', async () => {
    const fetchMock = vi.fn(ok);
    vi.stubGlobal('fetch', fetchMock);
    render(
      <>
        <Consumers />
        <Consumers />
      </>,
    );
    expect(await screen.findAllByText('ready|Asia/Kolkata|Hana Admin')).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('renders immediately from the known session on the next page (no loading flash)', async () => {
    vi.stubGlobal('fetch', vi.fn(ok));
    const first = render(<Consumers />);
    await screen.findByText('ready|Asia/Kolkata|Hana Admin');
    first.unmount();
    render(<Consumers />);
    expect(screen.getByText('ready|Asia/Kolkata|Hana Admin')).toBeInTheDocument();
  });

  it('does not remember a failure: the next consumer retries', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementation(ok);
    vi.stubGlobal('fetch', fetchMock);
    const first = render(<Consumers />);
    await screen.findByText('error|-|-');
    first.unmount();
    render(<Consumers />);
    expect(await screen.findByText('ready|Asia/Kolkata|Hana Admin')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('Button loadingText', () => {
  it('keeps the idle accessible name, then announces the busy label and blocks clicks', () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <Button loadingText="Saving..." onClick={onClick}>
        Save settings
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeEnabled();
    rerender(
      <Button loading loadingText="Saving..." onClick={onClick}>
        Save settings
      </Button>,
    );
    const busy = screen.getByRole('button', { name: 'Saving...' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    busy.click();
    expect(onClick).not.toHaveBeenCalled();
  });
});
