'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
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
  return <main className="min-h-dvh bg-[#F5F5F5] px-4 py-10 sm:grid sm:place-items-center"><form method="post" onSubmit={submit} className="mx-auto w-full max-w-sm border border-[#E5E5E5] bg-white p-6"><h1 className="text-xl font-semibold">Reset password</h1><label className="mt-6 block text-sm font-medium" htmlFor="password">New password</label><input id="password" name="password" type="password" minLength={10} required className="mt-2 h-10 w-full border border-[#E5E5E5] px-3" />{error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}<button className="mt-6 h-10 w-full bg-[#090909] text-sm font-medium text-white">Set password</button></form></main>;
}
