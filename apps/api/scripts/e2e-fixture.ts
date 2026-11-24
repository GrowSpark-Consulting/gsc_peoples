/**
 * Browser-test fixture for cross-company isolation (local only).
 *   tsx scripts/e2e-fixture.ts create <runId>   -> prints {"companyId","employeeId"} as JSON
 *   tsx scripts/e2e-fixture.ts remove <runId>
 * Creates ONE extra company "e2e-other-<runId>" with one employee, as hr_migrator, on localhost only.
 * It writes no audit rows, so `remove` can delete exactly those rows and nothing else.
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';
import { parseDatabaseUrl } from '../src/database/connection-url';
import { assertLocalTarget } from '../src/database/provisioning/local-provisioning';

loadEnv({ path: path.resolve(import.meta.dirname, '../../../.env'), quiet: true });

async function main() {
  const [command, runId] = process.argv.slice(2);
  if (!runId || !/^[A-Z0-9]{3,16}$/.test(runId)) throw new Error('runId must be 3-16 chars A-Z0-9');
  if (command !== 'create' && command !== 'remove') throw new Error('usage: create|remove <runId>');
  const url = process.env.DIRECT_URL;
  if (!url) throw new Error('DIRECT_URL is not set');
  assertLocalTarget(url);
  const companyId = `e2e-other-${runId.toLowerCase()}`;

  const c = new pg.Client({ connectionString: parseDatabaseUrl(url).connectionString });
  await c.connect();
  try {
    if (command === 'create') {
      const employeeId = randomUUID();
      await c.query('BEGIN');
      await c.query(
        'INSERT INTO hr.companies (id, name, "updatedAt") VALUES ($1, $1, now()) ON CONFLICT (id) DO NOTHING',
        [companyId],
      );
      await c.query(
        `INSERT INTO hr.employees (id, "companyId", "employeeNumber", "firstName", "lastName", status, "updatedAt")
         VALUES ($1, $2, $3, 'Foreign', $4, 'ACTIVE', now())`,
        [employeeId, companyId, `E2E-F-${runId}`, `Company${runId}`],
      );
      await c.query('COMMIT');
      console.log(JSON.stringify({ companyId, employeeId }));
    } else {
      await c.query('BEGIN');
      await c.query('DELETE FROM hr.employees WHERE "companyId" = $1', [companyId]);
      await c.query('DELETE FROM hr.companies WHERE id = $1', [companyId]);
      await c.query('COMMIT');
      console.log(JSON.stringify({ removed: companyId }));
    }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
