import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Throwaway AES-256 key for this test run's identity-document encryption. Generated, never stored or reused.
const IDENTITY_KEY = randomBytes(32).toString('base64');

/**
 * SESSION live tests: real browser -> real Next dev server -> real local API (AUTH_MODE=session: real
 * email/password login, httpOnly cookie sessions, CSRF, no bearer tokens) -> real PostgreSQL, against
 * the isolated `hr_test` database, because these tests create employees, revoke sessions and disable users.
 * They must never run against `hr_db`: the API server below is started with DATABASE_URL/DIRECT_URL
 * replaced by the TEST_* values, and this file refuses to start unless both name `hr_test`.
 * Ports (API 4300, web 3300) and the Next dist dir are separate from every other suite.
 */
const API_PORT = 4300;
const WEB_PORT = 3300;
const apiDir = path.resolve(__dirname, '../api');
const apiUrl = `http://localhost:${API_PORT}/api/v1`;

function rootEnv(key: string): string {
  const text = readFileSync(path.resolve(__dirname, '../../.env'), 'utf8');
  const m = text.match(new RegExp(`^${key}=(.*)$`, 'm'));
  const value = m?.[1]?.trim().replace(/^["']|["']$/g, '');
  if (!value) throw new Error(`${key} is missing from the repo .env (run pnpm db:test:setup)`);
  return value;
}
const testDatabaseUrl = rootEnv('TEST_DATABASE_URL');
const testDirectUrl = rootEnv('TEST_DIRECT_URL');
for (const url of [testDatabaseUrl, testDirectUrl]) {
  if (new URL(url).pathname.slice(1) !== 'hr_test') {
    throw new Error('SAFEGUARD: the session suite only runs against hr_test');
  }
}

export default defineConfig({
  testDir: './e2e-live-testdb',
  workers: 1, // one shared database
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  timeout: 90_000,
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
  webServer: [
    {
      command: 'node node_modules/tsx/dist/cli.mjs src/server.ts',
      cwd: apiDir,
      url: `${apiUrl}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: 'development',
        AUTH_MODE: 'session',
        API_PORT: String(API_PORT),
        CORS_ORIGINS: `http://localhost:${WEB_PORT}`,
        LOG_LEVEL: 'warn',
        // Overrides the development database for THIS server process only.
        DATABASE_URL: testDatabaseUrl,
        DIRECT_URL: testDirectUrl,
        // Government ID numbers: a throwaway key generated for this run only (never a real secret).
        IDENTITY_DOC_ENCRYPTION_KEY: IDENTITY_KEY,
      },
    },
    {
      command: `node node_modules/next/dist/bin/next dev --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NODE_ENV: 'development',
        NEXT_DIST_DIR: '.next-live-testdb',
        NEXT_PUBLIC_API_URL: apiUrl,
      },
    },
  ],
});
