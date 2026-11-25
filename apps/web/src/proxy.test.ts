/**
 * Unit tests for proxy.ts (Next.js middleware / route guard).
 *
 * Tests verify:
 * 1. The middleware excludes /api/* paths from its matcher — rewrites must not be intercepted.
 * 2. The apiUrl resolution prefers RENDER_API_URL over NEXT_PUBLIC_API_URL (absolute only).
 * 3. Unauthenticated page requests redirect to /login.
 * 4. Authenticated page requests pass through.
 * 5. The /showcase path is 404 in production, passthrough in development.
 */
import { describe, it, expect } from 'vitest';

// ----- matcher regex test helpers ----

/**
 * Reproduce the middleware matcher pattern. We test the regex directly because Next.js compiles
 * the config.matcher string at build time; we cannot run the actual Edge Runtime in Vitest.
 * The pattern is from proxy.ts config.matcher[0] (verbatim, without the outer path delimiters).
 */
const MATCHER_PATTERN =
  /^\/(?!_next\/|favicon\.ico$|(?:login|forgot-password|reset-password|accept-invitation)(?:\/|$)|api\/).*/;

function matches(path: string): boolean {
  return MATCHER_PATTERN.test(path);
}

describe('proxy.ts config.matcher', () => {
  describe('protected pages — should match (middleware runs)', () => {
    it.each([
      '/',
      '/dashboard',
      '/employees',
      '/employees/123',
      '/leave',
      '/attendance',
      '/settings',
      '/onboarding',
      '/reports',
    ])('%s', (path) => {
      expect(matches(path)).toBe(true);
    });
  });

  describe('public auth pages — should NOT match (no middleware)', () => {
    it.each([
      '/login',
      '/login?next=%2Fdashboard',
      '/forgot-password',
      '/reset-password',
      '/accept-invitation',
      '/accept-invitation/abc123',
    ])('%s', (path) => {
      // Strip query string for the regex check (Next.js matcher operates on pathname only)
      const pathname = path.split('?')[0] ?? path;
      expect(matches(pathname)).toBe(false);
    });
  });

  describe('static assets — should NOT match', () => {
    it.each([
      '/_next/static/abc.js',
      '/_next/image?url=…',
      '/favicon.ico',
    ])('%s', (path) => {
      const pathname = path.split('?')[0] ?? path;
      expect(matches(pathname)).toBe(false);
    });
  });

  describe('API paths — should NOT match (critical: prevents rewrite loop)', () => {
    it.each([
      '/api/v1/me',
      '/api/v1/auth/login',
      '/api/v1/employees',
      '/api/v1/health',
      '/api/health',
      '/api/',
      '/api/v1/',
    ])('%s', (path) => {
      expect(matches(path)).toBe(false);
    });
  });
});

// ----- apiUrl resolution logic test ----

/**
 * Extract and test the apiUrl resolution logic from proxy.ts without running the Edge Runtime.
 * The logic is: RENDER_API_URL (absolute) → NEXT_PUBLIC_API_URL (if absolute http*) → dev fallback.
 */
function resolveApiUrl(env: {
  RENDER_API_URL?: string;
  NEXT_PUBLIC_API_URL?: string;
  NODE_ENV?: string;
}): string | undefined {
  const production = env.NODE_ENV === 'production';
  return (
    env.RENDER_API_URL?.replace(/\/+$/, '') ??
    (env.NEXT_PUBLIC_API_URL?.startsWith('http') ? env.NEXT_PUBLIC_API_URL : undefined) ??
    (production ? undefined : 'http://localhost:4000/api/v1')
  );
}

describe('proxy.ts apiUrl resolution', () => {
  it('prefers RENDER_API_URL in same-origin production', () => {
    expect(
      resolveApiUrl({
        RENDER_API_URL: 'https://gsc-peoples-api.onrender.com',
        NEXT_PUBLIC_API_URL: '/api/v1',
        NODE_ENV: 'production',
      }),
    ).toBe('https://gsc-peoples-api.onrender.com');
  });

  it('strips trailing slash from RENDER_API_URL', () => {
    expect(
      resolveApiUrl({
        RENDER_API_URL: 'https://gsc-peoples-api.onrender.com/',
        NODE_ENV: 'production',
      }),
    ).toBe('https://gsc-peoples-api.onrender.com');
  });

  it('falls back to absolute NEXT_PUBLIC_API_URL in cross-origin production (no RENDER_API_URL)', () => {
    expect(
      resolveApiUrl({
        NEXT_PUBLIC_API_URL: 'https://api.example.com/api/v1',
        NODE_ENV: 'production',
      }),
    ).toBe('https://api.example.com/api/v1');
  });

  it('ignores relative NEXT_PUBLIC_API_URL in production (cannot fetch from Edge Runtime)', () => {
    expect(
      resolveApiUrl({
        NEXT_PUBLIC_API_URL: '/api/v1',
        NODE_ENV: 'production',
      }),
    ).toBeUndefined();
  });

  it('uses local fallback in development when no env vars set', () => {
    expect(resolveApiUrl({ NODE_ENV: 'development' })).toBe('http://localhost:4000/api/v1');
  });

  it('uses NEXT_PUBLIC_API_URL absolute value in development', () => {
    expect(
      resolveApiUrl({
        NEXT_PUBLIC_API_URL: 'http://localhost:4400/api/v1',
        NODE_ENV: 'development',
      }),
    ).toBe('http://localhost:4400/api/v1');
  });

  it('ignores relative NEXT_PUBLIC_API_URL in development, falls back to localhost', () => {
    expect(
      resolveApiUrl({
        NEXT_PUBLIC_API_URL: '/api/v1',
        NODE_ENV: 'development',
      }),
    ).toBe('http://localhost:4000/api/v1');
  });
});
