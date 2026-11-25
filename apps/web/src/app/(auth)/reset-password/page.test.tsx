// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INVALID_LINK, NETWORK_ERROR, PASSWORD_LENGTH, PASSWORD_UPDATED, RESET_FAILED, RESET_REDIRECT_MS } from '@/lib/auth-messages';
import ResetPasswordPage from './page';

const nav = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }, search: '' }));
vi.mock('next/navigation', () => ({
  useRouter: () => nav.router,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const TOKEN = 'tok_' + 'a'.repeat(60);
const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function renderWithToken(token: string | null = TOKEN) {
  nav.search = token === null ? '' : `?token=${encodeURIComponent(token)}`;
  const user = userEvent.setup();
  render(<ResetPasswordPage />);
  return user;
}

/** No message on screen may ever echo the reset token. */
function expectTokenNotShown() {
  expect(document.body.textContent).not.toContain(TOKEN);
}

beforeEach(() => nav.router.push.mockReset());
afterEach(() => vi.unstubAllGlobals());

describe('Reset password page', () => {
  it('detects a missing token immediately and offers a new link, without calling the API', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderWithToken(null);
    expect(screen.getByRole('alert')).toHaveTextContent(INVALID_LINK);
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Send reset link' })).toHaveAttribute('href', '/forgot-password');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats a malformed (too short) token as an invalid link', () => {
    vi.stubGlobal('fetch', vi.fn());
    renderWithToken('short');
    expect(screen.getByRole('alert')).toHaveTextContent(INVALID_LINK);
  });

  it('validates password length (10-128) before submitting', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const user = renderWithToken();
    const input = screen.getByLabelText('New password');

    await user.type(input, 'short');
    await user.click(screen.getByRole('button', { name: 'Set password' }));
    expect(screen.getByRole('alert')).toHaveTextContent(PASSWORD_LENGTH);

    fireEvent.change(input, { target: { value: 'x'.repeat(129) } });
    fireEvent.submit(input.closest('form')!);
    expect(screen.getByRole('alert')).toHaveTextContent(PASSWORD_LENGTH);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows a loading state, disables the button, and ignores duplicate submissions', async () => {
    const pending = deferred<ReturnType<typeof json>>();
    const fetchMock = vi.fn(() => pending.promise);
    vi.stubGlobal('fetch', fetchMock);
    const user = renderWithToken();
    await user.type(screen.getByLabelText('New password'), 'a-brand-new-password');

    const form = screen.getByRole('button', { name: 'Set password' }).closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);

    const button = await screen.findByRole('button', { name: 'Updating...' });
    expect(button).toBeDisabled();
    expect(form).toHaveAttribute('aria-busy', 'true');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ token: TOKEN, password: 'a-brand-new-password' });

    pending.resolve(json(200, { data: { message: 'Password reset successfully.' } }));
    expect(await screen.findByRole('status')).toHaveTextContent(PASSWORD_UPDATED);
  });

  it('reports a network failure and lets the user retry', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(json(200, {}));
    vi.stubGlobal('fetch', fetchMock);
    const user = renderWithToken();
    await user.type(screen.getByLabelText('New password'), 'a-brand-new-password');

    await user.click(screen.getByRole('button', { name: 'Set password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(NETWORK_ERROR);
    expectTokenNotShown();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('status')).toHaveTextContent(PASSWORD_UPDATED);
  });

  it('shows the API error, or a fallback, on a server failure', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json(429, { error: { message: 'Too many requests. Try again later.' } }))
      .mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.reject(new SyntaxError('not json')) }));
    const user = renderWithToken();
    await user.type(screen.getByLabelText('New password'), 'a-brand-new-password');

    await user.click(screen.getByRole('button', { name: 'Set password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests. Try again later.');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(RESET_FAILED);
    expectTokenNotShown();
  });

  it('shows the invalid/expired-link message when the API rejects the token (401)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json(401, { error: { message: 'Reset link is invalid or expired' } }))));
    const user = renderWithToken();
    await user.type(screen.getByLabelText('New password'), 'a-brand-new-password');
    await user.click(screen.getByRole('button', { name: 'Set password' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(INVALID_LINK);
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Send reset link' })).toHaveAttribute('href', '/forgot-password');
    expect(nav.router.push).not.toHaveBeenCalled();
    expectTokenNotShown();
  });

  it('confirms the new password, then redirects to /login', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json(200, { data: { message: 'Password reset successfully.' } }))));
    const user = renderWithToken();
    await user.type(screen.getByLabelText('New password'), 'a-brand-new-password');
    await user.click(screen.getByRole('button', { name: 'Set password' }));

    expect(await screen.findByRole('status')).toHaveTextContent(PASSWORD_UPDATED);
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    expect(nav.router.push).not.toHaveBeenCalled(); // the confirmation is visible first
    await waitFor(() => expect(nav.router.push).toHaveBeenCalledWith('/login'), { timeout: RESET_REDIRECT_MS + 1500 });
    expect(nav.router.push).toHaveBeenCalledTimes(1);
  });
});
