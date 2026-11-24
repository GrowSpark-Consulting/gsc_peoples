import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * LIVE tests: real browser -> real Next dev server -> real local API -> real local PostgreSQL `hr_db`
 * (the API reads DATABASE_URL from the repo-level .env). Separate ports (API 4100, web 3100) and a
 * separate Next dist dir so they never collide with a normal dev session or the demo-mode suite.
 * Development auth is switched on explicitly for these servers only.
 */
const API_PORT = 4100;
const WEB_PORT = 3100;
const apiDir = path.resolve(__dirname, '../api');
const apiUrl = `http://localhost:${API_PORT}/api/v1`;

export default defineConfig({
  testDir: './e2e-live',
  workers: 1, // one shared database
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
        // Optional: use an already-installed Chromium instead of downloading the one this Playwright wants.
        ...(process.env.PW_CHROMIUM_EXECUTABLE
          ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_EXECUTABLE } }
          : {}),
      },
    },
  ],
  webServer: [
    {
      command: 'node node_modules/tsx/dist/cli.mjs src/server.ts',
      cwd: apiDir,
      url: `${apiUrl}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: 'development',
        AUTH_MODE: 'development',
        DEV_AUTH_ENABLED: 'true',
        API_PORT: String(API_PORT),
        CORS_ORIGINS: `http://localhost:${WEB_PORT}`,
        LOG_LEVEL: 'warn',
      },
    },
    {
      command: `node node_modules/next/dist/bin/next dev --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NODE_ENV: 'development',
        NEXT_DIST_DIR: '.next-live',
        DEV_AUTH_ENABLED: 'true',
        NEXT_PUBLIC_DEV_AUTH: 'true',
        NEXT_PUBLIC_EMPLOYEES_ADAPTER: 'http',
        NEXT_PUBLIC_API_URL: apiUrl,
      },
    },
  ],
});
