import { NextResponse, type NextRequest } from 'next/server';
import { demoModeEnabled } from '@/lib/dev-auth/config';

/**
 * Server-side route protection (Next 16 `proxy`, formerly middleware). Every page except the public
 * auth pages requires a session that the API itself accepts: the `gsc_session` cookie is forwarded to
 * `GET /api/v1/me`, so expiry (8h idle), revocation, logout and account deactivation take effect on the
 * next navigation. This is a navigation gate only; the API still authorises every data request.
 *
 * Fails closed: a missing/invalid session redirects to /login; an unreachable API or a production build
 * without NEXT_PUBLIC_API_URL answers 503 and renders nothing.
 */
const SESSION_COOKIE = 'gsc_session';
const CSRF_COOKIE = 'gsc_csrf';

function loginRedirect(req: NextRequest, clearCookies: boolean) {
  const url = new URL('/login', req.url);
  const next = req.nextUrl.pathname + req.nextUrl.search;
  if (next !== '/' && next !== '/dashboard') url.searchParams.set('next', next);
  const res = NextResponse.redirect(url);
  if (clearCookies) {
    res.cookies.delete(SESSION_COOKIE);
    res.cookies.delete(CSRF_COOKIE);
  }
  return res;
}

const unavailable = () =>
  new NextResponse('Service unavailable', { status: 503, headers: { 'cache-control': 'no-store' } });

export async function proxy(req: NextRequest) {
  const production = process.env.NODE_ENV === 'production';

  // UI pattern showcase: development reference only.
  if (req.nextUrl.pathname.startsWith('/showcase')) {
    return production ? new NextResponse('Not found', { status: 404 }) : NextResponse.next();
  }

  // Explicit, development-only demo mode has no login by design. Never true in production.
  if (
    demoModeEnabled({
      NODE_ENV: process.env.NODE_ENV,
      NEXT_PUBLIC_EMPLOYEES_ADAPTER: process.env.NEXT_PUBLIC_EMPLOYEES_ADAPTER,
    })
  ) {
    return NextResponse.next();
  }

  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL ?? (production ? undefined : 'http://localhost:4000/api/v1');
  if (!apiUrl) return unavailable();

  const session = req.cookies.get(SESSION_COOKIE)?.value;
  if (!session) return loginRedirect(req, false);

  let status: number;
  try {
    const res = await fetch(`${apiUrl.replace(/\/+$/, '')}/me`, {
      headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(session)}`, accept: 'application/json' },
      cache: 'no-store',
    });
    status = res.status;
  } catch {
    return unavailable();
  }

  if (status === 401) return loginRedirect(req, true);
  if (status >= 500) return unavailable();
  // 200 (valid) and 403 (valid session, no membership) both continue: the page shows the access state.
  const response = NextResponse.next();
  response.headers.set('cache-control', 'no-store');
  return response;
}

export const config = {
  matcher: [
    '/((?!_next/|favicon\\.ico$|(?:login|forgot-password|reset-password|accept-invitation)(?:/|$)|api/health$).*)',
  ],
};
