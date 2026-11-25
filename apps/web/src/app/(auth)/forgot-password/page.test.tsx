// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FORGOT_FAILED, GENERIC_SENT, NETWORK_ERROR } from '@/lib/auth-messages';
import ForgotPasswordPage from './page';

const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

async function fillEmail() {
  const user = userEvent.setup();
  render(<ForgotPasswordPage />);
  await user.type(screen.getByLabelText('Email'), 'someone@example.com');
  return user;
}

afterEach(() => vi.unstubAllGlobals());

describe('Forgot password page', () => {
  it('shows a loading state, disables the button, and ignores duplicate submissions while sending', async () => {
    const pending = deferred<ReturnType<typeof json>>();
    const fetchMock = vi.fn(() => pending.promise);
    vi.stubGlobal('fetch', fetchMock);
    await fillEmail();

    const form = screen.getByRole('button', { name: 'Send reset link' }).closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form); // same tick: must be blocked even before the button re-renders as disabled

    const button = await screen.findByRole('button', { name: 'Sending...' });
    expect(button).toBeDisabled();
    expect(form).toHaveAttribute('aria-busy', 'true');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    pending.resolve(json(200, { data: { message: GENERIC_SENT } }));
    expect(await screen.findByRole('status')).toHaveTextContent(GENERIC_SENT);
    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeEnabled();
  });

  it('shows the generic success message only (never confirms the account exists)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json(200, {}))));
    const user = await fillEmail();
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('status')).toHaveTextContent(GENERIC_SENT);
  });

  it('reports a network failure and lets the user retry', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(json(200, { data: { message: GENERIC_SENT } }));
    vi.stubGlobal('fetch', fetchMock);
    const user = await fillEmail();

    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(NETWORK_ERROR);

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('status')).toHaveTextContent(GENERIC_SENT);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shows the API error message, or a fallback when the API gives none', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(429, { error: { message: 'Too many requests. Try again later.' } }))
      .mockResolvedValueOnce({ ok: false, status: 502, json: () => Promise.reject(new SyntaxError('not json')) });
    vi.stubGlobal('fetch', fetchMock);
    const user = await fillEmail();

    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests. Try again later.');

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(FORGOT_FAILED);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
