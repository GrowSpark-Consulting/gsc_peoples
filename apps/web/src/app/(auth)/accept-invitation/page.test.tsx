// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACCOUNT_ACTIVATED, ACTIVATE_FAILED, ACTIVATION_REDIRECT_MS, INVITE_INVALID, NETWORK_ERROR, PASSWORD_LENGTH, PASSWORD_MISMATCH,
} from '@/lib/auth-messages';
import AcceptInvitationPage from './page';

const nav = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }, search: '' }));
vi.mock('next/navigation', () => ({
  useRouter: () => nav.router,
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const session = vi.hoisted(() => ({ resetSessionCache: vi.fn() }));
vi.mock('@/hooks/use-session', () => session);

const TOKEN = 'inv_' + 'b'.repeat(60);
const PASSWORD = 'a-brand-new-password';
const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function renderWithToken(token: string | null = TOKEN) {
  nav.search = token === null ? '' : `?token=${encodeURIComponent(token)}`;
  const user = userEvent.setup();
  render(<AcceptInvitationPage />);
  return user;
}

async function fill(user: ReturnType<typeof userEvent.setup>, password = PASSWORD, confirm = password, name = '') {
  if (name) await user.type(screen.getByLabelText('Name'), name);
  await user.type(screen.getByLabelText('Password'), password);
  await user.type(screen.getByLabelText('Confirm password'), confirm);
}

const activate = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: /Activate account|Try again/ }));
const expectTokenNotShown = () => expect(document.body.textContent).not.toContain(TOKEN);

beforeEach(() => {
  nav.router.push.mockReset();
  nav.router.refresh.mockReset();
  session.resetSessionCache.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('Accept invitation page', () => {
  it('detects a missing token immediately, without showing the form or calling the API', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderWithToken(null);
    expect(screen.getByRole('alert')).toHaveTextContent(INVITE_INVALID);
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats a malformed token (wrong length) as an invalid link', () => {
    vi.stubGlobal('fetch', vi.fn());
    renderWithToken('too-short');
    expect(screen.getByRole('alert')).toHaveTextContent(INVITE_INVALID);
    renderWithToken('x'.repeat(257));
    expect(screen.getAllByRole('alert')).toHaveLength(2);
  });

  it('refuses mismatched passwords before submitting and marks the confirmation field invalid', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const user = renderWithToken();
    await fill(user, PASSWORD, PASSWORD + 'x');
    await activate(user);
    expect(screen.getByRole('alert')).toHaveTextContent(PASSWORD_MISMATCH);
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('aria-errormessage', 'activation-error');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a password outside 10-128 characters before submitting', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const user = renderWithToken();
    await fill(user, 'short');
    await activate(user);
    expect(screen.getByRole('alert')).toHaveTextContent(PASSWORD_LENGTH);
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');

    const long = 'x'.repeat(129);
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: long } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: long } });
    fireEvent.submit(screen.getByLabelText('Password').closest('form')!);
    expect(screen.getByRole('alert')).toHaveTextContent(PASSWORD_LENGTH);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows a loading state, disables the button, and ignores duplicate submissions', async () => {
    const pending = deferred<ReturnType<typeof json>>();
    const fetchMock = vi.fn(() => pending.promise);
    vi.stubGlobal('fetch', fetchMock);
    const user = renderWithToken();
    await fill(user, PASSWORD, PASSWORD, '  Nina Joiner  ');

    const form = screen.getByRole('button', { name: 'Activate account' }).closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);

    const button = await screen.findByRole('button', { name: 'Activating...' });
    expect(button).toBeDisabled();
    expect(form).toHaveAttribute('aria-busy', 'true');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/auth\/accept-invitation$/);
    expect(init.credentials).toBe('include'); // the session cookie set by activation must be stored
    // The confirmation never leaves the browser; the name is trimmed.
    expect(JSON.parse(init.body as string)).toEqual({ token: TOKEN, password: PASSWORD, name: 'Nina Joiner' });

    pending.resolve(json(200, { data: { companyId: 'c1', activated: true } }));
    expect(await screen.findByRole('status')).toHaveTextContent(ACCOUNT_ACTIVATED);
  });

  it('reports a network failure and lets the user retry', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(json(200, { data: { companyId: 'c1', activated: true } })));
    const user = renderWithToken();
    await fill(user);
    await activate(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(NETWORK_ERROR);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    expectTokenNotShown();

    await activate(user);
    expect(await screen.findByRole('status')).toHaveTextContent(ACCOUNT_ACTIVATED);
  });

  it('shows the API error, or a fallback, on other server failures', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json(429, { error: { message: 'Too many requests. Try again later.' } }))
      .mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.reject(new SyntaxError('not json')) }));
    const user = renderWithToken();
    await fill(user);
    await activate(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests. Try again later.');
    await activate(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(ACTIVATE_FAILED);
    expectTokenNotShown();
  });

  it.each([
    ['expired', 'Invitation link is invalid, expired, or already used'],
    ['already used (reused)', 'Invitation link is invalid, expired, or already used'],
  ])('shows the invalid-invitation message for an %s link (API 401)', async (_case, apiMessage) => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json(401, { error: { message: apiMessage } }))));
    const user = renderWithToken();
    await fill(user);
    await activate(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(INVITE_INVALID);
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(nav.router.push).not.toHaveBeenCalled();
    expect(session.resetSessionCache).not.toHaveBeenCalled();
    expectTokenNotShown();
  });

  it('confirms activation, refreshes the session cache, then goes to the dashboard', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json(200, { data: { companyId: 'c1', activated: true } }))));
    const user = renderWithToken();
    await fill(user);
    await activate(user);

    expect(await screen.findByRole('status')).toHaveTextContent(ACCOUNT_ACTIVATED);
    expect(session.resetSessionCache).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Go to dashboard' })).toHaveAttribute('href', '/dashboard');
    expect(nav.router.push).not.toHaveBeenCalled(); // the confirmation is visible first
    await waitFor(() => expect(nav.router.push).toHaveBeenCalledWith('/dashboard'), { timeout: ACTIVATION_REDIRECT_MS + 1500 });
    expect(nav.router.refresh).toHaveBeenCalled();
    expect(nav.router.push).toHaveBeenCalledTimes(1);
  });
});
