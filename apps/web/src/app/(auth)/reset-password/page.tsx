'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { AuthError, AuthHeading, AuthShell, authButtonClass, authFieldClass, authLabelClass } from '@/components/layout/auth-shell';
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

// useSearchParams() must sit under a Suspense boundary or `next build` cannot prerender the page.
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const params = useSearchParams(); const router = useRouter();
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const form = new FormData(event.currentTarget);
    const token = params.get('token') ?? '';
    const response = await fetch(`${API}/auth/reset-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password: String(form.get('password')) }),
    });
    const body = await response.json().catch(() => undefined);
    if (!response.ok) setError(body?.error?.message ?? 'Reset failed');
    else router.push('/login');
  }
  return (
    <AuthShell>
      <form method="post" onSubmit={submit}>
        <AuthHeading title="Reset password" />
        <div className="mt-8">
          <label className={authLabelClass} htmlFor="password">New password</label>
          <input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required className={`mt-2 ${authFieldClass}`} />
        </div>
        {error && <AuthError>{error}</AuthError>}
        <button className={authButtonClass}>Set password</button>
      </form>
    </AuthShell>
  );
}
