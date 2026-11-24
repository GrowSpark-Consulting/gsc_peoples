'use client';

import { useState, type FormEvent } from 'react';
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
  return <main className="min-h-dvh bg-[#F5F5F5] px-4 py-10 sm:grid sm:place-items-center"><form method="post" onSubmit={submit} className="mx-auto w-full max-w-sm border border-[#E5E5E5] bg-white p-6"><h1 className="text-xl font-semibold">Forgot password</h1><label className="mt-6 block text-sm font-medium" htmlFor="email">Email</label><input id="email" name="email" type="email" required className="mt-2 h-10 w-full border border-[#E5E5E5] px-3" />{error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}{message && <p role="status" className="mt-4 text-sm">{message}</p>}<button className="mt-6 h-10 w-full bg-[#090909] text-sm font-medium text-white">Send reset link</button></form></main>;
}
