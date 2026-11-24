import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * CONTRACT: a production build REFUSES to be produced without NEXT_PUBLIC_API_URL.
 *
 * Why build time and not a runtime 503: NEXT_PUBLIC_* values are inlined into the browser bundles when
 * `next build` runs, so they cannot be "missing at runtime". A build without the URL would ship login,
 * reset-password and accept-invitation pages that fall back to http://localhost:4000 and post
 * credentials to whatever listens on the visitor's own machine. Authentication is never made optional
 * and no demo adapter or fallback data is activated; there is simply no build to serve.
 *
 * The runtime fail-closed behaviour for a configured-but-unreachable API (503 for protected pages, no
 * demo data) is covered by e2e-prod/production-mode.spec.ts.
 */

const webDir = path.resolve(__dirname, '..');
const next = path.join(webDir, 'node_modules/next/dist/bin/next');
const DIST = '.next-prod-noapi';

function build(apiUrl: string | undefined) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production',
    NEXT_DIST_DIR: DIST,
    // Hostile flags too: they must not rescue a build that has no API URL.
    NEXT_PUBLIC_EMPLOYEES_ADAPTER: 'demo',
    NEXT_PUBLIC_DEV_AUTH: 'true',
    DEV_AUTH_ENABLED: 'true',
  };
  delete env.NEXT_PUBLIC_API_URL;
  if (apiUrl !== undefined) env.NEXT_PUBLIC_API_URL = apiUrl;
  return spawnSync(process.execPath, [next, 'build'], { cwd: webDir, env, encoding: 'utf8', timeout: 200_000 });
}

for (const [label, value] of [['unset', undefined], ['empty', ''], ['blank', '   ']] as const) {
  test(`next build fails when NEXT_PUBLIC_API_URL is ${label}, and produces no build output`, () => {
    const result = build(value);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(result.status, output).not.toBe(0);
    expect(output).toContain('NEXT_PUBLIC_API_URL is required for a production build');
    expect(existsSync(path.join(webDir, DIST, 'BUILD_ID'))).toBe(false);
  });
}
