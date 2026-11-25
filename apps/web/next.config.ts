import type { NextConfig } from 'next';
import { PHASE_PRODUCTION_BUILD } from 'next/constants';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The dev-only indicator defaults to bottom-left, where it covers the sidebar collapse toggle and
  // intercepts clicks in browser tests. Not present in production builds.
  devIndicators: { position: 'bottom-right' },
  // Lets the live Playwright suite run its own dev server without sharing `.next` with a normal one.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // Workspace packages are consumed as TypeScript source.
  transpilePackages: ['@gsc/shared', '@gsc/contracts'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // No framing (clickjacking), no MIME sniffing, no device APIs.
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        ],
      },
      // These pages carry a single-use token in the URL: it must never leave in a Referer header.
      ...['/reset-password', '/accept-invitation'].map((source) => ({ source, headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] })),
    ];
  },
  /**
   * Same-origin API proxy (production). Browser requests to /api/v1/* are rewritten server-side to
   * the Render API URL so that cookies and CSRF tokens flow on a single origin. RENDER_API_URL is a
   * server-side-only env var (not NEXT_PUBLIC_*); it must be set on Vercel for rewrites to work.
   *
   * In local development RENDER_API_URL is unset and no rewrite is registered — the browser talks
   * directly to the local API via NEXT_PUBLIC_API_URL (absolute URL, e.g. http://localhost:4000/api/v1).
   * The same applies in E2E scratch tests: they set NEXT_PUBLIC_API_URL and rely on direct cross-origin
   * requests (the scratch environment does not go through a Vercel edge).
   */
  async rewrites() {
    const renderApiUrl = process.env.RENDER_API_URL?.replace(/\/+$/, '');
    if (!renderApiUrl) return [];
    return [
      {
        // Forward every /api/v1/* browser request to the Render service.
        // :path* includes query strings automatically.
        source: '/api/v1/:path*',
        destination: `${renderApiUrl}/api/v1/:path*`,
      },
    ];
  },
};

/**
 * Production fails closed on missing API configuration. NEXT_PUBLIC_* values are inlined into the
 * bundles at build time, so a production build without NEXT_PUBLIC_API_URL could only ever ship browser
 * code that falls back to http://localhost:4000, i.e. sends credentials to whatever listens on the
 * visitor's own machine. Refusing to build is the only point where that can be prevented.
 *
 * In same-origin mode NEXT_PUBLIC_API_URL is set to the relative path `/api/v1`, which satisfies this
 * guard and routes browser requests through the Next.js rewrite above.
 */
export default function config(phase: string): NextConfig {
  if (phase === PHASE_PRODUCTION_BUILD && !process.env.NEXT_PUBLIC_API_URL?.trim()) {
    throw new Error(
      'NEXT_PUBLIC_API_URL is required for a production build.\n' +
        '  Same-origin deployment (recommended): set NEXT_PUBLIC_API_URL=/api/v1 and RENDER_API_URL=https://<service>.onrender.com on Vercel.\n' +
        '  Cross-origin deployment: set NEXT_PUBLIC_API_URL=https://api.<domain>/api/v1 and configure a shared custom domain.\n' +
        'Refusing to build without it.',
    );
  }
  return nextConfig;
}
