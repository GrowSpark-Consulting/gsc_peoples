'use client';

import { Suspense, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { AuthError, AuthHeading, AuthNotice, AuthShell, authButtonClass, authFieldClass, authLabelClass } from '@/components/layout/auth-shell';
import {
  INVALID_LINK, NETWORK_ERROR, PASSWORD_LENGTH, PASSWORD_MAX, PASSWORD_MIN, PASSWORD_UPDATED,
  RESET_FAILED, RESET_REDIRECT_MS, TOKEN_MAX, TOKEN_MIN,
} from '@/lib/auth-messages';
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

const subscribeNever = () => () => {};
const linkClass = 'text-label font-medium text-primary hover:text-primary-hover hover:underline';

// useSearchParams() must sit under a Suspense boundary or `next build` cannot prerender the page.
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}

type Status = 'idle' | 'submitting' | 'invalid-link' | 'done';

function ResetPasswordForm() {
  const params = useSearchParams(); const router = useRouter();
  const token = params.get('token') ?? '';
  // A missing or malformed token can never succeed: say so up front instead of after the user types a password.
  const tokenLooksValid = token.length >= TOKEN_MIN && token.length <= TOKEN_MAX;
  const [status, setStatus] = useState<Status>(tokenLooksValid ? 'idle' : 'invalid-link');
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const ready = useSyncExternalStore(subscribeNever, () => true, () => false);

  useEffect(() => {
    if (status !== 'done') return;
    const timer = setTimeout(() => router.push('/login'), RESET_REDIRECT_MS);
    return () => clearTimeout(timer);
  }, [status, router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    setError('');
    const password = String(new FormData(event.currentTarget).get('password') ?? '');
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
      setError(PASSWORD_LENGTH);
      return;
    }
    inFlight.current = true;
    setStatus('submitting');
    let next: Status = 'idle';
    try {
      let response: Response;
      try {
        response = await fetch(`${API}/auth/reset-password`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, password }),
        });
      } catch {
        setError(NETWORK_ERROR);
        return;
      }
      if (response.ok) { next = 'done'; return; }
      // 401 = invalid, expired or already used. The API's own message never contains the token.
      if (response.status === 401) { next = 'invalid-link'; return; }
      const body = await response.json().catch(() => undefined);
      setError(body?.error?.message ?? RESET_FAILED);
    } finally {
      inFlight.current = false;
      setStatus(next);
    }
  }

  if (status === 'invalid-link') {
    return (
      <AuthShell>
        <AuthHeading title="Reset password" />
        <AuthError>{INVALID_LINK}</AuthError>
        <a href="/forgot-password" className={`${authButtonClass} grid place-items-center`}>Send reset link</a>
        <a href="/login" className={`mt-5 flex justify-center touch-target text-center ${linkClass}`}>Back to sign in</a>
      </AuthShell>
    );
  }

  if (status === 'done') {
    return (
      <AuthShell>
        <AuthHeading title="Reset password" />
        <AuthNotice>{PASSWORD_UPDATED}</AuthNotice>
        <a href="/login" className={`${authButtonClass} grid place-items-center`}>Sign in</a>
      </AuthShell>
    );
  }

  const submitting = status === 'submitting';
  return (
    <AuthShell>
      <form method="post" onSubmit={submit} aria-busy={submitting} noValidate>
        <AuthHeading title="Reset password" />
        <div className="mt-8">
          <label className={authLabelClass} htmlFor="password">New password</label>
          <input
            id="password" name="password" type="password" autoComplete="new-password"
            minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} required aria-describedby="password-hint"
            className={`mt-2 ${authFieldClass}`}
          />
          <p id="password-hint" className="mt-2 text-small text-muted">{PASSWORD_LENGTH}</p>
        </div>
        {error && <AuthError>{error}</AuthError>}
        <button disabled={submitting || !ready} className={authButtonClass}>
          {submitting ? 'Updating...' : error ? 'Try again' : 'Set password'}
        </button>
      </form>
    </AuthShell>
  );
}
