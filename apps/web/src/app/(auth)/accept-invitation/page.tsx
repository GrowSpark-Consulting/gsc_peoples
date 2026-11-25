'use client';

import { Suspense, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { AuthError, AuthHeading, AuthNotice, AuthShell, authButtonClass, authFieldClass, authLabelClass } from '@/components/layout/auth-shell';
import { resetSessionCache } from '@/hooks/use-session';
import {
  ACCOUNT_ACTIVATED, ACTIVATE_FAILED, ACTIVATION_REDIRECT_MS, INVITE_INVALID, NAME_MAX, NAME_TOO_LONG, NETWORK_ERROR,
  PASSWORD_LENGTH, PASSWORD_MAX, PASSWORD_MIN, PASSWORD_MISMATCH, TOKEN_MAX, TOKEN_MIN,
} from '@/lib/auth-messages';
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

const subscribeNever = () => () => {};
const linkClass = 'text-label font-medium text-primary hover:text-primary-hover hover:underline';

// useSearchParams() must sit under a Suspense boundary or `next build` cannot prerender the page.
export default function AcceptInvitationPage() {
  return (
    <Suspense fallback={null}>
      <AcceptInvitationForm />
    </Suspense>
  );
}

type Status = 'idle' | 'submitting' | 'invalid-link' | 'done';
type Field = 'name' | 'password' | 'confirm' | null;

function AcceptInvitationForm() {
  const params = useSearchParams(); const router = useRouter();
  const token = params.get('token') ?? '';
  // A missing or malformed token can never succeed: say so before the user picks a password.
  const tokenLooksValid = token.length >= TOKEN_MIN && token.length <= TOKEN_MAX;
  const [status, setStatus] = useState<Status>(tokenLooksValid ? 'idle' : 'invalid-link');
  const [error, setError] = useState('');
  const [errorField, setErrorField] = useState<Field>(null);
  const inFlight = useRef(false);
  const ready = useSyncExternalStore(subscribeNever, () => true, () => false);

  useEffect(() => {
    if (status !== 'done') return;
    // Activation already signed the user in (the API set the session cookie).
    const timer = setTimeout(() => { router.push('/dashboard'); router.refresh(); }, ACTIVATION_REDIRECT_MS);
    return () => clearTimeout(timer);
  }, [status, router]);

  function fail(message: string, field: Field = null) {
    setError(message);
    setErrorField(field);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    fail('');
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    const password = String(form.get('password') ?? '');
    const confirm = String(form.get('confirmPassword') ?? '');
    if (name.length > NAME_MAX) return fail(NAME_TOO_LONG, 'name');
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) return fail(PASSWORD_LENGTH, 'password');
    if (password !== confirm) return fail(PASSWORD_MISMATCH, 'confirm');

    inFlight.current = true;
    setStatus('submitting');
    let next: Status = 'idle';
    try {
      let response: Response;
      try {
        response = await fetch(`${API}/auth/accept-invitation`, {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, password, name: name || undefined }),
        });
      } catch {
        fail(NETWORK_ERROR);
        return;
      }
      if (response.ok) {
        resetSessionCache(); // the new session must be read fresh on the dashboard
        next = 'done';
        return;
      }
      // 401 = invalid, expired, revoked or already used. The API's message never contains the token.
      if (response.status === 401) { next = 'invalid-link'; return; }
      const body = await response.json().catch(() => undefined);
      fail(body?.error?.message ?? ACTIVATE_FAILED);
    } finally {
      inFlight.current = false;
      setStatus(next);
    }
  }

  if (status === 'invalid-link') {
    return (
      <AuthShell>
        <AuthHeading title="Accept invitation" />
        <AuthError>{INVITE_INVALID}</AuthError>
        <a href="/login" className={`mt-8 block text-center ${linkClass}`}>Back to sign in</a>
      </AuthShell>
    );
  }

  if (status === 'done') {
    return (
      <AuthShell>
        <AuthHeading title="Accept invitation" />
        <AuthNotice>{ACCOUNT_ACTIVATED}</AuthNotice>
        <a href="/dashboard" className={`${authButtonClass} grid place-items-center`}>Go to dashboard</a>
      </AuthShell>
    );
  }

  const submitting = status === 'submitting';
  const invalid = (field: Field) => (errorField === field ? { 'aria-invalid': true as const, 'aria-errormessage': 'activation-error' } : {});
  return (
    <AuthShell>
      <form method="post" onSubmit={submit} aria-busy={submitting} noValidate>
        <AuthHeading title="Accept invitation" />
        <div className="mt-8 space-y-5">
          <div>
            <label className={authLabelClass} htmlFor="name">Name</label>
            <input id="name" name="name" autoComplete="name" maxLength={NAME_MAX} className={`mt-2 ${authFieldClass}`} {...invalid('name')} />
          </div>
          <div>
            <label className={authLabelClass} htmlFor="password">Password</label>
            <input
              id="password" name="password" type="password" autoComplete="new-password"
              minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} required aria-describedby="password-hint"
              className={`mt-2 ${authFieldClass}`} {...invalid('password')}
            />
            <p id="password-hint" className="mt-2 text-small text-muted">{PASSWORD_LENGTH}</p>
          </div>
          <div>
            <label className={authLabelClass} htmlFor="confirmPassword">Confirm password</label>
            <input
              id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password"
              maxLength={PASSWORD_MAX} required className={`mt-2 ${authFieldClass}`} {...invalid('confirm')}
            />
          </div>
        </div>
        {error && <div id="activation-error"><AuthError>{error}</AuthError></div>}
        <button disabled={submitting || !ready} className={authButtonClass}>
          {submitting ? 'Activating...' : error ? 'Try again' : 'Activate account'}
        </button>
      </form>
    </AuthShell>
  );
}
