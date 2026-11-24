import { defineConfig } from '@playwright/test';

/**
 * Missing-API-configuration contract for production. No servers are started and no browser is used:
 * the spec runs `next build` itself, without NEXT_PUBLIC_API_URL, and asserts that it refuses.
 * Needs no database.
 */
export default defineConfig({
  testDir: './e2e-prod-noapi',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  timeout: 240_000,
});
