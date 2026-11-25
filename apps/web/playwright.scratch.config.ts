import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end suite on a DISPOSABLE database: real browser -> real Next production build (`next start`) -> real local API
 * (AUTH_MODE=session: email/password login, httpOnly cookie sessions, CSRF) -> real PostgreSQL, scratch
 * database `hr_itest_e2e` only. It is created by global-setup, seeded with two companies and the four roles,
 * and dropped afterwards (set E2E_KEEP_DB=1 to keep it). `hr_db` and `hr_test` are never connected to: the
 * helper script refuses every database name except `hr_itest*` and every non-local host.
 * Ports (API 4400, web 3400; override with E2E_API_PORT / E2E_WEB_PORT) and the Next dist dir are separate from
 * every other suite. The web app runs as a PRODUCTION build (`next build` + `next start`): the same bundle that
 * ships to Vercel, and far lighter on memory than the dev server.
 *
 * Run: `pnpm --filter @gsc/web test:e2e:scratch`  (or `npx playwright test --config playwright.scratch.config.ts`)
 */
const API_PORT = Number(process.env.E2E_API_PORT ?? 4400);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3400);
const apiDir = path.resolve(__dirname, '../api');
const apiUrl = `http://localhost:${API_PORT}/api/v1`;
const SMTP_PORT = Number(process.env.E2E_SMTP_PORT ?? 4425);
const MAIL_PORT = Number(process.env.E2E_MAIL_PORT ?? 4426);

const urls = JSON.parse(
  execFileSync(process.execPath, [path.join(apiDir, 'node_modules/tsx/dist/cli.mjs'), 'scripts/e2e-scratch-db.ts', 'urls'], { cwd: apiDir, encoding: 'utf8' }).trim(),
) as { DATABASE_URL: string; DIRECT_URL: string };
for (const u of [urls.DATABASE_URL, urls.DIRECT_URL]) {
  if (new URL(u).pathname.slice(1) !== 'hr_itest_e2e') throw new Error('SAFEGUARD: the scratch suite only runs against hr_itest_e2e');
}

export default defineConfig({
  testDir: './e2e-scratch',
  globalSetup: './e2e-scratch/global-setup.ts',
  workers: 1, // one shared database
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e-scratch.json' }]],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: { baseURL: `http://localhost:${WEB_PORT}`, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.PW_CHROMIUM_EXECUTABLE ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_EXECUTABLE } } : {}),
      },
    },
  ],
  webServer: [
    {
      // Catches invitation and password-reset emails locally (nothing is sent anywhere).
      command: 'node e2e-scratch/mail-sink.mjs',
      url: `http://127.0.0.1:${MAIL_PORT}/`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { E2E_SMTP_PORT: String(SMTP_PORT), E2E_MAIL_PORT: String(MAIL_PORT) },
    },
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
        DATABASE_URL: urls.DATABASE_URL,
        DIRECT_URL: urls.DIRECT_URL,
        // one shared IP signs in dozens of times; the limiter itself is covered by unit tests
        AUTH_RATE_LIMIT_PER_15_MIN: '5000',
        RATE_LIMIT_PER_MINUTE: '50000',
        DOCUMENT_STORAGE_DRIVER: 'local',
        DB_TARGET: 'local',
        MAIL_DRIVER: 'smtp',
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: String(SMTP_PORT),
        SMTP_SECURE: 'false',
        MAIL_FROM: 'GSC Peoples <no-reply@e2e.local>',
        WEB_APP_URL: `http://localhost:${WEB_PORT}`,
        DOCUMENTS_STORAGE_DIR: path.resolve(__dirname, 'test-results/e2e-scratch-documents'),
      },
    },
    {
      command: `node node_modules/next/dist/bin/next build && node node_modules/next/dist/bin/next start --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 420_000,
      env: { NEXT_DIST_DIR: '.next-scratch', NEXT_PUBLIC_API_URL: apiUrl },
    },
  ],
});
