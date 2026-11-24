import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Component tests opt in to jsdom with a `// @vitest-environment jsdom` docblock; everything else
// runs in node.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
  },
});
