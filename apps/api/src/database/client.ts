import { readFileSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../config/env';
import { parseDatabaseUrl } from './connection-url';
import { PrismaClient } from './generated/client';

let client: PrismaClient | undefined;

export const isDatabaseConfigured = () => Boolean(env.DATABASE_URL);

/** Verified TLS (never rejectUnauthorized:false) for the Supabase target; local PostgreSQL stays plain. */
function tlsOptions() {
  if (env.DB_TARGET !== 'supabase') return undefined;
  return { ca: readFileSync(env.SUPABASE_CA_CERT_PATH as string, 'utf8'), rejectUnauthorized: true };
}

/** Builds a Prisma client for a given URL (the `?schema=` parameter is handled for the adapter). */
export function createPrismaClient(
  databaseUrl: string,
  options: { max?: number } = {},
): PrismaClient {
  const { connectionString, schema } = parseDatabaseUrl(databaseUrl);
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString, max: options.max, ssl: tlsOptions() }, { schema }),
  });
}

/**
 * Lazily creates the singleton Prisma client. Throws if DATABASE_URL is not set.
 * Runtime uses DATABASE_URL (the least-privilege `hr_app` role); migrations use DIRECT_URL.
 */
export function getPrisma(): PrismaClient {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  client ??= createPrismaClient(env.DATABASE_URL, { max: env.DATABASE_POOL_MAX });
  return client;
}

export async function disconnectDatabase(): Promise<void> {
  await client?.$disconnect();
  client = undefined;
}
