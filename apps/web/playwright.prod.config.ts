import { defineConfig, devices } from '@playwright/test';

/**
 * PRODUCTION-MODE tests: a real `next build` + `next start` (NODE_ENV=production), no API and no
 * database behind it. The build and the server are given the HOSTILE flags a mistaken deployment might
 * carry (demo adapter, dev auth on, server flag on). Production must ignore every one of them.
 * Separate port (3200) and dist dir (.next-prod) so it never collides with another suite.
 */
const WEB_PORT = 3200;
export const PROD_DIST_DIR = '.next-prod';
export const UNREACHABLE_API = 'http://localhost:4999/api/v1'; // nothing listens here

const hostile = {
  NEXT_DIST_DIR: PROD_DIST_DIR,
  NEXT_PUBLIC_EMPLOYEES_ADAPTER: 'demo',
  NEXT_PUBLIC_DEV_AUTH: 'true',
  DEV_AUTH_ENABLED: 'true',
  NEXT_PUBLIC_API_URL: UNREACHABLE_API,
};

export default defineConfig({
  testDir: './e2e-prod',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  timeout: 60_000,
  use: { baseURL: `http://localhost:${WEB_PORT}`, trace: 'retain-on-failure' },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.PW_CHROMIUM_EXECUTABLE
          ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_EXECUTABLE } }
          : {}),
      },
    },
  ],
  webServer: {
    // `next build` always compiles with NODE_ENV=production; NEXT_PUBLIC_* values are inlined at this step.
    command: `node node_modules/next/dist/bin/next build && node node_modules/next/dist/bin/next start --port ${WEB_PORT}`,
    url: `http://localhost:${WEB_PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 480_000,
    env: { ...hostile, NODE_ENV: 'production' },
  },
});
