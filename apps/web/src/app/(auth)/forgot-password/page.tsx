'use client';

import { useState, type FormEvent } from 'react';
import { AuthError, AuthHeading, AuthNotice, AuthShell, authButtonClass, authFieldClass, authLabelClass } from '@/components/layout/auth-shell';
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export default function ForgotPasswordPage() {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setMessage('');
    const form = new FormData(event.currentTarget);
    const response = await fetch(`${API}/auth/forgot-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: form.get('email') }) });
    const body = await response.json().catch(() => undefined);
    if (!response.ok) setError(body?.error?.message ?? 'Request failed');
    else setMessage(body.data.message);
  }
  return (
    <AuthShell>
      <form method="post" onSubmit={submit}>
        <AuthHeading title="Forgot password" />
        <div className="mt-8">
          <label className={authLabelClass} htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required className={`mt-2 ${authFieldClass}`} />
        </div>
        {error && <AuthError>{error}</AuthError>}
        {message && <AuthNotice>{message}</AuthNotice>}
        <button className={authButtonClass}>Send reset link</button>
        <a href="/login" className="mt-5 block text-center text-label font-medium text-primary hover:text-primary-hover hover:underline">Back to sign in</a>
      </form>
    </AuthShell>
  );
}
