import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  sourcemap: true,
  // Workspace packages are shipped as TypeScript source, so bundle them in.
  noExternal: [/^@gsc\//],
});
