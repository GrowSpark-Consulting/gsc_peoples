/**
 * Retention purge for soft-deleted documents (DOC-005). NOT scheduled and NOT run by any deployment: an operator
 * runs it by hand, or a scheduler is wired up later after approval.
 *
 *   tsx scripts/purge-documents.ts                 dry run (default): lists what is due, changes nothing
 *   tsx scripts/purge-documents.ts --execute       removes due objects and rows, company by company
 *   options: --limit <n>  documents per company per run (default 100, max 1000)
 *
 * Companies are listed with DIRECT_URL (hr_migrator), because the runtime role cannot see other tenants; the purge
 * itself runs through the tenant runner (hr_app, one company at a time). Storage comes from the same
 * DOCUMENT_STORAGE_DRIVER / SUPABASE_STORAGE_* variables as the API. Nothing is printed except counts and ids.
 */
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';

loadEnv({ path: path.resolve(import.meta.dirname, '../../../.env'), quiet: true });

const { env } = await import('../src/config/env');
const { parseDatabaseUrl } = await import('../src/database/connection-url');
const { getPrisma, disconnectDatabase } = await import('../src/database/client');
const { createTenantRunner } = await import('../src/database/tenant');
const { createDocumentStorage } = await import('../src/integrations/storage');
const { logger } = await import('../src/shared/utils/logger');
const { purgeAllCompanies } = await import('../src/modules/documents/retention');

const args = process.argv.slice(2);
const execute = args.includes('--execute');
const limitArg = args.indexOf('--limit');
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : 100;
if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit must be a positive integer');

const directUrl = process.env.DIRECT_URL ?? process.env.SUPABASE_DIRECT_URL;
if (!directUrl) throw new Error('DIRECT_URL is required to list companies');
const admin = new pg.Client({ connectionString: parseDatabaseUrl(directUrl).connectionString });
await admin.connect();
let companyIds: string[];
try {
  companyIds = (await admin.query<{ id: string }>('select id from hr.companies order by id')).rows.map((r) => r.id);
} finally {
  await admin.end();
}

const results = await purgeAllCompanies(companyIds, {
  runner: createTenantRunner(getPrisma()),
  storage: createDocumentStorage(env),
  dryRun: !execute,
  limit,
  log: logger,
});
console.log(JSON.stringify({ mode: execute ? 'execute' : 'dry-run', companies: results.length, scanned: results.reduce((n, r) => n + r.scanned, 0), purged: results.reduce((n, r) => n + r.purged, 0), failed: results.reduce((n, r) => n + r.failed, 0) }));
await disconnectDatabase();
process.exit(results.some((r) => r.failed > 0) ? 1 : 0);
