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
      // Unit tests never use a database. Defined-but-empty values stop the repository `.env` from supplying one
      // (dotenv does not override variables that already exist), so a unit run can never reach a developer database.
      DATABASE_URL: '',
      DIRECT_URL: '',
      DB_TARGET: 'local',
      DOCUMENT_STORAGE_DRIVER: 'local',
      MAIL_DRIVER: 'disabled',
    },
  },
});
