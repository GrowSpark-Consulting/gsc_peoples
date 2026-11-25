'use client';

import { useState, useSyncExternalStore, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { resetSessionCache } from '@/hooks/use-session';
import { safeNextPath } from '@/lib/safe-next';
import { AuthError, AuthHeading, AuthShell, authButtonClass, authFieldClass, authLabelClass } from '@/components/layout/auth-shell';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

const subscribeNever = () => () => {};

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // The submit button stays disabled until React has attached the handler, so a fast click can never
  // fall through to a native form submission that would put the credentials in the URL.
  const ready = useSyncExternalStore(subscribeNever, () => true, () => false); // false on the server and during hydration

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    const form = new FormData(event.currentTarget);
    if (!form.get('role')) {
      setError('Select your role');
      setLoading(false);
      return;
    }
    try {
      const response = await fetch(`${API}/auth/login`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: String(form.get('email')), password: String(form.get('password')), roleKey: String(form.get('role')) }),
      });
      const body = await response.json().catch(() => undefined);
      if (!response.ok) throw new Error(body?.error?.message ?? 'Login failed');
      resetSessionCache(); // an expired session can reach this page without a reload
      // Return to the page the server gate redirected from, but only to a same-site relative path.
      router.push(safeNextPath(new URLSearchParams(window.location.search).get('next'), window.location.origin));
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <form method="post" onSubmit={submit} noValidate>
        <AuthHeading title="Sign in" subtitle="GSC Peoples" />

        <div className="mt-8 space-y-5">
          <div>
            <label className={authLabelClass} htmlFor="email">Email</label>
            <input id="email" name="email" type="email" autoComplete="email" required className={`mt-2 ${authFieldClass}`} />
          </div>

          <div>
            <label className={authLabelClass} htmlFor="role">Role</label>
            <div className="relative mt-2">
              <select id="role" name="role" required defaultValue="" className={`${authFieldClass} appearance-none pr-10`}>
                <option value="" disabled>Select your role</option>
                <option value="SUPER_ADMIN">Super Admin</option>
                <option value="HR_ADMIN">HR Admin</option>
                <option value="MANAGER">Manager</option>
                <option value="EMPLOYEE">Employee</option>
              </select>
              <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </div>
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <label className={authLabelClass} htmlFor="password">Password</label>
              <a href="/forgot-password" className="text-label font-medium text-primary hover:text-primary-hover hover:underline">Forgot password</a>
            </div>
            <div className="relative mt-2">
              <input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" minLength={8} required className={`${authFieldClass} pr-11`} />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-md text-muted transition-colors hover:text-ink"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
                  <circle cx="12" cy="12" r="3" />
                  {showPassword && <path d="M3 3l18 18" />}
                </svg>
              </button>
            </div>
          </div>
        </div>

        {error && <AuthError>{error}</AuthError>}

        <button disabled={loading || !ready} className={authButtonClass}>
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </AuthShell>
  );
}
