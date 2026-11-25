import { defineConfig } from 'tsup';

export default defineConfig({
  // `purge-documents` is the retention job (DOC-005), run by a scheduler as `node dist/purge-documents.js`.
  entry: { server: 'src/server.ts', 'purge-documents': 'src/jobs/purge-documents.ts' },
  format: ['esm'],
  target: 'node22',
  clean: true,
  sourcemap: true,
  // Workspace packages are shipped as TypeScript source, so bundle them in.
  noExternal: [/^@gsc\//],
});
