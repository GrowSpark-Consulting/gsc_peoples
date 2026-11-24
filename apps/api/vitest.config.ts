import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Integration tests need a real PostgreSQL `hr_test` database: `pnpm --filter @gsc/api test:integration`.
    exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
    env: {
      NODE_ENV: 'test',
      AUTH_MODE: 'development',
      LOG_LEVEL: 'silent',
    },
  },
});
