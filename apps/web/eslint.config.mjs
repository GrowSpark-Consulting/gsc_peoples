import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // `.next-*` are the separate build folders of the browser suites (next.config.ts, NEXT_DIST_DIR).
  globalIgnores(['.next/**', '.next-*/**', 'node_modules/**', 'next-env.d.ts', 'playwright-report/**', 'test-results/**']),
]);
