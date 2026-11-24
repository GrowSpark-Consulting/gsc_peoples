import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', '.next-live/**', '.next-live-testdb/**', '.next-prod/**', '.next-prod-live/**', '.next-prod-noapi/**', 'node_modules/**', 'next-env.d.ts', 'playwright-report/**']),
]);
