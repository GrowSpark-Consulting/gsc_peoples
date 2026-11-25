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

  return (
    <main className="min-h-dvh bg-[#F5F5F5] px-4 py-10 sm:grid sm:place-items-center">
      <form method="post" onSubmit={submit} className="mx-auto w-full max-w-sm border border-[#E5E5E5] bg-white p-6" noValidate>
        <h1 className="text-xl font-semibold text-[#090909]">Sign in</h1>
        <p className="mt-1 text-sm text-[#737373]">GSC Peoples</p>
        <label className="mt-6 block text-sm font-medium" htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required className="mt-2 h-10 w-full border border-[#E5E5E5] px-3" />
        <label className="mt-4 block text-sm font-medium" htmlFor="role">Role</label>
        <select id="role" name="role" required defaultValue="" className="mt-2 h-10 w-full border border-[#E5E5E5] bg-white px-3">
          <option value="" disabled>Select your role</option>
          <option value="SUPER_ADMIN">Super Admin</option>
          <option value="HR_ADMIN">HR Admin</option>
          <option value="MANAGER">Manager</option>
          <option value="EMPLOYEE">Employee</option>
        </select>
        <label className="mt-4 block text-sm font-medium" htmlFor="password">Password</label>
        <div className="relative mt-2">
          <input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" minLength={8} required className="h-10 w-full border border-[#E5E5E5] pl-3 pr-11" />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
            className="absolute inset-y-0 right-0 grid w-11 place-items-center text-[#737373] hover:text-[#090909]"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
              <circle cx="12" cy="12" r="3" />
              {showPassword && <path d="M3 3l18 18" />}
            </svg>
          </button>
        </div>
        {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
        <button disabled={loading || !ready} className="mt-6 h-10 w-full bg-[#090909] text-sm font-medium text-white disabled:opacity-60">{loading ? 'Signing in...' : 'Sign in'}</button>
        <a href="/forgot-password" className="mt-4 block text-center text-sm underline">Forgot password</a>
      </form>
    </main>
  );
}
