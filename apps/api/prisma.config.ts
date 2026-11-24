import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Prisma 7 no longer loads .env itself. The repo-level .env is the single source.
loadEnv({ path: path.resolve(import.meta.dirname, '../../.env'), quiet: true });

// DB_TARGET=supabase: the CLI uses hr_migrator (SUPABASE_DIRECT_URL) with strict TLS against the CA file.
// Never falls back to the runtime role: a missing SUPABASE_DIRECT_URL leaves the URL empty and fails.
function migrationUrl(): string {
  if (process.env.DB_TARGET !== 'supabase') return process.env.DIRECT_URL || process.env.DATABASE_URL || '';
  const base = process.env.SUPABASE_DIRECT_URL;
  const ca = process.env.SUPABASE_CA_CERT_PATH;
  if (!base || !ca) return '';
  const u = new URL(base);
  u.searchParams.set('schema', 'hr'); // Prisma defaults to `public` without it: never allow that on the hosted target
  u.searchParams.set('sslaccept', 'strict');
  u.searchParams.set('sslcert', path.resolve(ca));
  return u.toString();
}

export default defineConfig({
  schema: 'src/database/prisma/schema.prisma',
  migrations: {
    path: 'src/database/migrations',
    seed: 'tsx src/database/seeds/index.ts',
  },
  datasource: {
    // The Prisma CLI (migrate, studio) uses the migration role when DIRECT_URL is set;
    // the running API always uses DATABASE_URL (see src/database/client.ts).
    // Empty when unset so `prisma generate` works without a database.
    url: migrationUrl(),
  },
});
