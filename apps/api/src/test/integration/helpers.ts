import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';
import { parseDatabaseUrl } from '../../database/connection-url';

loadEnv({ path: path.resolve(import.meta.dirname, '../../../../../.env'), quiet: true });

// Capture the initial configured URLs before tests reassign `process.env.DATABASE_URL` to `hr_itest` for `createApp()`.
const INITIAL_FALLBACK_URLS: Record<UrlKey, string | undefined> = {
  TEST_DATABASE_URL: process.env.DATABASE_URL,
  TEST_DIRECT_URL: process.env.DIRECT_URL,
};

/**
 * The ONLY database integration tests may ever touch: a throwaway scratch database that exists only
 * for the test run. It is created by the global setup (hr_migrator has CREATEDB) and dropped by the
 * teardown. `hr_test`, `hr_db` and every other database are never connected to for DDL: the real `hr`
 * schema there is never dropped, rebuilt or written to by the test suite.
 */
export const TEST_DB = process.env.INTEGRATION_DB ?? 'hr_itest';
const SCRATCH_NAME = /^hr_itest[a-z0-9_]*$/;
const PROTECTED_DBS = new Set(['hr_db', 'hr_test', 'postgres', 'template0', 'template1']);

type UrlKey = 'TEST_DATABASE_URL' | 'TEST_DIRECT_URL';

const dbNameOf = (url: string) => new URL(url).pathname.slice(1);

/** Throws unless `name` is an acceptable scratch database name. Used before any CREATE/DROP DATABASE. */
export function assertScratchDb(name: string): void {
  if (!SCRATCH_NAME.test(name) || PROTECTED_DBS.has(name))
    throw new Error(
      `SAFEGUARD: "${name}" is not an allowed scratch database (must match ${SCRATCH_NAME} and not be a protected database)`,
    );
}

function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * The configured URL the scratch database is derived from. Prefers TEST_DATABASE_URL / TEST_DIRECT_URL
 * (must point at hr_test); when those are not set it falls back to the development URLs DATABASE_URL /
 * DIRECT_URL (must point at hr_db). Same host and roles either way; only the database name is replaced.
 * The host must be local: the suite can never create or drop a database on a hosted server (Supabase).
 */
function baseUrl(key: UrlKey): string {
  const explicit = process.env[key];
  const [url, expectedDb, source] = explicit
    ? [explicit, 'hr_test', key]
    : [INITIAL_FALLBACK_URLS[key], 'hr_db', key === 'TEST_DATABASE_URL' ? 'DATABASE_URL' : 'DIRECT_URL'];
  if (!url) throw new Error(`${key} (or ${source}) is not set. Run: pnpm db:test:setup`);
  const name = dbNameOf(url);
  if (name !== expectedDb)
    throw new Error(`SAFEGUARD: ${source} points at "${name}"; expected "${expectedDb}" (the scratch database is derived from it)`);
  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.has(host))
    throw new Error(`SAFEGUARD: ${source} points at a non-local host; integration tests only run on a local PostgreSQL`);
  return url;
}

/** Connection URL for the scratch database (same host and roles as the configured URL). */
export function testUrl(key: UrlKey, database: string = TEST_DB): string {
  assertScratchDb(database);
  return withDatabase(baseUrl(key), database);
}

/** URL of the maintenance database, used only for CREATE/DROP DATABASE of the scratch database. */
export function maintenanceUrl(): string {
  return parseDatabaseUrl(withDatabase(baseUrl('TEST_DIRECT_URL'), 'postgres')).connectionString;
}

/** Connects and re-verifies server-side that we are really inside the scratch database. */
export async function connect(key: UrlKey): Promise<pg.Client> {
  const { connectionString } = parseDatabaseUrl(testUrl(key));
  const client = new pg.Client({ connectionString });
  await client.connect();
  const { rows } = await client.query<{ db: string }>('select current_database() as db');
  if (rows[0]?.db !== TEST_DB) {
    await client.end();
    throw new Error(`SAFEGUARD: connected to "${rows[0]?.db}", expected "${TEST_DB}"`);
  }
  return client;
}

/**
 * Binds a runtime-role connection to one tenant for its whole session (what the API does per
 * transaction). Row-Level Security hides every company row from hr_app without a tenant context, so
 * tests that exercise constraints and triggers as hr_app must say which company they act for.
 */
export async function bindTenant(client: pg.Client, companyId: string): Promise<void> {
  await client.query('SELECT set_config($1, $2, false)', ['app.company_id', companyId]);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Tracks a promise without awaiting it, so tests can assert it is still blocked. */
export function track<T>(promise: Promise<T>) {
  let state: 'pending' | 'resolved' | 'rejected' = 'pending';
  promise.then(
    () => (state = 'resolved'),
    () => (state = 'rejected'),
  );
  return { promise, state: () => state };
}

export interface PgError extends Error {
  code?: string;
  constraint?: string;
}
export async function failure(fn: () => Promise<unknown>): Promise<PgError> {
  try {
    await fn();
  } catch (e) {
    return e as PgError;
  }
  throw new Error('Expected the statement to fail, but it succeeded');
}
