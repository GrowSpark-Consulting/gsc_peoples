'use client';

import { useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { AuthError, AuthHeading, AuthNotice, AuthShell, authButtonClass, authFieldClass, authLabelClass } from '@/components/layout/auth-shell';
import { FORGOT_FAILED, GENERIC_SENT, NETWORK_ERROR } from '@/lib/auth-messages';
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

const subscribeNever = () => () => {};

export default function ForgotPasswordPage() {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // A ref, not state: it blocks a second submit fired before React re-renders the disabled button.
  const inFlight = useRef(false);
  // Disabled until hydrated, so an early click cannot fall through to a native form submission.
  const ready = useSyncExternalStore(subscribeNever, () => true, () => false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true); setError(''); setMessage('');
    const form = new FormData(event.currentTarget);
    try {
      let response: Response;
      try {
        response = await fetch(`${API}/auth/forgot-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: form.get('email') }) });
      } catch {
        setError(NETWORK_ERROR);
        return;
      }
      const body = await response.json().catch(() => undefined);
      if (!response.ok) setError(body?.error?.message ?? FORGOT_FAILED);
      else setMessage(body?.data?.message ?? GENERIC_SENT);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <form method="post" onSubmit={submit} aria-busy={loading}>
        <AuthHeading title="Forgot password" />
        <div className="mt-8">
          <label className={authLabelClass} htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required className={`mt-2 ${authFieldClass}`} />
        </div>
        {error && <AuthError>{error}</AuthError>}
        {message && <AuthNotice>{message}</AuthNotice>}
        <button disabled={loading || !ready} className={authButtonClass}>
          {loading ? 'Sending...' : error ? 'Try again' : 'Send reset link'}
        </button>
        <a href="/login" className="mt-5 flex justify-center text-center touch-target text-label font-medium text-primary hover:text-primary-hover hover:underline">Back to sign in</a>
      </form>
    </AuthShell>
  );
}
