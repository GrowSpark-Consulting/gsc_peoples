'use client';

import { useState, useSyncExternalStore, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { resetSessionCache } from '@/hooks/use-session';
import { safeNextPath } from '@/lib/safe-next';

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

  const field =
    'h-11 w-full rounded-md border border-line bg-surface px-3 text-body text-ink shadow-sm transition-colors placeholder:text-muted hover:border-line-strong focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';

  return (
    <main className="grid min-h-dvh bg-bg lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      {/* Brand panel (desktop only) */}
      <aside className="relative hidden overflow-hidden bg-sidebar p-12 text-on-sidebar lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-primary/40 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 -left-16 size-96 rounded-full bg-accent/25 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-md bg-primary text-label font-semibold text-on-primary">GS</span>
          <span className="text-h3 font-semibold">GSC Peoples</span>
        </div>
        <div className="relative max-w-sm">
          <p className="text-[clamp(1.75rem,2.4vw,2.25rem)] font-semibold leading-tight tracking-tight">HR &amp; People CRM</p>
          <p className="mt-3 text-body text-on-sidebar-muted">GrowSpark Consulting Business Platform</p>
        </div>
        <span aria-hidden="true" />
      </aside>

      {/* Form */}
      <section className="flex items-center justify-center px-4 py-12 sm:px-8">
        <form method="post" onSubmit={submit} className="w-full max-w-[400px] rounded-lg bg-surface p-6 shadow-md sm:p-8" noValidate>
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="grid size-9 place-items-center rounded-md bg-primary text-label font-semibold text-on-primary">GS</span>
            <span className="text-h3 font-semibold text-ink">GSC Peoples</span>
          </div>

          <h1 className="text-[clamp(1.5rem,2vw,1.75rem)] font-semibold leading-tight tracking-tight text-ink">Sign in</h1>
          <p className="mt-1.5 text-body text-muted">GSC Peoples</p>

          <div className="mt-8 space-y-5">
            <div>
              <label className="block text-label font-medium text-ink" htmlFor="email">Email</label>
              <input id="email" name="email" type="email" autoComplete="email" required className={`mt-2 ${field}`} />
            </div>

            <div>
              <label className="block text-label font-medium text-ink" htmlFor="role">Role</label>
              <div className="relative mt-2">
                <select id="role" name="role" required defaultValue="" className={`${field} appearance-none pr-10`}>
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
                <label className="block text-label font-medium text-ink" htmlFor="password">Password</label>
                <a href="/forgot-password" className="text-label font-medium text-primary hover:text-primary-hover hover:underline">Forgot password</a>
              </div>
              <div className="relative mt-2">
                <input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" minLength={8} required className={`${field} pr-11`} />
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

          {error && (
            <p role="alert" className="mt-5 rounded-md bg-danger-soft px-3 py-2.5 text-small text-danger">{error}</p>
          )}

          <button
            disabled={loading || !ready}
            className="mt-8 h-11 w-full rounded-md bg-primary text-body font-medium text-on-primary shadow-sm transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  );
}
