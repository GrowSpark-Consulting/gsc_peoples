import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Throwaway AES-256 key for this test run's identity-document encryption. Generated, never stored or reused.
const IDENTITY_KEY = randomBytes(32).toString('base64');

/**
 * PRODUCTION frontend + PRODUCTION API + REAL PostgreSQL (`hr_test` only).
 *  - Web: a real `next build` then `next start` (NODE_ENV=production). Built with the HOSTILE flags a
 *    mistaken deployment might carry (demo adapter, dev auth); production must ignore them.
 *  - API: the built `dist/server.js` with NODE_ENV=production, AUTH_MODE=session, explicit CORS origin
 *    and DATABASE_URL/DIRECT_URL replaced by the TEST_* values. This file refuses to start unless both
 *    name `hr_test`. Never staging, never production, never hr_db.
 * Own ports (API 4400, web 3400) and dist dir so it cannot collide with another suite.
 * Run `npx tsup` in apps/api first so `dist/server.js` is current.
 */
const API_PORT = 4400;
const WEB_PORT = 3400;
const apiDir = path.resolve(__dirname, '../api');
const apiUrl = `http://localhost:${API_PORT}/api/v1`;

function rootEnv(key: string): string {
  const text = readFileSync(path.resolve(__dirname, '../../.env'), 'utf8');
  const value = text.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.trim().replace(/^["']|["']$/g, '');
  if (!value) throw new Error(`${key} is missing from the repo .env (run pnpm db:test:setup)`);
  return value;
}
const testDatabaseUrl = rootEnv('TEST_DATABASE_URL');
const testDirectUrl = rootEnv('TEST_DIRECT_URL');
for (const url of [testDatabaseUrl, testDirectUrl]) {
  if (new URL(url).pathname.slice(1) !== 'hr_test') throw new Error('SAFEGUARD: this suite only runs against hr_test');
}

export default defineConfig({
  testDir: './e2e-prod-live',
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
      command: 'node dist/server.js',
      cwd: apiDir,
      url: `${apiUrl}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: 'production',
        AUTH_MODE: 'session',
        API_PORT: String(API_PORT),
        CORS_ORIGINS: `http://localhost:${WEB_PORT}`,
        LOG_LEVEL: 'warn',
        DATABASE_URL: testDatabaseUrl,
        DIRECT_URL: testDirectUrl,
        // Government ID numbers: a throwaway key generated for this run only (never a real secret).
        IDENTITY_DOC_ENCRYPTION_KEY: IDENTITY_KEY,
      },
    },
    {
      command: `node node_modules/next/dist/bin/next build && node node_modules/next/dist/bin/next start --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 480_000,
      env: {
        NODE_ENV: 'production',
        NEXT_DIST_DIR: '.next-prod-live',
        NEXT_PUBLIC_API_URL: apiUrl,
        NEXT_PUBLIC_EMPLOYEES_ADAPTER: 'demo', // hostile: must be ignored in production
        NEXT_PUBLIC_DEV_AUTH: 'true', // hostile
        DEV_AUTH_ENABLED: 'true', // hostile
      },
    },
  ],
});
