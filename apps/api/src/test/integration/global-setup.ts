import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { assertScratchDb, connect, maintenanceUrl, TEST_DB } from './helpers';

const db = path.resolve(import.meta.dirname, '../../database');

/** Runs one statement on the maintenance database. Only ever used for the scratch database. */
async function maintenance(sql: string): Promise<void> {
  const c = new pg.Client({ connectionString: maintenanceUrl() });
  await c.connect();
  try {
    await c.query(sql);
  } finally {
    await c.end();
  }
}

/**
 * Builds the integration environment in a THROWAWAY database (default `hr_itest`), never in `hr_test`
 * or `hr_db`:
 *   1. CREATE DATABASE <scratch> (after `assertScratchDb`; skipped if it already exists from a crashed run,
 *      in which case its `hr` schema is rebuilt below).
 *   2. Inside the scratch database only, (re)create schema `hr` and apply the real migrations in name order,
 *      exactly the folders `prisma migrate deploy` applies.
 * Teardown drops the scratch database. `connect()` verifies server-side that every connection really is in
 * the scratch database, so the DROP SCHEMA below can never reach another database.
 */
export default async function setup() {
  assertScratchDb(TEST_DB);

  const probe = new pg.Client({ connectionString: maintenanceUrl() });
  await probe.connect();
  let exists: boolean;
  try {
    exists = ((await probe.query('select 1 from pg_database where datname = $1', [TEST_DB])).rowCount ?? 0) > 0;
  } finally {
    await probe.end();
  }
  if (!exists) await maintenance(`CREATE DATABASE "${TEST_DB}"`);

  const c = await connect('TEST_DIRECT_URL');
  try {
    const { rows } = await c.query<{ db: string }>('select current_database() as db');
    if (rows[0]?.db !== TEST_DB)
      throw new Error(`SAFEGUARD: refusing to reset a database that is not ${TEST_DB}`);

    await c.query('DROP SCHEMA IF EXISTS hr CASCADE');
    await c.query('CREATE SCHEMA hr AUTHORIZATION hr_migrator');
    await c.query('GRANT USAGE ON SCHEMA hr TO hr_app');
    await c.query(
      'ALTER DEFAULT PRIVILEGES FOR ROLE hr_migrator IN SCHEMA hr GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hr_app',
    );
    await c.query(
      'ALTER DEFAULT PRIVILEGES FOR ROLE hr_migrator IN SCHEMA hr GRANT USAGE, SELECT ON SEQUENCES TO hr_app',
    );
    await c.query('SET search_path = hr'); // what Prisma does for ?schema=hr while applying migrations

    // Exactly the files `prisma migrate deploy` applies to hr_db: every folder in migrations/, in name order.
    const migrations = readdirSync(path.join(db, 'migrations'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    for (const name of migrations) {
      try {
        await c.query(readFileSync(path.join(db, 'migrations', name, 'migration.sql'), 'utf8'));
      } catch (e) {
        throw new Error(`migration ${name} failed: ${(e as Error).message}`);
      }
    }
  } finally {
    await c.end();
  }

  // Teardown: remove the scratch database (set INTEGRATION_KEEP_DB=1 to keep it for inspection).
  return async () => {
    if (process.env.INTEGRATION_KEEP_DB === '1') return;
    assertScratchDb(TEST_DB);
    await maintenance(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  };
}
