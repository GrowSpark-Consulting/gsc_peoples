import { readFileSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PoolConfig } from 'pg';
import { env } from '../config/env';
import { logger } from '../shared/utils/logger';
import { parseDatabaseUrl } from './connection-url';
import { safeDatabaseErrorFields } from './errors';
import { PrismaClient } from './generated/client';

let client: PrismaClient | undefined;

export const isDatabaseConfigured = () => Boolean(env.DATABASE_URL);

/**
 * Connection lifecycle limits. Option names are pg 8.23 / pg-pool 3.14 (`PoolConfig` in @types/pg); @prisma/adapter-pg
 * passes this object unchanged to `new pg.Pool(...)`. Without them pg waits forever for a connection or a query, so a
 * cold or unreachable database turns into a request that hangs until the proxy in front gives up (a 502).
 */
export const DATABASE_TIMEOUTS = {
  /** TCP + TLS + authentication for a new connection, and also the wait for a free pool slot. */
  connectionTimeoutMillis: 5_000,
  /** Server-side statement_timeout, set on each new connection: PostgreSQL cancels the statement and the connection stays usable. */
  statementTimeoutMillis: 10_000,
  /** Client-side backstop for a server that stops answering entirely (network black hole). Above the statement timeout. */
  queryTimeoutMillis: 15_000,
  /** Idle connections are closed after a minute (pg-pool default: 10 s), so short pauses do not pay for a new TLS handshake. */
  idleTimeoutMillis: 60_000,
  /** TCP keep-alive lets the OS detect a silently dropped idle connection instead of the next query hanging on it. */
  keepAliveInitialDelayMillis: 10_000,
} as const;

/** Verified TLS (never rejectUnauthorized:false) for the Supabase target; local PostgreSQL stays plain. */
function tlsOptions() {
  if (env.DB_TARGET !== 'supabase') return undefined;
  return { ca: readFileSync(env.SUPABASE_CA_CERT_PATH as string, 'utf8'), rejectUnauthorized: true };
}

export interface PrismaClientOptions {
  max?: number;
  /** Overrides for tests (e.g. very short timeouts). Production uses DATABASE_TIMEOUTS. */
  timeouts?: Partial<Record<keyof typeof DATABASE_TIMEOUTS, number>>;
}

/** The pg pool configuration used by the runtime client. Exported for tests. */
export function poolConfig(connectionString: string, options: PrismaClientOptions = {}): PoolConfig {
  const t = { ...DATABASE_TIMEOUTS, ...options.timeouts };
  const statementTimeout = Math.trunc(t.statementTimeoutMillis);
  return {
    connectionString,
    max: options.max,
    ssl: tlsOptions(),
    connectionTimeoutMillis: t.connectionTimeoutMillis,
    idleTimeoutMillis: t.idleTimeoutMillis,
    query_timeout: t.queryTimeoutMillis,
    keepAlive: true,
    keepAliveInitialDelayMillis: t.keepAliveInitialDelayMillis,
    // Set with a plain SET (not a startup parameter, which a connection pooler may reject). pg-pool awaits this hook
    // before handing the connection out; if it fails the connection is closed and the error reaches the caller.
    onConnect: async (conn) => {
      await conn.query(`SET statement_timeout = ${statementTimeout}`);
    },
  };
}

/** Builds a Prisma client for a given URL (the `?schema=` parameter is handled for the adapter). */
export function createPrismaClient(databaseUrl: string, options: PrismaClientOptions = {}): PrismaClient {
  const { connectionString, schema } = parseDatabaseUrl(databaseUrl);
  return new PrismaClient({
    adapter: new PrismaPg(poolConfig(connectionString, options), {
      schema,
      // Without these the adapter only writes to its debug channel: a dropped connection would be invisible.
      // pg-pool already discards the broken client; the next query opens a new connection.
      onPoolError: (err) => logger.warn({ event: 'db.idle_connection_error', db: safeDatabaseErrorFields(err) }, 'Idle database connection failed'),
      onConnectionError: (err) => logger.warn({ event: 'db.connection_error', db: safeDatabaseErrorFields(err) }, 'Database connection failed during use'),
    }),
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
  const current = client;
  client = undefined;
  await current?.$disconnect();
}
