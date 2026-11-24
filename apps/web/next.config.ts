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
};

/**
 * Production fails closed on missing API configuration. NEXT_PUBLIC_* values are inlined into the
 * bundles at build time, so a production build without NEXT_PUBLIC_API_URL could only ever ship browser
 * code that falls back to http://localhost:4000, i.e. sends credentials to whatever listens on the
 * visitor's own machine. Refusing to build is the only point where that can be prevented.
 */
export default function config(phase: string): NextConfig {
  if (phase === PHASE_PRODUCTION_BUILD && !process.env.NEXT_PUBLIC_API_URL?.trim()) {
    throw new Error(
      'NEXT_PUBLIC_API_URL is required for a production build (the HTTPS URL of the API, e.g. https://api.example.com/api/v1). Refusing to build without it.',
    );
  }
  return nextConfig;
}
