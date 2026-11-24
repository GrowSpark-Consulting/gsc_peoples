import { defineConfig } from 'vitest/config';

// Real PostgreSQL integration tests. Only ever runs against the dedicated `hr_test` database
// (see src/test/integration/helpers.ts). Requires TEST_DATABASE_URL / TEST_DIRECT_URL in .env.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    globalSetup: ['src/test/integration/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: { NODE_ENV: 'test', AUTH_MODE: 'development', LOG_LEVEL: 'silent' },
  },
});
